import { describe, expect, it } from "vitest";
import { generateTotpSecret, otpauthUri, sealTotpSecret, totpCodeAt, unsealTotpSecret, verifyTotp } from "../../src/lib/auth/totp";

// RFC 6238 appendix B, SHA-1 secret "12345678901234567890".
const RFC_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
const AUTH_SECRET = "totp-test-auth-secret-at-least-32-bytes";
const OTHER_AUTH_SECRET = "other-totp-auth-secret-at-least-32-bytes";
const USER = "00000000-0000-4000-8000-000000000001";
const OTHER_USER = "00000000-0000-4000-8000-000000000002";

const stepAt = (seconds: number) => Math.floor(seconds / 30);

describe("RFC 6238 vectors (SHA-1, 6 digits)", () => {
  const vectors: [number, string][] = [
    [59, "287082"],
    [1111111109, "081804"],
    [1111111111, "050471"],
    [1234567890, "005924"],
    [2000000000, "279037"],
    [20000000000, "353130"],
  ];

  for (const [seconds, code] of vectors) {
    it(`T=${seconds} -> ${code}`, () => {
      expect(totpCodeAt(RFC_SECRET, stepAt(seconds))).toBe(code);
      expect(verifyTotp(RFC_SECRET, code, seconds * 1000)).toEqual({ ok: true, step: stepAt(seconds) });
    });
  }
});

describe("verifyTotp window", () => {
  const nowMs = 1_800_000_000_000 + 7_000;
  const step = Math.floor(nowMs / 30_000);

  it("accepts steps -1, 0 and +1 and reports the matched step", () => {
    for (const offset of [-1, 0, 1]) {
      expect(verifyTotp(RFC_SECRET, totpCodeAt(RFC_SECRET, step + offset), nowMs)).toEqual({ ok: true, step: step + offset });
    }
  });

  it("rejects steps -2 and +2", () => {
    expect(verifyTotp(RFC_SECRET, totpCodeAt(RFC_SECRET, step - 2), nowMs)).toEqual({ ok: false });
    expect(verifyTotp(RFC_SECRET, totpCodeAt(RFC_SECRET, step + 2), nowMs)).toEqual({ ok: false });
  });

  it("rejects codes that are not exactly six digits", () => {
    const code = totpCodeAt(RFC_SECRET, step);
    for (const bad of ["", code.slice(1), `${code}0`, ` ${code}`, `${code} `, "12 3456", "abcdef", "12345a", "١٢٣٤٥٦", "1e5000"]) {
      expect(verifyTotp(RFC_SECRET, bad, nowMs)).toEqual({ ok: false });
    }
    expect(verifyTotp(RFC_SECRET, 123456 as unknown as string, nowMs)).toEqual({ ok: false });
  });

  it("returns ok:false for a wrong code and for an unusable secret", () => {
    const code = totpCodeAt(RFC_SECRET, step);
    const wrong = code === "000000" ? "000001" : "000000";
    const taken = [-1, 0, 1].map((offset) => totpCodeAt(RFC_SECRET, step + offset));
    if (!taken.includes(wrong)) expect(verifyTotp(RFC_SECRET, wrong, nowMs)).toEqual({ ok: false });
    expect(verifyTotp("", code, nowMs)).toEqual({ ok: false });
    expect(verifyTotp("!!!not base32!!!", code, nowMs)).toEqual({ ok: false });
  });

  it("does not match another secret's code", () => {
    const other = generateTotpSecret();
    expect(verifyTotp(other, totpCodeAt(RFC_SECRET, step), nowMs).ok).toBe(false);
  });

  it("handles the first step of the epoch without negative counters", () => {
    expect(verifyTotp(RFC_SECRET, totpCodeAt(RFC_SECRET, 0), 0)).toEqual({ ok: true, step: 0 });
  });
});

describe("generateTotpSecret", () => {
  it("is 160 bits of unpadded base32 and fresh each time", () => {
    const secret = generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(generateTotpSecret()).not.toBe(secret);
  });

  it("produces secrets that verify against their own codes", () => {
    const secret = generateTotpSecret();
    const now = Date.now();
    expect(verifyTotp(secret, totpCodeAt(secret, Math.floor(now / 30_000)), now).ok).toBe(true);
  });
});

describe("otpauthUri", () => {
  it("carries issuer, account and secret", () => {
    const uri = new URL(otpauthUri(RFC_SECRET, "ana@example.com"));
    expect(uri.protocol).toBe("otpauth:");
    expect(uri.host).toBe("totp");
    expect(decodeURIComponent(uri.pathname)).toBe("/GeraiExpress:ana@example.com");
    expect(uri.searchParams.get("secret")).toBe(RFC_SECRET);
    expect(uri.searchParams.get("issuer")).toBe("GeraiExpress");
    expect(uri.searchParams.get("algorithm")).toBe("SHA1");
    expect(uri.searchParams.get("digits")).toBe("6");
    expect(uri.searchParams.get("period")).toBe("30");
  });

  it("encodes a custom issuer and awkward accounts", () => {
    const uri = new URL(otpauthUri(RFC_SECRET, "a b+c@example.com", "Gerai & Co"));
    expect(uri.searchParams.get("issuer")).toBe("Gerai & Co");
    expect(decodeURIComponent(uri.pathname)).toBe("/Gerai & Co:a b+c@example.com");
  });
});

describe("sealed TOTP secrets", () => {
  it("round-trips and never contains the plaintext", async () => {
    const secret = generateTotpSecret();
    const sealed = await sealTotpSecret(AUTH_SECRET, USER, secret);
    expect(sealed).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(sealed).not.toContain(secret);
    expect(Buffer.from(sealed.split(".")[2], "base64url").toString("latin1")).not.toContain(secret);
    expect(Buffer.from(sealed.split(".")[1], "base64url")).toHaveLength(12);
    expect(await unsealTotpSecret(AUTH_SECRET, USER, sealed)).toBe(secret);
  });

  it("uses a fresh iv for every seal", async () => {
    const a = await sealTotpSecret(AUTH_SECRET, USER, RFC_SECRET);
    const b = await sealTotpSecret(AUTH_SECRET, USER, RFC_SECRET);
    expect(a).not.toBe(b);
  });

  it("refuses another user id, another auth secret and tampered text with one generic error", async () => {
    const sealed = await sealTotpSecret(AUTH_SECRET, USER, RFC_SECRET);
    const [version, iv, data] = sealed.split(".");
    const flip = (text: string) => (text[0] === "A" ? "B" : "A") + text.slice(1);
    const tampered = [
      `${version}.${iv}.${flip(data)}`,
      `${version}.${flip(iv)}.${data}`,
      `${version}.${iv}.${data.slice(0, -4)}`,
      `v2.${iv}.${data}`,
      `${version}.${iv}`,
      `${version}.${iv}.${data}.extra`,
      `${version}..${data}`,
      `${version}.${iv}.`,
      "",
      "garbage",
    ];
    const attempts = [
      () => unsealTotpSecret(AUTH_SECRET, OTHER_USER, sealed),
      () => unsealTotpSecret(OTHER_AUTH_SECRET, USER, sealed),
      ...tampered.map((text) => () => unsealTotpSecret(AUTH_SECRET, USER, text)),
    ];
    for (const attempt of attempts) {
      await expect(attempt()).rejects.toThrow(new Error("totp secret cannot be opened"));
    }
  });

  it("does not leak the secret in the error", async () => {
    const sealed = await sealTotpSecret(AUTH_SECRET, USER, RFC_SECRET);
    const error = await unsealTotpSecret(AUTH_SECRET, OTHER_USER, sealed).catch((e: Error) => e);
    expect((error as Error).message).not.toContain(RFC_SECRET);
    expect((error as Error).message).not.toContain(AUTH_SECRET);
  });
});
