import "server-only";
import { cookies, headers } from "next/headers";
import type { SessionTokens } from "@/lib/auth/service";
import { ACCESS_COOKIE, REFRESH_COOKIE, ROUTE_FAMILY_HEADER, sessionCookieContext, sessionCookieOptions } from "./cookies";

// Writes the session cookies from a Server Action (ADR-0002 section 3.3). Server components never call
// this. A `recent_reuse` answer carries no refresh token: the refresh cookie is then left alone.
export async function writeSessionCookies(session: SessionTokens): Promise<void> {
  const [store, requestHeaders] = await Promise.all([cookies(), headers()]);
  const context = sessionCookieContext(requestHeaders.get("host"), false, requestHeaders.get(ROUTE_FAMILY_HEADER));
  store.set(ACCESS_COOKIE, session.accessToken, sessionCookieOptions({}, context));
  if (session.refreshToken) store.set(REFRESH_COOKIE, session.refreshToken, sessionCookieOptions({}, context));
}

export async function clearSessionCookies(): Promise<void> {
  const [store, requestHeaders] = await Promise.all([cookies(), headers()]);
  const context = sessionCookieContext(requestHeaders.get("host"), false, requestHeaders.get(ROUTE_FAMILY_HEADER));
  for (const name of [ACCESS_COOKIE, REFRESH_COOKIE]) store.set(name, "", sessionCookieOptions({ maxAge: 0 }, context));
}

// The audience for a new session's lifetime. It is decided exactly like the cookie bound
// (sessionCookieContext): the Super Admin host, or the platform route family on a shared host. A
// sign-in on the owner host (the /masuk page belongs to the sign-in family there) is therefore
// a platform session, 12 hours in the database too, not only in the cookie.
export async function sessionAudience(): Promise<"tenant" | "platform"> {
  const requestHeaders = await headers();
  return sessionCookieContext(requestHeaders.get("host"), false, requestHeaders.get(ROUTE_FAMILY_HEADER)).platform ? "platform" : "tenant";
}
