"use client";

import { ReceiptText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { courierName, etaLabel, formatIdr } from "@/lib/format";
import type { DraftValues } from "./draft";
import type { QuoteOption } from "./intake-form";
import { handoverSummary } from "./pickup-fields";

// Money of one quote as the counter shows it (UX-5): the normal tariff and the COD fee each appear
// once, and the customer charge is their sum unless the quote carries its own figure.
export function quoteCharge(q: QuoteOption) {
  const codFee = q.cod_fee_idr ?? 0;
  return { normal: q.normal_tariff_idr, codFee, total: q.customer_charge_idr ?? q.normal_tariff_idr + codFee };
}

export const goodsValueOf = (v: Pick<DraftValues, "goods_value_idr">) => Number((v.goods_value_idr || "0").replace(/\./g, "")) || 0;

export const serviceName = (q: QuoteOption) => `${courierName(q.courier)} ${q.service}`;

// "current": quotes match the saved draft and one is selected; "stale": the form changed since the
// quote; "none": no valid quote yet (never checked, or expired).
export type QuoteStatus = "none" | "stale" | "current";

type SummaryProps = { values: DraftValues; quote: QuoteOption | null; status: QuoteStatus };

function Row({ term, children, strong = false }: { term: string; children: React.ReactNode; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className={strong ? "font-semibold" : "text-sm text-muted-foreground"}>{term}</dt>
      <dd className={strong ? "tabular text-right font-semibold" : "tabular text-right"}>{children}</dd>
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <p className="text-sm text-muted-foreground">{title}</p>
      {children}
    </div>
  );
}

// C4 summary: who receives it, what is sent, which service, and what the counter charges. Shown in
// the sticky rail (>= 1280) and in the "Rincian" sheet (< 1280).
export function IntakeSummary({ values, quote, status }: SummaryProps) {
  const isCod = values.is_cod === "true";
  const charge = quote && status === "current" ? quoteCharge(quote) : null;
  const goods = goodsValueOf(values);
  const parcel = [values.item_description, values.weight_grams ? `${values.weight_grams} g` : ""].filter(Boolean).join(" · ");
  return (
    <div className="flex flex-col gap-5">
      <Group title="Penerima">
        <p className="break-words font-semibold">{values.recipient_name || "Belum diisi"}</p>
        <p className="break-words text-sm text-muted-foreground">
          {[values.recipient_area, values.recipient_postal_code].filter(Boolean).join(", ") || "Wilayah belum diisi"}
        </p>
      </Group>
      <Group title="Paket">
        <p className="break-words">{parcel || "Belum diisi"}</p>
        <p className="text-sm text-muted-foreground">{handoverSummary(values)}</p>
      </Group>
      <Group title="Layanan">
        {charge && quote ? (
          <>
            <p className="font-semibold">{serviceName(quote)}</p>
            <p className="text-sm text-muted-foreground">
              {etaLabel(quote.eta_days)}{quote.is_simulated ? " · harga contoh (simulasi)" : ""}
            </p>
          </>
        ) : (
          <p className="text-muted-foreground">{status === "stale" ? "Data berubah: cek ongkir ulang" : "Belum dicek"}</p>
        )}
      </Group>
      <Separator />
      <dl className="flex flex-col gap-2">
        {charge ? (
          <>
            <Row term="Ongkir (tarif normal)">{formatIdr(charge.normal)}</Row>
            {isCod ? <Row term="Biaya COD">{formatIdr(charge.codFee)}</Row> : null}
          </>
        ) : null}
        <div className="flex items-baseline justify-between gap-4 pt-1">
          <dt className="font-semibold">Total ongkir</dt>
          {charge ? (
            <dd className="tabular text-right text-3xl font-semibold tracking-tight">{formatIdr(charge.total)}</dd>
          ) : (
            <dd className="text-right text-muted-foreground">{status === "stale" ? "Cek ulang" : "Belum dicek"}</dd>
          )}
        </div>
      </dl>
      {isCod ? (
        <dl className="flex flex-col gap-2 rounded-md bg-muted p-4">
          <Row term="Nilai barang">{formatIdr(goods)}</Row>
          <Row term="Ditagih kurir ke penerima" strong>{charge ? formatIdr(goods + charge.total) : "—"}</Row>
          <p className="text-sm text-muted-foreground">COD: kurir menagih nilai barang + ongkir saat paket tiba.</p>
        </dl>
      ) : null}
    </div>
  );
}

// < 1280: the total stays in reach at the bottom of the screen; "Rincian" opens the same summary.
export function SummaryBar(props: SummaryProps) {
  const charge = props.quote && props.status === "current" ? quoteCharge(props.quote) : null;
  const isCod = props.values.is_cod === "true";
  return (
    <div
      role="region"
      aria-label="Ringkasan biaya"
      className="sticky bottom-0 z-20 -mx-4 -mb-6 flex items-center justify-between gap-3 border-t border-border bg-card px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:-mx-8 lg:-mb-8 lg:px-8 xl:hidden"
    >
      <div className="flex min-w-0 flex-col">
        <span className="text-sm text-muted-foreground">{isCod ? "Total ongkir · COD" : "Total ongkir"}</span>
        <span className="tabular truncate text-xl font-semibold">
          {charge ? formatIdr(charge.total) : props.status === "stale" ? "Cek ulang" : "Belum dicek"}
        </span>
      </div>
      <Sheet>
        <SheetTrigger asChild>
          <Button type="button" variant="outline" size="sm">
            <ReceiptText aria-hidden="true" />
            Rincian
          </Button>
        </SheetTrigger>
        <SheetContent side="bottom" className="max-h-[85dvh] overflow-y-auto rounded-t-lg">
          <SheetHeader className="pb-0">
            <SheetTitle>Rincian pengiriman</SheetTitle>
            <SheetDescription>Ringkasan isian dan ongkir yang akan ditagih.</SheetDescription>
          </SheetHeader>
          <div className="px-6 pt-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
            <IntakeSummary {...props} />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
