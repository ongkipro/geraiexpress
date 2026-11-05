// SEC-7 key ring maintenance: moves active credentials sealed under an older key version to the
// ring's current key. Server-side (machine identity); the database only ever sees ciphertext. Run it
// after adding a key to CREDENTIAL_KEYS and switching CREDENTIAL_KEY_CURRENT, and drop the old key
// from the ring only when a run reports nothing left to re-wrap.
import { credentialAad, openCredential, resolveKeyRing, sealCredential, type CredentialKeyMaterial, type CredentialKeyRing } from "./credential-crypto";

type RpcResult = PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>;
export type RewrapRpc = (fn: string, args: Record<string, unknown>) => RpcResult;

export type ReencryptOutcome = "rewrapped" | "current" | "no_credential" | "conflict" | "failed";
export type ReencryptSummary = {
  scanned: number;
  rewrapped: number;
  alreadyCurrent: number;
  noCredential: number;
  conflicts: number;
  // Tenant id and a stable reason only: never key material, ciphertext or the provider key.
  failed: { tenantId: string; reason: string }[];
};

// Key versions are "v" + digits (resolveKeyRing). Anything else counts as lowest, so it is re-wrapped.
function keyVersionNumber(version: string): number {
  const match = /^v(\d{1,4})$/.exec(version);
  return match ? Number(match[1]) : 0;
}

type SealedRow = { ciphertext: string; iv: string; key_version: string; version: number };

// One tenant: read the active credential of this environment, and when its key version is not the
// current one, open it with the old key and seal it with the current key under the SAME credential
// version (same AAD). Idempotent: a row already on the current version is skipped, and the database
// fence (expected key version) makes a concurrent or repeated run harmless.
async function rewrapTenant(rpc: RewrapRpc, ring: CredentialKeyRing, environment: string, tenantId: string): Promise<ReencryptOutcome> {
  const read = await rpc("machine_seller_key", { p_tenant: tenantId, p_env: environment });
  if (read.error) return "failed";
  const row = read.data as SealedRow | null;
  if (!row) return "no_credential";
  // Never downgrade (security review L4): a row on the current key, or on a HIGHER one (the app
  // was rolled back to an older key-ring configuration), is left alone; the database refuses a
  // non-increasing rewrap as well.
  if (keyVersionNumber(row.key_version) >= keyVersionNumber(ring.current)) return "current";
  const aad = credentialAad(tenantId, row.version);
  const plain = await openCredential(row, aad, ring);
  const sealed = await sealCredential(plain, aad, ring);
  const write = await rpc("rewrap_seller_credential", {
    p_tenant: tenantId, p_version: row.version, p_expected_key_version: row.key_version,
    p_ciphertext: sealed.ciphertext, p_iv: sealed.iv, p_new_key_version: sealed.keyVersion,
  });
  if (!write.error) return "rewrapped";
  return write.error.code === "55000" || /stale_state/.test(write.error.message) ? "conflict" : "failed";
}

export async function reencryptCredentials(opts: {
  rpc: RewrapRpc;
  key: CredentialKeyMaterial;
  environment: "sandbox" | "production";
  tenantIds: Iterable<string>;
}): Promise<ReencryptSummary> {
  const ring = resolveKeyRing(opts.key);
  const summary: ReencryptSummary = { scanned: 0, rewrapped: 0, alreadyCurrent: 0, noCredential: 0, conflicts: 0, failed: [] };
  for (const tenantId of opts.tenantIds) {
    summary.scanned += 1;
    let outcome: ReencryptOutcome;
    let reason = "rewrap_failed";
    try {
      outcome = await rewrapTenant(opts.rpc, ring, opts.environment, tenantId);
    } catch (error) {
      outcome = "failed";
      reason = error instanceof Error ? error.name : "unknown";
    }
    if (outcome === "rewrapped") summary.rewrapped += 1;
    else if (outcome === "current") summary.alreadyCurrent += 1;
    else if (outcome === "no_credential") summary.noCredential += 1;
    else if (outcome === "conflict") summary.conflicts += 1;
    else summary.failed.push({ tenantId, reason });
  }
  return summary;
}

// T-109: one keyset page of the non-demo tenants whose active credential of `environment` is sealed
// under a key version below `currentVersion`, after `after` (null = from the start), through the
// machine-only RPC machine_rewrap_candidates. Already-current and credential-less tenants are never
// listed. Throws on an error or a malformed answer: a partial list must not look like a finished run.
export type TenantIdPage = (after: string | null, limit: number) => Promise<string[]>;
export async function rewrapCandidatePage(rpc: RewrapRpc, environment: string, currentVersion: string, after: string | null, limit: number): Promise<string[]> {
  const { data, error } = await rpc("machine_rewrap_candidates", { p_env: environment, p_current_version: currentVersion, p_after: after, p_limit: limit });
  if (error || !Array.isArray(data) || data.some((id) => typeof id !== "string")) throw new Error("tenant_list_failed");
  return data as string[];
}

// T-105: bounded, resumable rewrap. Each scheduled run handles at most REWRAP_BATCH tenants after the
// cursor of the previous run, so a large tenant list never restarts from the beginning and starves the
// tail. T-109: the page lists only tenants that still need a rewrap (rewrapCandidatePage), so a rewrapped
// tenant leaves the set by itself and the cursor only steps past conflicts and failures. The cursor is
// in-process: a restart begins a new pass, which is safe because the rewrap is idempotent. `pending` = tenants remain after this batch (the next run continues);
// a run with pending=false ended a pass and the next run starts over. A failed tenant is reported and
// retried on the next pass; a failed page read keeps the cursor.
export const REWRAP_BATCH = 500;
const CURSORS = Symbol.for("geraiexpress.rewrap-cursors");
const cursorHolder = globalThis as typeof globalThis & { [CURSORS]?: Map<string, string> };

export async function rewrapNextBatch(opts: {
  rpc: RewrapRpc;
  key: CredentialKeyMaterial;
  environment: "sandbox" | "production";
  page: TenantIdPage;
  batchSize?: number;
}): Promise<ReencryptSummary & { pending: boolean }> {
  const cursors = (cursorHolder[CURSORS] ??= new Map());
  const limit = opts.batchSize ?? REWRAP_BATCH;
  const ids = await opts.page(cursors.get(opts.environment) ?? null, limit);
  const summary = await reencryptCredentials({ rpc: opts.rpc, key: opts.key, environment: opts.environment, tenantIds: ids });
  const pending = ids.length === limit;
  if (pending) cursors.set(opts.environment, ids[ids.length - 1]);
  else cursors.delete(opts.environment);
  return { ...summary, pending };
}

// Test hook: forget the rewrap cursors.
export function resetRewrapCursors() {
  cursorHolder[CURSORS]?.clear();
}
