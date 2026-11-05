import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { RefreshResult, SessionLiveResult, SessionTokens } from "../../src/lib/auth/service";
import type { VerifyResult } from "../../src/lib/auth/jwt";
import { AuthUnavailableError } from "../../src/lib/auth/store";

const { auth, getAuth, withinLimit } = vi.hoisted(() => ({
  auth: {
    verifyAccessToken: vi.fn(),
    refresh: vi.fn(),
    sessionLive: vi.fn(),
  },
  getAuth: vi.fn(),
  withinLimit: vi.fn(),
}));
vi.mock("../../src/lib/auth/instance", () => ({ getAuth }));
vi.mock("../../src/lib/rate-limit", () => ({ withinLimit, REFRESH_RETRY_AFTER_SECONDS: 60 }));

vi.mock("../../src/modules/tracking/public-read", () => ({
  readPublicTracking: vi.fn().mockResolvedValue({ kind: "missing" }),
  TRACKING_PROJECTION_HEADER: "x-gx-public-tracking",
}));

const { proxy } = await import("../../src/proxy");

const USER = "11111111-1111-4111-8111-111111111111";
const SESSION = "33333333-3333-4333-8333-333333333333";
const expiredToken: VerifyResult = { ok: false, reason: "expired" };

const rotated = (overrides: Partial<SessionTokens> = {}): RefreshResult => ({
  ok: true,
  session: {
    accessToken: "rotated-access",
    refreshToken: "rotated-refresh",
    sessionId: SESSION,
    userId: USER,
    email: "a@example.com",
    isAnonymous: false,
    hasPassword: false,
    aal: "aal1",
    accessExpiresAt: Math.floor(Date.now() / 1000) + 600,
    absoluteExpiresAt: "2030-01-01T00:00:00.000Z",
    ...overrides,
  },
});

function resetAuth() {
  auth.verifyAccessToken.mockReset().mockResolvedValue(expiredToken);
  auth.refresh.mockReset().mockResolvedValue(rotated());
  auth.sessionLive.mockReset().mockResolvedValue({ live: false } satisfies SessionLiveResult);
  getAuth.mockReset().mockReturnValue(auth);
  withinLimit.mockReset().mockResolvedValue(true);
}

const get = (url: string, headers?: Record<string, string>) => proxy(new NextRequest(url, { headers }));
const send = (method: string, url: string, headers?: Record<string, string>) => proxy(new NextRequest(url, { method, headers }));
const sessionCookies = { cookie: "gx_at=old-access; gx_rt=old-refresh" };
const refreshOnly = { cookie: "gx_rt=old-refresh" };
const setCookies = (res: Response) => res.headers.getSetCookie();
const cookieOf = (res: Response, name: string) => setCookies(res).find((line) => line.startsWith(`${name}=`)) ?? "";

describe("proxy security headers", () => {
  beforeEach(resetAuth);

  it("sets defensive headers on page reads without any session work when there are no cookies", async () => {
    for (const method of ["GET", "HEAD"]) {
      const res = await send(method, "http://localhost/pengiriman");
      expect(res.headers.get("Cache-Control")).toBe("private, no-store");
      expect(res.headers.get("X-Frame-Options")).toBe("DENY");
      expect(res.headers.get("Content-Security-Policy")).toBe("frame-ancestors 'none'; object-src 'none'; base-uri 'none'; form-action 'self'");
      expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
      expect(res.headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
      expect(res.headers.get("Strict-Transport-Security")).toBeNull();
    }
    expect(auth.verifyAccessToken).not.toHaveBeenCalled();
    expect(auth.refresh).not.toHaveBeenCalled();
    expect(auth.sessionLive).not.toHaveBeenCalled();
    expect(withinLimit).not.toHaveBeenCalled();
  });

  it("sets the same headers plus HSTS on an HTTPS server action request", async () => {
    const res = await send("POST", "https://app.geraiexpress.com/pengiriman");
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
    expect(res.headers.get("Content-Security-Policy")).toBe("frame-ancestors 'none'; object-src 'none'; base-uri 'none'; form-action 'self'");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(res.headers.get("Strict-Transport-Security")).toBe("max-age=31536000; includeSubDomains");
  });

  it("sends X-Robots-Tag noindex on preview, staging and local hosts but not on the production apex", async () => {
    for (const url of [
      "https://app-staging.geraiexpress.com/masuk",
      "https://staging.geraiexpress.com/fitur",
      "http://localhost:3203/robots.txt",
    ]) {
      const res = await get(url);
      expect(res.headers.get("X-Robots-Tag"), url).toBe("noindex, nofollow");
    }
    // The Host header wins over the URL, so a proxied preview cannot pose as the apex by URL alone.
    const proxied = await get("https://geraiexpress.com/", { host: "app-staging.geraiexpress.com" });
    expect(proxied.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");

    for (const url of ["https://geraiexpress.com/", "https://geraiexpress.com/fitur"]) {
      const res = await get(url);
      expect(res.headers.get("X-Robots-Tag"), url).toBeNull();
    }
    const apexHeader = await get("https://anything.example/", { host: "geraiexpress.com" });
    expect(apexHeader.headers.get("X-Robots-Tag")).toBeNull();
  });
});

describe("host routing (DEC-015)", () => {
  beforeEach(resetAuth);

  // [url, status] per host; the full host x family matrix is in hosts.test.ts.
  const cells: [string, number][] = [
    ["https://geraiexpress.com/", 200],
    ["https://geraiexpress.com/fitur", 200],
    ["https://geraiexpress.com/robots.txt", 200],
    ["https://geraiexpress.com/masuk", 404],
    ["https://geraiexpress.com/admin", 404],
    ["https://geraiexpress.com/pengiriman", 404],
    ["https://geraiexpress.com/api/auth/send-email", 404],
    ["https://app.geraiexpress.com/", 200],
    ["https://app.geraiexpress.com/masuk", 200],
    ["https://app.geraiexpress.com/pengiriman/abc/label", 200],
    ["https://app.geraiexpress.com/pilih-gerai", 200],
    ["https://app.geraiexpress.com/admin", 404],
    ["https://app.geraiexpress.com/verifikasi-2fa", 404],
    ["https://app.geraiexpress.com/fitur", 404],
    ["https://app.geraiexpress.com/api/auth/send-email", 404],
    ["https://owner.geraiexpress.com/", 200],
    ["https://owner.geraiexpress.com/masuk", 200],
    ["https://owner.geraiexpress.com/admin/audit", 200],
    ["https://owner.geraiexpress.com/verifikasi-2fa", 200],
    ["https://owner.geraiexpress.com/robots.txt", 200],
    ["https://owner.geraiexpress.com/pengiriman", 404],
    ["https://owner.geraiexpress.com/pilih-gerai", 404],
    ["https://owner.geraiexpress.com/daftar", 404],
    ["https://owner.geraiexpress.com/fitur", 404],
    ["https://owner.geraiexpress.com/api/auth/send-email", 404],
    ["https://hooks.geraiexpress.com/api/webhooks/mengantar", 200],
    ["https://hooks.geraiexpress.com/api/auth/send-email", 404],
    ["https://hooks.geraiexpress.com/", 404],
    ["https://hooks.geraiexpress.com/masuk", 404],
    ["https://hooks.geraiexpress.com/admin", 404],
    ["https://hooks.geraiexpress.com/robots.txt", 404],
    ["https://app-staging.geraiexpress.com/admin", 404],
    ["https://owner-staging.geraiexpress.com/admin", 200],
    ["https://hooks-staging.geraiexpress.com/api/webhooks/mengantar", 200],
    ["http://internal.geraiexpress.local:3000/api/internal/cron/dispatch", 200],
    ["http://internal.geraiexpress.local:3000/api/internal/cron/cleanup", 200],
    ["http://internal.geraiexpress.local:3000/healthz", 200],
    ["http://internal.geraiexpress.local:3000/", 404],
    ["http://internal.geraiexpress.local:3000/masuk", 404],
    ["http://internal.geraiexpress.local:3000/api/auth/send-email", 404],
    ["https://app.geraiexpress.com/api/internal/cron/dispatch", 404],
    ["https://owner.geraiexpress.com/api/internal/cron/dispatch", 404],
    ["https://hooks.geraiexpress.com/api/internal/cron/dispatch", 404],
    ["https://geraiexpress.com/api/internal/cron/dispatch", 404],
    ["http://127.0.0.1:3100/api/internal/cron/dispatch", 404],
    ["http://app.localhost:3342/admin", 404],
    ["http://owner.localhost:3342/admin", 200],
    ["http://127.0.0.1:3100/admin", 200],
    ["http://127.0.0.1:3100/pengiriman", 200],
    ["https://unknown.example/", 404],
  ];

  it.each(cells)("%s answers %i", async (url, status) => {
    const res = await get(url);
    // Pass-through responses carry the x-middleware-next marker; a refusal is a real 404.
    if (status === 404) {
      expect(res.status).toBe(404);
      expect(res.headers.get("x-middleware-next")).toBeNull();
    } else {
      expect(res.status).toBe(200);
      expect(res.headers.get("x-middleware-next")).toBe("1");
    }
    expect(res.headers.get("location")).toBeNull();
  });

  it("answers a plain 404 with no redirect, no hint of another host and the defensive headers", async () => {
    for (const method of ["GET", "POST"]) {
      const res = await send(method, "https://app.geraiexpress.com/admin", sessionCookies);
      expect(res.status).toBe(404);
      expect(res.headers.get("location")).toBeNull();
      expect(res.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
      expect(res.headers.get("Cache-Control")).toBe("private, no-store");
      expect(res.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
      expect(res.headers.get("Content-Security-Policy")).toBe("frame-ancestors 'none'; object-src 'none'; base-uri 'none'; form-action 'self'");
      expect(res.headers.get("Strict-Transport-Security")).toBe("max-age=31536000; includeSubDomains");
      const body = await res.text();
      expect(body).toBe("Halaman tidak ditemukan");
      expect(body).not.toMatch(/owner|geraiexpress|admin/i);
    }
    // A refusal never touches the auth module, even with session cookies present.
    expect(getAuth).not.toHaveBeenCalled();
    expect(auth.refresh).not.toHaveBeenCalled();
  });

  it("ignores X-Forwarded-Host and the URL host: only the Host header decides", async () => {
    const closed = await get("https://owner.geraiexpress.com/pengiriman", {
      host: "app.geraiexpress.com", "x-forwarded-host": "owner.geraiexpress.com",
    });
    expect(closed.status).toBe(200); // Host is the app host, so the gerai route is served
    const forged = await get("https://app.geraiexpress.com/admin", {
      host: "app.geraiexpress.com", "x-forwarded-host": "owner.geraiexpress.com",
    });
    expect(forged.status).toBe(404);
    const forgedOther = await get("https://app.geraiexpress.com/pengiriman", {
      host: "owner.geraiexpress.com", "x-forwarded-host": "app.geraiexpress.com", "x-forwarded-proto": "http",
    });
    expect(forgedOther.status).toBe(404);
  });

  it("does no session work on the apex, the hooks host, health and assets, even with session cookies", async () => {
    for (const url of [
      "https://geraiexpress.com/",
      "https://geraiexpress.com/fitur",
      "https://hooks.geraiexpress.com/api/webhooks/mengantar",
      "https://app.geraiexpress.com/healthz",
      "https://owner.geraiexpress.com/healthz",
      "https://owner.geraiexpress.com/_next/image?url=%2Fa.png&w=64&q=75",
    ]) {
      const res = await get(url, sessionCookies);
      expect(setCookies(res), url).toEqual([]);
    }
    expect(getAuth).not.toHaveBeenCalled();
    expect(auth.verifyAccessToken).not.toHaveBeenCalled();
    expect(auth.refresh).not.toHaveBeenCalled();
    expect(withinLimit).not.toHaveBeenCalled();
    await get("https://app.geraiexpress.com/pengiriman", sessionCookies);
    await get("https://owner.geraiexpress.com/admin", sessionCookies);
    expect(getAuth).toHaveBeenCalledTimes(2);
  });

  it("sends noindex on health and on every non-apex host, and nothing on the apex", async () => {
    for (const url of [
      "https://app.geraiexpress.com/healthz",
      "https://owner.geraiexpress.com/",
      "https://hooks.geraiexpress.com/api/webhooks/mengantar",
      "https://hooks.geraiexpress.com/",
    ]) {
      expect((await get(url)).headers.get("X-Robots-Tag"), url).toBe("noindex, nofollow");
    }
    expect((await get("https://geraiexpress.com/")).headers.get("X-Robots-Tag")).toBeNull();
  });

  it("never forwards a cookie to the hooks host route and sets none", async () => {
    const res = await get("https://hooks.geraiexpress.com/api/webhooks/mengantar", { cookie: "gx_at=abc; gx_rt=def; ge_tenant=t" });
    expect(res.headers.get("x-middleware-next")).toBe("1");
    expect(res.headers.get("set-cookie")).toBeNull();
    const overridden = (res.headers.get("x-middleware-override-headers") ?? "").split(",");
    expect(overridden).not.toContain("cookie");
    expect(res.headers.get("x-middleware-request-cookie")).toBeNull();
    expect(getAuth).not.toHaveBeenCalled();
  });

  it("never forwards a cookie to the internal host route and starts no session work there", async () => {
    const res = await get("http://internal.geraiexpress.local:3000/api/internal/cron/dispatch", { cookie: "gx_at=abc; gx_rt=def", authorization: "Bearer x" });
    expect(res.headers.get("x-middleware-next")).toBe("1");
    expect((res.headers.get("x-middleware-override-headers") ?? "").split(",")).not.toContain("cookie");
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(getAuth).not.toHaveBeenCalled();
  });

  it("never forwards a cookie to the public (apex) scope and never calls resolveSession or refresh", async () => {
    for (const method of ["GET", "POST"]) {
      const res = await send(method, "https://geraiexpress.com/fitur", { cookie: "gx_at=abc; gx_rt=def; ge_tenant=t" });
      expect(res.headers.get("x-middleware-next")).toBe("1");
      expect((res.headers.get("x-middleware-override-headers") ?? "").split(",")).not.toContain("cookie");
      expect(res.headers.get("x-middleware-request-cookie")).toBeNull();
      expect(res.headers.get("set-cookie")).toBeNull();
    }
    expect(getAuth).not.toHaveBeenCalled();
    expect(auth.verifyAccessToken).not.toHaveBeenCalled();
    expect(auth.refresh).not.toHaveBeenCalled();
    expect(auth.sessionLive).not.toHaveBeenCalled();
  });
});

describe("session cookies written by the proxy (SEC-6)", () => {
  beforeEach(resetAuth);

  // The refresh rotates both tokens; the proxy writes them on the response with the policy attributes.
  async function rotateAt(url: string) {
    const res = await get(url, refreshOnly);
    expect(res.status).toBe(200);
    return res;
  }

  it("makes gerai-host cookies host-only, HttpOnly, Secure, Lax and bounded to 7 days", async () => {
    const res = await rotateAt("https://app.geraiexpress.com/pengiriman");
    for (const [name, value] of [["gx_at", "rotated-access"], ["gx_rt", "rotated-refresh"]]) {
      const header = cookieOf(res, name);
      expect(header).toContain(`${name}=${value}`);
      expect(header).toMatch(/HttpOnly/i);
      expect(header).toMatch(/Secure/i);
      expect(header).toMatch(/SameSite=lax/i);
      expect(header).toMatch(/Path=\//i);
      expect(header).toMatch(/Max-Age=604800/i);
      expect(header).not.toMatch(/Domain=/i);
    }
  });

  it("gives Super Admin cookies the shorter 12 hour bound", async () => {
    const res = await rotateAt("https://owner.geraiexpress.com/admin");
    for (const name of ["gx_at", "gx_rt"]) {
      const header = cookieOf(res, name);
      expect(header, name).toMatch(/Max-Age=43200/i);
      expect(header, name).toMatch(/HttpOnly/i);
      expect(header, name).not.toMatch(/Domain=/i);
    }
  });

  it("does not mark cookies Secure on a plain-HTTP local request outside production", async () => {
    const res = await rotateAt("http://app.localhost:3342/pengiriman");
    const header = cookieOf(res, "gx_at");
    expect(header).toMatch(/HttpOnly/i);
    expect(header).not.toMatch(/Domain=/i);
    expect(/Secure/i.test(header)).toBe(process.env.NODE_ENV === "production");
  });

  it("makes the rotated cookies visible to the very request, keeping the others", async () => {
    const res = await get("https://app.geraiexpress.com/pengiriman", { cookie: "ge_tenant=t; gx_at=old-access; gx_rt=old-refresh" });
    const forwarded = res.headers.get("x-middleware-request-cookie") ?? "";
    expect(forwarded).toContain("gx_at=rotated-access");
    expect(forwarded).toContain("gx_rt=rotated-refresh");
    expect(forwarded).toContain("ge_tenant=t");
    expect(forwarded).not.toContain("old-access");
    expect(forwarded).not.toContain("old-refresh");
    expect((res.headers.get("x-middleware-override-headers") ?? "").split(",")).toContain("cookie");
  });

  it("leaves the refresh cookie alone on a recent reuse, which carries no new refresh token", async () => {
    auth.refresh.mockResolvedValue(rotated({ refreshToken: null }));
    const res = await get("https://app.geraiexpress.com/pengiriman", sessionCookies);
    expect(cookieOf(res, "gx_at")).toContain("gx_at=rotated-access");
    expect(cookieOf(res, "gx_rt")).toBe("");
    const forwarded = res.headers.get("x-middleware-request-cookie") ?? "";
    expect(forwarded).toContain("gx_at=rotated-access");
    expect(forwarded).toContain("gx_rt=old-refresh");
  });

  it("clears both cookies, on the response and for the request, when the refresh token is invalid", async () => {
    auth.refresh.mockResolvedValue({ ok: false, reason: "invalid" });
    const res = await get("https://app.geraiexpress.com/pengiriman", { cookie: "ge_tenant=t; gx_at=old-access; gx_rt=old-refresh" });
    expect(res.status).toBe(200);
    for (const name of ["gx_at", "gx_rt"]) {
      const header = cookieOf(res, name);
      expect(header, name).toMatch(new RegExp(`^${name}=;`));
      expect(header, name).toMatch(/Max-Age=0/i);
      expect(header, name).toMatch(/HttpOnly/i);
      expect(header, name).not.toMatch(/Domain=/i);
    }
    const forwarded = res.headers.get("x-middleware-request-cookie") ?? "";
    expect(forwarded).not.toContain("gx_at");
    expect(forwarded).not.toContain("gx_rt");
    expect(forwarded).toContain("ge_tenant=t");
  });

  it("clears both cookies when a refresh token was reused", async () => {
    auth.refresh.mockResolvedValue({ ok: false, reason: "reuse_detected" });
    const res = await get("https://app.geraiexpress.com/pengiriman", sessionCookies);
    expect(cookieOf(res, "gx_at")).toMatch(/Max-Age=0/i);
    expect(cookieOf(res, "gx_rt")).toMatch(/Max-Age=0/i);
  });

  it("clears the cookies of a revoked session on a server action without refreshing", async () => {
    auth.verifyAccessToken.mockResolvedValue({
      ok: true,
      claims: { sub: USER, role: "authenticated", aud: "authenticated", iat: 0, exp: Math.floor(Date.now() / 1000) + 500, session_id: SESSION },
    });
    const res = await send("POST", "https://app.geraiexpress.com/pengiriman", sessionCookies);
    expect(auth.sessionLive).toHaveBeenCalledExactlyOnceWith(SESSION);
    expect(auth.refresh).not.toHaveBeenCalled();
    expect(cookieOf(res, "gx_at")).toMatch(/Max-Age=0/i);
    expect(cookieOf(res, "gx_rt")).toMatch(/Max-Age=0/i);
  });

  it("passes a request with a valid access token through untouched", async () => {
    auth.verifyAccessToken.mockResolvedValue({
      ok: true,
      claims: { sub: USER, role: "authenticated", aud: "authenticated", iat: 0, exp: Math.floor(Date.now() / 1000) + 500, session_id: SESSION },
    });
    const res = await get("https://app.geraiexpress.com/pengiriman", sessionCookies);
    expect(res.headers.get("x-middleware-next")).toBe("1");
    expect(setCookies(res)).toEqual([]);
    expect(auth.refresh).not.toHaveBeenCalled();
    expect(withinLimit).not.toHaveBeenCalled();
  });
});

describe("a refused refresh answers 503 and keeps the session", () => {
  beforeEach(resetAuth);
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  const expectRefusal = async (res: Response) => {
    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBe("60");
    expect(res.headers.get("x-middleware-next")).toBeNull();
    // Cookies are never cleared by a refusal: the browser keeps its session for a later attempt.
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(res.headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
    expect(await res.text()).toBe("Layanan sedang sibuk. Coba lagi sebentar lagi.");
  };

  it("when the local refresh budget is spent, without calling refresh", async () => {
    withinLimit.mockResolvedValue(false);
    await expectRefusal(await get("https://app.geraiexpress.com/pengiriman", sessionCookies));
    expect(auth.refresh).not.toHaveBeenCalled();
  });

  it("when the database cannot answer the refresh", async () => {
    auth.refresh.mockRejectedValue(new AuthUnavailableError("refresh"));
    await expectRefusal(await get("https://app.geraiexpress.com/pengiriman", sessionCookies));
  });

  it("when the auth module fails unexpectedly, logging the event without details", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    getAuth.mockImplementation(() => { throw new Error("AUTH_JWT_SECRET and AUTH_SECRET must be set"); });
    await expectRefusal(await get("https://app.geraiexpress.com/pengiriman", sessionCookies));
    expect(error).toHaveBeenCalledExactlyOnceWith(JSON.stringify({ event: "session_resolution_failed", route: "proxy" }));
  });

  it("budgets the refresh by the visitor address from the trusted proxy header only", async () => {
    vi.stubEnv("TRUSTED_PROXY", "1");
    await get("https://app.geraiexpress.com/pengiriman", { ...sessionCookies, "x-real-ip": "203.0.113.7", "x-forwarded-for": "192.0.2.9", "cf-connecting-ip": "192.0.2.10" });
    expect(withinLimit).toHaveBeenCalledExactlyOnceWith("REFRESH_LIMITER", "203.0.113.7");
  });

  it("never takes the visitor from a client-controllable header: X-Forwarded-For and CF-Connecting-IP are ignored, and so is X-Real-IP without TRUSTED_PROXY", async () => {
    vi.stubEnv("TRUSTED_PROXY", "1");
    await get("https://app.geraiexpress.com/pengiriman", { ...sessionCookies, "x-forwarded-for": "192.0.2.9", "cf-connecting-ip": "192.0.2.10" });
    expect(withinLimit).toHaveBeenLastCalledWith("REFRESH_LIMITER", null);
    vi.stubEnv("TRUSTED_PROXY", "");
    await get("https://app.geraiexpress.com/pengiriman", { ...sessionCookies, "x-real-ip": "203.0.113.7" });
    expect(withinLimit).toHaveBeenLastCalledWith("REFRESH_LIMITER", null);
  });
});

describe("shared all-audiences hosts need the explicit flag (B-T042)", () => {
  beforeEach(resetAuth);
  afterEach(() => vi.unstubAllEnvs());

  async function maxAge(url: string) {
    const res = await get(url, refreshOnly);
    return cookieOf(res, "gx_at");
  }

  it("a foreign host (a former workers.dev preview name) answers 404 with or without HOST_SHARED_MODE=1", async () => {
    const url = "https://geraiexpress-preview.ongki.workers.dev";
    for (const flag of [undefined, "1"]) {
      if (flag) vi.stubEnv("HOST_SHARED_MODE", flag);
      for (const path of ["/admin", "/pengiriman", "/fitur", "/masuk"]) expect((await get(`${url}${path}`)).status, `${path} ${flag}`).toBe(404);
    }
  });

  it("a production build answers 404 on a loopback host unless the flag is set; development and test builds serve it", async () => {
    expect((await get("http://127.0.0.1:3100/admin")).status).toBe(200); // test build
    vi.stubEnv("NODE_ENV", "production");
    for (const url of ["http://127.0.0.1:3100/admin", "http://localhost:3100/pengiriman", "http://app.localhost:3100/pengiriman"]) {
      const res = await get(url);
      expect(res.status, url).toBe(404);
      expect(res.headers.get("location")).toBeNull();
    }
    vi.stubEnv("HOST_SHARED_MODE", "1");
    expect((await get("http://127.0.0.1:3100/admin")).status).toBe(200);
  });

  it("on a shared host the session bound follows the audience of the path, not the host", async () => {
    vi.stubEnv("HOST_SHARED_MODE", "1");
    expect(await maxAge("http://127.0.0.1:3100/admin")).toMatch(/Max-Age=43200/i);
    expect(await maxAge("http://127.0.0.1:3100/pengiriman")).toMatch(/Max-Age=604800/i);
    expect(await maxAge("http://127.0.0.1:3100/masuk")).toMatch(/Max-Age=604800/i);
  });

  it("forwards the route family to the application and overwrites a caller-supplied value", async () => {
    const res = await get("http://127.0.0.1:3100/admin/audit", { "x-gx-route-family": "tenant" });
    expect(res.headers.get("x-middleware-request-x-gx-route-family")).toBe("platform");
    const tenant = await get("http://127.0.0.1:3100/pengiriman", { "x-gx-route-family": "platform" });
    expect(tenant.headers.get("x-middleware-request-x-gx-route-family")).toBe("tenant");
  });
});

describe("nonce propagation and report-only script rollout", () => {
  beforeEach(resetAuth);

  it("uses a fresh nonce on each host and denial, without enforcing scripts", async () => {
    const nonces = new Set<string>();
    for (const url of [
      "https://geraiexpress.com/",
      "https://app.geraiexpress.com/masuk",
      "https://owner.geraiexpress.com/masuk",
      "https://hooks.geraiexpress.com/api/webhooks/mengantar",
      "https://app.geraiexpress.com/admin",
    ]) {
      const response = await get(url, { "x-nonce": "attacker-nonce", "content-security-policy": "script-src 'nonce-attacker-nonce'" });
      const report = response.headers.get("Content-Security-Policy-Report-Only")!;
      const nonce = report.match(/'nonce-([^']+)'/)?.[1];
      expect(nonce, url).toMatch(/^[A-Za-z0-9+/]{22}==$/);
      expect(report, url).toContain("'strict-dynamic' https://challenges.cloudflare.com");
      expect(report, url).toContain("frame-src https://challenges.cloudflare.com");
      expect(report, url).not.toContain("attacker-nonce");
      expect(response.headers.get("Content-Security-Policy"), url).not.toContain("script-src");
      expect(response.headers.get("Permissions-Policy"), url).toBe("camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()");
      nonces.add(nonce!);
      if (response.status === 200) {
        expect(response.headers.get("x-middleware-request-x-nonce"), url).toBe(nonce);
        expect(response.headers.get("x-middleware-request-content-security-policy"), url).toBe(report);
      }
    }
    expect(nonces.size).toBe(5);
  });

  it("retains the rendering nonce when the session refresh rewrites the response", async () => {
    const response = await get("https://app.geraiexpress.com/pengiriman", refreshOnly);
    const report = response.headers.get("Content-Security-Policy-Report-Only");
    const nonce = response.headers.get("x-middleware-request-x-nonce");
    expect(nonce).toBeTruthy();
    expect(report).toContain(`'nonce-${nonce}'`);
    expect(response.headers.get("x-middleware-request-content-security-policy")).toBe(report);
    expect(cookieOf(response, "gx_at")).toContain("gx_at=rotated-access");
    expect(response.headers.get("Content-Security-Policy")).not.toContain("script-src");
  });
});

describe("public tracking edge (SEC-8)", () => {
  beforeEach(resetAuth);
  it("sets apex noindex/no-store/CSP, strips cookies and overwrites a forged projection even on shared development hosts", async () => {
    const { readPublicTracking } = await import("../../src/modules/tracking/public-read");
    const projection = { gerai_label: null, courier: "JT", service: "REG", awb: "JP1234567890", status_label: "Status belum tersedia", timeline: [], destination_city: null, sender_initials: null, recipient_initials: "P. U.", created_at: "2026-11-05T00:00:00Z", issued_at: null } as const;
    vi.mocked(readPublicTracking).mockResolvedValue({ kind: "found", projection: { ...projection, timeline: [] } });
    for (const origin of ["https://geraiexpress.com", "http://localhost:3100"]) {
      const res = await get(`${origin}/lacak/${"A".repeat(43)}`, { ...sessionCookies, "x-gx-public-tracking": "forged" });
      expect(res.status).toBe(200);
      expect(res.headers.get("x-middleware-request-cookie")).toBeNull();
      expect(res.headers.get("x-middleware-request-x-gx-public-tracking")).toBe(encodeURIComponent(JSON.stringify(projection)));
      expect(res.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
      expect(res.headers.get("Cache-Control")).toBe("private, no-store");
      expect(res.headers.get("Content-Security-Policy")).toBeTruthy();
      expect(res.headers.getSetCookie()).toEqual([]);
    }
    expect(getAuth).not.toHaveBeenCalled();
    vi.mocked(readPublicTracking).mockResolvedValue({ kind: "missing" });
  });
  it("returns the identical non-streamed 404 for unknown, malformed, revoked and expired tokens", async () => {
    const { readPublicTracking } = await import("../../src/modules/tracking/public-read");
    vi.mocked(readPublicTracking).mockResolvedValue({ kind: "missing" });
    const bodies = [];
    for (const token of ["bad", "U".repeat(43), "R".repeat(43), "E".repeat(43)]) {
      const res = await get(`https://geraiexpress.com/lacak/${token}`);
      expect(res.status).toBe(404);
      expect(res.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
      bodies.push(await res.text());
    }
    expect(new Set(bodies).size).toBe(1);
    expect(bodies[0]).toContain("Halaman tidak ditemukan");
  });
  it("answers 429 with Retry-After for an exhausted visitor, without cookies or a session", async () => {
    const { readPublicTracking } = await import("../../src/modules/tracking/public-read");
    vi.mocked(readPublicTracking).mockResolvedValueOnce({ kind: "limited" });
    const res = await get(`https://geraiexpress.com/lacak/${"A".repeat(43)}`, sessionCookies);
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("60");
    expect(res.headers.getSetCookie()).toEqual([]);
    expect(getAuth).not.toHaveBeenCalled();
  });
});
