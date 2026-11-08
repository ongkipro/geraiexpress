import { Info } from "lucide-react";
import { formatIdr } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ROW_BOUND, type PeriodDays } from "./aggregate";
import { CourierRanking, PeriodControl, StatusComposition, TrendChart } from "./charts";
import { loadSummary } from "./load";
import { RegionError, RegionHeading, SampleTag, Surface } from "./parts";

// UX-16 (2): the daily trend for the chosen period, then the status composition and the courier
// ranking of the same rows. Money is the customer charge only ("ongkir pelanggan"); COD is a count.
export async function TrendRegion({ tenantId, periodDays, sample, reloadHref }: {
  tenantId: string; periodDays: PeriodDays; sample: boolean; reloadHref: string;
}) {
  const summary = await loadSummary(tenantId, periodDays, sample);
  if (!summary) return <RegionError title="Tren pengiriman" href={reloadHref} />;
  const { window, total, issued } = summary;
  const range = { from: window.days[0], to: window.today };
  const listHref = (status?: string) => `/pengiriman?${new URLSearchParams({ ...(status && { status }), ...range })}`;
  // Counts first; the money figure takes its own full row below 1024 px so a long amount never wraps.
  const figures = [
    { key: "total", label: "Pengiriman", value: total.toLocaleString("id-ID"), note: `dibuat dalam ${periodDays} hari` },
    { key: "issued", label: "Resi terbit", value: issued.toLocaleString("id-ID"), note: total > 0 ? `${Math.round((issued / total) * 100)}% dari pengiriman` : "belum ada pengiriman" },
    { key: "cod", label: "COD", value: summary.codIssued.toLocaleString("id-ID"), note: "resi terbit dengan COD" },
    { key: "charge", label: "Ongkir pelanggan", value: summary.chargeIdr === null ? "belum diketahui" : formatIdr(summary.chargeIdr), note: summary.chargeIdr === null ? `${summary.chargeUnknownCount} resi terbit belum diketahui ongkirnya` : "dari resi terbit" },
  ];

  return (
    <>
      <Surface aria-labelledby="trend-heading" className="pb-5" data-testid="dashboard-trend">
        <RegionHeading
          id="trend-heading"
          title="Tren pengiriman"
          sample={sample}
          description="Pengiriman dibuat per hari, terbit dan status lain"
          aside={<PeriodControl current={periodDays} />}
        />
        <dl className="mt-4 grid grid-cols-3 border-y border-border lg:grid-cols-4">
          {figures.map((f, i) => (
            <div
              key={f.key}
              className={cn(
                "flex min-w-0 flex-col gap-1 py-4 pr-3 pl-5 sm:px-6",
                i > 0 && i < 3 && "border-l border-border",
                i === 3 && "col-span-3 border-t border-border lg:col-span-1 lg:border-t-0 lg:border-l",
              )}
            >
              <dt className="text-sm text-muted-foreground">{f.label}</dt>
              <dd className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className="text-[24px] leading-tight font-semibold tracking-tight tabular sm:text-[28px]" data-testid={`trend-${f.key}`}>{f.value}</span>
                <SampleTag show={sample} />
              </dd>
              <dd className="text-sm text-muted-foreground">{f.note}</dd>
            </div>
          ))}
        </dl>
        <div className="flex flex-col gap-3 px-5 pt-5 sm:px-6">
          {summary.limited ? (
            <p role="note" className="flex items-start gap-2 rounded-md bg-warning-soft px-3 py-2 text-sm text-warning" data-testid="dashboard-limited">
              <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              Terbatas: hanya {ROW_BOUND.toLocaleString("id-ID")} pengiriman terbaru periode ini yang dihitung, jadi hari-hari terlama bisa kurang.
            </p>
          ) : null}
          {total === 0 ? (
            <p className="text-[15px] text-muted-foreground" data-testid="trend-empty">
              Belum ada pengiriman dalam {periodDays} hari terakhir. Pengiriman yang Anda buat akan tampil di sini per hari.
            </p>
          ) : null}
          <TrendChart summary={summary} />
        </div>
      </Surface>

      <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
        <Surface aria-labelledby="status-heading" className="pb-3" data-testid="dashboard-status">
          <RegionHeading id="status-heading" title="Status" sample={sample} description={`${total.toLocaleString("id-ID")} pengiriman, ${periodDays} hari terakhir`} />
          <div className="px-5 pt-4 sm:px-6">
            <StatusComposition statuses={summary.statuses} total={total} listHref={listHref} />
          </div>
        </Surface>
        <Surface aria-labelledby="courier-heading" className="pb-3" data-testid="dashboard-couriers">
          <RegionHeading id="courier-heading" title="Kurir" sample={sample} description="Kurir dari ongkir yang dipilih" />
          <div className="px-5 pt-2 sm:px-6">
            <CourierRanking couriers={summary.couriers} total={total} />
          </div>
        </Surface>
      </div>
    </>
  );
}
