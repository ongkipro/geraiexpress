// T-027 / PR-17 / PR-20 / DEC-006: unit tests for the Mengantar Partner seller onboarding
// state machine, error taxonomy mapping, 503 partial-provisioning key recovery, and key sealing.

import { describe, expect, it, vi } from "vitest";
import { credentialAad, openCredential } from "../../src/lib/credential-crypto";
import {
  onboardPartnerSeller,
  partnerConsentDocuments,
  recoverPartnerSellerKey,
  type PartnerOnboardingDeps,
  type PartnerOnboardingInput,
  type PartnerOnboardingRpc,
} from "../../src/lib/mengantar/partner-onboarding";
import { registerPartnerSellerAction, recoverPartnerSellerKeyAction } from "../../src/modules/credentials/actions";
vi.mock("@/lib/hosts", () => ({ requestScope: async () => "shared" }));

const TENANT = "00000000-0000-4000-b000-0000000000a1";
const EXTERNAL_ID = `geraiexpress:tenant:${TENANT}`;
const PARTNER_SECRET = "test_offline-fixture-partner-secret-01";
const SEAL_KEY = Buffer.alloc(32, 11).toString("base64");
const SELLER_ID = "66ab1234567890abcdef1234";
const SELLER_KEY_FIXTURE = "API-3F9K2QX7ZB1MTDLE";
const NOW = 1758790800_000;

const baseInput: PartnerOnboardingInput = {
  tenantId: TENANT,
  ownerName: "Budi Santoso",
  ownerEmail: "budi@gerai-asli.id",
  ownerPhone: "0812-3456-7890",
  agreed: true,
};
const DOCUMENTS = {
  termsVersion: "fixture-terms-7", privacyVersion: "fixture-privacy-9",
  termsUrl: "https://provider.test/legal/terms", privacyUrl: "https://provider.test/legal/privacy",
};

type FakeReply = { status: number; body?: unknown; headers?: Record<string, string> };

function listOk(sellerId: string, externalUserId: string = EXTERNAL_ID, total = 1): FakeReply {
  return {
    status: 200,
    body: {
      success: true,
      data: { sellers: [{ sellerId, externalUserId, active: true }].slice(0, total), page: 1, size: 2, total, totalPages: 1 },
    },
  };
}

type OnboardingHarness = {
  deps: PartnerOnboardingDeps;
  rpcCalls: { fn: string; args: Record<string, unknown> }[];
  httpCalls: { url: string; init: RequestInit }[];
  syncCalls: Record<string, unknown>[];
};

function createHarness(opts: {
  beginData?: Record<string, unknown>;
  beginError?: string;
  recoveryData?: Record<string, unknown> | null;
  reply?: FakeReply;
  // sellers/list reply; default: exactly the tenant's own seller.
  listReply?: FakeReply;
  env?: Partial<PartnerOnboardingDeps>;
  syncError?: string;
} = {}): OnboardingHarness {
  const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];
  const syncCalls: Record<string, unknown>[] = [];
  const httpCalls: { url: string; init: RequestInit }[] = [];

  // User-session calls (rpc) and machine calls (machineRpc) share one ordered log. Each identity
  // refuses the other's functions, proving the writers are machine-only (T-032).
  const rpc: PartnerOnboardingRpc = async (fn, args) => {
    if (fn === "record_partner_seller_onboarding_outcome" || fn === "complete_partner_seller_onboarding") {
      throw new Error(`${fn} must go through the machine client`);
    }
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
    if (fn === "begin_partner_seller_key_recovery") {
      return {
        data: opts.recoveryData === undefined ? {
          owner_name: "Budi Santoso", owner_email: "budi@gerai-asli.id", owner_phone: "081234567890",
          partner_seller_id: SELLER_ID, external_user_id: EXTERNAL_ID, latest_credential_version: 2,
          onboarding_state: "registered_key_pending", consent_actor_id: "original-actor",
          consent_recorded_at: "2026-10-14T09:00:00Z", terms_version: "original-terms", privacy_version: "original-privacy",
        } : opts.recoveryData,
        error: null,
      };
    }
    return { data: null, error: null };
  };

  const machineRpc: PartnerOnboardingRpc = async (fn, args) => {
    if (fn === "begin_partner_seller_onboarding" || fn === "partner_onboarding_status" || fn === "begin_partner_seller_key_recovery") {
      throw new Error(`${fn} must use the caller's session`);
    }
    // T-057: the server's own consent configuration, written before begin; logged apart from tenant writes.
    if (fn === "sync_partner_consent_versions") {
      syncCalls.push(args);
      return opts.syncError ? { data: null, error: { message: opts.syncError } } : { data: null, error: null };
    }
    rpcCalls.push({ fn, args });
    if (fn === "complete_partner_seller_onboarding") return { data: 3, error: null };
    return { data: null, error: null };
  };

  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    httpCalls.push({ url: String(url), init: init! });
    const isList = String(url).endsWith("/sellers/list");
    const reply: FakeReply = isList
      ? (opts.listReply ?? listOk(SELLER_ID))
      : (opts.reply ?? {
          status: 201,
          body: {
            success: true,
            alreadyRegistered: false,
            data: { sellerId: SELLER_ID, email: "budi@gerai-asli.id", apiKey: SELLER_KEY_FIXTURE },
          },
        });
    return new Response(typeof reply.body === "string" ? reply.body : JSON.stringify(reply.body ?? {}), {
      status: reply.status,
      headers: { "content-type": "application/json", ...reply.headers },
    });
  }) as typeof fetch;

  const deps: PartnerOnboardingDeps = {
    rpc,
    machineRpc,
    environment: "sandbox",
    partnerId: "ongkirich",
    partnerSecret: PARTNER_SECRET,
    credentialKey: SEAL_KEY,
    consentDocuments: DOCUMENTS,
    fetchImpl,
    now: () => NOW,
    ...opts.env,
  };

  return { deps, rpcCalls, httpCalls, syncCalls };
}

describe("Mengantar Partner seller onboarding state machine (T-027)", () => {
  it("synchronizes the configured consent versions for this environment before begin (T-057)", async () => {
    const { deps, rpcCalls, syncCalls } = createHarness({ beginError: "consent_required" });
    await onboardPartnerSeller(baseInput, deps);
    expect(syncCalls).toEqual([{ p_env: "sandbox", p_terms_version: DOCUMENTS.termsVersion, p_privacy_version: DOCUMENTS.privacyVersion }]);
    expect(rpcCalls[0].args).toMatchObject({ p_terms_version: DOCUMENTS.termsVersion, p_privacy_version: DOCUMENTS.privacyVersion });
  });

  it("is configuration_blocked with no begin and no provider call when the sync fails or the database has no versions (T-057)", async () => {
    for (const opts of [{ syncError: "invalid_environment" }, { beginError: "consent_versions_unconfigured" }]) {
      const { deps, rpcCalls, httpCalls } = createHarness(opts);
      expect(await onboardPartnerSeller(baseInput, deps)).toEqual({ ok: false, state: "configuration_blocked", errorCode: "configuration_blocked" });
      expect(rpcCalls.filter((c) => c.fn !== "begin_partner_seller_onboarding")).toEqual([]);
      expect(rpcCalls).toHaveLength("syncError" in opts ? 0 : 1);
      expect(httpCalls).toHaveLength(0);
    }
  });

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
    expect(completeCall.args.p_expected_version).toBe(2);
    expect(completeCall.args.p_hint).toBe("LE");
    expect(JSON.stringify(completeCall.args)).not.toContain(SELLER_KEY_FIXTURE);

    // Verify ciphertext is bound to (TENANT, version 3)
    const opened = await openCredential(
      { ciphertext: String(completeCall.args.p_ciphertext), iv: String(completeCall.args.p_iv) },
      credentialAad(TENANT, 3),
      SEAL_KEY,
    );
    expect(opened).toBe(SELLER_KEY_FIXTURE);
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
          data: { sellerId: SELLER_ID, email: "budi@gerai-asli.id", apiKey: SELLER_KEY_FIXTURE },
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
          data: { sellerId: SELLER_ID, apiKey: SELLER_KEY_FIXTURE },
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
    // T-032: the stored id is verified with sellers/list (filtered by externalUserId) before api-key.
    expect(recovery.httpCalls).toHaveLength(2);
    expect(recovery.httpCalls[0].url).toBe("https://sandbox.mengantar.com/api/partner/v1/sellers/list");
    expect(JSON.parse(String(recovery.httpCalls[0].init.body))).toEqual({ externalUserId: EXTERNAL_ID, page: 1, size: 2 });
    expect(recovery.httpCalls[1].url).toBe("https://sandbox.mengantar.com/api/partner/v1/sellers/api-key");
    expect(JSON.parse(String(recovery.httpCalls[1].init.body))).toEqual({ sellerId: SELLER_ID });
    expect(recovery.rpcCalls.find((c) => c.fn === "complete_partner_seller_onboarding")?.args.p_seller_id).toBe(SELLER_ID);
    expect(recovery.rpcCalls.map((c) => c.fn)).toEqual(["begin_partner_seller_key_recovery", "complete_partner_seller_onboarding"]);
    expect(recovery.rpcCalls[1].args.p_expected_version).toBe(2);
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

    // Tenant-level codes are a durable stop; Partner-wide codes (our own setup) are configuration_blocked,
    // which a later begin can leave (T-054 review M1).
    for (const [code, state] of [["SELLER_DEACTIVATED", "provider_restricted"], ["API_KEY_DISABLED", "provider_restricted"],
      ["PARTNER_DEACTIVATED", "configuration_blocked"], ["IP_NOT_ALLOWED", "configuration_blocked"]] as const) {
      const restricted = createHarness({
        reply: { status: 403, body: { success: false, code, message: "Forbidden" } },
      });
      expect(await onboardPartnerSeller(baseInput, restricted.deps)).toEqual({
        ok: false,
        state,
        errorCode: "partner_restricted",
        sellerId: null,
      });
      expect(restricted.rpcCalls[1].args).toMatchObject({
        p_state: state,
        p_error_code: code,
      });
    }

    for (const [message, state, errorCode] of [["provider_restricted", "provider_restricted", "partner_restricted"],
      ["partner_retry_after", "quota_wait", "partner_rate_limited"]] as const) {
      const stopped = createHarness({ beginError: message });
      expect(await onboardPartnerSeller(baseInput, stopped.deps)).toEqual({ ok: false, state, errorCode });
      expect(stopped.httpCalls).toHaveLength(0);
    }

    const validationErr = createHarness({
      reply: { status: 400, body: { success: false, code: "INVALID_PHONE", message: "Invalid phone" } },
    });
    expect(await onboardPartnerSeller(baseInput, validationErr.deps)).toEqual({
      ok: false,
      state: "rejected",
      errorCode: "invalid_input",
      sellerId: null,
    });
    expect(validationErr.rpcCalls[1]).toEqual({
      fn: "record_partner_seller_onboarding_outcome",
      args: {
        p_tenant: TENANT,
        p_state: "not_connected",
        p_seller_id: null,
        p_error_code: "INVALID_PHONE",
        p_retry_after_seconds: null,
      },
    });

    const internalErr = createHarness({
      reply: { status: 500, body: { success: false, code: "INTERNAL_ERROR", message: "Server error" } },
    });
    expect(await onboardPartnerSeller(baseInput, internalErr.deps)).toEqual({
      ok: false,
      state: "rejected",
      errorCode: "mengantar_unavailable",
      sellerId: null,
    });
    expect(internalErr.rpcCalls[1]).toEqual({
      fn: "record_partner_seller_onboarding_outcome",
      args: {
        p_tenant: TENANT,
        p_state: "not_connected",
        p_seller_id: null,
        p_error_code: "INTERNAL_ERROR",
        p_retry_after_seconds: null,
      },
    });
  });
  describe("seller binding verification (T-032 / BIZ-01 / SEC-01)", () => {
    const FOREIGN_SELLER = "77cd1234567890abcdef5678";
    const storedBegin = { external_user_id: EXTERNAL_ID, partner_seller_id: FOREIGN_SELLER, latest_credential_version: 2 };
    const outcomeCalls = (rpcCalls: { fn: string; args: Record<string, unknown> }[]) =>
      rpcCalls.filter((c) => c.fn === "record_partner_seller_onboarding_outcome");

    it("makes no api-key and no complete call when sellers/list returns another seller for the tenant", async () => {
      const h = createHarness({ beginData: storedBegin, listReply: listOk(SELLER_ID) });
      const res = await onboardPartnerSeller(baseInput, h.deps);
      expect(res).toEqual({ ok: false, state: "configuration_blocked", errorCode: "mengantar_data_unreadable", sellerId: null });
      expect(h.httpCalls).toHaveLength(1);
      expect(h.httpCalls[0].url).toBe("https://sandbox.mengantar.com/api/partner/v1/sellers/list");
      expect(h.rpcCalls.map((c) => c.fn)).toEqual([
        "begin_partner_seller_onboarding",
        "record_partner_seller_onboarding_outcome",
      ]);
      expect(h.rpcCalls[1].args).toEqual({
        p_tenant: TENANT,
        p_state: "configuration_blocked",
        p_seller_id: null,
        p_error_code: "SELLER_BINDING_MISMATCH",
        p_retry_after_seconds: null,
      });
    });

    it("treats an empty list, a foreign externalUserId or extra entries as a mismatch", async () => {
      const foreignExternal = listOk(FOREIGN_SELLER, "geraiexpress:tenant:00000000-0000-4000-b000-0000000000b2");
      const empty = listOk(FOREIGN_SELLER, EXTERNAL_ID, 0);
      const twoRows: FakeReply = {
        status: 200,
        body: {
          success: true,
          data: {
            sellers: [
              { sellerId: FOREIGN_SELLER, externalUserId: EXTERNAL_ID, active: true },
              { sellerId: SELLER_ID, externalUserId: EXTERNAL_ID, active: true },
            ],
            page: 1, size: 2, total: 2, totalPages: 1,
          },
        },
      };
      for (const listReply of [foreignExternal, empty, twoRows]) {
        const h = createHarness({ beginData: storedBegin, listReply });
        const res = await onboardPartnerSeller(baseInput, h.deps);
        expect(res).toMatchObject({ ok: false, state: "configuration_blocked" });
        expect(h.httpCalls.map((c) => c.url)).toEqual(["https://sandbox.mengantar.com/api/partner/v1/sellers/list"]);
        expect(h.rpcCalls.some((c) => c.fn === "complete_partner_seller_onboarding")).toBe(false);
      }
    });

    it("does not call api-key or complete when sellers/list itself fails, and keeps the stored id", async () => {
      const h = createHarness({
        beginData: storedBegin,
        listReply: { status: 503, body: { success: false, code: "INTERNAL_ERROR", message: "down" } },
      });
      const res = await onboardPartnerSeller(baseInput, h.deps);
      expect(res).toMatchObject({ ok: false, state: "rejected", errorCode: "mengantar_unavailable", sellerId: FOREIGN_SELLER });
      expect(h.httpCalls).toHaveLength(1);
      expect(h.rpcCalls.some((c) => c.fn === "complete_partner_seller_onboarding")).toBe(false);
    });

    it("accepts an envelope sellerId for KEY_PROVISIONING_FAILED only after sellers/list confirms it", async () => {
      const envelope503: FakeReply = {
        status: 503,
        body: { success: false, code: "KEY_PROVISIONING_FAILED", message: "x", data: { sellerId: SELLER_ID } },
      };
      const ok = createHarness({ reply: envelope503, listReply: listOk(SELLER_ID) });
      expect(await onboardPartnerSeller(baseInput, ok.deps)).toMatchObject({
        ok: false, state: "registered_key_pending", sellerId: SELLER_ID,
      });
      expect(ok.httpCalls.map((c) => c.url.split("/").pop())).toEqual(["sellers", "list"]);
      expect(outcomeCalls(ok.rpcCalls)[0].args).toMatchObject({ p_state: "registered_key_pending", p_seller_id: SELLER_ID });

      // The provider says another seller owns this tenant's externalUserId: never store the id.
      const bad = createHarness({ reply: envelope503, listReply: listOk(FOREIGN_SELLER) });
      expect(await onboardPartnerSeller(baseInput, bad.deps)).toMatchObject({ ok: false, state: "configuration_blocked", sellerId: null });
      expect(outcomeCalls(bad.rpcCalls)).toHaveLength(1);
      expect(outcomeCalls(bad.rpcCalls)[0].args).toMatchObject({ p_seller_id: null, p_error_code: "SELLER_BINDING_MISMATCH" });
      expect(bad.rpcCalls.some((c) => c.fn === "complete_partner_seller_onboarding")).toBe(false);
    });

    it("ignores an envelope sellerId on every other error code", async () => {
      for (const code of ["EMAIL_ALREADY_REGISTERED", "RATE_LIMITED", "SELLER_DEACTIVATED", "INTERNAL_ERROR"]) {
        const h = createHarness({
          reply: { status: code === "INTERNAL_ERROR" ? 500 : 409, body: { success: false, code, message: "x", data: { sellerId: FOREIGN_SELLER } } },
        });
        const res = await onboardPartnerSeller(baseInput, h.deps);
        expect(res).toMatchObject({ ok: false, sellerId: null });
        expect(outcomeCalls(h.rpcCalls)[0].args.p_seller_id).toBeNull();
        expect(h.httpCalls).toHaveLength(1);
      }
    });

    it("keeps the stored id when an envelope sellerId on KEY_PROVISIONING_FAILED equals it, without a second list call", async () => {
      const h = createHarness({
        beginData: { external_user_id: EXTERNAL_ID, partner_seller_id: SELLER_ID, latest_credential_version: 2 },
        reply: { status: 503, body: { success: false, code: "KEY_PROVISIONING_FAILED", message: "x", data: { sellerId: SELLER_ID } } },
      });
      const res = await onboardPartnerSeller(baseInput, h.deps);
      expect(res).toMatchObject({ ok: false, state: "registered_key_pending", sellerId: SELLER_ID });
      // list (stored-id verification) then api-key; no extra verification for the same id.
      expect(h.httpCalls.map((c) => c.url.split("/").pop())).toEqual(["list", "api-key"]);
    });
  });
});

describe("server-held consent configuration (T-034 / SEC-14 / SUP-11)", () => {
  it("blocks registration without configured document URLs and versions, before any Partner call", async () => {
    for (const missing of Object.keys(DOCUMENTS)) {
      const config = partnerConsentDocuments({ ...DOCUMENTS, [missing]: "" });
      expect(config).toBeNull();
      const h = createHarness({ env: { consentDocuments: config } });
      expect(await onboardPartnerSeller(baseInput, h.deps)).toEqual({
        ok: false, state: "configuration_blocked", errorCode: "configuration_blocked",
      });
      expect(h.httpCalls).toEqual([]);
      expect(h.rpcCalls).toEqual([]);
    }
    expect(partnerConsentDocuments({ ...DOCUMENTS, termsUrl: "javascript:alert(1)" })).toBeNull();
    expect(partnerConsentDocuments({ ...DOCUMENTS, privacyUrl: "http://provider.test/privacy" })).toBeNull();
  });

  it("requires persisted original consent and a recoverable binding, never registers through recovery", async () => {
    for (const recoveryData of [null, {}, {
      owner_name: "Original", owner_email: "original@gerai-uji.id", owner_phone: "081234567890",
      consent_actor_id: "actor", consent_recorded_at: "2026-10-14T09:00:00Z",
      terms_version: "original", privacy_version: "original", onboarding_state: "not_connected",
    }]) {
      const h = createHarness({ recoveryData });
      const result = await recoverPartnerSellerKey(TENANT, h.deps);
      expect(result).toMatchObject({ ok: false, state: "rejected" });
      expect(result.ok ? "" : result.errorCode).toMatch(/consent_required|not_recoverable/);
      expect(h.httpCalls).toEqual([]);
      expect(h.rpcCalls.map((c) => c.fn)).toEqual(["begin_partner_seller_key_recovery"]);
    }
  });
});

// Exercise the remotely invocable actions with their real orchestrator and a substituted
// provider transport. Posted owner/version fields cannot become recovery or consent authority.
let actionHarness: OnboardingHarness;
const actionBindings: Record<string, string | undefined> = {};
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/credential-crypto", () => vi.importActual("../../src/lib/credential-crypto"));
vi.mock("@/lib/errors", () => vi.importActual("../../src/lib/errors"));
vi.mock("@/lib/mengantar/partner-onboarding", () => vi.importActual("../../src/lib/mengantar/partner-onboarding"));
vi.mock("@/lib/config", () => ({ config: (name: string) => actionBindings[name] }));
vi.mock("@/lib/db/server", () => ({ dbServer: async () => ({ rpc: (fn: string, args: Record<string, unknown>) => actionHarness.deps.rpc(fn, args) }), machineClient: async () => ({ rpc: (fn: string, args: Record<string, unknown>) => actionHarness.deps.machineRpc(fn, args) }) }));
vi.mock("@/lib/workspace", () => ({ requireWorkspace: async () => ({ role: "tenant_admin", isDemo: false, tenant: { id: TENANT } }) }));

describe("Partner consent and recovery server actions (T-034)", () => {
  it("ignores browser-posted versions and records the Worker-held document versions", async () => {
    actionHarness = createHarness();
    Object.assign(actionBindings, {
      MENGANTAR_ENV: "sandbox", MENGANTAR_PARTNER_SECRET: PARTNER_SECRET, CREDENTIAL_KEY: SEAL_KEY,
      PARTNER_TERMS_VERSION: DOCUMENTS.termsVersion, PARTNER_PRIVACY_VERSION: DOCUMENTS.privacyVersion,
      PARTNER_TERMS_URL: DOCUMENTS.termsUrl, PARTNER_PRIVACY_URL: DOCUMENTS.privacyUrl,
    });
    vi.stubGlobal("fetch", actionHarness.deps.fetchImpl);
    try {
      const form = new FormData();
      for (const [key, value] of Object.entries({
        owner_name: baseInput.ownerName, owner_email: baseInput.ownerEmail, owner_phone: baseInput.ownerPhone,
        consent_agreed: "on", terms_version: "browser-forged-terms", privacy_version: "browser-forged-privacy",
      })) form.set(key, value);
      expect(await registerPartnerSellerAction({}, form)).toHaveProperty("ok");
      expect(actionHarness.rpcCalls[0].args).toMatchObject({
        p_terms_version: DOCUMENTS.termsVersion, p_privacy_version: DOCUMENTS.privacyVersion,
      });
      expect(JSON.stringify(actionHarness.rpcCalls)).not.toContain("browser-forged");
    } finally { vi.unstubAllGlobals(); }
  });

  it("refuses a forged recovery form without persisted consent and makes zero Partner calls", async () => {
    actionHarness = createHarness({ recoveryData: null });
    const form = new FormData();
    form.set("owner_name", baseInput.ownerName);
    form.set("owner_email", baseInput.ownerEmail);
    form.set("owner_phone", baseInput.ownerPhone);
    expect(await recoverPartnerSellerKeyAction({}, form)).toEqual({
      error: "Centang persetujuan kepemilikan akun dan Ketentuan/Privasi Mengantar terlebih dahulu.",
    });
    expect(actionHarness.httpCalls).toEqual([]);
    expect(actionHarness.rpcCalls.map((c) => c.fn)).toEqual(["begin_partner_seller_key_recovery"]);
  });
});
