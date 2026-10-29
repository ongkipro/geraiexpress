import Link from "next/link";
import { ChevronRight, Package } from "lucide-react";
import { StatusBadge } from "@/components/status-badge";
import { courierName, formatIdr, formatWibShort } from "@/lib/format";
import { CreateDraftButton } from "@/modules/shipments/list-create";
import { loadRecent } from "./load";
import { Initials, RegionError, RegionHeading, Surface } from "./parts";

// UX-16 (2) "Terbaru": the last five shipments created, whatever the period; each row opens it.
export async function RecentRegion({ tenantId, sample, reloadHref }: { tenantId: string; sample: boolean; reloadHref: string }) {
  const rows = await loadRecent(tenantId);
  if (!rows) return <RegionError title="Terbaru" href={reloadHref} />;
  return (
    <Surface aria-labelledby="recent-heading" className="overflow-hidden" data-testid="dashboard-recent">
      <RegionHeading
        id="recent-heading"
        title="Terbaru"
        sample={sample}
        description="Lima pengiriman yang terakhir dibuat"
        aside={rows.length > 0 ? (
          <Link href="/pengiriman" prefetch={false} className="inline-flex min-h-11 items-center gap-1 text-[15px] text-primary hover:underline">
            Lihat semua <ChevronRight className="size-4" aria-hidden="true" />
          </Link>
        ) : undefined}
      />
      {rows.length === 0 ? (
        <div className="flex flex-col items-start gap-4 px-5 pt-4 pb-5 sm:px-6" data-testid="recent-empty">
          <p className="flex items-start gap-2 text-[15px]">
            <Package className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span>
              <span className="font-semibold">Belum ada pengiriman.</span>{" "}
              <span className="text-muted-foreground">Buat draf, cek ongkir, lalu konfirmasi untuk menerbitkan resi.</span>
            </span>
          </p>
          <CreateDraftButton className="w-full sm:w-auto">Buat pengiriman pertama</CreateDraftButton>
        </div>
      ) : (
        <ul className="mt-3 divide-y divide-border border-t border-border">
          {rows.map((s) => (
            <li key={s.id}>
              <Link href={`/pengiriman/${s.id}`} prefetch={false} className="flex min-h-16 items-center gap-3 px-5 py-3 transition-colors hover:bg-muted sm:px-6" data-testid="recent-row">
                <Initials name={s.recipient_name} />
                <span className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate font-semibold tabular">{s.reference}</span>
                    <span className="truncate text-sm text-muted-foreground">
                      {s.recipient_name ?? "Penerima belum diisi"}{s.recipient_area ? ` · ${s.recipient_area}` : ""}
                    </span>
                  </span>
                  <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 sm:shrink-0 sm:flex-col sm:items-end">
                    <StatusBadge state={s.submission_state} />
                    <span className="flex flex-wrap gap-x-1.5 text-sm text-muted-foreground tabular sm:justify-end">
                      {s.quote ? <span className="whitespace-nowrap">{courierName(s.quote.courier)} ·</span> : null}
                      {s.customer_charge_idr != null ? <span className="whitespace-nowrap">{formatIdr(s.customer_charge_idr)} ·</span> : null}
                      <span className="whitespace-nowrap">{formatWibShort(s.created_at)}</span>
                    </span>
                  </span>
                </span>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Surface>
  );
}
