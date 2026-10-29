"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAuth } from "@/lib/auth/instance";
import { currentUser, dbServer } from "@/lib/db/server";
import { writeSessionCookies } from "@/lib/db/session";
import { friendlyError } from "@/lib/errors";
import { loadPlatform, type Capability } from "@/lib/platform";
import { qrSvgDataUri } from "@/lib/qr";
import { withinAccountLimit, withinLimit } from "@/lib/rate-limit";
import { AUTH_BUSY, authThrottleMessage, authUnavailable } from "@/lib/auth-errors";
import { requestScope } from "@/lib/hosts";

export type EnrollState = { error?: string; factorId?: string; qr?: string; secret?: string };
export type FormState = { error?: string; ok?: string };

// IAM-7: only an active grant holder without a verified factor may enrol. Enrolling replaces any stale
// unverified factor of this user in the database, so abandoned attempts cannot pile up. The secret
// is shown once (QR code drawn on the server plus the text for manual entry); only its sealed form is stored.
export async function startTotpEnrollAction(): Promise<EnrollState> {
  let enrolled;
  try {
    const session = await loadPlatform();
    if (!session) return { error: "Akun ini tidak memiliki akses Super Admin." };
    if (session.hasTotp) redirect("/verifikasi-2fa");
    // The authenticator label is the account's address; a Super Admin always has one.
    if (!session.email) return { error: "Pendaftaran autentikator belum bisa dimulai. Coba lagi." };
    enrolled = await getAuth().enrollTotp({ userId: session.userId, email: session.email });
  } catch (error) {
    if (authUnavailable(error, "/verifikasi-2fa")) return { error: AUTH_BUSY };
    throw error;
  }
  if (!enrolled.ok) {
    if (enrolled.reason === "already_verified") redirect("/verifikasi-2fa");
    return { error: "Pendaftaran autentikator belum bisa dimulai. Coba lagi." };
  }
  return { factorId: enrolled.factorId, qr: qrSvgDataUri(enrolled.otpauthUri), secret: enrolled.secret };
}

export async function verifyTotpAction(prev: EnrollState, form: FormData): Promise<EnrollState> {
  const code = String(form.get("code") ?? "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(code)) return { ...prev, error: "Masukkan 6 digit kode dari aplikasi autentikator." };
  if (!(await withinLimit("MFA_LIMITER"))) return { ...prev, error: authThrottleMessage("/verifikasi-2fa") };
  let result;
  try {
    const session = await loadPlatform();
    if (!session) return { error: "Akun ini tidak memiliki akses Super Admin." };
    if (!(await withinAccountLimit("MFA_ACCOUNT_LIMITER", session.userId))) {
      return { ...prev, error: authThrottleMessage("/verifikasi-2fa") };
    }
    const user = await currentUser();
    if (!user) return { error: "Akun ini tidak memiliki akses Super Admin." };
    // The user and session come from the server-verified session. The factor is the user's verified
    // one when it exists, otherwise the one this browser just enrolled (the database accepts it only
    // if it belongs to this user).
    result = await getAuth().verifyTotp({ userId: user.id, sessionId: user.sessionId, code, factorId: prev.factorId });
  } catch (error) {
    if (authUnavailable(error, "/verifikasi-2fa")) return { ...prev, error: AUTH_BUSY };
    throw error;
  }
  if (!result.ok) {
    if (result.reason === "no_factor") return { error: "Mulai ulang pendaftaran autentikator." };
    return { ...prev, error: "Kode tidak cocok atau sudah kedaluwarsa. Coba kode terbaru." };
  }
  // The aal2 session carries a NEW refresh token: both cookies are replaced.
  await writeSessionCookies(result.session);
  redirect("/admin");
}

export async function setTenantLifecycleAction(_: FormState, form: FormData): Promise<FormState> {
  const scope = await requestScope();
  if (scope !== "platform" && scope !== "shared") return { error: "Tidak ditemukan." };
  const db = await dbServer();
  const { error } = await db.rpc("platform_set_tenant_lifecycle", {
    p_tenant: String(form.get("tenant_id")),
    p_expected: String(form.get("expected")),
    p_lifecycle: String(form.get("lifecycle")),
    p_reason: String(form.get("reason") ?? ""),
  });
  if (error) return { error: friendlyError(error) };
  revalidatePath("/admin");
  return { ok: form.get("lifecycle") === "suspended" ? "Gerai dibekukan." : "Gerai diaktifkan kembali." };
}

export async function setGrantAction(_: FormState, form: FormData): Promise<FormState> {
  const scope = await requestScope();
  if (scope !== "platform" && scope !== "shared") return { error: "Tidak ditemukan." };
  const capabilities = form.getAll("capabilities").map(String) as Capability[];
  if (capabilities.length === 0) return { error: "Pilih minimal satu kemampuan." };
  const db = await dbServer();
  const { error } = await db.rpc("platform_set_grant", {
    p_email: String(form.get("email") ?? ""),
    p_capabilities: capabilities,
    p_reason: String(form.get("reason") ?? ""),
  });
  if (error) return { error: friendlyError(error) };
  revalidatePath("/admin/akses");
  return { ok: "Akses Super Admin disimpan." };
}

export async function revokeGrantAction(_: FormState, form: FormData): Promise<FormState> {
  const scope = await requestScope();
  if (scope !== "platform" && scope !== "shared") return { error: "Tidak ditemukan." };
  const db = await dbServer();
  const { error } = await db.rpc("platform_revoke_grant", {
    p_user: String(form.get("user_id")),
    p_expected_revision: Number(form.get("revision")),
    p_reason: String(form.get("reason") ?? ""),
  });
  if (error) return { error: friendlyError(error) };
  revalidatePath("/admin/akses");
  return { ok: "Akses Super Admin dicabut." };
}
