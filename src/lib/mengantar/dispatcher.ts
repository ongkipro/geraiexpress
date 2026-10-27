// TD-3 / DEC-010: account dispatcher. Runs one real create-order operation, or reconciles one
// whose outcome is unknown, using the machine identity's dispatch_* RPCs. The database owns the
// state machine (claim → in flight → record; one in flight per seller); this module owns the
// provider call. It never resends: an unclear answer is recorded as unknown and reconciled by
// the GeraiExpress reference. Returned summaries carry no key material or recipient data.

import { credentialAad, openCredential } from "../credential-crypto";
import { createMengantarPublicClient, InvalidOrderRequest, MengantarError, type CreateOrderRequest, type MengantarEnvironment } from "./public-api";

export type Rpc = (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>;

export type DispatcherDeps = {
  rpc: Rpc; // a Supabase client signed in as the machine identity (service_role)
  environment: MengantarEnvironment;
  credentialKey: string; // CREDENTIAL_KEY Worker secret
  fetchImpl?: typeof fetch;
};

type Payload = {
  operation_id: string;
  tenant_id: string;
  attempt: number;
  provider_env: MengantarEnvironment | null;
  dispatched_at: string | null;
  reference: string;
  courier: string | null;
  pickup_address_id: string | null;
  recipient: { area_id: string | null; address: string | null; name: string | null; phone: string | null };
  weight_grams: number | null;
  item_description: string | null;
  goods_value_idr: number | null;
  is_cod?: boolean;
  cod_amount_idr?: number | null;
  credential: { ciphertext: string; iv: string; key_version: string; version: number } | null;
};

type BatchMember = {
  operation_id: string;
  shipment_id: string;
  reference: string;
  provider_order_id: string;
  customer_charge_idr: number | null;
};

type BatchPaymentClaim = {
  claim_operation_id: string;
  tenant_id: string;
  provider_env: MengantarEnvironment | null;
  batch: string | null;
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

// Indonesian mobile numbers as Mengantar expects them: digits only, local 0 prefix.
export function providerPhone(phone: string | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/^\+/, "");
  const local = digits.startsWith("62") ? `0${digits.slice(2)}` : digits;
  return /^0\d{9,14}$/.test(local) ? local : null;
}

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
  if (!p.courier || !p.pickup_address_id || !p.recipient.area_id || !p.recipient.address || !p.recipient.name
    || !phone || !p.weight_grams || !p.item_description || !p.goods_value_idr) return null;
  const base = {
    courier: p.courier,
    pickupAddressId: p.pickup_address_id,
    reference: p.reference,
    recipient: { areaId: p.recipient.area_id, address: p.recipient.address, name: p.recipient.name, phone },
    weightGrams: p.weight_grams,
    quantity: 1,
    parcelContent: p.item_description.slice(0, 100),
  };
  if (p.is_cod) {
    if (!p.cod_amount_idr || p.cod_amount_idr < 1000 || p.goods_value_idr < 1000) return null;
    return { ...base, codAmount: p.cod_amount_idr };
  }
  return { ...base, goodsValue: p.goods_value_idr };
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
  // Nothing is sent when the request cannot be built: a truthful local refusal.
  const request = orderRequest(p);
  if (!request) return record("rejected", { p_code: "INPUT_INCOMPLETE" });

  // The outlet's pickup must still exist in this seller's account (the admin RPC trusts its
  // caller, and an address can be deleted at Mengantar). A failed check sent nothing: release.
  try {
    const pickups = await client.listPickupAddresses();
    if (!pickups.some((a) => a.id === request.pickupAddressId)) return record("rejected", { p_code: "PICKUP_NOT_FOUND" });
  } catch {
    const { error } = await deps.rpc("dispatch_release", { p_operation: operationId, p_attempt: p.attempt });
    return error ? { status: "record_failed", outcome: "released" } : { status: "not_claimed", reason: "mengantar_unavailable" };
  }

  try {
    const result = await client.createOrder(request);
    if (result.outcome === "issued") {
      return record("issued", { p_order_id: result.orderId, p_tracking: result.trackingNumber, p_batch: result.batch, p_price: result.tariffWithFees });
    }
    if (result.outcome === "unpaid") return record("unpaid", { p_order_id: result.orderId, p_batch: result.batch, p_price: result.tariffWithFees });
    return record("failed", { p_batch: result.batch, p_record_id: result.providerRecordId, p_code: "PROVIDER_ERROR_ITEM" });
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

export async function reconcileOperation(operationId: string, deps: DispatcherDeps): Promise<DispatchSummary> {
  const begin = await deps.rpc("dispatch_begin_reconcile", { p_operation: operationId });
  if (begin.error) return { status: "not_reconcilable", reason: begin.error.message };
  const p = begin.data as Payload;
  // A sandbox order is never looked up in production, or the reverse.
  if (p.provider_env !== deps.environment) return { status: "inconclusive", reason: "wrong_environment" };
  if (!p.courier || !p.dispatched_at) return { status: "inconclusive", reason: "missing_attempt" };
  const client = await sellerClient(p, deps);
  if (!client) return { status: "inconclusive", reason: "credential_unavailable" };
  const record = async (outcome: string, extra: Record<string, unknown> = {}): Promise<DispatchSummary> => {
    const summary = await recordResult(deps, operationId, p.attempt, outcome, extra);
    return summary.status === "record_failed" && summary.reason === "too_early" ? { status: "inconclusive", reason: "too_early" } : summary;
  };

  let matches;
  try {
    matches = await client.findOrdersByReference({ reference: p.reference, courier: p.courier, notBefore: new Date(p.dispatched_at) });
  } catch {
    return { status: "inconclusive", reason: "lookup_failed" };
  }
  const live = matches.filter((m) => m.status !== "error");
  if (live.length > 1) {
    await record("unknown", { p_code: "DUPLICATE_ORDERS" });
    return { status: "inconclusive", reason: "duplicate_orders" };
  }
  if (live.length === 1) {
    const m = live[0];
    if (!m.orderId || !m.batch) return { status: "inconclusive", reason: "incomplete_order" };
    if (m.paid && m.trackingNumber) return record("issued", { p_order_id: m.orderId, p_tracking: m.trackingNumber, p_batch: m.batch, p_code: "RECONCILED", p_price: m.price });
    if (!m.paid && !m.trackingNumber) return record("unpaid", { p_order_id: m.orderId, p_batch: m.batch, p_code: "RECONCILED", p_price: m.price });
    return { status: "inconclusive", reason: "incomplete_order" };
  }
  if (matches.length > 0) return record("failed", { p_code: "PROVIDER_ERROR_ITEM" });
  return record("not_created", { p_code: "NOT_CREATED" });
}

// An unpaid order (seller balance was short) gets its resi once the seller pays at Mengantar.
export async function checkPayment(operationId: string, deps: DispatcherDeps): Promise<DispatchSummary> {
  const begin = await deps.rpc("dispatch_begin_payment_check", { p_operation: operationId });
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
    p_order_id: p.provider_order_id, p_tracking: order.trackingNumber, p_batch: p.provider_batch, p_price: order.price,
  });
}

// T-026 / TD-3: pays an unpaid Mengantar batch after the tenant admin has reviewed its full
// membership, verifies that Mengantar's live batch contains only the expected tenant orders,
// sends POST /order/pay-unpaid once at most, and reconciles every member order by ORDER_ID.
export async function payUnpaidShipmentBatch(
  shipmentId: string,
  batchDigest: string,
  deps: DispatcherDeps,
): Promise<DispatchSummary> {
  const begin = await deps.rpc("dispatch_begin_batch_payment", { p_shipment: shipmentId, p_batch_digest: batchDigest });
  if (begin.error) return { status: "not_reconcilable", reason: begin.error.message };
  const p = begin.data as BatchPaymentClaim;
  const release = async () => {
    await deps.rpc("dispatch_release_batch_payment", { p_claim_operation: p.claim_operation_id });
  };

  if (p.provider_env !== deps.environment) {
    await release();
    return { status: "inconclusive", reason: "wrong_environment" };
  }
  if (!p.batch || !p.courier || !Array.isArray(p.members) || p.members.length === 0) {
    await release();
    return { status: "inconclusive", reason: "missing_attempt" };
  }
  const client = await sellerClient(p, deps);
  if (!client) {
    await release();
    return { status: "inconclusive", reason: "credential_unavailable" };
  }

  let providerOrders;
  try {
    providerOrders = await client.listOrdersByBatch(p.batch, p.courier);
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

  const needsPayment = providerOrders.some((o) => !o.paid || !o.trackingNumber);
  if (needsPayment) {
    try {
      await client.payUnpaidBatch(p.batch, p.courier);
    } catch (error) {
      if (error instanceof MengantarError && (error.code === "rejected" || error.code === "not_allowed")) {
        await release();
        return {
          status: "not_reconcilable",
          reason: error.code === "not_allowed" ? "mengantar_key_refused" : "mengantar_refused",
          ...(error.providerMessage ? { detail: error.providerMessage } : {}),
        };
      }
      if (error instanceof InvalidOrderRequest) {
        await release();
        return { status: "not_reconcilable", reason: error.reason };
      }
      // On timeout / 5xx / unknown_outcome, do not resend pay-unpaid; fall through to findOrder per member.
    }
  }

  let allPaid = true;
  let priceMismatch = false;
  let priceUnknown = false;
  for (const m of p.members) {
    let order;
    try {
      order = await client.findOrder(m.provider_order_id, p.courier);
    } catch {
      allPaid = false;
      continue;
    }
    const isPaid = Boolean(order && order.paid && order.trackingNumber);
    const rec = await deps.rpc("dispatch_record_payment", {
      p_operation: m.operation_id,
      p_order_id: m.provider_order_id,
      p_paid: isPaid,
      p_tracking: isPaid ? order!.trackingNumber : null,
      p_price: order?.price ?? null,
    });
    if (rec.error || !isPaid) {
      allPaid = false;
      continue;
    }
    const mismatch = (rec.data as { price_mismatch?: boolean | null } | null)?.price_mismatch;
    if (mismatch === true) priceMismatch = true;
    if (mismatch === null) priceUnknown = true;
  }

  await release();
  if (!allPaid) return { status: "inconclusive", reason: "still_unpaid" };
  return {
    status: "recorded",
    outcome: "issued",
    ...(priceMismatch ? { priceMismatch: true as const } : {}),
    ...(priceUnknown ? { priceUnknown: true as const } : {}),
  };
}

async function recordResult(deps: DispatcherDeps, operationId: string, attempt: number, outcome: string,
  extra: Record<string, unknown>): Promise<DispatchSummary & { reason?: string }> {
  const { data, error } = await deps.rpc("dispatch_record", { p_operation: operationId, p_attempt: attempt, p_outcome: outcome, ...extra });
  if (error) return { status: "record_failed", outcome, reason: error.message };
  // price_mismatch: true/false once compared, null when the price was unreadable, absent on a replay.
  const mismatch = (data as { price_mismatch?: boolean | null } | null)?.price_mismatch;
  return { status: "recorded", outcome, ...(mismatch ? { priceMismatch: true as const } : {}), ...(mismatch === null ? { priceUnknown: true as const } : {}) };
}

export type SweepSummary = {
  checked: number;
  failed?: true;
  results: { action: string; status: string; priceMismatch?: true; priceUnknown?: true }[];
  // Operations past the sweep's re-check windows (visible to monitoring, not only per shipment).
  stuck?: Record<string, number>;
};

// Periodic sweep (Worker cron): dispatch queued operations nobody sent, reconcile stale or
// unknown ones, re-check unpaid orders. Bounded per run; every step is safe to repeat.
export async function sweep(deps: DispatcherDeps, limit = 20): Promise<SweepSummary> {
  const { data, error } = await deps.rpc("dispatch_due", { p_limit: limit });
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

