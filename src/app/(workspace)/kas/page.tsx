import type { Metadata } from "next";
import Link from "next/link";
import { Notice } from "@/components/notice";
import { dbServer } from "@/lib/db/server";
import { formatIdr, formatWib } from "@/lib/format";
import { requireWorkspace } from "@/lib/workspace";
import { CashPeriodDialog } from "@/modules/payments/cash-period-dialog";
import { cashPeriodTotals, type CashPeriod, type PeriodPayment } from "@/modules/payments/cash-periods";
import { PAYMENT_METHODS, PAYMENT_METHOD_LABEL } from "@/modules/payments/messages";
import { isPresentableRupiah, UNSUPPORTED_PAYMENT_AMOUNT } from "@/modules/payments/money";

export const metadata: Metadata = { title: "Kas" };

// PostgREST caps rows per response. Never silently compute a close preview from a truncated period.
async function allRows<T>(query: (start: number, end: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const rows: T[] = [];
  for (let start = 0; ; start += 500) {
    const result = await query(start, start + 499);
    if (result.error || !result.data) throw new Error("cash_read_failed");
    rows.push(...result.data);
    if (result.data.length < 500) return rows;
  }
}

export default async function CashPage() {
  const ws = await requireWorkspace();
  const db = await dbServer();
  const columns = "id,outlet_id,opened_at,closed_at,closed_by,counted_cash_idr,expected_cash_idr,variance_idr";
  const money = (value: number | null) => `${formatIdr(value)}${ws.isDemo ? " (contoh)" : ""}`;
  // No staff-name field exists (DEC-026): distinguish members by order within the period and mark the
  // signed-in member, never by a raw user id (a prefix is not unique and is meaningless to staff).
  const staffName = (staff: { id: string; label: string }, index: number) =>
    `${staff.label} ${index + 1}${staff.id === ws.userId ? " (Anda)" : ""}`;
  const closedBy = (id: string | null) => id === ws.userId ? "oleh Anda" : id ? "oleh petugas lain" : "petugas tidak diketahui";
  let content;
  try {
    const [outlets, open, closedResult] = await Promise.all([
      allRows<{ id: string; name: string }>((a, b) => db.from("outlets").select("id,name").eq("tenant_id", ws.tenant.id).order("id").range(a, b)),
      allRows<CashPeriod>((a, b) => db.from("cash_periods").select(columns).eq("tenant_id", ws.tenant.id).is("closed_at", null).order("id").range(a, b)),
      db.from("cash_periods").select(columns).eq("tenant_id", ws.tenant.id).not("closed_at", "is", null).order("closed_at", { ascending: false }).order("id").limit(20).returns<CashPeriod[]>(),
    ]);
    if (closedResult.error) throw new Error("cash_read_failed");
    const closed = closedResult.data ?? [];
    const periods = await Promise.all([...open, ...closed].map(async (period) => {
      const payments = await allRows<PeriodPayment>((a, b) => db.from("counter_payments")
        .select("method,amount_idr,recorded_by,recorded_by_label").eq("tenant_id", ws.tenant.id)
        .eq("period_id", period.id).is("voided_at", null).order("id").range(a, b));
      if (period.closed_at && (!isPresentableRupiah(period.counted_cash_idr) || !isPresentableRupiah(period.expected_cash_idr)
        || !Number.isSafeInteger(period.variance_idr))) throw new Error(UNSUPPORTED_PAYMENT_AMOUNT);
      return { period, totals: cashPeriodTotals(payments) };
    }));
    const names = new Map(outlets.map((o) => [o.id, o.name]));
    const renderPeriod = ({ period, totals }: typeof periods[number]) => <article key={period.id} data-testid={`cash-period-${period.id}`} className="flex flex-col gap-4 rounded-lg bg-card p-4 ring-1 ring-border sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0"><h3 className="text-lg font-semibold break-words">{names.get(period.outlet_id) ?? "Outlet"}</h3>
          <p className="text-sm text-muted-foreground">{period.closed_at ? "Ditutup" : "Periode terbuka"} · Mulai {formatWib(period.opened_at)}</p>
        </div>
        {!period.closed_at || ws.role === "tenant_admin" ? <CashPeriodDialog period={period} outlet={names.get(period.outlet_id) ?? "Outlet"} totals={totals} isDemo={ws.isDemo} reopen={!!period.closed_at} /> : null}
      </div>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">{PAYMENT_METHODS.map((m) => <div key={m}><dt className="text-sm text-muted-foreground">{PAYMENT_METHOD_LABEL[m]}</dt><dd className="tabular break-words">{money(totals.methods[m])}</dd></div>)}</dl>
      <div><h4 className="text-sm text-muted-foreground">Total per petugas</h4>
        {totals.staff.length ? <ul className="mt-2 flex flex-col gap-2 text-sm">{totals.staff.map((staff, index) => <li key={staff.id} className="flex flex-wrap justify-between gap-2"><span>{staffName(staff, index)}</span><span className="tabular">{money(staff.total)}</span></li>)}</ul> : <p>Belum ada pembayaran aktif.</p>}
      </div>
      <dl className="grid gap-3 border-t pt-4 sm:grid-cols-3">
        <div><dt className="text-sm text-muted-foreground">Tunai yang diharapkan</dt><dd className="tabular">{money(period.closed_at ? period.expected_cash_idr : totals.expected)}</dd></div>
        {period.closed_at ? <><div><dt className="text-sm text-muted-foreground">Tunai terhitung</dt><dd className="tabular">{money(period.counted_cash_idr)}</dd></div><div><dt className="text-sm text-muted-foreground">Selisih kas</dt><dd className="tabular">{money(period.variance_idr)}</dd></div></> : null}
      </dl>
      {period.closed_at ? <p className="text-sm text-muted-foreground break-words">Ditutup {formatWib(period.closed_at)} · {closedBy(period.closed_by)}</p> : null}
    </article>;
    content = <>
      <section className="flex flex-col gap-4" aria-labelledby="cash-open"><h2 id="cash-open" className="text-xl">Periode terbuka</h2>
        {periods.filter((p) => !p.period.closed_at).map(renderPeriod)}
        {outlets.filter((o) => !open.some((p) => p.outlet_id === o.id)).map((o) => <p key={o.id} className="text-muted-foreground">{o.name}: belum ada periode terbuka. Pembayaran berikutnya membuka periode baru.</p>)}
      </section>
      <section className="flex flex-col gap-4" aria-labelledby="cash-closed"><h2 id="cash-closed" className="text-xl">Periode ditutup terakhir</h2><p className="text-sm text-muted-foreground">Maksimal 20 periode terakhir. Pembukaan ulang tidak menghapus riwayat penutupan.</p>
        {closed.length ? periods.filter((p) => p.period.closed_at).map(renderPeriod) : <p className="text-muted-foreground">Belum ada periode ditutup.</p>}
      </section>
    </>;
  } catch (error) {
    content = <Notice tone="danger">{error instanceof Error && error.message === UNSUPPORTED_PAYMENT_AMOUNT ? UNSUPPORTED_PAYMENT_AMOUNT : "Kas belum bisa dimuat lengkap. Muat ulang halaman; jangan menutup kas sebelum data tersedia."}</Notice>;
  }
  return <div className="flex flex-col gap-6 lg:gap-8"><header><h1 className="text-3xl tracking-tight">Kas</h1><p className="mt-2 text-muted-foreground">Kas per outlet milik {ws.tenant.name}. Periode tetap terbuka melewati tengah malam sampai ditutup. Waktu ditampilkan dalam WIB.</p><p className="mt-1 text-sm text-muted-foreground">Total hanya pembayaran aktif. Selisih kas adalah uang terhitung dikurangi tunai yang diharapkan{ws.isDemo ? "; semua nilai merupakan contoh" : ""}.</p>{ws.role === "tenant_admin" ? <p className="mt-2"><Link href="/kas/laporan" className="font-semibold text-primary underline-offset-4 hover:underline">Laporan pilot</Link> <span className="text-sm text-muted-foreground">(khusus admin gerai)</span></p> : null}</header>{content}</div>;
}
