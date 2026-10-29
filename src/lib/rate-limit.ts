import "server-only";
import { headers } from "next/headers";
import { allowUnlimited, visitorKey } from "@/lib/visitor-key";
import { authThrottleMessage } from "@/lib/auth-errors";
import { clientAddress } from "@/lib/client-address";
import { limiterFor } from "@/lib/limiter";

// RATE-2: visitor and target-account budgets are independent. The counters are in-process fixed windows
// (src/lib/limiter.ts): exact for one app instance, not a shared budget across instances. Limits live in
// limiter.ts (visitor: 10/60 s sign-in and MFA, 5 demo, 3 OTP; account+visitor: 5/60 s;
// account and MFA targets and refresh: 10/60 s). The visitor address comes only from the trusted proxy header (src/lib/client-address.ts);
// without TRUSTED_PROXY there is no address and production refuses, as it always did for a missing one.
export type LimitedAction = "SIGN_IN_LIMITER" | "DEMO_LIMITER" | "MFA_LIMITER" | "OTP_LIMITER" | "REFRESH_LIMITER";
type AccountAction = "SIGN_IN_ACCOUNT_LIMITER" | "OTP_ACCOUNT_LIMITER" | "MFA_ACCOUNT_LIMITER";

// Retry-After of the proxy's 503 when a session refresh is refused locally (src/proxy.ts). A local refusal
// is a retryable 503, never a final answer: the cookies stay, so the next request after the window
// refreshes normally. Only an actual refresh spends the REFRESH_LIMITER budget, not a page read or a
// locally verified token.
export const REFRESH_RETRY_AFTER_SECONDS = 60;

export async function withinLimit(action: LimitedAction, ip?: string | null): Promise<boolean> {
  const allowed = await checkLimit(action, visitorKey(ip === undefined ? clientAddress(await headers()) : ip));
  if (!allowed && action === "REFRESH_LIMITER") authThrottleMessage("/refresh", 503);
  return allowed;
}

export async function accountKey(email: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(email.trim().toLowerCase()));
  return `acct:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

// Account budgets, two shapes (RATE-2, security review M1). The account budget is a pure counter
// with no way to peek, so WHEN it is spent decides who can burn it:
//
// - withinAccountVisitorLimit keys account + visitor network. Spend it BEFORE the auth call:
//   it stops one visitor hammering one account, and a stranger can only exhaust their own pair,
//   never the budget the real owner signs in with from elsewhere.
// - withinAccountLimit keys the account alone. Spend it only AFTER the auth service accepted the
//   CAPTCHA step (or for MFA, whose target is the server-verified session user), so burning it costs
//   a solved challenge per attempt. It keeps the many-visitor guessing bound.
//   Trade-off: the caller cannot peek, so guess number 11+ still reaches the auth service; its result
//   is discarded (a success is revoked again), so a correct guess past the budget gains nothing.
export async function withinAccountVisitorLimit(action: AccountAction, email: string, ip?: string | null): Promise<boolean> {
  const visitor = visitorKey(ip === undefined ? clientAddress(await headers()) : ip);
  const account = email.trim() ? await accountKey(email) : null;
  const pairAction = action === "SIGN_IN_ACCOUNT_LIMITER" ? "SIGN_IN_ACCOUNT_VISITOR_LIMITER" : action === "OTP_ACCOUNT_LIMITER" ? "OTP_ACCOUNT_VISITOR_LIMITER" : action;
  return checkLimit(pairAction, account && visitor ? `${account}|${visitor}` : null);
}

// MFA's target must come from the server-verified platform session, never the submitted form.
export async function withinAccountLimit(action: AccountAction, target: string): Promise<boolean> {
  const key = !target.trim() ? null : action === "MFA_ACCOUNT_LIMITER" ? `mfa:${target}` : await accountKey(target);
  return checkLimit(action, key);
}

async function checkLimit(action: Parameters<typeof limiterFor>[0], key: string | null): Promise<boolean> {
  if (!key) return allowUnlimited(process.env.NODE_ENV);
  try {
    return (await limiterFor(action).limit({ key })).success;
  } catch {
    console.error(JSON.stringify({ event: "auth_limiter_failed", limiter: action }));
    return false;
  }
}
