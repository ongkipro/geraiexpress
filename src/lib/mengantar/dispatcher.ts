// TD-3 / DEC-010: account dispatcher. Runs one real create-order operation, or reconciles one
// whose outcome is unknown, using the machine identity's dispatch_* RPCs. The database owns the
// state machine (claim → in flight → record; one in flight per seller); this module owns the
// provider call. It never resends: an unclear answer is recorded as unknown and reconciled by
// the GeraiExpress reference. Returned summaries carry no key material or recipient data.

import { credentialAad, openCredential } from "../credential-crypto";
import { createMengantarPublicClient, InvalidOrderRequest, MengantarError, ResponseTooLarge, providerPhone, type CreateOrderRequest, type MengantarEnvironment, type MengantarPublicClient, type ProviderOrder } from "./public-api";
import { isPickupVolume, pickupSlotError, type PickupVolume } from "./pickup";

export type Rpc = (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>;

export type DispatcherDeps = {
  rpc: Rpc; // a PostgREST client signed in as the machine identity (service_role)
  environment: MengantarEnvironment;
  credentialKey: string; // CREDENTIAL_KEY / key ring from the container environment
  fetchImpl?: typeof fetch;
  now?: () => Date; // the clock for the pickup lead-time re-check (tests)
};

type Payload = {
  operation_id: string;
  tenant_id: string;
  attempt: number;
  provider_env: MengantarEnvironment | null;
  dispatched_at: string | null;
  reference: string;
  courier: string | null;
  // Frozen from the selected quote's service class; absent on payloads before cargo existed.
  cargo?: boolean;
  pickup_address_id: string | null;
  pickup_area_id: string | null;
  recipient: { area_id: string | null; address: string | null; name: string | null; phone: string | null };
  weight_grams: number | null;
  billable_weight_grams?: number | null; // Frozen at confirmation; null only for legacy quotes.
  item_description: string | null;
  goods_value_idr: number | null;
  is_cod?: boolean;
  cod_amount_idr?: number | null;
  // T-043: the handover frozen at confirmation (pickup_snapshot) and the reservation phase of this
  // operation. A payload without `handover` (confirmed before pickup existed) is drop-off.
  operation_state?: string;
  handover?: "dropoff" | "pickup";
  pickup_date?: string | null;
  pickup_slot_hour?: number | null;
  pickup_volume?: string | null;
  pickup_phase?: "reserving" | "reserved" | "creating" | null;
  pickup_time_id?: string | null;
  credential: { ciphertext: string; iv: string; key_version: string; version: number } | null;
  // T-110: the operation was queued when the post-restore fence was cleared. A claim checks Mengantar
  // for an order with this reference (created since `created_at`) before any create; reconciliation of
  // such an operation scans from `created_at` too, because its pre-restore attempt predates `dispatched_at`.
  restore_check_required?: boolean;
  created_at?: string;
};

type BatchMember = {
  operation_id: string;
  shipment_id: string;
  reference: string;
  provider_order_id: string;
  customer_charge_idr: number | null;
};

// Both claim modes carry the attempt id every later call is fenced to. "pay" is a fresh claim that
// consumed an authorization; "reconcile" means an earlier attempt for this batch is unresolved
// (sent/unknown): nothing may be paid again, the original is only reconciled by per-order reads.
type BatchPaymentClaim = {
  mode: "pay" | "reconcile";
  attempt_id: string;
  claim_operation_id: string;
  tenant_id: string;
  provider_env: MengantarEnvironment | null;
  // Two different provider identifiers: the batch code (GET /order filter) and the batch object id
  // (the pay-unpaid request field). batch_id may be null for operations recorded before it was kept.
  batch: string | null;
  batch_id: string | null;
  courier: string | null;
  batch_digest: string;
  members: BatchMember[];
  credential: { ciphertext: string; iv: string; key_version: string; version: number } | null;
};

export type DispatchSummary =
  | { status: "not_claimed" | "not_reconcilable"; reason: string; detail?: string }
  // priceMismatch: Mengantar's price differs from the customer charge (a shipment event too);
  // priceUnknown: the order's price was not readable, so it could not be compared.
  | { status: "recorded"; outcome: string; priceMismatch?: true; priceUnknown?: true }
  // The provider effect may have happened but the result could not be stored: the operation stays
  // in flight and is reconciled once stale.
  | { status: "record_failed"; outcome: string }
  | { status: "inconclusive"; reason: string };


async function sellerClient(p: Pick<Payload, "tenant_id" | "credential">, deps: DispatcherDeps) {
  if (!p.credential) return null;
  try {
    const apiKey = await openCredential(p.credential, credentialAad(p.tenant_id, p.credential.version), deps.credentialKey);
    return createMengantarPublicClient(deps.environment, apiKey, deps.fetchImpl);
  } catch {
    return null;
  }
}

function orderRequest(p: Payload): CreateOrderRequest | null {
  const phone = providerPhone(p.recipient.phone);
  if (!p.courier || !p.pickup_address_id || !p.pickup_area_id || !p.recipient.area_id || !p.recipient.address || !p.recipient.name
    || !phone || !p.weight_grams || !p.item_description || !p.goods_value_idr) return null;
  const base = {
    courier: p.courier,
    pickupAddressId: p.pickup_address_id,
    reference: p.reference,
    recipient: { areaId: p.recipient.area_id, address: p.recipient.address, name: p.recipient.name, phone },
    weightGrams: p.billable_weight_grams ?? p.weight_grams,
    quantity: 1,
    parcelContent: p.item_description.slice(0, 100),
    ...(p.cargo === true ? { cargo: true } : {}),
  };
  if (p.is_cod) {
    if (!p.cod_amount_idr || p.cod_amount_idr < 1000 || p.goods_value_idr < 1000) return null;
    return { ...base, codAmount: p.cod_amount_idr };
  }
  return { ...base, goodsValue: p.goods_value_idr };
}

type Recorder = (outcome: string, extra?: Record<string, unknown>) => Promise<DispatchSummary>;

// T-043 / TD-12: everything a pickup shipment needs before its order may be sent. Returns the
// order's pickup block, or the summary that ends this call. Three provider-visible steps, each
// with its own write-ahead state so none is ever sent twice:
//   1. GET /time (read-only) proves the account answers; nothing is changed if it does not. The
//      list has no documented filter or paging, so a body over the response cap still counts as an
//      answer (the account is reachable, the history is merely long); only reconciliation needs rows;
//   2. phase 'reserving' is stored, then POST /time once; its answer is stored as 'reserved';
//   3. phase 'creating' is stored (dispatch_pickup_begin_create) right before the caller sends
//      POST /order, which is allowed only once and only from a recorded reservation.
// A lost POST /time answer is recorded as unknown (reconcileOperation reads it back); a refused
// reservation stops for renewed review (rejected, reopenable); no step is retried here.
async function preparePickup(p: Payload, request: CreateOrderRequest, client: MengantarPublicClient, deps: DispatcherDeps, record: Recorder): Promise<DispatchSummary | { timeId: string; volume: PickupVolume }> {
  const call = { p_operation: p.operation_id, p_attempt: p.attempt };
  const release = async (reason: string): Promise<DispatchSummary> => {
    const { error } = await deps.rpc("dispatch_release", call);
    return error ? { status: "record_failed", outcome: "released" } : { status: "not_claimed", reason };
  };
  const date = p.pickup_date ?? null;
  const hour = p.pickup_slot_hour ?? null;
  const volume = p.pickup_volume ?? null;
  if (!date || hour === null || !volume || !isPickupVolume(volume)) return record("rejected", { p_code: "INPUT_INCOMPLETE" });
  // A queued order can wait past its slot's lead time: refuse locally, before any provider call.
  const lead = pickupSlotError(date, hour, (deps.now ?? (() => new Date()))());
  if (lead !== null && lead !== "too_far") return record("rejected", { p_code: "PICKUP_TIME_INVALID" });

  let timeId = p.pickup_time_id ?? null;
  if (p.pickup_phase === null || p.pickup_phase === undefined) {
    try {
      await client.listPickupTimes();
    } catch (error) {
      if (!(error instanceof ResponseTooLarge)) return release("mengantar_unavailable");
    }
    // T-056: the time ids the tenant's other operations already hold, read after the pre-check and
    // before anything is reserved; unreadable => nothing is sent. A sibling that has reserved but not
    // yet stored its id is not visible here (a documented remaining window, see the check below).
    const known = await deps.rpc("dispatch_pickup_known_time_ids", { p_operation: p.operation_id });
    if (known.error || !Array.isArray(known.data)) return release("pickup_known_ids_unavailable");
    const held = new Set(known.data.filter((id): id is string => typeof id === "string"));
    // Write-ahead: no reservation is requested unless the database holds the phase first.
    if ((await deps.rpc("dispatch_pickup_begin_reservation", call)).error) return release("pickup_reservation_not_recorded");
    try {
      timeId = (await client.reservePickupTime({ addressId: request.pickupAddressId, date, hour })).timeId;
    } catch (error) {
      if (error instanceof MengantarError && error.code === "rejected") {
        // "invalid pickup time" is the documented refusal text; any other plain refusal means the
        // slot cannot be had. Both created nothing.
        return record("rejected", {
          p_code: /invalid pickup time/i.test(error.providerMessage ?? "") ? "PICKUP_TIME_INVALID" : "PICKUP_SLOT_UNAVAILABLE",
          ...(error.providerMessage ? { p_detail: error.providerMessage } : {}),
        });
      }
      if (error instanceof MengantarError && error.code === "not_allowed") return record("rejected", { p_code: "NOT_ALLOWED" });
      if (error instanceof InvalidOrderRequest) return record("rejected", { p_code: "INPUT_INVALID" });
      // Timeout, 5xx or an answer that does not match the request: the reservation may exist.
      return record("unknown", { p_code: "PICKUP_RESERVATION_UNKNOWN" });
    }
    // An id another operation of this tenant already holds is never adopted: the order is not sent and
    // the outcome stays Unknown until reconciliation reads GET /time back (excluding held ids).
    if (held.has(timeId)) return record("unknown", { p_code: "PICKUP_TIME_ID_HELD" });
    // The reservation exists at Mengantar. If it cannot be stored the operation stays in flight in
    // phase 'reserving' and is reconciled by reading GET /time back; POST /time is never repeated.
    if ((await deps.rpc("dispatch_pickup_record_reservation", { ...call, p_time_id: timeId })).error) {
      return { status: "record_failed", outcome: "reserved" };
    }
  } else if (p.pickup_phase !== "reserved" || !timeId) {
    // 'reserving' or 'creating' cannot be claimed again; only reconciliation resolves them.
    return { status: "inconclusive", reason: "pickup_phase_unexpected" };
  }
  // Write-ahead for the order. From 'reserved' nothing was sent yet, so a failure here may release.
  if ((await deps.rpc("dispatch_pickup_begin_create", call)).error) return release("pickup_create_not_recorded");
  return { timeId, volume };
}

export async function dispatchOperation(operationId: string, deps: DispatcherDeps): Promise<DispatchSummary> {
  const claim = await deps.rpc("dispatch_claim", { p_operation: operationId, p_env: deps.environment });
  if (claim.error) return { status: "not_claimed", reason: claim.error.message };
  // Waited too long in the queue: the database failed it (reopenable) without sending anything.
  if ((claim.data as { stale?: boolean }).stale) return { status: "recorded", outcome: "quote_stale" };
  const p = claim.data as Payload;
  const record = (outcome: string, extra: Record<string, unknown> = {}) => recordResult(deps, operationId, p.attempt, outcome, extra);

  // A key that cannot be opened (missing, or a wrong CREDENTIAL_KEY deploy) is our problem, not
  // the shipment's: nothing was sent, so the operation goes back to the queue.
  const client = await sellerClient(p, deps);
  if (!client) {
    const { error } = await deps.rpc("dispatch_release", { p_operation: operationId, p_attempt: p.attempt });
    return error ? { status: "record_failed", outcome: "released" } : { status: "not_claimed", reason: "credential_unavailable" };
  }
  // T-110 / TD-3: a queued operation that survived a database restore may already exist at Mengantar.
  // Checked before every other path, including the local refusals below: a refusal of an order that
  // exists would make the shipment reopenable and lead to a second order.
  if (p.restore_check_required === true) {
    const checked = await restoreCheck(p, client, deps, record);
    if (checked !== null) return checked;
  }
  // Nothing is sent when the request cannot be built: a truthful local refusal.
  const request = orderRequest(p);
  if (!request) return record("rejected", { p_code: "INPUT_INCOMPLETE" });

  // The CONFIRMED pickup must still exist in this seller's account. A deleted address stops for
  // renewed review, never silently substitutes the outlet's current pickup or resends an order.
  try {
    const pickups = await client.listPickupAddresses();
    if (!pickups.some((a) => a.id === request.pickupAddressId && a.areaId === p.pickup_area_id)) {
      return record("rejected", { p_code: "PICKUP_NOT_FOUND" });
    }
  } catch {
    const { error } = await deps.rpc("dispatch_release", { p_operation: operationId, p_attempt: p.attempt });
    return error ? { status: "record_failed", outcome: "released" } : { status: "not_claimed", reason: "mengantar_unavailable" };
  }


  let order: CreateOrderRequest = request;
  if (p.handover === "pickup") {
    const prepared = await preparePickup(p, request, client, deps, record);
    if ("status" in prepared) return prepared;
    order = { ...request, pickup: prepared };
  }

  try {
    const result = await client.createOrder(order);
    if (result.outcome === "issued") {
      return record("issued", { p_order_id: result.orderId, p_tracking: result.trackingNumber, p_batch: result.batch, p_price: result.tariffWithFees, ...batchIdArg(result.batchId) });
    }
    if (result.outcome === "unpaid") return record("unpaid", { p_order_id: result.orderId, p_batch: result.batch, p_price: result.tariffWithFees, ...batchIdArg(result.batchId) });
    return record("failed", { p_batch: result.batch, p_record_id: result.providerRecordId, p_code: "PROVIDER_ERROR_ITEM", ...batchIdArg(result.batchId) });
  } catch (error) {
    if (error instanceof MengantarError) {
      if (error.code === "rejected") {
        return record("rejected", {
          p_code: "PROVIDER_REJECTED",
          ...(error.providerMessage ? { p_detail: error.providerMessage } : {}),
        });
      }
      if (error.code === "not_allowed") return record("rejected", { p_code: "NOT_ALLOWED" });
      return record("unknown", { p_code: "UNKNOWN_OUTCOME" });
    }
    // Local validation in the adapter runs before any request.
    if (error instanceof InvalidOrderRequest) return record("rejected", { p_code: "INPUT_INVALID" });
    return record("unknown", { p_code: "UNKNOWN_OUTCOME" });
  }
}

// One live order found for our reference: recorded exactly as reconciliation records it (never created).
async function recordFoundOrder(m: ProviderOrder, p: Pick<Payload, "cargo">, record: Recorder): Promise<DispatchSummary> {
  if (!m.orderId || !m.batch) return { status: "inconclusive", reason: "incomplete_order" };
  // The found order must be the confirmed service: a regular order never settles a cargo quote.
  if (m.cargo !== undefined && m.cargo !== (p.cargo === true)) return { status: "inconclusive", reason: "service_mismatch" };
  if (m.paid && m.trackingNumber) return record("issued", { p_order_id: m.orderId, p_tracking: m.trackingNumber, p_batch: m.batch, p_code: "RECONCILED", p_price: m.price, ...batchIdArg(m.batchId) });
  if (!m.paid && !m.trackingNumber) return record("unpaid", { p_order_id: m.orderId, p_batch: m.batch, p_code: "RECONCILED", p_price: m.price, ...batchIdArg(m.batchId) });
  return { status: "inconclusive", reason: "incomplete_order" };
}

// T-110 / DR-1: the read-only lookup before the first create of a restore-check operation. Returns null
// only when Mengantar provably has no order for this reference (the flag is cleared; the caller creates
// once). Every other outcome ends this call WITHOUT a create: exactly one live order is recorded as found;
// several are recorded as unknown (reconciliation/manual review); a lookup that fails or times out, the
// quota or the fence, or a flag that could not be cleared gives the claim back with the flag kept.
async function restoreCheck(p: Payload, client: MengantarPublicClient, deps: DispatcherDeps, record: Recorder): Promise<DispatchSummary | null> {
  const release = async (reason: string): Promise<DispatchSummary> => {
    const { error } = await deps.rpc("dispatch_release", { p_operation: p.operation_id, p_attempt: p.attempt });
    return error ? { status: "record_failed", outcome: "released" } : { status: "not_claimed", reason };
  };
  const since = p.created_at ? new Date(p.created_at) : null;
  if (!p.courier || !since || !Number.isFinite(since.getTime())) return release("restore_check_pending");
  let matches: ProviderOrder[];
  try {
    matches = await client.findOrdersByReference({ reference: p.reference, courier: p.courier, notBefore: since });
  } catch {
    return release("restore_check_pending");
  }
  const live = matches.filter((m) => m.status !== "error");
  if (live.length > 1) return record("unknown", { p_code: "DUPLICATE_ORDERS" });
  if (live.length === 1) return recordFoundOrder(live[0], p, record);
  // Error items mean an earlier attempt reached Mengantar; reconciliation decides, never a new create.
  if (matches.length > 0) return record("unknown", { p_code: "RESTORE_CHECK_ERROR_ITEM" });
  const passed = await deps.rpc("dispatch_restore_check_passed", { p_operation: p.operation_id, p_attempt: p.attempt });
  if (passed.error) return release(passed.error.message === "provider_fence_engaged" ? "provider_fence_engaged" : "restore_check_pending");
  if ((passed.data as { stale?: boolean } | null)?.stale === true) return { status: "recorded", outcome: "quote_stale" };
  return null;
}

export async function reconcileOperation(operationId: string, deps: DispatcherDeps): Promise<DispatchSummary> {
  const begin = await deps.rpc("dispatch_begin_reconcile", { p_operation: operationId, p_env: deps.environment });
  if (begin.error?.message === "provider_env_mismatch") return { status: "inconclusive", reason: "wrong_environment" };
  if (begin.error) return { status: "not_reconcilable", reason: begin.error.message };
  const p = begin.data as Payload;
  // A sandbox order is never looked up in production, or the reverse (the database refuses it too, T-057).
  if (p.provider_env !== deps.environment) return { status: "inconclusive", reason: "wrong_environment" };
  if (!p.courier || !p.dispatched_at) return { status: "inconclusive", reason: "missing_attempt" };
  const client = await sellerClient(p, deps);
  if (!client) return { status: "inconclusive", reason: "credential_unavailable" };
  const record = async (outcome: string, extra: Record<string, unknown> = {}): Promise<DispatchSummary> => {
    const summary = await recordResult(deps, operationId, p.attempt, outcome, extra);
    return summary.status === "record_failed" && summary.reason === "too_early" ? { status: "inconclusive", reason: "too_early" } : summary;
  };

  // T-043: a pickup operation whose create never began (phase 'reserving' or 'reserved') has no
  // order to find by reference. Its reservation is read back (never requested again) and the
  // operation goes back to the queue, which sends the order for the first time.
  if (p.handover === "pickup" && p.operation_state === "unknown" && (p.pickup_phase === "reserving" || p.pickup_phase === "reserved")) {
    return reconcilePickupReservation(p, client, deps, record);
  }

  // T-110: an operation from a restore check may have an order from its pre-restore attempt, older than
  // every later dispatched_at; scanning only from dispatched_at could conclude "not created" (reopenable)
  // and lead to another order. Without a readable created_at nothing is concluded.
  let notBefore = new Date(p.dispatched_at);
  if (p.restore_check_required === true) {
    const created = p.created_at ? new Date(p.created_at) : null;
    if (!created || !Number.isFinite(created.getTime())) return { status: "inconclusive", reason: "missing_attempt" };
    notBefore = created;
  }
  let matches;
  try {
    matches = await client.findOrdersByReference({ reference: p.reference, courier: p.courier, notBefore });
  } catch {
    return { status: "inconclusive", reason: "lookup_failed" };
  }
  const live = matches.filter((m) => m.status !== "error");
  if (live.length > 1) {
    await record("unknown", { p_code: "DUPLICATE_ORDERS" });
    return { status: "inconclusive", reason: "duplicate_orders" };
  }
  if (live.length === 1) return recordFoundOrder(live[0], p, record);
  if (matches.length > 0) return record("failed", { p_code: "PROVIDER_ERROR_ITEM" });
  return record("not_created", { p_code: "NOT_CREATED" });
}

// T-043: reads back a pickup reservation after its answer was lost (phase 'reserving') or after a
// crash between the stored reservation and the order ('reserved'). Nothing is requested: GET /time
// only. Exactly one record for the slot (and for the address, when the row names one) is taken as
// the reservation, ignoring every time id this tenant's other operations already hold (a sibling
// shipment's reservation of the same slot must never be adopted); no record or several leave the
// call inconclusive, and a record that cannot be tied to this address is a risk the provider's own
// create validation then catches (it rejects, the shipment stops for renewed review). The row has no
// owner field in the documented example, so ownership by this shipment is Unverified.
async function reconcilePickupReservation(p: Payload, client: MengantarPublicClient, deps: DispatcherDeps, record: Recorder): Promise<DispatchSummary> {
  const requeue = async (timeId: string | null): Promise<DispatchSummary> => {
    const { error } = await deps.rpc("dispatch_pickup_requeue", {
      p_operation: p.operation_id, p_attempt: p.attempt, ...(timeId ? { p_time_id: timeId } : {}),
    });
    return error ? { status: "inconclusive", reason: "requeue_failed" } : { status: "recorded", outcome: "reservation_confirmed" };
  };
  // The create never began, so the stored reservation stands.
  if (p.pickup_phase === "reserved") return requeue(null);
  const date = p.pickup_date;
  const hour = p.pickup_slot_hour;
  if (!date || hour === null || hour === undefined) return { status: "inconclusive", reason: "missing_attempt" };
  const known = await deps.rpc("dispatch_pickup_known_time_ids", { p_operation: p.operation_id });
  // Without the tenant's known ids a sibling's slot could be adopted: stay unresolved.
  if (known.error || !Array.isArray(known.data)) return { status: "inconclusive", reason: "lookup_failed" };
  const taken = new Set(known.data.filter((id): id is string => typeof id === "string"));
  let times;
  try {
    times = await client.listPickupTimes();
  } catch {
    return { status: "inconclusive", reason: "lookup_failed" };
  }
  const found = times.filter((t) => t.hour === hour && t.date === date && !taken.has(t.id) && (t.addressId === null || t.addressId === p.pickup_address_id));
  if (found.length === 1) return requeue(found[0].id);
  if (found.length > 1) return { status: "inconclusive", reason: "reservation_ambiguous" };
  // No reservation is visible: concluded as "not created" only after the usual waiting period.
  return record("not_created", { p_code: "NOT_CREATED" });
}

// An unpaid order (seller balance was short) gets its resi once the seller pays at Mengantar.
export async function checkPayment(operationId: string, deps: DispatcherDeps): Promise<DispatchSummary> {
  const begin = await deps.rpc("dispatch_begin_payment_check", { p_operation: operationId, p_env: deps.environment });
  if (begin.error?.message === "provider_env_mismatch") return { status: "inconclusive", reason: "wrong_environment" };
  if (begin.error) return { status: "not_reconcilable", reason: begin.error.message };
  const p = begin.data as Payload & { provider_order_id: string | null; provider_batch: string | null };
  if (p.provider_env !== deps.environment) return { status: "inconclusive", reason: "wrong_environment" };
  if (!p.provider_order_id || !p.provider_batch) return { status: "inconclusive", reason: "missing_attempt" };
  const client = await sellerClient(p, deps);
  if (!client) return { status: "inconclusive", reason: "credential_unavailable" };
  let order;
  try {
    order = await client.findOrder(p.provider_order_id);
  } catch {
    return { status: "inconclusive", reason: "lookup_failed" };
  }
  if (!order || !order.paid || !order.trackingNumber) return { status: "inconclusive", reason: "still_unpaid" };
  return recordResult(deps, operationId, p.attempt, "issued", {
    p_order_id: p.provider_order_id, p_tracking: order.trackingNumber, p_batch: p.provider_batch, p_price: order.price, ...batchIdArg(order.batchId),
  });
}

// Reads every member order at Mengantar (authoritative, by ORDER_ID) and records what it says. A
// read that fails, or an order still unpaid, makes the batch "not all paid"; an unpaid read is never
// proof that an earlier payment request had no effect. `complete` is true only when every member
// was read AND recorded; `anyPaid` is true when Mengantar showed at least one member paid.
async function recordBatchMembers(findOrder: (orderId: string) => Promise<ProviderOrder | null>, p: BatchPaymentClaim, deps: DispatcherDeps) {
  let allPaid = true;
  let complete = true;
  let anyPaid = false;
  let priceMismatch = false;
  let priceUnknown = false;
  for (const m of p.members) {
    let order;
    try {
      order = await findOrder(m.provider_order_id);
    } catch {
      allPaid = false;
      complete = false;
      continue;
    }
    const isPaid = Boolean(order && order.paid && order.trackingNumber);
    if (isPaid) anyPaid = true;
    const rec = await deps.rpc("dispatch_record_payment", {
      p_operation: m.operation_id,
      p_order_id: m.provider_order_id,
      p_paid: isPaid,
      p_tracking: isPaid ? order!.trackingNumber : null,
      p_price: order?.price ?? null,
    });
    if (rec.error) complete = false;
    if (rec.error || !isPaid) {
      allPaid = false;
      continue;
    }
    const mismatch = (rec.data as { price_mismatch?: boolean | null } | null)?.price_mismatch;
    if (mismatch === true) priceMismatch = true;
    if (mismatch === null) priceUnknown = true;
  }
  return { allPaid, complete, anyPaid, priceMismatch, priceUnknown };
}

const paidSummary = (r: { priceMismatch: boolean; priceUnknown: boolean }): DispatchSummary => ({
  status: "recorded",
  outcome: "issued",
  ...(r.priceMismatch ? { priceMismatch: true as const } : {}),
  ...(r.priceUnknown ? { priceUnknown: true as const } : {}),
});

// An earlier payment attempt for this batch is unresolved: never POST again. Read each member
// order; when all are paid the original attempt is reconciled (the database re-verifies), otherwise
// it stays blocking until a later read (this action or the payment sweep) finds them paid.
async function reconcileBatchPayment(p: BatchPaymentClaim, deps: DispatcherDeps): Promise<DispatchSummary> {
  if (p.provider_env !== deps.environment) return { status: "inconclusive", reason: "wrong_environment" };
  if (!p.courier || !Array.isArray(p.members) || p.members.length === 0) return { status: "inconclusive", reason: "missing_attempt" };
  const client = await sellerClient(p, deps);
  if (!client) return { status: "inconclusive", reason: "credential_unavailable" };
  const courier = p.courier;
  const read = await recordBatchMembers((id) => client.findOrder(id, courier), p, deps);
  if (!read.allPaid) return { status: "inconclusive", reason: "payment_unresolved" };
  const fin = await deps.rpc("dispatch_finish_batch_payment", { p_attempt: p.attempt_id, p_outcome: "paid" });
  if (fin.error) return { status: "inconclusive", reason: "payment_unresolved" };
  return paidSummary(read);
}

// T-033 / TD-3 / DEC-010: pays an unpaid Mengantar batch. The machine claim consumes the single-use
// authorization a tenant admin gave for this reviewed digest and opens a durable attempt. The
// server verifies that Mengantar's live batch holds only the expected tenant orders, writes the
// attempt as "sent" BEFORE the request, sends POST /order/pay-unpaid at most once (with the batch
// object id, never the code), checks the documented paid count, and reconciles every member by
// ORDER_ID. An unclear outcome leaves the attempt blocking; it is only ever reconciled.
export async function payUnpaidShipmentBatch(
  shipmentId: string,
  batchDigest: string,
  deps: DispatcherDeps,
): Promise<DispatchSummary> {
  const begin = await deps.rpc("dispatch_begin_batch_payment", { p_shipment: shipmentId, p_batch_digest: batchDigest, p_env: deps.environment });
  if (begin.error) return { status: "not_reconcilable", reason: begin.error.message };
  const p = begin.data as BatchPaymentClaim;
  if (p.mode === "reconcile") return reconcileBatchPayment(p, deps);

  // Fenced to this attempt: it frees a claim that sent nothing; once the attempt was marked sent
  // the database ignores a release, so a late or repeated call can never reopen the batch.
  const release = async () => {
    await deps.rpc("dispatch_release_batch_payment", { p_attempt: p.attempt_id });
  };
  // The provider's own paid count (when it answered readably) is recorded with the outcome; the database
  // compares it with the number of orders that were unpaid and audits a difference (T-033 review).
  let providerPaidCount: number | null = null;
  const finish = (outcome: "paid" | "unknown" | "rejected") =>
    deps.rpc("dispatch_finish_batch_payment", {
      p_attempt: p.attempt_id,
      p_outcome: outcome,
      ...(providerPaidCount !== null && outcome !== "rejected" ? { p_paid_count: providerPaidCount } : {}),
    });

  if (p.provider_env !== deps.environment) {
    await release();
    return { status: "inconclusive", reason: "wrong_environment" };
  }
  if (!p.batch || !p.courier || !Array.isArray(p.members) || p.members.length === 0) {
    await release();
    return { status: "inconclusive", reason: "missing_attempt" };
  }
  const courier = p.courier;
  const client = await sellerClient(p, deps);
  if (!client) {
    await release();
    return { status: "inconclusive", reason: "credential_unavailable" };
  }

  let providerOrders;
  try {
    providerOrders = await client.listOrdersByBatch(p.batch, courier);
  } catch {
    await release();
    return { status: "inconclusive", reason: "lookup_failed" };
  }

  const byOrderId = new Map(
    providerOrders
      .filter((o) => o.orderId !== null && o.batch === p.batch)
      .map((o) => [o.orderId as string, o]),
  );
  const scopeMatches = providerOrders.length === p.members.length
    && byOrderId.size === p.members.length
    && p.members.every((m) => {
      const remote = byOrderId.get(m.provider_order_id);
      return Boolean(remote && remote.reference === m.reference);
    });
  if (!scopeMatches) {
    await release();
    return { status: "not_reconcilable", reason: "batch_scope_mismatch" };
  }

  // The payment request carries the batch OBJECT id. A stored id must agree with what Mengantar
  // returns for the batch; a missing one (operation recorded before ids were kept) is taken from
  // the provider's own rows, which must all name the same id.
  const remoteIds = new Set(providerOrders.map((o) => o.batchId).filter((id): id is string => id !== null));
  if (remoteIds.size > 1 || (p.batch_id !== null && remoteIds.size === 1 && !remoteIds.has(p.batch_id))) {
    await release();
    return { status: "not_reconcilable", reason: "batch_scope_mismatch" };
  }
  const batchObjectId = p.batch_id ?? [...remoteIds][0] ?? null;
  if (!batchObjectId) {
    await release();
    return { status: "not_reconcilable", reason: "batch_id_unavailable" };
  }

  // The documented answer carries the number of orders paid; it is compared with the orders that
  // were unpaid when the batch was read (the whole batch in the usual all-unpaid case).
  const unpaidCount = providerOrders.filter((o) => !o.paid || !o.trackingNumber).length;
  let sent = false;
  let countMismatch = false;
  if (unpaidCount > 0) {
    // Write-ahead: nothing is sent unless the database holds the attempt as "sent" first.
    const mark = await deps.rpc("dispatch_mark_batch_payment_sent", { p_attempt: p.attempt_id, p_batch_object_id: batchObjectId });
    if (mark.error) {
      await release();
      return { status: "inconclusive", reason: "attempt_not_recorded" };
    }
    sent = true;
    try {
      const paid = await client.payUnpaidBatch(batchObjectId, courier);
      // A count that disagrees with the batch (or with its own tracking list) is not success.
      providerPaidCount = paid.paidCount;
      countMismatch = paid.paidCount !== unpaidCount || paid.awbs.length !== paid.paidCount;
      if (paid.paidCount === 0 && paid.awbs.length === 0) {
        // A readable "nothing paid" answer (T-053 R2): the per-order reads decide. Only when every member
        // read and recorded cleanly and none is paid is the attempt closed as not applied (payable again).
        const none = await recordBatchMembers((id) => client.findOrder(id, courier), p, deps);
        if (none.allPaid) {
          const fin = await finish("paid");
          if (!fin.error) return paidSummary(none);
          await finish("unknown");
          return { status: "inconclusive", reason: "payment_unconfirmed" };
        }
        if (none.complete && !none.anyPaid) {
          await finish("rejected");
          return { status: "not_reconcilable", reason: "payment_not_applied" };
        }
        await finish("unknown");
        return { status: "inconclusive", reason: "payment_unconfirmed" };
      }
    } catch (error) {
      if (error instanceof MengantarError && (error.code === "rejected" || error.code === "not_allowed")) {
        // A 400/403 is not proof that nothing was paid (an earlier request, or this one, may have
        // been applied before the refusal was answered). The per-order reads decide: "rejected"
        // (final, payable again) only when every member read and recorded cleanly and none is paid.
        const read = await recordBatchMembers((id) => client.findOrder(id, courier), p, deps);
        if (read.allPaid) {
          const fin = await finish("paid");
          if (fin.error) {
            await finish("unknown");
            return { status: "inconclusive", reason: "payment_unconfirmed" };
          }
          return paidSummary(read);
        }
        if (!read.complete || read.anyPaid) {
          await finish("unknown");
          return { status: "inconclusive", reason: "payment_unconfirmed" };
        }
        await finish("rejected");
        return {
          status: "not_reconcilable",
          reason: error.code === "not_allowed" ? "mengantar_key_refused" : "mengantar_refused",
          ...(error.providerMessage ? { detail: error.providerMessage } : {}),
        };
      }
      if (error instanceof InvalidOrderRequest) {
        // Refused locally before any request was made.
        await finish("rejected");
        return { status: "not_reconcilable", reason: error.reason };
      }
      // Timeout / 5xx / unknown outcome: the request may have been applied. Never resend; the
      // per-order reads below decide (a count mismatch is only reported for a readable answer).
    }
  }

  const read = await recordBatchMembers((id) => client.findOrder(id, courier), p, deps);
  if (!sent) {
    // Mengantar already shows every member paid: nothing was requested, so the claim is simply freed.
    await release();
    return read.allPaid ? paidSummary(read) : { status: "inconclusive", reason: "still_unpaid" };
  }
  // Per-order reads are the authority: all paid resolves the attempt (even after an unclear or
  // miscounted answer); anything else leaves it "unknown", which blocks a second payment.
  const fin = await finish(read.allPaid ? "paid" : "unknown");
  if (read.allPaid && !fin.error) return paidSummary(read);
  if (read.allPaid) await finish("unknown");
  return { status: "inconclusive", reason: countMismatch ? "payment_count_mismatch" : "payment_unconfirmed" };
}

async function recordResult(deps: DispatcherDeps, operationId: string, attempt: number, outcome: string,
  extra: Record<string, unknown>): Promise<DispatchSummary & { reason?: string }> {
  const { data, error } = await deps.rpc("dispatch_record", { p_operation: operationId, p_attempt: attempt, p_outcome: outcome, ...extra });
  if (error) return { status: "record_failed", outcome, reason: error.message };
  // price_mismatch: true/false once compared, null when the price was unreadable, absent on a replay.
  const mismatch = (data as { price_mismatch?: boolean | null } | null)?.price_mismatch;
  return { status: "recorded", outcome, ...(mismatch ? { priceMismatch: true as const } : {}), ...(mismatch === null ? { priceUnknown: true as const } : {}) };
}

const batchIdArg = (batchId: string | null) => (batchId ? { p_batch_id: batchId } : {});

export type SweepSummary = {
  checked: number;
  failed?: true;
  results: { action: string; status: string; priceMismatch?: true; priceUnknown?: true }[];
  // Operations past the sweep's re-check windows (visible to monitoring, not only per shipment).
  stuck?: Record<string, number>;
};

// Periodic sweep (scheduler container, every 5 minutes): dispatch queued operations nobody sent, reconcile stale or
// unknown ones, re-check unpaid orders. Bounded per run; every step is safe to repeat.
export async function sweep(deps: DispatcherDeps, limit = 20): Promise<SweepSummary> {
  const { data, error } = await deps.rpc("dispatch_due", { p_limit: limit, p_env: deps.environment });
  // A failing due-list query is reported, not mistaken for "nothing to do".
  if (error || !Array.isArray(data)) return { checked: 0, failed: true, results: [] };
  const results: SweepSummary["results"] = [];
  for (const row of data as { operation_id: string; action: string }[]) {
    const run = row.action === "dispatch" ? dispatchOperation : row.action === "payment" ? checkPayment : reconcileOperation;
    try {
      const summary = await run(row.operation_id, deps);
      results.push({
        action: row.action, status: summary.status,
        ...("priceMismatch" in summary && summary.priceMismatch ? { priceMismatch: true as const } : {}),
        ...("priceUnknown" in summary && summary.priceUnknown ? { priceUnknown: true as const } : {}),
      });
    } catch {
      results.push({ action: row.action, status: "error" });
    }
  }
  const stuck = await deps.rpc("dispatch_stuck_counts", {});
  return { checked: results.length, results, ...(stuck.error ? {} : { stuck: stuck.data as Record<string, number> }) };
}

