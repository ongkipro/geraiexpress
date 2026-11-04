import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { courierName, formatIdr, formatWeight, formatWib } from "@/lib/format";
import { SNAPSHOT_COLUMNS, senderFromShipment, type LabelFacts, type LabelSnapshot } from "@/lib/label-content";
import { dbServer } from "@/lib/db/server";
import { requireWorkspace } from "@/lib/workspace";
import { readGeraiLogo } from "@/lib/gerai-logo-server";
import { LabelWorkbench, type PrintHistoryEntry } from "@/modules/labels/label-workbench";
import { PrintHeader } from "../print-header";
import { PrintButton } from "./print-button";

export const metadata: Metadata = { title: "Label" };

const SHIPMENT_COLUMNS =
  "id, reference, awb, is_simulated, submission_state, is_cod, cod_amount_idr, goods_value_idr, sender_name, sender_phone, sender_address, sender_area, recipient_name, recipient_phone, recipient_address, recipient_area, recipient_postal_code, item_description, weight_grams, customer_charge_idr, pickup_snapshot, issued_at, selected_quote_id";

// A real issued shipment prints a local masked label from a stored snapshot (PR-6, PR-34, TD-13). A demo
// shipment keeps the watermarked sample (UX-3), which is not a courier label.
export default async function LabelPage({ params }: { params: Promise<{ id: string }> }) {
  const ws = await requireWorkspace();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const db = await dbServer();
  const { data: s } = await db.from("shipments").select(SHIPMENT_COLUMNS)
    .eq("tenant_id", ws.tenant.id).eq("id", id).maybeSingle();
  if (!s) notFound();
  const pickup = (s.pickup_snapshot ?? {}) as { outlet?: string; address?: string; area?: string };
  const { data: quote } = await db.from("shipment_quotes").select("courier, service")
    .eq("tenant_id", ws.tenant.id).eq("id", s.selected_quote_id).maybeSingle();

  if (!s.is_simulated) {
    if (s.submission_state !== "issued" || !s.awb) redirect(`/pengiriman/${s.id}`);
    const [{ data: tenant }, { data: snapshotRows }, { data: events }] = await Promise.all([
      db.from("tenants").select("name, contact_whatsapp, masking_allowed").eq("id", ws.tenant.id).maybeSingle(),
      db.from("label_snapshots").select(SNAPSHOT_COLUMNS).eq("tenant_id", ws.tenant.id).eq("shipment_id", s.id)
        .order("version", { ascending: false }).limit(20),
      db.from("label_print_events").select("id, snapshot_id, size, created_at").eq("tenant_id", ws.tenant.id).eq("shipment_id", s.id)
        .order("id", { ascending: false }).limit(20),
    ]);
    if (!tenant) notFound();
    const snapshots = (snapshotRows ?? []) as unknown as LabelSnapshot[];
    const byId = new Map(snapshots.map((snapshot) => [snapshot.id, snapshot]));
    const history: PrintHistoryEntry[] = (events ?? []).flatMap((e) => {
      const snapshot = byId.get(e.snapshot_id);
      return snapshot ? [{ id: e.id, at: e.created_at, version: snapshot.version, size: snapshot.size, mask: snapshot.mask_sender }] : [];
    });
    const logo = await readGeraiLogo(ws.tenant.id);
    const facts: LabelFacts = {
      reference: s.reference, awb: s.awb, courier: quote?.courier ?? null, service: quote?.service ?? null,
      weightGrams: s.weight_grams, isCod: s.is_cod, codAmountIdr: s.cod_amount_idr, itemDescription: s.item_description,
      recipient: {
        name: s.recipient_name, phone: s.recipient_phone, address: s.recipient_address,
        area: s.recipient_area, postalCode: s.recipient_postal_code,
      },
      geraiName: tenant.name, geraiLogo: logo?.logo ?? null, geraiWhatsapp: tenant.contact_whatsapp,
      pickupAddress: pickup.address ?? ws.outlet.pickupAddress, pickupArea: pickup.area ?? ws.outlet.pickupArea,
    };
    return (
      <div className="flex flex-col gap-6">
        <PrintHeader shipmentId={s.id} reference={s.reference} awb={s.awb} state={s.submission_state} title="Cetak label" current="label" tabs />
        <LabelWorkbench
          shipmentId={s.id}
          facts={facts}
          role={ws.role}
          maskingAllowed={tenant.masking_allowed}
          snapshots={snapshots}
          history={history}
          preferenceKey={`gx:label-choice:${ws.tenant.id}:${ws.userId}`}
          initialSender={senderFromShipment(s)}
        />
      </div>
    );
  }

  const { data: job } = await db.from("label_jobs").select("id").eq("tenant_id", ws.tenant.id)
    .eq("shipment_id", s.id).eq("state", "completed").limit(1).maybeSingle();
  if (!job || !s.awb) redirect(`/pengiriman/${s.id}`);

  return (
    <div className="flex flex-col gap-6">
      <PrintHeader shipmentId={s.id} reference={s.reference} awb={s.awb} state={s.submission_state} title="Label contoh" current="label" tabs={false} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,400px)_minmax(0,1fr)] lg:items-start print:block">
        <section aria-labelledby="demo-label-heading" className="flex flex-col gap-3 rounded-lg bg-card p-5 ring-1 ring-border print:hidden">
          <h2 id="demo-label-heading" className="text-[17px]">Mode demo</h2>
          <p className="text-sm text-muted-foreground">
            Ini label contoh dari mode demo. Pengiriman sungguhan mencetak label lokal dengan barcode resi dari GeraiExpress, dan invoice A4 di halaman Resi + invoice.
          </p>
          <PrintButton />
        </section>
        <div className="flex min-w-0 justify-center rounded-lg bg-foreground/5 p-3 sm:p-6 print:block print:rounded-none print:bg-transparent print:p-0">
          <article aria-label="Label contoh" className="relative w-full max-w-[420px] overflow-hidden rounded-lg border-2 border-foreground bg-card p-5 text-sm print:mx-0 print:rounded-none">
            <div aria-hidden="true" className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <span className="-rotate-30 text-3xl font-semibold tracking-widest text-foreground/15">CONTOH · SIMULASI</span>
            </div>
            <p className="mb-3 border-b border-foreground pb-2 text-center font-semibold">CONTOH — BUKAN LABEL KURIR</p>
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-semibold">{quote ? `${courierName(quote.courier)} ${quote.service}` : "—"}</span>
              <span className="tabular">{formatWeight(s.weight_grams)}</span>
            </div>
            <p className="my-3 text-center text-xl font-semibold tracking-wider tabular" data-testid="label-awb">{s.awb}</p>
            <div className="grid gap-3 border-y border-foreground py-3">
              <div>
                <p className="text-xs uppercase">Penerima</p>
                <p className="font-semibold">{s.recipient_name}</p>
                <p className="tabular">{s.recipient_phone}</p>
                <p>{[s.recipient_address, s.recipient_area, s.recipient_postal_code].filter(Boolean).join(", ")}</p>
              </div>
              <div>
                <p className="text-xs uppercase">Pengirim</p>
                <p className="font-semibold">{s.sender_name}</p>
                <p className="tabular">{s.sender_phone}</p>
              </div>
              <div>
                <p className="text-xs uppercase">Pickup</p>
                <p>{[pickup.outlet, pickup.area].filter(Boolean).join(", ")}</p>
              </div>
            </div>
            {s.is_cod ? (
              <p className="mt-3 rounded border-2 border-foreground px-2.5 py-1.5 font-semibold tabular" data-testid="label-cod">
                COD — Tagih ke penerima: {formatIdr(s.cod_amount_idr)}
              </p>
            ) : null}
            <div className="mt-3 flex justify-between gap-2">
              <span>{s.item_description}</span>
              <span className="tabular">Ongkir {formatIdr(s.customer_charge_idr)}</span>
            </div>
            <p className="mt-2 text-xs">Ref {s.reference} · {formatWib(s.issued_at)}</p>
          </article>
        </div>
      </div>
    </div>
  );
}
