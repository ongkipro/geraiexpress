"use server";

import { revalidatePath } from "next/cache";
import { credentialAad, credentialHint, keyMaterialFromReader, sealCredential, validApiKey } from "@/lib/credential-crypto";
import { friendlyError } from "@/lib/errors";
import { onboardPartnerSeller, recoverPartnerSellerKey } from "@/lib/mengantar/partner-onboarding";
import { dbServer } from "@/lib/db/server";
import { config } from "@/lib/config";
import { requireWorkspace } from "@/lib/workspace";
import { partnerDeps } from "./partner-deps";
import { requestScope } from "@/lib/hosts";

export type CredentialState = { error?: string; ok?: string };

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
  const db = await dbServer();
  const deps = await partnerDeps(db);
  if (!deps) return { error: friendlyError({ message: "partner_not_configured" }) };
  // State gate (security review L1): the first call of the orchestrator is begin_partner_seller_onboarding,
  // which the database refuses with `rotation_unknown` while a key regeneration is in flight (the
  // old key is fenced, the new one not stored yet), so no provider request is made and the Bahasa
  // message of that code is returned. Reading the state here as well would only duplicate it.
  const res = await onboardPartnerSeller(
    {
      tenantId: ws.tenant.id,
      ownerName: String(form.get("owner_name") ?? ""),
      ownerEmail: String(form.get("owner_email") ?? ""),
      ownerPhone: String(form.get("owner_phone") ?? ""),
      agreed: form.get("consent_agreed") === "on",
    },
    deps,
  );
  revalidatePath("/pengaturan");
  if (!res.ok) return { error: friendlyError({ message: res.errorCode }) };
  return { ok: res.message };
}

// Recover the seller API key when a previous registration returned 503 KEY_PROVISIONING_FAILED
// (registered_key_pending) without creating a duplicate identity.
export async function recoverPartnerSellerKeyAction(
  _: CredentialState,
  _form: FormData,
): Promise<CredentialState> {
  const ws = await requireWorkspace();
  if (ws.role !== "tenant_admin" || ws.isDemo) {
    return { error: "Hanya admin gerai yang dapat memulihkan kunci API Mengantar." };
  }
  const db = await dbServer();
  const deps = await partnerDeps(db);
  if (!deps) return { error: friendlyError({ message: "partner_not_configured" }) };
  const res = await recoverPartnerSellerKey(ws.tenant.id, deps);
  revalidatePath("/pengaturan");
  if (!res.ok) return { error: friendlyError({ message: res.errorCode }) };
  return { ok: res.message };
}

// PR-18 / DEC-006 / IAM-3: a tenant admin connects their own existing Mengantar seller key. The
// plaintext exists only inside this request: it is sealed with the environment's key and bound to
// tenant + version before the database sees it. Nothing returns it afterwards.
export async function storeSellerKeyAction(_: CredentialState, form: FormData): Promise<CredentialState> {
  const ws = await requireWorkspace();
  if (ws.role !== "tenant_admin" || ws.isDemo) return { error: "Hanya admin gerai yang dapat menghubungkan akun Mengantar." };
  const apiKey = String(form.get("api_key") ?? "").trim();
  if (form.get("owner_confirm") !== "on") return { error: "Konfirmasi bahwa akun Mengantar ini milik bisnis Anda." };
  if (!validApiKey(apiKey)) return { error: "Kunci API tidak valid. Salin ulang dari dashboard Mengantar (16–128 karakter: huruf, angka, - atau _)." };
  const sealingKey = keyMaterialFromReader(config);
  // The key is stored for this deployment's Mengantar environment (a sandbox key is never read back for
  // production). A deployment without MENGANTAR_ENV (the synthetic demo) stores for sandbox, the safe side.
  const providerEnv = config("MENGANTAR_ENV") === "production" ? "production" : "sandbox";
  if (!sealingKey) return { error: "Penyimpanan kunci belum dikonfigurasi di server. Hubungi tim GeraiExpress." };
  const expected = Number(form.get("latest_version") ?? 0);
  const sealed = await sealCredential(apiKey, credentialAad(ws.tenant.id, expected + 1), sealingKey);
  const db = await dbServer();
  const { error } = await db.rpc("store_seller_credential", {
    p_tenant: ws.tenant.id, p_expected_version: expected, p_ciphertext: sealed.ciphertext,
    p_iv: sealed.iv, p_key_version: sealed.keyVersion, p_hint: credentialHint(apiKey), p_env: providerEnv,
  });
  if (error) return { error: friendlyError(error) };
  revalidatePath("/pengaturan");
  return { ok: "Kunci API tersimpan terenkripsi. Kunci tidak bisa ditampilkan lagi." };
}

export async function removeSellerKeyAction(_: CredentialState, form: FormData): Promise<CredentialState> {
  const ws = await requireWorkspace();
  const db = await dbServer();
  const { error } = await db.rpc("remove_seller_credential", {
    p_tenant: ws.tenant.id, p_expected_version: Number(form.get("version")),
  });
  if (error) return { error: friendlyError(error) };
  revalidatePath("/pengaturan");
  return { ok: "Kunci API dihapus. GeraiExpress hanya menyimpan riwayat versinya, bukan kuncinya." };
}

export async function setPartnerIdAction(_: CredentialState, form: FormData): Promise<CredentialState> {
  const scope = await requestScope();
  if (scope !== "platform" && scope !== "shared") return { error: "Tidak ditemukan." };
  const db = await dbServer();
  const { error } = await db.rpc("platform_set_partner_id", {
    p_partner_id: String(form.get("partner_id") ?? ""), p_reason: String(form.get("reason") ?? ""),
  });
  if (error) return { error: friendlyError(error) };
  revalidatePath("/admin/integrasi");
  return { ok: "Partner ID disimpan." };
}
