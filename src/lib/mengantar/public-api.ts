// DEL-1 stage 3 / TD-3: read-only Mengantar Public API client (area search, shipping estimate).
// The seller API key is part of the URL path (`/api/public/{API_KEY}/...`), so a request URL is a
// secret: it is never logged, thrown or returned. Only fixed origins are allowed, redirects are
// not followed (workerd rejects `redirect: "error"`, so `manual` + 3xx refusal), responses are
// time- and size-bounded, and every number is checked before it is used.
// Contract evidence: docs/research/geraiexpress-mengantar-public-api.md and
// tests/unit/fixtures/mengantar (sanitized production responses, 2026-10-14).

export const MENGANTAR_ORIGINS = {
  production: "https://api-public.mengantar.com",
  sandbox: "https://sandbox.mengantar.com",
} as const;
export type MengantarEnvironment = keyof typeof MENGANTAR_ORIGINS;

// Response key → courier code accepted by create-order. Only couriers the Public API documents as
// `courier` values are offered. Ninja is discontinued (1 September 2026).
// lazy: "*Cargo" variants and SAPLite are returned by courier=all but undocumented as courier values
// and their price fields are inconsistent in captured responses; add them once Mengantar confirms
// their order contract.
const COURIERS: Record<string, string> = {
  JNE: "JNE",
  SiCepat: "SiCepat",
  SAP: "Sap",
  iDexpress: "iDexpress",
  JT: "JT",
  lion: "lion",
  anteraja: "anteraja",
  spx: "spx",
  pos: "pos",
};

export type MengantarErrorCode =
  | "not_allowed" // 403: key/IP not permitted (the sandbox answers this for unlisted callers)
  | "rejected" // provider answered success:false (unknown area, invalid key, ...)
  | "unavailable" // network failure, timeout, 5xx, redirect
  | "malformed"; // unexpected status, content type, size or shape

export class MengantarError extends Error {
  constructor(readonly code: MengantarErrorCode) {
    super(`Mengantar request failed: ${code}`);
    this.name = "MengantarError";
  }
}

export type AreaOption = {
  id: string;
  province: string;
  city: string;
  district: string;
  subdistrict: string;
  zip: string;
};

export type EstimateRequest = {
  originAreaId: string;
  destinationAreaId: string;
  weightGrams: number;
  // COD_AMOUNT = goods value + shipping fee (provider definition). Omit for non-COD.
  codAmount?: number;
};

export type CourierEstimate = {
  courier: string;
  // Normal (undiscounted) shipping tariff shown at the counter and on the resi.
  tariff: number;
  // COD service fee; 0 when COD was not requested.
  codFee: number;
  // Provider cost after the account's volume discount, without the COD fee (administrator only).
  netShipping: number;
  etaText: string | null;
};

const AREA_ID = /^[a-f0-9]{24}$/;
const TIMEOUT_MS = 10_000;
const MAX_BYTES = 256 * 1024;

export function createMengantarPublicClient(environment: MengantarEnvironment, apiKey: string, fetchImpl: typeof fetch = fetch) {
  const origin = MENGANTAR_ORIGINS[environment];
  if (!origin) throw new Error("Unknown Mengantar environment");
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(apiKey)) throw new Error("Malformed Mengantar API key");
  const base = `${origin}/api/public/${encodeURIComponent(apiKey)}`;

  async function getData(path: string, params: Record<string, string>): Promise<unknown> {
    const url = `${base}${path}?${new URLSearchParams(params)}`;
    let response: Response;
    try {
      response = await fetchImpl(url, { headers: { Accept: "application/json" }, redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch {
      throw new MengantarError("unavailable");
    }
    if (response.status === 403) throw new MengantarError("not_allowed");
    if (response.status >= 500 || (response.status >= 300 && response.status < 400)) throw new MengantarError("unavailable");
    if (response.status !== 200 || !response.headers.get("content-type")?.includes("application/json")) {
      throw new MengantarError("malformed");
    }
    let body: string;
    try {
      body = await readBounded(response);
    } catch (error) {
      // A timeout or reset while reading is a transport problem, not a malformed answer.
      throw error instanceof MengantarError ? error : new MengantarError("unavailable");
    }
    let payload: unknown;
    try {
      payload = JSON.parse(body);
    } catch {
      throw new MengantarError("malformed");
    }
    if (!isRecord(payload)) throw new MengantarError("malformed");
    if (payload.success !== true) throw new MengantarError("rejected");
    return payload.data;
  }

  return {
    // The provider's area index (origin/destination ids for estimate and create-order).
    async searchAreas(keyword: string): Promise<AreaOption[]> {
      const term = keyword.trim();
      if (term.length < 3 || term.length > 60) return [];
      return parseAreas(await getData("/address/search", { keyword: term }));
    },

    async estimate(request: EstimateRequest): Promise<CourierEstimate[]> {
      const { originAreaId, destinationAreaId, weightGrams, codAmount } = request;
      if (!AREA_ID.test(originAreaId) || !AREA_ID.test(destinationAreaId)) throw new Error("Invalid area id");
      if (!Number.isInteger(weightGrams) || weightGrams < 1 || weightGrams > 1_000_000) throw new Error("Invalid weight");
      if (codAmount !== undefined && (!Number.isInteger(codAmount) || codAmount < 1)) throw new Error("Invalid COD amount");
      const params: Record<string, string> = {
        origin_id: originAreaId,
        destination_id: destinationAreaId,
        courier: "all",
        weight: String(weightGrams / 1000),
      };
      if (codAmount !== undefined) params.COD_AMOUNT = String(codAmount);
      return parseEstimates(await getData("/order/estimate", params), codAmount !== undefined);
    },
  };
}

export async function readBounded(response: Response): Promise<string> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BYTES) throw new MengantarError("malformed");
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      await reader.cancel();
      throw new MengantarError("malformed");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const text = (value: unknown) => (typeof value === "string" ? value.trim().slice(0, 120) : "");
const money = (value: unknown) => (typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null);

export function parseAreas(data: unknown): AreaOption[] {
  if (!Array.isArray(data)) throw new MengantarError("malformed");
  return data.slice(0, 100).flatMap((row) => {
    if (!isRecord(row) || typeof row._id !== "string" || !AREA_ID.test(row._id)) return [];
    const area = {
      id: row._id,
      province: text(row.PROVINCE_NAME),
      city: text(row.CITY_NAME),
      district: text(row.DISTRICT_NAME),
      subdistrict: text(row.SUBDISTRICT_NAME),
      zip: text(row.ZIP_CODE),
    };
    return area.city && area.district ? [area] : [];
  });
}

// One row per documented courier the route supports. A row is dropped (not guessed) when the
// courier is unsupported (route, origin or pickup), COD is requested but not covered, or its numbers do not add up:
// estimatedPrice must equal price + codFee, and the discounted cost must stay within the tariff.
export function parseEstimates(data: unknown, cod: boolean): CourierEstimate[] {
  if (!isRecord(data)) throw new MengantarError("malformed");
  const estimates: CourierEstimate[] = [];
  for (const [key, courier] of Object.entries(COURIERS)) {
    const row = data[key];
    // SiCepat also reports origin/pickup coverage; either flag means the route cannot be booked.
    if (!isRecord(row) || row.unsupported === true || row.unsupportedPickup === true || row.unsupportedOriginSicepat === true) continue;
    if (cod && (row.unsupported_cod === true || row.coverage_cod === false)) continue;
    const tariff = money(row.price);
    const codFee = cod ? money(row.codFee) : 0;
    const total = money(row.estimatedPrice);
    const special = money(row.estimatedSpecialPrice);
    if (!tariff || codFee === null || total === null || special === null) continue;
    if (total !== tariff + codFee) continue;
    const netShipping = special - codFee;
    if (netShipping <= 0 || netShipping > tariff) continue;
    const eta = text(row.estimate_delivery);
    estimates.push({ courier, tariff, codFee, netShipping, etaText: eta && eta !== "undefined" && eta !== "-" ? eta : null });
  }
  return estimates.sort((a, b) => a.tariff - b.tariff || (a.courier < b.courier ? -1 : a.courier > b.courier ? 1 : 0));
}
