import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requirePlatform } from "@/lib/platform";
import { dbServer } from "@/lib/db/server";
import { DiscountForm } from "@/modules/pricing/forms";
import { CurrentTermsCard, HistoryList, VariancePanel } from "@/modules/pricing/panels";
import {
  jakartaToday, type DiscountHistoryRow, type DiscountObservation, type DiscountOverviewRow,
} from "@/modules/pricing/types";
import { PageHeader, SectionHeader } from "../../ui";

export const metadata: Metadata = { title: "Atur diskon gerai · Super Admin" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// UX-12: one screen per tenant, as grouped sections: current terms, variance and remainder estimate,
// the assignment form and the append-only history. The tenant id comes from the URL only to select a
// row the database returns to a platform administrator; every write re-checks the grant in the database.
export default async function TenantDiscountPage({ params }: { params: Promise<{ tenant: string }> }) {
  await requirePlatform("integration_operations");
  const { tenant } = await params;
  if (!UUID.test(tenant)) notFound();
  const db = await dbServer();
  const [{ data: overview }, { data: historyRaw }, { data: observationsRaw }, { data: templateRaw }] = await Promise.all([
    db.rpc("platform_discount_overview"),
    db.rpc("platform_discount_history", { p_tenant: tenant }),
    db.rpc("platform_discount_observations", { p_tenant: tenant }),
    db.rpc("platform_discount_history", { p_tenant: null }),
  ]);
  const row = ((overview ?? []) as DiscountOverviewRow[]).find((r) => r.tenant_id === tenant);
  if (!row) notFound();
  const history = (historyRaw ?? []) as DiscountHistoryRow[];
  const observations = (observationsRaw ?? []) as DiscountObservation[];
  // The default template only suggests an initial value for a tenant that has no version yet.
  const template = ((templateRaw ?? []) as DiscountHistoryRow[]).find((t) => t.is_current) ?? null;
  const prefillBps = history.length === 0 ? template?.gerai_discount_bps ?? null : null;

  return (
    <div className="flex max-w-[1160px] flex-col gap-8">
      <PageHeader
        crumbs={[{ href: "/admin/diskon", label: "Diskon gerai" }]}
        current={row.tenant_name}
        title={`Diskon gerai: ${row.tenant_name}`}
        description="Pengirim tetap membayar tarif normal. Menyimpan versi baru tidak mengubah estimasi lama atau tagihan Mengantar, dan tidak mengaktifkan apa pun di Mengantar."
      />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_400px] xl:items-start">
        <div className="flex min-w-0 flex-col gap-6">
          <CurrentTermsCard row={row} />
          <VariancePanel row={row} observations={observations} />
        </div>
        <section aria-labelledby="form-heading" className="flex flex-col gap-4 rounded-lg bg-card p-5 ring-1 ring-border md:p-6 xl:sticky xl:top-6">
          <div className="flex flex-col gap-1">
            <h2 id="form-heading" className="text-xl font-semibold tracking-tight">Tetapkan versi baru</h2>
            <p className="text-sm text-muted-foreground">Versi baru menambah riwayat; versi lama tidak pernah diubah.</p>
          </div>
          <DiscountForm tenantId={row.tenant_id} tenantName={row.tenant_name} expectedVersion={history[0]?.version ?? 0} today={jakartaToday()}
            currentBps={row.gerai_discount_bps} currentStatus={row.status} observedBps={row.observed_bps} prefillBps={prefillBps} />
        </section>
      </div>
      <section aria-labelledby="history-heading" className="flex flex-col gap-4">
        <SectionHeader id="history-heading" title="Riwayat versi" description="Daftar ini hanya bertambah; tidak ada versi yang bisa diubah atau dihapus." />
        <HistoryList rows={history} />
      </section>
    </div>
  );
}
