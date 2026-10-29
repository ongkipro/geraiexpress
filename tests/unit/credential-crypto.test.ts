import { describe, expect, it } from "vitest";
import { credentialAad, credentialHint, KeyRingError, keyMaterialFromBindings, loadKeyRing, openCredential, sealCredential, validApiKey } from "../../src/lib/credential-crypto";

const key = Buffer.alloc(32, 7).toString("base64");
const otherKey = Buffer.alloc(32, 9).toString("base64");
const TENANT = "00000000-0000-4000-b000-00000000000a";

describe("credential sealing (SEC-3)", () => {
  it("round-trips only with the same key, tenant and version", async () => {
    const sealed = await sealCredential("mengantar-test-api-key-123456", credentialAad(TENANT, 1), key);
    expect(sealed.ciphertext).not.toContain("mengantar");
    expect(await openCredential(sealed, credentialAad(TENANT, 1), key)).toBe("mengantar-test-api-key-123456");
    await expect(openCredential(sealed, credentialAad(TENANT, 2), key)).rejects.toThrow();
    await expect(openCredential(sealed, credentialAad("00000000-0000-4000-b000-00000000000b", 1), key)).rejects.toThrow();
    await expect(openCredential(sealed, credentialAad(TENANT, 1), otherKey)).rejects.toThrow();
  });

  it("uses a fresh IV each time and refuses a wrong-size key", async () => {
    const a = await sealCredential("same-plaintext-value-xyz", "aad", key);
    const b = await sealCredential("same-plaintext-value-xyz", "aad", key);
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
    await expect(sealCredential("x", "aad", Buffer.alloc(16).toString("base64"))).rejects.toThrow(/32 bytes/);
  });

  it("validates key shape and derives a short hint", () => {
    expect(validApiKey("short")).toBe(false);
    expect(validApiKey("has spaces in it 1234567")).toBe(false);
    expect(validApiKey("mk_live_ABCDEFGHIJKLMNOP1234")).toBe(true);
    expect(validApiKey("API-JBI26J1J2VFOOXXX")).toBe(true); // Mengantar's own key shape
    // Anything the Mengantar client would refuse is refused at storage (T-024 audit).
    expect(validApiKey("mk_live_ABCDEFGHIJ/../KLMNOP")).toBe(false);
    expect(validApiKey("mk_live_ABCDEFGHIJKLMNOP!234")).toBe(false);
    expect(validApiKey("x".repeat(129))).toBe(false);
    expect(credentialHint("mk_live_ABCDEFGHIJKLMNOP1234")).toBe("1234");
    expect(credentialHint("short_key_123456")).toBe("56");
  });
});

describe("credential key ring (SEC-7)", () => {
  const key2 = Buffer.alloc(32, 11).toString("base64");
  const ring12 = { current: "v2", keys: { v1: key, v2: key2 } };

  it("keeps the single CREDENTIAL_KEY working as version 1", async () => {
    expect(loadKeyRing({ CREDENTIAL_KEY: key })).toEqual({ current: "v1", keys: { v1: key } });
    expect(loadKeyRing({})).toBeNull();
    const sealed = await sealCredential("legacy-key-value-123456", "aad", key);
    expect(sealed.keyVersion).toBe("v1");
    expect(await openCredential({ ...sealed, key_version: "v1" }, "aad", key)).toBe("legacy-key-value-123456");
    // A row without a stored version means the legacy key.
    expect(await openCredential({ ciphertext: sealed.ciphertext, iv: sealed.iv }, "aad", key)).toBe("legacy-key-value-123456");
  });

  it("seals under the current version and opens by the stored version", async () => {
    const old = await sealCredential("sealed-under-version-1", "aad", key);
    const fresh = await sealCredential("sealed-under-version-2", "aad", ring12);
    expect(fresh.keyVersion).toBe("v2");
    expect(await openCredential({ ...old, key_version: "v1" }, "aad", ring12)).toBe("sealed-under-version-1");
    expect(await openCredential({ ...fresh, key_version: "v2" }, "aad", ring12)).toBe("sealed-under-version-2");
    // The stored version decides: v2 ciphertext does not open under key v1.
    await expect(openCredential({ ...fresh, key_version: "v1" }, "aad", ring12)).rejects.toThrow();
  });

  it("fails clearly for a key version the ring does not hold, and never prints a key", async () => {
    const sealed = await sealCredential("sealed-under-version-2", "aad", ring12);
    const error = await openCredential({ ...sealed, key_version: "v2" }, "aad", { current: "v1", keys: { v1: key } }).catch((e: Error) => e);
    expect(error).toBeInstanceOf(KeyRingError);
    expect((error as Error).message).toBe("credential key version v2 is not in the key ring");
    for (const bad of ["__proto__", "constructor", "v9"]) {
      await expect(openCredential({ ...sealed, key_version: bad }, "aad", ring12)).rejects.toThrow(/not in the key ring/);
    }
  });

  it("refuses tampered associated data under any version", async () => {
    const sealed = await sealCredential("bound-to-tenant-version", credentialAad(TENANT, 3), ring12);
    await expect(openCredential({ ...sealed, key_version: "v2" }, credentialAad(TENANT, 4), ring12)).rejects.toThrow();
    await expect(openCredential({ ...sealed, key_version: "v2" }, credentialAad("00000000-0000-4000-b000-00000000000b", 3), ring12)).rejects.toThrow();
  });

  it("loads CREDENTIAL_KEYS with CREDENTIAL_KEY_CURRENT and validates every key", () => {
    const ring = loadKeyRing({ CREDENTIAL_KEYS: JSON.stringify({ "1": key, "2": key2 }), CREDENTIAL_KEY_CURRENT: "2" });
    expect(ring).toEqual(ring12);
    expect(loadKeyRing({ CREDENTIAL_KEYS: JSON.stringify({ "1": key, "2": key2 }), CREDENTIAL_KEY_CURRENT: "v1", CREDENTIAL_KEY: key2 })?.current).toBe("v1");
    expect(keyMaterialFromBindings({ CREDENTIAL_KEY: key })).toBe(key);
    expect(keyMaterialFromBindings({})).toBeNull();
    expect(JSON.parse(keyMaterialFromBindings({ CREDENTIAL_KEYS: JSON.stringify({ "1": key }), CREDENTIAL_KEY_CURRENT: "1" })!)).toEqual({ current: "v1", keys: { v1: key } });
    const bad = [
      { CREDENTIAL_KEYS: "not json", CREDENTIAL_KEY_CURRENT: "1" },
      { CREDENTIAL_KEYS: "[]", CREDENTIAL_KEY_CURRENT: "1" },
      { CREDENTIAL_KEYS: JSON.stringify({ "1": key }) }, // current missing
      { CREDENTIAL_KEYS: JSON.stringify({ "1": key }), CREDENTIAL_KEY_CURRENT: "2" }, // current not in ring
      { CREDENTIAL_KEYS: JSON.stringify({ "1": Buffer.alloc(16).toString("base64") }), CREDENTIAL_KEY_CURRENT: "1" },
      { CREDENTIAL_KEYS: JSON.stringify({ "1": "!!!not-base64!!!" }), CREDENTIAL_KEY_CURRENT: "1" },
      { CREDENTIAL_KEYS: JSON.stringify({ one: key }), CREDENTIAL_KEY_CURRENT: "one" },
      { CREDENTIAL_KEYS: JSON.stringify({ "1": key, v1: key }), CREDENTIAL_KEY_CURRENT: "1" },
      { CREDENTIAL_KEY: key, CREDENTIAL_KEY_CURRENT: "2" },
      { CREDENTIAL_KEY: Buffer.alloc(31).toString("base64") },
    ];
    for (const b of bad) expect(() => loadKeyRing(b)).toThrow(KeyRingError);
    const short = Buffer.alloc(16, 5).toString("base64");
    const error = (() => { try { loadKeyRing({ CREDENTIAL_KEYS: JSON.stringify({ "1": short }), CREDENTIAL_KEY_CURRENT: "1" }); } catch (e) { return e as Error; } })();
    expect(error?.message).toBe("key ring version v1 must be base64 of 32 bytes");
    expect(error?.message).not.toContain(short);
  });
});
