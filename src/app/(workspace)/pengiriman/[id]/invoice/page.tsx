import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { SNAPSHOT_COLUMNS, contentFromSnapshot, type LabelSnapshot } from "@/lib/label-content";
import { dbServer } from "@/lib/db/server";
import { requireWorkspace } from "@/lib/workspace";
import { INVOICE_COLUMNS, type InvoiceSnapshot } from "@/modules/invoices/invoice-content";
import { InvoiceWorkbench } from "@/modules/invoices/invoice-workbench";
import { PrintHeader } from "../print-header";

export const metadata: Metadata = { title: "Resi + invoice" };

// "Cetak resi + invoice" (PR-16): the stored masked label of a real issued shipment and its stored invoice.
// Both documents are read from immutable snapshots; this page creates none on load (the label is made in
// the label view, the invoice by an explicit button). Each sheet prints in its own print job.
export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const ws = await requireWorkspace();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const db = await dbServer();
  const { data: s } = await db.from("shipments").select("id, reference, awb, is_simulated, submission_state")
    .eq("tenant_id", ws.tenant.id).eq("id", id).maybeSingle();
  if (!s) notFound();
  // Demo shipments keep the watermarked sample label; unissued ones have nothing to print (PR-6).
  if (s.is_simulated || s.submission_state !== "issued" || !s.awb) redirect(`/pengiriman/${s.id}`);

  const [{ data: labelRows }, { data: invoice }] = await Promise.all([
    db.from("label_snapshots").select(SNAPSHOT_COLUMNS).eq("tenant_id", ws.tenant.id).eq("shipment_id", s.id)
      .order("version", { ascending: false }).limit(1),
    db.from("invoice_snapshots").select(INVOICE_COLUMNS).eq("tenant_id", ws.tenant.id).eq("shipment_id", s.id).maybeSingle(),
  ]);
  const label = ((labelRows ?? []) as unknown as LabelSnapshot[])[0] ?? null;

  return (
    <div className="flex flex-col gap-6">
      <PrintHeader shipmentId={s.id} reference={s.reference} awb={s.awb} state={s.submission_state} title="Cetak resi + invoice" current="invoice" tabs />
      <InvoiceWorkbench
        shipmentId={s.id}
        shipmentRef={s.reference}
        labelSnapshotId={label?.id ?? null}
        label={label ? contentFromSnapshot(label) : null}
        invoice={(invoice ?? null) as InvoiceSnapshot | null}
      />
    </div>
  );
}
