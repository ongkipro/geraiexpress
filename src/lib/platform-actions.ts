"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAuth } from "@/lib/auth/instance";
import { currentUser, dbServer } from "@/lib/db/server";
import { writeSessionCookies } from "@/lib/db/session";
import { friendlyError } from "@/lib/errors";
import { loadPlatform, type Capability } from "@/lib/platform";
import { wibInstant } from "@/lib/wib";
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

// T-091 / DEC-024 (G1): append-only platform configuration. Both RPCs re-check the capability, require a
// reason and write the audit row; nothing here edits an existing version.
const lines = (value: FormDataEntryValue | null) => String(value ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
const optionalInt = (value: FormDataEntryValue | null) => {
  const text = String(value ?? "").trim();
  return text === "" ? null : Number(text);
};

export async function addDeclarationTextAction(_: FormState, form: FormData): Promise<FormState> {
  const scope = await requestScope();
  if (scope !== "platform" && scope !== "shared") return { error: "Tidak ditemukan." };
  const categories = lines(form.get("categories"));
  if (categories.length === 0) return { error: "Isi minimal satu kategori barang terlarang (satu per baris)." };
  const db = await dbServer();
  const { data, error } = await db.rpc("platform_add_declaration_text", {
    p_body: String(form.get("body") ?? "").trim(),
    p_categories: categories,
    p_source_url: String(form.get("source_url") ?? "").trim(),
    p_provisional: form.get("provisional") === "on",
    p_reason: String(form.get("reason") ?? ""),
  });
  if (error) return { error: friendlyError(error) };
  revalidatePath("/admin/konfigurasi");
  return { ok: `Versi ${data} teks pernyataan berlaku sekarang.` };
}

export async function addWeightRuleAction(_: FormState, form: FormData): Promise<FormState> {
  const scope = await requestScope();
  if (scope !== "platform" && scope !== "shared") return { error: "Tidak ditemukan." };
  const kg = (name: string) => { const v = optionalInt(form.get(name)); return v === null ? null : v * 1000; };
  const effectiveAt = wibInstant(String(form.get("effective_at") ?? ""));
  if (!effectiveAt) return { error: "Waktu berlaku tidak valid. Pakai format tanggal dan jam, atau kosongkan untuk sekarang." };
  const rule = {
    courier: String(form.get("courier") ?? ""),
    service_class: String(form.get("service_class") ?? ""),
    divisor: optionalInt(form.get("divisor")),
    tolerance_grams: optionalInt(form.get("tolerance_grams")),
    max_weight_grams: kg("max_kg"),
    min_weight_grams: kg("min_kg"),
    source_url: String(form.get("source_url") ?? "").trim(),
    source_updated_at: String(form.get("source_updated_at") ?? ""),
    // Empty = effective now; a later time schedules the version.
    effective_at: effectiveAt,
  };
  if ([rule.divisor, rule.tolerance_grams, rule.max_weight_grams, rule.min_weight_grams].some((v) => v !== null && !Number.isSafeInteger(v))) {
    return { error: "Periksa kembali angka yang diisi (bilangan bulat)." };
  }
  const db = await dbServer();
  const { error } = await db.rpc("platform_set_billable_weight_rule", { p_rule: rule, p_reason: String(form.get("reason") ?? "") });
  if (error) return { error: friendlyError(error) };
  revalidatePath("/admin/konfigurasi");
  return { ok: `Versi aturan ${rule.courier} ${rule.service_class === "cargo" ? "Kargo" : "Reguler"} disimpan.` };
}

// T-093 / DEC-024 (a): customer-data reads. POST only (a Server Action): the phone and the reason never
// enter a URL or a server log, and a reload does not repeat an audited read. The RPC re-checks
// `customer_data_review`, requires the reason and writes one audit row per call.
export type CustomerGerai = {
  tenant_id: string; tenant_name: string; outlet_name: string; shipments: number; issued: number;
  as_recipient: number; as_sender: number; first_at: string; last_at: string;
};
export type CustomerProfile = {
  phone: string; shipments: number; issued: number; as_recipient: number; as_sender: number; gerai_count: number; gerai: CustomerGerai[];
};
export type CustomerLookupState = { error?: string; result?: CustomerProfile };

export async function customerLookupAction(_: CustomerLookupState, form: FormData): Promise<CustomerLookupState> {
  const scope = await requestScope();
  if (scope !== "platform" && scope !== "shared") return { error: "Tidak ditemukan." };
  const db = await dbServer();
  const { data, error } = await db.rpc("platform_customer_lookup", {
    p_phone: String(form.get("phone") ?? ""),
    p_reason: String(form.get("reason") ?? ""),
  });
  if (error) return { error: error.message === "invalid_input" ? "Nomor HP tidak valid. Contoh 081234567890." : friendlyError(error) };
  return { result: data as CustomerProfile };
}

export type TenantCustomerRow = {
  id: string; reference: string; created_at: string; issued_at: string | null; submission_state: string; awb: string | null;
  outlet_name: string; sender_name: string | null; sender_phone: string | null; recipient_name: string | null;
  recipient_phone: string | null; recipient_address: string | null; recipient_area: string | null; recipient_postal_code: string | null;
};
export type TenantCustomersState = { error?: string; reason?: string; tenantName?: string; total?: number; rows?: TenantCustomerRow[] };
const TENANT_CUSTOMERS_PAGE = 20;

// Each page is its own audited read with the same reason; earlier pages stay on screen.
export async function tenantCustomersAction(prev: TenantCustomersState, form: FormData): Promise<TenantCustomersState> {
  const scope = await requestScope();
  if (scope !== "platform" && scope !== "shared") return { error: "Tidak ditemukan." };
  const more = form.get("more") === "1";
  const reason = more ? prev.reason ?? "" : String(form.get("reason") ?? "");
  const offset = more ? prev.rows?.length ?? 0 : 0;
  const db = await dbServer();
  const { data, error } = await db.rpc("platform_tenant_customers", {
    p_tenant: String(form.get("tenant_id") ?? ""), p_reason: reason, p_limit: TENANT_CUSTOMERS_PAGE, p_offset: offset,
  });
  if (error) return { ...(more ? prev : {}), error: friendlyError(error) };
  const page = data as { tenant_name: string; total: number; rows: TenantCustomerRow[] };
  return { reason, tenantName: page.tenant_name, total: page.total, rows: more ? [...(prev.rows ?? []), ...page.rows] : page.rows };
}

// T-084 / PR-46: the per-courier masking acceptance record. The RPC re-checks integration_operations at
// aal2, requires the reason (and evidence for verified/refused), refuses a stale view (55000) and audits.
export async function setMaskingAcceptanceAction(_: FormState, form: FormData): Promise<FormState> {
  const scope = await requestScope();
  if (scope !== "platform" && scope !== "shared") return { error: "Tidak ditemukan." };
  const seen = String(form.get("expected_recorded_at") ?? "");
  const db = await dbServer();
  const { data, error } = await db.rpc("platform_set_masking_acceptance", {
    p_courier: String(form.get("courier") ?? ""),
    p_state: String(form.get("state") ?? ""),
    p_evidence_ref: String(form.get("evidence_ref") ?? ""),
    p_expected_recorded_at: seen === "" ? null : seen,
    p_reason: String(form.get("reason") ?? ""),
  });
  if (error) {
    if (error.message === "evidence_required") return { error: "Isi referensi bukti (uji scan kurir atau hasil sinkronisasi Mengantar) untuk status terverifikasi atau ditolak." };
    return { error: friendlyError(error) };
  }
  revalidatePath("/admin/integrasi");
  return { ok: `Status penerimaan label masking disimpan: ${data === "verified" ? "terverifikasi" : data === "refused" ? "ditolak kurir" : "belum terverifikasi"}.` };
}
