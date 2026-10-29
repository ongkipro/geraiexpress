import Link from "next/link";
import { CheckCircle2, ChevronRight } from "lucide-react";
import { StatusBadge } from "@/components/status-badge";
import { formatWibShort } from "@/lib/format";
import { loadAttention } from "./load";
import { RegionError, RegionHeading, Surface } from "./parts";

// UX-16 (2) "Perlu tindakan": unknown, failed, awaiting payment, queued and in-flight shipments, the
// oldest waiting first; each row opens the shipment.
export async function AttentionRegion({ tenantId, sample, reloadHref }: { tenantId: string; sample: boolean; reloadHref: string }) {
  const result = await loadAttention(tenantId);
  if (!result) return <RegionError title="Perlu tindakan" href={reloadHref} />;
  const { rows, count } = result;
  return (
    <Surface id="perlu-tindakan" aria-labelledby="attention-heading" className="scroll-mt-24 overflow-hidden" data-testid="dashboard-attention">
      <RegionHeading
        id="attention-heading"
        title="Perlu tindakan"
        sample={sample}
        description={count > rows.length ? `${rows.length} terlama dari ${count}` : count > 0 ? "Terlama di atas" : undefined}
        aside={(
          <span
            data-testid="attention-count"
            className={count > 0
              ? "inline-flex h-8 min-w-8 items-center justify-center rounded-full bg-warning-soft px-2.5 text-[15px] font-semibold text-warning tabular"
              : "inline-flex h-8 min-w-8 items-center justify-center rounded-full bg-muted px-2.5 text-[15px] font-semibold text-muted-foreground tabular"}
          >
            <span className="sr-only">Jumlah: </span>{count.toLocaleString("id-ID")}
          </span>
        )}
      />
      {rows.length === 0 ? (
        <div className="flex flex-1 flex-col items-start gap-3 px-5 pt-4 pb-5 sm:px-6">
          <p className="flex items-start gap-2 text-[15px]">
            <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" aria-hidden="true" />
            <span>
              <span className="font-semibold">Tidak ada yang perlu ditindaklanjuti.</span>{" "}
              <span className="text-muted-foreground">Pengiriman yang belum pasti, gagal, antre atau belum dibayar akan muncul di sini.</span>
            </span>
          </p>
          <Link href="/pengiriman" prefetch={false} className="inline-flex min-h-11 items-center text-[15px] text-primary hover:underline">
            Lihat semua pengiriman
          </Link>
        </div>
      ) : (
        <>
          <ul className="mt-3 divide-y divide-border border-t border-border">
            {rows.map((s) => (
              <li key={s.id}>
                <Link href={`/pengiriman/${s.id}`} prefetch={false} className="flex min-h-14 items-center gap-3 px-5 py-3 transition-colors hover:bg-muted sm:px-6">
                  <span className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate font-semibold whitespace-nowrap tabular">{s.reference}</span>
                      <span className="truncate text-sm text-muted-foreground">
                        {s.recipient_name ?? "Penerima belum diisi"} · <span className="tabular">{formatWibShort(s.updated_at)}</span>
                      </span>
                    </span>
                    <StatusBadge state={s.submission_state} />
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="sr-only">Periksa</span>
                </Link>
              </li>
            ))}
          </ul>
          {count > rows.length ? (
            <Link href="/pengiriman#perlu-tindakan" prefetch={false} className="flex min-h-12 items-center justify-between gap-2 border-t border-border px-5 text-[15px] text-primary hover:bg-muted sm:px-6">
              Lihat semua {count.toLocaleString("id-ID")} <ChevronRight className="size-4" aria-hidden="true" />
            </Link>
          ) : null}
        </>
      )}
    </Surface>
  );
}
