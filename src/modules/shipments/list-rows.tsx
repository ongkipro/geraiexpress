"use client";

import Link from "next/link";
import { Printer } from "lucide-react";
import { useState, useEffect } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/status-badge";
import { courierName, formatIdr, formatWibShort } from "@/lib/format";
import { CaseBadge, caseMark } from "@/modules/cases/case-badge";

export type ShipmentRow = {
  id: string;
  reference: string;
  submission_state: string;
  recipient_name: string | null;
  recipient_area: string | null;
  awb: string | null;
  customer_charge_idr: number | null;
  is_cod: boolean;
  updated_at: string;
  is_simulated: boolean;
  quote: { courier: string; service: string } | null;
  // T-086: provider delivery dimension and the non-closed case (at most one per shipment).
  delivery_state?: string | null;
  cases?: { case_type: string; state: string }[] | null;
};

const rowMark = (s: ShipmentRow) => caseMark(s.delivery_state, s.cases?.find((c) => c.state !== "closed")?.case_type ?? null);

// Resi + invoice (T-047) is offered for a real issued shipment with an AWB only, like the label.
const printable = (s: ShipmentRow) => !s.is_simulated && s.submission_state === "issued" && Boolean(s.awb);
const service = (s: ShipmentRow) => (s.quote ? `${courierName(s.quote.courier)} ${s.quote.service}` : null);

function CodBadge() {
  return <Badge variant="neutral" className="h-6 px-2 text-xs font-semibold">COD</Badge>;
}

// One row action, kept as the existing link to the resi + invoice print surface.
function PrintLink({ s, className }: { s: ShipmentRow; className?: string }) {
  return (
    <Link href={`/pengiriman/${s.id}/invoice`} prefetch={false} className={className}>
      <Printer className="size-4" aria-hidden="true" />
      Cetak resi<span className="sr-only"> + invoice {s.reference}</span>
    </Link>
  );
}

// C3: table on >=768 (>=48px two-line rows, right-aligned tabular money) and 4-line record cards
// below. Row links skip prefetch: each would render a dynamic page on the server.
export function ShipmentRows({ rows }: { rows: ShipmentRow[] }) {
  const eligible = rows.filter(printable);
  const [selected, setSelected] = useState<string[]>([]);
  const all = eligible.length > 0 && selected.length === eligible.length;
  const toggle = (id: string, checked: boolean) => setSelected((current) => checked ? [...current, id] : current.filter((item) => item !== id));
  useEffect(() => {
    if (!selected.length) return;
    const previous = document.documentElement.style.scrollPaddingBottom;
    document.documentElement.style.scrollPaddingBottom = "10rem";
    return () => { document.documentElement.style.scrollPaddingBottom = previous; };
  }, [selected.length]);
  return (
    <>
      {eligible.length > 0 ? <label className="flex min-h-11 items-center gap-3 md:hidden"><Checkbox checked={all ? true : selected.length ? "indeterminate" : false} onCheckedChange={(checked) => setSelected(checked === true ? eligible.map((s) => s.id) : [])} />Pilih semua di halaman ini</label> : null}
      <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-lg bg-card ring-1 ring-border md:hidden">
        {rows.map((s) => (
          <li key={s.id}>
            {printable(s) ? <label className="flex min-h-11 items-center gap-3 px-4 pt-2"><Checkbox checked={selected.includes(s.id)} onCheckedChange={(checked) => toggle(s.id, checked === true)} />Pilih {s.reference}</label> : null}
            <Link href={`/pengiriman/${s.id}`} prefetch={false} className="flex flex-col gap-1.5 px-4 pt-4 pb-3 active:bg-muted">
              <span className="flex items-start justify-between gap-3">
                {/* The reference is the record's identity: it wraps rather than truncating at 320 px (WCAG 1.4.10). */}
                <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="font-semibold tabular [overflow-wrap:anywhere]" data-testid="shipment-ref">{s.reference}</span>
                  {s.is_cod ? <CodBadge /> : null}
                </span>
                <span className="flex shrink-0 flex-wrap justify-end gap-1"><StatusBadge state={s.submission_state} /><CaseBadge mark={rowMark(s)} /></span>
              </span>
              <span className="truncate text-[15px]">
                {s.recipient_name ?? "Penerima belum diisi"}
                {s.recipient_area ? <span className="text-muted-foreground"> · {s.recipient_area}</span> : null}
              </span>
              <span className="truncate text-sm text-muted-foreground">
                {service(s) ?? "Kurir belum dipilih"} · <span className="tabular">{s.awb ?? "belum ada resi"}</span>
              </span>
              <span className="flex items-baseline justify-between gap-3 text-sm">
                <span className="font-semibold tabular text-[15px]">{formatIdr(s.customer_charge_idr)}</span>
                <span className="tabular text-muted-foreground">{formatWibShort(s.updated_at)} WIB</span>
              </span>
            </Link>
            {printable(s) ? (
              <PrintLink s={s} className="mx-4 mb-2 inline-flex min-h-11 items-center gap-2 text-[15px] font-semibold text-primary" />
            ) : null}
          </li>
        ))}
      </ul>

      <div role="region" aria-label="Tabel pengiriman" tabIndex={0} className="hidden overflow-hidden rounded-lg bg-card ring-1 ring-border md:block">
        <Table className="text-[15px]">
          <TableCaption className="sr-only">Pengiriman, terbaru di atas</TableCaption>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead scope="col" className="w-12"><span className="sr-only">Pilih</span>{eligible.length > 0 ? <label className="flex min-h-11 min-w-11 items-center"><Checkbox aria-label="Pilih semua di halaman ini" checked={all ? true : selected.length ? "indeterminate" : false} onCheckedChange={(checked) => setSelected(checked === true ? eligible.map((s) => s.id) : [])} /></label> : null}</TableHead>
              <TableHead scope="col" className="pl-4">Referensi</TableHead>
              <TableHead scope="col">Penerima</TableHead>
              <TableHead scope="col">Status</TableHead>
              <TableHead scope="col" className="hidden lg:table-cell">Kurir · resi</TableHead>
              <TableHead scope="col" className="text-right">Ongkir</TableHead>
              <TableHead scope="col" className="pr-4"><span className="sr-only">Aksi</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((s) => (
              <TableRow key={s.id} className="border-border">
                <TableCell>{printable(s) ? <label data-testid="row-select" className="flex min-h-11 min-w-11 cursor-pointer items-center"><Checkbox aria-label={`Pilih ${s.reference}`} checked={selected.includes(s.id)} onCheckedChange={(checked) => toggle(s.id, checked === true)} /></label> : null}</TableCell>
                <TableCell className="pl-4 whitespace-nowrap">
                  <span className="flex items-center gap-2">
                    <Link href={`/pengiriman/${s.id}`} prefetch={false} className="inline-flex min-h-11 items-center font-semibold text-primary tabular hover:underline" data-testid="shipment-ref">
                      {s.reference}
                    </Link>
                    {s.is_cod ? <CodBadge /> : null}
                  </span>
                  <span className="-mt-2 block text-sm text-muted-foreground tabular">{formatWibShort(s.updated_at)} WIB</span>
                </TableCell>
                <TableCell className="max-w-[240px]">
                  <span className="block truncate">{s.recipient_name ?? "—"}</span>
                  <span className="block truncate text-sm text-muted-foreground">{s.recipient_area ?? "Alamat belum diisi"}</span>
                </TableCell>
                <TableCell><span className="flex flex-wrap gap-1"><StatusBadge state={s.submission_state} /><CaseBadge mark={rowMark(s)} /></span></TableCell>
                <TableCell className="hidden max-w-[200px] lg:table-cell">
                  <span className="block truncate">{service(s) ?? "—"}</span>
                  <span className="block truncate text-sm text-muted-foreground tabular">{s.awb ?? "Belum ada resi"}</span>
                </TableCell>
                <TableCell className="text-right whitespace-nowrap tabular">{formatIdr(s.customer_charge_idr)}</TableCell>
                <TableCell className="pr-4 text-right whitespace-nowrap">
                  {printable(s) ? (
                    <PrintLink s={s} className="inline-flex min-h-11 items-center gap-2 rounded-sm px-2 font-semibold text-primary hover:bg-accent" />
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {selected.length > 0 ? <div className="sticky bottom-0 z-20 flex flex-wrap items-center justify-between gap-2 border border-border bg-card p-3 print:hidden" role="region" aria-label="Tindakan pilihan">
        <span className="tabular">{selected.length} dipilih di halaman ini</span>
        <div className="flex flex-wrap gap-2"><Button variant="ghost" onClick={() => setSelected([])}>Batal pilih</Button><Button asChild><Link href={`/pengiriman/cetak?ids=${selected.join(",")}`}>Cetak label ({selected.length})</Link></Button></div>
      </div> : null}
    </>
  );
}
