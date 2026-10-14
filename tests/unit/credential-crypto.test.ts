import { describe, expect, it } from "vitest";
import { credentialAad, credentialHint, openCredential, sealCredential, validApiKey } from "../../src/lib/credential-crypto";

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
    expect(credentialHint("mk_live_ABCDEFGHIJKLMNOP1234")).toBe("1234");
    expect(credentialHint("short_key_123456")).toBe("56");
  });
});
