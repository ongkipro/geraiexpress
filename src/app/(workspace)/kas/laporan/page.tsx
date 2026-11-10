import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Download } from "lucide-react";
import { Notice } from "@/components/notice";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { dbServer } from "@/lib/db/server";
import { formatIdr, formatWib } from "@/lib/format";
import { requireWorkspace } from "@/lib/workspace";
import {
  PILOT_DEFINITIONS, PILOT_REPORT_ERRORS, PILOT_UNKNOWN, earningsKnown, maskedShareText, medianText, parsePilotRange,
  paymentMix, type PilotReportRow,
} from "@/modules/payments/pilot-report";
import { fetchPilotReport } from "@/modules/payments/pilot-report-data";

export const metadata: Metadata = { title: "Laporan pilot" };

const dayLabel = new Intl.DateTimeFormat("id-ID", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const dayText = (day: string) => dayLabel.format(new Date(`${day}T00:00:00Z`));

// UX-17 item 6 / PR-45: tenant administrators only. Operators get the workspace not-found page (the
// same answer as /anggota), and the database refuses them as well (admin_required).
export default async function PilotReportPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const ws = await requireWorkspace();
  if (ws.role !== "tenant_admin") notFound();
  const params = await searchParams;
  const range = parsePilotRange(params, new Date());
  const contoh = ws.isDemo ? " (contoh)" : "";
  const money = (value: number) => `${formatIdr(value)}${contoh}`;
  const earningsText = (row: PilotReportRow) => (earningsKnown(row) ? money(row.earnings_idr!) : PILOT_UNKNOWN);
  const unknownNote = (row: PilotReportRow) => row.earnings_unknown_count > 0
    ? <span className="block text-xs font-normal text-muted-foreground">{row.earnings_unknown_count} pengiriman biaya gerai belum diketahui</span> : null;
  const rowName = (row: PilotReportRow) => row.row_level === "total" ? "Total semua cabang"
    : row.row_level === "outlet" ? `Total ${row.outlet_name ?? "Cabang"}` : `${row.outlet_name ?? "Cabang"} · ${dayText(row.day!)}`;
  const rowKey = (row: PilotReportRow) => `${row.row_level}-${row.outlet_id ?? "all"}-${row.day ?? "all"}`;
  const csvHref = `/kas/laporan/export.csv?${new URLSearchParams({ from: range.from, to: range.to })}`;

  let content: React.ReactNode;
  if (range.error) {
    content = <Notice tone="danger">{range.error}</Notice>;
  } else {
    const db = await dbServer();
    const result = await fetchPilotReport(db, ws.tenant.id, range.from, range.to);
    if (!result.ok) {
      content = <Notice tone="danger" data-testid="load-error">{PILOT_REPORT_ERRORS[result.code] ?? (result.code === "too_large" || result.code === "unsupported" ? result.message : "Laporan pilot belum bisa dimuat. Muat ulang halaman; jika berulang, hubungi admin GeraiExpress.")}</Notice>;
    } else {
      const rows = result.rows;
      const total = rows.find((r) => r.row_level === "total");
      const dataAt = rows[0]?.data_at ?? null;
      content = rows.length === 0 || !total || total.shipments_issued + total.cash_count + total.qris_count + total.transfer_count + total.other_count === 0
        ? <p className="text-muted-foreground" data-testid="pilot-empty">Belum ada resi terbit atau pembayaran kasir pada periode ini.</p>
        : <>
          <p className="text-sm text-muted-foreground" data-testid="pilot-data-at">Periode {range.from} s.d. {range.to} (WIB) · Data per {formatWib(dataAt)}</p>
          {/* UI-7: below 768 px every row is a record card (same rows, same formatters); the table from md up. */}
          <ul className="flex flex-col gap-3 lg:hidden" data-testid="pilot-cards" aria-label="Laporan pilot per cabang dan hari WIB, dengan total">
            {rows.map((row) => (
              <li key={rowKey(row)} data-testid={`pilot-card-${row.row_level}`}
                className={row.row_level === "day" ? "rounded-lg bg-card p-4 ring-1 ring-border"
                  : row.row_level === "outlet" ? "rounded-lg bg-muted/40 p-4 ring-1 ring-border"
                  : "rounded-lg bg-info-soft p-4 ring-2 ring-primary/40"}>
                <h3 className="text-base font-semibold break-words">{rowName(row)}</h3>
                {row.row_level !== "day" ? <p className="text-sm text-muted-foreground">{row.row_level === "outlet" ? "Total cabang untuk periode ini" : "Total semua cabang untuk periode ini"}</p> : null}
                <dl className="mt-3 grid grid-cols-1 gap-2 text-sm">
                  <div className="flex flex-wrap justify-between gap-x-3"><dt className="text-muted-foreground">Resi terbit</dt><dd className="tabular">{row.shipments_issued}</dd></div>
                  <div className="flex flex-wrap justify-between gap-x-3"><dt className="text-muted-foreground">Median draf ke resi</dt><dd className="tabular">{medianText(row.median_draft_to_resi_minutes)}</dd></div>
                  <div className="flex flex-col gap-1"><dt className="text-muted-foreground">Cara bayar (jumlah · nilai)</dt>
                    <dd><ul className="flex flex-col gap-0.5">{paymentMix(row).map((m) => <li key={m.method} className="tabular break-words">{m.label}: {m.count} · {money(m.amount)}</li>)}</ul></dd>
                  </div>
                  <div className="flex flex-wrap justify-between gap-x-3"><dt className="text-muted-foreground">Label masking</dt><dd className="tabular">{maskedShareText(row)}</dd></div>
                  <div className="flex flex-wrap justify-between gap-x-3"><dt className="text-muted-foreground">Pendapatan (estimasi)</dt>
                    <dd className="tabular text-right" data-testid="pilot-card-earnings">{earningsText(row)}{unknownNote(row)}</dd>
                  </div>
                </dl>
              </li>
            ))}
          </ul>
          <div className="relative hidden w-full overflow-x-auto rounded-lg ring-1 ring-border lg:block">
            <table className="w-full min-w-[720px] text-sm" data-testid="pilot-table">
              <caption className="sr-only">Laporan pilot per cabang dan hari WIB, dengan total</caption>
              <thead className="bg-muted/50 text-left">
                <tr>
                  <th scope="col" className="px-3 py-2">Cabang / hari</th>
                  <th scope="col" className="px-3 py-2 text-right">Resi terbit</th>
                  <th scope="col" className="px-3 py-2 text-right">Median draf ke resi</th>
                  <th scope="col" className="px-3 py-2">Cara bayar (jumlah · nilai)</th>
                  <th scope="col" className="px-3 py-2 text-right">Label masking</th>
                  <th scope="col" className="px-3 py-2 text-right">Pendapatan (estimasi)</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={rowKey(row)} data-testid={`pilot-row-${row.row_level}`}
                    className={row.row_level !== "day" ? "border-t bg-muted/30 font-semibold" : "border-t"}>
                    <th scope="row" className="px-3 py-2 text-left font-[inherit] break-words">{rowName(row)}</th>
                    <td className="tabular px-3 py-2 text-right">{row.shipments_issued}</td>
                    <td className="tabular px-3 py-2 text-right">{medianText(row.median_draft_to_resi_minutes)}</td>
                    <td className="px-3 py-2">
                      <ul className="flex flex-col gap-0.5">
                        {paymentMix(row).map((m) => <li key={m.method} className="tabular">{m.label}: {m.count} · {money(m.amount)}</li>)}
                      </ul>
                    </td>
                    <td className="tabular px-3 py-2 text-right">{maskedShareText(row)}</td>
                    <td className="tabular px-3 py-2 text-right" data-testid="pilot-earnings">{earningsText(row)}{unknownNote(row)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>;
    }
  }

  return (
    <div className="flex flex-col gap-6 lg:gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl tracking-tight">Laporan pilot</h1>
        <p className="text-muted-foreground">Ukuran pilot per cabang dan hari WIB untuk {ws.tenant.name}. Hanya terlihat oleh admin gerai. Ini ukuran evaluasi, bukan janji pendapatan.</p>
        {ws.isDemo ? <p className="text-sm text-muted-foreground">Mode demo: angka dihitung dari pengiriman contoh; semua nilai merupakan contoh.</p> : null}
      </header>
      <form method="get" className="flex flex-wrap items-end gap-3" aria-label="Periode laporan">
        <div className="flex min-w-0 flex-col gap-2"><Label htmlFor="from">Dari (WIB)</Label><Input id="from" name="from" type="date" defaultValue={range.from} /></div>
        <div className="flex min-w-0 flex-col gap-2"><Label htmlFor="to">Sampai (WIB)</Label><Input id="to" name="to" type="date" defaultValue={range.to} /></div>
        <Button type="submit" variant="outline">Terapkan</Button>
        {ws.isDemo || range.error ? null : (
          <Button asChild><a href={csvHref} download><Download aria-hidden="true" /> Unduh CSV</a></Button>
        )}
      </form>
      <p className="text-sm text-muted-foreground">Paling panjang 92 hari. {ws.isDemo ? "Unduh CSV tidak tersedia di demo." : null}</p>
      {content}
      <section aria-labelledby="pilot-definitions" className="flex flex-col gap-2">
        <h2 id="pilot-definitions" className="text-xl">Definisi ukuran</h2>
        <dl className="flex flex-col gap-2 text-sm">
          {PILOT_DEFINITIONS.map((d) => <div key={d.measure}><dt className="font-semibold">{d.measure}</dt><dd className="text-muted-foreground">{d.definition}</dd></div>)}
        </dl>
      </section>
    </div>
  );
}
