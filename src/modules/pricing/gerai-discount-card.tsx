import { formatWib } from "@/lib/format";
import { dbServer } from "@/lib/db/server";
import { GERAI_COST_NOTE } from "./display";
import { formatPercentBps, STATUS_LABEL } from "./percent";

type Terms = { gerai_discount_bps: number; status: string; effective_from: string };

// PR-23 / UX-12: the discount GeraiExpress currently assigns to this gerai, for tenant administrators
// only (tenant_gerai_discount refuses everyone else, so an operator or an error renders nothing).
// Never shows the Mengantar-observed value, the remainder or the unverified flag. Read-only: a grouped
// list of the assigned terms inside the settings "Harga & diskon" group.
export async function GeraiDiscountCard({ tenantId }: { tenantId: string }) {
  const db = await dbServer();
  const { data, error } = await db.rpc("tenant_gerai_discount", { p_tenant: tenantId });
  if (error) return null;
  const terms = ((data ?? []) as Terms[])[0] ?? null;
  return (
    <section aria-labelledby="gerai-discount-heading" className="flex flex-col rounded-lg bg-card ring-1 ring-border" data-testid="gerai-discount-card">
      <h3 id="gerai-discount-heading" className="px-5 pt-5 text-[17px] sm:px-6">Diskon gerai</h3>
      {terms ? (
        <dl className="mt-2 divide-y divide-border">
          <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 px-5 py-3 sm:px-6">
            <dt className="text-muted-foreground">Diskon yang ditetapkan</dt>
            <dd className="text-xl tabular" data-testid="gerai-discount-percent">{formatPercentBps(terms.gerai_discount_bps)}</dd>
          </div>
          <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 px-5 py-3 sm:px-6">
            <dt className="text-muted-foreground">Berlaku mulai</dt>
            <dd className="tabular" data-testid="gerai-discount-effective">{formatWib(terms.effective_from)}</dd>
          </div>
          <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 px-5 py-3 sm:px-6">
            <dt className="text-muted-foreground">Status nilai</dt>
            <dd>{STATUS_LABEL[terms.status] ?? terms.status}</dd>
          </div>
        </dl>
      ) : (
        <p className="px-5 pt-2 sm:px-6" data-testid="gerai-discount-none">Belum ada diskon gerai yang ditetapkan. Biaya gerai pada detail pengiriman tampil sebagai belum diketahui.</p>
      )}
      <p className="mt-3 border-t border-border px-5 py-4 text-sm text-muted-foreground sm:px-6">{GERAI_COST_NOTE}</p>
    </section>
  );
}
