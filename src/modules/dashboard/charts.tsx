import Link from "next/link";
import { StatusBadge } from "@/components/status-badge";
import { SUBMISSION_LABEL } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PERIOD_OPTIONS, periodHref, type CourierShare, type DashboardSummary, type DayBar, type PeriodDays, type StatusShare } from "./aggregate";

// UX-16 (5): server-rendered SVG/CSS charts, no chart library and no client JavaScript. Every chart has an
// `aria-label` summary, value labels or a legend with counts (never colour alone) and a data table.

const dayNumber = new Intl.DateTimeFormat("id-ID", { day: "numeric", timeZone: "UTC" });
const weekday = new Intl.DateTimeFormat("id-ID", { weekday: "short", timeZone: "UTC" });
const dayMonth = new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", timeZone: "UTC" });
const fullDay = new Intl.DateTimeFormat("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const asDate = (day: string) => new Date(`${day}T00:00:00Z`);
export const formatDay = (day: string) => dayMonth.format(asDate(day));
const n = (v: number) => v.toLocaleString("id-ID");

// The axis top: a round number at or above the busiest day, split in two steps (1, 2, 5 × 10^k).
export function niceTop(max: number): number {
  if (max <= 0) return 0;
  const half = max / 2;
  const p = 10 ** Math.floor(Math.log10(half));
  const step = [1, 2, 5, 10].map((m) => m * p).find((s) => s >= half)!;
  return Math.max(1, Math.ceil(step)) * 2;
}

// Segmented period control as links: the choice lives in the URL (`?hari=`), so it survives reload and sharing.
export function PeriodControl({ current }: { current: PeriodDays }) {
  return (
    <nav aria-label="Periode" className="inline-flex shrink-0 rounded-full bg-muted p-1">
      {PERIOD_OPTIONS.map((days) => (
        <Link
          key={days}
          href={periodHref(days)}
          prefetch={false}
          scroll={false}
          aria-current={days === current ? "true" : undefined}
          className={cn(
            "inline-flex min-h-11 items-center rounded-full px-4 text-[15px] transition-colors tabular",
            days === current ? "bg-card font-semibold shadow-xs ring-1 ring-border" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {days} hari
        </Link>
      ))}
    </nav>
  );
}

function trendSummary(s: DashboardSummary): string {
  const range = `${formatDay(s.window.days[0])} sampai ${formatDay(s.window.today)}`;
  if (s.total === 0) return `Tren ${s.periodDays} hari (${range}): belum ada pengiriman.`;
  return `Tren ${s.periodDays} hari (${range}): ${n(s.total)} pengiriman, ${n(s.issued)} resi terbit. `
    + `Tersibuk ${formatDay(s.peak!.day)} dengan ${n(s.peak!.total)}.`;
}

// Stacked daily bars: issued (solid) under every other state (outlined), one column per WIB day.
export function TrendChart({ summary }: { summary: DashboardSummary }) {
  const { daily } = summary;
  const count = daily.length;
  const top = niceTop(Math.max(0, ...daily.map((d) => d.total)));
  const columns = { gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))` };
  // Value labels need ~16 px per column: every width for 7 and 14 days, from 1024 px for 30.
  const valueLabel = count === 30 ? "hidden lg:block" : "block";
  const axisLabel = (i: number) => {
    if (count === 7 || i === count - 1) return "block";
    if (count === 14) return i % 2 === 0 ? "block" : "hidden md:block";
    return i % 5 === 0 ? "block" : i % 2 === 0 ? "hidden lg:block" : "hidden";
  };
  const label = trendSummary(summary);

  return (
    <figure className="flex flex-col gap-3" data-testid="trend-chart">
      <div className="flex gap-2">
        <div aria-hidden="true" className="relative w-7 shrink-0 pt-5 text-right text-xs text-muted-foreground tabular">
          <div className="relative h-44">
            {top > 0 ? <span className="absolute top-0 right-0 -translate-y-1/2">{n(top)}</span> : null}
            {top > 0 ? <span className="absolute top-1/2 right-0 -translate-y-1/2">{n(top / 2)}</span> : null}
            <span className="absolute right-0 bottom-0 translate-y-1/2">0</span>
          </div>
        </div>
        <div className="relative min-w-0 flex-1 pt-5">
          <div className="relative h-44">
            {top > 0 ? <div aria-hidden="true" className="absolute inset-x-0 top-0 border-t border-dashed border-border" /> : null}
            {top > 0 ? <div aria-hidden="true" className="absolute inset-x-0 top-1/2 border-t border-dashed border-border" /> : null}
            <div aria-hidden="true" className="absolute inset-x-0 bottom-0 border-t border-input" />
            <div role="img" aria-label={label} className="absolute inset-0 grid" style={columns}>
              {daily.map((d, i) => {
                const pct = top > 0 ? (d.total / top) * 100 : 0;
                return (
                  <div key={d.day} className="relative h-full">
                    {d.total > 0 ? (
                      <svg
                        aria-hidden="true"
                        viewBox={`0 0 10 ${d.total}`}
                        preserveAspectRatio="none"
                        className="absolute bottom-0 left-1/2 w-[64%] max-w-9 -translate-x-1/2 overflow-visible"
                        style={{ height: `${pct}%` }}
                      >
                        {d.other > 0 ? (
                          <rect x="0" y="0" width="10" height={d.other} className="fill-muted stroke-input" strokeWidth="1.25" vectorEffect="non-scaling-stroke" />
                        ) : null}
                        {d.issued > 0 ? <rect x="0" y={d.other} width="10" height={d.issued} className="fill-success" /> : null}
                      </svg>
                    ) : null}
                    <span
                      aria-hidden="true"
                      className={cn("absolute left-1/2 -translate-x-1/2 text-xs whitespace-nowrap tabular", d.total > 0 ? "font-semibold text-foreground" : "text-muted-foreground", valueLabel)}
                      style={{ bottom: `calc(${pct}% + 4px)` }}
                    >
                      {n(d.total)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
          <div aria-hidden="true" className="mt-2 grid text-center text-xs text-muted-foreground tabular" style={columns}>
            {daily.map((d, i) => (
              <span key={d.day} className={cn("whitespace-nowrap", axisLabel(i), d.day === summary.window.today && "font-semibold text-foreground")}>
                {count === 7 ? <><span className="block">{weekday.format(asDate(d.day))}</span>{dayNumber.format(asDate(d.day))}</> : dayNumber.format(asDate(d.day))}
              </span>
            ))}
          </div>
        </div>
      </div>
      <figcaption className="flex flex-col gap-2 text-sm text-muted-foreground">
        <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="size-3 rounded-[3px] bg-success" />Resi terbit</span>
          <span className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="size-3 rounded-[3px] bg-muted ring-1 ring-input ring-inset" />Status lain</span>
          <span>Tanggal dalam WIB, menurut status sekarang.</span>
        </span>
        <span data-testid="trend-summary">{label}</span>
      </figcaption>
      <TrendTable daily={daily} today={summary.window.today} />
    </figure>
  );
}

function TrendTable({ daily, today }: { daily: DayBar[]; today: string }) {
  const sum = (key: "issued" | "other" | "total") => daily.reduce((a, d) => a + d[key], 0);
  return (
    <details className="group text-sm">
      <summary className="inline-flex min-h-11 cursor-pointer items-center gap-1 text-[15px] text-primary">Lihat tabel data harian</summary>
      <div className="mt-2 overflow-x-auto rounded-md ring-1 ring-border">
        <table className="w-full text-left text-sm" data-testid="trend-table">
          <caption className="sr-only">Pengiriman per hari (WIB)</caption>
          <thead className="bg-muted text-muted-foreground">
            <tr>
              <th scope="col" className="px-3 py-2 font-normal">Tanggal</th>
              <th scope="col" className="px-3 py-2 text-right font-normal">Resi terbit</th>
              <th scope="col" className="px-3 py-2 text-right font-normal">Status lain</th>
              <th scope="col" className="px-3 py-2 text-right font-normal">Jumlah</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {daily.map((d) => (
              <tr key={d.day}>
                <th scope="row" className="px-3 py-2 font-normal whitespace-nowrap">{fullDay.format(asDate(d.day))}{d.day === today ? " (hari ini)" : ""}</th>
                <td className="px-3 py-2 text-right tabular">{n(d.issued)}</td>
                <td className="px-3 py-2 text-right tabular">{n(d.other)}</td>
                <td className="px-3 py-2 text-right tabular">{n(d.total)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t border-border font-semibold">
            <tr>
              <th scope="row" className="px-3 py-2 text-left">Total</th>
              <td className="px-3 py-2 text-right tabular">{n(sum("issued"))}</td>
              <td className="px-3 py-2 text-right tabular">{n(sum("other"))}</td>
              <td className="px-3 py-2 text-right tabular" data-testid="trend-table-total">{n(sum("total"))}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </details>
  );
}

// Solid segment tones (white share labels reach >= 4.5:1 on each); the legend repeats each state with
// its icon, label, count and share.
const SEGMENT: Record<string, string> = {
  issued: "bg-success",
  awaiting_payment: "bg-warning",
  in_flight: "bg-pending",
  queued: "bg-info",
  unknown: "bg-[#9a5b00]",
  failed: "bg-danger",
  estimated: "bg-[#2f6aa8]",
  draft: "bg-[#636366]",
};

export function StatusComposition({ statuses, total, listHref }: { statuses: StatusShare[]; total: number; listHref: (status?: string) => string }) {
  if (total === 0) return <p className="text-[15px] text-muted-foreground">Belum ada pengiriman pada periode ini.</p>;
  const label = `Komposisi status dari ${n(total)} pengiriman: ${statuses.map((s) => `${SUBMISSION_LABEL[s.state] ?? s.state} ${n(s.count)} (${s.share}%)`).join(", ")}.`;
  return (
    <div className="flex flex-col gap-3">
      <div role="img" aria-label={label} className="flex h-8 w-full gap-0.5 overflow-hidden rounded-md" data-testid="status-bar">
        {statuses.map((s) => (
          <span
            key={s.state}
            className={cn("flex min-w-1 items-center justify-center overflow-hidden text-xs font-semibold text-white tabular", SEGMENT[s.state] ?? "bg-[#636366]")}
            style={{ flexGrow: s.count, flexBasis: 0 }}
          >
            {s.share >= 9 ? `${s.share}%` : null}
          </span>
        ))}
      </div>
      <ul className="flex flex-col divide-y divide-border" data-testid="status-legend">
        {statuses.map((s) => (
          <li key={s.state}>
            <Link href={listHref(s.state)} prefetch={false} className="-mx-2 flex min-h-11 items-center justify-between gap-3 rounded-sm px-2 transition-colors hover:bg-muted">
              <span className="flex min-w-0 items-center gap-2.5">
                <span aria-hidden="true" className={cn("size-2.5 shrink-0 rounded-full", SEGMENT[s.state] ?? "bg-[#636366]")} />
                <StatusBadge state={s.state} />
              </span>
              <span className="flex shrink-0 items-baseline gap-2 tabular">
                <span className="font-semibold" data-testid="status-count">{n(s.count)}</span>
                <span className="w-10 text-right text-sm text-muted-foreground">{s.share}%</span>
              </span>
            </Link>
          </li>
        ))}
        <li className="flex min-h-11 items-center justify-between gap-3 text-[15px]">
          <span className="text-muted-foreground">Total</span>
          <span className="flex items-baseline gap-2 tabular">
            <span className="font-semibold" data-testid="status-total">{n(total)}</span>
            <span className="w-10 text-right text-sm text-muted-foreground">100%</span>
          </span>
        </li>
      </ul>
    </div>
  );
}

export function CourierRanking({ couriers, total }: { couriers: CourierShare[]; total: number }) {
  if (total === 0) return <p className="text-[15px] text-muted-foreground">Belum ada pengiriman pada periode ini.</p>;
  const max = Math.max(...couriers.map((c) => c.count));
  let rank = 0;
  return (
    <div className="flex flex-col">
      <ol aria-label={`Peringkat kurir dari ${n(total)} pengiriman`} className="flex flex-col divide-y divide-border" data-testid="courier-ranking">
        {couriers.map((c) => {
          if (c.code !== null) rank += 1;
          return (
            <li key={c.code ?? "none"} className="grid grid-cols-[1.75rem_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1.5 py-2.5">
              <span className="text-sm text-muted-foreground tabular" aria-hidden="true">{c.code === null ? "–" : rank}</span>
              <span className={cn("truncate", c.code === null ? "text-muted-foreground" : "font-medium")}>{c.name}</span>
              <span className="flex items-baseline gap-2 tabular">
                <span className="font-semibold" data-testid="courier-count">{n(c.count)}</span>
                <span className="w-10 text-right text-sm text-muted-foreground">{c.share}%</span>
              </span>
              <span aria-hidden="true" className="col-start-2 col-end-4 h-2 overflow-hidden rounded-full bg-muted">
                <span
                  className={cn("block h-full rounded-full", c.code === null ? "bg-card ring-1 ring-input ring-inset" : "bg-primary")}
                  style={{ width: `${(c.count / max) * 100}%` }}
                />
              </span>
            </li>
          );
        })}
      </ol>
      <p className="flex min-h-11 items-center justify-between gap-3 border-t border-border text-[15px]">
        <span className="text-muted-foreground">Total</span>
        <span className="flex items-baseline gap-2 tabular">
          <span className="font-semibold" data-testid="courier-total">{n(total)}</span>
          <span className="w-10 text-right text-sm text-muted-foreground">100%</span>
        </span>
      </p>
    </div>
  );
}
