// DEL-1 stage 3 / TD-3: read-only Mengantar Public API client (area search, shipping estimate).
// The seller API key is part of the URL path (`/api/public/{API_KEY}/...`), so a request URL is a
// secret: it is never logged, thrown or returned. Only fixed origins are allowed, redirects are
// not followed (`redirect: "manual"` + 3xx refusal; workerd, the former runtime, rejected `"error"`), responses are
// time- and size-bounded, and every number is checked before it is used.
// Contract evidence: docs/research/geraiexpress-mengantar-public-api.md and
// tests/unit/fixtures/mengantar (sanitized production responses, 2026-10-14).

import { isPickupVolume, PICKUP_SLOT_HOURS, providerTimeFields, wibDate, type PickupVolume } from "./pickup";

export const MENGANTAR_ORIGINS = {
  production: "https://api-public.mengantar.com",
  sandbox: "https://sandbox.mengantar.com",
} as const;
export type MengantarEnvironment = keyof typeof MENGANTAR_ORIGINS;

// Regular response key → documented create-order courier. Ninja is discontinued (1 September 2026).
// Cargo is a separate, explicit transport opt-in: base courier + orders[].cargo=true (official docs,
// 2026-11-03). The shipment workflow still offers regular services only until seller/route/order
// support is verified. SAPLite remains unsupported; its order contract is not established.
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
const CARGO_COURIERS: Record<string, string> = {
  JNECargo: "JNE", SiCepatCargo: "SiCepat", SapCargo: "Sap", iDexpressCargo: "iDexpress",
};
export const OFFERED_COURIERS = new Set(Object.values(COURIERS));
export const CARGO_ORDER_COURIERS: readonly string[] = Object.values(CARGO_COURIERS);

// Couriers seen refusing drop-off orders (sandbox, T-020: anteraja). They are not offered for a
// drop-off shipment; a pickup shipment (T-043, scheduledPickup) keeps them.
// lazy: one sandbox observation, not a documented rule.
export const DROP_OFF_UNSUPPORTED = new Set(["anteraja"]);

export type MengantarErrorCode =
  | "not_allowed" // 403: key/IP not permitted (the sandbox answers this for unlisted callers)
  | "rejected" // provider answered success:false (unknown area, invalid key, ...)
  | "unavailable" // network failure, timeout, 5xx, redirect
  | "malformed" // unexpected status, content type, size or shape
  // A create request may have reached Mengantar but its answer is missing or unreadable. Never
  // retry: reconcile with findOrdersByReference first (TD-3, "unknown outcome").
  | "unknown_outcome";

export class MengantarError extends Error {
  constructor(
    readonly code: MengantarErrorCode,
    // The provider's own refusal text (create-order 4xx only), bounded, for the operator.
    readonly providerMessage: string | null = null,
  ) {
    super(`Mengantar request failed: ${code}`);
    this.name = "MengantarError";
  }
}

// A response body over the size cap. Still a "malformed" answer for every caller; the pickup
// pre-check alone tells it apart (the account did answer, the list is merely long).
export class ResponseTooLarge extends MengantarError {
  constructor() {
    super("malformed");
  }
}

// The request was refused locally, before anything was sent.
export class InvalidOrderRequest extends Error {
  constructor(readonly reason: string = "invalid_order_request") {
    super("Invalid order request");
    this.name = "InvalidOrderRequest";
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

export type PickupAddress = { id: string; areaId: string; name: string; address: string; area: string; hidden: boolean };

export type EstimateRequest = {
  originAreaId: string;
  destinationAreaId: string;
  weightGrams: number;
  // Estimate's COD_AMOUNT = goods value + shipping fee (provider's estimate definition; it only
  // sizes the COD fee). Not the create-order COD value, which also includes the COD fee. Omit for
  // non-COD.
  codAmount?: number;
  // Local parsing opt-in only, never an invented provider query parameter. Defaults to regular.
  includeCargo?: boolean;
};

export type CourierEstimate = {
  courier: string;
  // Absent on legacy regular rows. Cargo must never share grouping identity with regular.
  service_class?: "regular" | "cargo";
  minimum_weight_grams?: number;
  // Normal (undiscounted) shipping tariff shown at the counter and on the resi.
  tariff: number;
  // COD service fee; 0 when COD was not requested.
  codFee: number;
  // Provider cost after the account's volume discount, without the COD fee (administrator only).
  netShipping: number;
  // The provider's own discount for this account in integer basis points (22.5% -> 2250), from the
  // documented `discountPercent`. null = unknown (absent, unreadable or out of range); a present 0 is a real 0%.
  discountBps: number | null;
  etaText: string | null;
};

export const estimateServiceKey = (row: { courier: string; service_class?: "regular" | "cargo" }) =>
  `${row.courier}:${row.service_class ?? "regular"}`;

const AREA_ID = /^[a-f0-9]{24}$/;
const TIMEOUT_MS = 10_000;
const MAX_BYTES = 256 * 1024;

export function createMengantarPublicClient(environment: MengantarEnvironment, apiKey: string, fetchImpl: typeof fetch = fetch) {
  const origin = MENGANTAR_ORIGINS[environment];
  if (!origin) throw new Error("Unknown Mengantar environment");
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(apiKey)) throw new Error("Malformed Mengantar API key");
  const base = `${origin}/api/public/${encodeURIComponent(apiKey)}`;

  // Sends one request and returns the parsed JSON envelope with its status. Transport problems are
  // "unavailable", unreadable answers "malformed"; callers decide what a non-success envelope means.
  async function send(path: string, params: Record<string, string>, json?: unknown): Promise<{ status: number; payload: Record<string, unknown> }> {
    const query = new URLSearchParams(params).toString();
    const url = `${base}${path}${query ? `?${query}` : ""}`;
    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: json === undefined ? "GET" : "POST",
        headers: json === undefined ? { Accept: "application/json" } : { Accept: "application/json", "Content-Type": "application/json" },
        body: json === undefined ? undefined : JSON.stringify(json),
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new MengantarError("unavailable");
    }
    if (response.status === 403) throw new MengantarError("not_allowed");
    if (response.status >= 500 || (response.status >= 300 && response.status < 400)) throw new MengantarError("unavailable");
    if (!response.headers.get("content-type")?.includes("application/json")) throw new MengantarError("malformed");
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
    return { status: response.status, payload };
  }

  async function getData(path: string, params: Record<string, string>): Promise<unknown> {
    const { status, payload } = await send(path, params);
    if (status !== 200) throw new MengantarError("malformed");
    if (payload.success !== true) throw new MengantarError("rejected");
    return payload.data;
  }

  async function listOrders(params: Record<string, string>): Promise<ProviderOrder[]> {
    const data = await getData("/order", params);
    if (!Array.isArray(data)) throw new MengantarError("malformed");
    return data.map(parseOrder);
  }

  return {
    // The seller's saved pickup addresses (an outlet points at one; create-order needs its id).
    // Contact person and phone stay at the provider.
    async listPickupAddresses(): Promise<PickupAddress[]> {
      const data = await getData("/address", {});
      if (!Array.isArray(data)) throw new MengantarError("malformed");
      return data.flatMap((row) => {
        if (!isRecord(row) || typeof row._id !== "string" || !AREA_ID.test(row._id)
          || typeof row.PICKUP_AUTOFILL !== "string" || !AREA_ID.test(row.PICKUP_AUTOFILL)) return [];
        const address = text(row.PICKUP_ADDRESS);
        const area = [row.PICKUP_SUBDISTRICT, row.PICKUP_DISTRICT, row.PICKUP_CITY].map(text).filter(Boolean).join(", ");
        if (address.length < 5 || area.length < 3) return [];
        return [{ id: row._id, areaId: row.PICKUP_AUTOFILL, name: text(row.PICKUP_NAME), address, area, hidden: row.isHide === true }];
      });
    },

    // T-043 / TD-12: the seller's own pickup time records (GET /time, no parameters). Read-only.
    // Documentation shape (Observed, example only): `data` is an array of `{ _id, date, time }`
    // with `date` in epoch milliseconds and `time` like "12:00". Unverified: whether a row carries
    // its address (read here only when present), what the list holds beyond the seller's own
    // records, and its size or paging. Rows that do not parse are dropped, never guessed.
    async listPickupTimes(): Promise<ProviderPickupTime[]> {
      const data = await getData("/time", {});
      if (!Array.isArray(data)) throw new MengantarError("malformed");
      return data.flatMap((row) => {
        const parsed = parseTimeRecord(row);
        return parsed ? [parsed] : [];
      });
    },

    // T-043 / TD-12: reserves one pickup time record (POST /time). A state-changing call that is
    // never retried here: a refusal that created nothing (a plain 400 "invalid pickup time", or a
    // 403) is a MengantarError "rejected" / "not_allowed"; every other failure, or an answer
    // that cannot be tied to the requested slot and address, is "unknown_outcome" because the
    // record may exist. The caller reconciles by listPickupTimes, it never POSTs again.
    // Unverified (no sandbox capture): the success status (200 or 201 accepted), the error body
    // shape, whether the same input returns the same record, and whether a record expires.
    async reservePickupTime(input: { addressId: string; date: string; hour: number }): Promise<{ timeId: string }> {
      const fields = providerTimeFields(input.date, input.hour);
      if (!AREA_ID.test(input.addressId) || !fields) throw new InvalidOrderRequest("pickup_slot_invalid");
      let answer: { status: number; payload: Record<string, unknown> };
      try {
        answer = await send("/time", {}, { address_id: input.addressId, ...fields });
      } catch (error) {
        if (error instanceof MengantarError && error.code === "not_allowed") throw error;
        throw new MengantarError("unknown_outcome");
      }
      const { status, payload } = answer;
      if (status === 400 && payload.success === false && !Array.isArray(payload.data)) {
        throw new MengantarError("rejected", text(payload.message).slice(0, 200) || null);
      }
      if ((status !== 200 && status !== 201) || payload.success !== true) throw new MengantarError("unknown_outcome");
      const record = parseTimeRecord(payload.data);
      // The answer must be the slot that was asked for, at the address that was asked for.
      if (!record || record.hour !== input.hour || record.date !== input.date
        || (record.addressId !== null && record.addressId !== input.addressId)) {
        throw new MengantarError("unknown_outcome");
      }
      return { timeId: record.id };
    },

    // The provider's area index (origin/destination ids for estimate and create-order).
    async searchAreas(keyword: string): Promise<AreaOption[]> {
      const term = keyword.trim();
      if (term.length < 3 || term.length > 60) return [];
      return parseAreas(await getData("/address/search", { keyword: term }));
    },

    async estimate(request: EstimateRequest): Promise<CourierEstimate[]> {
      const { originAreaId, destinationAreaId, weightGrams, codAmount } = request;
      if (request.includeCargo !== undefined && typeof request.includeCargo !== "boolean") throw new InvalidOrderRequest("invalid_cargo_flag");
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
      return parseEstimates(await getData("/order/estimate", params), codAmount !== undefined, request.includeCargo);
    },

    // Creates exactly one shipment. Every answer is judged on the order item, not the envelope:
    // Mengantar can answer HTTP 200 success:true with the item in status "error" (sandbox, T-020).
    async createOrder(request: CreateOrderRequest): Promise<CreateOrderResult> {
      const body = createOrderBody(request);
      let answer: { status: number; payload: Record<string, unknown> };
      try {
        answer = await send("/order", {}, body);
      } catch (error) {
        // Refused before any work (403) is safe; anything else may have created the order.
        if (error instanceof MengantarError && error.code === "not_allowed") throw error;
        throw new MengantarError("unknown_outcome");
      }
      const { status, payload } = answer;
      // Only a plain 400 validation refusal is known to create nothing (observed: drop-off not
      // supported; documented: dropshipper validation). 409/422/429 and other 4xx are unknown.
      if (status === 400 && payload.success === false && !Array.isArray(payload.data)) {
        throw new MengantarError("rejected", text(payload.message).slice(0, 200) || null);
      }
      const items = payload.data;
      if (status !== 200 || payload.success !== true || !Array.isArray(items) || items.length !== 1) {
        throw new MengantarError("unknown_outcome");
      }
      return judgeCreatedItem(items[0], request.reference, request.cargo === true);
    },

    // Reconciliation by ORDER_ID (exact, with history at the provider).
    async findOrder(orderId: string, courier?: string): Promise<ProviderOrder | null> {
      if (!ORDER_ID.test(orderId)) throw new Error("Invalid order id");
      if (courier !== undefined && !OFFERED_COURIERS.has(courier)) throw new Error("Invalid courier");
      const params: Record<string, string> = { order_id: orderId, ...(courier ? { courier } : {}) };
      const orders = (await listOrders(params)).filter((o) => o.orderId === orderId);
      if (orders.length > 1) throw new MengantarError("malformed");
      return orders[0] ?? null;
    },

    // Lists all orders in a Mengantar batch for full-batch scope verification before payment (TD-3, T-026).
    async listOrdersByBatch(batch: string, courier: string): Promise<ProviderOrder[]> {
      if (typeof courier === "string" && courier.trim().toLowerCase() === "ninja") {
        throw new InvalidOrderRequest("courier_discontinued");
      }
      if (!BATCH_CODE.test(batch) || !OFFERED_COURIERS.has(courier)) {
        throw new InvalidOrderRequest();
      }
      const rows = await listOrders({ batch, courier, page: "1", size: "100" });
      return rows.filter((o) => o.batch === batch && o.status !== "error");
    },

    // Pays an unpaid Mengantar batch from the seller's wallet balance (TD-3, T-033). The request
    // takes the provider batch OBJECT id (`batch_id` of the create response, 24 lowercase hex), not
    // the batch code that GET /order filters on. Documented answer: `data` is the number of orders
    // paid and the top-level `cnote_no` lists their tracking numbers. Array order in `awbs` does not
    // prove shipment-to-AWB mapping; callers check the count against the batch and reconcile each
    // order via findOrder.
    async payUnpaidBatch(batchObjectId: string, courier: string): Promise<PayUnpaidResult> {
      if (typeof courier === "string" && courier.trim().toLowerCase() === "ninja") {
        throw new InvalidOrderRequest("courier_discontinued");
      }
      if (!BATCH_OBJECT_ID.test(batchObjectId) || !OFFERED_COURIERS.has(courier)) {
        throw new InvalidOrderRequest();
      }
      const { status, payload } = await send("/order/pay-unpaid", {}, { batch_id: batchObjectId, courier });
      if (status === 400 && payload.success === false && !Array.isArray(payload.data)) {
        throw new MengantarError("rejected", text(payload.message).slice(0, 200) || null);
      }
      if (status !== 200 || payload.success !== true) {
        throw new MengantarError("unknown_outcome");
      }
      // An unreadable count or tracking list leaves the payment effect unknown (never "paid").
      const count = payload.data;
      if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0) throw new MengantarError("unknown_outcome");
      let awbs: string[] = [];
      if (payload.cnote_no !== undefined) {
        if (!Array.isArray(payload.cnote_no) || !payload.cnote_no.every((x) => typeof x === "string")) {
          throw new MengantarError("unknown_outcome");
        }
        awbs = payload.cnote_no.map((x: string) => x.trim()).filter(Boolean);
      }
      return { paidCount: count, awbs };
    },

    // Reconciliation after an unknown outcome: our reference travels as destinationMark. The
    // documented dateRange filter does not work (JSON form returns nothing, dotted form is ignored)
    // and count/total are always 0, so newest-first pages are scanned (order and page size verified
    // on the sandbox) until a row predates the attempt by more than a clock-skew margin, or a page is
    // empty. Rows out of order make the scan inconclusive (equal timestamps are allowed). Every match means "exists" unless its
    // status is "error" (an error item has no ORDER_ID or resi).
    // lazy: at most maxPages × 50 orders; an account issuing more than that between the attempt and
    // the reconciliation needs a provider-side reference filter.
    async findOrdersByReference(query: { reference: string; courier: string; notBefore: Date; maxPages?: number }): Promise<ProviderOrder[]> {
      const { reference, courier, notBefore, maxPages = 5 } = query;
      if (!REFERENCE.test(reference)) throw new Error("Invalid reference");
      if (!Object.values(COURIERS).includes(courier)) throw new Error("Invalid courier");
      const cutoff = notBefore.getTime() - SKEW_MS;
      const matches: ProviderOrder[] = [];
      let previous = Number.POSITIVE_INFINITY;
      for (let page = 1; page <= maxPages; page++) {
        const orders = await listOrders({ page: String(page), size: "50", courier });
        if (orders.length === 0) return matches;
        for (const order of orders) {
          const created = Date.parse(order.createdAt);
          if (created > previous) throw new MengantarError("unknown_outcome");
          previous = created;
          if (order.reference === reference) matches.push(order);
        }
        if (previous < cutoff) return matches;
      }
      throw new MengantarError("unknown_outcome");
    },
  };
}
export type MengantarPublicClient = ReturnType<typeof createMengantarPublicClient>;


export async function readBounded(response: Response): Promise<string> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BYTES) throw new ResponseTooLarge();
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
      throw new ResponseTooLarge();
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

// The estimate's documented `discountPercent` (a JSON number such as 22.5) as integer basis points
// (2250). Exact: the shortest decimal text of the number is converted with integer arithmetic, so no
// floating-point product is ever rounded. Only a finite number from 0 to 100 that is a whole
// multiple of 0.01 percent is kept; everything else (absent, text, NaN, negative, above 100,
// 22.555) is unknown = null. A present 0 is a real 0%, never confused with unknown.
// `discountExtraPercent` is deliberately not read: its meaning is undocumented.
export function discountPercentToBps(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100) return null;
  const match = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(String(value));
  if (!match) return null;
  return Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
}

// One row per documented courier the route supports. A row is dropped (not guessed) when the
// courier is unsupported (route, origin or pickup), COD is requested but not covered, or its numbers do not add up:
// estimatedPrice must equal price + codFee, and the discounted cost must stay within the tariff.
export function parseEstimates(data: unknown, cod: boolean, includeCargo = false): CourierEstimate[] {
  if (!isRecord(data)) throw new MengantarError("malformed");
  const estimates: CourierEstimate[] = [];
  for (const [key, courier] of [...Object.entries(COURIERS), ...(includeCargo ? Object.entries(CARGO_COURIERS) : [])]) {
    const cargo = Object.hasOwn(CARGO_COURIERS, key);
    // Public samples disagree by Rp1 between generic COD fee and cargo totals. No tolerance or
    // inferred fee is accepted: all cargo COD stays disabled pending seller/order verification.
    if (cargo && cod) continue;
    const row = data[key];
    // SiCepat also reports origin/pickup coverage; either flag means the route cannot be booked.
    if (!isRecord(row) || row.unsupported === true || row.unsupportedPickup === true || row.unsupportedOriginSicepat === true) continue;
    if (cod && (row.unsupported_cod === true || row.coverage_cod === false)) continue;
    const minimum = cargo && typeof row.minimumWeightCargo === "number" ? row.minimumWeightCargo * 1000 : null;
    if (cargo && (minimum === null || !Number.isSafeInteger(minimum) || minimum < 1 || minimum > 1_000_000)) continue;
    const tariff = money(cargo ? row.cargoPrice : row.price);
    const codFee = cod ? money(row.codFee) : 0;
    const total = money(cargo ? row.cargoEstimatedPrice : row.estimatedPrice);
    const special = money(cargo ? row.cargoEstimatedSpecialPrice : row.estimatedSpecialPrice);
    if (!tariff || codFee === null || total === null || special === null) continue;
    if (total !== tariff + codFee) continue;
    const netShipping = special - codFee;
    if (netShipping <= 0 || netShipping > tariff) continue;
    const eta = text(cargo ? row.estimate_delivery_cargo : row.estimate_delivery);
    estimates.push({
      courier, tariff, codFee, netShipping,
      ...(cargo ? { service_class: "cargo" as const, minimum_weight_grams: minimum! } : {}),
      discountBps: discountPercentToBps(cargo ? row.cargoDiscountPercent : row.discountPercent),
      etaText: eta && eta !== "undefined" && eta !== "-" ? eta : null,
    });
  }
  return estimates.sort((a, b) => a.tariff - b.tariff || (a.courier < b.courier ? -1 : a.courier > b.courier ? 1 : 0));
}

// --- Orders (T-021 / T-025 / T-026) -----------------------------------------------------------

const ORDER_ID = /^[A-Z0-9]{6,20}$/;
// A provider batch code (the human reference, GET /order filter) and a provider batch object id
// (`batch_id`, the pay-unpaid request field) are different identifiers: never interchange them.
const BATCH_CODE = /^[A-Z0-9]{6,24}$/;
const BATCH_OBJECT_ID = /^[a-f0-9]{24}$/;
const batchCode = (value: unknown) => (typeof value === "string" && BATCH_CODE.test(value) ? value : null);
const batchObjectId = (value: unknown) => (typeof value === "string" && BATCH_OBJECT_ID.test(value) ? value : null);
const SKEW_MS = 10 * 60_000;
// GeraiExpress shipment reference (e.g. GX261014-ABC123) sent as destinationMark and used to
// reconcile unknown outcomes.
const REFERENCE = /^[A-Z]{2}[A-Z0-9-]{4,30}$/;

export type PayUnpaidResult = {
  paidCount: number;
  awbs: string[];
};

export type TwoPassCodEstimateInput = {
  originAreaId: string;
  destinationAreaId: string;
  weightGrams: number;
  goodsValueIdr: number;
  includeCargo?: boolean;
  lengthCm?: number;
  widthCm?: number;
  heightCm?: number;
  discountPercent?: number;
};

// Two-pass COD quoting (T-025 / TD-1):
// Pass 1 calls GET /estimate with codAmount = goodsValueIdr to discover COD-capable couriers and
// their normal shipping tariff. Because Mengantar calculates codFee as a percentage of the COD
// parameter (which on POST /order/create must be goods + shipping + COD fee), Pass 2 calls
// GET /estimate with codAmount = goodsValueIdr + tariff (grouped by distinct tariff across
// services, bounded by their distinct tariffs) and extracts each service's codFee/netShipping from that second
// pass. Customer charge = tariff + codFee; recipient COD collection = goodsValueIdr + tariff + codFee.
export async function estimateTwoPassCod(
  estimateFn: (input: EstimateRequest) => Promise<CourierEstimate[]>,
  input: TwoPassCodEstimateInput,
): Promise<CourierEstimate[]> {
  if (!Number.isSafeInteger(input.goodsValueIdr) || input.goodsValueIdr < 1000) {
    throw new InvalidOrderRequest("cod_goods_value_required");
  }
  const baseInput = {
    originAreaId: input.originAreaId,
    destinationAreaId: input.destinationAreaId,
    weightGrams: input.weightGrams,
    ...(input.includeCargo !== undefined ? { includeCargo: input.includeCargo } : {}),
    ...(input.lengthCm !== undefined ? { lengthCm: input.lengthCm } : {}),
    ...(input.widthCm !== undefined ? { widthCm: input.widthCm } : {}),
    ...(input.heightCm !== undefined ? { heightCm: input.heightCm } : {}),
    ...(input.discountPercent !== undefined ? { discountPercent: input.discountPercent } : {}),
  };
  const pass1 = await estimateFn({ ...baseInput, codAmount: input.goodsValueIdr });
  if (pass1.length === 0) return [];

  const distinctTariffs = Array.from(new Set(pass1.map((row) => row.tariff)));
  const pass2ByTariff = new Map<number, Map<string, CourierEstimate>>();
  await Promise.all(
    distinctTariffs.map(async (tariff) => {
      const rows = await estimateFn({ ...baseInput, codAmount: input.goodsValueIdr + tariff });
      pass2ByTariff.set(tariff, new Map(rows.map((r) => [estimateServiceKey(r), r])));
    }),
  );

  const resolved: CourierEstimate[] = [];
  for (const row of pass1) {
    const pass2Row = pass2ByTariff.get(row.tariff)?.get(estimateServiceKey(row));
    if (!pass2Row || pass2Row.tariff !== row.tariff || pass2Row.codFee < 0
      || pass2Row.minimum_weight_grams !== row.minimum_weight_grams) continue;
    resolved.push({
      courier: row.courier,
      ...(row.service_class ? { service_class: row.service_class, minimum_weight_grams: row.minimum_weight_grams } : {}),
      tariff: row.tariff,
      codFee: pass2Row.codFee,
      netShipping: pass2Row.netShipping,
      // The net cost and the discount percent come from the same (second) answer.
      discountBps: pass2Row.discountBps ?? null,
      etaText: pass2Row.etaText ?? row.etaText,
    });
  }
  return resolved.sort((a, b) => (a.tariff + a.codFee) - (b.tariff + b.codFee) || (a.courier < b.courier ? -1 : a.courier > b.courier ? 1 : 0));
}

// Indonesian mobile numbers as Mengantar expects them: digits only, local 0 prefix.
export function providerPhone(phone: string | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/^\+/, "");
  const local = digits.startsWith("62") ? `0${digits.slice(2)}` : digits;
  return /^0\d{9,14}$/.test(local) ? local : null;
}
export const LIVE_RECIPIENT_NAME_MAX = 100;
export const LIVE_RECIPIENT_ADDRESS_MAX = 300;

export type CreateOrderRequest = {
  courier: string;
  // Explicit non-COD transport only; callers must prove account/route support before activation.
  cargo?: boolean;
  pickupAddressId: string;
  // Handover: absent = drop-off (`pickup.type: "dropOff"`). With `pickup`, the order is sent as
  // `scheduledPickup` carrying the reserved time record and the volume class (both documented as
  // required for scheduledPickup; unverified in the sandbox).
  pickup?: { timeId: string; volume: PickupVolume };
  reference: string;
  recipient: { areaId: string; address: string; name: string; phone: string };
  weightGrams: number;
  quantity: number;
  parcelContent: string;
  // Non-COD: the declared goods value. COD: the total the courier collects from the recipient
  // (goods + shipping + COD fee, provider definition); sandbox stored it as COD_AMOUNT and also as
  // GOODS_AMOUNT (T-021), so the provider treats the whole collected amount as the declared goods
  // value, which matters for insurance and claims. Weight is sent in kilograms with decimals; the provider's
  // billable rounding is not established.
} & ({ goodsValue: number; codAmount?: never } | { codAmount: number; goodsValue?: never });

export type CreateOrderResult =
  // Paid and handed a resi: the shipment exists.
  | { outcome: "issued"; orderId: string; trackingNumber: string; batch: string; batchId: string | null; tariffWithFees: number | null }
  // Created but not paid (insufficient balance): no resi yet; payment is a batch command (TD-3).
  | { outcome: "unpaid"; orderId: string; batch: string; batchId: string | null; tariffWithFees: number | null }
  // Mengantar recorded the attempt as an error item without ORDER_ID or resi. The provider keeps
  // that record (with a batch), so before creating again the dispatcher must confirm the batch
  // still holds only an error item.
  // lazy: evidence is one sandbox JNE sample; whether an error item can later be completed at
  // Mengantar is not established.
  | { outcome: "failed"; batch: string | null; batchId: string | null; providerRecordId: string | null };

export type ProviderOrder = {
  orderId: string | null;
  // Missing/unreadable is unknown, never proof that a cargo request became regular.
  cargo?: boolean;
  // The provider batch CODE (GET /order filter, shown to people) and the batch OBJECT id
  // (`batch_id`, what POST /order/pay-unpaid takes) are separate fields; null when unreadable.
  batch: string | null;
  batchId: string | null;
  // The price Mengantar charges (estimatedPrice), when readable.
  price: number | null;
  reference: string | null;
  trackingNumber: string | null;
  status: string;
  paid: boolean;
  createdAt: string;
};

function createOrderBody(r: CreateOrderRequest) {
  if (typeof r.courier === "string" && r.courier.trim().toLowerCase() === "ninja") {
    throw new InvalidOrderRequest("courier_discontinued");
  }
  if (r.cargo !== undefined && typeof r.cargo !== "boolean") throw new InvalidOrderRequest("invalid_cargo_flag");
  if (r.cargo === true && !Object.values(CARGO_COURIERS).includes(r.courier)) throw new InvalidOrderRequest("cargo_courier_unsupported");
  if (r.cargo === true && r.codAmount !== undefined) throw new InvalidOrderRequest("cargo_cod_unverified");
  const courierOk = OFFERED_COURIERS.has(r.courier);
  const { areaId, address, name, phone } = r.recipient ?? ({} as CreateOrderRequest["recipient"]);
  const money = (v: unknown) => typeof v === "number" && Number.isSafeInteger(v) && v >= 1;
  const valid = courierOk
    && AREA_ID.test(r.pickupAddressId) && AREA_ID.test(areaId ?? "")
    && REFERENCE.test(r.reference)
    && typeof name === "string" && name.trim().length >= 1 && name.length <= LIVE_RECIPIENT_NAME_MAX
    && typeof address === "string" && address.trim().length >= 5 && address.length <= LIVE_RECIPIENT_ADDRESS_MAX
    && typeof phone === "string" && providerPhone(phone) === phone
    && Number.isInteger(r.weightGrams) && r.weightGrams >= 1 && r.weightGrams <= 1_000_000
    && Number.isInteger(r.quantity) && r.quantity >= 1 && r.quantity <= 1000
    && typeof r.parcelContent === "string" && r.parcelContent.trim().length >= 1 && r.parcelContent.length <= 100
    && (r.goodsValue === undefined) !== (r.codAmount === undefined)
    && (r.pickup === undefined || (PROVIDER_TIME_ID.test(r.pickup.timeId) && isPickupVolume(r.pickup.volume)))
    && (r.goodsValue === undefined || money(r.goodsValue)) && (r.codAmount === undefined || money(r.codAmount));
  if (!valid) throw new InvalidOrderRequest();
  return {
    courier: r.courier,
    pickup: r.pickup === undefined
      ? { address_id: r.pickupAddressId, type: "dropOff" }
      : { address_id: r.pickupAddressId, type: "scheduledPickup", time_id: r.pickup.timeId, volume: r.pickup.volume },
    orders: [{
      ...(r.cargo === true ? { cargo: true } : {}),
      ...(r.goodsValue !== undefined ? { goodsValue: r.goodsValue } : { COD: r.codAmount }),
      customerAddressDataId: areaId,
      customerAddress: address.trim(),
      customerName: name.trim(),
      customerPhone: phone,
      weight: r.weightGrams / 1000,
      quantity: r.quantity,
      parcelContent: r.parcelContent.trim(),
      destinationMark: r.reference,
    }],
  };
}

function judgeCreatedItem(item: unknown, reference: string, cargo: boolean): CreateOrderResult {
  if (!isRecord(item)) throw new MengantarError("unknown_outcome");
  if (item.status === "error") {
    // An error item must not carry a shipment identity; if it does, the outcome is unclear.
    if (item.ORDER_ID || item.cnote_no) throw new MengantarError("unknown_outcome");
    return {
      outcome: "failed",
      batch: batchCode(item.batch),
      batchId: batchObjectId(item.batch_id),
      providerRecordId: typeof item._id === "string" && AREA_ID.test(item._id) ? item._id : null,
    };
  }
  if (cargo ? item.cargo !== true : item.cargo === true) throw new MengantarError("unknown_outcome");
  const orderId = typeof item.ORDER_ID === "string" && ORDER_ID.test(item.ORDER_ID) ? item.ORDER_ID : null;
  const batch = batchCode(item.batch);
  const batchId = batchObjectId(item.batch_id);
  if (!orderId || !batch || item.status !== "active" || item.destinationMark !== reference) throw new MengantarError("unknown_outcome");
  const tracking = typeof item.cnote_no === "string" && /^[A-Za-z0-9-]{6,40}$/.test(item.cnote_no) ? item.cnote_no : null;
  const price = typeof item.estimatedPrice === "number" && Number.isSafeInteger(item.estimatedPrice) && item.estimatedPrice > 0 ? item.estimatedPrice : null;
  if (cargo && (price === null || (item.cargoEstimatedPrice !== undefined && item.cargoEstimatedPrice !== price))) {
    throw new MengantarError("unknown_outcome");
  }
  if (item.isPaid === true && tracking) return { outcome: "issued", orderId, trackingNumber: tracking, batch, batchId, tariffWithFees: price };
  if (item.isPaid === false && (item.cnote_no === null || item.cnote_no === undefined)) return { outcome: "unpaid", orderId, batch, batchId, tariffWithFees: price };
  throw new MengantarError("unknown_outcome");
}

function parseOrder(row: unknown): ProviderOrder {
  if (!isRecord(row) || typeof row.status !== "string" || typeof row.createdAt !== "string" || Number.isNaN(Date.parse(row.createdAt))) {
    throw new MengantarError("malformed");
  }
  const orderId = typeof row.ORDER_ID === "string" && ORDER_ID.test(row.ORDER_ID) ? row.ORDER_ID : null;
  const reference = typeof row.destinationMark === "string" && REFERENCE.test(row.destinationMark) ? row.destinationMark : null;
  const trackingNumber = typeof row.cnote_no === "string" && row.cnote_no ? row.cnote_no.slice(0, 40) : null;
  const batch = batchCode(row.batch);
  const batchId = batchObjectId(row.batch_id);
  const price = typeof row.estimatedPrice === "number" && Number.isSafeInteger(row.estimatedPrice) && row.estimatedPrice > 0 ? row.estimatedPrice : null;
  return { orderId, ...(typeof row.cargo === "boolean" ? { cargo: row.cargo } : {}), batch, batchId, price, reference, trackingNumber, status: row.status.slice(0, 40), paid: row.isPaid === true, createdAt: row.createdAt };
}

// A pickup time record (`POST /time` answer or a `GET /time` row). The id shape is unverified (the
// documentation calls it "_id", like the other 24-hex ids); a bounded token is accepted.
const PROVIDER_TIME_ID = /^[A-Za-z0-9_-]{6,64}$/;

export type ProviderPickupTime = {
  id: string;
  hour: number;
  // The ONE calendar date (YYYY-MM-DD) the record means. A row has two documented shapes: an instant
  // whose UTC clock reading equals `time` (the GET example) or a real instant of the slot (then its
  // WIB clock reading equals `time`). `time` tells which: UTC clock match -> the UTC date; anything
  // else (a WIB match, or a date-only midnight such as the POST example) -> the WIB date, the
  // interpretation of pickup.ts. Never both: a 17:00/18:00 row must not also match the next day.
  // The representation is Unknown (operations contract section 2.2).
  date: string;
  addressId: string | null;
};

function parseTimeRecord(row: unknown): ProviderPickupTime | null {
  if (!isRecord(row) || typeof row._id !== "string" || !PROVIDER_TIME_ID.test(row._id) || typeof row.time !== "string") return null;
  const match = /^(\d{1,2}):(\d{2})$/.exec(row.time.trim());
  if (!match || Number(match[2]) !== 0) return null;
  const hour = Number(match[1]);
  if (!PICKUP_SLOT_HOURS.includes(hour)) return null;
  const instant = typeof row.date === "number" || typeof row.date === "string" ? new Date(row.date) : null;
  if (!instant || Number.isNaN(instant.getTime())) return null;
  const utcClock = instant.getUTCHours() === hour && instant.getUTCMinutes() === 0;
  const date = utcClock ? instant.toISOString().slice(0, 10) : wibDate(instant);
  const address = isRecord(row.address) && typeof row.address._id === "string" && AREA_ID.test(row.address._id) ? row.address._id : null;
  return { id: row._id, hour, date, addressId: address };
}
