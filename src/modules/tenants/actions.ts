"use server";

import { revalidatePath } from "next/cache";
import { friendlyError } from "@/lib/errors";
import { requirePlatform } from "@/lib/platform";
import { dbServer } from "@/lib/db/server";

export type MaskingState = { error?: string; ok?: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// DEC-018 item 3 / PR-34 / UX-9: a Super Admin allows or disables sender masking for one gerai. The
// capability, aal2, live grant, reason (5-500 characters) and audit are enforced by the database
// function; requirePlatform only keeps non-holders out of the action. Existing label snapshots are
// never rewritten, so disabling only affects labels created afterwards.
export async function setMaskingAllowedAction(_: MaskingState, form: FormData): Promise<MaskingState> {
  await requirePlatform("tenant_governance");
  const tenant = String(form.get("tenant_id") ?? "");
  if (!UUID.test(tenant)) return { error: friendlyError({ message: "not_found" }) };
  const target = String(form.get("allowed") ?? "");
  if (target !== "yes" && target !== "no") return { error: friendlyError({ message: "invalid_input" }) };
  const allowed = target === "yes";
  const reason = String(form.get("reason") ?? "").trim();
  if (reason.length < 5 || reason.length > 500) return { error: friendlyError({ message: "reason_required" }) };

  const db = await dbServer();
  const { data: before } = await db.rpc("platform_tenant_masking", { p_tenant: tenant });
  const current = (before as { masking_allowed: boolean }[] | null)?.[0]?.masking_allowed;
  const { error } = await db.rpc("platform_set_masking_allowed", { p_tenant: tenant, p_allowed: allowed, p_reason: reason });
  if (error) return { error: friendlyError(error) };
  revalidatePath(`/admin/tenant/${tenant}`);
  revalidatePath("/admin/audit");
  if (current === allowed) {
    return { ok: allowed ? "Masking sudah diizinkan untuk gerai ini; tidak ada perubahan." : "Masking sudah dinonaktifkan untuk gerai ini; tidak ada perubahan." };
  }
  return {
    ok: allowed
      ? "Masking pengirim diizinkan untuk gerai ini. Perubahan tercatat di audit."
      : "Masking pengirim dinonaktifkan untuk gerai ini. Label berikutnya dicetak dengan identitas gerai; label yang sudah dibuat tidak berubah. Perubahan tercatat di audit.",
  };
}

export type PartnerStopState = { error?: string; ok?: string };

// T-054 review M1: an integration operator clears a tenant's Partner stop (provider_restricted) after
// reviewing it with Mengantar. The database enforces the capability, aal2, live grant, reason and audit,
// chooses the safe next state and keeps any retry window; no provider request is made. A replay is a no-op.
export async function clearPartnerStopAction(_: PartnerStopState, form: FormData): Promise<PartnerStopState> {
  await requirePlatform("integration_operations");
  const tenant = String(form.get("tenant_id") ?? "");
  if (!UUID.test(tenant)) return { error: friendlyError({ message: "not_found" }) };
  const reason = String(form.get("reason") ?? "").trim();
  if (reason.length < 5 || reason.length > 500) return { error: friendlyError({ message: "reason_required" }) };
  const { error } = await (await dbServer()).rpc("platform_clear_partner_stop", { p_tenant: tenant, p_reason: reason });
  if (error) return { error: friendlyError(error) };
  revalidatePath(`/admin/tenant/${tenant}`);
  revalidatePath("/admin/audit");
  return { ok: "Pembatasan Mengantar dibuka untuk gerai ini dan tercatat di audit. Langkah berikutnya tetap menunggu batas waktu Mengantar bila masih berlaku." };
}
