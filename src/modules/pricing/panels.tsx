import { AlertTriangle, BadgeCheck, CheckCircle2, CircleDashed, Clock, Eye, HelpCircle, Scale } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { courierName, formatWib } from "@/lib/format";
import { cn } from "@/lib/utils";
import { formatPercentBps, formatPointsBps, STATUS_LABEL, STATUS_NOTE } from "./percent";
import type { DiscountHistoryRow, DiscountObservation, DiscountOverviewRow } from "./types";

const STATUS_TONE: Record<string, { Icon: typeof CheckCircle2; variant: "pending" | "info" | "success" }> = {
  owner_stated: { Icon: CircleDashed, variant: "pending" },
  provider_observed: { Icon: Eye, variant: "info" },
  provider_verified: { Icon: BadgeCheck, variant: "success" },
};

// The value status of a gerai discount version: tone + icon + text, never colour alone.
export function DiscountStatusBadge({ status }: { status: string | null }) {
  if (!status) return <Badge variant="neutral"><HelpCircle aria-hidden="true" />Belum ada versi</Badge>;
  const { Icon, variant } = STATUS_TONE[status] ?? { Icon: HelpCircle, variant: "pending" as const };
  return <Badge variant={variant}><Icon aria-hidden="true" />{STATUS_LABEL[status] ?? status}</Badge>;
}

// Variance against the ceiling (highest observed courier discount): unknown stays unknown.
export function VarianceBadge({ remainder }: { remainder: number | null }) {
  if (remainder === null) return <Badge variant="neutral"><HelpCircle aria-hidden="true" />Selisih belum diketahui</Badge>;
  if (remainder < 0) return <Badge variant="destructive"><AlertTriangle aria-hidden="true" />Di atas batas</Badge>;
  if (remainder === 0) return <Badge variant="info"><Scale aria-hidden="true" />Tepat di batas</Badge>;
  return <Badge variant="success"><CheckCircle2 aria-hidden="true" />Di bawah batas</Badge>;
}

const SECTION = "flex flex-col gap-5 rounded-lg bg-card p-5 ring-1 ring-border md:p-6";

function FactRows({ rows }: { rows: [string, React.ReactNode, string?][] }) {
  return (
    <dl className="divide-y divide-border border-y border-border">
      {rows.map(([label, value, testId]) => (
        <div key={label} className="grid gap-1 py-3 sm:grid-cols-[180px_minmax(0,1fr)] sm:gap-4">
          <dt className="text-sm text-muted-foreground">{label}</dt>
          <dd className="break-words" data-testid={testId}>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

// UX-12 current terms: the owner's value is labelled as unverified while it is owner-stated.
export function CurrentTermsCard({ row }: { row: DiscountOverviewRow }) {
  return (
    <section aria-labelledby="current-heading" className={SECTION} data-testid="discount-current">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-1">
          <h2 id="current-heading" className="text-xl font-semibold tracking-tight">Syarat saat ini</h2>
          {row.version !== null ? (
            <p className="text-4xl font-semibold tracking-tight tabular" data-testid="discount-current-percent">{formatPercentBps(row.gerai_discount_bps)}</p>
          ) : null}
        </div>
        <DiscountStatusBadge status={row.status} />
      </div>
      {row.version === null ? (
        <p className="text-muted-foreground" data-testid="discount-none">Belum ada diskon gerai yang ditetapkan. Gerai membayar tarif normal dan biaya gerai tampil sebagai belum diketahui.</p>
      ) : (
        <FactRows rows={[
          ["Versi", <span key="v" className="tabular">{row.version}</span>],
          ["Berlaku mulai", formatWib(row.effective_from)],
          ["Referensi sumber", row.source_reference],
          ["Ditetapkan oleh", <span key="b" className="break-all">{row.set_by_email ?? "—"} · {formatWib(row.set_at)}</span>],
          ...(row.unverified
            ? [["Verifikasi", "Belum terverifikasi: saat ditetapkan belum ada diskon Mengantar yang teramati.", "discount-unverified"] as [string, React.ReactNode, string]]
            : []),
        ]} />
      )}
      {row.status ? <p className="text-sm text-muted-foreground">{STATUS_NOTE[row.status]}</p> : null}
      {row.has_pending ? (
        <p className="inline-flex items-start gap-2 text-sm" data-testid="discount-pending">
          <Clock className="mt-0.5 size-4 shrink-0 text-pending" aria-hidden="true" />
          Ada versi berikutnya dengan tanggal berlaku yang belum tiba (lihat riwayat).
        </p>
      ) : null}
    </section>
  );
}

function Figure({ label, testId, children, meta }: { label: string; testId: string; children: React.ReactNode; meta?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 py-3">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="flex flex-col gap-0.5" data-testid={testId}>
        <span className="text-xl font-semibold tracking-tight tabular">{children}</span>
        {meta ? <span className="text-sm text-muted-foreground">{meta}</span> : null}
      </dd>
    </div>
  );
}

// UX-12 variance and derived remainder. Both are read-only and derived in the database: observed
// minus assigned. Unknown is "tidak diketahui"/"belum diketahui", never 0%.
export function VariancePanel({ row, observations }: { row: DiscountOverviewRow; observations: DiscountObservation[] }) {
  const remainder = row.remainder_bps;
  const estimate = row.remainder_is_estimate ? "perkiraan" : "dari nilai terverifikasi";
  return (
    <section aria-labelledby="variance-heading" className={SECTION} data-testid="discount-variance">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <h2 id="variance-heading" className="text-xl font-semibold tracking-tight">Selisih diskon</h2>
        <VarianceBadge remainder={remainder} />
      </div>
      <dl className="grid grid-cols-1 divide-y divide-border border-y border-border sm:grid-cols-2 sm:divide-y-0 sm:[&>*:nth-child(n+3)]:border-t sm:[&>*:nth-child(n+3)]:border-border sm:[&>*:nth-child(even)]:border-l sm:[&>*:nth-child(even)]:border-border sm:[&>*:nth-child(even)]:pl-4 sm:[&>*:nth-child(odd)]:pr-4">
        <Figure label="Diskon gerai" testId="variance-assigned">
          {row.gerai_discount_bps === null ? "belum ditetapkan" : formatPercentBps(row.gerai_discount_bps)}
        </Figure>
        <Figure label="Diskon Mengantar tertinggi teramati" testId="variance-observed"
          meta={row.observed_at ? `Estimasi ${formatWib(row.observed_at)}` : null}>
          {formatPercentBps(row.observed_bps)}
        </Figure>
        <Figure label="Selisih" testId="variance-difference">{formatPointsBps(remainder)}</Figure>
        <Figure label="Perkiraan sisa platform" testId="remainder-estimate">
          {remainder === null ? "belum diketahui" : remainder < 0 ? `${formatPointsBps(remainder)} (tidak valid: diskon gerai di atas diskon tertinggi teramati)` : `${formatPointsBps(remainder)} (${estimate})`}
        </Figure>
      </dl>
      <p className="text-sm text-muted-foreground">
        Selisih = diskon Mengantar tertinggi yang teramati dikurangi diskon gerai. Selisih ini tidak ditagihkan dan tidak ditanggung GeraiExpress; debit Mengantar mengikuti tarif akun penjual Mengantar gerai. Sisa platform dihitung otomatis, berstatus perkiraan, dan tidak bisa diketik.
      </p>
      <div className="flex items-start gap-3 rounded-md bg-info-soft px-4 py-3">
        <Scale className="mt-0.5 size-5 shrink-0 text-info" aria-hidden="true" />
        <div className="flex flex-col gap-1">
          <p className="font-semibold">Batas diskon gerai</p>
          <p className="text-sm" data-testid="variance-rule">
            Tiap kurir punya diskon sendiri pada estimasi terbaru. Diskon gerai tidak boleh melebihi yang tertinggi di antaranya, dan biaya gerai untuk satu tarif tidak pernah memakai diskon lebih besar dari diskon kurir itu sendiri.
          </p>
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-muted-foreground">Diskon teramati per kurir, estimasi terbaru</h3>
        {observations.length > 0 ? (
          <ul className="divide-y divide-border border-y border-border" aria-label="Diskon teramati per kurir, estimasi terbaru">
            {observations.map((o) => (
              <li key={o.courier} className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between" data-testid="observation">
                <span className="font-semibold">{courierName(o.courier)}</span>
                <span className="text-sm"><span className="tabular">{formatPercentBps(o.observed_bps)}</span> <span className="text-muted-foreground">· {formatWib(o.observed_at)}</span></span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">Belum ada estimasi Mengantar sungguhan untuk gerai ini, jadi diskon Mengantar belum teramati.</p>
        )}
      </div>
    </section>
  );
}

// `framed` = its own surface; inside another surface the list keeps hairlines only (one frame level).
export function HistoryList({ rows, framed = true }: { rows: DiscountHistoryRow[]; framed?: boolean }) {
  if (rows.length === 0) return <p className={cn("text-sm text-muted-foreground", framed && "rounded-lg bg-card p-5 ring-1 ring-border")}>Belum ada versi.</p>;
  return (
    <ol className={cn("divide-y divide-border", framed ? "rounded-lg bg-card ring-1 ring-border" : "[&>li]:px-0")} data-testid="discount-history">
      {rows.map((h) => {
        const upcoming = !h.is_current && new Date(h.effective_from) > new Date();
        return (
          <li key={h.version} className={cn("flex flex-col gap-2 p-4 text-sm md:p-5", !h.is_current && !upcoming && "text-muted-foreground")} data-testid="discount-version">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <span className="text-base font-semibold text-foreground">
                <span className="tabular">Versi {h.version} · {formatPercentBps(h.gerai_discount_bps)}</span> · {STATUS_LABEL[h.status] ?? h.status}
              </span>
              {h.is_current ? (
                <Badge variant="success"><CheckCircle2 aria-hidden="true" />Berlaku sekarang</Badge>
              ) : upcoming ? (
                <Badge variant="pending"><Clock aria-hidden="true" />Menunggu tanggal berlaku</Badge>
              ) : null}
            </div>
            <span className="text-muted-foreground">Berlaku mulai {formatWib(h.effective_from)} · ditetapkan {formatWib(h.created_at)} oleh <span className="break-all">{h.created_by_email ?? "—"}</span></span>
            <span className="break-words">Sumber: {h.source_reference}</span>
            {h.verification_reference ? <span className="break-words">Konfirmasi tertulis: {h.verification_reference}</span> : null}
            {h.unverified ? <span className="text-muted-foreground">Belum terverifikasi: tidak ada diskon Mengantar yang teramati saat ditetapkan.</span> : null}
          </li>
        );
      })}
    </ol>
  );
}
