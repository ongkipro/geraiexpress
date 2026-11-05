// T-039 / PR-19 / DEC-013: Partner-managed seller key regeneration and recovery orchestrator.
// Regenerating retires the old key at Mengantar IMMEDIATELY, so the database fences new work first
// (fence_partner_key_rotation: the active Partner credential is superseded and the onboarding row
// becomes 'rotation_unknown') and only then does the server call the provider. Every outcome after
// that is recorded: the sealed new key is stored before anything uses it; a lost or refused response
// leaves the marker set and the next recovery asks sellers/api-key for the current key; API_KEY_DISABLED
// and SELLER_DEACTIVATED end the flow without retry. A BYOK credential is never touched.
// begin uses the caller's session (`rpc`); the three writers are machine-only (`machineRpc`) and are
// called only after that admin check and sellers/list proved the stored seller id belongs to
// geraiexpress:tenant:<tenantId>. `callbackSecret` is never read, stored, logged or returned.

import { credentialAad, credentialHint, sealCredential } from "../credential-crypto";
import { createPartnerClient, PartnerError, type PartnerClient, type PartnerQuotaGate } from "./partner-api";
import { DEFAULT_PARTNER_ID, partnerQuotaGate, type PartnerOnboardingDeps } from "./partner-onboarding";

export type KeyRotationDeps = Pick<
  PartnerOnboardingDeps,
  "rpc" | "machineRpc" | "environment" | "partnerId" | "partnerSecret" | "credentialKey" | "fetchImpl" | "now" | "quota"
>;

export type KeyRotationInput = { tenantId: string; actorId: string };

export type KeyRotationResult =
  | { ok: true; state: "connected"; version: number; message: string }
  | {
      ok: false;
      state: "rotation_unknown" | "provider_restricted" | "configuration_blocked" | "rejected";
      // A key for friendlyError (src/lib/errors.ts).
      errorCode: string;
      retryAfterSeconds?: number | null;
    };

type Failure = Extract<KeyRotationResult, { ok: false }>;
type RpcResult = { data: unknown; error: { message?: string; code?: string } | null };

// Seller-level stops: the provider disabled the seller or its key. Never retried, never looped.
const STOP_CODES: Record<string, true> = { SELLER_DEACTIVATED: true, API_KEY_DISABLED: true };
// Refusals the provider states with a known code before changing anything. The key stays fenced
// (the old key may still work, but recovery is the one explicit way back), so these keep the marker.
const DEFINITE_REFUSALS: Record<string, true> = {
  INVALID_TIMESTAMP: true, UNAUTHORIZED: true, IP_NOT_ALLOWED: true, PARTNER_DEACTIVATED: true, RATE_LIMITED: true,
};

const fail = (state: Failure["state"], errorCode: string, retryAfterSeconds?: number | null): Failure =>
  retryAfterSeconds === undefined ? { ok: false, state, errorCode } : { ok: false, state, errorCode, retryAfterSeconds };

type Facts = {
  state: string | null;
  sellerId: string;
  externalUserId: string;
  activeMode: string | null;
  latestVersion: number;
};

type Context = {
  input: KeyRotationInput;
  deps: KeyRotationDeps;
  partner: PartnerClient;
  quota: PartnerQuotaGate;
  credentialKey: string;
  facts: Facts;
};

// BIZ-01 (same rule as onboarding): the provider must report exactly this seller for the tenant's
// externalUserId. Anything else is a mismatch, never a reason to regenerate or fetch a key.
async function sellerBelongsToTenant(partner: PartnerClient, sellerId: string, externalUserId: string): Promise<boolean> {
  const { sellers, total } = await partner.listSellers({ externalUserId, page: 1, size: 2 });
  return total === 1 && sellers.length === 1 && sellers[0].sellerId === sellerId && sellers[0].externalUserId === externalUserId;
}

async function prepare(input: KeyRotationInput, deps: KeyRotationDeps): Promise<Context | Failure> {
  const partnerId = (deps.partnerId || DEFAULT_PARTNER_ID).trim();
  const partnerSecret = deps.partnerSecret ?? "";
  const credentialKey = deps.credentialKey ?? "";
  if (deps.environment !== "sandbox" || !partnerId || partnerSecret.length < 16 || !credentialKey) {
    return fail("configuration_blocked", "partner_not_configured");
  }
  // A key the server cannot seal must not be rotated: probe the sealing key before the provider is
  // touched, because a regenerated key that cannot be stored is only recoverable, not usable.
  try {
    await sealCredential("API-SEALING-PROBE-0000", credentialAad(input.tenantId, 1), credentialKey);
  } catch {
    return fail("configuration_blocked", "partner_not_configured");
  }
  const quota = partnerQuotaGate(deps, "sandbox", partnerId);
  const partner = createPartnerClient("sandbox", partnerId, partnerSecret, quota, deps.fetchImpl, deps.now);
  const facts = await readFacts(input.tenantId, deps);
  if ("ok" in facts) return facts;
  return { input, deps, partner, quota, credentialKey, facts };
}

async function readFacts(tenantId: string, deps: KeyRotationDeps): Promise<Facts | Failure> {
  let res: RpcResult;
  try {
    res = await deps.rpc("begin_partner_key_rotation", { p_tenant: tenantId });
  } catch {
    return fail("rejected", "mengantar_unavailable");
  }
  // The database refuses a stop state or an open retry window before returning facts (T-054).
  if (res.error?.message === "provider_restricted") return fail("provider_restricted", "partner_restricted");
  if (res.error?.message === "partner_retry_after") return fail("rejected", "rotation_rate_limited");
  if (res.error) return fail("rejected", res.error.message || "invalid_input");
  const row = res.data as Record<string, unknown> | null;
  if (row?.onboarding_state === "provider_restricted") return fail("provider_restricted", "partner_restricted");
  if (row?.retry_after_at != null) {
    const until = Date.parse(String(row.retry_after_at));
    if (!Number.isFinite(until)) return fail("rejected", "stale_state");
    const remaining = Math.ceil((until - (deps.now?.() ?? Date.now())) / 1000);
    if (remaining > 0) return fail("rejected", "rotation_rate_limited", remaining);
  }
  const latest = row?.latest_credential_version;
  if (!row || typeof latest !== "number" || !Number.isInteger(latest) || latest < 0) return fail("rejected", "stale_state");
  const activeMode = typeof row.active_credential_mode === "string" ? row.active_credential_mode : null;
  // BYOK is outside this management authority: its key is rotated in the Mengantar dashboard.
  if (activeMode === "byok") return fail("rejected", "byok_active");
  const sellerId = row.partner_seller_id;
  if (row.connection_mode !== "partner_managed" || typeof sellerId !== "string" || !sellerId) {
    return fail("rejected", "not_partner_managed");
  }
  const externalUserId = `geraiexpress:tenant:${tenantId}`;
  if (row.external_user_id !== externalUserId) return fail("rejected", "invalid_input");
  return {
    state: typeof row.onboarding_state === "string" ? row.onboarding_state : null,
    sellerId, externalUserId, activeMode, latestVersion: latest,
  };
}

async function machine(ctx: Context, fn: string, args: Record<string, unknown>): Promise<RpcResult> {
  const base = { p_tenant: ctx.input.tenantId, p_actor: ctx.input.actorId, p_seller_id: ctx.facts.sellerId, p_env: ctx.deps.environment };
  try {
    return await ctx.deps.machineRpc(fn, { ...base, ...args });
  } catch {
    return { data: null, error: { message: "mengantar_unavailable" } };
  }
}

// Best effort: if this write fails the marker already says "unknown", which is the safe state.
async function recordOutcome(ctx: Context, state: "rotation_unknown" | "provider_restricted" | "configuration_blocked",
  errorCode: string, retryAfterSeconds: number | null = null) {
  await machine(ctx, "record_partner_key_rotation_outcome", {
    p_expected_version: ctx.facts.latestVersion, p_state: state, p_error_code: errorCode.slice(0, 64),
    p_retry_after_seconds: retryAfterSeconds,
  });
}

function providerCode(error: PartnerError): string {
  if (error.code === "unavailable") return "UNAVAILABLE";
  if (error.code === "malformed" || error.code === "unknown") return "UNREADABLE_RESPONSE";
  return error.code;
}

async function bindingFailure(ctx: Context): Promise<Failure> {
  await recordOutcome(ctx, "configuration_blocked", "SELLER_BINDING_MISMATCH");
  return fail("configuration_blocked", "seller_binding_mismatch");
}

// A provider answer after the fence. Only the stop states and a binding failure end the flow; every
// other outcome, including a refusal that provably changed nothing, keeps the marker so recovery is
// the way back, and none of them is retried here.
async function failAfterFence(ctx: Context, error: unknown, phase: "regenerate" | "recover"): Promise<Failure> {
  const unknownCode = phase === "regenerate" ? "rotation_unknown" : "mengantar_unavailable";
  if (!(error instanceof PartnerError)) {
    await recordOutcome(ctx, "rotation_unknown", "UNAVAILABLE");
    return fail("rotation_unknown", unknownCode);
  }
  if (STOP_CODES[error.code] === true) {
    await recordOutcome(ctx, "provider_restricted", error.code);
    return fail("provider_restricted", "rotation_restricted");
  }
  if (error.code === "SELLER_NOT_FOUND") return bindingFailure(ctx);
  // T-110: refused locally before the request was signed, so the provider changed nothing. The marker
  // stays (the key is fenced); recovery later reads the current key.
  if (error.code === "partner_quota_exhausted" || error.code === "provider_fence_engaged") {
    await recordOutcome(ctx, "rotation_unknown", error.code.toUpperCase());
    return fail("rotation_unknown", error.code, error.code === "partner_quota_exhausted" ? error.retryAfterSeconds : undefined);
  }
  const refused = DEFINITE_REFUSALS[error.code] === true && error.status !== null && error.status < 500;
  const retry = error.code === "RATE_LIMITED" ? error.retryAfterSeconds : null;
  await recordOutcome(ctx, "rotation_unknown", providerCode(error), retry);
  if (error.code === "RATE_LIMITED" && refused) return fail("rotation_unknown", "rotation_rate_limited", retry);
  if (refused) return fail("rotation_unknown", "rotation_refused");
  return fail("rotation_unknown", unknownCode);
}

// The provider reported a key; seal it for version latest + 1 and store it before anything uses it.
async function storeKey(ctx: Context, apiKey: string, source: "regenerated" | "recovered"): Promise<KeyRotationResult> {
  const nextVersion = ctx.facts.latestVersion + 1;
  let stored: RpcResult | null = null;
  try {
    const sealed = await sealCredential(apiKey, credentialAad(ctx.input.tenantId, nextVersion), ctx.credentialKey);
    stored = await machine(ctx, "store_partner_seller_key", {
      p_expected_version: ctx.facts.latestVersion, p_ciphertext: sealed.ciphertext, p_iv: sealed.iv,
      p_key_version: sealed.keyVersion, p_hint: credentialHint(apiKey), p_source: source,
    });
  } catch {
    stored = null;
  }
  if (stored && !stored.error) {
    return {
      ok: true, state: "connected", version: typeof stored.data === "number" ? stored.data : nextVersion,
      message: source === "regenerated"
        ? "Kunci API baru dibuat dan disimpan terenkripsi. Kunci lama sudah tidak berlaku."
        : "Kunci API terbaru diambil dari Mengantar dan disimpan terenkripsi. Pengiriman dapat dilanjutkan.",
    };
  }
  const code = stored?.error?.message;
  if (code === "byok_active") return fail("rejected", "byok_active");
  // The new key exists only at the provider now. Re-read the state (a BYOK key or another admin may
  // have changed it), then keep the marker so the next recovery fetches it again.
  const fresh = await readFacts(ctx.input.tenantId, ctx.deps);
  if ("ok" in fresh) return fresh;
  if (fresh.state === "rotation_unknown" && fresh.activeMode === null) {
    await recordOutcome({ ...ctx, facts: fresh }, "rotation_unknown", "STORE_FAILED");
    return fail("rotation_unknown", "rotation_store_failed");
  }
  return fail("rejected", "stale_state");
}

export async function regeneratePartnerSellerKey(input: KeyRotationInput, deps: KeyRotationDeps): Promise<KeyRotationResult> {
  const ctx = await prepare(input, deps);
  if ("ok" in ctx) return ctx;
  const { facts, partner } = ctx;
  if (facts.state !== "connected" || facts.activeMode !== "partner") return fail("rejected", "rotation_not_available");

  // Read-only, so a failure here pauses nothing.
  let bound: boolean;
  try {
    bound = await sellerBelongsToTenant(partner, facts.sellerId, facts.externalUserId);
  } catch (error) {
    if (!(error instanceof PartnerError)) return fail("rejected", "mengantar_unavailable");
    // Only tenant-level stops and a 429 are stored (T-054 review M1); Partner-wide codes below describe
    // our own Partner setup and must not lock a tenant out.
    if (["RATE_LIMITED", "SELLER_DEACTIVATED", "API_KEY_DISABLED"].includes(error.code)) {
      const stored = await machine(ctx, "record_partner_preflight_failure", {
        p_expected_version: facts.latestVersion, p_error_code: error.code, p_retry_after_seconds: error.retryAfterSeconds,
      });
      if (stored.error) return fail("rejected", "mengantar_unavailable");
      return error.code === "RATE_LIMITED"
        ? fail("rejected", "rotation_rate_limited", error.retryAfterSeconds)
        : fail("provider_restricted", "partner_restricted");
    }
    if (error.code === "PARTNER_DEACTIVATED" || error.code === "IP_NOT_ALLOWED") {
      return fail("rejected", "partner_restricted");
    }
    // T-110: nothing was sent; Partner-wide, so nothing is stored for the tenant.
    if (error.code === "partner_quota_exhausted") return fail("rejected", "partner_quota_exhausted", error.retryAfterSeconds);
    if (error.code === "UNAUTHORIZED" || error.code === "INVALID_TIMESTAMP") return fail("rejected", "partner_not_configured");
    return fail("rejected", error.code === "unavailable" || error.code === "INTERNAL_ERROR" ? "mengantar_unavailable" : "mengantar_data_unreadable");
  }

  // T-110: the Partner quota is reserved BEFORE the key fence, so a quota denial or the provider mutation
  // fence leaves the active key untouched. Cost 2: the regeneration request plus headroom for the
  // current-key read a lost answer leads to (that later read still reserves its own unit). The
  // regeneration below does not reserve again.
  const reserved = await ctx.quota.reserve({ mutating: true, newSellerRef: null, cost: 2 });
  if (!reserved.allowed) {
    if (reserved.reason === "fence") return fail("rejected", "provider_fence_engaged");
    const wait = reserved.nextEligibleAt === null ? null
      : Math.max(1, Math.ceil((reserved.nextEligibleAt - (deps.now?.() ?? Date.now())) / 1000));
    return fail("rejected", "partner_quota_exhausted", wait);
  }

  // Intent first: from here no code path can open a key for this tenant until it is stored again.
  const fenced = await machine(ctx, "fence_partner_key_rotation", { p_expected_version: facts.latestVersion });
  if (fenced.error) return fail("rejected", fenced.error.message || "invalid_input");
  if (!bound) return bindingFailure(ctx);

  let apiKey: string;
  try {
    apiKey = await partner.regenerateSellerKey(facts.sellerId, { quotaReserved: true });
  } catch (error) {
    return failAfterFence(ctx, error, "regenerate");
  }
  return storeKey(ctx, apiKey, "regenerated");
}

// Next recovery after a lost or refused regeneration: ask the provider for the CURRENT key (never
// rotate again) and store it. Also the way back after a BYOK-free pause.
export async function recoverRotatedPartnerSellerKey(input: KeyRotationInput, deps: KeyRotationDeps): Promise<KeyRotationResult> {
  const ctx = await prepare(input, deps);
  if ("ok" in ctx) return ctx;
  const { facts, partner } = ctx;
  if (facts.state !== "rotation_unknown" || facts.activeMode !== null) return fail("rejected", "rotation_not_available");

  let apiKey: string;
  try {
    if (!(await sellerBelongsToTenant(partner, facts.sellerId, facts.externalUserId))) return bindingFailure(ctx);
    apiKey = await partner.getSellerApiKey(facts.sellerId);
  } catch (error) {
    return failAfterFence(ctx, error, "recover");
  }
  return storeKey(ctx, apiKey, "recovered");
}
