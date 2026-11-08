"use server";

import { revalidatePath } from "next/cache";
import { dbServer } from "@/lib/db/server";
import { requireWorkspace } from "@/lib/workspace";
import { invoiceError } from "./messages";

// No provider call is made here (DEC-017): the invoice snapshot and the label print request are database
// commands that re-check membership and the shipment's state.
export type InvoiceActionResult = { ok: true } | { ok: false; error: string };

const UUID = /^[0-9a-f-]{36}$/i;

// Issues the shipment's invoice snapshot, or finds the existing one (idempotent in the database).
export async function issueInvoiceAction(shipmentId: string): Promise<InvoiceActionResult> {
  const ws = await requireWorkspace();
  if (!UUID.test(shipmentId)) return { ok: false, error: invoiceError({ message: "not_found" }) };
  const db = await dbServer();
  const scoped = await db.from("shipments").select("id").eq("tenant_id", ws.tenant.id).eq("id", shipmentId).maybeSingle();
  if (scoped.error) return { ok: false, error: invoiceError(scoped.error) };
  if (!scoped.data) return { ok: false, error: invoiceError({ message: "not_found" }) };
  const { error } = await db.rpc("create_invoice_snapshot", { p_shipment: shipmentId });
  if (error) return { ok: false, error: invoiceError(error) };
  revalidatePath(`/pengiriman/${shipmentId}/invoice`);
  return { ok: true };
}

// Appends the print request of the stored label snapshot to its print history through the existing label
// command (it records that a print was requested, never that paper came out). `acknowledged` is the PR-46
// acknowledgement for a masked label of a courier without recorded acceptance; the command enforces it.
export async function recordLabelPrintAction(snapshotId: string, acknowledged: boolean): Promise<InvoiceActionResult> {
  const ws = await requireWorkspace();
  if (!UUID.test(snapshotId) || typeof acknowledged !== "boolean") return { ok: false, error: invoiceError({ message: "not_found" }) };
  const db = await dbServer();
  const scoped = await db.from("label_snapshots").select("id").eq("tenant_id", ws.tenant.id).eq("id", snapshotId).maybeSingle();
  if (scoped.error) return { ok: false, error: invoiceError(scoped.error) };
  if (!scoped.data) return { ok: false, error: invoiceError({ message: "not_found" }) };
  const { error } = await db.rpc("record_label_print", { p_snapshot: snapshotId, p_acknowledged: acknowledged });
  return error ? { ok: false, error: invoiceError(error) } : { ok: true };
}
