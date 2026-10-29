import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ACCESS_TTL_SECONDS, CLOCK_SKEW_SECONDS, mintStaticJwt, signJwt, verifyJwt } from "../../src/lib/auth/jwt";

const SECRET = "jwt-test-secret-that-is-at-least-32-bytes";
const OTHER_SECRET = "another-jwt-secret-that-is-at-least-32-bytes";
const NOW = 1_800_000_000;
const SUB = "00000000-0000-4000-8000-000000000001";

const b64 = (value: unknown) => Buffer.from(typeof value === "string" ? value : JSON.stringify(value)).toString("base64url");
const sign = (signingInput: string, secret = SECRET) => createHmac("sha256", secret).update(signingInput).digest("base64url");

/** Hand-built token with a valid HS256 signature over arbitrary header and payload. */
function craft(header: unknown, payload: unknown, secret = SECRET) {
  const signingInput = `${b64(header)}.${b64(payload)}`;
  return `${signingInput}.${sign(signingInput, secret)}`;
}

const goodHeader = { alg: "HS256", typ: "JWT" };
const goodPayload = { sub: SUB, role: "authenticated", aud: "authenticated", iat: NOW, exp: NOW + 600 };

describe("signJwt and verifyJwt", () => {
  it("round-trips claims and adds aud, iat and exp", async () => {
    const token = await signJwt(
      SECRET,
      { sub: SUB, role: "authenticated", session_id: "s1", email: "a@example.com", is_anonymous: false, aal: "aal2", amr: [{ method: "totp", timestamp: NOW }] },
      { now: NOW },
    );
    const result = await verifyJwt(SECRET, token, { now: NOW + 1 });
    expect(result).toEqual({
      ok: true,
      claims: {
        sub: SUB,
        role: "authenticated",
        aud: "authenticated",
        iat: NOW,
        exp: NOW + ACCESS_TTL_SECONDS,
        session_id: "s1",
        email: "a@example.com",
        is_anonymous: false,
        aal: "aal2",
        amr: [{ method: "totp", timestamp: NOW }],
      },
    });
  });

  it("honours the ttl option and uses the real clock by default", async () => {
    const short = await signJwt(SECRET, { sub: SUB, role: "authenticated" }, { now: NOW, ttlSeconds: 60 });
    const verified = await verifyJwt(SECRET, short, { now: NOW });
    expect(verified.ok && verified.claims.exp).toBe(NOW + 60);

    const live = await signJwt(SECRET, { sub: SUB, role: "authenticated" });
    expect((await verifyJwt(SECRET, live)).ok).toBe(true);
  });

  it("writes a pinned HS256/JWT header", async () => {
    const token = await signJwt(SECRET, { role: "anon" }, { now: NOW });
    expect(JSON.parse(Buffer.from(token.split(".")[0], "base64url").toString())).toEqual({ alg: "HS256", typ: "JWT" });
  });

  it("refuses to sign with a secret shorter than 32 bytes", async () => {
    await expect(signJwt("short-secret", { role: "authenticated" })).rejects.toThrow(/32 bytes/);
    await expect(signJwt("", { role: "authenticated" })).rejects.toThrow();
    await expect(verifyJwt("short-secret", craft(goodHeader, goodPayload))).rejects.toThrow(/32 bytes/);
  });

  it("does not leak the secret in the short-secret error", async () => {
    const error = await signJwt("short-secret", { role: "anon" }).catch((e: Error) => e);
    expect((error as Error).message).not.toContain("short-secret");
  });

  it("rejects a token signed with another secret", async () => {
    const token = await signJwt(OTHER_SECRET, { sub: SUB, role: "authenticated" }, { now: NOW });
    expect(await verifyJwt(SECRET, token, { now: NOW })).toEqual({ ok: false, reason: "signature" });
  });

  it("rejects a tampered payload and a tampered signature", async () => {
    const token = await signJwt(SECRET, { sub: SUB, role: "authenticated" }, { now: NOW });
    const [header, payload, signature] = token.split(".");
    const forged = { ...JSON.parse(Buffer.from(payload, "base64url").toString()), role: "service_role" };
    expect(await verifyJwt(SECRET, `${header}.${b64(forged)}.${signature}`, { now: NOW })).toEqual({ ok: false, reason: "signature" });

    const flipped = (signature[0] === "A" ? "B" : "A") + signature.slice(1);
    expect(await verifyJwt(SECRET, `${header}.${payload}.${flipped}`, { now: NOW })).toEqual({ ok: false, reason: "signature" });
    expect(await verifyJwt(SECRET, `${header}.${payload}.${signature.slice(0, -4)}`, { now: NOW })).toEqual({ ok: false, reason: "signature" });
  });

  it("accepts a correctly signed hand-built token (test helper sanity)", async () => {
    expect((await verifyJwt(SECRET, craft(goodHeader, goodPayload), { now: NOW })).ok).toBe(true);
  });
});

describe("algorithm pinning", () => {
  const cases: [string, unknown][] = [
    ["alg none", { alg: "none", typ: "JWT" }],
    ["alg None", { alg: "None", typ: "JWT" }],
    ["alg HS384", { alg: "HS384", typ: "JWT" }],
    ["alg RS256", { alg: "RS256", typ: "JWT" }],
    ["lowercase hs256", { alg: "hs256", typ: "JWT" }],
    ["missing alg", { typ: "JWT" }],
    ["numeric alg", { alg: 256, typ: "JWT" }],
    ["wrong typ", { alg: "HS256", typ: "JWE" }],
    ["missing typ", { alg: "HS256" }],
  ];

  for (const [name, header] of cases) {
    it(`rejects ${name} with reason alg`, async () => {
      expect(await verifyJwt(SECRET, craft(header, goodPayload), { now: NOW })).toEqual({ ok: false, reason: "alg" });
    });
  }

  it("rejects alg none with an empty signature before any signature work", async () => {
    const token = `${b64({ alg: "none", typ: "JWT" })}.${b64(goodPayload)}.`;
    expect(await verifyJwt(SECRET, token, { now: NOW })).toEqual({ ok: false, reason: "alg" });
  });

  it("rejects the alg check even when the secret is too short to verify (no key import happens)", async () => {
    expect(await verifyJwt("short", craft({ alg: "none", typ: "JWT" }, goodPayload), { now: NOW })).toEqual({ ok: false, reason: "alg" });
  });
});

describe("claim checks", () => {
  it("rejects a wrong audience", async () => {
    expect(await verifyJwt(SECRET, craft(goodHeader, { ...goodPayload, aud: "other" }), { now: NOW })).toEqual({ ok: false, reason: "aud" });
    const { aud: _aud, ...withoutAud } = goodPayload;
    expect(await verifyJwt(SECRET, craft(goodHeader, withoutAud), { now: NOW })).toEqual({ ok: false, reason: "aud" });
    expect(await verifyJwt(SECRET, craft(goodHeader, { ...goodPayload, aud: ["authenticated"] }), { now: NOW })).toEqual({ ok: false, reason: "aud" });
  });

  it("rejects an unknown or missing role", async () => {
    for (const role of ["admin", "postgres", "supabase_admin", "", 1, null]) {
      expect(await verifyJwt(SECRET, craft(goodHeader, { ...goodPayload, role }), { now: NOW })).toEqual({ ok: false, reason: "role" });
    }
    const { role: _role, ...withoutRole } = goodPayload;
    expect(await verifyJwt(SECRET, craft(goodHeader, withoutRole), { now: NOW })).toEqual({ ok: false, reason: "role" });
  });

  it("accepts all three roles", async () => {
    for (const role of ["authenticated", "anon", "service_role"]) {
      const result = await verifyJwt(SECRET, craft(goodHeader, { ...goodPayload, role }), { now: NOW });
      expect(result.ok && result.claims.role).toBe(role);
    }
  });

  it("applies exp with a 30 s skew", async () => {
    const token = craft(goodHeader, goodPayload);
    const exp = goodPayload.exp;
    expect((await verifyJwt(SECRET, token, { now: exp })).ok).toBe(true);
    expect((await verifyJwt(SECRET, token, { now: exp + CLOCK_SKEW_SECONDS })).ok).toBe(true);
    expect(await verifyJwt(SECRET, token, { now: exp + CLOCK_SKEW_SECONDS + 1 })).toEqual({ ok: false, reason: "expired" });
    expect(await verifyJwt(SECRET, token, { now: exp + 3600 })).toEqual({ ok: false, reason: "expired" });
  });

  it("applies iat with a 30 s skew", async () => {
    const token = craft(goodHeader, goodPayload);
    expect((await verifyJwt(SECRET, token, { now: NOW - CLOCK_SKEW_SECONDS })).ok).toBe(true);
    expect(await verifyJwt(SECRET, token, { now: NOW - CLOCK_SKEW_SECONDS - 1 })).toEqual({ ok: false, reason: "not_yet_valid" });
    const future = craft(goodHeader, { ...goodPayload, iat: NOW + 3600, exp: NOW + 7200 });
    expect(await verifyJwt(SECRET, future, { now: NOW })).toEqual({ ok: false, reason: "not_yet_valid" });
  });

  it("rejects missing or non-numeric iat and exp as malformed", async () => {
    const { exp: _exp, ...noExp } = goodPayload;
    const { iat: _iat, ...noIat } = goodPayload;
    for (const payload of [noExp, noIat, { ...goodPayload, exp: "soon" }, { ...goodPayload, iat: null }]) {
      expect(await verifyJwt(SECRET, craft(goodHeader, payload), { now: NOW })).toEqual({ ok: false, reason: "malformed" });
    }
  });

  it("rejects wrongly typed optional claims as malformed", async () => {
    for (const extra of [{ sub: 5 }, { email: {} }, { session_id: 1 }, { is_anonymous: "yes" }, { aal: "aal3" }, { amr: "totp" }]) {
      expect(await verifyJwt(SECRET, craft(goodHeader, { ...goodPayload, ...extra }), { now: NOW })).toEqual({ ok: false, reason: "malformed" });
    }
  });

  it("allowExpired skips only the exp check", async () => {
    const expired = craft(goodHeader, goodPayload);
    const late = { now: goodPayload.exp + 3600, allowExpired: true };
    expect((await verifyJwt(SECRET, expired, late)).ok).toBe(true);
    // signature, alg, aud, role and iat are still enforced
    expect(await verifyJwt(OTHER_SECRET, expired, late)).toEqual({ ok: false, reason: "signature" });
    expect(await verifyJwt(SECRET, craft({ alg: "none", typ: "JWT" }, goodPayload), late)).toEqual({ ok: false, reason: "alg" });
    expect(await verifyJwt(SECRET, craft(goodHeader, { ...goodPayload, aud: "x" }), late)).toEqual({ ok: false, reason: "aud" });
    expect(await verifyJwt(SECRET, craft(goodHeader, { ...goodPayload, role: "root" }), late)).toEqual({ ok: false, reason: "role" });
    expect(await verifyJwt(SECRET, craft(goodHeader, { ...goodPayload, iat: late.now + 3600 }), late)).toEqual({ ok: false, reason: "not_yet_valid" });
  });
});

describe("malformed tokens", () => {
  const validPayload = b64(goodPayload);
  const validHeader = b64(goodHeader);
  const cases: [string, string][] = [
    ["empty string", ""],
    ["one segment", "abc"],
    ["two segments", `${validHeader}.${validPayload}`],
    ["four segments", `${validHeader}.${validPayload}.sig.extra`],
    ["bad base64 header", `@@@.${validPayload}.sig`],
    ["bad base64 payload", `${validHeader}.@@@.sig`],
    ["bad base64 signature", `${validHeader}.${validPayload}.@@@`],
    ["padded base64 segment", `${validHeader}=.${validPayload}.sig`],
    ["impossible base64 length", `${validHeader}.${validPayload}.A`],
    ["non-JSON header", `${b64("not json")}.${validPayload}.sig`],
    ["non-JSON payload", `${validHeader}.${b64("not json")}.sig`],
    ["array payload", `${validHeader}.${b64("[1,2]")}.sig`],
    ["null payload", `${validHeader}.${b64("null")}.sig`],
    ["array header", `${b64("[]")}.${validPayload}.sig`],
    ["empty signature", `${validHeader}.${validPayload}.`],
    ["empty segments", ".."],
  ];

  for (const [name, token] of cases) {
    it(`rejects ${name} as malformed`, async () => {
      expect(await verifyJwt(SECRET, token, { now: NOW })).toEqual({ ok: false, reason: "malformed" });
    });
  }

  it("never throws on non-string input", async () => {
    expect(await verifyJwt(SECRET, undefined as unknown as string)).toEqual({ ok: false, reason: "malformed" });
  });
});

describe("mintStaticJwt", () => {
  it("mints a long-lived role token without a subject", async () => {
    for (const role of ["anon", "service_role"] as const) {
      const token = await mintStaticJwt(SECRET, role, undefined, NOW);
      const result = await verifyJwt(SECRET, token, { now: NOW });
      expect(result).toEqual({ ok: true, claims: { role, aud: "authenticated", iat: NOW, exp: NOW + 315360000 } });
    }
  });

  it("accepts a custom ttl", async () => {
    const result = await verifyJwt(SECRET, await mintStaticJwt(SECRET, "anon", 120, NOW), { now: NOW });
    expect(result.ok && result.claims.exp).toBe(NOW + 120);
  });

  it("refuses a short secret", async () => {
    await expect(mintStaticJwt("short", "anon")).rejects.toThrow();
  });
});
