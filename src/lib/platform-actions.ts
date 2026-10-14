"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { friendlyError } from "@/lib/errors";
import { loadPlatform, type Capability } from "@/lib/platform";
import { withinLimit } from "@/lib/rate-limit";
import { supabaseServer } from "@/lib/supabase/server";

const TOO_MANY = "Terlalu banyak percobaan dari jaringan ini. Tunggu satu menit lalu coba lagi.";

export type EnrollState = { error?: string; factorId?: string; qr?: string; secret?: string };
export type FormState = { error?: string; ok?: string };

// IAM-7: only an active grant holder without a verified factor may enrol. Stale unverified
// factors from abandoned attempts are removed first so they cannot pile up.
export async function startTotpEnrollAction(): Promise<EnrollState> {
  const session = await loadPlatform();
  if (!session) return { error: "Akun ini tidak memiliki akses Super Admin." };
  if (session.hasTotp) redirect("/verifikasi-2fa");
  const supabase = await supabaseServer();
  const { data: factors } = await supabase.auth.mfa.listFactors();
  for (const f of factors?.all ?? []) {
    if (f.status !== "verified") await supabase.auth.mfa.unenroll({ factorId: f.id });
  }
  const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: "GeraiExpress" });
  if (error || !data) return { error: "Pendaftaran autentikator belum bisa dimulai. Coba lagi." };
  return { factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret };
}

export async function verifyTotpAction(prev: EnrollState, form: FormData): Promise<EnrollState> {
  const code = String(form.get("code") ?? "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(code)) return { ...prev, error: "Masukkan 6 digit kode dari aplikasi autentikator." };
  if (!(await withinLimit("MFA_LIMITER"))) return { ...prev, error: TOO_MANY };
  const session = await loadPlatform();
  if (!session) return { error: "Akun ini tidak memiliki akses Super Admin." };
  const supabase = await supabaseServer();
  // The factor comes from the server: the verified factor when one exists, otherwise the one
  // this browser just enrolled (it must belong to the signed-in user, which Auth enforces).
  const { data: factors } = await supabase.auth.mfa.listFactors();
  const factorId = factors?.totp.find((f) => f.status === "verified")?.id
    ?? factors?.all.find((f) => f.id === prev.factorId && f.status === "unverified")?.id;
  if (!factorId) return { error: "Mulai ulang pendaftaran autentikator." };
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
  if (error) return { ...prev, error: "Kode tidak cocok atau sudah kedaluwarsa. Coba kode terbaru." };
  redirect("/admin");
}

export async function setTenantLifecycleAction(_: FormState, form: FormData): Promise<FormState> {
  const supabase = await supabaseServer();
  const { error } = await supabase.rpc("platform_set_tenant_lifecycle", {
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
  const capabilities = form.getAll("capabilities").map(String) as Capability[];
  if (capabilities.length === 0) return { error: "Pilih minimal satu kemampuan." };
  const supabase = await supabaseServer();
  const { error } = await supabase.rpc("platform_set_grant", {
    p_email: String(form.get("email") ?? ""),
    p_capabilities: capabilities,
    p_reason: String(form.get("reason") ?? ""),
  });
  if (error) return { error: friendlyError(error) };
  revalidatePath("/admin/akses");
  return { ok: "Akses Super Admin disimpan." };
}

export async function revokeGrantAction(_: FormState, form: FormData): Promise<FormState> {
  const supabase = await supabaseServer();
  const { error } = await supabase.rpc("platform_revoke_grant", {
    p_user: String(form.get("user_id")),
    p_expected_revision: Number(form.get("revision")),
    p_reason: String(form.get("reason") ?? ""),
  });
  if (error) return { error: friendlyError(error) };
  revalidatePath("/admin/akses");
  return { ok: "Akses Super Admin dicabut." };
}
