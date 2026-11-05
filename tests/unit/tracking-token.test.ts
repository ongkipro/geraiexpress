import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { trackingToken, trackingTokenHash } from "../../src/modules/tracking/token";
import { senderWhatsApp, trackingMessage } from "../../src/modules/tracking/share-message";
import { originFor } from "../../src/lib/hosts";
import { trackingTokenSecret } from "../../src/lib/config";

afterEach(() => vi.unstubAllEnvs());

const secret = "synthetic-tracking-test-secret-32-bytes";
const generation = "11111111-1111-4111-8111-111111111111";

describe("tracking token", () => {
  it("requires a 32+ byte runtime root through config, including in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    for (const value of ["", "   ", "short"]) {
      vi.stubEnv("TRACKING_TOKEN_SECRET", value);
      expect(() => trackingTokenSecret()).toThrow(/TRACKING_TOKEN_SECRET/);
    }
    vi.stubEnv("TRACKING_TOKEN_SECRET", secret);
    expect(trackingTokenSecret()).toBe(secret);
  });
  it("re-derives exactly HMAC-SHA256(link_id), 256 bits, without AWB/reference/identity in the URL", () => {
    const token = trackingToken(generation, secret);
    expect(token).toBe(createHmac("sha256", secret).update(generation).digest("base64url"));
    expect(trackingToken(generation, secret)).toBe(token);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(token, "base64url")).toHaveLength(32);
    expect(token).not.toContain(generation);
    expect(trackingTokenHash(token)).toMatch(/^[a-f0-9]{64}$/);
  });
  it("changes after revocation creates a new sharing generation or a secret changes", () => {
    expect(trackingToken("22222222-2222-4222-8222-222222222222", secret)).not.toBe(trackingToken(generation, secret));
    expect(trackingToken(generation, `${secret}-rotated`)).not.toBe(trackingToken(generation, secret));
    expect(() => trackingToken(generation, "")).toThrow(/32 bytes/);
    expect(() => trackingToken(generation, "short")).toThrow(/32 bytes/);
  });
  it("builds the public link from environment configuration only", () => {
    const token = trackingToken(generation, secret);
    const link = `${originFor("public", { SITE_ORIGIN: "https://staging.geraiexpress.com" })}/lacak/${token}`;
    expect(link).toBe(`https://staging.geraiexpress.com/lacak/${token}`);
    expect(() => originFor("public", { NODE_ENV: "production" })).toThrow(/SITE_ORIGIN/);
  });
});

describe("resi message", () => {
  it.each(["081234567890", "+62 812-3456-7890", "6281234567890"])("normalizes %s to wa.me digits", (phone) => {
    expect(senderWhatsApp(phone)).toBe("6281234567890");
  });
  it.each([null, "", "+14155550123", "123", "0812<script>"])("fails closed for %s", (phone) => expect(senderWhatsApp(phone)).toBeNull());
  it("includes only the requested customer message fields, not an automated-send instruction", () => {
    expect(trackingMessage("Gerai Uji", "J&T Express REG", "JP1234567890", "https://example.test/lacak/opaque"))
      .toBe("Halo, berikut resi pengiriman Anda dari Gerai Uji.\nKurir: J&T Express REG\nNomor resi: JP1234567890\nLacak pengiriman: https://example.test/lacak/opaque\nTerima kasih.");
  });
});
