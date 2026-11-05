import { describe, expect, it } from "vitest";
import {
  LOCAL_ORIGIN,
  PRODUCTION_PUBLIC_HOSTS,
  appHref,
  appOrigin,
  originConfigured,
  originFor,
  routeAllowed,
  routeFamily,
  scopeForHost,
  type HostScope,
  type RouteFamily,
} from "../../src/lib/hosts";
import { PRODUCTION_HOSTS } from "../../src/lib/marketing-data";
import { PLATFORM_SESSION_MAX_AGE, TENANT_SESSION_MAX_AGE, sessionCookieContext, sessionCookieOptions } from "../../src/lib/db/cookies";

// One real path per route family, taken from the routes under src/app.
const PATHS: Record<RouteFamily, string[]> = {
  entry: ["/"],
  marketing: ["/fitur", "/simulasi", "/cara-kerja", "/hubungi-kami", "/sitemap.xml"],
  tracking: ["/lacak/opaque-token", "/lacak/unknown"],
  robots: ["/robots.txt"],
  signin: ["/masuk"],
  tenant: [
    "/akses", "/pilih-gerai", "/undangan", "/daftar", "/daftar/gerai", "/daftar/kata-sandi", "/pengiriman",
    "/pengiriman/baru", "/pengiriman/abc/label", "/kontak", "/kontak/abc", "/pengaturan", "/anggota",
    "/api/mengantar/area",
  ],
  platform: ["/admin", "/admin/pengajuan", "/admin/integrasi", "/admin/akses", "/admin/audit", "/verifikasi-2fa"],
  hook: ["/api/webhooks/mengantar"],
  health: ["/healthz"],
  cron: ["/api/internal/cron/dispatch", "/api/internal/cron/cleanup"],
  asset: ["/_next/static/chunks/a.js", "/_next/image", "/favicon.ico"],
};

// The audience matrix as the spec states it (ARCH-6, UX-11, TD-14): which families each host serves.
const SERVES: Record<string, RouteFamily[]> = {
  "geraiexpress.com": ["entry", "marketing", "tracking", "robots", "health", "asset"],
  "app.geraiexpress.com": ["entry", "robots", "signin", "tenant", "health", "asset"],
  "owner.geraiexpress.com": ["entry", "robots", "signin", "platform", "health", "asset"],
  "hooks.geraiexpress.com": ["hook", "health"],
  "internal.geraiexpress.local:3000": ["cron", "health"],
};
const ALL_FAMILIES = Object.keys(PATHS) as RouteFamily[];

describe("host table", () => {
  // The shared-mode flag set on a production build (the container behind the local proxy profile).
  const sharedProduction = { NODE_ENV: "production", HOST_SHARED_MODE: "1" };

  it("maps production, staging, local and internal names to one audience each", () => {
    const expected: [string, HostScope][] = [
      ["geraiexpress.com", "public"],
      ["app.geraiexpress.com", "tenant"],
      ["owner.geraiexpress.com", "platform"],
      ["hooks.geraiexpress.com", "hooks"],
      ["staging.geraiexpress.com", "public"],
      ["app-staging.geraiexpress.com", "tenant"],
      ["owner-staging.geraiexpress.com", "platform"],
      ["hooks-staging.geraiexpress.com", "hooks"],
      ["site.localhost:3342", "public"],
      ["app.localhost:3342", "tenant"],
      ["owner.localhost", "platform"],
      ["hooks.localhost:3000", "hooks"],
      ["localhost:3100", "shared"],
      ["127.0.0.1:3342", "shared"],
      ["[::1]:3000", "shared"],
      ["internal.geraiexpress.local:3000", "internal"],
    ];
    for (const env of [sharedProduction, { NODE_ENV: "development", HOST_SHARED_MODE: "1" }]) {
      for (const [host, scope] of expected) expect(scopeForHost(host, env), `${host} ${JSON.stringify(env)}`).toBe(scope);
    }
  });

  it("serves loopback and *.localhost in non-production builds without any flag", () => {
    for (const env of [{}, { NODE_ENV: "development" }, { NODE_ENV: "test" }]) {
      expect(scopeForHost("127.0.0.1:3100", env)).toBe("shared");
      expect(scopeForHost("localhost", env)).toBe("shared");
      expect(scopeForHost("app.localhost:3342", env)).toBe("tenant");
      expect(scopeForHost("internal.geraiexpress.local", env)).toBe("internal");
    }
  });

  it("a production build answers 404 on loopback and *.localhost hosts unless HOST_SHARED_MODE is exactly 1", () => {
    for (const flag of [undefined, "", "0", "true", "yes", " 2"]) {
      const env = { NODE_ENV: "production", HOST_SHARED_MODE: flag };
      for (const host of ["127.0.0.1:3100", "localhost", "[::1]", "app.localhost", "owner.localhost"]) {
        expect(scopeForHost(host, env), `${host} flag=${String(flag)}`).toBeNull();
      }
      // The production names are unaffected.
      expect(scopeForHost("app.geraiexpress.com", env)).toBe("tenant");
      expect(scopeForHost("owner.geraiexpress.com", env)).toBe("platform");
    }
    expect(scopeForHost("127.0.0.1:3100", { NODE_ENV: "production", HOST_SHARED_MODE: " 1 " })).toBe("shared");
  });

  it("serves DEV_EXTRA_HOSTS as shared only where loopback would be served, and nothing else", () => {
    const extra = "100.127.67.86, laptop.tailnet.ts.net";
    expect(scopeForHost("100.127.67.86:3100", { NODE_ENV: "development", DEV_EXTRA_HOSTS: extra })).toBe("shared");
    expect(scopeForHost("Laptop.Tailnet.ts.net", { DEV_EXTRA_HOSTS: extra })).toBe("shared");
    // Unset, empty or another address: still not served.
    expect(scopeForHost("100.127.67.86:3100", { NODE_ENV: "development" })).toBeNull();
    expect(scopeForHost("100.127.67.86", { DEV_EXTRA_HOSTS: " , " })).toBeNull();
    expect(scopeForHost("100.127.67.87", { DEV_EXTRA_HOSTS: extra })).toBeNull();
    // A production build honors it only with the shared flag, like loopback.
    expect(scopeForHost("100.127.67.86", { NODE_ENV: "production", DEV_EXTRA_HOSTS: extra })).toBeNull();
    expect(scopeForHost("100.127.67.86", { NODE_ENV: "production", DEV_EXTRA_HOSTS: extra, HOST_SHARED_MODE: "1" })).toBe("shared");
  });

  it("normalizes case, port and a trailing dot", () => {
    expect(scopeForHost("App.GeraiExpress.com:443")).toBe("tenant");
    expect(scopeForHost("owner.geraiexpress.com.")).toBe("platform");
  });

  it("serves nothing for hosts it does not own (fail closed)", () => {
    for (const host of [
      null, undefined, "", "example.com", "geraiexpress.com.evil.example", "app.geraiexpress.com.evil.example",
      "evil-geraiexpress.com", "www.geraiexpress.com", "app.staging.geraiexpress.com", "other.geraiexpress.com",
      "workers.dev", "geraiexpress-preview.ongki.workers.dev", "evil.localhost", "host.docker.internal:3199",
      "internal.geraiexpress.local.evil.example", "x.internal.geraiexpress.local",
    ]) {
      expect(scopeForHost(host), String(host)).toBeNull();
      expect(routeAllowed(scopeForHost(host), "/"), String(host)).toBe(false);
    }
  });

  it("derives the production public host from the one list the indexing rules use", () => {
    expect(PRODUCTION_HOSTS).toEqual(PRODUCTION_PUBLIC_HOSTS);
    for (const host of PRODUCTION_PUBLIC_HOSTS) expect(scopeForHost(host)).toBe("public");
  });
});

describe("route matrix (every host x route family)", () => {
  for (const [host, served] of Object.entries(SERVES)) {
    for (const family of ALL_FAMILIES) {
      const allowed = served.includes(family);
      it(`${host} ${allowed ? "serves" : "answers 404 for"} ${family} routes`, () => {
        for (const path of PATHS[family]) expect(routeAllowed(scopeForHost(host), path), `${host}${path}`).toBe(allowed);
      });
    }
  }

  it("a host serving every audience (local) serves every family except the internal cron routes", () => {
    for (const family of ALL_FAMILIES) {
      for (const path of PATHS[family]) expect(routeAllowed("shared", path), path).toBe(family !== "cron");
    }
  });

  it("the owner host never serves a tenant route and the app host never a platform route", () => {
    for (const path of PATHS.tenant) expect(routeAllowed("platform", path), path).toBe(false);
    for (const path of PATHS.platform) expect(routeAllowed("tenant", path), path).toBe(false);
  });

  it("the hooks host serves the webhook prefix only, and the webhooks only there; the removed Send Email Hook path is served nowhere", () => {
    expect(routeAllowed("hooks", "/api/webhooks/mengantar")).toBe(true);
    expect(routeAllowed("hooks", "/api/auth/send-email")).toBe(false);
    for (const scope of ["public", "tenant", "platform"] as const) {
      expect(routeAllowed(scope, "/api/webhooks/mengantar"), scope).toBe(false);
    }
    for (const scope of ["public", "tenant", "platform", "hooks", "shared", "internal"] as const) {
      expect(routeAllowed(scope, "/api/auth/send-email"), scope).toBe(false);
    }
  });

  it("the internal cron routes exist on the internal host only: no public, shared or local-audience host serves them", () => {
    for (const path of PATHS.cron) {
      expect(routeAllowed("internal", path), path).toBe(true);
      for (const scope of ["public", "tenant", "platform", "hooks", "shared"] as const) expect(routeAllowed(scope, path), `${scope}${path}`).toBe(false);
      for (const host of ["geraiexpress.com", "app.geraiexpress.com", "owner.geraiexpress.com", "hooks.geraiexpress.com", "127.0.0.1:3100", "localhost", "app.localhost"]) {
        expect(routeAllowed(scopeForHost(host, { NODE_ENV: "development", HOST_SHARED_MODE: "1" }), path), `${host}${path}`).toBe(false);
      }
    }
    // The internal host serves nothing else.
    for (const path of ["/", "/masuk", "/pengiriman", "/admin", "/api/auth/send-email", "/api/internal", "/api/internal/other"]) {
      expect(routeAllowed("internal", path), path).toBe(false);
    }
  });

  it("matches prefixes on a segment boundary and fails closed on unusual spellings", () => {
    expect(routeFamily("tenant", "/pengiriman/")).toBe("tenant");
    expect(routeFamily("platform", "/admin/")).toBe("platform");
    for (const path of ["/daftarx", "/administrator", "/Admin", "/%61dmin", "/pengiriman%2f..%2fadmin", "/nope", "//admin", "/api/auth"]) {
      expect(routeAllowed("shared", path), path).toBe(false);
    }
  });
});

describe("per-environment origins", () => {
  it("defaults to the local origin when nothing is configured", () => {
    expect(originFor("tenant", {})).toBe(LOCAL_ORIGIN);
    expect(appOrigin({})).toBe(LOCAL_ORIGIN);
    expect(originConfigured("tenant", {})).toBe(false);
    expect(originConfigured("tenant", { APP_ORIGIN: "  " })).toBe(false);
  });

  it("reads one variable per audience and normalizes to an origin", () => {
    const env = {
      SITE_ORIGIN: "https://geraiexpress.com/",
      APP_ORIGIN: "https://app.geraiexpress.com",
      OWNER_ORIGIN: "https://owner.geraiexpress.com",
      HOOKS_ORIGIN: "https://hooks.geraiexpress.com",
    };
    expect(originFor("public", env)).toBe("https://geraiexpress.com");
    expect(originFor("tenant", env)).toBe("https://app.geraiexpress.com");
    expect(originFor("platform", env)).toBe("https://owner.geraiexpress.com");
    expect(originFor("hooks", env)).toBe("https://hooks.geraiexpress.com");
  });

  it("refuses a malformed or non-origin value instead of guessing", () => {
    for (const bad of ["app.geraiexpress.com", "javascript:alert(1)", "https://app.geraiexpress.com/masuk", "https://u:p@app.geraiexpress.com", "https://app.geraiexpress.com?x=1"]) {
      expect(() => originFor("tenant", { APP_ORIGIN: bad }), bad).toThrow(/APP_ORIGIN/);
    }
  });

  it("links to the app host with the configured origin, and stays relative only outside a production build", () => {
    expect(appHref("/masuk", {})).toBe("/masuk");
    expect(appHref("/masuk", { NODE_ENV: "development" })).toBe("/masuk");
    expect(appHref("/daftar", { APP_ORIGIN: "https://app.geraiexpress.com" })).toBe("https://app.geraiexpress.com/daftar");
    expect(appHref("/masuk", { NODE_ENV: "production", APP_ORIGIN: "https://app.geraiexpress.com" })).toBe("https://app.geraiexpress.com/masuk");
  });

  it("a production build refuses to emit the marketing CTA link without APP_ORIGIN (no relative link that 404s on the apex)", () => {
    expect(() => appHref("/masuk", { NODE_ENV: "production" })).toThrow(/APP_ORIGIN is not configured/);
    expect(() => appHref("/daftar", { NODE_ENV: "production", APP_ORIGIN: "  " })).toThrow(/APP_ORIGIN is not configured/);
  });

  it("a production build with an unset origin throws a configuration error instead of a local link", () => {
    for (const audience of ["public", "tenant", "platform", "hooks"] as const) {
      expect(() => originFor(audience, { NODE_ENV: "production" }), audience).toThrow(/is not configured/);
      expect(() => originFor(audience, { NODE_ENV: "production", SITE_ORIGIN: " ", APP_ORIGIN: " ", OWNER_ORIGIN: " ", HOOKS_ORIGIN: " " }), audience).toThrow(/is not configured/);
    }
    expect(() => appOrigin({ NODE_ENV: "production" })).toThrow(/APP_ORIGIN is not configured/);
    // Development and test builds keep the local fallback; a configured production origin is used.
    expect(originFor("tenant", { NODE_ENV: "development" })).toBe(LOCAL_ORIGIN);
    expect(originFor("tenant", { NODE_ENV: "production", APP_ORIGIN: "https://app.geraiexpress.com" })).toBe("https://app.geraiexpress.com");
  });
});

describe("Supabase session cookie attributes (SEC-6)", () => {
  const https = { secure: true, platform: false };

  it("sets HttpOnly, Lax, path /, a bound lifetime and never a Domain", () => {
    const set = sessionCookieOptions({ domain: ".geraiexpress.com", httpOnly: false, maxAge: 400 * 86400, sameSite: "none" }, https);
    expect(set).toEqual({ httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: TENANT_SESSION_MAX_AGE });
    expect("domain" in set).toBe(false);
    expect(TENANT_SESSION_MAX_AGE).toBe(7 * 24 * 60 * 60);
  });

  it("gives Super Admin sessions a shorter bound than gerai sessions", () => {
    const owner = sessionCookieOptions({ maxAge: 400 * 86400 }, { secure: true, platform: true });
    expect(owner.maxAge).toBe(PLATFORM_SESSION_MAX_AGE);
    expect(PLATFORM_SESSION_MAX_AGE).toBeLessThan(TENANT_SESSION_MAX_AGE);
    expect(sessionCookieOptions(undefined, https).maxAge).toBe(TENANT_SESSION_MAX_AGE);
  });

  it("keeps a removal a removal and never extends a shorter lifetime", () => {
    expect(sessionCookieOptions({ maxAge: 0 }, https).maxAge).toBe(0);
    expect(sessionCookieOptions({ maxAge: 60 }, https).maxAge).toBe(60);
  });

  it("marks cookies Secure on HTTPS requests and picks the platform bound by host", () => {
    expect(sessionCookieContext("owner.geraiexpress.com", true)).toEqual({ secure: true, platform: true });
    expect(sessionCookieContext("app.geraiexpress.com", true)).toEqual({ secure: true, platform: false });
    expect(sessionCookieContext("app.localhost:3342", false).secure).toBe(process.env.NODE_ENV === "production");
    expect(sessionCookieOptions({}, sessionCookieContext("app.geraiexpress.com", true)).secure).toBe(true);
    expect(sessionCookieOptions({}, { secure: false, platform: false }).secure).toBe(false);
    // A host serving every audience (local, preview) takes the bound from the audience of the PATH,
    // not the host: the platform route family gets the Super Admin bound, every other path the gerai bound.
    expect(sessionCookieContext("127.0.0.1:3100", false).platform).toBe(false);
    expect(sessionCookieContext("127.0.0.1:3100", false, "tenant").platform).toBe(false);
    expect(sessionCookieContext("127.0.0.1:3100", false, "signin").platform).toBe(false);
    expect(sessionCookieContext("127.0.0.1:3100", false, "platform").platform).toBe(true);
    expect(sessionCookieOptions({ maxAge: 400 * 86400 }, sessionCookieContext("localhost:3100", false, "platform")).maxAge).toBe(PLATFORM_SESSION_MAX_AGE);
    expect(sessionCookieOptions({ maxAge: 400 * 86400 }, sessionCookieContext("localhost:3100", false, "tenant")).maxAge).toBe(TENANT_SESSION_MAX_AGE);
    // On a single-audience host the family hint changes nothing: the host decides.
    expect(sessionCookieContext("app.geraiexpress.com", true, "platform").platform).toBe(false);
    expect(sessionCookieContext("owner.geraiexpress.com", true, "tenant").platform).toBe(true);
  });
});
