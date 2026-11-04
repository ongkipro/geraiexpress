"use server";

import { revalidatePath } from "next/cache";
import { dbServer } from "@/lib/db/server";
import { requireWorkspace } from "@/lib/workspace";
import { GERAI_LOGO_MAX_BYTES, LOGO_READ_ERROR, LOGO_SIZE_ERROR, LOGO_TYPE_ERROR, geraiLogoError, geraiLogoMime } from "@/lib/gerai-logo";

export type LogoActionState = { error?: string; ok?: string };

export async function setGeraiLogoAction(_: LogoActionState, form: FormData): Promise<LogoActionState> {
  const ws = await requireWorkspace();
  if (ws.isDemo) return { error: geraiLogoError({ message: "demo_restricted" }) };
  if (ws.role !== "tenant_admin") return { error: geraiLogoError({ message: "admin_required" }) };
  const rawRevision = form.get("revision");
  const revision = Number(rawRevision);
  if (typeof rawRevision !== "string" || !/^\d+$/.test(rawRevision) || !Number.isSafeInteger(revision) || revision < 0) return { error: geraiLogoError({ message: "stale_state" }) };
  const operation = form.get("operation");
  if (operation !== "upload" && operation !== "remove") return { error: LOGO_TYPE_ERROR };
  let mime: string | null = null;
  let base64: string | null = null;
  if (operation === "upload") {
    const file = form.get("logo");
    if (!(file instanceof File) || file.size === 0) return { error: LOGO_TYPE_ERROR };
    if (file.size > GERAI_LOGO_MAX_BYTES) return { error: LOGO_SIZE_ERROR };
    // Check declared MIME and extension as well as bytes; neither metadata field is trusted alone.
    const extensions: Record<string, RegExp> = { "image/png": /\.png$/i, "image/jpeg": /\.jpe?g$/i, "image/webp": /\.webp$/i };
    if (!extensions[file.type]?.test(file.name)) return { error: LOGO_TYPE_ERROR };
    let bytes: Uint8Array;
    try { bytes = new Uint8Array(await file.arrayBuffer()); } catch { return { error: LOGO_READ_ERROR }; }
    mime = geraiLogoMime(bytes);
    if (!mime || mime !== file.type) return { error: LOGO_TYPE_ERROR };
    base64 = Buffer.from(bytes).toString("base64");
  }
  try {
    const { error } = await (await dbServer()).rpc("set_tenant_logo", {
      p_tenant: ws.tenant.id, p_mime: mime, p_base64: base64, p_expected_revision: revision,
    });
    if (error) return { error: geraiLogoError(error) };
  } catch {
    return { error: geraiLogoError(null) };
  }
  revalidatePath("/pengaturan");
  return { ok: operation === "remove" ? "Logo dihapus. Label baru memakai nama gerai; label tersimpan tidak berubah." : "Logo disimpan. Label tersimpan sebelumnya tidak berubah." };
}
