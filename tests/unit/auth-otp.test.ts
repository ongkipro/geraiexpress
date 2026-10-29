import { describe, expect, it } from "vitest";
import { assertSecret, hkdf, hmacSha256Hex, randomToken, safeEqual, sha256Hex } from "../../src/lib/auth/crypto";
import { generateOtpCode, hashOtp } from "../../src/lib/auth/otp";

const SECRET = "otp-test-auth-secret-at-least-32-bytes";
const OTHER_SECRET = "other-test-auth-secret-at-least-32-bytes";

describe("generateOtpCode", () => {
  it("always returns exactly six digits", () => {
    for (let i = 0; i < 2000; i += 1) expect(generateOtpCode()).toMatch(/^[0-9]{6}$/);
  });

  it("is not constant", () => {
    const codes = new Set(Array.from({ length: 50 }, () => generateOtpCode()));
    expect(codes.size).toBeGreaterThan(1);
  });
});

describe("hashOtp", () => {
  const base = () => hashOtp(SECRET, "a@example.com", "login", "123456");

  it("is deterministic lowercase hex of 64 characters", () => {
    expect(base()).toBe(base());
    expect(base()).toMatch(/^[0-9a-f]{64}$/);
  });

  it("differs per email, code and secret", () => {
    expect(hashOtp(SECRET, "b@example.com", "login", "123456")).not.toBe(base());
    expect(hashOtp(SECRET, "a@example.com", "login", "123457")).not.toBe(base());
    expect(hashOtp(OTHER_SECRET, "a@example.com", "login", "123456")).not.toBe(base());
  });

  it("binds the purpose into the input", () => {
    const login = base();
    // Only "login" exists in the type; an unknown purpose must still change the digest.
    expect(hashOtp(SECRET, "a@example.com", "other" as "login", "123456")).not.toBe(login);
  });

  it("normalizes the email by trim and lowercase", () => {
    expect(hashOtp(SECRET, "  A@Example.COM \n", "login", "123456")).toBe(base());
  });

  it("matches the documented construction", () => {
    const expected = hmacSha256Hex(hkdf(SECRET, "gx:otp:v1"), "login\u0000a@example.com\u0000123456");
    expect(base()).toBe(expected);
  });
});

describe("crypto helpers", () => {
  it("sha256Hex hashes strings and bytes", () => {
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(sha256Hex(new TextEncoder().encode("abc"))).toBe(sha256Hex("abc"));
  });

  it("randomToken is base64url of the requested size and fresh each time", () => {
    const token = randomToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(randomToken(16), "base64url")).toHaveLength(16);
    expect(randomToken()).not.toBe(token);
  });

  it("hmacSha256Hex matches RFC 4231 test case 2", () => {
    expect(hmacSha256Hex(new TextEncoder().encode("Jefe"), "what do ya want for nothing?")).toBe(
      "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843",
    );
  });

  it("hkdf is deterministic, separated by info and sized as asked", () => {
    expect(hkdf(SECRET, "a").equals(hkdf(SECRET, "a"))).toBe(true);
    expect(hkdf(SECRET, "a").equals(hkdf(SECRET, "b"))).toBe(false);
    expect(hkdf(SECRET, "a").equals(hkdf(OTHER_SECRET, "a"))).toBe(false);
    expect(hkdf(SECRET, "a")).toHaveLength(32);
    expect(hkdf(SECRET, "a", 16)).toHaveLength(16);
  });

  it("safeEqual compares contents and returns false on length mismatch", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
    expect(safeEqual("", "")).toBe(true);
    expect(safeEqual("é", "e")).toBe(false);
  });

  it("assertSecret enforces 32 UTF-8 bytes and never echoes the value", () => {
    const ok = "x".repeat(32);
    expect(assertSecret("AUTH_SECRET", ok)).toBe(ok);
    expect(assertSecret("AUTH_SECRET", "é".repeat(16))).toBe("é".repeat(16));
    expect(() => assertSecret("AUTH_SECRET", undefined)).toThrow(/AUTH_SECRET/);
    expect(() => assertSecret("AUTH_SECRET", "")).toThrow(/AUTH_SECRET/);
    const short = "short-but-secret-value";
    expect(() => assertSecret("AUTH_JWT_SECRET", short)).toThrow(/AUTH_JWT_SECRET/);
    try {
      assertSecret("AUTH_JWT_SECRET", short);
    } catch (error) {
      expect((error as Error).message).not.toContain(short);
    }
    expect(() => assertSecret("X", "x".repeat(31))).toThrow();
  });
});
