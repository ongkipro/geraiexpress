import type { Metadata } from "next";
import Link from "next/link";
import { ChevronDown, ChevronRight, Percent } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { courierName, formatWib } from "@/lib/format";
import { platformTitle, requirePlatform } from "@/lib/platform";
import { dbServer } from "@/lib/db/server";
import { cn } from "@/lib/utils";
import { DiscountForm } from "@/modules/pricing/forms";
import { DiscountStatusBadge, HistoryList, VarianceBadge } from "@/modules/pricing/panels";
import { formatPercentBps, formatPointsBps } from "@/modules/pricing/percent";
import { jakartaToday, type DiscountHistoryRow, type DiscountOverviewRow } from "@/modules/pricing/types";
import { CardLabel, EmptyState, LoadError, PageHeader, RT, SectionHeader } from "../ui";

export const generateMetadata = (): Promise<Metadata> => platformTitle("Diskon gerai · Super Admin", ["integration_operations"]);

const SUMMARY = "inline-flex min-h-11 cursor-pointer list-none items-center gap-1.5 font-semibold text-primary [&::-webkit-details-marker]:hidden";

// PR-23 / UX-12: per-tenant gerai discount terms. The capability is integration_operations (the
// closest existing platform scope; no pricing capability exists). The sender always pays the normal
// tariff; nothing here changes a Mengantar bill.
export default async function DiscountOverviewPage() {
  await requirePlatform("integration_operations");
  const db = await dbServer();
  const [{ data: raw, error }, { data: templateRaw }] = await Promise.all([
    db.rpc("platform_discount_overview"),
    db.rpc("platform_discount_history", { p_tenant: null }),
  ]);
  const rows = (raw ?? []) as DiscountOverviewRow[];
  const template = (templateRaw ?? []) as DiscountHistoryRow[];
  const templateCurrent = template.find((t) => t.is_current) ?? null;

  return (
    <div className="flex max-w-[1160px] flex-col gap-8">
      <PageHeader
        title="Diskon gerai"
        description="Diskon yang diterima tiap gerai, versi demi versi. Pengirim selalu membayar tarif normal. Diskon Mengantar yang teramati dan sisa platform hanya terlihat di sini, tidak pernah oleh gerai."
      />

      <section aria-labelledby="tenants-heading" className="flex flex-col gap-4">
        <SectionHeader id="tenants-heading" title="Gerai" description="Batas diskon gerai adalah diskon Mengantar tertinggi yang teramati pada estimasi terbaru." />
        {error ? (
          <LoadError href="/admin/diskon">Data diskon belum bisa dimuat.</LoadError>
        ) : rows.length === 0 ? (
          <EmptyState icon={Percent} title="Belum ada gerai terdaftar" description="Diskon bisa ditetapkan setelah pengajuan gerai disetujui." />
        ) : (
          <div className={RT.frame}>
            <Table className={RT.table}>
              <TableHeader className={RT.head}>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Gerai</TableHead>
                  <TableHead className="text-right">Diskon gerai</TableHead>
                  <TableHead className="text-right">Teramati tertinggi</TableHead>
                  <TableHead className="text-right max-lg:hidden">Sisa platform</TableHead>
                  <TableHead className="text-right"><span className="sr-only">Tindakan</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody className={RT.body}>
                {rows.map((r) => (
                  <TableRow key={r.tenant_id} data-testid="discount-tenant" className={RT.row}>
                    <TableCell className={cn(RT.cell, "min-w-0")}>
                      <span className="block font-semibold break-words">{r.tenant_name}</span>
                      <span className="mt-1 flex flex-wrap gap-1.5">
                        <DiscountStatusBadge status={r.status} />
                        {r.version !== null ? <VarianceBadge remainder={r.remainder_bps} /> : null}
                      </span>
                      {r.observed_by_courier && r.observed_by_courier.length > 0 ? (
                        <span className="mt-1 block text-sm text-muted-foreground" data-testid="discount-couriers">
                          Per kurir: {r.observed_by_courier.map((c) => `${courierName(c.courier)} ${formatPercentBps(c.observed_bps)}`).join(" · ")}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className={cn(RT.cell, "text-sm md:text-right")}>
                      {r.version === null ? (
                        <span className="text-muted-foreground">Belum ada diskon gerai.</span>
                      ) : (
                        <>
                          <CardLabel>Diskon gerai</CardLabel>
                          <span className="font-semibold tabular md:block md:text-base">{formatPercentBps(r.gerai_discount_bps)}</span>
                          <span className="text-muted-foreground md:block"> · berlaku {formatWib(r.effective_from)}{r.unverified ? " · belum terverifikasi" : ""}</span>
                        </>
                      )}
                    </TableCell>
                    <TableCell className={cn(RT.cell, "text-sm md:text-right")}>
                      <CardLabel>Diskon Mengantar tertinggi teramati:</CardLabel>
                      <span className="tabular md:text-base">{formatPercentBps(r.observed_bps)}</span>
                    </TableCell>
                    <TableCell className={cn(RT.cell, "text-sm md:text-right max-lg:md:hidden")}>
                      <CardLabel>Perkiraan sisa platform:</CardLabel>
                      <span className="tabular md:text-base">{formatPointsBps(r.remainder_bps)}</span>
                    </TableCell>
                    <TableCell className={cn(RT.cell, "max-md:pt-2 md:text-right")}>
                      <Button asChild variant="outline" size="sm">
                        <Link href={`/admin/diskon/${r.tenant_id}`}><span>Atur diskon<span className="sr-only"> {r.tenant_name}</span></span><ChevronRight aria-hidden="true" /></Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      <section aria-labelledby="template-heading" className="flex flex-col gap-4 rounded-lg bg-card p-5 ring-1 ring-border md:p-6" data-testid="discount-template">
        <div className="flex flex-col gap-1">
          <h2 id="template-heading" className="text-xl font-semibold tracking-tight">Templat default</h2>
          <p className="text-sm text-muted-foreground">
            {templateCurrent
              ? `Saat ini ${formatPercentBps(templateCurrent.gerai_discount_bps)} (versi ${templateCurrent.version}). Hanya dipakai sebagai saran isian saat Anda menetapkan diskon gerai baru; tidak pernah diterapkan otomatis.`
              : "Belum ada templat. Templat hanya saran isian dan tidak pernah diterapkan otomatis."}
          </p>
        </div>
        <div className="flex flex-col divide-y divide-border border-y border-border">
          <details className="group py-1">
            <summary className={SUMMARY}>
              Ubah templat…
              <ChevronDown className="size-4 transition-transform group-open:rotate-180" aria-hidden="true" />
            </summary>
            <div className="max-w-[560px] pt-2 pb-4">
              <DiscountForm tenantId={null} tenantName="Templat default" expectedVersion={template[0]?.version ?? 0} today={jakartaToday()}
                currentBps={templateCurrent?.gerai_discount_bps ?? null} currentStatus={templateCurrent?.status ?? null} observedBps={null} prefillBps={null} />
            </div>
          </details>
          {template.length > 0 ? (
            <details className="group py-1">
              <summary className={SUMMARY}>
                Riwayat templat…
                <ChevronDown className="size-4 transition-transform group-open:rotate-180" aria-hidden="true" />
              </summary>
              <div className="pb-2"><HistoryList rows={template} framed={false} /></div>
            </details>
          ) : null}
        </div>
      </section>
    </div>
  );
}
