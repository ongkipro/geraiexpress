// T-039 / PR-19 / DEC-013: Partner key regeneration and recovery orchestration. The database is a
// small in-memory model of the real functions (tests/db/partner-key-rotation.test.ts proves those);
// the provider is a scripted transport whose bodies come from the Partner documentation fixtures.

import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { credentialAad, credentialHint, openCredential } from "../../src/lib/credential-crypto";
import {
  recoverRotatedPartnerSellerKey,
  regeneratePartnerSellerKey,
  type KeyRotationDeps,
  type KeyRotationResult,
} from "../../src/lib/mengantar/partner-key-rotation";

const TENANT = "00000000-0000-4000-b000-0000000000a1";
const ACTOR = "00000000-0000-4000-a000-0000000000a1";
const SELLER_ID = "66ab1234567890abcdef1234";
const PARTNER_SECRET = "test_offline-fixture-partner-secret-01";
const SEAL_KEY = Buffer.alloc(32, 11).toString("base64");
const NOW = 1758790800_000;
const fixtureText = (name: string) => readFileSync(new URL(`fixtures/mengantar/${name}`, import.meta.url), "utf8");

type Reply = { status: number; body: string; headers?: Record<string, string> } | "throw";
const json = (status: number, name: string, headers?: Record<string, string>): Reply => ({ status, body: fixtureText(name), headers });
const LIST_OK = json(200, "partner-sellers-list-one.json");
const REGENERATED = json(200, "partner-regenerate-success.json");
const CURRENT_KEY = json(200, "partner-api-key-current.json");

type Credential = { mode: "partner" | "byok"; version: number };
type Model = {
  state: string;
  connectionMode: string;
  sellerId: string | null;
  latest: number;
  active: Credential | null;
  errorCode: string | null;
  retryAfter: number | null;
  stored: { version: number; source: string; ciphertext: string; iv: string; keyVersion: string; hint: string }[];
};

type Options = {
  model?: Partial<Model>;
  list?: Reply;
  regenerate?: Reply;
  current?: Reply;
  // Runs inside the database model right before the named function, to simulate a concurrent writer.
  before?: Record<string, (model: Model) => void>;
  storeThrows?: boolean;
  env?: Partial<KeyRotationDeps>;
};

function harness(opts: Options = {}) {
  const model: Model = {
    state: "connected", connectionMode: "partner_managed", sellerId: SELLER_ID, latest: 2,
    active: { mode: "partner", version: 2 }, errorCode: null, retryAfter: null, stored: [], ...opts.model,
  };
  const log: { kind: "rpc" | "machine" | "http"; name: string; args?: Record<string, unknown> }[] = [];
  const err = (message: string) => ({ data: null, error: { message } });

  const rpc: KeyRotationDeps["rpc"] = async (fn, args) => {
    log.push({ kind: "rpc", name: fn, args });
    if (fn !== "begin_partner_key_rotation") throw new Error(`${fn} must go through the machine client`);
    // Mirrors private.require_partner_available (T-054): the database refuses before returning facts.
    if (model.state === "provider_restricted") return err("provider_restricted");
    if (model.retryAfter != null && model.retryAfter > 0) return err("partner_retry_after");
    return {
      data: {
        connection_mode: model.connectionMode, onboarding_state: model.state,
        external_user_id: `geraiexpress:tenant:${TENANT}`, partner_seller_id: model.sellerId,
        last_error_code: model.errorCode, retry_after_at: model.retryAfter == null ? null : new Date(NOW + model.retryAfter * 1000).toISOString(),
        active_credential_mode: model.active?.mode ?? null, active_credential_version: model.active?.version ?? null,
        latest_credential_version: model.latest,
      },
      error: null,
    };
  };

  const machineRpc: KeyRotationDeps["machineRpc"] = async (fn, args) => {
    // T-110: the Partner-wide quota gate allows every request here (covered by partner-quota-gate.test.ts).
    if (fn === "reserve_partner_quota") return { data: { allowed: true, reason: null, next_eligible_at: null }, error: null };
    if (fn === "note_partner_retry_after") return { data: null, error: null };
    if (fn === "machine_partner_id") return { data: null, error: null };
    log.push({ kind: "machine", name: fn, args });
    if (fn === "begin_partner_key_rotation") throw new Error("begin must use the caller's session");
    opts.before?.[fn]?.(model);
    if (args.p_actor !== ACTOR || args.p_tenant !== TENANT || args.p_seller_id !== model.sellerId) return err("admin_required");
    if (args.p_expected_version !== model.latest) return err("stale_state");
    if (fn === "record_partner_preflight_failure") {
      model.errorCode = String(args.p_error_code);
      model.retryAfter = (args.p_retry_after_seconds as number | null) ?? null;
      if (model.errorCode !== "RATE_LIMITED") model.state = "provider_restricted";
      return { data: null, error: null };
    }
    if (fn === "fence_partner_key_rotation") {
      if (!model.active) return err("stale_state");
      if (model.active.mode !== "partner") return err("byok_active");
      if (model.state !== "connected") return err("rotation_not_available");
      model.active = null; model.state = "rotation_unknown"; model.errorCode = "ROTATION_STARTED"; model.retryAfter = null;
      return { data: model.latest, error: null };
    }
    if (model.active) return err(model.active.mode === "byok" ? "byok_active" : "stale_state");
    if (model.state !== "rotation_unknown") return err("rotation_not_available");
    if (fn === "record_partner_key_rotation_outcome") {
      model.state = String(args.p_state); model.errorCode = String(args.p_error_code);
      model.retryAfter = (args.p_retry_after_seconds as number | null) ?? null;
      return { data: null, error: null };
    }
    if (fn === "store_partner_seller_key") {
      if (opts.storeThrows) throw new Error("network down");
      model.stored.push({
        version: model.latest + 1, source: String(args.p_source), ciphertext: String(args.p_ciphertext),
        iv: String(args.p_iv), keyVersion: String(args.p_key_version), hint: String(args.p_hint),
      });
      model.latest += 1; model.active = { mode: "partner", version: model.latest };
      model.state = "connected"; model.errorCode = null; model.retryAfter = null;
      return { data: model.latest, error: null };
    }
    throw new Error(`unexpected function ${fn}`);
  };

  const fetchImpl = (async (url: string | URL | Request) => {
    const path = new URL(String(url)).pathname;
    log.push({ kind: "http", name: path });
    const reply = path.endsWith("/sellers/list") ? opts.list ?? LIST_OK
      : path.endsWith("/api-key/regenerate") ? opts.regenerate ?? REGENERATED
      : path.endsWith("/api-key") ? opts.current ?? CURRENT_KEY
      : "throw";
    if (reply === "throw") throw new TypeError("fetch failed");
    return new Response(reply.body, { status: reply.status, headers: { "content-type": "application/json", ...reply.headers } });
  }) as typeof fetch;

  const deps: KeyRotationDeps = {
    rpc, machineRpc, environment: "sandbox", partnerId: "ongkirich", partnerSecret: PARTNER_SECRET,
    credentialKey: SEAL_KEY, fetchImpl, now: () => NOW, ...opts.env,
  };
  const http = () => log.filter((e) => e.kind === "http").map((e) => e.name.replace("/api/partner/v1/sellers", ""));
  const machineCalls = () => log.filter((e) => e.kind === "machine").map((e) => e.name);
  return { deps, model, log, http, machineCalls };
}

const input = { tenantId: TENANT, actorId: ACTOR };
const failed = (result: KeyRotationResult) => {
  if (result.ok) throw new Error("expected a failure");
  return result;
};

afterEach(() => vi.restoreAllMocks());

describe("regeneration", () => {
  it("fences first, regenerates once, seals the new key for version latest+1 and stores it before anything uses it", async () => {
    const h = harness();
    const result = await regeneratePartnerSellerKey(input, h.deps);
    expect(result).toMatchObject({ ok: true, state: "connected", version: 3 });
    expect(h.log.map((e) => `${e.kind}:${e.name.replace("/api/partner/v1/sellers", "")}`)).toEqual([
      "rpc:begin_partner_key_rotation", "http:/list", "machine:fence_partner_key_rotation",
      "http:/api-key/regenerate", "machine:store_partner_seller_key",
    ]);
    // Nothing after the store touches the provider: the key is stored before any use.
    expect(h.log.at(-1)).toMatchObject({ kind: "machine", name: "store_partner_seller_key" });
    const stored = h.model.stored[0];
    expect(stored).toMatchObject({ version: 3, source: "regenerated", hint: credentialHint("API-NEWKEY8F2QX7ZB1MT") });
    expect(await openCredential(stored, credentialAad(TENANT, 3), SEAL_KEY)).toBe("API-NEWKEY8F2QX7ZB1MT");
    // The ciphertext is bound to version 3: it does not open as another version or tenant.
    await expect(openCredential(stored, credentialAad(TENANT, 2), SEAL_KEY)).rejects.toThrow();
    expect(h.model).toMatchObject({ state: "connected", active: { mode: "partner", version: 3 } });
    // Every machine call names the verified actor, tenant and seller; the browser supplies none of them.
    for (const call of h.log.filter((e) => e.kind === "machine")) {
      expect(call.args).toMatchObject({ p_tenant: TENANT, p_actor: ACTOR, p_seller_id: SELLER_ID });
    }
  });

  it("ignores callbackSecret entirely: not stored, not sent to the database, not logged, not returned", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    for (const name of ["partner-regenerate-success.json", "partner-regenerate-success-no-webhook.json"]) {
      const h = harness({ regenerate: json(200, name) });
      const result = await regeneratePartnerSellerKey(input, h.deps);
      expect(result.ok).toBe(true);
      const everything = JSON.stringify({ result, calls: h.log, model: h.model });
      expect(everything).not.toContain("CALLBACK-SECRET");
      expect(everything).not.toContain("cbs-");
      expect(everything).not.toContain("callbackSecret");
      expect(everything).not.toContain("API-NEWKEY8F2QX7ZB1MT");
    }
    for (const spy of spies) expect(JSON.stringify(spy.mock.calls)).not.toContain("CALLBACK-SECRET");
  });

  it("refuses to touch a BYOK credential: no provider call and no write", async () => {
    const h = harness({ model: { active: { mode: "byok", version: 2 } } });
    expect(failed(await regeneratePartnerSellerKey(input, h.deps))).toMatchObject({ state: "rejected", errorCode: "byok_active" });
    expect(h.http()).toEqual([]);
    expect(h.machineCalls()).toEqual([]);
    expect(h.model.active).toEqual({ mode: "byok", version: 2 });
  });

  it("refuses tenants that are not Partner-managed or not in a connected state, before any provider call", async () => {
    for (const [model, code] of [
      [{ connectionMode: "byok", sellerId: null, active: null }, "not_partner_managed"],
      [{ state: "rotation_unknown", active: null }, "rotation_not_available"],
      [{ state: "provider_restricted", active: null }, "partner_restricted"],
    ] as const) {
      const h = harness({ model });
      expect(failed(await regeneratePartnerSellerKey(input, h.deps)).errorCode).toBe(code);
      expect(h.http()).toEqual([]);
      expect(h.machineCalls()).toEqual([]);
    }
  });

  it("maps the database's stop and retry-window refusals to their UI states, before any provider call (T-054)", async () => {
    for (const [model, expected] of [
      [{ state: "provider_restricted", active: null }, { state: "provider_restricted", errorCode: "partner_restricted" }],
      [{ retryAfter: 120 }, { state: "rejected", errorCode: "rotation_rate_limited" }],
      [{ state: "rotation_unknown", active: null, retryAfter: 120 }, { state: "rejected", errorCode: "rotation_rate_limited" }],
    ] as const) {
      const h = harness({ model });
      expect(failed(await regeneratePartnerSellerKey(input, h.deps))).toMatchObject(expected);
      expect(failed(await recoverRotatedPartnerSellerKey(input, h.deps))).toMatchObject(expected);
      expect(h.http()).toEqual([]);
      expect(h.machineCalls()).toEqual([]);
    }
  });

  it("does not call the provider when it is not configured or the sealing key is unusable", async () => {
    for (const env of [{ partnerSecret: "short" }, { environment: "production" }, { credentialKey: "" }, { credentialKey: "not-base64-!!" }]) {
      const h = harness({ env });
      expect(failed(await regeneratePartnerSellerKey(input, h.deps))).toMatchObject({ state: "configuration_blocked", errorCode: "partner_not_configured" });
      expect(h.http()).toEqual([]);
      expect(h.machineCalls()).toEqual([]);
    }
  });
});

describe("binding, version fence and races", () => {
  it("makes no regenerate call when sellers/list does not return the stored seller, and fails closed", async () => {
    const otherSeller = { status: 200, body: fixtureText("partner-sellers-list-one.json").replace(SELLER_ID, "66ab1234567890abcdef9999") };
    const empty = { status: 200, body: JSON.stringify({ success: true, data: { sellers: [], total: 0 } }) };
    for (const list of [otherSeller, empty]) {
      const h = harness({ list });
      expect(failed(await regeneratePartnerSellerKey(input, h.deps))).toMatchObject({ state: "configuration_blocked", errorCode: "seller_binding_mismatch" });
      expect(h.http()).toEqual(["/list"]);
      expect(h.machineCalls()).toEqual(["fence_partner_key_rotation", "record_partner_key_rotation_outcome"]);
      expect(h.log.find((e) => e.name === "record_partner_key_rotation_outcome")?.args)
        .toMatchObject({ p_state: "configuration_blocked", p_error_code: "SELLER_BINDING_MISMATCH" });
      expect(h.model.state).toBe("configuration_blocked");
      expect(h.model.active).toBeNull();
    }
  });

  it("pauses nothing when the read-only verification fails", async () => {
    const h = harness({ list: "throw" });
    expect(failed(await regeneratePartnerSellerKey(input, h.deps))).toMatchObject({ state: "rejected", errorCode: "mengantar_unavailable" });
    expect(h.machineCalls()).toEqual([]);
    expect(h.model.active).toEqual({ mode: "partner", version: 2 });
    const limited = harness({ list: json(429, "partner-error-rate-limited.json", { "retry-after": "9" }) });
    expect(failed(await regeneratePartnerSellerKey(input, limited.deps))).toMatchObject({ errorCode: "rotation_rate_limited", retryAfterSeconds: 9 });
    expect(limited.machineCalls()).toEqual(["record_partner_preflight_failure"]);
    expect(limited.model.retryAfter).toBe(9);
    const calls = limited.http().length;
    await regeneratePartnerSellerKey(input, limited.deps);
    expect(limited.http()).toHaveLength(calls);
  });

  it("stores only tenant-level stops before the fence; Partner-wide refusals lock nobody out (T-054 review M1)", async () => {
    const reply = (code: string): Reply => ({ status: 403, body: JSON.stringify({ success: false, code, message: "Forbidden" }) });
    for (const code of ["IP_NOT_ALLOWED", "PARTNER_DEACTIVATED"]) {
      const h = harness({ list: reply(code) });
      expect(failed(await regeneratePartnerSellerKey(input, h.deps))).toMatchObject({ state: "rejected", errorCode: "partner_restricted" });
      expect(h.machineCalls()).toEqual([]);
      expect(h.model).toMatchObject({ state: "connected", active: { mode: "partner", version: 2 } });
    }
    for (const code of ["SELLER_DEACTIVATED", "API_KEY_DISABLED"]) {
      const h = harness({ list: reply(code) });
      expect(failed(await regeneratePartnerSellerKey(input, h.deps))).toMatchObject({ state: "provider_restricted", errorCode: "partner_restricted" });
      expect(h.machineCalls()).toEqual(["record_partner_preflight_failure"]);
      expect(h.model).toMatchObject({ state: "provider_restricted", errorCode: code });
    }
  });

  it("a BYOK key stored between begin and the fence is stale_state: no regenerate call, the BYOK key stays active", async () => {
    const h = harness({ before: { fence_partner_key_rotation: (m) => { m.latest = 3; m.active = { mode: "byok", version: 3 }; } } });
    expect(failed(await regeneratePartnerSellerKey(input, h.deps))).toMatchObject({ state: "rejected", errorCode: "stale_state" });
    expect(h.http()).toEqual(["/list"]);
    expect(h.model.active).toEqual({ mode: "byok", version: 3 });
    expect(h.model.stored).toEqual([]);
  });

  it("a BYOK key stored after the provider rotated is never replaced by the regenerated key", async () => {
    const h = harness({ before: { store_partner_seller_key: (m) => { m.latest = 3; m.active = { mode: "byok", version: 3 }; } } });
    expect(failed(await regeneratePartnerSellerKey(input, h.deps))).toMatchObject({ state: "rejected", errorCode: "byok_active" });
    expect(h.model.active).toEqual({ mode: "byok", version: 3 });
    expect(h.model.stored).toEqual([]);
  });
});

describe("lost response and recovery", () => {
  it("a lost response leaves a durable unknown marker; recovery fetches the current key and stores it without rotating again", async () => {
    const h = harness({ regenerate: "throw" });
    const lost = failed(await regeneratePartnerSellerKey(input, h.deps));
    expect(lost).toMatchObject({ state: "rotation_unknown", errorCode: "rotation_unknown" });
    expect(h.http()).toEqual(["/list", "/api-key/regenerate"]); // one attempt, never replayed
    expect(h.model).toMatchObject({ state: "rotation_unknown", active: null, errorCode: "UNAVAILABLE", stored: [] });

    // Recovery: verify the binding, then the GET endpoint (not regenerate), then store version 3.
    const before = h.http().length;
    const recovered = await recoverRotatedPartnerSellerKey(input, h.deps);
    expect(recovered).toMatchObject({ ok: true, state: "connected", version: 3 });
    expect(h.http().slice(before)).toEqual(["/list", "/api-key"]);
    expect(h.http().filter((p) => p === "/api-key/regenerate")).toHaveLength(1);
    expect(h.model.stored[0]).toMatchObject({ source: "recovered", version: 3 });
    expect(await openCredential(h.model.stored[0], credentialAad(TENANT, 3), SEAL_KEY)).toBe("API-CURRENTKEY3F9K2QX");
    expect(h.model).toMatchObject({ state: "connected", errorCode: null, active: { mode: "partner", version: 3 } });
  });

  it("treats 5xx, unreadable and inconsistent answers as unknown, never as a failed rotation", async () => {
    for (const regenerate of [
      { status: 502, body: "<html>", headers: { "content-type": "text/html" } },
      { status: 500, body: JSON.stringify({ success: false, code: "INTERNAL_ERROR" }) },
      { status: 200, body: "not json" },
      { status: 200, body: JSON.stringify({ success: true, data: { sellerId: "66ab1234567890abcdef9999", apiKey: "API-NEWKEY8F2QX7ZB1MT" } }) },
    ] as Reply[]) {
      const h = harness({ regenerate });
      expect(failed(await regeneratePartnerSellerKey(input, h.deps))).toMatchObject({ state: "rotation_unknown" });
      expect(h.model).toMatchObject({ state: "rotation_unknown", active: null });
      expect(h.http().filter((p) => p.endsWith("/regenerate"))).toHaveLength(1);
    }
  });

  it("a new key that cannot be stored keeps the marker so recovery can fetch it", async () => {
    const h = harness({ storeThrows: true });
    expect(failed(await regeneratePartnerSellerKey(input, h.deps))).toMatchObject({ state: "rotation_unknown", errorCode: "rotation_store_failed" });
    expect(h.model).toMatchObject({ state: "rotation_unknown", errorCode: "STORE_FAILED", active: null });
    const h2 = { ...h, deps: { ...h.deps } };
    expect(failed(await recoverRotatedPartnerSellerKey(input, h2.deps)).state).toBe("rotation_unknown"); // store still down
  });

  it("recovery is only available while the marker is set and never for BYOK", async () => {
    const connected = harness();
    expect(failed(await recoverRotatedPartnerSellerKey(input, connected.deps)).errorCode).toBe("rotation_not_available");
    expect(connected.http()).toEqual([]);
    const byok = harness({ model: { state: "rotation_unknown", active: { mode: "byok", version: 3 }, latest: 3 } });
    expect(failed(await recoverRotatedPartnerSellerKey(input, byok.deps)).errorCode).toBe("byok_active");
    expect(byok.http()).toEqual([]);
    const raced = harness({ model: { state: "rotation_unknown", active: null }, before: { store_partner_seller_key: (m) => { m.latest = 3; m.active = { mode: "byok", version: 3 }; } } });
    expect(failed(await recoverRotatedPartnerSellerKey(input, raced.deps)).errorCode).toBe("byok_active");
    expect(raced.model.active).toEqual({ mode: "byok", version: 3 });
  });

  it("recovery from a mismatching seller list fetches no key", async () => {
    const h = harness({ model: { state: "rotation_unknown", active: null }, list: { status: 200, body: JSON.stringify({ success: true, data: { sellers: [], total: 0 } }) } });
    expect(failed(await recoverRotatedPartnerSellerKey(input, h.deps))).toMatchObject({ state: "configuration_blocked", errorCode: "seller_binding_mismatch" });
    expect(h.http()).toEqual(["/list"]);
  });
});

describe("stop states and provider refusals", () => {
  it.each([
    ["SELLER_DEACTIVATED", "partner-error-seller-deactivated.json"],
    ["API_KEY_DISABLED", "partner-error-api-key-disabled.json"],
  ])("%s ends the flow with a clear message, records provider_restricted and is never retried", async (code, file) => {
    const h = harness({ regenerate: json(403, file) });
    expect(failed(await regeneratePartnerSellerKey(input, h.deps))).toMatchObject({ state: "provider_restricted", errorCode: "rotation_restricted" });
    expect(h.http()).toEqual(["/list", "/api-key/regenerate"]);
    expect(h.model).toMatchObject({ state: "provider_restricted", errorCode: code, active: null, retryAfter: null });
    // Neither a second click nor recovery reaches the provider again.
    expect(failed(await regeneratePartnerSellerKey(input, h.deps)).errorCode).toBe("partner_restricted");
    expect(failed(await recoverRotatedPartnerSellerKey(input, h.deps)).errorCode).toBe("partner_restricted");
    expect(h.http()).toHaveLength(2);
  });

  it("a stop state during recovery also ends the flow", async () => {
    const h = harness({ model: { state: "rotation_unknown", active: null }, current: json(403, "partner-error-api-key-disabled.json") });
    expect(failed(await recoverRotatedPartnerSellerKey(input, h.deps))).toMatchObject({ state: "provider_restricted", errorCode: "rotation_restricted" });
    expect(h.model.state).toBe("provider_restricted");
    expect(h.http()).toEqual(["/list", "/api-key"]);
  });

  it("SELLER_NOT_FOUND from the provider is a binding failure", async () => {
    const h = harness({ regenerate: json(404, "partner-error-seller-not-found.json") });
    expect(failed(await regeneratePartnerSellerKey(input, h.deps))).toMatchObject({ state: "configuration_blocked", errorCode: "seller_binding_mismatch" });
    expect(h.model).toMatchObject({ state: "configuration_blocked", errorCode: "SELLER_BINDING_MISMATCH" });
    expect(h.http()).toEqual(["/list", "/api-key/regenerate"]);
  });

  it("429 records Retry-After, keeps the marker and does not retry", async () => {
    const h = harness({ regenerate: json(429, "partner-error-rate-limited.json", { "retry-after": "23" }) });
    expect(failed(await regeneratePartnerSellerKey(input, h.deps))).toMatchObject({ state: "rotation_unknown", errorCode: "rotation_rate_limited", retryAfterSeconds: 23 });
    expect(h.model).toMatchObject({ state: "rotation_unknown", errorCode: "RATE_LIMITED", retryAfter: 23 });
    expect(h.http()).toEqual(["/list", "/api-key/regenerate"]);
    // A missing Retry-After is unknown, never "retry now".
    const quiet = harness({ regenerate: json(429, "partner-error-rate-limited.json") });
    await regeneratePartnerSellerKey(input, quiet.deps);
    expect(quiet.model.retryAfter).toBeNull();
  });

  it("a refusal that provably changed nothing (UNAUTHORIZED) keeps the marker for recovery", async () => {
    const h = harness({ regenerate: { status: 401, body: JSON.stringify({ success: false, code: "UNAUTHORIZED" }) } });
    expect(failed(await regeneratePartnerSellerKey(input, h.deps))).toMatchObject({ state: "rotation_unknown", errorCode: "rotation_refused" });
    expect(h.model.state).toBe("rotation_unknown");
  });
});

// The remotely invocable actions: role and demo refusal, explicit confirmation, no browser-supplied
// tenant, seller or version, and Bahasa messages that never carry a key.
let actionHarness: ReturnType<typeof harness>;
let workspace: { role: string; isDemo: boolean };
const bindings: Record<string, string | undefined> = {
  MENGANTAR_ENV: "sandbox", MENGANTAR_PARTNER_SECRET: PARTNER_SECRET, CREDENTIAL_KEY: SEAL_KEY,
};
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/credential-crypto", () => vi.importActual("../../src/lib/credential-crypto"));
vi.mock("@/lib/errors", () => vi.importActual("../../src/lib/errors"));
vi.mock("@/lib/mengantar/partner-onboarding", () => vi.importActual("../../src/lib/mengantar/partner-onboarding"));
vi.mock("@/lib/mengantar/partner-key-rotation", () => vi.importActual("../../src/lib/mengantar/partner-key-rotation"));
vi.mock("@/lib/config", () => ({ config: (name: string) => bindings[name] }));
vi.mock("@/lib/db/server", () => ({ dbServer: async () => ({ rpc: (fn: string, args: Record<string, unknown>) => actionHarness.deps.rpc(fn, args) }), machineClient: async () => ({ rpc: (fn: string, args: Record<string, unknown>) => actionHarness.deps.machineRpc(fn, args) }) }));
vi.mock("@/lib/workspace", () => ({ requireWorkspace: async () => ({ ...workspace, userId: ACTOR, tenant: { id: TENANT } }) }));

describe("key rotation server actions (T-039)", () => {
  // The actions build their Partner client with the global fetch. It must never reach a network:
  // every call goes to the scripted provider of the current harness.
  beforeEach(() => {
    vi.stubGlobal("fetch", ((url: string | URL | Request, init?: RequestInit) => actionHarness.deps.fetchImpl!(url, init)) as typeof fetch);
  });
  afterEach(() => vi.unstubAllGlobals());

  const form = (fields: Record<string, string> = {}) => {
    const data = new FormData();
    for (const [key, value] of Object.entries(fields)) data.set(key, value);
    return data;
  };

  it("refuses operators and demo tenants before any call", async () => {
    const { regeneratePartnerKeyAction, recoverRotatedPartnerKeyAction } = await import("../../src/modules/credentials/rotation-actions");
    for (const ws of [{ role: "operator", isDemo: false }, { role: "tenant_admin", isDemo: true }]) {
      workspace = ws;
      actionHarness = harness();
      for (const result of [
        await regeneratePartnerKeyAction({}, form({ confirm_regenerate: "yes" })),
        await recoverRotatedPartnerKeyAction({}, form()),
      ]) expect(result.error).toMatch(/Hanya admin gerai/);
      expect(actionHarness.log).toEqual([]);
    }
  });

  it("needs the explicit confirmation and never takes tenant, seller or version from the browser", async () => {
    const { regeneratePartnerKeyAction } = await import("../../src/modules/credentials/rotation-actions");
    workspace = { role: "tenant_admin", isDemo: false };
    actionHarness = harness();
    expect((await regeneratePartnerKeyAction({}, form())).error).toMatch(/Konfirmasi dulu/);
    expect(actionHarness.log).toEqual([]);

    const forged = form({ confirm_regenerate: "yes", p_tenant: "forged", tenant_id: "forged", seller_id: "forged", latest_version: "99" });
    const result = await regeneratePartnerKeyAction({}, forged);
    expect(result).toEqual({ ok: "Kunci API baru dibuat dan disimpan terenkripsi. Kunci lama sudah tidak berlaku." });
    expect(JSON.stringify(actionHarness.log)).not.toContain("forged");
    expect(JSON.stringify(result)).not.toMatch(/API-NEWKEY|callback/i);
  });

  it("answers a lost response, then recovery, in Bahasa without exposing a key", async () => {
    const { regeneratePartnerKeyAction, recoverRotatedPartnerKeyAction } = await import("../../src/modules/credentials/rotation-actions");
    workspace = { role: "tenant_admin", isDemo: false };
    actionHarness = harness({ regenerate: "throw" });
    const lost = await regeneratePartnerKeyAction({}, form({ confirm_regenerate: "yes" }));
    expect(lost.error).toMatch(/Hasil pembuatan ulang kunci belum pasti/);
    const recovered = await recoverRotatedPartnerKeyAction({}, form());
    expect(recovered.ok).toMatch(/Kunci API terbaru diambil/);
    expect(JSON.stringify([lost, recovered])).not.toMatch(/API-|callback/i);
  });

  it("tells a BYOK tenant to rotate in the Mengantar dashboard", async () => {
    const { regeneratePartnerKeyAction } = await import("../../src/modules/credentials/rotation-actions");
    workspace = { role: "tenant_admin", isDemo: false };
    actionHarness = harness({ model: { active: { mode: "byok", version: 2 } } });
    const result = await regeneratePartnerKeyAction({}, form({ confirm_regenerate: "yes" }));
    expect(result.error).toMatch(/BYOK/);
    expect(result.error).toMatch(/dashboard Mengantar/);
    expect(actionHarness.http()).toEqual([]);
  });

  it("reports the stop state without suggesting a retry", async () => {
    const { regeneratePartnerKeyAction } = await import("../../src/modules/credentials/rotation-actions");
    workspace = { role: "tenant_admin", isDemo: false };
    actionHarness = harness({ regenerate: json(403, "partner-error-api-key-disabled.json") });
    const result = await regeneratePartnerKeyAction({}, form({ confirm_regenerate: "yes" }));
    expect(result.error).toMatch(/dihentikan dan tidak dicoba lagi/);
    expect(actionHarness.http()).toHaveLength(2);
  });
});
