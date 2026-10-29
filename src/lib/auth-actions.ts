"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth, postgrestUrl } from "@/lib/auth/instance";
import { dataClient, type Db } from "@/lib/db/client";
import { ACCESS_COOKIE, TENANT_SELECTOR_COOKIE_OPTIONS as TENANT_COOKIE_OPTIONS } from "@/lib/db/cookies";
import { currentUser, dbServer } from "@/lib/db/server";
import { clearSessionCookies, sessionAudience, writeSessionCookies } from "@/lib/db/session";
import { TENANT_COOKIE } from "@/lib/workspace";
import { friendlyError } from "@/lib/errors";
import { withinAccountLimit, withinAccountVisitorLimit, withinLimit } from "@/lib/rate-limit";
import { AUTH_BUSY, authThrottleMessage, authUnavailable } from "@/lib/auth-errors";
import { requestContext } from "@/lib/request-context";

const CAPTCHA_FAILED = "Verifikasi keamanan gagal atau kedaluwarsa. Coba lagi.";

export type SignInState = { error?: string; email?: string };

export async function signInAction(_: SignInState, form: FormData): Promise<SignInState> {
  const email = String(form.get("email") ?? "").trim();
  const password = String(form.get("password") ?? "");
  if (!email || !password) return { error: "Isi email dan kata sandi.", email };
  // Before the auth service: the visitor budget and this visitor's own budget for this account. Neither
  // can be burned by a stranger to keep the real owner out (see withinAccountVisitorLimit).
  if (!(await withinLimit("SIGN_IN_LIMITER")) || !(await withinAccountVisitorLimit("SIGN_IN_ACCOUNT_LIMITER", email))) {
    return { error: authThrottleMessage("/masuk"), email };
  }
  const auth = getAuth();
  const captchaToken = String(form.get("cf-turnstile-response") ?? "");
  let result;
  try {
    result = await auth.signInWithPassword({ email, password, captchaToken, ...(await requestContext()), audience: await sessionAudience() });
  } catch (error) {
    if (authUnavailable(error, "/masuk")) return { error: AUTH_BUSY, email };
    throw error;
  }
  // A failed security check is not about the account; every other failure gets one message so
  // the form does not reveal which emails exist.
  if (!result.ok && result.reason === "captcha_failed") return { error: CAPTCHA_FAILED, email };
  // The service checks the CAPTCHA first, so reaching here means a challenge was solved. Only now is the
  // account-wide guessing budget spent, so exhausting it costs a solved challenge per attempt
  // (M1) while a guesser spread across many visitors is still bounded: once it is empty even a
  // correct password is revoked again, no cookie is set, and the reply is like any other throttle.
  if (!(await withinAccountLimit("SIGN_IN_ACCOUNT_LIMITER", email))) {
    if (result.ok) await revokeQuietly(result.session.sessionId, "/masuk");
    return { error: authThrottleMessage("/masuk"), email };
  }
  if (!result.ok) return { error: "Email atau kata sandi tidak cocok.", email };
  await writeSessionCookies(result.session);
  (await cookies()).delete(TENANT_COOKIE);
  redirect("/");
}

// Ends a session the caller must not keep. A store failure here is logged and answered as the throttle
// the caller already returns: the session was never handed to the browser, so it is unusable anyway.
async function revokeQuietly(sessionId: string, route: "/masuk" | "/daftar") {
  try {
    await getAuth().revokeSession(sessionId);
  } catch (error) {
    if (!authUnavailable(error, route)) throw error;
  }
}

export type DemoState = { error?: string };

// PR-21 / IAM-4: each visitor gets an anonymous session and an isolated, seeded demo tenant.
export async function startDemoAction(_: DemoState, form: FormData): Promise<DemoState> {
  if (!(await withinLimit("DEMO_LIMITER"))) return { error: authThrottleMessage("/masuk") };
  try {
    const user = await currentUser();
    // Never silently end a real account's session to start a demo.
    if (user && !user.isAnonymous) {
      return { error: "Anda sedang masuk dengan akun gerai. Keluar dulu untuk mencoba demo." };
    }
    // A session minted here is not readable from the cookie jar inside this request, so its own
    // access token carries the start_demo call.
    let db: Db;
    if (user) {
      db = await dbServer();
    } else {
      const captchaToken = String(form.get("cf-turnstile-response") ?? "");
      const result = await getAuth().signInAnonymous({ captchaToken, ...(await requestContext()) });
      if (!result.ok) return { error: result.reason === "captcha_failed" ? CAPTCHA_FAILED : "Demo belum bisa dibuka. Coba lagi sebentar lagi." };
      await writeSessionCookies(result.session);
      db = dataClient(postgrestUrl(), result.session.accessToken);
    }
    const { data: tenant, error } = await db.rpc("start_demo");
    if (error) return { error: friendlyError(error) };
    (await cookies()).set(TENANT_COOKIE, tenant as string, TENANT_COOKIE_OPTIONS);
  } catch (error) {
    if (authUnavailable(error, "/masuk")) return { error: AUTH_BUSY };
    throw error;
  }
  redirect("/");
}

export async function resetDemoAction() {
  const db = await dbServer();
  await db.rpc("reset_demo");
  redirect("/pengiriman?reset=1");
}

// The session is revoked server-side, so a copied cookie stops working at once. The access cookie is read
// with `allowExpired`: signing out must work however stale the token is (its signature still has to
// verify, so nobody can end another session). The cookies are cleared even if the store is unreachable.
export async function signOutAction() {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (token) {
    const auth = getAuth();
    const verified = await auth.verifyAccessToken(token, { allowExpired: true });
    if (verified.ok && verified.claims.role === "authenticated" && verified.claims.session_id) {
      try {
        await auth.revokeSession(verified.claims.session_id);
      } catch (error) {
        if (!authUnavailable(error, "/masuk")) throw error;
      }
    }
  }
  await clearSessionCookies();
  (await cookies()).delete(TENANT_COOKIE);
  redirect("/masuk");
}

export async function chooseTenantAction(form: FormData) {
  const tenant = String(form.get("tenant") ?? "");
  let db: Db;
  let user;
  try {
    db = await dbServer();
    // Validate the selector against the caller's own memberships before storing it.
    user = await currentUser();
  } catch (error) {
    if (authUnavailable(error, "/masuk")) redirect("/pilih-gerai?galat=1");
    throw error;
  }
  const { data } = await db.from("memberships").select("tenant_id")
    .eq("tenant_id", tenant).eq("user_id", user?.id ?? "").eq("status", "active");
  if (!data?.length) redirect("/pilih-gerai?galat=1");
  (await cookies()).set(TENANT_COOKIE, tenant, TENANT_COOKIE_OPTIONS);
  redirect("/");
}
