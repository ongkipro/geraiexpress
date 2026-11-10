"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { assertSecret, hkdf, hmacSha256Hex, randomToken, safeEqual } from "@/lib/auth/crypto";
import { config } from "@/lib/config";
import { requestScope } from "@/lib/hosts";
import { getAuth } from "@/lib/auth/instance";
import { currentUser, dbServer } from "@/lib/db/server";
import { sessionAudience, writeSessionCookies } from "@/lib/db/session";
import { friendlyError } from "@/lib/errors";
import { withinAccountLimit, withinAccountVisitorLimit, withinLimit } from "@/lib/rate-limit";
import { AUTH_BUSY, authThrottleMessage, authUnavailable } from "@/lib/auth-errors";
import { renderCodeMail } from "@/lib/auth-mail";
import { deliver, mailTransportReady } from "@/lib/mail-transport";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "@/lib/auth";
import { requestContext } from "@/lib/request-context";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CAPTCHA_FAILED = "Verifikasi keamanan gagal atau kedaluwarsa. Coba lagi.";
const INVALID_CODE = "Kode tidak cocok atau sudah kedaluwarsa. Minta kode baru bila perlu.";
const VERIFY_COOKIE = "gx_verify_state";
const VERIFY_TTL = 600;
const verifyCookieOptions = () => ({ httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/daftar", maxAge: VERIFY_TTL });
const verifyKey = () => hkdf(assertSecret("AUTH_SECRET", config("AUTH_SECRET")), "gx:verify-state:v1");

async function issueVerifyState(email: string) {
  const iat = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({ email, iat, exp: iat + VERIFY_TTL, nonce: randomToken() })).toString("base64url");
  (await cookies()).set(VERIFY_COOKIE, `${payload}.${hmacSha256Hex(verifyKey(), payload)}`, verifyCookieOptions());
}

async function verifyStateEmail(): Promise<string | null> {
  const value = (await cookies()).get(VERIFY_COOKIE)?.value;
  if (!value || value.length > 1024) return null;
  const [payload, signature, extra] = value.split(".");
  if (!payload || !signature || extra || !/^[a-f0-9]{64}$/.test(signature) || !safeEqual(hmacSha256Hex(verifyKey(), payload), signature)) return null;
  try {
    const state = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    const now = Math.floor(Date.now() / 1000);
    return typeof state.email === "string" && EMAIL.test(state.email) && state.email.length <= 254 &&
      Number.isInteger(state.iat) && Number.isInteger(state.exp) && state.iat <= now && state.exp === state.iat + VERIFY_TTL && state.exp > now &&
      typeof state.nonce === "string" && /^[A-Za-z0-9_-]{43}$/.test(state.nonce) ? state.email : null;
  } catch { return null; }
}

export async function changeEmailAction(): Promise<CodeState> {
  (await cookies()).set(VERIFY_COOKIE, "", { ...verifyCookieOptions(), maxAge: 0 });
  return { step: "email" };
}

export type CodeState = { step?: "email" | "code"; email?: string; error?: string; notice?: string };

// PR-29 / DEC-007: email first. The reply never reveals whether the address already has an
// account or whether creation was refused; returning users simply sign in with the code.
export async function requestCodeAction(_: CodeState, form: FormData): Promise<CodeState> {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  if (!EMAIL.test(email) || email.length > 254) return { step: "email", email, error: "Masukkan alamat email yang valid." };
  const notice = { step: "code" as const, email, notice: `Jika alamat ${email} bisa dipakai, kode 6 digit sudah dikirim ke sana.` };
  // Readiness is deployment-wide, never address-dependent. No code is issued without a transport.
  if (!mailTransportReady()) {
    await issueVerifyState(email);
    return { step: "email", email, error: "Pengiriman kode sedang bermasalah. Tunggu beberapa saat lalu coba lagi." };
  }
  // M1: pre-CAPTCHA budgets are visitor-only; refusals have the same reply AND cookie as a sent code.
  if (!(await withinLimit("OTP_LIMITER")) || !(await withinAccountVisitorLimit("OTP_ACCOUNT_LIMITER", email))) {
    await issueVerifyState(email);
    return notice;
  }
  const captchaToken = String(form.get("cf-turnstile-response") ?? "");
  let code: { email: string; code: string } | null = null;
  try {
    // The requester lets SQL refuse an anonymous demo identity: it can never cause mail.
    const requester = await currentUser();
    const result = await getAuth().requestEmailCode({ email, captchaToken, ...(await requestContext()), requesterId: requester?.id });
    // A failed security check says nothing about the address, so be truthful about it. Every other
    // refusal (closed registration, throttle, send frequency, anonymous requester) is answered with
    // the same generic reply: no account enumeration.
    if (result.status === "captcha_failed") return { step: "email", email, error: CAPTCHA_FAILED };
    if (result.status === "sent") code = result;
  } catch (error) {
    // A store outage says nothing about the address either.
    if (authUnavailable(error, "/daftar")) {
      await issueVerifyState(email);
      return notice;
    }
    throw error;
  }
  await issueVerifyState(email);
  if (code) {
    // Self-hosted Node keeps delivery outside the response path. Never log recipient or provider error.
    void deliver([renderCodeMail(code.email, code.code)]).catch(() => {
      console.error(JSON.stringify({ event: "auth_mail_failed" }));
    });
  }
  return notice;
}

export async function verifyCodeAction(_: CodeState, form: FormData): Promise<CodeState> {
  const email = await verifyStateEmail();
  if (!email) return { step: "code", error: INVALID_CODE };
  const prev: CodeState = { step: "code", email };
  const token = String(form.get("code") ?? "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(token)) return { ...prev, notice: undefined, error: "Masukkan 6 digit kode dari email." };
  if (!(await withinLimit("SIGN_IN_LIMITER")) || !(await withinAccountVisitorLimit("OTP_ACCOUNT_LIMITER", email))) {
    return { ...prev, notice: undefined, error: authThrottleMessage("/daftar") };
  }
  const auth = getAuth();
  const captchaToken = String(form.get("cf-turnstile-response") ?? "");
  let result;
  try {
    result = await auth.verifyEmailCode({ email, code: token, captchaToken, ...(await requestContext()), audience: await sessionAudience() });
  } catch (error) {
    if (authUnavailable(error, "/daftar")) return { ...prev, notice: undefined, error: AUTH_BUSY };
    throw error;
  }
  if (!result.ok && result.reason === "captcha_failed") return { ...prev, notice: undefined, error: CAPTCHA_FAILED };
  // The service checks the CAPTCHA first, so reaching here means a challenge was solved. Only now is the
  // address-wide guessing budget (a 6-digit code) spent, per solved attempt, success included, and it
  // cannot be peeked: past the budget even a correct code is revoked again and no cookie is set.
  // Residual trade-off: a stranger who solves a challenge per attempt can still exhaust this budget for
  // the code step of an address; password sign-in uses a separate budget and is unaffected.
  if (!(await withinAccountLimit("OTP_ACCOUNT_LIMITER", email))) {
    if (result.ok) {
      try {
        await auth.revokeSession(result.session.sessionId);
      } catch (error) {
        if (!authUnavailable(error, "/daftar")) throw error;
      }
    }
    return { ...prev, notice: undefined, error: authThrottleMessage("/daftar") };
  }
  if (!result.ok) return { ...prev, error: INVALID_CODE };
  await changeEmailAction();
  await writeSessionCookies(result.session);
  redirect("/");
}

export type FormState = { error?: string; ok?: string; fieldErrors?: Record<string, string>; values?: Record<string, string> };

// Only an identity that proved inbox control and has no password yet sets one here; changing an
// existing password belongs to account recovery, not this step.
export async function setPasswordAction(_: FormState, form: FormData): Promise<FormState> {
  const password = String(form.get("password") ?? "");
  const confirm = String(form.get("confirm") ?? "");
  if (password.length < MIN_PASSWORD_LENGTH) return { fieldErrors: { password: `Minimal ${MIN_PASSWORD_LENGTH} karakter.` } };
  if (password.length > MAX_PASSWORD_LENGTH) return { fieldErrors: { password: `Maksimal ${MAX_PASSWORD_LENGTH} karakter.` } };
  if (password !== confirm) return { fieldErrors: { confirm: "Kata sandi tidak sama." } };
  let db;
  let account: { has_password: boolean; registration_open: boolean } | undefined;
  let result;
  try {
    const user = await currentUser();
    if (!user) redirect("/masuk");
    db = await dbServer();
    const { data: state } = await db.rpc("my_account_state");
    account = (state as { has_password: boolean; registration_open: boolean }[] | null)?.[0];
    if (!account) redirect("/masuk");
    if (account.has_password) redirect("/");
    result = await getAuth().setPassword({ userId: user.id, sessionId: user.sessionId, password, initialOnly: true });
  } catch (error) {
    if (authUnavailable(error, "/daftar")) return { error: "Kata sandi belum bisa disimpan. Coba lagi." };
    throw error;
  }
  if (!result.ok) return { error: result.reason === "weak_password" ? "Kata sandi terlalu lemah. Pakai kombinasi yang lebih panjang." : "Kata sandi belum bisa disimpan. Coba lagi." };
  // Invited staff go to their invitation; a new registrant continues to the application.
  const { data: invites } = await db.rpc("my_invitations");
  redirect((invites ?? []).length > 0 ? "/undangan" : account.registration_open ? "/daftar/gerai" : "/");
}

const FIELDS = ["business_name", "outlet_name", "pickup_address", "pickup_area", "contact_phone"] as const;
const PHONE = /^\+?[0-9]{8,15}$/;

function readApplication(form: FormData) {
  const values = Object.fromEntries(FIELDS.map((f) => [f, String(form.get(f) ?? "").trim()])) as Record<(typeof FIELDS)[number], string>;
  const fieldErrors: Record<string, string> = {};
  if (values.contact_phone && !PHONE.test(values.contact_phone)) fieldErrors.contact_phone = "Nomor HP 8–15 digit, contoh 081234567890.";
  if (values.business_name && values.business_name.length < 2) fieldErrors.business_name = "Minimal 2 karakter.";
  if (values.outlet_name && values.outlet_name.length < 2) fieldErrors.outlet_name = "Minimal 2 karakter.";
  if (values.pickup_address && values.pickup_address.length < 5) fieldErrors.pickup_address = "Tulis alamat lengkap.";
  if (values.pickup_area && values.pickup_area.length < 3) fieldErrors.pickup_area = "Tulis kecamatan dan kota.";
  return { values, fieldErrors };
}

// PR-30: save (partial drafts allowed) and optionally submit in the same request.
export async function saveApplicationAction(_: FormState, form: FormData): Promise<FormState> {
  const { values, fieldErrors } = readApplication(form);
  const submit = form.get("intent") === "submit";
  if (submit) for (const f of FIELDS) if (!values[f]) fieldErrors[f] ??= "Wajib diisi untuk mengajukan.";
  if (Object.keys(fieldErrors).length) return { fieldErrors, values };
  const db = await dbServer();
  const expected = Number(form.get("revision") ?? 0);
  const { data, error } = await db.rpc("save_application", {
    p_expected_revision: expected,
    p_business_name: values.business_name, p_outlet_name: values.outlet_name,
    p_pickup_address: values.pickup_address, p_pickup_area: values.pickup_area,
    p_contact_phone: values.contact_phone,
  });
  if (error) return { error: friendlyError(error), values };
  const saved = (data as { id: string; revision: number }[])[0];
  if (submit) {
    const { error: e2 } = await db.rpc("submit_application", { p_id: saved.id, p_expected_revision: saved.revision });
    if (e2) return { error: friendlyError(e2), values };
  }
  revalidatePath("/daftar/gerai");
  return { ok: submit ? "Pengajuan terkirim. Kami akan meninjau data gerai Anda." : "Draf tersimpan." };
}

export async function withdrawApplicationAction(_: FormState, form: FormData): Promise<FormState> {
  const db = await dbServer();
  const { error } = await db.rpc("withdraw_application", {
    p_id: String(form.get("id")), p_expected_revision: Number(form.get("revision")),
  });
  if (error) return { error: friendlyError(error) };
  revalidatePath("/daftar/gerai");
  return { ok: "Pengajuan dibatalkan." };
}

// Super Admin review (PR-15/PR-30) and the public-registration switch (PR-33 gate).
export async function reviewApplicationAction(_: FormState, form: FormData): Promise<FormState> {
  const scope = await requestScope();
  if (scope !== "platform" && scope !== "shared") return { error: "Tidak ditemukan." };
  const decision = String(form.get("decision"));
  const db = await dbServer();
  const { error } = await db.rpc("platform_review_application", {
    p_id: String(form.get("id")), p_expected_revision: Number(form.get("revision")),
    p_decision: decision, p_reason: String(form.get("reason") ?? ""),
  });
  if (error) return { error: friendlyError(error) };
  // The decided application leaves the "submitted" list, so confirm on the list it moved to.
  const status = decision === "approve" ? "approved" : decision === "reject" ? "rejected" : "changes_requested";
  redirect(`/admin/pengajuan?status=${status}&keputusan=${decision}`);
}

export async function setRegistrationAction(_: FormState, form: FormData): Promise<FormState> {
  const scope = await requestScope();
  if (scope !== "platform" && scope !== "shared") return { error: "Tidak ditemukan." };
  const open = form.get("open") === "true";
  const db = await dbServer();
  const { error } = await db.rpc("platform_set_registration", { p_open: open, p_reason: String(form.get("reason") ?? "") });
  if (error) return { error: friendlyError(error) };
  revalidatePath("/admin");
  return { ok: open ? "Pendaftaran publik dibuka." : "Pendaftaran publik ditutup." };
}
