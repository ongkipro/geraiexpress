import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { AlertTriangle, Building2, CheckCircle2, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { config } from "@/lib/config";
import { keyMaterialFromReader } from "@/lib/credential-crypto";
import { formatWib } from "@/lib/format";
import { requirePlatform } from "@/lib/platform";
import { dbServer } from "@/lib/db/server";
import { cn } from "@/lib/utils";
import { LifecycleForm, RegistrationSwitch } from "./forms";
import { EmptyState, LIFECYCLE, LifecycleBadge, LoadError, PageHeader, RT, SectionHeader, SegmentedNav } from "./ui";

export const metadata: Metadata = { title: "Gerai · Super Admin" };

// T-092: one row per gerai (= one cabang) from platform_tenant_directory: readiness and activity counts only.
type DirectoryRow = {
  id: string; name: string; lifecycle: string; created_at: string; slug: string | null; shipment_prefix: string | null;
  member_count: number; connected: boolean; pickup_ready: boolean; shipments_30d: number; open_problems: number; last_shipment_at: string | null;
};
type Overview = {
  generated_at: string;
  tenants: { active: number; suspended: number; provisioning: number; total: number };
  applications_submitted: number;
  shipments_today: { created: number; issued: number };
  attention: { queued: number; in_flight: number; unknown: number; awaiting_payment: number; failed: number };
};
const PAGE_SIZE = 25;
// T-092: each overview signal drills down to the gerai that have it (read-only, no shipment detail).
const ATTENTION: Record<string, string> = {
  today: "Ada kiriman hari ini", unknown: "Ada hasil belum pasti", awaiting_payment: "Ada yang menunggu pembayaran",
  queue: "Ada yang antre / sedang dikirim", failed: "Ada yang gagal",
};

type Stat = { label: string; value: number; href: string; calm: string; attention: string; testId: string };

function StatStrip({ items }: { items: Stat[] }) {
  return (
    <nav aria-label="Perlu perhatian">
      <ul className={cn("grid divide-y divide-border rounded-lg bg-card ring-1 ring-border md:divide-x md:divide-y-0", items.length === 3 ? "md:grid-cols-3" : "md:grid-cols-2")}>
        {items.map((s) => {
          const needs = s.value > 0;
          const Icon = needs ? AlertTriangle : CheckCircle2;
          return (
            <li key={s.href} className="first:rounded-t-lg last:rounded-b-lg md:first:rounded-l-lg md:first:rounded-tr-none md:last:rounded-r-lg md:last:rounded-bl-none">
              <Link href={s.href} data-testid={s.testId}
                className="flex min-h-11 items-center justify-between gap-4 rounded-[inherit] p-4 transition-colors hover:bg-accent md:flex-col-reverse md:items-start md:justify-end md:gap-2 md:p-5">
                <span className="flex min-w-0 flex-col gap-1">
                  <span className="text-base font-semibold">{s.label}</span>
                  <span className={cn("inline-flex items-center gap-1.5 text-sm", needs ? "text-warning" : "text-success")}>
                    <Icon className="size-4 shrink-0" aria-hidden="true" />{needs ? s.attention : s.calm}
                  </span>
                </span>
                <span className="text-3xl font-semibold tracking-tight tabular">{s.value}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

// PR-15 / UI-4 / C7: exception-first overview (what needs a decision), then the business directory
// with lifecycle state; counts only, never customer records.
export default async function PlatformTenantsPage({ searchParams }: { searchParams: Promise<{ status?: string; q?: string; hal?: string; perhatian?: string }> }) {
  const session = await requirePlatform();
  // The platform landing page; an administrator without tenant governance goes to their first page.
  const governance = session.capabilities.includes("tenant_governance");
  // T-092: monitoring-only administrators read this overview and directory without the write controls.
  if (!governance && !session.capabilities.includes("platform_monitoring")) {
    // F4: every capability with a page lands on it (menu order: Operasional before Keamanan).
    if (session.capabilities.includes("integration_operations")) redirect("/admin/integrasi");
    if (session.capabilities.includes("access_governance")) redirect("/admin/akses");
    if (session.capabilities.includes("audit_review")) redirect("/admin/audit");
    return (
      <div className="flex max-w-[680px] flex-col gap-6">
        <PageHeader title="Super Admin" description="Kemampuan Anda belum memiliki halaman di versi ini." />
      </div>
    );
  }
  const { status: requested, q: rawQuery, hal, perhatian } = await searchParams;
  const attentionFilter = perhatian && Object.hasOwn(ATTENTION, perhatian) ? perhatian : null;
  const filter = requested && Object.hasOwn(LIFECYCLE, requested) ? requested : null;
  const query = (rawQuery ?? "").trim().slice(0, 80);
  const page = Math.max(1, Math.min(10_000, Number.parseInt(hal ?? "1", 10) || 1));
  const integrations = session.capabilities.includes("integration_operations");
  const db = await dbServer();
  const [{ data: overview, error: overviewError }, { data: dir, error }, { data: open }, sellers, partner] = await Promise.all([
    db.rpc("platform_overview"),
    db.rpc("platform_tenant_directory", { p_query: query || null, p_lifecycle: filter, p_limit: PAGE_SIZE, p_offset: (page - 1) * PAGE_SIZE, p_attention: attentionFilter }),
    governance ? db.rpc("registration_open") : Promise.resolve({ data: null }),
    integrations ? db.rpc("platform_integrations") : Promise.resolve(null),
    integrations ? db.rpc("platform_partner_config") : Promise.resolve(null),
  ]);
  const ov = overview as Overview | null;
  const directory = (dir ?? { total: 0, rows: [] }) as { total: number; rows: DirectoryRow[] };
  const data = directory.rows;
  const pages = Math.max(1, Math.ceil(directory.total / PAGE_SIZE));
  const counts = (ov?.tenants ?? {}) as Record<string, number>;
  const count = (lifecycle: string) => counts[lifecycle] ?? 0;
  const pending = ov?.applications_submitted ?? 0;
  const keep = (extra: Record<string, string | null>) => {
    const params = new URLSearchParams(Object.entries({ q: query || null, status: filter, perhatian: attentionFilter, ...extra }).filter(([, v]) => v) as [string, string][]);
    return params.size ? `/admin?${params}` : "/admin";
  };

  const stats: Stat[] = [
    { label: "Pengajuan menunggu", value: pending, href: "/admin/pengajuan", calm: "Tidak ada antrean", attention: "Perlu ditinjau", testId: "stat-applications" },
    { label: "Gerai dibekukan", value: count("suspended"), href: "/admin?status=suspended", calm: "Tidak ada", attention: "Lihat daftar", testId: "stat-suspended" },
  ];
  if (sellers && partner) {
    const disconnected = ((sellers.data ?? []) as { lifecycle: string; configured: boolean }[]).filter((s) => s.lifecycle === "active" && !s.configured).length;
    const partnerId = ((partner.data ?? []) as { partner_id: string | null }[])[0]?.partner_id ?? null;
    const gaps = [Boolean(partnerId), Boolean(config("MENGANTAR_PARTNER_SECRET")), Boolean(keyMaterialFromReader(config))].filter((ok) => !ok).length;
    stats.push({
      label: "Gerai aktif belum terhubung",
      value: disconnected,
      href: "/admin/integrasi",
      calm: gaps ? `${gaps} konfigurasi platform belum lengkap` : "Konfigurasi platform lengkap",
      attention: gaps ? `Juga ${gaps} konfigurasi platform belum lengkap` : "Belum ada kunci API Mengantar",
      testId: "stat-integrations",
    });
  }

  const filters = [
    { href: keep({ status: null }), label: "Semua", current: filter === null, count: counts.total ?? 0 },
    ...Object.entries(LIFECYCLE)
      .filter(([key]) => key === "active" || key === "suspended" || count(key) > 0 || filter === key)
      .map(([key, l]) => ({ href: keep({ status: key }), label: l.label, current: filter === key, count: count(key) })),
  ];

  const attention = ov?.attention;
  const monitor: { label: string; value: number | null; hint: string; testId: string; href: string | null }[] = [
    { label: "Gerai aktif", value: ov?.tenants.active ?? null, hint: `${ov?.tenants.total ?? "—"} gerai terdaftar (1 gerai = 1 cabang)`, testId: "ov-active", href: "/admin?status=active" },
    { label: "Pengajuan menunggu", value: pending, hint: governance ? "Perlu ditinjau" : "Ditinjau admin tata kelola gerai", testId: "ov-applications", href: governance ? "/admin/pengajuan" : "/admin/pantau-pengajuan" },
    { label: "Dibuat hari ini (WIB)", value: ov?.shipments_today.created ?? null, hint: `${ov?.shipments_today.issued ?? "—"} resi terbit hari ini`, testId: "ov-today", href: "/admin?perhatian=today" },
    { label: "Hasil belum pasti", value: attention?.unknown ?? null, hint: "Perlu dicek gerai terkait", testId: "ov-unknown", href: "/admin?perhatian=unknown" },
    { label: "Menunggu pembayaran", value: attention?.awaiting_payment ?? null, hint: "Saldo Mengantar gerai belum cukup", testId: "ov-awaiting", href: "/admin?perhatian=awaiting_payment" },
    { label: "Antre / sedang dikirim", value: attention ? attention.queued + attention.in_flight : null, hint: "Dikirim otomatis oleh sistem", testId: "ov-queued", href: "/admin?perhatian=queue" },
    { label: "Gagal", value: attention?.failed ?? null, hint: "Ditutup atau dibuka ulang oleh gerai", testId: "ov-failed", href: "/admin?perhatian=failed" },
  ];

  return (
    <div className="flex max-w-[1160px] flex-col gap-8">
      <PageHeader
        title="Gerai"
        description="Pemantauan semua gerai (1 gerai = 1 cabang; gerai demo tidak ditampilkan). Super Admin hanya memantau; transaksi tetap urusan gerai."
      />

      <section aria-labelledby="overview-heading" className="flex flex-col gap-3">
        <SectionHeader id="overview-heading" title="Ringkasan platform"
          description={ov ? `Diperbarui ${formatWib(ov.generated_at)}. Angka gabungan kiriman nyata; tanpa data pelanggan.` : undefined} />
        {overviewError ? (
          <LoadError href="/admin">Ringkasan platform belum bisa dimuat.</LoadError>
        ) : (
          <ul className="grid gap-px overflow-hidden rounded-lg bg-border ring-1 ring-border sm:grid-cols-2 lg:grid-cols-3" data-testid="platform-overview">
            {monitor.map((m) => {
              const body = (
                <>
                  <span className="text-sm text-muted-foreground">{m.label}</span>
                  <span className="text-3xl font-semibold tracking-tight tabular">{m.value ?? "—"}</span>
                  <span className="text-sm text-muted-foreground">{m.hint}</span>
                </>
              );
              return (
                <li key={m.testId} className="bg-card" data-testid={m.testId}>
                  {m.href ? (
                    <Link href={m.href} className="flex min-h-11 flex-col gap-1 p-4 transition-colors hover:bg-accent">{body}</Link>
                  ) : <div className="flex flex-col gap-1 p-4">{body}</div>}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {governance ? <StatStrip items={stats} /> : null}

      {governance ? (
        <section aria-labelledby="registration-heading" className="flex flex-col gap-4 rounded-lg bg-card p-5 ring-1 ring-border sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 flex-col gap-1">
            <h2 id="registration-heading" className="text-xl font-semibold tracking-tight">Pendaftaran publik</h2>
            <p className="text-sm text-muted-foreground" data-testid="registration-state">
              {open ? "Terbuka: siapa pun dengan email terverifikasi bisa mengajukan gerai." : "Tertutup: hanya akun yang sudah ada dan demo yang bisa masuk."}
            </p>
          </div>
          <RegistrationSwitch open={Boolean(open)} />
        </section>
      ) : null}

      <section aria-labelledby="directory-heading" className="flex flex-col gap-4">
        <SectionHeader id="directory-heading" title="Direktori gerai"
          description={governance ? "Cari, saring, lalu buka halaman gerai. Bekukan atau aktifkan kembali dengan alasan yang tercatat di audit." : "Cari, saring, lalu buka halaman gerai."} />
        <form role="search" action="/admin" className="flex flex-col gap-3 rounded-lg bg-card p-4 ring-1 ring-border md:flex-row md:items-end">
          {filter ? <input type="hidden" name="status" value={filter} /> : null}
          {attentionFilter ? <input type="hidden" name="perhatian" value={attentionFilter} /> : null}
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <label htmlFor="tenant-q" className="text-sm font-semibold">Cari gerai (nama atau slug)</label>
            <input id="tenant-q" name="q" type="search" defaultValue={query} maxLength={80}
              className="min-h-11 w-full rounded-full border border-input bg-card px-4 text-base" />
          </div>
          <Button type="submit" variant="outline">Cari</Button>
        </form>
        <SegmentedNav label="Filter status gerai" items={filters} />
        {attentionFilter ? (
          <p className="flex flex-wrap items-center gap-2 text-sm" data-testid="attention-filter">
            <span>Disaring: <span className="font-semibold">{ATTENTION[attentionFilter]}</span></span>
            <Link href={keep({ perhatian: null })} className="inline-flex min-h-11 items-center font-semibold text-primary underline-offset-4 hover:underline">Hapus saringan</Link>
          </p>
        ) : null}
        {error ? (
          <LoadError href="/admin">Daftar gerai belum bisa dimuat.</LoadError>
        ) : data.length === 0 ? (
          <EmptyState
            icon={Building2}
            title={query || filter || attentionFilter ? "Tidak ada gerai yang cocok" : "Belum ada gerai terdaftar"}
            description={query || filter || attentionFilter ? undefined : "Gerai muncul di sini setelah pengajuan disetujui."}
            action={query || filter || attentionFilter
              ? <Button asChild variant="outline" size="sm"><Link href="/admin">Lihat semua gerai</Link></Button>
              : governance ? <Button asChild variant="outline" size="sm"><Link href="/admin/pengajuan">Buka pengajuan</Link></Button> : undefined}
          />
        ) : (
          <div className={RT.frame}>
            <Table className={RT.table}>
              <TableHeader className={RT.head}>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Gerai</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Kesiapan</TableHead>
                  <TableHead className="text-right">Kiriman 30 hari</TableHead>
                  <TableHead className="text-right"><span className="sr-only">Tindakan</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody className={RT.body}>
                {data.map((t) => (
                  <TableRow key={t.id} data-testid="platform-tenant"
                    className={cn(RT.row, "max-md:grid max-md:grid-cols-[minmax(0,1fr)_auto] max-md:gap-x-3")}>
                    <TableCell className={cn(RT.cell, "min-w-0")}>
                      <span className="block font-semibold break-words">{t.name}</span>
                      <span className="block text-sm text-muted-foreground">
                        <span className="tabular">{t.member_count}</span> anggota aktif · terdaftar {formatWib(t.created_at)}
                      </span>
                      {t.slug ? (
                        <span className="block text-sm text-muted-foreground" data-testid="platform-tenant-slug">
                          Slug: <span className="font-mono">{t.slug}</span> · Awalan referensi: <span className="font-mono">{t.shipment_prefix}</span>
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className={cn(RT.cell, "max-md:col-start-2 max-md:row-start-1")}>
                      <LifecycleBadge lifecycle={t.lifecycle} />
                    </TableCell>
                    <TableCell className={cn(RT.cell, "text-sm")}>
                      <span className="block">{t.connected ? "Akun Mengantar terhubung" : "Akun Mengantar belum terhubung"}</span>
                      <span className="block text-muted-foreground">{t.pickup_ready ? "Alamat pickup siap" : "Alamat pickup belum dipilih"}</span>
                    </TableCell>
                    <TableCell className={cn(RT.cell, "text-sm md:text-right")}>
                      <span className="tabular font-semibold">{t.shipments_30d}</span><span className="md:hidden"> kiriman 30 hari</span>
                      {t.open_problems > 0 ? <span className="block text-warning" data-testid="tenant-open-problems">{t.open_problems} perlu perhatian</span> : null}
                      <span className="block text-muted-foreground">{t.last_shipment_at ? `Terakhir ${formatWib(t.last_shipment_at)}` : "Belum ada kiriman"}</span>
                    </TableCell>
                    <TableCell className={cn(RT.cell, "max-md:col-span-2 max-md:pt-2")}>
                      <div className="flex flex-wrap items-start gap-2 md:flex-nowrap md:justify-end">
                        <Button asChild variant="ghost" size="sm">
                          <Link href={`/admin/tenant/${t.id}`}><span>Kontrol gerai<span className="sr-only"> {t.name}</span></span><ChevronRight aria-hidden="true" /></Link>
                        </Button>
                        {governance && (t.lifecycle === "active" || t.lifecycle === "suspended") ? (
                          <LifecycleForm tenantId={t.id} tenantName={t.name} lifecycle={t.lifecycle} />
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        {pages > 1 ? (
          <nav aria-label="Halaman direktori" className="flex items-center justify-between gap-3 text-sm">
            <span className="text-muted-foreground">Halaman {page} dari {pages} · {directory.total} gerai</span>
            <span className="flex gap-2">
              {page > 1 ? <Button asChild variant="outline" size="sm"><Link href={keep({ hal: String(page - 1) })}>Sebelumnya</Link></Button> : null}
              {page < pages ? <Button asChild variant="outline" size="sm"><Link href={keep({ hal: String(page + 1) })}>Berikutnya</Link></Button> : null}
            </span>
          </nav>
        ) : null}
      </section>
    </div>
  );
}
