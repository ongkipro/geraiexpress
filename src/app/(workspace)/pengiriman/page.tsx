import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Download, Package, SearchX, Wallet, X } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Pagination, PaginationContent, PaginationItem } from "@/components/ui/pagination";
import { StatusBadge } from "@/components/status-badge";
import { dbServer } from "@/lib/db/server";
import { friendlyError } from "@/lib/errors";
import { dayBounds, wibIso } from "@/lib/export-format";
import { formatWib, SUBMISSION_LABEL } from "@/lib/format";
import { cn } from "@/lib/utils";
import { requireWorkspace } from "@/lib/workspace";
import { EXPORT_ROW_CAP, TRUNCATION_NOTE, parseShipmentFilters, searchClause } from "@/modules/exports/shipments-export";
import { CreateDraftButton } from "@/modules/shipments/list-create";
import { ShipmentFilters } from "@/modules/shipments/list-filters";
import { ShipmentRows, type ShipmentRow } from "@/modules/shipments/list-rows";
import { StatStrip, type ListStat } from "@/modules/shipments/list-stats";

export const metadata: Metadata = { title: "Pengiriman" };

const PAGE_SIZE = 20;
// The exception tier (Perlu tindakan): provider outcomes and payments someone must look at.
const ATTENTION = ["unknown", "failed", "awaiting_payment", "queued", "in_flight"];
const dayLabel = new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

type AttentionRow = Pick<ShipmentRow, "id" | "reference" | "submission_state" | "recipient_name" | "updated_at">;

export default async function ShipmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; from?: string; to?: string; page?: string; reset?: string; galat?: string }>;
}) {
  const ws = await requireWorkspace();
  const params = await searchParams;
  const { q, status, from, to } = parseShipmentFilters(params);
  const bounds = dayBounds(from, to);
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  // "Hari ini" is the WIB calendar day, the same day filter the list and the export use.
  const today = wibIso(new Date().toISOString()).slice(0, 10);
  const todayBounds = dayBounds(today, today);
  const db = await dbServer();

  let query = db
    .from("shipments")
    .select(
      // T-086 / UX-20 item 1: the provider return state and any non-closed case mark the row.
      "id, reference, submission_state, delivery_state, recipient_name, recipient_area, awb, customer_charge_idr, is_cod, updated_at, is_simulated, quote:shipment_quotes!shipments_tenant_id_selected_quote_id_fkey(courier, service), cases:shipment_cases!shipment_cases_tenant_id_shipment_id_fkey(case_type, state)",
      { count: "exact" },
    )
    .eq("tenant_id", ws.tenant.id)
    .neq("cases.state", "closed")
    .order("updated_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (status) query = query.eq("submission_state", status);
  if (bounds.gte) query = query.gte("created_at", bounds.gte);
  if (bounds.lt) query = query.lt("created_at", bounds.lt);
  if (q) query = query.or(searchClause(q));
  const [{ data: rows, count, error }, attention, awaiting, issuedToday] = await Promise.all([
    query.returns<ShipmentRow[]>(),
    db.from("shipments").select("id, reference, submission_state, recipient_name, updated_at", { count: "exact" })
      .eq("tenant_id", ws.tenant.id).in("submission_state", ATTENTION).order("updated_at").limit(10)
      .returns<AttentionRow[]>(),
    db.from("shipments").select("id", { count: "exact", head: true })
      .eq("tenant_id", ws.tenant.id).eq("submission_state", "awaiting_payment"),
    db.from("shipments").select("id", { count: "exact", head: true })
      .eq("tenant_id", ws.tenant.id).eq("submission_state", "issued")
      .gte("created_at", todayBounds.gte!).lt("created_at", todayBounds.lt!),
  ]);
  const total = count ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const filtered = Boolean(q || status || from || to);
  const filterParams = { ...(q && { q }), ...(status && { status }), ...(from && { from }), ...(to && { to }) };
  const link = (p: number) => `/pengiriman?${new URLSearchParams({ ...filterParams, page: String(p) })}`;
  const exportHref = `/pengiriman/export.csv${Object.keys(filterParams).length > 0 ? `?${new URLSearchParams(filterParams)}` : ""}`;
  const isAdmin = ws.role === "tenant_admin" && !ws.isDemo;
  const attentionRows = attention.data ?? [];
  const attentionCount = attention.error ? null : (attention.count ?? attentionRows.length);

  const stats: ListStat[] = [
    {
      label: "Perlu tindakan", hint: "Belum pasti, gagal, antre, belum dibayar", count: attentionCount,
      href: "/pengiriman#perlu-tindakan", icon: AlertTriangle, tone: "text-warning", active: false,
    },
    {
      label: "Menunggu pembayaran", hint: "Periksa pembayaran batch di detail", count: awaiting.error ? null : (awaiting.count ?? 0),
      href: "/pengiriman?status=awaiting_payment", icon: Wallet, tone: "text-warning",
      active: status === "awaiting_payment" && !q && !from && !to,
    },
    {
      label: "Terbit hari ini", hint: "Dibuat dan terbit hari ini (WIB)", count: issuedToday.error ? null : (issuedToday.count ?? 0),
      href: `/pengiriman?${new URLSearchParams({ status: "issued", from: today, to: today })}`, icon: CheckCircle2, tone: "text-success",
      active: status === "issued" && from === today && to === today && !q,
    },
  ];

  // Applied filters as removable chips; each link drops one parameter and returns to page 1.
  const without = (key: keyof typeof filterParams) => {
    const rest = new URLSearchParams(Object.entries(filterParams).filter(([k]) => k !== key));
    return rest.size > 0 ? `/pengiriman?${rest}` : "/pengiriman";
  };
  const chips = [
    q ? { label: `Cari: “${q}”`, href: without("q") } : null,
    status ? { label: `Status: ${SUBMISSION_LABEL[status]}`, href: without("status") } : null,
    from ? { label: `Dari ${dayLabel.format(new Date(`${from}T00:00:00Z`))}`, href: without("from") } : null,
    to ? { label: `Sampai ${dayLabel.format(new Date(`${to}T00:00:00Z`))}`, href: without("to") } : null,
  ].filter((c) => c !== null);

  const pageWindow = [...new Set([1, page - 1, page, page + 1, pages])].filter((p) => p >= 1 && p <= pages).sort((a, b) => a - b);

  return (
    <div className="flex flex-col gap-6 lg:gap-8">
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-3xl tracking-tight">Pengiriman</h1>
          <p className="text-[15px] text-muted-foreground">{ws.outlet.name} · data per {formatWib(new Date().toISOString())}</p>
        </div>
        <CreateDraftButton className="w-full md:w-auto" />
      </header>

      {params.galat ? (
        <Alert variant="destructive">
          <AlertTriangle aria-hidden="true" />
          <AlertDescription className="text-[15px] text-foreground">{friendlyError({ message: params.galat })}</AlertDescription>
        </Alert>
      ) : null}
      {params.reset ? (
        <Alert role="status" className="border-border">
          <CheckCircle2 aria-hidden="true" className="text-success" />
          <AlertDescription className="text-[15px] text-foreground">Demo sudah dikembalikan ke contoh awal.</AlertDescription>
        </Alert>
      ) : null}

      <StatStrip stats={stats} />

      {!filtered && page === 1 && attentionRows.length > 0 ? (
        <section id="perlu-tindakan" aria-labelledby="attention-heading" className="flex scroll-mt-20 flex-col gap-3">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <h2 id="attention-heading" className="text-xl">Perlu ditindaklanjuti</h2>
            <p className="text-sm text-muted-foreground">
              {attentionCount !== null && attentionCount > attentionRows.length
                ? `${attentionRows.length} terlama dari ${attentionCount}`
                : "Terlama di atas"}
            </p>
          </div>
          <ul className="divide-y divide-border overflow-hidden rounded-lg bg-card ring-1 ring-border">
            {attentionRows.map((s) => (
              <li key={s.id}>
                <Link href={`/pengiriman/${s.id}`} prefetch={false} className="flex min-h-14 items-center gap-3 px-4 py-3 transition-colors hover:bg-muted">
                  <span className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate font-semibold whitespace-nowrap tabular">{s.reference}</span>
                      <span className="truncate text-sm text-muted-foreground">{s.recipient_name ?? "Penerima belum diisi"}</span>
                    </span>
                    <StatusBadge state={s.submission_state} />
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="sr-only">Periksa</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="list-heading" className="flex flex-col gap-4">
        <h2 id="list-heading" className="text-xl">Daftar pengiriman</h2>
        <ShipmentFilters q={q} status={status} from={from} to={to} />

        {chips.length > 0 || isAdmin ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            {chips.length > 0 ? (
              <ul aria-label="Filter aktif" className="flex flex-wrap items-center gap-2">
                {chips.map((c) => (
                  <li key={c.label}>
                    <Link href={c.href} className="inline-flex min-h-11 max-w-full items-center gap-2 rounded-full bg-card pr-3 pl-4 text-sm ring-1 ring-border transition-colors hover:bg-muted">
                      <span className="sr-only">Hapus filter </span>
                      <span className="truncate">{c.label}</span>
                      <X className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    </Link>
                  </li>
                ))}
                {chips.length > 1 ? (
                  <li><Button asChild variant="link" size="sm"><Link href="/pengiriman">Hapus filter</Link></Button></li>
                ) : null}
              </ul>
            ) : <span />}
            {isAdmin ? (
              <div className="flex items-center gap-3">
                <p className="hidden text-sm text-muted-foreground sm:block">
                  Semua hasil filter, maks. {EXPORT_ROW_CAP.toLocaleString("id-ID")} baris
                </p>
                <Button asChild variant="outline" size="sm">
                  <a href={exportHref} download><Download data-icon="inline-start" aria-hidden="true" /> Ekspor CSV</a>
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}

        {error?.code === "PGRST103" ? (
          <Empty className="rounded-lg bg-card p-8 ring-1 ring-border">
            <EmptyHeader>
              <EmptyTitle>Halaman {page} tidak tersedia.</EmptyTitle>
              <EmptyDescription>Daftar ini lebih pendek dari itu. Mulai lagi dari halaman pertama.</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button asChild variant="outline"><Link href={link(1)}>Ke halaman pertama</Link></Button>
            </EmptyContent>
          </Empty>
        ) : error ? (
          <Alert variant="destructive">
            <AlertTriangle aria-hidden="true" />
            <AlertDescription className="text-[15px] text-foreground">Daftar belum bisa dimuat. Muat ulang halaman.</AlertDescription>
          </Alert>
        ) : rows && rows.length > 0 ? (
          <>
            <ShipmentRows key={rows.map((row) => row.id).join(",")} rows={rows} />
            <div className="flex flex-col items-center gap-2 sm:flex-row sm:justify-between">
              <p className="text-sm text-muted-foreground tabular">{total} pengiriman · halaman {page} dari {pages}</p>
              {pages > 1 ? (
                <Pagination aria-label="Halaman" className="mx-0 w-auto">
                  <PaginationContent>
                    {page > 1 ? (
                      <PaginationItem>
                        <Button asChild variant="ghost" className="px-3">
                          <Link href={link(page - 1)} aria-label="Halaman sebelumnya">
                            <ChevronLeft aria-hidden="true" /><span className="hidden sm:inline">Sebelumnya</span>
                          </Link>
                        </Button>
                      </PaginationItem>
                    ) : null}
                    {pageWindow.map((p, i) => (
                      <PaginationItem key={p} className={cn("items-center", p === page ? "flex" : "hidden sm:flex")}>
                        {i > 0 && p - pageWindow[i - 1] > 1 ? <span aria-hidden="true" className="px-1 text-muted-foreground">…</span> : null}
                        <Button asChild variant={p === page ? "outline" : "ghost"} size="icon" className="tabular">
                          <Link href={link(p)} aria-current={p === page ? "page" : undefined} aria-label={`Halaman ${p}`}>{p}</Link>
                        </Button>
                      </PaginationItem>
                    ))}
                    {page < pages ? (
                      <PaginationItem>
                        <Button asChild variant="ghost" className="px-3">
                          <Link href={link(page + 1)} aria-label="Halaman berikutnya">
                            <span className="hidden sm:inline">Berikutnya</span><ChevronRight aria-hidden="true" />
                          </Link>
                        </Button>
                      </PaginationItem>
                    ) : null}
                  </PaginationContent>
                </Pagination>
              ) : null}
            </div>
            {total > EXPORT_ROW_CAP && isAdmin ? <p className="text-sm text-muted-foreground">{TRUNCATION_NOTE}</p> : null}
          </>
        ) : filtered ? (
          <Empty className="rounded-lg bg-card p-8 ring-1 ring-border">
            <EmptyHeader>
              <EmptyMedia variant="icon"><SearchX aria-hidden="true" /></EmptyMedia>
              <EmptyTitle>Tidak ada pengiriman yang cocok dengan filter ini.</EmptyTitle>
              <EmptyDescription>Ubah atau hapus filter di atas untuk melihat pengiriman lain.</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button asChild variant="outline"><Link href="/pengiriman">Hapus semua filter</Link></Button>
            </EmptyContent>
          </Empty>
        ) : (
          <Empty className="rounded-lg bg-card p-8 ring-1 ring-border">
            <EmptyHeader>
              <EmptyMedia variant="icon"><Package aria-hidden="true" /></EmptyMedia>
              <EmptyTitle>Belum ada pengiriman di {ws.outlet.name}.</EmptyTitle>
              <EmptyDescription>
                Buat draf, cek ongkir, lalu konfirmasi untuk menerbitkan resi. Draf belum menjadi pesanan sampai Anda mengonfirmasi.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <CreateDraftButton>Buat pengiriman pertama</CreateDraftButton>
            </EmptyContent>
          </Empty>
        )}
      </section>
    </div>
  );
}
