import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { dbServer } from "@/lib/db/server";
import { requireWorkspace } from "@/lib/workspace";
import { readGeraiLogo } from "@/lib/gerai-logo-server";
import { SNAPSHOT_COLUMNS, type LabelFacts, type LabelSize, type LabelSnapshot } from "@/lib/label-content";
import { parseBatchIds, type BatchCandidate } from "@/modules/labels/batch-selection";
import { BatchWorkbench, type BatchEntry } from "@/modules/labels/batch-workbench";

export const metadata: Metadata = { title: "Cetak label massal" };

export default async function BatchLabelPage({ searchParams }: { searchParams: Promise<{ ids?: string | string[] }> }) {
  const ws = await requireWorkspace();
  const ids = parseBatchIds((await searchParams).ids);
  if (!ids) notFound();
  const db = await dbServer();
  const [{ data: rows, error }, { data: tenant }, { data: snapshotRows, error: snapshotError }, { data: firstRows, error: formatError }] = await Promise.all([
    db.from("shipments").select("id, reference, submission_state, awb, is_simulated, sender_name, sender_phone, sender_address, sender_area, recipient_name, recipient_phone, recipient_address, recipient_area, recipient_postal_code, item_description, weight_grams, is_cod, cod_amount_idr, pickup_snapshot, quote:shipment_quotes!shipments_tenant_id_selected_quote_id_fkey(courier, service)").eq("tenant_id", ws.tenant.id).in("id", ids),
    db.from("tenants").select("name, contact_whatsapp, masking_allowed").eq("id", ws.tenant.id).maybeSingle(),
    // Newest first: the first row per shipment is the one create_label_snapshot compares against.
    db.from("label_snapshots").select(`shipment_id, ${SNAPSHOT_COLUMNS}`).eq("tenant_id", ws.tenant.id).in("shipment_id", ids)
      .order("version", { ascending: false }),
    // One first version per shipment: do not infer the lock from a paginated latest-history read.
    db.from("label_snapshots").select("shipment_id, size").eq("tenant_id", ws.tenant.id).in("shipment_id", ids).eq("version", 1),
  ]);
  if (error || snapshotError || formatError) throw new Error("Daftar label belum bisa dimuat.");
  if (!tenant || !rows?.length) notFound();
  const latest = new Map<string, LabelSnapshot>();
  const lockedSizes = new Map((firstRows ?? []).map((row) => [row.shipment_id, row.size as LabelSize]));
  for (const snapshot of (snapshotRows ?? []) as unknown as (LabelSnapshot & { shipment_id: string })[]) {
    if (!latest.has(snapshot.shipment_id)) latest.set(snapshot.shipment_id, snapshot);
  }
  const logo = await readGeraiLogo(ws.tenant.id);
  const byId = new Map(rows.map((row) => [row.id, row]));
  const entries: BatchEntry[] = ids.flatMap((id) => {
    const row = byId.get(id);
    if (!row) return [];
    const pickup = (row.pickup_snapshot ?? {}) as { address?: string; area?: string };
    const quote = row.quote as unknown as { courier: string; service: string } | null;
    const facts: LabelFacts = {
      reference: row.reference, awb: row.awb ?? "", courier: quote?.courier ?? null, service: quote?.service ?? null,
      weightGrams: row.weight_grams, isCod: row.is_cod, codAmountIdr: row.cod_amount_idr, itemDescription: row.item_description,
      recipient: { name: row.recipient_name, phone: row.recipient_phone, address: row.recipient_address, area: row.recipient_area, postalCode: row.recipient_postal_code },
      geraiName: tenant.name, geraiLogo: logo?.logo ?? null, geraiWhatsapp: tenant.contact_whatsapp,
      pickupAddress: pickup.address ?? ws.outlet.pickupAddress, pickupArea: pickup.area ?? ws.outlet.pickupArea,
    };
    return [{ row: row as BatchCandidate, facts, latest: latest.get(row.id) ?? null, lockedSize: lockedSizes.get(row.id) ?? null }];
  });
  return <div className="flex flex-col gap-6"><Link href="/pengiriman" className="inline-flex min-h-11 items-center self-start text-primary print:hidden">← Kembali ke pengiriman</Link><BatchWorkbench entries={entries} maskingAllowed={tenant.masking_allowed} whatsapp={tenant.contact_whatsapp} preferenceKey={`gx:label-choice:${ws.tenant.id}:${ws.userId}`} /></div>;
}
