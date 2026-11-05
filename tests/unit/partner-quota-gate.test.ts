// T-110 / NFR-5 / RATE-1: every Partner request reserves the Partner-wide quota BEFORE it is signed. A
// denial sends nothing and surfaces as the retry-later `partner_quota_exhausted`; a provider throttle is
// stored for every caller; the callers treat a denial as "wait", never as a failure that triggers a resend.
import { describe, expect, it, vi } from "vitest";
import { createPartnerClient, PartnerError, rpcPartnerQuotaGate, type PartnerQuotaCall, type PartnerQuotaGate } from "../../src/lib/mengantar/partner-api";
import { onboardPartnerSeller, recoverPartnerSellerKey, type PartnerOnboardingDeps } from "../../src/lib/mengantar/partner-onboarding";
import { regeneratePartnerSellerKey } from "../../src/lib/mengantar/partner-key-rotation";

const SECRET = "offline-fixture-only-secret";
const NOW = 1758790800_000;
const TENANT = "00000000-0000-4000-b000-0000000000f1";
const EXTERNAL_ID = `geraiexpress:tenant:${TENANT}`;
const SELLER_ID = "66ab1234567890abcdef1234";
const SEAL_KEY = Buffer.alloc(32, 5).toString("base64");

function recordingGate(decision: Awaited<ReturnType<PartnerQuotaGate["reserve"]>>) {
  const reserved: PartnerQuotaCall[] = [];
  const noted: { until: number | null; scope: string }[] = [];
  const gate: PartnerQuotaGate = {
    reserve: async (call) => { reserved.push(call); return decision; },
    noteRetryAfter: async (until, scope) => { noted.push({ until, scope }); },
  };
  return { gate, reserved, noted };
}

function transport(reply: { status: number; body: unknown; headers?: Record<string, string> }) {
  const fetchImpl = vi.fn(async () => new Response(JSON.stringify(reply.body), {
    status: reply.status, headers: { "content-type": "application/json", ...reply.headers },
  }));
  return fetchImpl;
}

const seller = { name: "Budi", email: "budi@gerai-asli.id", phone: "081234567890", externalUserId: EXTERNAL_ID };
const caught = (p: Promise<unknown>) => p.then(() => null, (e: unknown) => e as PartnerError);

describe("Partner API quota gate (T-110)", () => {
  it("sends no request when the quota is denied, for every Partner endpoint", async () => {
    const { gate, reserved } = recordingGate({ allowed: false, reason: "quota", nextEligibleAt: NOW + 42_000 });
    const fetchImpl = transport({ status: 200, body: { success: true } });
    const api = createPartnerClient("sandbox", "partner-x", SECRET, gate, fetchImpl as unknown as typeof fetch, () => NOW);
    for (const call of [() => api.listSellers({ size: 1 }), () => api.registerSeller(seller), () => api.getSellerApiKey(SELLER_ID), () => api.regenerateSellerKey(SELLER_ID)]) {
      const error = await caught(call());
      expect(error).toBeInstanceOf(PartnerError);
      expect(error).toMatchObject({ code: "partner_quota_exhausted", status: null, retryAfterSeconds: 42 });
    }
    expect(fetchImpl).not.toHaveBeenCalled();
    // Only a registration counts a new seller; only the read-only list is non-mutating.
    expect(reserved).toEqual([
      { mutating: false, newSellerRef: null },
      { mutating: true, newSellerRef: EXTERNAL_ID },
      { mutating: true, newSellerRef: null },
      { mutating: true, newSellerRef: null },
    ]);
  });

  it("refuses with provider_fence_engaged, sending nothing, while the mutation fence is engaged", async () => {
    const { gate } = recordingGate({ allowed: false, reason: "fence", nextEligibleAt: null });
    const fetchImpl = transport({ status: 200, body: { success: true } });
    const api = createPartnerClient("sandbox", "partner-x", SECRET, gate, fetchImpl as unknown as typeof fetch, () => NOW);
    expect(await caught(api.regenerateSellerKey(SELLER_ID))).toMatchObject({ code: "provider_fence_engaged" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("records a provider Retry-After for the whole Partner account", async () => {
    const { gate, noted } = recordingGate({ allowed: true });
    const limited = transport({ status: 429, body: { success: false, code: "RATE_LIMITED" }, headers: { "retry-after": "30" } });
    const api = createPartnerClient("sandbox", "partner-x", SECRET, gate, limited as unknown as typeof fetch, () => NOW);
    expect(await caught(api.listSellers({ size: 1 }))).toMatchObject({ code: "RATE_LIMITED", retryAfterSeconds: 30 });
    expect(noted).toEqual([{ until: NOW + 30_000, scope: "request" }]);

    const daily = transport({ status: 429, body: { success: false, code: "DAILY_REGISTRATION_LIMIT" } });
    const api2 = createPartnerClient("sandbox", "partner-x", SECRET, gate, daily as unknown as typeof fetch, () => NOW);
    expect(await caught(api2.registerSeller(seller))).toMatchObject({ code: "DAILY_REGISTRATION_LIMIT" });
    // No Retry-After: the database applies the next WIB midnight for the new-seller scope.
    expect(noted.at(-1)).toEqual({ until: null, scope: "new_seller" });
    expect(limited).toHaveBeenCalledTimes(1);
  });

  it("the RPC gate fails closed and passes the call shape to reserve_partner_quota", async () => {
    const calls: { fn: string; args: Record<string, unknown> }[] = [];
    const answers: { data: unknown; error: { message: string } | null }[] = [
      { data: { allowed: true, reason: null, next_eligible_at: null }, error: null },
      { data: { allowed: false, reason: "minute_limit", next_eligible_at: new Date(NOW + 5000).toISOString() }, error: null },
      { data: null, error: { message: "provider_fence_engaged" } },
      { data: null, error: { message: "connection refused" } },
      { data: { allowed: "yes" }, error: null },
    ];
    const gate = rpcPartnerQuotaGate(async (fn, args) => { calls.push({ fn, args }); return answers.shift()!; }, "sandbox", "ongkirich");
    expect(await gate.reserve({ mutating: true, newSellerRef: EXTERNAL_ID })).toEqual({ allowed: true });
    expect(calls[0]).toEqual({ fn: "reserve_partner_quota", args: { p_env: "sandbox", p_partner: "ongkirich", p_cost: 1, p_new_seller_ref: EXTERNAL_ID, p_mutating: true } });
    expect(await gate.reserve({ mutating: false, newSellerRef: null })).toEqual({ allowed: false, reason: "quota", nextEligibleAt: NOW + 5000 });
    expect(await gate.reserve({ mutating: true, newSellerRef: null })).toEqual({ allowed: false, reason: "fence", nextEligibleAt: null });
    expect(await gate.reserve({ mutating: false, newSellerRef: null })).toEqual({ allowed: false, reason: "quota", nextEligibleAt: null });
    expect(await gate.reserve({ mutating: false, newSellerRef: null })).toEqual({ allowed: false, reason: "quota", nextEligibleAt: null });
    await gate.noteRetryAfter(NOW + 1000, "request");
    expect(calls.at(-1)).toEqual({ fn: "note_partner_retry_after", args: { p_env: "sandbox", p_partner: "ongkirich", p_until: new Date(NOW + 1000).toISOString(), p_scope: "request" } });
  });
});

describe("callers treat a quota denial as retry-later (T-110)", () => {
  function onboardingDeps(quota: PartnerQuotaGate, fetchImpl: typeof fetch, recovery = false) {
    const machineCalls: string[] = [];
    const deps: PartnerOnboardingDeps = {
      rpc: async (fn) => {
        if (fn === "begin_partner_seller_onboarding") {
          return { data: { external_user_id: EXTERNAL_ID, partner_seller_id: null, latest_credential_version: 0 }, error: null };
        }
        if (fn === "begin_partner_seller_key_recovery" && recovery) {
          return { data: {
            owner_name: "Budi", owner_email: "budi@gerai-asli.id", owner_phone: "081234567890", partner_seller_id: SELLER_ID,
            external_user_id: EXTERNAL_ID, latest_credential_version: 1, onboarding_state: "registered_key_pending",
            consent_actor_id: "actor", consent_recorded_at: "2026-10-14T09:00:00Z", terms_version: "t", privacy_version: "p",
          }, error: null };
        }
        return { data: null, error: null };
      },
      machineRpc: async (fn) => { machineCalls.push(fn); return { data: null, error: null }; },
      environment: "sandbox", partnerId: "ongkirich", partnerSecret: "partner-secret-0123456789", credentialKey: SEAL_KEY,
      consentDocuments: { termsVersion: "t", privacyVersion: "p", termsUrl: "https://provider.test/t", privacyUrl: "https://provider.test/p" },
      fetchImpl, now: () => NOW, quota,
    };
    return { deps, machineCalls };
  }

  it("onboarding: quota_wait with the wait, no request, no tenant outcome recorded", async () => {
    const { gate } = recordingGate({ allowed: false, reason: "quota", nextEligibleAt: NOW + 60_000 });
    const fetchImpl = vi.fn();
    const { deps, machineCalls } = onboardingDeps(gate, fetchImpl as unknown as typeof fetch);
    const result = await onboardPartnerSeller({ tenantId: TENANT, ownerName: "Budi", ownerEmail: "budi@gerai-asli.id", ownerPhone: "081234567890", agreed: true }, deps);
    expect(result).toEqual({ ok: false, state: "quota_wait", errorCode: "partner_quota_exhausted", sellerId: null, retryAfterSeconds: 60 });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(machineCalls).toEqual(["sync_partner_consent_versions"]);
  });

  it("key recovery of an existing seller is not a new seller and waits the same way", async () => {
    const { gate, reserved } = recordingGate({ allowed: false, reason: "quota", nextEligibleAt: null });
    const fetchImpl = vi.fn();
    const { deps } = onboardingDeps(gate, fetchImpl as unknown as typeof fetch, true);
    const result = await recoverPartnerSellerKey(TENANT, deps);
    expect(result).toMatchObject({ ok: false, state: "quota_wait", errorCode: "partner_quota_exhausted", sellerId: SELLER_ID });
    expect(reserved.every((c) => c.newSellerRef === null)).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  function rotationDeps(quota: PartnerQuotaGate, fetchImpl: typeof fetch, machineCalls: string[]) {
    return {
      rpc: async () => ({ data: {
        connection_mode: "partner_managed", onboarding_state: "connected", external_user_id: EXTERNAL_ID, partner_seller_id: SELLER_ID,
        last_error_code: null, retry_after_at: null, active_credential_mode: "partner", active_credential_version: 1, latest_credential_version: 1,
      }, error: null }),
      machineRpc: async (fn: string) => { machineCalls.push(fn); return { data: fn === "fence_partner_key_rotation" ? 1 : null, error: null }; },
      environment: "sandbox", partnerId: "ongkirich", partnerSecret: "partner-secret-0123456789", credentialKey: SEAL_KEY,
      fetchImpl, now: () => NOW, quota,
    };
  }
  const listOk = { success: true, data: { sellers: [{ sellerId: SELLER_ID, externalUserId: EXTERNAL_ID, active: true }], page: 1, size: 2, total: 1, totalPages: 1 } };

  it("key regeneration reserves 2 units BEFORE the key fence: a denial leaves the key unfenced and sends no regeneration", async () => {
    for (const [reason, code] of [["quota", "partner_quota_exhausted"], ["fence", "provider_fence_engaged"]] as const) {
      const reserved: PartnerQuotaCall[] = [];
      const gate: PartnerQuotaGate = {
        reserve: async (call) => { reserved.push(call); return call.cost === 2 ? { allowed: false, reason, nextEligibleAt: reason === "quota" ? NOW + 20_000 : null } : { allowed: true }; },
        noteRetryAfter: async () => {},
      };
      const fetchImpl = vi.fn(async () => new Response(JSON.stringify(listOk), { status: 200, headers: { "content-type": "application/json" } }));
      const machineCalls: string[] = [];
      const result = await regeneratePartnerSellerKey({ tenantId: TENANT, actorId: "00000000-0000-4000-a000-0000000000a1" },
        rotationDeps(gate, fetchImpl as unknown as typeof fetch, machineCalls));
      expect(result).toEqual(reason === "quota"
        ? { ok: false, state: "rejected", errorCode: code, retryAfterSeconds: 20 }
        : { ok: false, state: "rejected", errorCode: code });
      expect(machineCalls).toEqual([]);
      // Only the read-only sellers/list preflight was sent.
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(reserved).toEqual([{ mutating: false, newSellerRef: null }, { mutating: true, newSellerRef: null, cost: 2 }]);
    }
  });

  it("key regeneration with quota: the fence follows the reservation and the regeneration does not reserve again", async () => {
    const reserved: PartnerQuotaCall[] = [];
    const gate: PartnerQuotaGate = { reserve: async (call) => { reserved.push(call); return { allowed: true }; }, noteRetryAfter: async () => {} };
    const fetchImpl = vi.fn(async (url: string | URL | Request) => String(url).endsWith("/sellers/list")
      ? new Response(JSON.stringify(listOk), { status: 200, headers: { "content-type": "application/json" } })
      : new Response("gateway", { status: 504 }));
    const machineCalls: string[] = [];
    await regeneratePartnerSellerKey({ tenantId: TENANT, actorId: "00000000-0000-4000-a000-0000000000a1" },
      rotationDeps(gate, fetchImpl as unknown as typeof fetch, machineCalls));
    expect(machineCalls[0]).toBe("fence_partner_key_rotation");
    expect(reserved).toEqual([{ mutating: false, newSellerRef: null }, { mutating: true, newSellerRef: null, cost: 2 }]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("key regeneration preflight: rejected as retry-later, nothing fenced or sent", async () => {
    const { gate } = recordingGate({ allowed: false, reason: "quota", nextEligibleAt: NOW + 10_000 });
    const fetchImpl = vi.fn();
    const machineCalls: string[] = [];
    const result = await regeneratePartnerSellerKey({ tenantId: TENANT, actorId: "00000000-0000-4000-a000-0000000000a1" }, {
      rpc: async () => ({ data: {
        connection_mode: "partner_managed", onboarding_state: "connected", external_user_id: EXTERNAL_ID, partner_seller_id: SELLER_ID,
        last_error_code: null, retry_after_at: null, active_credential_mode: "partner", active_credential_version: 1, latest_credential_version: 1,
      }, error: null }),
      machineRpc: async (fn) => { machineCalls.push(fn); return { data: null, error: null }; },
      environment: "sandbox", partnerId: "ongkirich", partnerSecret: "partner-secret-0123456789", credentialKey: SEAL_KEY,
      fetchImpl: fetchImpl as unknown as typeof fetch, now: () => NOW, quota: gate,
    });
    expect(result).toEqual({ ok: false, state: "rejected", errorCode: "partner_quota_exhausted", retryAfterSeconds: 10 });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(machineCalls).toEqual([]);
  });
});
