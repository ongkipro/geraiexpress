"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { friendlyError } from "@/lib/errors";
import { withinLimit } from "@/lib/rate-limit";
import { supabaseServer } from "@/lib/supabase/server";

const TOO_MANY = "Terlalu banyak percobaan dari jaringan ini. Tunggu satu menit lalu coba lagi.";
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CAPTCHA_FAILED = "Verifikasi keamanan gagal atau kedaluwarsa. Coba lagi.";

export type CodeState = { step?: "email" | "code"; email?: string; error?: string; notice?: string };

// PR-29 / DEC-007: email first. The reply never reveals whether the address already has an
// account or whether creation was refused; returning users simply sign in with the code.
export async function requestCodeAction(_: CodeState, form: FormData): Promise<CodeState> {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  if (!EMAIL.test(email) || email.length > 254) return { step: "email", email, error: "Masukkan alamat email yang valid." };
  if (!(await withinLimit("OTP_LIMITER"))) return { step: "email", email, error: TOO_MANY };
  const supabase = await supabaseServer();
  // Every outcome (sent, refused because registration is closed, or throttled because a code was
  // just sent to an existing account) gets the same reply, so the page cannot be used to learn
  // whether an address has an account.
  const captchaToken = String(form.get("cf-turnstile-response") ?? "");
  const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: true, captchaToken } });
  // A failed security check or a delivery outage says nothing about the address, so be truthful.
  if (error?.code === "captcha_failed") return { step: "email", email, error: CAPTCHA_FAILED };
  // While registration is closed only existing or invited addresses reach delivery, so a delivery
  // error would single them out; report it only while registration is open.
  if (error && (error.status ?? 0) >= 500) {
    const { data: open } = await supabase.rpc("registration_open");
    if (open) return { step: "email", email, error: "Pengiriman kode sedang bermasalah. Coba lagi beberapa saat lagi." };
  }
  return { step: "code", email, notice: `Jika alamat ${email} bisa dipakai, kode 6 digit sudah dikirim ke sana.` };
}

export async function verifyCodeAction(prev: CodeState, form: FormData): Promise<CodeState> {
  const email = prev.email ?? "";
  const token = String(form.get("code") ?? "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(token)) return { ...prev, notice: undefined, error: "Masukkan 6 digit kode dari email." };
  if (!(await withinLimit("SIGN_IN_LIMITER"))) return { ...prev, notice: undefined, error: TOO_MANY };
  const supabase = await supabaseServer();
  const { error } = await supabase.auth.verifyOtp({ email, token, type: "email" });
  if (error) return { ...prev, notice: undefined, error: "Kode tidak cocok atau sudah kedaluwarsa. Minta kode baru bila perlu." };
  redirect("/");
}

export type FormState = { error?: string; ok?: string; fieldErrors?: Record<string, string>; values?: Record<string, string> };

// Only an identity that proved inbox control and has no password yet sets one here; changing an
// existing password belongs to account recovery, not this step.
export async function setPasswordAction(_: FormState, form: FormData): Promise<FormState> {
  const password = String(form.get("password") ?? "");
  const confirm = String(form.get("confirm") ?? "");
  if (password.length < 10) return { fieldErrors: { password: "Minimal 10 karakter." } };
  if (password !== confirm) return { fieldErrors: { confirm: "Kata sandi tidak sama." } };
  const supabase = await supabaseServer();
  const { data: state } = await supabase.rpc("my_account_state");
  const account = (state as { has_password: boolean; registration_open: boolean }[] | null)?.[0];
  if (!account) redirect("/masuk");
  if (account.has_password) redirect("/");
  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: error.code === "weak_password" ? "Kata sandi terlalu lemah. Pakai kombinasi yang lebih panjang." : "Kata sandi belum bisa disimpan. Coba lagi." };
  // Invited staff go to their invitation; a new registrant continues to the application.
  const { data: invites } = await supabase.rpc("my_invitations");
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
  const supabase = await supabaseServer();
  const expected = Number(form.get("revision") ?? 0);
  const { data, error } = await supabase.rpc("save_application", {
    p_expected_revision: expected,
    p_business_name: values.business_name, p_outlet_name: values.outlet_name,
    p_pickup_address: values.pickup_address, p_pickup_area: values.pickup_area,
    p_contact_phone: values.contact_phone,
  });
  if (error) return { error: friendlyError(error), values };
  const saved = (data as { id: string; revision: number }[])[0];
  if (submit) {
    const { error: e2 } = await supabase.rpc("submit_application", { p_id: saved.id, p_expected_revision: saved.revision });
    if (e2) return { error: friendlyError(e2), values };
  }
  revalidatePath("/daftar/gerai");
  return { ok: submit ? "Pengajuan terkirim. Kami akan meninjau data gerai Anda." : "Draf tersimpan." };
}

export async function withdrawApplicationAction(_: FormState, form: FormData): Promise<FormState> {
  const supabase = await supabaseServer();
  const { error } = await supabase.rpc("withdraw_application", {
    p_id: String(form.get("id")), p_expected_revision: Number(form.get("revision")),
  });
  if (error) return { error: friendlyError(error) };
  revalidatePath("/daftar/gerai");
  return { ok: "Pengajuan dibatalkan." };
}

// Super Admin review (PR-15/PR-30) and the public-registration switch (PR-33 gate).
export async function reviewApplicationAction(_: FormState, form: FormData): Promise<FormState> {
  const decision = String(form.get("decision"));
  const supabase = await supabaseServer();
  const { error } = await supabase.rpc("platform_review_application", {
    p_id: String(form.get("id")), p_expected_revision: Number(form.get("revision")),
    p_decision: decision, p_reason: String(form.get("reason") ?? ""),
  });
  if (error) return { error: friendlyError(error) };
  // The decided application leaves the "submitted" list, so confirm on the list it moved to.
  const status = decision === "approve" ? "approved" : decision === "reject" ? "rejected" : "changes_requested";
  redirect(`/admin/pengajuan?status=${status}&keputusan=${decision}`);
}

export async function setRegistrationAction(_: FormState, form: FormData): Promise<FormState> {
  const open = form.get("open") === "true";
  const supabase = await supabaseServer();
  const { error } = await supabase.rpc("platform_set_registration", { p_open: open, p_reason: String(form.get("reason") ?? "") });
  if (error) return { error: friendlyError(error) };
  revalidatePath("/admin");
  return { ok: open ? "Pendaftaran publik dibuka." : "Pendaftaran publik ditutup." };
}
