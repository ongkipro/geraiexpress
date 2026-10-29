import { AuthUnavailableError } from "../auth/store";
import type { Auth, SessionTokens } from "../auth/service";

// ADR-0002 section 3.3: what the proxy does with the session cookies of one request. Pure decision logic
// (no cookies, no headers), so it is unit-testable; src/proxy.ts applies the outcome.
//
// - A valid access token that does not expire within 60 seconds needs nothing on GET/HEAD (the page
//   loaders still check the session against the database through `currentUser`). On every other method
//   the session row is checked here as well, so a revoked session never reaches a Server Action.
// - An absent, forged, expired or soon-to-expire access token with a refresh token triggers one
//   rotation, budgeted by REFRESH_LIMITER. A locally refused refresh answers `refused` (503 +
//   Retry-After) and NEVER clears the cookies, so the session survives for a later attempt.
// - Any definitive failure (invalid, reuse detected, revoked) clears both cookies.
export const REFRESH_WINDOW_SECONDS = 60;

export type SessionOutcome =
  | { kind: "none" }
  | { kind: "set"; accessToken: string; refreshToken: string | null }
  | { kind: "clear" }
  | { kind: "refused" };

export type SessionInput = {
  method: string;
  accessToken: string | undefined;
  refreshToken: string | undefined;
  auth: Pick<Auth, "verifyAccessToken" | "refresh" | "sessionLive">;
  /** Spends one REFRESH_LIMITER unit; false means the visitor is over budget. */
  allowRefresh: () => Promise<boolean>;
  /** Epoch seconds. */
  now?: number;
};

const toSet = (session: SessionTokens): SessionOutcome => ({ kind: "set", accessToken: session.accessToken, refreshToken: session.refreshToken });

export async function resolveSession(input: SessionInput): Promise<SessionOutcome> {
  const { auth, accessToken, refreshToken } = input;
  const now = input.now ?? Math.floor(Date.now() / 1000);
  if (!accessToken && !refreshToken) return { kind: "none" };
  try {
    const verified = accessToken ? await auth.verifyAccessToken(accessToken) : null;
    const claims = verified?.ok && verified.claims.role === "authenticated" && verified.claims.session_id ? verified.claims : null;
    if (claims && claims.exp - now > REFRESH_WINDOW_SECONDS) {
      if (input.method === "GET" || input.method === "HEAD") return { kind: "none" };
      const live = await auth.sessionLive(claims.session_id!);
      return live.live && live.userId === claims.sub ? { kind: "none" } : { kind: "clear" };
    }
    if (!refreshToken) return { kind: "clear" };
    if (!(await input.allowRefresh())) return { kind: "refused" };
    const refreshed = await auth.refresh(refreshToken);
    return refreshed.ok ? toSet(refreshed.session) : { kind: "clear" };
  } catch (error) {
    // The database could not answer: neither a refusal of the session nor proof of it. Keep the cookies.
    if (error instanceof AuthUnavailableError) return { kind: "refused" };
    throw error;
  }
}
