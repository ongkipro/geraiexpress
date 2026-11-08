// T-027 / PR-17 / PR-20 / DEC-006: Mengantar Partner API sandbox seller onboarding orchestrator.
// Coordinates the database state machine (begin_partner_seller_onboarding -> Partner API call ->
// complete_partner_seller_onboarding / record_partner_seller_onboarding_outcome) and seals the
// returned seller API key on the server before persistence.
// T-032/T-034: begin/status/recovery use the caller's session (`rpc`); seller ids are written only by the
// machine identity (`machineRpc`), and only after sellers/list proved the seller id belongs to
// geraiexpress:tenant:<tenantId>. A stored or provider-reported id is never trusted on its own.

import { credentialAad, credentialHint, sealCredential } from "../credential-crypto";
import { createPartnerClient, PartnerError, rpcPartnerQuotaGate, type PartnerQuotaGate } from "./partner-api";

type PartnerClient = ReturnType<typeof createPartnerClient>;

// BIZ-01: the provider must report exactly this seller for the tenant's externalUserId. Anything
// else (no seller, another seller, extra entries) is a mismatch, never a reason to fetch a key.
async function sellerBelongsToTenant(partner: PartnerClient, sellerId: string, externalUserId: string): Promise<boolean> {
  const { sellers, total } = await partner.listSellers({ externalUserId, page: 1, size: 2 });
  return (
    total === 1 &&
    sellers.length === 1 &&
    sellers[0].sellerId === sellerId &&
    sellers[0].externalUserId === externalUserId
  );
}

export type PartnerConsentDocuments = {
  termsVersion: string;
  privacyVersion: string;
  termsUrl: string;
  privacyUrl: string;
};

// Values come from the container environment, never from posted form fields or invented policy URLs.
export function partnerConsentDocuments(config: Partial<PartnerConsentDocuments>): PartnerConsentDocuments | null {
  const termsVersion = config.termsVersion?.trim() ?? "";
  const privacyVersion = config.privacyVersion?.trim() ?? "";
  const termsUrl = config.termsUrl?.trim() ?? "";
  const privacyUrl = config.privacyUrl?.trim() ?? "";
  if (!termsVersion || termsVersion.length > 64 || !privacyVersion || privacyVersion.length > 64) return null;
  try {
    for (const value of [termsUrl, privacyUrl]) {
      const url = new URL(value);
      if (url.protocol !== "https:" || url.username || url.password) return null;
    }
  } catch {
    return null;
  }
  return { termsVersion, privacyVersion, termsUrl, privacyUrl };
}
export const DEFAULT_PARTNER_ID = "ongkirich";

// The Partner ID the runtime signs with: the one the Super Admin stored in the platform settings, else the
// PARTNER_ID environment value, else the default. /admin/integrasi shows the same resolution.
export function resolvePartnerId(stored: unknown, fromEnv: string | undefined): string {
  return (typeof stored === "string" ? stored.trim() : "") || fromEnv?.trim() || DEFAULT_PARTNER_ID;
}

export type PartnerOnboardingRpc = (
  fn: string,
  args: Record<string, unknown>,
) => PromiseLike<{ data: unknown; error: { message?: string; code?: string } | null }>;

export type PartnerOnboardingDeps = {
  // The caller's session: onboarding begin/status and consent-preserving key-recovery begin.
  rpc: PartnerOnboardingRpc;
  // Machine identity (service_role): record_partner_seller_onboarding_outcome and
  // complete_partner_seller_onboarding. Call only after the user-session admin check.
  machineRpc: PartnerOnboardingRpc;
  environment?: string;
  partnerId?: string;
  partnerSecret?: string;
  credentialKey?: string;
  consentDocuments?: PartnerConsentDocuments | null;
  fetchImpl?: typeof fetch;
  now?: () => number;
  // T-110: the Partner-wide quota gate; by default the machine-only reserve_partner_quota RPC.
  quota?: PartnerQuotaGate;
};

export function partnerQuotaGate(deps: Pick<PartnerOnboardingDeps, "machineRpc" | "quota">, environment: string, partnerId: string): PartnerQuotaGate {
  return deps.quota ?? rpcPartnerQuotaGate(deps.machineRpc, environment, partnerId);
}

export type PartnerOnboardingInput = {
  tenantId: string;
  ownerName: string;
  ownerEmail: string;
  ownerPhone: string;
  agreed: boolean;
};

export type PartnerOnboardingResult =
  | {
      ok: true;
      state: "connected";
      sellerId: string;
      version: number;
      alreadyRegistered: boolean;
      message: string;
    }
  | {
      ok: false;
      state:
        | "registered_key_pending"
        | "existing_account_required"
        | "quota_wait"
        | "provider_restricted"
        | "configuration_blocked"
        | "rejected";
      errorCode: string;
      sellerId?: string | null;
      retryAfterSeconds?: number | null;
    };

type BeginPayload = {
  external_user_id?: unknown;
  partner_seller_id?: unknown;
  latest_credential_version?: unknown;
};

// The database refuses every Partner step during a tenant stop or an open retry window (T-054); the
// user sees the matching state instead of a generic retry message (review L3).
function databaseStop(message: string | undefined): PartnerOnboardingResult | null {
  if (message === "provider_restricted") return { ok: false, state: "provider_restricted", errorCode: "partner_restricted" };
  if (message === "partner_retry_after") return { ok: false, state: "quota_wait", errorCode: "partner_rate_limited" };
  return null;
}

export async function onboardPartnerSeller(
  input: PartnerOnboardingInput,
  deps: PartnerOnboardingDeps,
): Promise<PartnerOnboardingResult> {
  const documents = deps.consentDocuments;
  if (!documents) return { ok: false, state: "configuration_blocked", errorCode: "configuration_blocked" };

  // T-057: the database accepts only the versions the server is configured with. Writing the server's
  // own configuration (not tenant data) before the session's admin check is safe.
  let synced: Awaited<ReturnType<PartnerOnboardingRpc>> | null = null;
  try {
    synced = await deps.machineRpc("sync_partner_consent_versions", {
      p_env: deps.environment ?? null, p_terms_version: documents.termsVersion, p_privacy_version: documents.privacyVersion,
    });
  } catch {
    synced = null;
  }
  if (!synced || synced.error) return { ok: false, state: "configuration_blocked", errorCode: "configuration_blocked" };

  const beginRes = await deps.rpc("begin_partner_seller_onboarding", {
    p_tenant: input.tenantId,
    p_owner_name: input.ownerName,
    p_owner_email: input.ownerEmail,
    p_owner_phone: input.ownerPhone,
    p_terms_version: documents.termsVersion,
    p_privacy_version: documents.privacyVersion,
    p_agreed: input.agreed,
  });

  if (beginRes.error?.message === "consent_versions_unconfigured") {
    return { ok: false, state: "configuration_blocked", errorCode: "configuration_blocked" };
  }
  const beginRefusal = databaseStop(beginRes.error?.message);
  if (beginRefusal) return beginRefusal;
  if (beginRes.error) {
    return {
      ok: false,
      state: "rejected",
      errorCode: beginRes.error.message || "invalid_input",
    };
  }

  const beginData = (beginRes.data ?? {}) as BeginPayload;
  const expectedExternalId = `geraiexpress:tenant:${input.tenantId}`;
  const externalUserId =
    typeof beginData.external_user_id === "string" && beginData.external_user_id
      ? beginData.external_user_id
      : expectedExternalId;
  if (externalUserId !== expectedExternalId) {
    return { ok: false, state: "rejected", errorCode: "invalid_input" };
  }

  const partnerSellerId =
    typeof beginData.partner_seller_id === "string" && beginData.partner_seller_id
      ? beginData.partner_seller_id
      : null;
  const latestVersion = beginData.latest_credential_version;
  if (typeof latestVersion !== "number" || !Number.isInteger(latestVersion) || latestVersion < 0) {
    return { ok: false, state: "rejected", errorCode: "stale_state" };
  }

  return provisionPartnerSeller(input, deps, externalUserId, partnerSellerId, latestVersion);
}

async function provisionPartnerSeller(
  input: Pick<PartnerOnboardingInput, "tenantId" | "ownerName" | "ownerEmail" | "ownerPhone">,
  deps: PartnerOnboardingDeps,
  externalUserId: string,
  partnerSellerId: string | null,
  latestVersion: number,
): Promise<PartnerOnboardingResult> {
  const expectedExternalId = `geraiexpress:tenant:${input.tenantId}`;
  const partnerId = (deps.partnerId || DEFAULT_PARTNER_ID).trim();
  const partnerSecret = deps.partnerSecret ?? "";
  const credentialKey = deps.credentialKey ?? "";

  if (deps.environment !== "sandbox" || !partnerId || partnerSecret.length < 16 || !credentialKey) {
    await deps.machineRpc("record_partner_seller_onboarding_outcome", {
      p_tenant: input.tenantId,
      p_state: "configuration_blocked",
      p_seller_id: partnerSellerId,
      p_error_code: "PARTNER_NOT_CONFIGURED",
      p_retry_after_seconds: null,
    });
    return {
      ok: false,
      state: "configuration_blocked",
      errorCode: "partner_not_configured",
      sellerId: partnerSellerId,
    };
  }

  const partner = createPartnerClient("sandbox", partnerId, partnerSecret, partnerQuotaGate(deps, "sandbox", partnerId), deps.fetchImpl, deps.now);
  const name = input.ownerName.trim();
  const email = input.ownerEmail.trim().toLowerCase();
  const phone = input.ownerPhone.trim().replace(/[\s()-]+/g, "");

  try {
    let sellerId: string;
    let apiKey: string | null;
    let alreadyRegistered: boolean;

    if (partnerSellerId) {
      if (!(await sellerBelongsToTenant(partner, partnerSellerId, expectedExternalId))) {
        return bindingMismatch(input.tenantId, deps.machineRpc);
      }
      sellerId = partnerSellerId;
      apiKey = await partner.getSellerApiKey(partnerSellerId);
      alreadyRegistered = true;
    } else {
      const reg = await partner.registerSeller({ name, email, phone, externalUserId });
      sellerId = reg.sellerId;
      apiKey = reg.apiKey;
      alreadyRegistered = reg.alreadyRegistered;
    }

    if (apiKey === null) {
      await deps.machineRpc("record_partner_seller_onboarding_outcome", {
        p_tenant: input.tenantId,
        p_state: "provider_restricted",
        p_seller_id: sellerId,
        p_error_code: "API_KEY_DISABLED",
        p_retry_after_seconds: null,
      });
      return {
        ok: false,
        state: "provider_restricted",
        errorCode: "partner_restricted",
        sellerId,
      };
    }

    const nextVersion = latestVersion + 1;
    const sealed = await sealCredential(apiKey, credentialAad(input.tenantId, nextVersion), credentialKey);
    const completeRes = await deps.machineRpc("complete_partner_seller_onboarding", {
      p_tenant: input.tenantId,
      p_seller_id: sellerId,
      p_expected_version: latestVersion,
      p_ciphertext: sealed.ciphertext,
      p_iv: sealed.iv,
      p_key_version: sealed.keyVersion,
      p_hint: credentialHint(apiKey),
      p_env: deps.environment,
    });

    const completeRefusal = databaseStop(completeRes.error?.message);
    if (completeRefusal) return { ...completeRefusal, sellerId };
    if (completeRes.error) {
      return {
        ok: false,
        state: "rejected",
        errorCode: completeRes.error.message || "invalid_input",
        sellerId,
      };
    }

    return {
      ok: true,
      state: "connected",
      sellerId,
      version: typeof completeRes.data === "number" ? completeRes.data : nextVersion,
      alreadyRegistered,
      message: partnerSellerId
        ? "Kunci API akun penjual Mengantar berhasil diambil dan disimpan terenkripsi."
        : alreadyRegistered
          ? "Akun penjual Mengantar dipulihkan dan kunci API disimpan terenkripsi."
          : "Akun penjual Mengantar berhasil dibuat dan kunci API disimpan terenkripsi.",
    };
  } catch (err) {
    if (!(err instanceof PartnerError)) {
      await deps.machineRpc("record_partner_seller_onboarding_outcome", {
        p_tenant: input.tenantId,
        p_state: partnerSellerId ? "registered_key_pending" : "not_connected",
        p_seller_id: partnerSellerId,
        p_error_code: "UNAVAILABLE",
        p_retry_after_seconds: null,
      });
      return { ok: false, state: "rejected", errorCode: "mengantar_unavailable", sellerId: partnerSellerId };
    }
    return handlePartnerError(input.tenantId, partnerSellerId, err, deps.machineRpc, partner, expectedExternalId);
  }
}

export async function recoverPartnerSellerKey(
  tenantId: string,
  deps: PartnerOnboardingDeps,
): Promise<PartnerOnboardingResult> {
  // A separate user-authorized transition reads the ORIGINAL consent and owner under lock.
  // It neither calls begin (which records new agreement) nor ever registers a seller.
  const result = await deps.rpc("begin_partner_seller_key_recovery", { p_tenant: tenantId });
  const recoveryRefusal = databaseStop(result.error?.message);
  if (recoveryRefusal) return recoveryRefusal;
  if (result.error) return { ok: false, state: "rejected", errorCode: result.error.message || "not_recoverable" };
  const row = result.data as Record<string, unknown> | null;
  if (!row?.consent_actor_id || !row.consent_recorded_at || !row.terms_version || !row.privacy_version) {
    return { ok: false, state: "rejected", errorCode: "consent_required" };
  }
  if (row.onboarding_state !== "registered_key_pending" || typeof row.partner_seller_id !== "string"
    || !row.partner_seller_id || row.external_user_id !== `geraiexpress:tenant:${tenantId}`
    || typeof row.owner_name !== "string" || typeof row.owner_email !== "string" || typeof row.owner_phone !== "string"
    || typeof row.latest_credential_version !== "number" || !Number.isInteger(row.latest_credential_version)) {
    return { ok: false, state: "rejected", errorCode: "not_recoverable" };
  }
  return provisionPartnerSeller(
    { tenantId, ownerName: row.owner_name, ownerEmail: row.owner_email, ownerPhone: row.owner_phone },
    deps, row.external_user_id, row.partner_seller_id, row.latest_credential_version,
  );
}

// The stored binding (or a provider-reported id) does not match the tenant's externalUserId at
// Mengantar. Fail closed: no key is fetched or sealed, and no seller id is written (null keeps the
// stored value). A tenant admin can still connect their own key (BYOK).
async function bindingMismatch(tenantId: string, rpc: PartnerOnboardingRpc): Promise<PartnerOnboardingResult> {
  await rpc("record_partner_seller_onboarding_outcome", {
    p_tenant: tenantId,
    p_state: "configuration_blocked",
    p_seller_id: null,
    p_error_code: "SELLER_BINDING_MISMATCH",
    p_retry_after_seconds: null,
  });
  return { ok: false, state: "configuration_blocked", errorCode: "mengantar_data_unreadable", sellerId: null };
}

async function handlePartnerError(
  tenantId: string,
  existingSellerId: string | null,
  error: PartnerError,
  rpc: PartnerOnboardingRpc,
  partner: PartnerClient,
  externalUserId: string,
): Promise<PartnerOnboardingResult> {
  // T-110: refused locally before anything was signed or sent. Partner-wide, not this tenant's state:
  // nothing is recorded for the tenant, and a later attempt simply tries again (never a resend).
  if (error.code === "partner_quota_exhausted") {
    return { ok: false, state: "quota_wait", errorCode: "partner_quota_exhausted", sellerId: existingSellerId, retryAfterSeconds: error.retryAfterSeconds };
  }
  if (error.code === "provider_fence_engaged") {
    return { ok: false, state: "configuration_blocked", errorCode: "provider_fence_engaged", sellerId: existingSellerId };
  }

  // SEC-01: a seller id in an error envelope is accepted for KEY_PROVISIONING_FAILED only (the
  // documented partial-provisioning reply), and only after the provider confirms it belongs to
  // this tenant's externalUserId. Every other code keeps the previously stored id.
  let sellerId = existingSellerId;
  if (error.code === "KEY_PROVISIONING_FAILED" && error.sellerId && error.sellerId !== existingSellerId) {
    try {
      if (!(await sellerBelongsToTenant(partner, error.sellerId, externalUserId))) {
        return bindingMismatch(tenantId, rpc);
      }
      sellerId = error.sellerId;
    } catch {
      // Unverifiable now: keep what is stored; a retry re-registers idempotently on externalUserId.
    }
  }

  if (error.code === "KEY_PROVISIONING_FAILED") {
    await rpc("record_partner_seller_onboarding_outcome", {
      p_tenant: tenantId,
      p_state: "registered_key_pending",
      p_seller_id: sellerId,
      p_error_code: error.code,
      p_retry_after_seconds: error.retryAfterSeconds,
    });
    return {
      ok: false,
      state: "registered_key_pending",
      errorCode: "partner_key_pending",
      sellerId,
      retryAfterSeconds: error.retryAfterSeconds,
    };
  }

  if (error.code === "EMAIL_ALREADY_REGISTERED") {
    await rpc("record_partner_seller_onboarding_outcome", {
      p_tenant: tenantId,
      p_state: "existing_account_required",
      p_seller_id: sellerId,
      p_error_code: error.code,
      p_retry_after_seconds: null,
    });
    return {
      ok: false,
      state: "existing_account_required",
      errorCode: "partner_email_registered",
      sellerId,
    };
  }

  if (error.code === "RATE_LIMITED" || error.code === "DAILY_REGISTRATION_LIMIT") {
    await rpc("record_partner_seller_onboarding_outcome", {
      p_tenant: tenantId,
      p_state: "quota_wait",
      p_seller_id: sellerId,
      p_error_code: error.code,
      p_retry_after_seconds: error.retryAfterSeconds,
    });
    return {
      ok: false,
      state: "quota_wait",
      errorCode: "partner_rate_limited",
      sellerId,
      retryAfterSeconds: error.retryAfterSeconds,
    };
  }

  // Partner-wide refusals describe our own Partner setup (allow-listed egress, Partner account), not
  // this tenant: configuration_blocked, which a later begin can leave. Only the tenant-level codes
  // record the durable provider_restricted stop (T-054 review M1).
  if (error.code === "PARTNER_DEACTIVATED" || error.code === "IP_NOT_ALLOWED") {
    await rpc("record_partner_seller_onboarding_outcome", {
      p_tenant: tenantId,
      p_state: "configuration_blocked",
      p_seller_id: sellerId,
      p_error_code: error.code,
      p_retry_after_seconds: null,
    });
    return { ok: false, state: "configuration_blocked", errorCode: "partner_restricted", sellerId };
  }

  if (error.code === "SELLER_DEACTIVATED" || error.code === "API_KEY_DISABLED") {
    await rpc("record_partner_seller_onboarding_outcome", {
      p_tenant: tenantId,
      p_state: "provider_restricted",
      p_seller_id: sellerId,
      p_error_code: error.code,
      p_retry_after_seconds: null,
    });
    return {
      ok: false,
      state: "provider_restricted",
      errorCode: "partner_restricted",
      sellerId,
    };
  }

  if (error.code === "UNAUTHORIZED" || error.code === "INVALID_TIMESTAMP") {
    await rpc("record_partner_seller_onboarding_outcome", {
      p_tenant: tenantId,
      p_state: "configuration_blocked",
      p_seller_id: sellerId,
      p_error_code: error.code,
      p_retry_after_seconds: null,
    });
    return {
      ok: false,
      state: "configuration_blocked",
      errorCode: "partner_not_configured",
      sellerId,
    };
  }

  if (
    error.code === "MISSING_FIELDS" ||
    error.code === "PASSWORD_NOT_ALLOWED" ||
    error.code === "INVALID_NAME" ||
    error.code === "INVALID_EMAIL" ||
    error.code === "INVALID_PHONE" ||
    error.code === "INVALID_EXTERNAL_USER_ID" ||
    error.code === "PHONE_NOT_ALLOWED"
  ) {
    await rpc("record_partner_seller_onboarding_outcome", {
      p_tenant: tenantId,
      p_state: sellerId ? "registered_key_pending" : "not_connected",
      p_seller_id: sellerId,
      p_error_code: error.code,
      p_retry_after_seconds: null,
    });
    return {
      ok: false,
      state: "rejected",
      errorCode: "invalid_input",
      sellerId,
    };
  }

  if (error.code === "unavailable" || error.code === "INTERNAL_ERROR") {
    await rpc("record_partner_seller_onboarding_outcome", {
      p_tenant: tenantId,
      p_state: sellerId ? "registered_key_pending" : "not_connected",
      p_seller_id: sellerId,
      p_error_code: error.code,
      p_retry_after_seconds: null,
    });
    return {
      ok: false,
      state: "rejected",
      errorCode: "mengantar_unavailable",
      sellerId,
    };
  }

  await rpc("record_partner_seller_onboarding_outcome", {
    p_tenant: tenantId,
    p_state: sellerId ? "registered_key_pending" : "not_connected",
    p_seller_id: sellerId,
    p_error_code: error.code.slice(0, 64) || "UNREADABLE_RESPONSE",
    p_retry_after_seconds: null,
  });
  return {
    ok: false,
    state: "rejected",
    errorCode: "mengantar_data_unreadable",
    sellerId,
  };
}
