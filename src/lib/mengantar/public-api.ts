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
export const OFFERED_COURIERS = new Set(Object.values(COURIERS));

// Couriers seen refusing drop-off orders (sandbox, T-020: anteraja). GeraiExpress dispatches
// drop-off only, so these are not offered.
// lazy: one sandbox observation; replace with a per-outlet pickup mode once scheduled pickup exists.
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
      return judgeCreatedItem(items[0], request.reference);
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
      if (!BATCH_ID.test(batch) || !OFFERED_COURIERS.has(courier)) {
        throw new InvalidOrderRequest();
      }
      const rows = await listOrders({ batch, courier, page: "1", size: "100" });
      return rows.filter((o) => o.batch === batch && o.status !== "error");
    },

    // Pays an unpaid Mengantar batch from the seller's wallet balance (TD-3, T-026).
    // Array order in `awbs` does not prove shipment-to-AWB mapping; callers reconcile each order via findOrder.
    async payUnpaidBatch(batchId: string, courier: string): Promise<PayUnpaidResult> {
      if (typeof courier === "string" && courier.trim().toLowerCase() === "ninja") {
        throw new InvalidOrderRequest("courier_discontinued");
      }
      if (!BATCH_ID.test(batchId) || !OFFERED_COURIERS.has(courier)) {
        throw new InvalidOrderRequest();
      }
      const { status, payload } = await send("/order/pay-unpaid", {}, { batch_id: batchId, courier });
      if (status === 400 && payload.success === false && !Array.isArray(payload.data)) {
        throw new MengantarError("rejected", text(payload.message).slice(0, 200) || null);
      }
      if (status !== 200 || payload.success !== true) {
        throw new MengantarError("unknown_outcome");
      }
      const d = isRecord(payload.data) ? payload.data : payload;
      let rawAwbs: string[] | null = null;
      if (Array.isArray(d.awbs) && d.awbs.every((x) => typeof x === "string")) {
        rawAwbs = d.awbs;
      } else if (Array.isArray(d.awb) && d.awb.every((x) => typeof x === "string")) {
        rawAwbs = d.awb;
      } else if (Array.isArray(d.cnote_no) && d.cnote_no.every((x) => typeof x === "string")) {
        rawAwbs = d.cnote_no;
      } else if (Array.isArray(payload.data)) {
        if (payload.data.every((x) => typeof x === "string")) {
          rawAwbs = payload.data as string[];
        } else if (payload.data.every((x) => isRecord(x))) {
          rawAwbs = (payload.data as Record<string, unknown>[])
            .map((x) => (typeof x.cnote_no === "string" ? x.cnote_no : typeof x.awb === "string" ? x.awb : ""))
            .filter(Boolean);
        }
      }
      const rawCount = money(d.count ?? d.paidCount ?? d.paid_count ?? (rawAwbs ? rawAwbs.length : null));
      if (rawCount === null || !rawAwbs) {
        throw new MengantarError("unknown_outcome");
      }
      return { paidCount: rawCount, awbs: rawAwbs.map((x) => x.trim()).filter(Boolean) };
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

// --- Orders (T-021 / T-025 / T-026) -----------------------------------------------------------

const ORDER_ID = /^[A-Z0-9]{6,20}$/;
const BATCH_ID = /^[A-Z0-9]{6,24}$/;
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
// couriers, at most 4 calls) and extracts each courier's codFee and netShipping from that second
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
      pass2ByTariff.set(tariff, new Map(rows.map((r) => [r.courier, r])));
    }),
  );

  const resolved: CourierEstimate[] = [];
  for (const row of pass1) {
    const pass2Row = pass2ByTariff.get(row.tariff)?.get(row.courier);
    if (!pass2Row || pass2Row.tariff !== row.tariff || pass2Row.codFee < 0) continue;
    resolved.push({
      courier: row.courier,
      tariff: row.tariff,
      codFee: pass2Row.codFee,
      netShipping: pass2Row.netShipping,
      etaText: pass2Row.etaText ?? row.etaText,
    });
  }
  return resolved.sort((a, b) => (a.tariff + a.codFee) - (b.tariff + b.codFee) || (a.courier < b.courier ? -1 : a.courier > b.courier ? 1 : 0));
}

export type CreateOrderRequest = {
  courier: string;
  // Only drop-off is offered for now; scheduled pickup needs time slots (GET /time returned none).
  pickupAddressId: string;
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
  | { outcome: "issued"; orderId: string; trackingNumber: string; batch: string; tariffWithFees: number | null }
  // Created but not paid (insufficient balance): no resi yet; payment is a batch command (TD-3).
  | { outcome: "unpaid"; orderId: string; batch: string; tariffWithFees: number | null }
  // Mengantar recorded the attempt as an error item without ORDER_ID or resi. The provider keeps
  // that record (with a batch), so before creating again the dispatcher must confirm the batch
  // still holds only an error item.
  // lazy: evidence is one sandbox JNE sample; whether an error item can later be completed at
  // Mengantar is not established.
  | { outcome: "failed"; batch: string | null; providerRecordId: string | null };

export type ProviderOrder = {
  orderId: string | null;
  batch: string | null;
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
  const courierOk = OFFERED_COURIERS.has(r.courier);
  const { areaId, address, name, phone } = r.recipient ?? ({} as CreateOrderRequest["recipient"]);
  const money = (v: unknown) => typeof v === "number" && Number.isSafeInteger(v) && v >= 1;
  const valid = courierOk
    && AREA_ID.test(r.pickupAddressId) && AREA_ID.test(areaId ?? "")
    && REFERENCE.test(r.reference)
    && typeof name === "string" && name.trim().length >= 1 && name.length <= 100
    && typeof address === "string" && address.trim().length >= 5 && address.length <= 300
    && typeof phone === "string" && /^\d{10,15}$/.test(phone)
    && Number.isInteger(r.weightGrams) && r.weightGrams >= 1 && r.weightGrams <= 1_000_000
    && Number.isInteger(r.quantity) && r.quantity >= 1 && r.quantity <= 1000
    && typeof r.parcelContent === "string" && r.parcelContent.trim().length >= 1 && r.parcelContent.length <= 100
    && (r.goodsValue === undefined) !== (r.codAmount === undefined)
    && (r.goodsValue === undefined || money(r.goodsValue)) && (r.codAmount === undefined || money(r.codAmount));
  if (!valid) throw new InvalidOrderRequest();
  return {
    courier: r.courier,
    pickup: { address_id: r.pickupAddressId, type: "dropOff" },
    orders: [{
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

function judgeCreatedItem(item: unknown, reference: string): CreateOrderResult {
  if (!isRecord(item)) throw new MengantarError("unknown_outcome");
  if (item.status === "error") {
    // An error item must not carry a shipment identity; if it does, the outcome is unclear.
    if (item.ORDER_ID || item.cnote_no) throw new MengantarError("unknown_outcome");
    return {
      outcome: "failed",
      batch: typeof item.batch === "string" && /^[A-Z0-9]{6,24}$/.test(item.batch) ? item.batch : null,
      providerRecordId: typeof item._id === "string" && AREA_ID.test(item._id) ? item._id : null,
    };
  }
  const orderId = typeof item.ORDER_ID === "string" && ORDER_ID.test(item.ORDER_ID) ? item.ORDER_ID : null;
  const batch = typeof item.batch === "string" && /^[A-Z0-9]{6,24}$/.test(item.batch) ? item.batch : null;
  if (!orderId || !batch || item.status !== "active" || item.destinationMark !== reference) throw new MengantarError("unknown_outcome");
  const tracking = typeof item.cnote_no === "string" && /^[A-Za-z0-9-]{6,40}$/.test(item.cnote_no) ? item.cnote_no : null;
  const price = typeof item.estimatedPrice === "number" && Number.isSafeInteger(item.estimatedPrice) && item.estimatedPrice > 0 ? item.estimatedPrice : null;
  if (item.isPaid === true && tracking) return { outcome: "issued", orderId, trackingNumber: tracking, batch, tariffWithFees: price };
  if (item.isPaid === false && (item.cnote_no === null || item.cnote_no === undefined)) return { outcome: "unpaid", orderId, batch, tariffWithFees: price };
  throw new MengantarError("unknown_outcome");
}

function parseOrder(row: unknown): ProviderOrder {
  if (!isRecord(row) || typeof row.status !== "string" || typeof row.createdAt !== "string" || Number.isNaN(Date.parse(row.createdAt))) {
    throw new MengantarError("malformed");
  }
  const orderId = typeof row.ORDER_ID === "string" && ORDER_ID.test(row.ORDER_ID) ? row.ORDER_ID : null;
  const reference = typeof row.destinationMark === "string" && REFERENCE.test(row.destinationMark) ? row.destinationMark : null;
  const trackingNumber = typeof row.cnote_no === "string" && row.cnote_no ? row.cnote_no.slice(0, 40) : null;
  const batch = typeof row.batch === "string" && /^[A-Z0-9]{6,24}$/.test(row.batch) ? row.batch : null;
  const price = typeof row.estimatedPrice === "number" && Number.isSafeInteger(row.estimatedPrice) && row.estimatedPrice > 0 ? row.estimatedPrice : null;
  return { orderId, batch, price, reference, trackingNumber, status: row.status.slice(0, 40), paid: row.isPaid === true, createdAt: row.createdAt };
}
