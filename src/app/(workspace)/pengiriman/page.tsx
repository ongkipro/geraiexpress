import type { Metadata } from "next";
import Link from "next/link";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/status-badge";
import { supabaseServer } from "@/lib/supabase/server";
import { friendlyError } from "@/lib/errors";
import { formatIdr, formatWib, formatWibShort, SUBMISSION_LABEL } from "@/lib/format";
import { requireWorkspace } from "@/lib/workspace";

export const metadata: Metadata = { title: "Pengiriman" };

const PAGE_SIZE = 20;
const ATTENTION = ["unknown", "failed", "queued", "in_flight"];

type Row = {
  id: string;
  reference: string;
  submission_state: string;
  sender_name: string | null;
  recipient_name: string | null;
  recipient_area: string | null;
  awb: string | null;
  customer_charge_idr: number | null;
  updated_at: string;
};

export default async function ShipmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; page?: string; reset?: string; galat?: string }>;
}) {
  const ws = await requireWorkspace();
  const params = await searchParams;
  const q = (params.q ?? "").replace(/[,()*%_\\]/g, " ").trim().slice(0, 80);
  const status = params.status && Object.hasOwn(SUBMISSION_LABEL, params.status) ? params.status : "";
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const supabase = await supabaseServer();

  let query = supabase
    .from("shipments")
    .select("id, reference, submission_state, sender_name, recipient_name, recipient_area, awb, customer_charge_idr, updated_at", { count: "exact" })
    .eq("tenant_id", ws.tenant.id)
    .order("updated_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (status) query = query.eq("submission_state", status);
  if (q) query = query.or(`reference.ilike.*${q}*,sender_name.ilike.*${q}*,recipient_name.ilike.*${q}*,awb.ilike.*${q}*`);
  const [{ data: rows, count, error }, { data: attention }] = await Promise.all([
    query.returns<Row[]>(),
    supabase.from("shipments").select("id, reference, submission_state, recipient_name, updated_at")
      .eq("tenant_id", ws.tenant.id).in("submission_state", ATTENTION).order("updated_at").limit(10)
      .returns<Pick<Row, "id" | "reference" | "submission_state" | "recipient_name" | "updated_at">[]>(),
  ]);
  const total = count ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const filtered = Boolean(q || status);
  const link = (p: number) => `/pengiriman?${new URLSearchParams({ ...(q && { q }), ...(status && { status }), page: String(p) })}`;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl tracking-tight">Pengiriman</h1>
          <p className="text-muted-foreground">Data per {formatWib(new Date().toISOString())}</p>
        </div>
        <Button asChild><Link href="/pengiriman/baru">Buat pengiriman</Link></Button>
      </div>

      {params.galat ? (
        <p role="alert" className="rounded-md bg-card p-4 ring-1 ring-foreground"><span aria-hidden="true">⚠ </span>{friendlyError({ message: params.galat })}</p>
      ) : null}
      {params.reset ? (
        <p role="status" className="rounded-md bg-card p-4 ring-1 ring-border">Demo sudah dikembalikan ke contoh awal.</p>
      ) : null}

      {attention && attention.length > 0 ? (
        <section aria-labelledby="attention-heading" className="flex flex-col gap-3">
          <h2 id="attention-heading" className="text-xl">Perlu ditindaklanjuti</h2>
          <ul className="divide-y divide-border rounded-lg bg-card ring-1 ring-border">
            {attention.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="flex min-w-0 flex-col gap-1">
                  <span className="font-semibold tabular">{s.reference}</span>
                  <span className="truncate text-sm text-muted-foreground">{s.recipient_name ?? "Penerima belum diisi"}</span>
                </div>
                <div className="flex items-center gap-3">
                  <StatusBadge state={s.submission_state} />
                  <Button asChild variant="outline" size="sm"><Link href={`/pengiriman/${s.id}`} prefetch={false}>Periksa</Link></Button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="list-heading" className="flex flex-col gap-4">
        <h2 id="list-heading" className="sr-only">Daftar pengiriman</h2>
        <form className="flex flex-wrap items-end gap-3" role="search">
          <div className="flex min-w-[min(100%,280px)] flex-1 flex-col gap-2">
            <Label htmlFor="q">Cari</Label>
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input id="q" name="q" defaultValue={q} placeholder="Referensi, nama, atau resi" className="rounded-full pl-10" />
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="status">Status</Label>
            <select id="status" name="status" defaultValue={status}
              className="min-h-11 rounded-sm border border-input bg-card px-3 text-base">
              <option value="">Semua status</option>
              {Object.entries(SUBMISSION_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <Button type="submit" variant="outline">Terapkan</Button>
          {filtered ? <Button asChild variant="link"><Link href="/pengiriman">Hapus filter</Link></Button> : null}
        </form>

        {error?.code === "PGRST103" ? (
          <div className="flex flex-col items-start gap-3 rounded-lg bg-card p-6 ring-1 ring-border">
            <p>Halaman {page} tidak tersedia.</p>
            <Button asChild variant="outline"><Link href={link(1)}>Ke halaman pertama</Link></Button>
          </div>
        ) : error ? (
          <p role="alert" className="rounded-md bg-card p-4 ring-1 ring-border">Daftar belum bisa dimuat. Muat ulang halaman.</p>
        ) : rows && rows.length > 0 ? (
          <>
            {/* Row links skip prefetch: each would render a dynamic page on the server. */}
            <ul className="flex flex-col divide-y divide-border rounded-lg bg-card ring-1 ring-border md:hidden">
              {rows.map((s) => (
                <li key={s.id}>
                  <Link href={`/pengiriman/${s.id}`} prefetch={false} className="flex flex-col gap-2 p-4">
                    <span className="flex items-center justify-between gap-3">
                      <span className="font-semibold tabular" data-testid="shipment-ref">{s.reference}</span>
                      <StatusBadge state={s.submission_state} />
                    </span>
                    <span className="text-sm text-muted-foreground">
                      {s.sender_name ?? "—"} → {s.recipient_name ?? "—"}
                    </span>
                    <span className="flex justify-between text-sm">
                      <span className="tabular">{s.awb ?? "Belum ada resi"}</span>
                      <span className="tabular">{formatIdr(s.customer_charge_idr)}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
            <div className="hidden overflow-x-auto rounded-lg bg-card ring-1 ring-border md:block">
              <table className="w-full min-w-[780px] text-left text-sm">
                <caption className="sr-only">Pengiriman, terbaru di atas</caption>
                <thead className="border-b border-border text-muted-foreground">
                  <tr>
                    <th scope="col" className="px-3 py-3 font-semibold">Referensi</th>
                    <th scope="col" className="px-3 py-3 font-semibold">Pengirim → Penerima</th>
                    <th scope="col" className="px-3 py-3 font-semibold">Status</th>
                    <th scope="col" className="px-3 py-3 font-semibold">Resi</th>
                    <th scope="col" className="px-3 py-3 text-right font-semibold">Ongkir pelanggan</th>
                    <th scope="col" className="px-3 py-3 font-semibold">Diperbarui (WIB)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((s) => (
                    <tr key={s.id}>
                      <td className="px-3 py-3 whitespace-nowrap">
                        <Link href={`/pengiriman/${s.id}`} prefetch={false} className="inline-flex min-h-11 items-center font-semibold text-primary tabular" data-testid="shipment-ref">{s.reference}</Link>
                      </td>
                      <td className="max-w-[220px] px-3 py-3">
                        <span className="block truncate" title={`${s.sender_name ?? "—"} → ${s.recipient_name ?? "—"}`}>{s.sender_name ?? "—"} → {s.recipient_name ?? "—"}</span>
                        <span className="block truncate text-muted-foreground">{s.recipient_area ?? ""}</span>
                      </td>
                      <td className="px-3 py-3"><StatusBadge state={s.submission_state} /></td>
                      <td className="px-3 py-3 tabular">{s.awb ?? "—"}</td>
                      <td className="px-3 py-3 text-right tabular">{formatIdr(s.customer_charge_idr)}</td>
                      <td className="px-3 py-3 whitespace-nowrap tabular">{formatWibShort(s.updated_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <nav aria-label="Halaman" className="flex items-center justify-between gap-3">
              <span className="text-sm text-muted-foreground">
                {total} pengiriman · halaman {page} dari {pages}
              </span>
              <span className="flex gap-2">
                {page > 1 ? <Button asChild variant="outline" size="sm"><Link href={link(page - 1)}>Sebelumnya</Link></Button> : null}
                {page < pages ? <Button asChild variant="outline" size="sm"><Link href={link(page + 1)}>Berikutnya</Link></Button> : null}
              </span>
            </nav>
          </>
        ) : filtered ? (
          <p className="rounded-lg bg-card p-6 ring-1 ring-border">Tidak ada pengiriman yang cocok dengan filter ini.</p>
        ) : (
          <div className="flex flex-col items-start gap-3 rounded-lg bg-card p-6 ring-1 ring-border">
            <p>Belum ada pengiriman di {ws.outlet.name}.</p>
            <Button asChild><Link href="/pengiriman/baru">Buat pengiriman pertama</Link></Button>
          </div>
        )}
      </section>
    </div>
  );
}
