import { beforeEach, describe, expect, it, vi } from "vitest";
import { credentialAad, openCredential, sealCredential } from "../../src/lib/credential-crypto";
import { MengantarError } from "../../src/lib/mengantar/public-api";

const secrets: Record<string, string | undefined> = {};
let machineRpc: ((fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>) | null = null;

vi.mock("server-only", () => ({}));
vi.mock("@/lib/credential-crypto", () => ({ credentialAad, openCredential }));
vi.mock("@/lib/worker-secret", () => ({
  workerSecret: (name: string) => secrets[name],
}));
vi.mock("@/lib/supabase/machine", () => ({
  machineClient: () => (machineRpc ? { rpc: machineRpc } : null),
}));

const { mengantarFailure, tenantMengantar } = await import("../../src/lib/mengantar/tenant");

const TENANT_ID = "00000000-0000-4000-b000-00000000000a";
const CREDENTIAL_KEY = Buffer.alloc(32, 7).toString("base64");
const WRONG_KEY = Buffer.alloc(32, 9).toString("base64");
const API_KEY = "API-TENANTUNITTEST01";

describe("mengantarFailure (T-023 / T-028)", () => {
  it("maps MengantarError codes to stable error keys", () => {
    expect(mengantarFailure(new MengantarError("not_allowed"))).toBe("mengantar_key_refused");
    expect(mengantarFailure(new MengantarError("rejected"))).toBe("mengantar_refused");
    expect(mengantarFailure(new MengantarError("unavailable"))).toBe("mengantar_unavailable");
    expect(mengantarFailure(new MengantarError("malformed"))).toBe("mengantar_unavailable");
    expect(mengantarFailure(new Error("other"))).toBe("mengantar_unavailable");
  });
});

describe("tenantMengantar (T-023 / T-028)", () => {
  beforeEach(() => {
    for (const k of Object.keys(secrets)) delete secrets[k];
    secrets.MENGANTAR_ENV = "sandbox";
    secrets.CREDENTIAL_KEY = CREDENTIAL_KEY;
    machineRpc = vi.fn(async () => ({ data: null, error: null }));
  });

  it("fails closed with not_configured when MENGANTAR_ENV, CREDENTIAL_KEY or machineClient is missing", async () => {
    secrets.MENGANTAR_ENV = undefined;
    expect(await tenantMengantar(TENANT_ID)).toEqual({ ok: false, reason: "not_configured" });

    secrets.MENGANTAR_ENV = "staging";
    expect(await tenantMengantar(TENANT_ID)).toEqual({ ok: false, reason: "not_configured" });

    secrets.MENGANTAR_ENV = "sandbox";
    secrets.CREDENTIAL_KEY = undefined;
    expect(await tenantMengantar(TENANT_ID)).toEqual({ ok: false, reason: "not_configured" });

    secrets.CREDENTIAL_KEY = CREDENTIAL_KEY;
    machineRpc = null;
    expect(await tenantMengantar(TENANT_ID)).toEqual({ ok: false, reason: "not_configured" });
  });

  it("returns no_key when machine_seller_key RPC returns null or an error", async () => {
    machineRpc = vi.fn(async () => ({ data: null, error: null }));
    expect(await tenantMengantar(TENANT_ID)).toEqual({ ok: false, reason: "no_key" });
    expect(machineRpc).toHaveBeenCalledWith("machine_seller_key", { p_tenant: TENANT_ID });

    machineRpc = vi.fn(async () => ({ data: { ciphertext: "x", iv: "y", version: 1 }, error: { message: "db_down" } }));
    expect(await tenantMengantar(TENANT_ID)).toEqual({ ok: false, reason: "no_key" });
  });

  it("returns key_unreadable when openCredential fails due to wrong key or tampered AAD", async () => {
    const sealed = await sealCredential(API_KEY, credentialAad(TENANT_ID, 1), CREDENTIAL_KEY);
    machineRpc = vi.fn(async () => ({ data: { ...sealed, version: 1 }, error: null }));

    secrets.CREDENTIAL_KEY = WRONG_KEY;
    expect(await tenantMengantar(TENANT_ID)).toEqual({ ok: false, reason: "key_unreadable" });

    secrets.CREDENTIAL_KEY = CREDENTIAL_KEY;
    expect(await tenantMengantar("00000000-0000-4000-b000-00000000000b")).toEqual({
      ok: false,
      reason: "key_unreadable",
    });

    machineRpc = vi.fn(async () => ({ data: { ...sealed, version: 2 }, error: null }));
    expect(await tenantMengantar(TENANT_ID)).toEqual({ ok: false, reason: "key_unreadable" });
  });

  it("opens a valid sealed credential and returns a bound Mengantar client", async () => {
    const sealed = await sealCredential(API_KEY, credentialAad(TENANT_ID, 3), CREDENTIAL_KEY);
    machineRpc = vi.fn(async () => ({ data: { ...sealed, version: 3 }, error: null }));

    const res = await tenantMengantar(TENANT_ID);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.environment).toBe("sandbox");
      expect(typeof res.client.searchAreas).toBe("function");
      expect(typeof res.client.estimate).toBe("function");
    }
  });
});
