import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
import { friendlyError } from "@/lib/errors";
import { formatIdr, formatWeight, formatWib } from "@/lib/format";
import { supabaseServer } from "@/lib/supabase/server";
import { requireWorkspace } from "@/lib/workspace";
import { reconcileAction, requestLabelAction } from "@/modules/shipments/actions";
import { DRAFT_FIELDS, type DraftValues } from "@/modules/shipments/draft";
import { IntakeForm, type ContactOption, type QuoteOption } from "@/modules/shipments/intake-form";

export const metadata: Metadata = { title: "Pengiriman" };

const EVENT_LABEL: Record<string, string> = {
  draft_created: "Draf dibuat",
  quoted: "Ongkir dicek",
  submitted: "Dikonfirmasi",
  issued: "Resi terbit",
  outcome_unknown: "Hasil belum pasti",
  reconciled: "Direkonsiliasi",
  label_ready: "Label siap",
};

export default async function ShipmentPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ galat?: string; terbit?: string; rekonsiliasi?: string }>;
}) {
  const ws = await requireWorkspace();
  const { id } = await params;
  const flags = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await supabaseServer();
  const { data: s } = await supabase.from("shipments").select("*").eq("tenant_id", ws.tenant.id).eq("id", id).maybeSingle();
  if (!s) notFound();

  const header = (
    <div className="flex flex-col gap-3">
      <Link href="/pengiriman" className="inline-flex min-h-11 items-center gap-2 self-start text-primary">
        <ArrowLeft className="size-4" aria-hidden="true" /> Semua pengiriman
      </Link>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-3xl tracking-tight tabular">{s.reference}</h1>
        <StatusBadge state={s.submission_state} />
      </div>
      {flags.galat ? (
        <p role="alert" className="rounded-md bg-card p-4 ring-1 ring-foreground"><span aria-hidden="true">⚠ </span>{friendlyError({ message: flags.galat })}</p>
      ) : null}
    </div>
  );

  if (s.submission_state === "draft" || s.submission_state === "estimated") {
    const [{ data: contacts }, { data: quotes }] = await Promise.all([
      supabase.from("contacts")
        .select("id, name, phone, is_sender, is_recipient, addresses:contact_addresses(id, label, address_line, area, postal_code, is_primary, archived_at)")
        .eq("tenant_id", ws.tenant.id).is("archived_at", null).order("name").limit(300),
      s.submission_state === "estimated"
        ? supabase.from("shipment_quotes").select("id, courier, service, normal_tariff_idr, eta_days, is_simulated")
            .eq("tenant_id", ws.tenant.id).eq("shipment_id", s.id).eq("shipment_revision", s.revision)
            .gt("expires_at", new Date().toISOString()).order("normal_tariff_idr")
        : Promise.resolve({ data: [] as QuoteOption[] }),
    ]);
    const initial = Object.fromEntries(DRAFT_FIELDS.map((f) => [f, s[f] == null ? "" : String(s[f])])) as DraftValues;
    const options: ContactOption[] = (contacts ?? []).map((c) => ({
      ...c,
      addresses: (c.addresses ?? [])
        .filter((a: { archived_at: string | null }) => !a.archived_at)
        .sort((a: { is_primary: boolean }, b: { is_primary: boolean }) => Number(b.is_primary) - Number(a.is_primary)),
    }));
    return (
      <div className="flex flex-col gap-6">
        {header}
        <IntakeForm
          shipmentId={s.id}
          reference={s.reference}
          revision={s.revision}
          initial={initial}
          senderContactId={s.sender_contact_id}
          recipientContactId={s.recipient_contact_id}
          outlet={ws.outlet}
          contacts={options}
          quotes={(quotes ?? []) as QuoteOption[]}
          idempotencyKey={crypto.randomUUID()}
        />
      </div>
    );
  }

  const [{ data: quote }, { data: events }, { data: label }] = await Promise.all([
    s.selected_quote_id
      ? supabase.from("shipment_quotes").select("courier, service, eta_days, is_simulated").eq("tenant_id", ws.tenant.id).eq("id", s.selected_quote_id).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase.from("shipment_events").select("id, kind, detail, created_at").eq("tenant_id", ws.tenant.id).eq("shipment_id", s.id).order("id"),
    supabase.from("label_jobs").select("id, state").eq("tenant_id", ws.tenant.id).eq("shipment_id", s.id).eq("state", "completed").limit(1).maybeSingle(),
  ]);
  const pickup = (s.pickup_snapshot ?? {}) as { outlet?: string; address?: string; area?: string };
  const facts: [string, React.ReactNode][] = [
    ["Resi", s.awb ? <span className="tabular font-semibold">{s.awb}{s.is_simulated ? " (simulasi)" : ""}</span> : "Belum terbit"],
    ["Layanan", quote ? `${quote.courier} ${quote.service} · ${quote.eta_days}` : "—"],
    ["Ongkir pelanggan", <span className="tabular" key="c">{formatIdr(s.customer_charge_idr)}</span>],
    ["Pengirim", `${s.sender_name ?? "—"} · ${s.sender_phone ?? "—"}`],
    ["Penerima", `${s.recipient_name ?? "—"} · ${s.recipient_phone ?? "—"}`],
    ["Alamat tujuan", [s.recipient_address, s.recipient_area, s.recipient_postal_code].filter(Boolean).join(", ") || "—"],
    ["Pickup", [pickup.outlet, pickup.address, pickup.area].filter(Boolean).join(", ") || "—"],
    ["Paket", `${s.item_description ?? "—"} · ${formatWeight(s.weight_grams)}`],
    ["Dikonfirmasi", formatWib(s.submitted_at)],
  ];

  return (
    <div className="flex flex-col gap-6">
      {header}
      {flags.terbit ? <p role="status" className="rounded-md bg-card p-4 ring-1 ring-border">Resi {s.is_simulated ? "simulasi " : ""}sudah terbit. Siapkan label untuk dicetak.</p> : null}
      {flags.rekonsiliasi ? <p role="status" className="rounded-md bg-card p-4 ring-1 ring-border">Operasi asli sudah direkonsiliasi. Tidak ada pesanan kedua yang dibuat.</p> : null}

      <section aria-labelledby="next-heading" className="flex flex-col gap-3 rounded-lg bg-card p-6 ring-1 ring-border">
        <h2 id="next-heading" className="text-xl">Langkah berikutnya</h2>
        {s.submission_state === "unknown" || s.submission_state === "queued" || s.submission_state === "in_flight" ? (
          <>
            <p>Hasil pengiriman ke kurir belum pasti. Jangan buat pengiriman baru untuk paket ini — periksa operasi aslinya terlebih dahulu.</p>
            <form action={reconcileAction}>
              <input type="hidden" name="shipment_id" value={s.id} />
              <Button type="submit">Periksa status operasi asli</Button>
            </form>
          </>
        ) : s.submission_state === "issued" ? (
          <div className="flex flex-wrap gap-3">
            {label ? (
              <Button asChild><Link href={`/pengiriman/${s.id}/label`}>Lihat & cetak label</Link></Button>
            ) : (
              <form action={requestLabelAction}>
                <input type="hidden" name="shipment_id" value={s.id} />
                <Button type="submit">Siapkan label</Button>
              </form>
            )}
          </div>
        ) : (
          <p>Pengiriman gagal. Periksa data lalu buat draf baru bila perlu.</p>
        )}
      </section>

      <section aria-labelledby="facts-heading" className="rounded-lg bg-card p-6 ring-1 ring-border">
        <h2 id="facts-heading" className="mb-4 text-xl">Detail yang dikirim</h2>
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-[200px_minmax(0,1fr)]">
          {facts.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-sm text-muted-foreground">{k}</dt>
              <dd className="break-words">{v}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 text-sm text-muted-foreground">Data ini dibekukan saat konfirmasi; perubahan kontak tidak mengubahnya.</p>
      </section>

      <section aria-labelledby="timeline-heading" className="rounded-lg bg-card p-6 ring-1 ring-border">
        <h2 id="timeline-heading" className="mb-4 text-xl">Riwayat</h2>
        <ol className="flex flex-col gap-3">
          {(events ?? []).map((e) => (
            <li key={e.id} className="flex flex-wrap justify-between gap-2 border-b border-border pb-3 last:border-0 last:pb-0">
              <span>
                <span className="font-semibold">{EVENT_LABEL[e.kind] ?? e.kind}</span>
                {e.detail ? <span className="block text-sm text-muted-foreground">{e.detail}</span> : null}
              </span>
              <time className="text-sm text-muted-foreground" dateTime={e.created_at}>{formatWib(e.created_at)}</time>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
