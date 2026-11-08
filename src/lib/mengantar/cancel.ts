// T-045 slice 2: cancel one issued shipment with DELETE /order. The DELETE answer is never trusted alone and
// is never repeated: `cancel_begin` (SQL, under the shipment lock) lets exactly one decision send it, records
// 'requested' BEFORE the request, and returns 'readback' (read only, never DELETE again) for any shipment whose
// DELETE was already sent. The outcome is then taken from a read-back of the order (GET /order, same seller key):
//   deleted or a cancelled category        -> cancelled
//   readable, still active, DELETE reported not-deleted or rejected -> refused (stays NOT cancelled)
//   delivered or returned on the read-back -> conflict (never cancelled; the state stays unresolved for a person)
//   anything else (unreadable read-back, DELETE answer unknown, contradiction) -> unknown (nothing concluded)
// The key is the ORIGINAL create_order operation's credential (the version cancel_begin returns), resolved
// in SQL; a replaced BYOK key is never used, so no provider request is made with it.
// The refund of DELETE /order is unknown and is not read, stored or shown. Keys and URLs are never logged.
import { credentialAad, openCredential } from "../credential-crypto";
import { createMengantarPublicClient, MengantarError, type ProviderOrder } from "./public-api";
import type { DispatcherDeps } from "./dispatcher";

export type CancelOutcome = "cancelled" | "refused" | "unknown" | "conflict" | "not_cancellable" | "no_key" | "unavailable";
type Begin = { action: "send" | "readback" | "done"; order_id: string; courier: string | null; credential_version: number | null };
type SealedKey = { ciphertext: string; iv: string; key_version: string; version: number };
type Reported = "deleted" | "not_deleted" | "rejected" | "unknown" | null;

const CANCELLED_CATEGORIES = new Set(["CANCELED", "CANCELLED"]);
const ENDED_CATEGORIES = new Set(["DELIVERED", "RTS", "RETURNED"]);

// The read-back verdict. `reported` is what the DELETE answered (null = no DELETE was sent in this decision).
export function judgeReadback(order: ProviderOrder | null, reported: Reported): "cancelled" | "refused" | "unknown" | "conflict" {
  if (!order) return "unknown";
  // Delivery learned from the read-back wins over every cancellation flag, even deleted: true.
  if (order.statusCategory !== null && ENDED_CATEGORIES.has(order.statusCategory.trim().toUpperCase())) return "conflict";
  if (order.deleted === true || (order.statusCategory !== null && CANCELLED_CATEGORIES.has(order.statusCategory))) return "cancelled";
  if (order.deleted === false && (reported === "not_deleted" || reported === "rejected")) return "refused";
  return "unknown";
}

export async function cancelShipment(
  deps: DispatcherDeps, tenant: string, shipment: string,
  opts: { deleteOrder?: (key: string, orderId: string, courier: string) => Promise<{ reported: "deleted" | "not_deleted" }>; findOrder?: (key: string, orderId: string, courier: string | null) => Promise<ProviderOrder | null> } = {},
): Promise<CancelOutcome> {
  const begun = await deps.rpc("cancel_begin", { p_tenant: tenant, p_env: deps.environment, p_shipment: shipment });
  if (begun.error) return /not_cancellable/.test(begun.error.message) ? "not_cancellable" : "unavailable";
  const row = (Array.isArray(begun.data) ? begun.data[0] : begun.data) as Begin | undefined;
  if (!row) return "unavailable";
  if (row.action === "done") return "cancelled";

  const record = async (outcome: "cancelled" | "refused" | "unknown"): Promise<CancelOutcome> => {
    const written = await deps.rpc("cancel_record", { p_tenant: tenant, p_env: deps.environment, p_shipment: shipment, p_outcome: outcome });
    if (written.error) return "unavailable";
    return written.data === "conflict" ? "conflict" : outcome;
  };

  const read = row.credential_version === null ? { data: null, error: null }
    : await deps.rpc("machine_operation_key", { p_tenant: tenant, p_env: deps.environment, p_version: row.credential_version });
  const keyRow = (Array.isArray(read.data) ? read.data[0] : read.data) as SealedKey | null;
  let key: string | null = null;
  if (!read.error && keyRow) {
    try { key = await openCredential(keyRow, credentialAad(tenant, keyRow.version), deps.credentialKey); } catch { key = null; }
  }
  // Nothing was sent by this decision (no key, no courier, or the send mark failed): a decision that cancel_begin
  // just opened ('send') is released back to NULL, so the shipment is not stuck in read-back-only mode. If the
  // release is refused (a DELETE may have left) or fails, the pending state becomes 'unknown' so it is visible.
  const releaseUnsent = async (): Promise<void> => {
    if (row.action === "send") {
      const released = await deps.rpc("cancel_release", { p_tenant: tenant, p_env: deps.environment, p_shipment: shipment });
      if (!released.error && released.data === true) return;
    }
    await record("unknown");
  };
  if (!key) { await releaseUnsent(); return "no_key"; }

  const client = createMengantarPublicClient(deps.environment, key, deps.fetchImpl);
  const del = opts.deleteOrder ?? ((k: string, orderId: string, courier: string) =>
    createMengantarPublicClient(deps.environment, k, deps.fetchImpl).deleteOrder(orderId, courier));
  const find = opts.findOrder ?? ((_k: string, orderId: string, courier: string | null) => client.findOrder(orderId, courier ?? undefined));

  let reported: Reported = null;
  if (row.action === "send") {
    if (!row.courier) { await releaseUnsent(); return "unavailable"; }
    // The write-ahead mark: from here on the decision can never be released, because a DELETE may leave.
    const marked = await deps.rpc("cancel_mark_sent", { p_tenant: tenant, p_env: deps.environment, p_shipment: shipment });
    if (marked.error) { await releaseUnsent(); return "unavailable"; }
    try {
      reported = (await del(key, row.order_id, row.courier)).reported;
    } catch (error) {
      // A plain refusal created/deleted nothing; every other failure may have deleted: unknown, never replayed.
      reported = error instanceof MengantarError && error.code === "rejected" ? "rejected" : "unknown";
    }
  }
  let order: ProviderOrder | null = null;
  try { order = await find(key, row.order_id, row.courier); } catch { order = null; }
  const verdict = judgeReadback(order, reported);
  // A delivered/returned read-back keeps the decision unresolved ('unknown', read-back-only next time).
  if (verdict === "conflict") return (await record("unknown")) === "unavailable" ? "unavailable" : "conflict";
  return record(verdict);
}
