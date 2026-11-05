"use server";

import { revalidatePath } from "next/cache";
import { SNAPSHOT_COLUMNS, isLabelSize, senderErrors, type LabelSnapshot, type SenderErrors, type SenderInput } from "../../lib/label-content";
import { dbServer } from "@/lib/db/server";
import { requireWorkspace } from "@/lib/workspace";
import { LABEL_UNKNOWN_RESULT, WHATSAPP_SAVED, labelError, labelPrintError } from "./messages";

// No provider call is made here or anywhere in the label path (DEC-017): the snapshot and the print
// history are database commands that re-check membership, the shipment's state and the masking policy.
export type PrintInput = { shipmentId: string; mask: boolean; size: string; sender: SenderInput };
export type PrintResult =
  | { ok: true; snapshot: LabelSnapshot }
  | { ok: false; error: string; fieldErrors?: SenderErrors; reconcile?: boolean };

export async function printLabelAction(input: PrintInput): Promise<PrintResult> {
  const ws = await requireWorkspace();
  if (!input || typeof input !== "object" || Array.isArray(input)
    || typeof input.shipmentId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.shipmentId)
    || typeof input.mask !== "boolean" || !isLabelSize(input.size)
    || (input.mask && (!input.sender || typeof input.sender !== "object" || Array.isArray(input.sender)
      || ![input.sender.name, input.sender.phone, input.sender.city, input.sender.address].every((value) => typeof value === "string")))) {
    return { ok: false, error: labelError({ message: "invalid_input" }) };
  }
  const mask = input.mask;
  if (mask) {
    const fieldErrors = senderErrors(input.sender);
    if (Object.keys(fieldErrors).length > 0) return { ok: false, error: labelError({ message: "invalid_input" }), fieldErrors };
  }
  const db = await dbServer();
  const scoped = await db.from("shipments").select("id").eq("tenant_id", ws.tenant.id).eq("id", input.shipmentId).maybeSingle();
  if (scoped.error) return { ok: false, error: labelError(scoped.error) };
  if (!scoped.data) return { ok: false, error: labelError({ message: "not_found" }) };
  const { data: id, error } = await db.rpc("create_label_snapshot", {
    p_shipment: input.shipmentId, p_mask: mask, p_size: input.size,
    p_sender_name: mask ? input.sender.name : null, p_sender_phone: mask ? input.sender.phone : null, p_sender_city: mask ? input.sender.city : null,
    p_sender_address: mask ? input.sender.address : null,
  });
  if (error || typeof id !== "string") {
    const message = labelPrintError(error);
    return { ok: false, error: message, reconcile: message === LABEL_UNKNOWN_RESULT };
  }
  const printed = await db.rpc("record_label_print", { p_snapshot: id });
  if (printed.error) {
    const message = labelPrintError(printed.error);
    return { ok: false, error: message, reconcile: message === LABEL_UNKNOWN_RESULT };
  }
  const { data: snapshot } = await db.from("label_snapshots").select(SNAPSHOT_COLUMNS).eq("tenant_id", ws.tenant.id).eq("id", id).maybeSingle();
  // The print event already committed: a failed read must not invite another write.
  if (!snapshot) return { ok: false, error: LABEL_UNKNOWN_RESULT, reconcile: true };
  revalidatePath(`/pengiriman/${input.shipmentId}/label`);
  return { ok: true, snapshot: snapshot as unknown as LabelSnapshot };
}

export type WhatsappState = { ok?: string; error?: string; value?: string; revision?: number };

// A tenant administrator saves the gerai WhatsApp through the audited command; the browser never writes
// the column (it has no privilege to). The database normalizes +62 and 62 to 0 and returns the stored form.
export async function setContactWhatsappAction(_: WhatsappState, form: FormData): Promise<WhatsappState> {
  const ws = await requireWorkspace();
  const raw = String(form.get("whatsapp") ?? "").trim();
  const seen = Number(form.get("revision"));
  if (ws.isDemo) return { error: labelError({ message: "demo_restricted" }), value: raw };
  if (ws.role !== "tenant_admin") return { error: labelError({ message: "admin_required" }), value: raw };
  const db = await dbServer();
  const { data, error } = await db.rpc("set_tenant_contact_whatsapp", {
    p_tenant: ws.tenant.id, p_value: raw, p_expected_revision: Number.isInteger(seen) ? seen : null,
  });
  if (error || typeof data !== "string") return { error: labelError(error), value: raw };
  const { data: tenant } = await db.from("tenants").select("contact_whatsapp_revision").eq("id", ws.tenant.id).maybeSingle();
  revalidatePath("/pengaturan");
  return { ok: WHATSAPP_SAVED, value: data, revision: tenant?.contact_whatsapp_revision };
}
