import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { formatIdr, formatWeight, formatWib } from "@/lib/format";
import { supabaseServer } from "@/lib/supabase/server";
import { requireWorkspace } from "@/lib/workspace";
import { PrintButton } from "./print-button";

export const metadata: Metadata = { title: "Label" };

// Simulated label for demo shipments (UX-3). It is visibly watermarked and is not a courier
// label: real labels must come from the provider PDF capability (PR-6), not from this page.
export default async function LabelPage({ params }: { params: Promise<{ id: string }> }) {
  const ws = await requireWorkspace();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await supabaseServer();
  const { data: s } = await supabase.from("shipments")
    .select("id, reference, awb, is_simulated, sender_name, sender_phone, recipient_name, recipient_phone, recipient_address, recipient_area, recipient_postal_code, item_description, weight_grams, customer_charge_idr, pickup_snapshot, issued_at, selected_quote_id")
    .eq("tenant_id", ws.tenant.id).eq("id", id).maybeSingle();
  if (!s) notFound();
  const { data: job } = await supabase.from("label_jobs").select("id").eq("tenant_id", ws.tenant.id)
    .eq("shipment_id", s.id).eq("state", "completed").limit(1).maybeSingle();
  if (!job || !s.awb) redirect(`/pengiriman/${s.id}`);
  if (!s.is_simulated) redirect(`/pengiriman/${s.id}?galat=provider_label_required`);
  const { data: quote } = await supabase.from("shipment_quotes").select("courier, service")
    .eq("tenant_id", ws.tenant.id).eq("id", s.selected_quote_id).maybeSingle();
  const pickup = (s.pickup_snapshot ?? {}) as { outlet?: string; address?: string; area?: string };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href={`/pengiriman/${s.id}`} className="inline-flex min-h-11 items-center gap-2 text-primary">
          <ArrowLeft className="size-4" aria-hidden="true" /> Kembali ke {s.reference}
        </Link>
        <PrintButton />
      </div>
      <p className="max-w-[620px] text-sm text-muted-foreground print:hidden">
        Ini label contoh dari mode demo. Label kurir sungguhan berasal dari PDF Mengantar setelah akun gerai terhubung.
      </p>

      <article aria-label="Label contoh" className="relative mx-auto w-full max-w-[420px] overflow-hidden rounded-lg border-2 border-foreground bg-card p-5 text-sm print:mx-0 print:rounded-none">
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="-rotate-30 text-3xl font-semibold tracking-widest text-foreground/15">CONTOH · SIMULASI</span>
        </div>
        <p className="mb-3 border-b border-foreground pb-2 text-center font-semibold">CONTOH — BUKAN LABEL KURIR</p>
        <div className="flex items-baseline justify-between gap-2">
          <span className="font-semibold">{quote ? `${quote.courier} ${quote.service}` : "—"}</span>
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
        <div className="mt-3 flex justify-between gap-2">
          <span>{s.item_description}</span>
          <span className="tabular">Ongkir {formatIdr(s.customer_charge_idr)}</span>
        </div>
        <p className="mt-2 text-xs">Ref {s.reference} · {formatWib(s.issued_at)}</p>
      </article>
    </div>
  );
}
