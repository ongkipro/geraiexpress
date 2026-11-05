import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { formatWibShort } from "@/lib/format";
import { CaseBadge, caseMark } from "@/modules/cases/case-badge";
import { CASE_COPY } from "@/modules/cases/copy";
import { loadCaseAttention } from "@/modules/cases/load";
import { RegionError, RegionHeading, Surface } from "./parts";

const LIMIT = 6;

// UX-20 item 1: returning shipments and non-closed cases on the dashboard, nearest deadline first.
// Rendered only when there is something to act on (or the read failed).
export async function CaseAttentionRegion({ tenantId, sample, reloadHref }: { tenantId: string; sample: boolean; reloadHref: string }) {
  const result = await loadCaseAttention(tenantId, LIMIT);
  if (!result) return <RegionError title={CASE_COPY.attentionTitle} href={reloadHref} />;
  const { rows, count } = result;
  if (count === 0) return null;
  return (
    <Surface aria-labelledby="case-attention-heading" className="overflow-hidden" data-testid="dashboard-case-attention">
      <RegionHeading
        id="case-attention-heading"
        title={CASE_COPY.attentionTitle}
        sample={sample}
        description={count > rows.length ? `${rows.length} dari ${count}` : "Tenggat terdekat di atas"}
        aside={(
          <span data-testid="case-attention-count" className="inline-flex h-8 min-w-8 items-center justify-center rounded-full bg-warning-soft px-2.5 text-[15px] font-semibold text-warning tabular">
            <span className="sr-only">Jumlah: </span>{count.toLocaleString("id-ID")}
          </span>
        )}
      />
      <ul className="mt-3 divide-y divide-border border-t border-border">
        {rows.map((r) => (
          <li key={r.id}>
            <Link href={r.case_id ? `/kasus/${r.case_id}` : `/pengiriman/${r.id}`} prefetch={false} className="flex min-h-14 items-center gap-3 px-5 py-3 transition-colors hover:bg-muted sm:px-6">
              <span className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
                <span className="flex min-w-0 flex-col">
                  <span className="truncate font-semibold whitespace-nowrap tabular">{r.reference}</span>
                  <span className="truncate text-sm text-muted-foreground">
                    {r.recipient_name ?? "Penerima belum diisi"} · <span className="tabular">{r.deadline_at ? `Tenggat ${formatWibShort(r.deadline_at)}` : CASE_COPY.deadlineUnknown}</span>
                  </span>
                </span>
                <CaseBadge mark={caseMark(r.returned ? "returned" : null, r.case_type)} />
              </span>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="sr-only">Periksa</span>
            </Link>
          </li>
        ))}
      </ul>
      <Link href="/kasus" prefetch={false} className="flex min-h-12 items-center justify-between gap-2 border-t border-border px-5 text-[15px] text-primary hover:bg-muted sm:px-6">
        Lihat semua kasus <ChevronRight className="size-4" aria-hidden="true" />
      </Link>
    </Surface>
  );
}
