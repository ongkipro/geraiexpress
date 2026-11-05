import { headers } from "next/headers";

// DEC-015 / PR-36 / ARCH-6 / TEN-6 / TD-14: one host table and one route matrix.
//
// Each host serves exactly one audience: the public site (apex), the gerai application (app), the
// Super Admin workspace (owner) or the cookie-less hooks host (provider webhooks). A path outside its
// host's audience is answered with a plain 404, never a redirect and never a pointer to another host.
// Hosts come from the Host header only (the reverse proxy forwards the original one); X-Forwarded-Host
// is never read. The tenant is not derived from
// the host (TEN-6): host separation is defense in depth, RLS and the RPC membership checks stay
// authoritative.
//
// A fifth, non-public name exists for the scheduler container and the container health check
// (T-062, DEC-020): `internal.geraiexpress.local`. It serves only the internal cron routes and
// /healthz. The reverse proxy neither routes that Host nor the /api/internal path from the internet,
// and the app answers 404 for those paths on every other host, so a public host can never reach them.

export type Audience = "public" | "tenant" | "platform" | "hooks";
// `shared` is a development host that serves every audience from one origin; `internal` is the
// scheduler/health-check host (cron and /healthz only).
export type HostScope = Audience | "shared" | "internal";

// Production names. The apex is the only indexable host (see marketing-data.isProductionHost).
export const PRODUCTION_APEX = "geraiexpress.com";
export const PRODUCTION_PUBLIC_HOSTS: readonly string[] = [PRODUCTION_APEX];

// Non-production names are single-level (`app-staging.`, not `app.staging.`) so one wildcard-free
// certificate set per environment stays simple. The staging apex name is a Proposal.
const HOST_TABLE: Readonly<Record<string, Audience>> = {
  [PRODUCTION_APEX]: "public",
  [`app.${PRODUCTION_APEX}`]: "tenant",
  [`owner.${PRODUCTION_APEX}`]: "platform",
  [`hooks.${PRODUCTION_APEX}`]: "hooks",
  [`staging.${PRODUCTION_APEX}`]: "public",
  [`app-staging.${PRODUCTION_APEX}`]: "tenant",
  [`owner-staging.${PRODUCTION_APEX}`]: "platform",
  [`hooks-staging.${PRODUCTION_APEX}`]: "hooks",
};

export const INTERNAL_HOST = "internal.geraiexpress.local";

// Local development names serve more than one audience or none of the production names, so they
// answer only where this deployment is explicitly a development one:
//   - bare loopback names (localhost, 127.0.0.1, [::1]) serve every audience ("shared") in any build
//     that is not a production build (`next dev`, the Playwright suite), or when HOST_SHARED_MODE=1
//     (a production-build container behind the local proxy profile);
//   - the `*.localhost` names pick one audience (the host split can be exercised locally without DNS);
//     they follow the same gate as loopback.
// A production build without the flag answers 404 on all of them (fail closed): a loopback Host
// header cannot open every audience on a production container. The shared scope never includes the
// internal cron routes.
const LOOPBACK_HOSTS: readonly string[] = ["localhost", "127.0.0.1", "[::1]"];
const LOCAL_AUDIENCE_HOSTS: Readonly<Record<string, Audience>> = {
  "site.localhost": "public",
  "app.localhost": "tenant",
  "owner.localhost": "platform",
  "hooks.localhost": "hooks",
};

export const SHARED_MODE_VAR = "HOST_SHARED_MODE";
// Local-network development (for example a Tailscale address): a comma-separated list of bare hosts that
// are served as the shared scope exactly like loopback, behind the same gate (not a production build, or
// HOST_SHARED_MODE=1). Unset means none; a production build without the shared flag never honors it.
export const DEV_HOSTS_VAR = "DEV_EXTRA_HOSTS";

type Env = Readonly<Record<string, string | undefined>>;

// process.env plus an explicit NODE_ENV read: bundlers inline that literal, so the build mode is known
// even where the runtime environment object does not carry NODE_ENV.
const processEnv = (): Env => ({ ...process.env, NODE_ENV: process.env.NODE_ENV });

const sharedFlag = (env: Env) => env[SHARED_MODE_VAR]?.trim() === "1";
const productionBuild = (env: Env) => env.NODE_ENV === "production";

export function normalizeHost(host: string | null | undefined): string {
  return (host ?? "").trim().toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "");
}

export function devHosts(env: Env = processEnv()): string[] {
  return (env[DEV_HOSTS_VAR] ?? "").split(",").map((h) => normalizeHost(h)).filter(Boolean);
}

// null = not a host this deployment serves: every path answers 404 (fail closed).
export function scopeForHost(host: string | null | undefined, env: Env = processEnv()): HostScope | null {
  const bare = normalizeHost(host);
  if (!bare) return null;
  if (Object.hasOwn(HOST_TABLE, bare)) return HOST_TABLE[bare];
  if (bare === INTERNAL_HOST) return "internal";
  const localAllowed = sharedFlag(env) || !productionBuild(env);
  if (Object.hasOwn(LOCAL_AUDIENCE_HOSTS, bare)) return localAllowed ? LOCAL_AUDIENCE_HOSTS[bare] : null;
  if (LOOPBACK_HOSTS.includes(bare)) return localAllowed ? "shared" : null;
  if (localAllowed && devHosts(env).includes(bare)) return "shared";
  return null;
}

// Route families. A family is a set of exact paths plus path prefixes matched on a segment
// boundary (`/daftar` covers `/daftar` and `/daftar/gerai`, not `/daftarx`).
type PathRule = { exact: readonly string[]; prefixes: readonly string[] };
export type RouteFamily = "entry" | "marketing" | "tracking" | "robots" | "signin" | "tenant" | "platform" | "hook" | "health" | "asset" | "cron";

export const ROUTE_FAMILIES: Readonly<Record<RouteFamily, PathRule>> = {
  entry: { exact: ["/"], prefixes: [] },
  marketing: { exact: ["/fitur", "/simulasi", "/cara-kerja", "/hubungi-kami", "/sitemap.xml"], prefixes: [] },
  tracking: { exact: [], prefixes: ["/lacak"] },
  robots: { exact: ["/robots.txt"], prefixes: [] },
  // Both the gerai sign-in and the platform sign-in (the second factor follows on /verifikasi-2fa).
  signin: { exact: ["/masuk"], prefixes: [] },
  tenant: {
    exact: ["/akses", "/pilih-gerai", "/undangan", "/api/mengantar/area"],
    prefixes: ["/daftar", "/pengiriman", "/kontak", "/pengaturan", "/anggota"],
  },
  // `/verifikasi-2fa` follows the platform class: the second factor protects the platform workspace.
  platform: { exact: ["/verifikasi-2fa"], prefixes: ["/admin"] },
  // The future provider webhooks, each under its own prefix.
  hook: { exact: [], prefixes: ["/api/webhooks"] },
  health: { exact: ["/healthz"], prefixes: [] },
  // The scheduler's routes (T-062): reachable only on the internal host, see INTERNAL_FAMILIES.
  cron: { exact: [], prefixes: ["/api/internal/cron"] },
  asset: { exact: ["/favicon.ico"], prefixes: ["/_next"] },
};

export const AUDIENCE_FAMILIES: Readonly<Record<Audience, readonly RouteFamily[]>> = {
  public: ["entry", "marketing", "tracking", "robots", "health", "asset"],
  tenant: ["entry", "robots", "signin", "tenant", "health", "asset"],
  platform: ["entry", "robots", "signin", "platform", "health", "asset"],
  hooks: ["hook", "health"],
};

const ALL_AUDIENCES: readonly Audience[] = ["public", "tenant", "platform", "hooks"];
const INTERNAL_FAMILIES: readonly RouteFamily[] = ["cron", "health"];

export function familiesFor(scope: HostScope): readonly RouteFamily[] {
  if (scope === "internal") return INTERNAL_FAMILIES;
  const audiences = scope === "shared" ? ALL_AUDIENCES : [scope];
  return [...new Set(audiences.flatMap((a) => AUDIENCE_FAMILIES[a]))];
}

function matches(rule: PathRule, pathname: string): boolean {
  return rule.exact.includes(pathname)
    || rule.prefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

// One trailing slash is ignored; anything else (encoded dots, other case) must match literally, so
// an unusual spelling fails closed with 404.
export function routeFamily(scope: HostScope, pathname: string): RouteFamily | null {
  const path = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  return familiesFor(scope).find((family) => matches(ROUTE_FAMILIES[family], path)) ?? null;
}

export function routeAllowed(scope: HostScope | null, pathname: string): boolean {
  return scope !== null && routeFamily(scope, pathname) !== null;
}

// Per-environment absolute origins (SITE_ORIGIN, APP_ORIGIN, OWNER_ORIGIN, HOOKS_ORIGIN). Every
// absolute URL the application builds (invitation links, call-to-action links to another host)
// starts here and never from a request header. Unset means local development: only a build that is
// not a production build falls back to LOCAL_ORIGIN; a production build with an unset origin throws a
// configuration error when a link is built, never a silent loopback link.
export const ORIGIN_VARS: Readonly<Record<Audience, string>> = {
  public: "SITE_ORIGIN",
  tenant: "APP_ORIGIN",
  platform: "OWNER_ORIGIN",
  hooks: "HOOKS_ORIGIN",
};
export const LOCAL_ORIGIN = "http://127.0.0.1:3100";

export function originConfigured(audience: Audience, env: Env = processEnv()): boolean {
  return Boolean(env[ORIGIN_VARS[audience]]?.trim());
}

export function originFor(audience: Audience, env: Env = processEnv()): string {
  const name = ORIGIN_VARS[audience];
  const raw = env[name]?.trim();
  if (!raw) {
    if (productionBuild(env)) throw new Error(`${name} is not configured: a production build never falls back to a local origin`);
    return LOCAL_ORIGIN;
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${name} is not a valid URL`);
  }
  const bare = url.pathname === "/" && !url.search && !url.hash && !url.username && !url.password;
  if (!/^https?:$/.test(url.protocol) || !bare) throw new Error(`${name} must be an http(s) origin without path or credentials`);
  return url.origin;
}

export const appOrigin = (env: Env = processEnv()) => originFor("tenant", env);

// Link to a gerai-application path. In a production build APP_ORIGIN is required (the link must be
// absolute to reach the app host from the apex, and a relative one would 404 there), so an unset
// value throws here exactly as originFor does. Outside a production build with APP_ORIGIN unset
// (local all-audiences mode, a single origin) the path stays relative and follows the origin being
// browsed; with it set the link is absolute.
export function appHref(path: string, env: Env = processEnv()): string {
  return productionBuild(env) || originConfigured("tenant", env) ? `${originFor("tenant", env)}${path}` : path;
}

// The scope of the request being served, for server components and actions.
export async function requestScope(): Promise<HostScope | null> {
  return scopeForHost((await headers()).get("host"));
}
