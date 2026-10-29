"use server";

import { revalidatePath } from "next/cache";
import { friendlyError } from "@/lib/errors";
import { recoverRotatedPartnerSellerKey, regeneratePartnerSellerKey } from "@/lib/mengantar/partner-key-rotation";
import { dbServer } from "@/lib/db/server";
import { requireWorkspace } from "@/lib/workspace";
import type { CredentialState } from "./actions";
import { partnerDeps } from "./partner-deps";

// T-039 / PR-19 / DEC-013: regenerate the Partner-managed seller key. The old key stops at Mengantar
// immediately and shipments pause until the new key is stored, so the form must carry an explicit
// confirmation. The orchestrator refuses BYOK credentials; the browser posts no tenant, seller or version.
export async function regeneratePartnerKeyAction(
  _: CredentialState,
  form: FormData,
): Promise<CredentialState> {
  const ws = await requireWorkspace();
  if (ws.role !== "tenant_admin" || ws.isDemo) {
    return { error: "Hanya admin gerai yang dapat membuat ulang kunci API Mengantar." };
  }
  if (form.get("confirm_regenerate") !== "yes") {
    return { error: "Konfirmasi dulu bahwa kunci lama berhenti berlaku seketika dan pengiriman dijeda sampai kunci baru tersimpan." };
  }
  const db = await dbServer();
  const deps = await partnerDeps(db);
  if (!deps) return { error: friendlyError({ message: "partner_not_configured" }) };
  const res = await regeneratePartnerSellerKey({ tenantId: ws.tenant.id, actorId: ws.userId }, deps);
  revalidatePath("/pengaturan");
  if (!res.ok) return { error: friendlyError({ message: res.errorCode }) };
  return { ok: res.message };
}

// T-039: after a lost or refused regeneration, fetch the CURRENT key (sellers/api-key) and store it.
export async function recoverRotatedPartnerKeyAction(
  _: CredentialState,
  _form: FormData,
): Promise<CredentialState> {
  const ws = await requireWorkspace();
  if (ws.role !== "tenant_admin" || ws.isDemo) {
    return { error: "Hanya admin gerai yang dapat mengambil kunci API Mengantar." };
  }
  const db = await dbServer();
  const deps = await partnerDeps(db);
  if (!deps) return { error: friendlyError({ message: "partner_not_configured" }) };
  const res = await recoverRotatedPartnerSellerKey({ tenantId: ws.tenant.id, actorId: ws.userId }, deps);
  revalidatePath("/pengaturan");
  if (!res.ok) return { error: friendlyError({ message: res.errorCode }) };
  return { ok: res.message };
}
