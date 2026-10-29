import { routeFamily, scopeForHost } from "./lib/hosts";
import { clientAddress } from "./lib/client-address";
import { NOINDEX_HEADER, isProductionHost } from "./lib/marketing-data";
import { ACCESS_COOKIE, REFRESH_COOKIE, ROUTE_FAMILY_HEADER, sessionCookieContext, sessionCookieOptions } from "./lib/db/cookies";
import { resolveSession } from "./lib/db/refresh";
import { getAuth } from "./lib/auth/instance";
import { buildCsp, createCspNonce } from "./lib/csp";
import { REFRESH_RETRY_AFTER_SECONDS, withinLimit } from "./lib/rate-limit";
import { NextResponse, type NextRequest } from "next/server";

// Host routing (DEC-015, ARCH-6, TD-14), then the session refresh, then defensive headers. Next 16 runs
// this file (the former middleware) on the Node.js runtime, so it can use the same auth module as the
// Server Actions.
//
// 1. The Host header picks the audience (src/lib/hosts.ts). A path outside that audience, and any
//    host this deployment does not serve, answers a plain 404: no redirect and no hint of another
//    host. X-Forwarded-Host is never read.
// 2. The session (src/lib/db/refresh.ts): a gx_at token that is missing, expired or about to expire is
//    rotated through the refresh token before the page renders; non-GET requests also check that the
//    session is still live. A locally refused refresh answers 503 + Retry-After and keeps the cookies.
//    The apex has no session, the hooks and internal hosts are cookie-less, and assets and /healthz
//    need none.
// 3. Every response is private; every host except the production apex is noindex (SUP-15).
export async function proxy(request: NextRequest) {
  const nonce = createCspNonce();
  const policy = buildCsp(nonce, process.env.NODE_ENV === "development");
  // Supply Next's documented nonce hint, never a browser-enforced script restriction. Next 16.4.3
  // dev copies the enforced response CSP back onto the render request (resolve-routes.js:465),
  // so nonce extraction currently produces informational Report-Only violations; do not enforce
  // scripts until that interaction is resolved. Always overwrite caller-supplied CSP/nonce hints.
  request.headers.set("x-nonce", nonce);
  request.headers.set("Content-Security-Policy", policy.reportOnly);
  request.headers.delete("Content-Security-Policy-Report-Only");
  const host = request.headers.get("host") ?? request.nextUrl.hostname;
  const scope = scopeForHost(host);
  const family = scope ? routeFamily(scope, request.nextUrl.pathname) : null;
  // The route family of the path being served, for the session lifetime on shared hosts. Always
  // overwritten here so a caller-supplied value never reaches the application.
  if (family) request.headers.set(ROUTE_FAMILY_HEADER, family);
  else request.headers.delete(ROUTE_FAMILY_HEADER);
  if (!family) {
    return secured(
      new NextResponse("Halaman tidak ditemukan", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } }),
      request,
      host,
    );
  }

  // Cookie-less scopes: whatever cookie a caller sends never reaches the route, and none is set. The apex
  // (public), the hooks and internal hosts, assets and /healthz have no session, so a stale or revoked
  // `gx_at` can never reach a Server Action posted to them (security review F-01).
  if (scope === "hooks" || scope === "internal" || scope === "public" || family === "asset" || family === "health") {
    const forwarded = new Headers(request.headers);
    forwarded.delete("cookie");
    return secured(NextResponse.next({ request: { headers: forwarded } }), request, host);
  }

  const cookieContext = sessionCookieContext(host, request.nextUrl.protocol === "https:", family);
  const ip = clientAddress(request.headers);
  let outcome;
  try {
    outcome = await resolveSession({
      method: request.method,
      accessToken: request.cookies.get(ACCESS_COOKIE)?.value,
      refreshToken: request.cookies.get(REFRESH_COOKIE)?.value,
      auth: getAuth(),
      allowRefresh: () => withinLimit("REFRESH_LIMITER", ip),
    });
  } catch {
    // A misconfigured auth module must not leak details; the operator sees the event.
    console.error(JSON.stringify({ event: "session_resolution_failed", route: "proxy" }));
    outcome = { kind: "refused" as const };
  }
  // A refused refresh (over the local budget, or the database cannot answer) never reached the refresh
  // call or was inconclusive. The request must NOT go on with its expired cookies: every later reader in
  // the page or action would find no session. The proxy answers 503 + Retry-After itself; the browser
  // keeps its cookies, so the session survives for a later attempt.
  if (outcome.kind === "refused") {
    return secured(
      new NextResponse("Layanan sedang sibuk. Coba lagi sebentar lagi.", {
        status: 503,
        headers: { "Retry-After": String(REFRESH_RETRY_AFTER_SECONDS), "Content-Type": "text/plain; charset=utf-8" },
      }),
      request,
      host,
    );
  }
  if (outcome.kind === "none") return secured(NextResponse.next({ request: { headers: request.headers } }), request, host);
  // The rotated or cleared cookies must be visible to this very request (page render, Server Action)
  // as well as the browser.
  if (outcome.kind === "set") {
    request.cookies.set(ACCESS_COOKIE, outcome.accessToken);
    if (outcome.refreshToken) request.cookies.set(REFRESH_COOKIE, outcome.refreshToken);
  } else {
    request.cookies.delete(ACCESS_COOKIE);
    request.cookies.delete(REFRESH_COOKIE);
  }
  const response = NextResponse.next({ request: { headers: request.headers } });
  if (outcome.kind === "set") {
    response.cookies.set(ACCESS_COOKIE, outcome.accessToken, sessionCookieOptions({}, cookieContext));
    if (outcome.refreshToken) response.cookies.set(REFRESH_COOKIE, outcome.refreshToken, sessionCookieOptions({}, cookieContext));
  } else {
    for (const name of [ACCESS_COOKIE, REFRESH_COOKIE]) response.cookies.set(name, "", sessionCookieOptions({ maxAge: 0 }, cookieContext));
  }
  return secured(response, request, host);
}

function secured(response: NextResponse, request: NextRequest, host: string): NextResponse {
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("X-Frame-Options", "DENY");
  const policy = buildCsp(request.headers.get("x-nonce")!, process.env.NODE_ENV === "development");
  response.headers.set("Content-Security-Policy", policy.enforced);
  response.headers.set("Content-Security-Policy-Report-Only", policy.reportOnly);
  response.headers.set("Permissions-Policy", policy.permissions);
  response.headers.set("X-Content-Type-Options", "nosniff");
  // Only the production apex may be indexed; app, owner, hooks, preview, staging and local hosts
  // are noindex (SUP-15, CTX-41 item 9).
  if (!isProductionHost(host)) response.headers.set("X-Robots-Tag", NOINDEX_HEADER);
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  if (request.nextUrl.protocol === "https:") {
    response.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|favicon.ico).*)"],
};
