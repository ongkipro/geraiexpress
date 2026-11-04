"use server";

import { dbServer } from "@/lib/db/server";
import { requireWorkspace } from "@/lib/workspace";
import { paymentError } from "./messages";

// Like label print history, this records a requested print, never proof of paper output. No replay
// on an unknown result: the caller asks the operator to reload before making another print request.
export async function recordReceiptPrintAction(shipmentId: string, paymentId: string | null, width: "58" | "80",
  identity: { geraiName: string; geraiWhatsapp: string | null }):
  Promise<{ ok: true } | { ok: false; error: string }> {
  const ws = await requireWorkspace();
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuid.test(shipmentId) || (paymentId !== null && !uuid.test(paymentId))) {
    return { ok: false, error: paymentError({ message: "not_found" }) };
  }
  if (!identity || typeof identity.geraiName !== "string" || Array.from(identity.geraiName).length < 2 || Array.from(identity.geraiName).length > 120
    || (identity.geraiWhatsapp !== null && (typeof identity.geraiWhatsapp !== "string" || !/^0[2-9][0-9]{7,11}$/.test(identity.geraiWhatsapp)))) {
    return { ok: false, error: paymentError({ message: "receipt_identity_changed" }) };
  }
  const db = await dbServer();
  const scoped = await db.from("shipments").select("id").eq("tenant_id", ws.tenant.id).eq("id", shipmentId).maybeSingle();
  if (scoped.error) return { ok: false, error: paymentError(scoped.error) };
  if (!scoped.data) return { ok: false, error: paymentError({ message: "not_found" }) };
  const { error } = await db.rpc("record_receipt_print", {
    p_shipment: shipmentId, p_payment: paymentId, p_width: width,
    p_preview_gerai_name: identity.geraiName, p_preview_gerai_whatsapp: identity.geraiWhatsapp,
  });
  return error ? { ok: false, error: paymentError(error) } : { ok: true };
}
