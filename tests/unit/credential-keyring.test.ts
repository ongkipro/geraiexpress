import { describe, expect, it } from "vitest";
import { credentialAad, openCredential, sealCredential } from "../../src/lib/credential-crypto";
import { reencryptCredentials, type RewrapRpc } from "../../src/lib/credential-keyring";

const K1 = Buffer.alloc(32, 7).toString("base64");
const K2 = Buffer.alloc(32, 11).toString("base64");
const V1 = K1;
const V2 = { current: "v2", keys: { v1: K1, v2: K2 } };
const TENANT_A = "00000000-0000-4000-b000-00000000000a";
const TENANT_B = "00000000-0000-4000-b000-00000000000b";
const TENANT_C = "00000000-0000-4000-b000-00000000000c";
const PLAIN = "API-REWRAPTEST000001";

type Row = { ciphertext: string; iv: string; key_version: string; version: number };

// A fake machine client over an in-memory table that enforces the database fence.
function fakeClient(rows: Map<string, Row>) {
  const calls: string[] = [];
  const rpc: RewrapRpc = async (fn, args) => {
    calls.push(fn);
    if (fn === "machine_seller_key") {
      expect(args.p_env).toBe("sandbox");
      return { data: rows.get(String(args.p_tenant)) ?? null, error: null };
    }
    const row = rows.get(String(args.p_tenant));
    if (!row || row.version !== args.p_version || row.key_version !== args.p_expected_key_version) {
      return { data: null, error: { message: "stale_state", code: "55000" } };
    }
    rows.set(String(args.p_tenant), { ...row, ciphertext: String(args.p_ciphertext), iv: String(args.p_iv), key_version: String(args.p_new_key_version) });
    return { data: null, error: null };
  };
  return { rpc, calls };
}

async function seed() {
  const rows = new Map<string, Row>();
  const a = await sealCredential(PLAIN, credentialAad(TENANT_A, 2), V1);
  rows.set(TENANT_A, { ciphertext: a.ciphertext, iv: a.iv, key_version: a.keyVersion, version: 2 });
  const b = await sealCredential(PLAIN, credentialAad(TENANT_B, 5), V2);
  rows.set(TENANT_B, { ciphertext: b.ciphertext, iv: b.iv, key_version: b.keyVersion, version: 5 });
  return rows; // TENANT_C has no credential
}

describe("reencryptCredentials (SEC-7)", () => {
  it("re-seals only rows on an old key version, under the same credential version and AAD", async () => {
    const rows = await seed();
    const before = { ...rows.get(TENANT_B)! };
    const { rpc } = fakeClient(rows);
    const summary = await reencryptCredentials({ rpc, key: V2, environment: "sandbox", tenantIds: [TENANT_A, TENANT_B, TENANT_C] });
    expect(summary).toEqual({ scanned: 3, rewrapped: 1, alreadyCurrent: 1, noCredential: 1, conflicts: 0, failed: [] });
    const a = rows.get(TENANT_A)!;
    expect(a.key_version).toBe("v2");
    expect(a.version).toBe(2);
    expect(await openCredential(a, credentialAad(TENANT_A, 2), V2)).toBe(PLAIN);
    // The new ciphertext no longer opens under key v1 alone.
    await expect(openCredential({ ...a, key_version: "v1" }, credentialAad(TENANT_A, 2), V1)).rejects.toThrow();
    expect(rows.get(TENANT_B)).toEqual(before);
  });

  it("is idempotent: a second run changes nothing and issues no write", async () => {
    const rows = await seed();
    const { rpc, calls } = fakeClient(rows);
    await reencryptCredentials({ rpc, key: V2, environment: "sandbox", tenantIds: [TENANT_A, TENANT_B] });
    const snapshot = JSON.stringify([...rows]);
    calls.length = 0;
    const again = await reencryptCredentials({ rpc, key: V2, environment: "sandbox", tenantIds: [TENANT_A, TENANT_B] });
    expect(again).toMatchObject({ rewrapped: 0, alreadyCurrent: 2, failed: [] });
    expect(calls).not.toContain("rewrap_seller_credential");
    expect(JSON.stringify([...rows])).toBe(snapshot);
  });

  it("reports a lost fence as a conflict and an unreadable row as failed, without throwing or leaking", async () => {
    const rows = await seed();
    const raced: RewrapRpc = async (fn, args) => {
      if (fn === "rewrap_seller_credential") return { data: null, error: { message: "stale_state", code: "55000" } };
      return fakeClient(rows).rpc(fn, args);
    };
    expect(await reencryptCredentials({ rpc: raced, key: V2, environment: "sandbox", tenantIds: [TENANT_A] }))
      .toMatchObject({ rewrapped: 0, conflicts: 1, failed: [] });

    // A row that cannot be opened (sealed under an old key the ring no longer holds): reported,
    // never retried blindly.
    const orphan = await sealCredential(PLAIN, credentialAad(TENANT_C, 1), { current: "v1", keys: { v1: K2 } });
    rows.set(TENANT_C, { ciphertext: orphan.ciphertext, iv: orphan.iv, key_version: "v1", version: 1 });
    const ring = { current: "v3", keys: { v2: K1, v3: K2 } };
    const summary = await reencryptCredentials({ rpc: fakeClient(rows).rpc, key: ring, environment: "sandbox", tenantIds: [TENANT_C] });
    expect(summary.failed).toEqual([{ tenantId: TENANT_C, reason: "KeyRingError" }]);
    expect(JSON.stringify(summary)).not.toContain(K1);
    expect(JSON.stringify(summary)).not.toContain(PLAIN);
  });

  it("never downgrades: rows on a key version above the configured current one are skipped without a write (L4)", async () => {
    const rows = await seed();
    const { rpc, calls } = fakeClient(rows);
    const before = JSON.stringify([...rows]);
    // A rollback of the key-ring configuration: current is v1 while TENANT_B was already moved to v2.
    const rolledBack = { current: "v1", keys: { v1: K1, v2: K2 } };
    const summary = await reencryptCredentials({ rpc, key: rolledBack, environment: "sandbox", tenantIds: [TENANT_A, TENANT_B] });
    expect(summary).toMatchObject({ rewrapped: 0, alreadyCurrent: 2, failed: [] });
    expect(calls).not.toContain("rewrap_seller_credential");
    expect(JSON.stringify([...rows])).toBe(before);
  });
});
