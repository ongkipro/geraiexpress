// T-027 / PR-17 / PR-20 / DEC-006: unit tests for the Mengantar Partner seller onboarding
// state machine, error taxonomy mapping, 503 partial-provisioning key recovery, and key sealing.

import { describe, expect, it } from "vitest";
import { credentialAad, openCredential } from "../../src/lib/credential-crypto";
import {
  onboardPartnerSeller,
  recoverPartnerSellerKey,
  type PartnerOnboardingDeps,
  type PartnerOnboardingInput,
  type PartnerOnboardingRpc,
} from "../../src/lib/mengantar/partner-onboarding";

const TENANT = "00000000-0000-4000-b000-0000000000a1";
const EXTERNAL_ID = `geraiexpress:tenant:${TENANT}`;
const PARTNER_SECRET = "offline-fixture-partner-secret-01";
const SEAL_KEY = Buffer.alloc(32, 11).toString("base64");
const SELLER_ID = "66ab1234567890abcdef1234";
const API_KEY = "API-3F9K2QX7ZB1MTDLE";
const NOW = 1758790800_000;

const baseInput: PartnerOnboardingInput = {
  tenantId: TENANT,
  ownerName: "Budi Santoso",
  ownerEmail: "budi@gerai-asli.id",
  ownerPhone: "0812-3456-7890",
  termsVersion: "2026-10",
  privacyVersion: "2026-10",
  agreed: true,
};

type FakeReply = { status: number; body?: unknown; headers?: Record<string, string> };

function createHarness(opts: {
  beginData?: Record<string, unknown>;
  beginError?: string;
  statusData?: Record<string, unknown>[];
  reply?: FakeReply;
  env?: Partial<PartnerOnboardingDeps>;
} = {}) {
  const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];
  const httpCalls: { url: string; init: RequestInit }[] = [];

  const rpc: PartnerOnboardingRpc = async (fn, args) => {
    rpcCalls.push({ fn, args });
    if (fn === "begin_partner_seller_onboarding") {
      if (opts.beginError) return { data: null, error: { message: opts.beginError } };
      return {
        data: opts.beginData ?? {
          external_user_id: EXTERNAL_ID,
          partner_seller_id: null,
          latest_credential_version: 2,
        },
        error: null,
      };
    }
    if (fn === "partner_onboarding_status") {
      return {
        data: opts.statusData ?? [
          {
            owner_name: "Budi Santoso",
            owner_email: "budi@gerai-asli.id",
            owner_phone: "081234567890",
            partner_seller_id: SELLER_ID,
          },
        ],
        error: null,
      };
    }
    if (fn === "complete_partner_seller_onboarding") {
      return { data: 3, error: null };
    }
    return { data: null, error: null };
  };

  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    httpCalls.push({ url: String(url), init: init! });
    const reply = opts.reply ?? {
      status: 201,
      body: {
        success: true,
        alreadyRegistered: false,
        data: { sellerId: SELLER_ID, email: "budi@gerai-asli.id", apiKey: API_KEY },
      },
    };
    return new Response(typeof reply.body === "string" ? reply.body : JSON.stringify(reply.body ?? {}), {
      status: reply.status,
      headers: { "content-type": "application/json", ...reply.headers },
    });
  }) as typeof fetch;

  const deps: PartnerOnboardingDeps = {
    rpc,
    environment: "sandbox",
    partnerId: "ongkirich",
    partnerSecret: PARTNER_SECRET,
    credentialKey: SEAL_KEY,
    fetchImpl,
    now: () => NOW,
    ...opts.env,
  };

  return { deps, rpcCalls, httpCalls };
}

describe("Mengantar Partner seller onboarding state machine (T-027)", () => {
  it("stops immediately when begin_partner_seller_onboarding refuses consent or input", async () => {
    const { deps, rpcCalls, httpCalls } = createHarness({ beginError: "consent_required" });
    const res = await onboardPartnerSeller({ ...baseInput, agreed: false }, deps);
    expect(res).toEqual({ ok: false, state: "rejected", errorCode: "consent_required" });
    expect(rpcCalls).toHaveLength(1);
    expect(httpCalls).toHaveLength(0);
  });

  it("records configuration_blocked when Partner bindings are missing", async () => {
    const { deps, rpcCalls, httpCalls } = createHarness({
      env: { partnerSecret: undefined },
    });
    const res = await onboardPartnerSeller(baseInput, deps);
    expect(res).toEqual({
      ok: false,
      state: "configuration_blocked",
      errorCode: "partner_not_configured",
      sellerId: null,
    });
    expect(httpCalls).toHaveLength(0);
    expect(rpcCalls[1]).toEqual({
      fn: "record_partner_seller_onboarding_outcome",
      args: {
        p_tenant: TENANT,
        p_state: "configuration_blocked",
        p_seller_id: null,
        p_error_code: "PARTNER_NOT_CONFIGURED",
        p_retry_after_seconds: null,
      },
    });
  });

  it("registers a new seller (201), seals the returned API key, and completes onboarding without leaking plaintext", async () => {
    const { deps, rpcCalls, httpCalls } = createHarness();
    const res = await onboardPartnerSeller(baseInput, deps);
    expect(res).toEqual({
      ok: true,
      state: "connected",
      sellerId: SELLER_ID,
      version: 3,
      alreadyRegistered: false,
      message: "Akun penjual Mengantar berhasil dibuat dan kunci API disimpan terenkripsi.",
    });

    expect(httpCalls).toHaveLength(1);
    expect(httpCalls[0].url).toBe("https://sandbox.mengantar.com/api/partner/v1/sellers");
    expect(JSON.parse(String(httpCalls[0].init.body))).toEqual({
      name: "Budi Santoso",
      email: "budi@gerai-asli.id",
      phone: "081234567890",
      externalUserId: EXTERNAL_ID,
    });

    const completeCall = rpcCalls.find((c) => c.fn === "complete_partner_seller_onboarding")!;
    expect(completeCall).toBeDefined();
    expect(completeCall.args.p_tenant).toBe(TENANT);
    expect(completeCall.args.p_seller_id).toBe(SELLER_ID);
    expect(completeCall.args.p_hint).toBe("LE");
    expect(JSON.stringify(completeCall.args)).not.toContain(API_KEY);

    // Verify ciphertext is bound to (TENANT, version 3)
    const opened = await openCredential(
      { ciphertext: String(completeCall.args.p_ciphertext), iv: String(completeCall.args.p_iv) },
      credentialAad(TENANT, 3),
      SEAL_KEY,
    );
    expect(opened).toBe(API_KEY);
    await expect(
      openCredential(
        { ciphertext: String(completeCall.args.p_ciphertext), iv: String(completeCall.args.p_iv) },
        credentialAad(TENANT, 2),
        SEAL_KEY,
      ),
    ).rejects.toThrow();
  });

  it("handles idempotent repeat registration (200 alreadyRegistered: true) and disabled repeat keys (apiKey: null)", async () => {
    const repeatOk = createHarness({
      reply: {
        status: 200,
        body: {
          success: true,
          alreadyRegistered: true,
          data: { sellerId: SELLER_ID, email: "budi@gerai-asli.id", apiKey: API_KEY },
        },
      },
    });
    const okRes = await onboardPartnerSeller(baseInput, repeatOk.deps);
    expect(okRes).toMatchObject({ ok: true, state: "connected", alreadyRegistered: true, sellerId: SELLER_ID });

    const repeatDisabled = createHarness({
      reply: {
        status: 200,
        body: {
          success: true,
          alreadyRegistered: true,
          data: { sellerId: SELLER_ID, email: "budi@gerai-asli.id", apiKey: null },
        },
      },
    });
    const disabledRes = await onboardPartnerSeller(baseInput, repeatDisabled.deps);
    expect(disabledRes).toEqual({
      ok: false,
      state: "provider_restricted",
      errorCode: "partner_restricted",
      sellerId: SELLER_ID,
    });
    expect(repeatDisabled.rpcCalls.find((c) => c.fn === "complete_partner_seller_onboarding")).toBeUndefined();
    expect(repeatDisabled.rpcCalls[1]).toEqual({
      fn: "record_partner_seller_onboarding_outcome",
      args: {
        p_tenant: TENANT,
        p_state: "provider_restricted",
        p_seller_id: SELLER_ID,
        p_error_code: "API_KEY_DISABLED",
        p_retry_after_seconds: null,
      },
    });
  });

  it("preserves sellerId on 503 KEY_PROVISIONING_FAILED and recovers the key via /sellers/api-key without creating a new identity", async () => {
    const partial = createHarness({
      reply: {
        status: 503,
        body: {
          success: false,
          code: "KEY_PROVISIONING_FAILED",
          message: "Key provisioning failed",
          data: { sellerId: SELLER_ID },
        },
      },
    });
    const partialRes = await onboardPartnerSeller(baseInput, partial.deps);
    expect(partialRes).toEqual({
      ok: false,
      state: "registered_key_pending",
      errorCode: "partner_key_pending",
      sellerId: SELLER_ID,
      retryAfterSeconds: null,
    });
    expect(partial.rpcCalls[1]).toEqual({
      fn: "record_partner_seller_onboarding_outcome",
      args: {
        p_tenant: TENANT,
        p_state: "registered_key_pending",
        p_seller_id: SELLER_ID,
        p_error_code: "KEY_PROVISIONING_FAILED",
        p_retry_after_seconds: null,
      },
    });

    // Recovery uses the saved partner_seller_id and calls /api/partner/v1/sellers/api-key
    const recovery = createHarness({
      beginData: {
        external_user_id: EXTERNAL_ID,
        partner_seller_id: SELLER_ID,
        latest_credential_version: 2,
      },
      reply: {
        status: 200,
        body: {
          success: true,
          data: { sellerId: SELLER_ID, apiKey: API_KEY },
        },
      },
    });
    const recoveredRes = await recoverPartnerSellerKey(TENANT, recovery.deps);
    expect(recoveredRes).toEqual({
      ok: true,
      state: "connected",
      sellerId: SELLER_ID,
      version: 3,
      alreadyRegistered: true,
      message: "Kunci API akun penjual Mengantar berhasil diambil dan disimpan terenkripsi.",
    });
    expect(recovery.httpCalls).toHaveLength(1);
    expect(recovery.httpCalls[0].url).toBe("https://sandbox.mengantar.com/api/partner/v1/sellers/api-key");
    expect(JSON.parse(String(recovery.httpCalls[0].init.body))).toEqual({ sellerId: SELLER_ID });
  });

  it("maps 409 EMAIL_ALREADY_REGISTERED, 429 RATE_LIMITED / DAILY_REGISTRATION_LIMIT, and 403 restrictions to distinct states", async () => {
    const emailConflict = createHarness({
      reply: {
        status: 409,
        body: { success: false, code: "EMAIL_ALREADY_REGISTERED", message: "Email registered" },
      },
    });
    expect(await onboardPartnerSeller(baseInput, emailConflict.deps)).toEqual({
      ok: false,
      state: "existing_account_required",
      errorCode: "partner_email_registered",
      sellerId: null,
    });
    expect(emailConflict.rpcCalls[1].args).toMatchObject({
      p_state: "existing_account_required",
      p_error_code: "EMAIL_ALREADY_REGISTERED",
    });

    const rateLimited = createHarness({
      reply: {
        status: 429,
        headers: { "retry-after": "45" },
        body: { success: false, code: "RATE_LIMITED", message: "Too many requests" },
      },
    });
    expect(await onboardPartnerSeller(baseInput, rateLimited.deps)).toEqual({
      ok: false,
      state: "quota_wait",
      errorCode: "partner_rate_limited",
      sellerId: null,
      retryAfterSeconds: 45,
    });
    expect(rateLimited.rpcCalls[1].args).toMatchObject({
      p_state: "quota_wait",
      p_error_code: "RATE_LIMITED",
      p_retry_after_seconds: 45,
    });

    for (const code of ["PARTNER_DEACTIVATED", "SELLER_DEACTIVATED", "API_KEY_DISABLED", "IP_NOT_ALLOWED"]) {
      const restricted = createHarness({
        reply: { status: 403, body: { success: false, code, message: "Forbidden" } },
      });
      expect(await onboardPartnerSeller(baseInput, restricted.deps)).toEqual({
        ok: false,
        state: "provider_restricted",
        errorCode: "partner_restricted",
        sellerId: null,
      });
      expect(restricted.rpcCalls[1].args).toMatchObject({
        p_state: "provider_restricted",
        p_error_code: code,
      });
    }
  });
});
