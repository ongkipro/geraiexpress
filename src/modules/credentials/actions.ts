"use server";

import { revalidatePath } from "next/cache";
import { credentialAad, credentialHint, sealCredential, validApiKey } from "@/lib/credential-crypto";
import { friendlyError } from "@/lib/errors";
import {
  DEFAULT_PARTNER_ID,
  onboardPartnerSeller,
  PARTNER_PRIVACY_VERSION,
  PARTNER_TERMS_VERSION,
  recoverPartnerSellerKey,
  type PartnerOnboardingDeps,
} from "@/lib/mengantar/partner-onboarding";
import { supabaseServer } from "@/lib/supabase/server";
import { workerSecret } from "@/lib/worker-secret";
import { requireWorkspace } from "@/lib/workspace";

export type CredentialState = { error?: string; ok?: string };

function partnerDeps(supabase: Awaited<ReturnType<typeof supabaseServer>>): PartnerOnboardingDeps {
  return {
    rpc: (fn, args) => supabase.rpc(fn, args),
    environment: workerSecret("MENGANTAR_ENV"),
    partnerId: workerSecret("PARTNER_ID") ?? DEFAULT_PARTNER_ID,
    partnerSecret:
      workerSecret("MENGANTAR_PARTNER_SECRET") ?? workerSecret("GERAIEXPRESS_MENGANTAR_SANDBOX_SECRET"),
    credentialKey: workerSecret("CREDENTIAL_KEY"),
  };
}

// PR-17 / PR-20 / DEC-006: onboard a new Mengantar seller account through the Partner API sandbox
// after recording owner identity and Terms/Privacy agreement.
export async function registerPartnerSellerAction(
  _: CredentialState,
  form: FormData,
): Promise<CredentialState> {
  const ws = await requireWorkspace();
  if (ws.role !== "tenant_admin" || ws.isDemo) {
    return { error: "Hanya admin gerai yang dapat mendaftarkan akun penjual Mengantar." };
  }
  const supabase = await supabaseServer();
  const res = await onboardPartnerSeller(
    {
      tenantId: ws.tenant.id,
      ownerName: String(form.get("owner_name") ?? ""),
      ownerEmail: String(form.get("owner_email") ?? ""),
      ownerPhone: String(form.get("owner_phone") ?? ""),
      termsVersion: String(form.get("terms_version") || PARTNER_TERMS_VERSION),
      privacyVersion: String(form.get("privacy_version") || PARTNER_PRIVACY_VERSION),
      agreed: form.get("consent_agreed") === "on",
    },
    partnerDeps(supabase),
  );
  revalidatePath("/pengaturan");
  if (!res.ok) return { error: friendlyError({ message: res.errorCode }) };
  return { ok: res.message };
}

// Recover the seller API key when a previous registration returned 503 KEY_PROVISIONING_FAILED
// (registered_key_pending) without creating a duplicate identity.
export async function recoverPartnerSellerKeyAction(
  _: CredentialState,
  form: FormData,
): Promise<CredentialState> {
  const ws = await requireWorkspace();
  if (ws.role !== "tenant_admin" || ws.isDemo) {
    return { error: "Hanya admin gerai yang dapat memulihkan kunci API Mengantar." };
  }
  const supabase = await supabaseServer();
  const res = await recoverPartnerSellerKey(ws.tenant.id, partnerDeps(supabase), {
    ownerName: String(form.get("owner_name") ?? ""),
    ownerEmail: String(form.get("owner_email") ?? ""),
    ownerPhone: String(form.get("owner_phone") ?? ""),
    termsVersion: String(form.get("terms_version") || PARTNER_TERMS_VERSION),
    privacyVersion: String(form.get("privacy_version") || PARTNER_PRIVACY_VERSION),
  });
  revalidatePath("/pengaturan");
  if (!res.ok) return { error: friendlyError({ message: res.errorCode }) };
  return { ok: res.message };
}

// PR-18 / DEC-006 / IAM-3: a tenant admin connects their own existing Mengantar seller key. The
// plaintext exists only inside this request: it is sealed with the Worker secret and bound to
// tenant + version before the database sees it. Nothing returns it afterwards.
export async function storeSellerKeyAction(_: CredentialState, form: FormData): Promise<CredentialState> {
  const ws = await requireWorkspace();
  if (ws.role !== "tenant_admin" || ws.isDemo) return { error: "Hanya admin gerai yang dapat menghubungkan akun Mengantar." };
  const apiKey = String(form.get("api_key") ?? "").trim();
  if (form.get("owner_confirm") !== "on") return { error: "Konfirmasi bahwa akun Mengantar ini milik bisnis Anda." };
  if (!validApiKey(apiKey)) return { error: "Kunci API tidak valid. Salin ulang dari dashboard Mengantar (16–128 karakter: huruf, angka, - atau _)." };
  const sealingKey = workerSecret("CREDENTIAL_KEY");
  if (!sealingKey) return { error: "Penyimpanan kunci belum dikonfigurasi di server. Hubungi tim GeraiExpress." };
  const expected = Number(form.get("latest_version") ?? 0);
  const sealed = await sealCredential(apiKey, credentialAad(ws.tenant.id, expected + 1), sealingKey);
  const supabase = await supabaseServer();
  const { error } = await supabase.rpc("store_seller_credential", {
    p_tenant: ws.tenant.id, p_expected_version: expected, p_ciphertext: sealed.ciphertext,
    p_iv: sealed.iv, p_key_version: sealed.keyVersion, p_hint: credentialHint(apiKey),
  });
  if (error) return { error: friendlyError(error) };
  revalidatePath("/pengaturan");
  return { ok: "Kunci API tersimpan terenkripsi. Kunci tidak bisa ditampilkan lagi." };
}

export async function removeSellerKeyAction(_: CredentialState, form: FormData): Promise<CredentialState> {
  const ws = await requireWorkspace();
  const supabase = await supabaseServer();
  const { error } = await supabase.rpc("remove_seller_credential", {
    p_tenant: ws.tenant.id, p_expected_version: Number(form.get("version")),
  });
  if (error) return { error: friendlyError(error) };
  revalidatePath("/pengaturan");
  return { ok: "Kunci API dihapus. GeraiExpress hanya menyimpan riwayat versinya, bukan kuncinya." };
}

export async function setPartnerIdAction(_: CredentialState, form: FormData): Promise<CredentialState> {
  const supabase = await supabaseServer();
  const { error } = await supabase.rpc("platform_set_partner_id", {
    p_partner_id: String(form.get("partner_id") ?? ""), p_reason: String(form.get("reason") ?? ""),
  });
  if (error) return { error: friendlyError(error) };
  revalidatePath("/admin/integrasi");
  return { ok: "Partner ID disimpan." };
}
