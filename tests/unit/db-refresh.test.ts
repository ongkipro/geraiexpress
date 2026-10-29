import { describe, expect, it, vi } from "vitest";
import { REFRESH_WINDOW_SECONDS, resolveSession } from "../../src/lib/db/refresh";
import { AuthUnavailableError } from "../../src/lib/auth/store";
import type { Auth, RefreshResult, SessionLiveResult, SessionTokens } from "../../src/lib/auth/service";
import type { AccessClaims, VerifyResult } from "../../src/lib/auth/jwt";

const NOW = 1_800_000_000;
const USER = "11111111-1111-4111-8111-111111111111";
const OTHER_USER = "22222222-2222-4222-8222-222222222222";
const SESSION = "33333333-3333-4333-8333-333333333333";

const claims = (overrides: Partial<AccessClaims> = {}): AccessClaims => ({
  sub: USER,
  role: "authenticated",
  aud: "authenticated",
  iat: NOW - 100,
  exp: NOW + 500,
  session_id: SESSION,
  ...overrides,
});

const rotated = (overrides: Partial<SessionTokens> = {}): SessionTokens => ({
  accessToken: "new-access",
  refreshToken: "new-refresh",
  sessionId: SESSION,
  userId: USER,
  email: "a@example.com",
  isAnonymous: false,
  hasPassword: false,
  aal: "aal1",
  accessExpiresAt: NOW + 600,
  absoluteExpiresAt: "2030-01-01T00:00:00.000Z",
  ...overrides,
});

const live = (overrides: Partial<Extract<SessionLiveResult, { live: true }>> = {}): SessionLiveResult => ({
  live: true,
  userId: USER,
  email: "a@example.com",
  isAnonymous: false,
  hasPassword: false,
  sessionId: SESSION,
  aal: "aal1",
  aal2At: null,
  absoluteExpiresAt: "2030-01-01T00:00:00.000Z",
  ...overrides,
});

type Fake = {
  verify?: VerifyResult | (() => Promise<VerifyResult>);
  refresh?: RefreshResult | (() => Promise<RefreshResult>);
  live?: SessionLiveResult | (() => Promise<SessionLiveResult>);
};

function harness(fake: Fake = {}) {
  const run = <T>(value: T | (() => Promise<T>)) => (typeof value === "function" ? (value as () => Promise<T>)() : Promise.resolve(value));
  const auth = {
    verifyAccessToken: vi.fn(async (_token: string) => run(fake.verify ?? ({ ok: false, reason: "signature" } as VerifyResult))),
    refresh: vi.fn(async (_token: string) => run(fake.refresh ?? ({ ok: true, session: rotated() } as RefreshResult))),
    sessionLive: vi.fn(async (_id: string) => run(fake.live ?? live())),
  } satisfies Pick<Auth, "verifyAccessToken" | "refresh" | "sessionLive">;
  const allowRefresh = vi.fn(async () => true);
  const resolve = (input: { method?: string; accessToken?: string; refreshToken?: string }) =>
    resolveSession({ method: input.method ?? "GET", accessToken: input.accessToken, refreshToken: input.refreshToken, auth, allowRefresh, now: NOW });
  return { auth, allowRefresh, resolve };
}

const valid = (overrides: Partial<AccessClaims> = {}): VerifyResult => ({ ok: true, claims: claims(overrides) });

describe("resolveSession (ADR-0002 section 3.3)", () => {
  it("does nothing without any session cookie", async () => {
    const h = harness();
    expect(await h.resolve({})).toEqual({ kind: "none" });
    expect(h.auth.verifyAccessToken).not.toHaveBeenCalled();
    expect(h.allowRefresh).not.toHaveBeenCalled();
  });

  describe("a valid access token", () => {
    it("needs nothing on GET and HEAD: no session row lookup, no refresh, no budget spent", async () => {
      for (const method of ["GET", "HEAD"]) {
        const h = harness({ verify: valid() });
        expect(await h.resolve({ method, accessToken: "at", refreshToken: "rt" }), method).toEqual({ kind: "none" });
        expect(h.auth.sessionLive).not.toHaveBeenCalled();
        expect(h.auth.refresh).not.toHaveBeenCalled();
        expect(h.allowRefresh).not.toHaveBeenCalled();
      }
    });

    it("checks the session row on every other method and passes a live session of the same user", async () => {
      for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
        const h = harness({ verify: valid(), live: live() });
        expect(await h.resolve({ method, accessToken: "at", refreshToken: "rt" }), method).toEqual({ kind: "none" });
        expect(h.auth.sessionLive).toHaveBeenCalledExactlyOnceWith(SESSION);
        expect(h.auth.refresh).not.toHaveBeenCalled();
      }
    });

    it("clears both cookies on a non-GET request whose session was revoked or ended", async () => {
      const h = harness({ verify: valid(), live: { live: false } });
      expect(await h.resolve({ method: "POST", accessToken: "at", refreshToken: "rt" })).toEqual({ kind: "clear" });
      expect(h.auth.refresh).not.toHaveBeenCalled();
    });

    it("clears both cookies when the session row belongs to another user", async () => {
      const h = harness({ verify: valid(), live: live({ userId: OTHER_USER }) });
      expect(await h.resolve({ method: "POST", accessToken: "at", refreshToken: "rt" })).toEqual({ kind: "clear" });
    });

    it("keeps the cookies when the database cannot answer the session check", async () => {
      const h = harness({ verify: valid(), live: async () => { throw new AuthUnavailableError("session_live"); } });
      expect(await h.resolve({ method: "POST", accessToken: "at", refreshToken: "rt" })).toEqual({ kind: "refused" });
    });

    it("rethrows an error that is not an unavailable database", async () => {
      const h = harness({ verify: valid(), live: async () => { throw new TypeError("boom"); } });
      await expect(h.resolve({ method: "POST", accessToken: "at", refreshToken: "rt" })).rejects.toThrow("boom");
    });
  });

  describe("an access token that expires within the refresh window", () => {
    it(`refreshes at ${REFRESH_WINDOW_SECONDS} seconds left and not at ${REFRESH_WINDOW_SECONDS + 1}`, async () => {
      const edge = harness({ verify: valid({ exp: NOW + REFRESH_WINDOW_SECONDS }) });
      expect(await edge.resolve({ accessToken: "at", refreshToken: "rt" })).toEqual({ kind: "set", accessToken: "new-access", refreshToken: "new-refresh" });
      expect(edge.auth.refresh).toHaveBeenCalledExactlyOnceWith("rt");
      expect(edge.allowRefresh).toHaveBeenCalledOnce();

      const outside = harness({ verify: valid({ exp: NOW + REFRESH_WINDOW_SECONDS + 1 }) });
      expect(await outside.resolve({ accessToken: "at", refreshToken: "rt" })).toEqual({ kind: "none" });
      expect(outside.auth.refresh).not.toHaveBeenCalled();
    });

    it("refreshes on POST as well, without a separate session row check", async () => {
      const h = harness({ verify: valid({ exp: NOW + 10 }) });
      expect(await h.resolve({ method: "POST", accessToken: "at", refreshToken: "rt" })).toMatchObject({ kind: "set", accessToken: "new-access" });
      expect(h.auth.sessionLive).not.toHaveBeenCalled();
    });

    it("clears the cookies when there is no refresh token to continue with", async () => {
      const h = harness({ verify: valid({ exp: NOW + 10 }) });
      expect(await h.resolve({ accessToken: "at" })).toEqual({ kind: "clear" });
      expect(h.allowRefresh).not.toHaveBeenCalled();
    });
  });

  describe("a missing, forged or expired access token", () => {
    it("refreshes with the refresh token alone when the access cookie is gone", async () => {
      const h = harness();
      expect(await h.resolve({ refreshToken: "rt" })).toEqual({ kind: "set", accessToken: "new-access", refreshToken: "new-refresh" });
      expect(h.auth.verifyAccessToken).not.toHaveBeenCalled();
      expect(h.auth.refresh).toHaveBeenCalledExactlyOnceWith("rt");
    });

    it.each(["signature", "malformed", "alg", "aud", "role", "expired", "not_yet_valid"] as const)("refreshes when verification fails with %s", async (reason) => {
      const h = harness({ verify: { ok: false, reason } });
      expect(await h.resolve({ accessToken: "at", refreshToken: "rt" })).toMatchObject({ kind: "set" });
      expect(h.auth.refresh).toHaveBeenCalledExactlyOnceWith("rt");
    });

    it("clears the cookies when the access token is unusable and there is no refresh token", async () => {
      for (const verify of [{ ok: false, reason: "expired" } as const, { ok: false, reason: "signature" } as const]) {
        const h = harness({ verify });
        expect(await h.resolve({ accessToken: "at" })).toEqual({ kind: "clear" });
        expect(h.auth.refresh).not.toHaveBeenCalled();
      }
    });
  });

  describe("the machine and anonymous database roles are never a user session", () => {
    it.each(["anon", "service_role"] as const)("treats a verified %s token as no session: it refreshes with the refresh cookie and clears without one", async (role) => {
      const withRefresh = harness({ verify: valid({ role }) });
      expect(await withRefresh.resolve({ accessToken: "at", refreshToken: "rt" })).toMatchObject({ kind: "set" });
      expect(withRefresh.auth.refresh).toHaveBeenCalledOnce();

      const alone = harness({ verify: valid({ role }) });
      expect(await alone.resolve({ method: "POST", accessToken: "at" })).toEqual({ kind: "clear" });
      expect(alone.auth.sessionLive).not.toHaveBeenCalled();
    });

    it("treats an authenticated token without a session id as no session", async () => {
      const h = harness({ verify: valid({ session_id: undefined }) });
      expect(await h.resolve({ accessToken: "at" })).toEqual({ kind: "clear" });
      expect(h.auth.sessionLive).not.toHaveBeenCalled();
    });
  });

  describe("refresh budget and outcomes", () => {
    it("answers `refused` and never calls refresh once the budget is spent", async () => {
      const h = harness({ verify: { ok: false, reason: "expired" } });
      h.allowRefresh.mockResolvedValueOnce(false);
      expect(await h.resolve({ accessToken: "at", refreshToken: "rt" })).toEqual({ kind: "refused" });
      expect(h.auth.refresh).not.toHaveBeenCalled();
    });

    it("spends the budget only when a refresh is needed", async () => {
      const h = harness({ verify: valid() });
      await h.resolve({ method: "POST", accessToken: "at", refreshToken: "rt" });
      expect(h.allowRefresh).not.toHaveBeenCalled();
    });

    it.each(["invalid", "reuse_detected"] as const)("clears both cookies when the refresh is %s", async (reason) => {
      const h = harness({ refresh: { ok: false, reason } });
      expect(await h.resolve({ refreshToken: "rt" })).toEqual({ kind: "clear" });
    });

    it("sets the access cookie only on recent_reuse, which carries no refresh token", async () => {
      const h = harness({ refresh: { ok: true, session: rotated({ refreshToken: null }) } });
      expect(await h.resolve({ refreshToken: "rt" })).toEqual({ kind: "set", accessToken: "new-access", refreshToken: null });
    });

    it("answers `refused` and keeps the cookies when the database cannot answer the refresh", async () => {
      const h = harness({ refresh: async () => { throw new AuthUnavailableError("refresh"); } });
      expect(await h.resolve({ refreshToken: "rt" })).toEqual({ kind: "refused" });
    });

    it("rethrows an unexpected refresh error instead of guessing", async () => {
      const h = harness({ refresh: async () => { throw new TypeError("boom"); } });
      await expect(h.resolve({ refreshToken: "rt" })).rejects.toThrow("boom");
    });
  });
});
