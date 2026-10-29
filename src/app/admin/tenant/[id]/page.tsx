import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCircle2, ChevronRight, EyeOff } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatWib } from "@/lib/format";
import { requirePlatform } from "@/lib/platform";
import { dbServer } from "@/lib/db/server";
import { MaskingForm } from "@/modules/tenants/masking-form";
import { LifecycleBadge, PageHeader } from "../../ui";

export const metadata: Metadata = { title: "Detail gerai · Super Admin" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LINK = "inline-flex min-h-11 items-center gap-1 self-start font-semibold text-primary underline-offset-4 hover:underline";

type Masking = { tenant_name: string; lifecycle: string; masking_allowed: boolean; last_changed_at: string | null; last_outcome: string | null };
type TenantRow = { id: string; member_count: number; shipment_count: number; created_at: string };
type TenantIdentity = { id: string; slug: string; shipment_prefix: string };

// T-053 / DEC-018 item 3: per-gerai platform controls. Today: allow or disable sender masking. The id
// in the URL only selects a row the database returns to a tenant-governance administrator.
export default async function PlatformTenantPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePlatform("tenant_governance");
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const db = await dbServer();
  const [{ data }, { data: tenants }, { data: identities }] = await Promise.all([
    db.rpc("platform_tenant_masking", { p_tenant: id }),
    db.rpc("platform_tenants"),
    db.rpc("platform_tenant_slugs"),
  ]);
  const tenant = ((data ?? []) as Masking[])[0];
  if (!tenant) notFound();
  const counts = ((tenants ?? []) as TenantRow[]).find((t) => t.id === id);
  const identity = ((identities ?? []) as TenantIdentity[]).find((t) => t.id === id);

  const facts: [string, React.ReactNode][] = [
    ["Status", <LifecycleBadge key="s" lifecycle={tenant.lifecycle} />],
    ...(counts ? [
      ["Anggota aktif", <span key="m" className="tabular">{counts.member_count}</span>],
      ["Pengiriman", <span key="p" className="tabular">{counts.shipment_count}</span>],
      ["Terdaftar", formatWib(counts.created_at)],
    ] as [string, React.ReactNode][] : []),
    ...(identity ? [
      ["Slug", <span key="sl" className="font-mono">{identity.slug}</span>],
      ["Awalan referensi", <span key="pr" className="font-mono">{identity.shipment_prefix}</span>],
    ] as [string, React.ReactNode][] : []),
  ];

  return (
    <div className="flex max-w-[880px] flex-col gap-8">
      <PageHeader
        crumbs={[{ href: "/admin", label: "Gerai" }]}
        current={tenant.tenant_name}
        title={tenant.tenant_name}
        description="Kontrol platform untuk gerai ini. Isi kontak dan pengiriman pelanggan tidak terlihat di sini."
      />

      <section aria-labelledby="facts-heading" className="flex flex-col gap-3">
        <h2 id="facts-heading" className="text-xl font-semibold tracking-tight">Data gerai</h2>
        <dl className="divide-y divide-border rounded-lg bg-card px-5 ring-1 ring-border">
          {facts.map(([label, value]) => (
            <div key={label} className="flex min-h-12 items-center justify-between gap-4 py-3">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="text-right break-words">{value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-labelledby="masking-heading" className="flex flex-col gap-5 rounded-lg bg-card p-5 ring-1 ring-border md:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <h2 id="masking-heading" className="text-xl font-semibold tracking-tight">Masking pengirim di label</h2>
          {tenant.masking_allowed
            ? <Badge variant="success"><CheckCircle2 aria-hidden="true" />Diizinkan</Badge>
            : <Badge variant="neutral"><EyeOff aria-hidden="true" />Dinonaktifkan</Badge>}
        </div>
        <p className="text-sm text-muted-foreground">
          Masking mencetak nama dan nomor pengirim yang dimasukkan operator, bukan identitas gerai, dan menyembunyikan alamat pickup di label.
          Penerimaan kurir terhadap label bermasking belum terbukti. Standar per label tetap mati.
        </p>
        <div className="flex flex-col gap-1 border-y border-border py-4">
          <p data-testid="masking-state" className="font-semibold">
            {tenant.masking_allowed ? "Diizinkan: gerai ini bisa memilih masking per label." : "Dinonaktifkan: label gerai ini selalu memakai identitas gerai."}
          </p>
          <p className="text-sm text-muted-foreground" data-testid="masking-last-change">
            {tenant.last_changed_at
              ? `Perubahan terakhir: ${tenant.last_outcome === "allowed" ? "diizinkan" : "dinonaktifkan"} pada ${formatWib(tenant.last_changed_at)}.`
              : "Belum pernah diubah; nilai awal diizinkan."}
          </p>
        </div>
        <MaskingForm tenantId={id} tenantName={tenant.tenant_name} allowed={tenant.masking_allowed} />
        {session.capabilities.includes("audit_review") ? (
          <Link href="/admin/audit?jenis=tenant.masking" className={LINK}>Lihat audit izin masking<ChevronRight className="size-4" aria-hidden="true" /></Link>
        ) : (
          <p className="text-sm text-muted-foreground">Setiap perubahan tercatat di audit dan bisa ditinjau oleh admin dengan kemampuan Tinjau audit.</p>
        )}
      </section>

      {session.capabilities.includes("integration_operations") ? (
        <Link href={`/admin/diskon/${id}`} className="flex min-h-11 items-center justify-between gap-4 rounded-lg bg-card p-5 ring-1 ring-border transition-colors hover:bg-accent">
          <span className="flex flex-col gap-1">
            <span className="font-semibold">Atur diskon gerai</span>
            <span className="text-sm text-muted-foreground">Versi diskon, selisih teramati, dan riwayatnya.</span>
          </span>
          <ChevronRight className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
        </Link>
      ) : null}
    </div>
  );
}
