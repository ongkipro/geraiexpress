import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Notice } from "@/components/notice";
import { Badge } from "@/components/ui/badge";
import { dbServer } from "@/lib/db/server";
import { courierName, formatWib } from "@/lib/format";
import { cn } from "@/lib/utils";
import { requireWorkspace } from "@/lib/workspace";
import { CaseGuidance } from "@/modules/cases/case-panel";
import { CASE_COPY, CASE_STATE_LABEL, CASE_TYPE_LABEL } from "@/modules/cases/copy";
import type { CaseRecord } from "@/modules/cases/types";

export const metadata: Metadata = { title: "Kasus" };

const PAGE_SIZE = 50;
type ListRow = Pick<CaseRecord, "id" | "case_type" | "state" | "deadline_at" | "opened_at" | "closed_at" | "outcome"> & {
  shipment: { reference: string; recipient_name: string | null; quote: { courier: string } | null } | null;
};

// UX-20 item 5: /kasus filters open (open and submitted) and closed cases. Operators open and update
// from the shipment detail; only a tenant administrator closes.
export default async function CasesPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const ws = await requireWorkspace();
  const { status } = await searchParams;
  const closed = status === "ditutup";
  const db = await dbServer();
  let query = db.from("shipment_cases")
    .select("id, case_type, state, deadline_at, opened_at, closed_at, outcome, shipment:shipments!shipment_cases_tenant_id_shipment_id_fkey(reference, recipient_name, quote:shipment_quotes!shipments_tenant_id_selected_quote_id_fkey(courier))", { count: "exact" })
    .eq("tenant_id", ws.tenant.id);
  query = closed
    ? query.eq("state", "closed").order("closed_at", { ascending: false })
    : query.neq("state", "closed").order("deadline_at", { ascending: true, nullsFirst: false }).order("opened_at");
  const { data, count, error } = await query.limit(PAGE_SIZE).returns<ListRow[]>();
  const rows = data ?? [];
  const tab = (href: string, label: string, active: boolean) => (
    <Link href={href} aria-current={active ? "page" : undefined}
      className={cn("inline-flex min-h-11 items-center rounded-full px-4 text-[15px] ring-1 ring-border", active ? "bg-info-soft font-semibold text-primary" : "bg-card hover:bg-muted")}>
      {label}
    </Link>
  );
  return (
    <div className="flex flex-col gap-6 lg:gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl tracking-tight">{CASE_COPY.listTitle}</h1>
        <p className="text-muted-foreground">{CASE_COPY.listIntro}</p>
        <p className="text-sm text-muted-foreground">{CASE_COPY.lostSuggestionDeferred}</p>
      </header>
      <nav aria-label="Filter kasus" className="flex flex-wrap gap-2">
        {tab("/kasus", CASE_COPY.filterOpen, !closed)}
        {tab("/kasus?status=ditutup", CASE_COPY.filterClosed, closed)}
      </nav>
      <section aria-labelledby="case-list-heading" className="flex flex-col gap-3">
        <h2 id="case-list-heading" className="sr-only">{closed ? "Kasus ditutup" : "Kasus terbuka"}</h2>
        {error ? <Notice tone="danger">Daftar kasus belum bisa dimuat. Muat ulang halaman.</Notice>
          : rows.length === 0 ? (
            <div className="rounded-lg bg-card p-6 ring-1 ring-border">
              <p className="font-semibold">{closed ? CASE_COPY.emptyClosed : CASE_COPY.emptyOpen}</p>
              <p className="text-muted-foreground">{CASE_COPY.emptyHint}</p>
            </div>
          ) : (
            <>
              <ul className="divide-y divide-border overflow-hidden rounded-lg bg-card ring-1 ring-border" data-testid="case-list">
                {rows.map((c) => (
                  <li key={c.id}>
                    <Link href={`/kasus/${c.id}`} prefetch={false} className="flex min-h-14 items-center gap-3 px-4 py-3 transition-colors hover:bg-muted" data-testid="case-row">
                      <span className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
                        <span className="flex min-w-0 flex-col">
                          <span className="font-semibold tabular [overflow-wrap:anywhere]">{c.shipment?.reference ?? "Pengiriman"}</span>
                          <span className="truncate text-sm text-muted-foreground">
                            {CASE_TYPE_LABEL[c.case_type]} · {c.shipment?.quote ? courierName(c.shipment.quote.courier) : "Kurir tidak diketahui"} · {c.shipment?.recipient_name ?? "Penerima belum diisi"}
                          </span>
                          <span className="text-sm text-muted-foreground tabular">
                            {closed ? `Ditutup ${formatWib(c.closed_at)}` : c.deadline_at ? `Tenggat ${formatWib(c.deadline_at)}` : CASE_COPY.deadlineUnknown}
                          </span>
                        </span>
                        <Badge variant={c.state === "closed" ? "neutral" : c.state === "submitted" ? "info" : "warning"}>{CASE_STATE_LABEL[c.state]}</Badge>
                      </span>
                      <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                      <span className="sr-only">Buka kasus {c.shipment?.reference}</span>
                    </Link>
                  </li>
                ))}
              </ul>
              {count !== null && count > rows.length ? <p className="text-sm text-muted-foreground tabular">{rows.length} dari {count} kasus ditampilkan.</p> : null}
            </>
          )}
      </section>
      <section className="rounded-lg bg-card p-5 ring-1 ring-border sm:p-6"><CaseGuidance /></section>
    </div>
  );
}
