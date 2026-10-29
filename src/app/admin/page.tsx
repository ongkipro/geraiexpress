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

type TenantRow = { id: string; name: string; lifecycle: string; created_at: string; member_count: number; shipment_count: number };

type TenantIdentity = { id: string; slug: string; shipment_prefix: string };

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
export default async function PlatformTenantsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const session = await requirePlatform();
  // The platform landing page; an administrator without tenant governance goes to their first page.
  if (!session.capabilities.includes("tenant_governance")) {
    if (session.capabilities.includes("access_governance")) redirect("/admin/akses");
    if (session.capabilities.includes("audit_review")) redirect("/admin/audit");
    return (
      <div className="flex max-w-[680px] flex-col gap-6">
        <PageHeader title="Super Admin" description="Kemampuan Anda belum memiliki halaman di versi ini." />
      </div>
    );
  }
  const { status: requested } = await searchParams;
  const filter = requested && Object.hasOwn(LIFECYCLE, requested) ? requested : null;
  const integrations = session.capabilities.includes("integration_operations");
  const db = await dbServer();
  const [{ data: raw, error }, { data: open }, { data: identities }, { data: pending }, sellers, partner] = await Promise.all([
    db.rpc("platform_tenants"),
    db.rpc("registration_open"),
    db.rpc("platform_tenant_slugs"),
    db.rpc("platform_applications", { p_status: "submitted" }),
    integrations ? db.rpc("platform_integrations") : Promise.resolve(null),
    integrations ? db.rpc("platform_partner_config") : Promise.resolve(null),
  ]);
  const all = (raw ?? []) as TenantRow[];
  const data = filter ? all.filter((t) => t.lifecycle === filter) : all;
  // PR-37: the slug and the reference prefix are read-only display data; they never select a tenant.
  const identity = new Map(((identities ?? []) as TenantIdentity[]).map((i) => [i.id, i]));
  const count = (lifecycle: string) => all.filter((t) => t.lifecycle === lifecycle).length;

  const stats: Stat[] = [
    { label: "Pengajuan menunggu", value: ((pending ?? []) as unknown[]).length, href: "/admin/pengajuan", calm: "Tidak ada antrean", attention: "Perlu ditinjau", testId: "stat-applications" },
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
    { href: "/admin", label: "Semua", current: filter === null, count: all.length },
    ...Object.entries(LIFECYCLE)
      .filter(([key]) => key === "active" || key === "suspended" || count(key) > 0 || filter === key)
      .map(([key, l]) => ({ href: `/admin?status=${key}`, label: l.label, current: filter === key, count: count(key) })),
  ];

  return (
    <div className="flex max-w-[1160px] flex-col gap-8">
      <PageHeader
        title="Gerai"
        description="Semua bisnis terdaftar (gerai demo tidak ditampilkan). Isi kontak dan pengiriman pelanggan tidak terlihat di sini."
      />

      <StatStrip items={stats} />

      <section aria-labelledby="registration-heading" className="flex flex-col gap-4 rounded-lg bg-card p-5 ring-1 ring-border sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 id="registration-heading" className="text-xl font-semibold tracking-tight">Pendaftaran publik</h2>
          <p className="text-sm text-muted-foreground" data-testid="registration-state">
            {open ? "Terbuka: siapa pun dengan email terverifikasi bisa mengajukan gerai." : "Tertutup: hanya akun yang sudah ada dan demo yang bisa masuk."}
          </p>
        </div>
        <RegistrationSwitch open={Boolean(open)} />
      </section>

      <section aria-labelledby="directory-heading" className="flex flex-col gap-4">
        <SectionHeader id="directory-heading" title="Direktori gerai" description="Bekukan atau aktifkan kembali dengan alasan yang tercatat di audit." />
        <SegmentedNav label="Filter status gerai" items={filters} />
        {error ? (
          <LoadError href="/admin">Daftar gerai belum bisa dimuat.</LoadError>
        ) : data.length === 0 ? (
          <EmptyState
            icon={Building2}
            title={filter ? "Tidak ada gerai dengan status ini" : "Belum ada gerai terdaftar"}
            description={filter ? undefined : "Gerai muncul di sini setelah pengajuan disetujui."}
            action={filter
              ? <Button asChild variant="outline" size="sm"><Link href="/admin">Lihat semua gerai</Link></Button>
              : <Button asChild variant="outline" size="sm"><Link href="/admin/pengajuan">Buka pengajuan</Link></Button>}
          />
        ) : (
          <div className={RT.frame}>
            <Table className={RT.table}>
              <TableHeader className={RT.head}>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Gerai</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right max-2xl:hidden">Anggota</TableHead>
                  <TableHead className="text-right max-2xl:hidden">Pengiriman</TableHead>
                  <TableHead className="max-2xl:hidden">Terdaftar</TableHead>
                  <TableHead className="text-right"><span className="sr-only">Tindakan</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody className={RT.body}>
                {data.map((t) => {
                  const id = identity.get(t.id);
                  return (
                    <TableRow key={t.id} data-testid="platform-tenant"
                      className={cn(RT.row, "max-md:grid max-md:grid-cols-[minmax(0,1fr)_auto] max-md:gap-x-3")}>
                      <TableCell className={cn(RT.cell, "min-w-0")}>
                        <span className="block font-semibold break-words">{t.name}</span>
                        <span className="block text-sm text-muted-foreground 2xl:hidden">
                          <span className="tabular">{t.member_count}</span> anggota aktif · <span className="tabular">{t.shipment_count}</span> pengiriman · terdaftar {formatWib(t.created_at)}
                        </span>
                        {id ? (
                          <span className="block text-sm text-muted-foreground" data-testid="platform-tenant-slug">
                            Slug: <span className="font-mono">{id.slug}</span> · Awalan referensi: <span className="font-mono">{id.shipment_prefix}</span>
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell className={cn(RT.cell, "max-md:col-start-2 max-md:row-start-1")}>
                        <LifecycleBadge lifecycle={t.lifecycle} />
                      </TableCell>
                      <TableCell className="hidden text-right align-top tabular 2xl:table-cell">{t.member_count}</TableCell>
                      <TableCell className="hidden text-right align-top tabular 2xl:table-cell">{t.shipment_count}</TableCell>
                      <TableCell className="hidden align-top text-sm whitespace-nowrap text-muted-foreground 2xl:table-cell">{formatWib(t.created_at)}</TableCell>
                      <TableCell className={cn(RT.cell, "max-md:col-span-2 max-md:pt-2")}>
                        <div className="flex flex-wrap items-start gap-2 md:flex-nowrap md:justify-end">
                          <Button asChild variant="ghost" size="sm">
                            <Link href={`/admin/tenant/${t.id}`}><span>Kontrol gerai<span className="sr-only"> {t.name}</span></span><ChevronRight aria-hidden="true" /></Link>
                          </Button>
                          {t.lifecycle === "active" || t.lifecycle === "suspended" ? (
                            <LifecycleForm tenantId={t.id} tenantName={t.name} lifecycle={t.lifecycle} />
                          ) : null}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
    </div>
  );
}
