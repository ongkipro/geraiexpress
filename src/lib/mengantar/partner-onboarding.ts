// T-027 / PR-17 / PR-20 / DEC-006: Mengantar Partner API sandbox seller onboarding orchestrator.
// Coordinates the database state machine (begin_partner_seller_onboarding -> Partner API call ->
// complete_partner_seller_onboarding / record_partner_seller_onboarding_outcome) and seals the
// returned seller API key in the Worker before persistence.

import { credentialAad, credentialHint, sealCredential } from "../credential-crypto";
import { createPartnerClient, PartnerError } from "./partner-api";

export const PARTNER_TERMS_VERSION = "2026-10";
export const PARTNER_PRIVACY_VERSION = "2026-10";
export const DEFAULT_PARTNER_ID = "ongkirich";

export type PartnerOnboardingRpc = (
  fn: string,
  args: Record<string, unknown>,
) => PromiseLike<{ data: unknown; error: { message?: string; code?: string } | null }>;

export type PartnerOnboardingDeps = {
  rpc: PartnerOnboardingRpc;
  environment?: string;
  partnerId?: string;
  partnerSecret?: string;
  credentialKey?: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
};

export type PartnerOnboardingInput = {
  tenantId: string;
  ownerName: string;
  ownerEmail: string;
  ownerPhone: string;
  termsVersion?: string;
  privacyVersion?: string;
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

export async function onboardPartnerSeller(
  input: PartnerOnboardingInput,
  deps: PartnerOnboardingDeps,
): Promise<PartnerOnboardingResult> {
  const termsVersion = (input.termsVersion ?? PARTNER_TERMS_VERSION).trim();
  const privacyVersion = (input.privacyVersion ?? PARTNER_PRIVACY_VERSION).trim();

  const beginRes = await deps.rpc("begin_partner_seller_onboarding", {
    p_tenant: input.tenantId,
    p_owner_name: input.ownerName,
    p_owner_email: input.ownerEmail,
    p_owner_phone: input.ownerPhone,
    p_terms_version: termsVersion,
    p_privacy_version: privacyVersion,
    p_agreed: input.agreed,
  });

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
  const latestVersion =
    typeof beginData.latest_credential_version === "number" && Number.isInteger(beginData.latest_credential_version)
      ? beginData.latest_credential_version
      : 0;

  const partnerId = (deps.partnerId || DEFAULT_PARTNER_ID).trim();
  const partnerSecret = deps.partnerSecret ?? "";
  const credentialKey = deps.credentialKey ?? "";

  if (deps.environment !== "sandbox" || !partnerId || partnerSecret.length < 16 || !credentialKey) {
    await deps.rpc("record_partner_seller_onboarding_outcome", {
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

  const partner = createPartnerClient("sandbox", partnerId, partnerSecret, deps.fetchImpl, deps.now);
  const name = input.ownerName.trim();
  const email = input.ownerEmail.trim().toLowerCase();
  const phone = input.ownerPhone.trim().replace(/[\s()-]+/g, "");

  try {
    let sellerId: string;
    let apiKey: string | null;
    let alreadyRegistered: boolean;

    if (partnerSellerId) {
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
      await deps.rpc("record_partner_seller_onboarding_outcome", {
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
    const completeRes = await deps.rpc("complete_partner_seller_onboarding", {
      p_tenant: input.tenantId,
      p_seller_id: sellerId,
      p_ciphertext: sealed.ciphertext,
      p_iv: sealed.iv,
      p_key_version: sealed.keyVersion,
      p_hint: credentialHint(apiKey),
    });

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
      return { ok: false, state: "rejected", errorCode: "mengantar_unavailable", sellerId: partnerSellerId };
    }
    return handlePartnerError(input.tenantId, partnerSellerId, err, deps.rpc);
  }
}

export async function recoverPartnerSellerKey(
  tenantId: string,
  deps: PartnerOnboardingDeps,
  fallbackOwner?: { ownerName?: string; ownerEmail?: string; ownerPhone?: string; termsVersion?: string; privacyVersion?: string },
): Promise<PartnerOnboardingResult> {
  let ownerName = fallbackOwner?.ownerName?.trim() ?? "";
  let ownerEmail = fallbackOwner?.ownerEmail?.trim() ?? "";
  let ownerPhone = fallbackOwner?.ownerPhone?.trim() ?? "";

  if (!ownerName || !ownerEmail || !ownerPhone) {
    const statusRes = await deps.rpc("partner_onboarding_status", { p_tenant: tenantId });
    if (statusRes.error) {
      return { ok: false, state: "rejected", errorCode: statusRes.error.message || "not_found" };
    }
    const row = Array.isArray(statusRes.data) ? (statusRes.data[0] as Record<string, unknown> | undefined) : undefined;
    ownerName = ownerName || String(row?.owner_name ?? "");
    ownerEmail = ownerEmail || String(row?.owner_email ?? "");
    ownerPhone = ownerPhone || String(row?.owner_phone ?? "");
  }

  return onboardPartnerSeller(
    {
      tenantId,
      ownerName,
      ownerEmail,
      ownerPhone,
      termsVersion: fallbackOwner?.termsVersion ?? PARTNER_TERMS_VERSION,
      privacyVersion: fallbackOwner?.privacyVersion ?? PARTNER_PRIVACY_VERSION,
      agreed: true,
    },
    deps,
  );
}

async function handlePartnerError(
  tenantId: string,
  existingSellerId: string | null,
  error: PartnerError,
  rpc: PartnerOnboardingRpc,
): Promise<PartnerOnboardingResult> {
  const sellerId = error.sellerId ?? existingSellerId;

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

  if (
    error.code === "PARTNER_DEACTIVATED" ||
    error.code === "SELLER_DEACTIVATED" ||
    error.code === "API_KEY_DISABLED" ||
    error.code === "IP_NOT_ALLOWED"
  ) {
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
    return {
      ok: false,
      state: "rejected",
      errorCode: "invalid_input",
      sellerId,
    };
  }

  if (error.code === "unavailable" || error.code === "INTERNAL_ERROR") {
    return {
      ok: false,
      state: "rejected",
      errorCode: "mengantar_unavailable",
      sellerId,
    };
  }

  return {
    ok: false,
    state: "rejected",
    errorCode: "mengantar_data_unreadable",
    sellerId,
  };
}
