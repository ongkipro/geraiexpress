// T-045 / ADR-0003 §2.6: the status pull is the floor under the webhook. For issued real shipments whose
// provider status is not final and older than STALE (or never reported), read the order by its provider id
// with the seller's own key and feed the result through the same SQL ingestion as the webhook (source 'pull').
// Read-only towards the provider: GET /order only. Bounded per run; never logs order ids, AWBs or keys.
import { credentialAad, openCredential } from "../credential-crypto";
import { createMengantarPublicClient, type ProviderOrder } from "./public-api";
import type { DispatcherDeps } from "./dispatcher";

export const STATUS_PULL_STALE = "2 hours";
export const STATUS_PULL_PAGE = 50;
export const STATUS_PULL_MAX = 200;

type Candidate = { tenant_id: string; shipment_id: string; order_id: string; courier: string | null; credential_version: number | null };
type SealedKey = { ciphertext: string; iv: string; key_version: string; version: number };
export type StatusPullSummary = { checked: number; applied: number; unchanged: number; skipped: number; failed: number };

// The provider timestamp of a pulled status. Trusted only when the row carries a readable lastStatusChange that
// is not in the future; otherwise the pull time is used and marked untrusted. Ingestion keeps an untrusted event
// as HISTORY ONLY: it never changes the kind, the ordering watermark (provider_status_at) or delivered_at /
// returned_at (ingest_provider_status returns 'history_only'; T-045 review round 2).
function providerTs(order: ProviderOrder, now: Date): { at: Date; trusted: boolean } {
  const t = order.lastStatusChange ? Date.parse(order.lastStatusChange) : Number.NaN;
  return Number.isFinite(t) && t <= now.getTime() ? { at: new Date(t), trusted: true } : { at: now, trusted: false };
}

export async function pullStatuses(deps: DispatcherDeps, opts: { now?: () => Date; findOrder?: (key: string, orderId: string, courier: string | null) => Promise<ProviderOrder | null> } = {}): Promise<StatusPullSummary> {
  const now = opts.now ?? (() => new Date());
  const summary: StatusPullSummary = { checked: 0, applied: 0, unchanged: 0, skipped: 0, failed: 0 };
  const keys = new Map<string, string | null>();
  const find = opts.findOrder ?? ((key, orderId, courier) =>
    createMengantarPublicClient(deps.environment, key, deps.fetchImpl).findOrder(orderId, courier ?? undefined));
  // Least recently pulled first; every read shipment is marked pulled (found, unchanged or failed), so the next
  // page and the next run move on to others and a bounded run can never starve the tail (review P1).
  while (summary.checked < STATUS_PULL_MAX) {
    const page = await deps.rpc("machine_status_pull_candidates", { p_env: deps.environment, p_stale: STATUS_PULL_STALE, p_limit: STATUS_PULL_PAGE });
    if (page.error) { summary.failed += 1; break; }
    const rows = (page.data ?? []) as Candidate[];
    if (rows.length === 0) break;
    const mark = await deps.rpc("mark_status_pulled", { p_env: deps.environment, p_shipments: rows.map((r) => r.shipment_id) });
    if (mark.error) { summary.failed += 1; break; }
    for (const c of rows) {
      summary.checked += 1;
      // One key read per tenant per run (the active key of this environment).
      if (!keys.has(c.tenant_id)) {
        const read = await deps.rpc("machine_seller_key", { p_tenant: c.tenant_id, p_env: deps.environment });
        const row = (Array.isArray(read.data) ? read.data[0] : read.data) as SealedKey | null;
        let key: string | null = null;
        if (!read.error && row) {
          try { key = await openCredential(row, credentialAad(c.tenant_id, row.version), deps.credentialKey); } catch { key = null; }
        }
        keys.set(c.tenant_id, key);
      }
      const key = keys.get(c.tenant_id);
      if (!key) { summary.skipped += 1; continue; }
      let order: ProviderOrder | null;
      try { order = await find(key, c.order_id, c.courier); } catch { summary.failed += 1; continue; }
      const status = order?.statusCategory ?? null;
      if (!order || !status) { summary.skipped += 1; continue; }
      const ts = providerTs(order, now());
      const result = await deps.rpc("ingest_provider_status", {
        p_tenant: c.tenant_id, p_env: deps.environment, p_source: "pull", p_provider_ts: ts.at.toISOString(),
        p_order_id: c.order_id, p_awb: order.trackingNumber, p_status: status, p_ts_trusted: ts.trusted,
      });
      if (result.error) summary.failed += 1;
      else if (result.data === "applied") summary.applied += 1;
      else summary.unchanged += 1;
      if (summary.checked >= STATUS_PULL_MAX) break;
    }
    if (rows.length < STATUS_PULL_PAGE) break;
  }
  return summary;
}
