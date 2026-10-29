import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, CheckCircle2, FileText, Minus, PackagePlus, Wallet, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { signed, type PeriodDays } from "./aggregate";
import { loadOpenCounts, loadSummary } from "./load";
import { SampleTag } from "./parts";

type Tile = {
  key: string;
  label: string;
  count: number | null;
  href: string;
  icon: LucideIcon;
  tone: string;
  delta?: { change: number; yesterday: number } | null;
  hint?: string;
};

function Delta({ change, yesterday }: { change: number; yesterday: number }) {
  const Icon = change > 0 ? ArrowUpRight : change < 0 ? ArrowDownRight : Minus;
  return (
    <span className="flex flex-wrap items-center gap-x-1.5 text-sm text-muted-foreground">
      <span className="inline-flex items-center gap-0.5 font-semibold text-foreground tabular" data-testid="stat-delta">
        <Icon className="size-4" aria-hidden="true" />{signed(change)}
      </span>
      <span>dari kemarin <span className="tabular">({yesterday.toLocaleString("id-ID")})</span></span>
    </span>
  );
}

// UX-16 (2) stat strip: today created and issued (each with the signed change against yesterday),
// awaiting payment and open drafts. Each count opens the matching filtered list.
export async function StatsRegion({ tenantId, periodDays, sample }: { tenantId: string; periodDays: PeriodDays; sample: boolean }) {
  const [summary, open] = await Promise.all([loadSummary(tenantId, periodDays, sample), loadOpenCounts(tenantId)]);
  const today = summary?.window.today;
  const todayRange = today ? { from: today, to: today } : null;
  const tiles: Tile[] = [
    {
      key: "created-today", label: "Dibuat hari ini", count: summary?.today.created ?? null, icon: PackagePlus, tone: "text-info",
      href: todayRange ? `/pengiriman?${new URLSearchParams(todayRange)}` : "/pengiriman",
      delta: summary ? { change: summary.delta.created, yesterday: summary.yesterday.created } : null,
    },
    {
      key: "issued-today", label: "Terbit hari ini", count: summary?.today.issued ?? null, icon: CheckCircle2, tone: "text-success",
      href: todayRange ? `/pengiriman?${new URLSearchParams({ status: "issued", ...todayRange })}` : "/pengiriman?status=issued",
      delta: summary ? { change: summary.delta.issued, yesterday: summary.yesterday.issued } : null,
    },
    {
      key: "awaiting", label: "Menunggu pembayaran", count: open.awaiting, icon: Wallet, tone: "text-warning",
      href: "/pengiriman?status=awaiting_payment", hint: "Bayar di aplikasi Mengantar",
    },
    {
      key: "drafts", label: "Draf terbuka", count: open.drafts, icon: FileText, tone: "text-muted-foreground",
      href: "/pengiriman?status=draft", hint: "Belum dicek ongkir",
    },
  ];

  // Below 768 px a 2 × 2 strip; from 768 px, beside "Perlu tindakan", one grouped list (label left, figure
  // right) whose rows share the column's height.
  return (
    <nav aria-label="Ringkasan hari ini" className="min-w-0 md:h-full">
      <ul className="grid h-full auto-rows-fr grid-cols-2 overflow-hidden rounded-lg bg-card shadow-xs ring-1 ring-border md:grid-cols-1">
        {tiles.map(({ key, label, count, href, icon: Icon, tone, delta, hint }, i) => (
          <li key={key} className={cn("min-w-0 border-border", i % 2 === 1 && "border-l md:border-l-0", i >= 2 && "border-t", i === 1 && "md:border-t")}>
            <Link
              href={href}
              prefetch={false}
              data-testid={`stat-${key}`}
              className="flex h-full min-h-32 flex-col gap-1.5 p-4 transition-colors hover:bg-muted sm:p-5 md:grid md:min-h-24 md:grid-cols-[minmax(0,1fr)_auto] md:content-center md:items-center md:gap-x-4 md:gap-y-1 md:px-6"
            >
              <span className="flex items-start gap-1.5 text-sm text-muted-foreground md:text-[15px] md:text-foreground">
                <Icon className={cn("mt-0.5 size-4 shrink-0", tone)} aria-hidden="true" />
                <span className="min-w-0 [overflow-wrap:anywhere]">{label}</span>
              </span>
              <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1 md:col-start-2 md:row-span-2 md:row-start-1 md:flex-row-reverse">
                <span className="text-[34px] leading-none font-semibold tracking-tight tabular" data-testid="stat-value">
                  {count === null ? "—" : count.toLocaleString("id-ID")}
                </span>
                <SampleTag show={sample} />
              </span>
              {delta ? <Delta {...delta} /> : count === null ? (
                <span className="text-sm text-danger">Belum bisa dimuat</span>
              ) : hint ? <span className="text-sm text-muted-foreground">{hint}</span> : null}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
