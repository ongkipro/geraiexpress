"use server";

import { revalidatePath } from "next/cache";
import { trackingTokenSecret } from "@/lib/config";
import { dbServer } from "@/lib/db/server";
import { courierName } from "@/lib/format";
import { originFor } from "@/lib/hosts";
import { requireWorkspace } from "@/lib/workspace";
import { trackingToken, trackingTokenHash } from "./token";
import { senderWhatsApp, trackingMessage } from "./share-message";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type ShareResult = { error: string } | { link: string; message: string; whatsapp: string | null };

export async function shareTrackingAction(shipmentId: string): Promise<ShareResult> {
  const ws = await requireWorkspace();
  if (!uuid.test(shipmentId) || ws.isDemo) return { error: "Tautan hanya tersedia untuk resi terbit yang asli." };
  const db = await dbServer();
  const { data: s } = await db.from("shipments").select("id, awb, sender_phone, selected_quote_id, submission_state, is_simulated")
    .eq("tenant_id", ws.tenant.id).eq("id", shipmentId).maybeSingle();
  if (!s || s.is_simulated || s.submission_state !== "issued" || !s.awb) return { error: "Resi belum tersedia." };
  try {
    const secret = trackingTokenSecret();
    const origin = originFor("public"); // SITE_ORIGIN only, never request headers.
    const { data: linkId, error: prepareError } = await db.rpc("prepare_tracking_link", { p_shipment: s.id });
    if (prepareError || typeof linkId !== "string") throw new Error("tracking_prepare_failed");
    const token = trackingToken(linkId, secret);
    const { error } = await db.rpc("publish_tracking_link", { p_shipment: s.id, p_link: linkId, p_hash: trackingTokenHash(token) });
    if (error) throw new Error("tracking_publish_failed");
    const { data: q } = s.selected_quote_id ? await db.from("shipment_quotes").select("courier, service")
      .eq("tenant_id", ws.tenant.id).eq("id", s.selected_quote_id).maybeSingle() : { data: null };
    const link = `${origin}/lacak/${token}`;
    const message = trackingMessage(ws.tenant.name, [q?.courier ? courierName(q.courier) : "Kurir", q?.service].filter(Boolean).join(" "), s.awb, link);
    const phone = senderWhatsApp(s.sender_phone);
    revalidatePath(`/pengiriman/${shipmentId}`);
    return { link, message, whatsapp: phone ? `https://wa.me/${phone}?text=${encodeURIComponent(message)}` : null };
  } catch {
    return { error: "Tautan belum bisa disiapkan. Muat ulang dan coba lagi; hubungi administrator jika tetap gagal." };
  }
}

export async function revokeTrackingAction(shipmentId: string, linkId: string): Promise<{ error?: string }> {
  const ws = await requireWorkspace();
  if (!uuid.test(shipmentId) || !uuid.test(linkId) || ws.role !== "tenant_admin" || ws.isDemo) return { error: "Hanya administrator gerai yang dapat mencabut tautan." };
  const db = await dbServer();
  const { data: s } = await db.from("shipments").select("id").eq("tenant_id", ws.tenant.id).eq("id", shipmentId).maybeSingle();
  if (!s) return { error: "Pengiriman tidak ditemukan." };
  const { error } = await db.rpc("revoke_tracking_link", { p_shipment: shipmentId, p_link: linkId });
  if (error) return { error: "Tautan belum bisa dicabut. Muat ulang halaman dan coba lagi." };
  revalidatePath(`/pengiriman/${shipmentId}`);
  return {};
}
