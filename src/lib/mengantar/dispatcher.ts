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
  credential: { ciphertext: string; iv: string; key_version: string; version: number } | null;
};

export type DispatchSummary =
  | { status: "not_claimed" | "not_reconcilable"; reason: string }
  | { status: "recorded"; outcome: string }
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

async function sellerClient(p: Payload, deps: DispatcherDeps) {
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
  // lazy: COD shipments need a COD amount on the shipment (T-024); until then every real order is
  // non-COD with the declared goods value.
  return {
    courier: p.courier,
    pickupAddressId: p.pickup_address_id,
    reference: p.reference,
    recipient: { areaId: p.recipient.area_id, address: p.recipient.address, name: p.recipient.name, phone },
    weightGrams: p.weight_grams,
    quantity: 1,
    parcelContent: p.item_description.slice(0, 100),
    goodsValue: p.goods_value_idr,
  };
}

export async function dispatchOperation(operationId: string, deps: DispatcherDeps): Promise<DispatchSummary> {
  const claim = await deps.rpc("dispatch_claim", { p_operation: operationId, p_env: deps.environment });
  if (claim.error) return { status: "not_claimed", reason: claim.error.message };
  const p = claim.data as Payload;
  const record = async (outcome: string, extra: Record<string, unknown> = {}): Promise<DispatchSummary> => {
    const { error } = await deps.rpc("dispatch_record", { p_operation: operationId, p_attempt: p.attempt, p_outcome: outcome, ...extra });
    return error ? { status: "record_failed", outcome } : { status: "recorded", outcome };
  };

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

  try {
    const result = await client.createOrder(request);
    if (result.outcome === "issued") {
      return record("issued", { p_order_id: result.orderId, p_tracking: result.trackingNumber, p_batch: result.batch });
    }
    if (result.outcome === "unpaid") return record("unpaid", { p_order_id: result.orderId, p_batch: result.batch });
    return record("failed", { p_batch: result.batch, p_record_id: result.providerRecordId, p_code: "PROVIDER_ERROR_ITEM" });
  } catch (error) {
    if (error instanceof MengantarError) {
      if (error.code === "rejected") return record("rejected", { p_code: "PROVIDER_REJECTED" });
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
    const { error } = await deps.rpc("dispatch_record", { p_operation: operationId, p_attempt: p.attempt, p_outcome: outcome, ...extra });
    if (error?.message === "too_early") return { status: "inconclusive", reason: "too_early" };
    return error ? { status: "record_failed", outcome } : { status: "recorded", outcome };
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
    if (m.paid && m.trackingNumber) return record("issued", { p_order_id: m.orderId, p_tracking: m.trackingNumber, p_batch: m.batch, p_code: "RECONCILED" });
    if (!m.paid && !m.trackingNumber) return record("unpaid", { p_order_id: m.orderId, p_batch: m.batch, p_code: "RECONCILED" });
    return { status: "inconclusive", reason: "incomplete_order" };
  }
  if (matches.length > 0) return record("failed", { p_code: "PROVIDER_ERROR_ITEM" });
  return record("not_created", { p_code: "NOT_CREATED" });
}
