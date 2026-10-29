import { scopeForHost, type RouteFamily } from "../hosts";

// SEC-6 / TD-14 / ADR-0002 section 3.3: one attribute policy for the two session cookies, `gx_at`
// (access JWT) and `gx_rt` (refresh token), applied right before each cookie is written.
//
// - No `Domain`: the cookie is host-only, so a session set on the app host is never sent to the
//   owner host or the apex (DEC-015, TEN-6).
// - HttpOnly: no script ever reads a token. Secure on HTTPS requests and in production builds;
//   SameSite=Lax; path `/`.
// - Bounded lifetime. The server-side session expiry (7 days gerai, 12 hours Super Admin, enforced in
//   the database) is authoritative; the cookie bound only mirrors it. On a host that serves every
//   audience (local, preview) the bound follows the audience of the PATH being served (the platform
//   route family), not the host: the proxy forwards that family in ROUTE_FAMILY_HEADER.
export const ACCESS_COOKIE = "gx_at";
export const REFRESH_COOKIE = "gx_rt";
export const ROUTE_FAMILY_HEADER = "x-gx-route-family";
export const TENANT_SESSION_MAX_AGE = 7 * 24 * 60 * 60;
export const PLATFORM_SESSION_MAX_AGE = 12 * 60 * 60;

export type CookieOptions = {
  maxAge?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "lax" | "strict" | "none" | boolean;
  path?: string;
  domain?: string;
};

export type SessionCookieContext = { secure: boolean; platform: boolean };

export function sessionCookieContext(host: string | null | undefined, https: boolean, family?: RouteFamily | string | null): SessionCookieContext {
  const scope = scopeForHost(host);
  return {
    secure: https || process.env.NODE_ENV === "production",
    platform: scope === "platform" || (scope === "shared" && family === "platform"),
  };
}

export function sessionCookieOptions(options: CookieOptions | undefined, context: SessionCookieContext): CookieOptions {
  const { domain: _domain, ...rest } = options ?? {};
  const bound = context.platform ? PLATFORM_SESSION_MAX_AGE : TENANT_SESSION_MAX_AGE;
  return {
    ...rest,
    httpOnly: true,
    secure: context.secure,
    sameSite: "lax",
    path: "/",
    // A removal (maxAge 0) stays a removal; a set can never outlive the bound.
    maxAge: rest.maxAge === 0 ? 0 : Math.min(rest.maxAge ?? bound, bound),
  };
}

// The selector cookie for the current gerai. Host-only on the app host and only a selector: it is
// validated against the caller's memberships on every request and never grants access (TEN-1).
export const TENANT_SELECTOR_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  secure: process.env.NODE_ENV === "production",
};
