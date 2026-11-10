import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCircle2, ChevronRight, EyeOff } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatIdr, formatWib, SUBMISSION_LABEL } from "@/lib/format";
import { LoadError } from "@/components/notice";
import { platformTitle, requirePlatform } from "@/lib/platform";
import { dbServer } from "@/lib/db/server";
import { MaskingForm } from "@/modules/tenants/masking-form";
import { TenantCustomersPanel } from "../../pelanggan/customer-forms";
import { LifecycleBadge, PageHeader } from "../../ui";

export const generateMetadata = (): Promise<Metadata> => platformTitle("Detail gerai · Super Admin", ["tenant_governance", "platform_monitoring"]);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LINK = "inline-flex min-h-11 items-center gap-1 self-start font-semibold text-primary underline-offset-4 hover:underline";

type Masking = { tenant_name: string; lifecycle: string; masking_allowed: boolean; last_changed_at: string | null; last_outcome: string | null };
type Summary = {
  id: string; name: string; lifecycle: string; created_at: string; slug: string | null; shipment_prefix: string | null; masking_allowed: boolean;
  member_count: number; admin_count: number;
  outlets: { name: string; pickup_area: string | null; pickup_ready: boolean }[];
  seller: { connected: boolean; mode: string | null; provider_env: string | null; since: string | null };
  discount: { gerai_discount_bps: number | null; status: string | null; effective_from: string | null };
  by_state: Record<string, number>;
  activity: { today: number; last_7_days: number; last_30_days: number; issued_30_days: number; cod_30_days: number; charge_30_days_idr: number | null; charge_unknown_30_days?: number; last_shipment_at: string | null };
};

// T-053 / DEC-018 item 3: per-gerai platform controls. Today: allow or disable sender masking. The id
// in the URL only selects a row the database returns to a tenant-governance administrator.
export default async function PlatformTenantPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePlatform();
  const governance = session.capabilities.includes("tenant_governance");
  // T-092: monitoring-only administrators read the summary; masking and lifecycle stay tenant_governance.
  if (!governance && !session.capabilities.includes("platform_monitoring")) notFound();
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const db = await dbServer();
  const [{ data: summaryRaw, error: summaryError }, masking] = await Promise.all([
    db.rpc("platform_tenant_summary", { p_tenant: id }),
    governance ? db.rpc("platform_tenant_masking", { p_tenant: id }) : Promise.resolve({ data: null }),
  ]);
  if (summaryError?.message === "not_found") notFound();
  if (summaryError) return <LoadError title="Gerai" what="Ringkasan gerai ini" />;
  const summary = summaryRaw as Summary;
  const tenant = ((masking.data ?? []) as Masking[])[0] ?? null;
  const a = summary.activity;
  const problems = (summary.by_state.unknown ?? 0) + (summary.by_state.awaiting_payment ?? 0) + (summary.by_state.failed ?? 0);

  const facts: [string, React.ReactNode][] = [
    ["Status", <LifecycleBadge key="s" lifecycle={summary.lifecycle} />],
    ["Anggota aktif", <span key="m" className="tabular">{summary.member_count} ({summary.admin_count} admin)</span>],
    ["Terdaftar", formatWib(summary.created_at)],
    ...(summary.slug ? [["Slug", <span key="sl" className="font-mono">{summary.slug}</span>]] as [string, React.ReactNode][] : []),
    ...(summary.shipment_prefix ? [["Awalan referensi", <span key="pr" className="font-mono">{summary.shipment_prefix}</span>]] as [string, React.ReactNode][] : []),
    ["Akun Mengantar", summary.seller.connected
      ? `Terhubung (${summary.seller.mode === "partner" ? "dibuat lewat Partner" : "kunci sendiri"}, ${summary.seller.provider_env})`
      : "Belum terhubung"],
    ["Diskon gerai", summary.discount.gerai_discount_bps === null ? "Belum diatur" : `${(summary.discount.gerai_discount_bps / 100).toLocaleString("id-ID")}% (${summary.discount.status})`],
    ["Masking pengirim", summary.masking_allowed ? "Diizinkan" : "Dinonaktifkan"],
  ];
  const activity: [string, string][] = [
    ["Pengiriman hari ini (WIB)", String(a.today)],
    ["7 hari terakhir", String(a.last_7_days)],
    ["30 hari terakhir", String(a.last_30_days)],
    ["Resi terbit 30 hari", String(a.issued_30_days)],
    ["COD 30 hari", String(a.cod_30_days)],
    ["Ongkir pelanggan terbit 30 hari", a.charge_30_days_idr === null ? "belum diketahui" : formatIdr(a.charge_30_days_idr)],
    ["Pengiriman terakhir", a.last_shipment_at ? formatWib(a.last_shipment_at) : "Belum ada"],
  ];

  return (
    <div className="flex max-w-[880px] flex-col gap-8">
      <PageHeader
        crumbs={[{ href: "/admin", label: "Gerai" }]}
        current={summary.name}
        title={summary.name}
        description={session.capabilities.includes("customer_data_review") ? "Satu gerai = satu cabang. Ringkasan pemantauan; transaksi tetap urusan gerai. Data pelanggan hanya dibuka dengan alasan." : "Satu gerai = satu cabang. Ringkasan pemantauan; transaksi tetap urusan gerai. Data pelanggan tidak terlihat di sini."}
      />

      <section aria-labelledby="activity-heading" className="flex flex-col gap-3">
        <h2 id="activity-heading" className="text-xl font-semibold tracking-tight">Aktivitas</h2>
        <dl className="grid gap-px overflow-hidden rounded-lg bg-border ring-1 ring-border sm:grid-cols-2" data-testid="tenant-activity">
          {activity.map(([label, value]) => (
            <div key={label} className="flex flex-col gap-1 bg-card p-4">
              <dt className="text-sm text-muted-foreground">{label}</dt>
              <dd className="text-xl font-semibold tabular">{value}</dd>
            </div>
          ))}
        </dl>
        <div className="flex flex-col gap-2 rounded-lg bg-card p-4 ring-1 ring-border" data-testid="tenant-states">
          <p className={problems > 0 ? "font-semibold text-warning" : "font-semibold"}>
            {problems > 0 ? `${problems} pengiriman perlu perhatian gerai` : "Tidak ada pengiriman bermasalah"}
          </p>
          <ul className="flex flex-wrap gap-2 text-sm">
            {Object.entries(summary.by_state).sort().map(([state, n]) => (
              <li key={state}><Badge variant="neutral">{SUBMISSION_LABEL[state] ?? state}: {n}</Badge></li>
            ))}
          </ul>
        </div>
      </section>

      <section aria-labelledby="outlets-heading" className="flex flex-col gap-3">
        <h2 id="outlets-heading" className="text-xl font-semibold tracking-tight">Cabang dan pickup</h2>
        <ul className="divide-y divide-border rounded-lg bg-card px-5 ring-1 ring-border">
          {summary.outlets.map((o) => (
            <li key={o.name} className="flex min-h-12 items-center justify-between gap-4 py-3">
              <span className="min-w-0 break-words">{o.name}{o.pickup_area ? <span className="block text-sm text-muted-foreground">{o.pickup_area}</span> : null}</span>
              <Badge variant={o.pickup_ready ? "success" : "warning"}>{o.pickup_ready ? "Pickup siap" : "Pickup belum dipilih"}</Badge>
            </li>
          ))}
        </ul>
      </section>

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

      {tenant ? (
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
      ) : null}

      {session.capabilities.includes("customer_data_review") ? (
        <section aria-labelledby="customers-heading" className="flex flex-col gap-4 rounded-lg bg-card p-5 ring-1 ring-border md:p-6">
          <h2 id="customers-heading" className="text-xl font-semibold tracking-tight">Data pelanggan gerai ini</h2>
          <p className="text-sm text-muted-foreground">
            Nama, nomor dan alamat pengirim/penerima per pengiriman. Data pribadi: setiap halaman yang dibuka tercatat di audit dengan alasan Anda.
          </p>
          <TenantCustomersPanel tenantId={id} />
        </section>
      ) : null}

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
