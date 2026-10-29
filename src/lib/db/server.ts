import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { config } from "@/lib/config";
import { getAuth, anonClient, postgrestUrl, serviceClient } from "@/lib/auth/instance";
import { dataClient, type Db } from "./client";
import { ACCESS_COOKIE } from "./cookies";

// Request-scoped data client carrying the signed-in user's verified access token (TEN-1). Every read and
// write is subject to RLS and the RPC membership checks. A missing, forged, expired or REVOKED session
// means the anonymous role, which can call only `registration_open`: the token is verified locally and the
// session row is checked through `currentUser` (React-cached, so a request that already asked pays nothing
// more). The database itself trusts the JWT claims only, so this is what makes a logout, a password change or
// a ban take effect before the token's own expiry (ADR-0002 obligation 3, security review F-01). The proxy
// refreshes a token that is about to expire before the page renders, so nothing here refreshes anything.
export async function dbServer(): Promise<Db> {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (token && (await currentUser())) return dataClient(postgrestUrl(), token);
  return anonClient();
}

// DEC-010: the machine identity (service_role). It bypasses RLS, so it is used only for the
// service_role-only commands (dispatch_*, machine_seller_key, record_live_quotes, auth_*), and only after
// the caller's membership was checked with the user's own session. Never pass user input as a table
// filter here. Missing secrets => null (fail closed).
export async function machineClient(): Promise<Db | null> {
  if (!config("AUTH_JWT_SECRET") || !config("AUTH_SECRET") || !config("POSTGREST_URL")) return null;
  return serviceClient();
}

export type CurrentUser = {
  id: string;
  email: string | null;
  isAnonymous: boolean;
  hasPassword: boolean;
  aal: "aal1" | "aal2";
  sessionId: string;
};

// The equivalent of getUser(): the access token is verified locally AND the session is checked against
// the database, so a revoked or expired session is gone on the next request.
export const currentUser = cache(async (): Promise<CurrentUser | null> => {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) return null;
  const auth = getAuth();
  const verified = await auth.verifyAccessToken(token);
  if (!verified.ok || verified.claims.role !== "authenticated" || !verified.claims.session_id) return null;
  const live = await auth.sessionLive(verified.claims.session_id);
  if (!live.live || live.userId !== verified.claims.sub) return null;
  return { id: live.userId, email: live.email, isAnonymous: live.isAnonymous, hasPassword: live.hasPassword, aal: live.aal, sessionId: live.sessionId };
});
