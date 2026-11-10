import type { Metadata } from "next";
import Link from "next/link";
import { ChevronDown, ScrollText, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatWib } from "@/lib/format";
import { CAPABILITY_LABELS, platformTitle, requirePlatform } from "@/lib/platform";
import { formatPercentBps, STATUS_LABEL } from "@/modules/pricing/percent";
import { dbServer } from "@/lib/db/server";
import { cn } from "@/lib/utils";
import { AuditActionSelect } from "./action-select";
import { CardLabel, EmptyState, LoadError, PageHeader, RT, SegmentedNav } from "../ui";

export const generateMetadata = (): Promise<Metadata> => platformTitle("Audit · Super Admin", ["audit_review"]);

const ACTIONS: Record<string, string> = {
  "tenant.lifecycle": "Status gerai",
  "platform.grant": "Akses admin diberikan/diubah",
  "platform.revoke": "Akses admin dicabut",
  "application.review": "Tinjauan pengajuan gerai",
  "registration.toggle": "Pendaftaran publik",
  "member.invite": "Undangan staf",
  "member.invite_revoke": "Undangan dicabut",
  "member.accept": "Undangan diterima",
  "member.role": "Peran anggota",
  "member.deactivate": "Anggota dinonaktifkan",
  "credential.store": "Kunci Mengantar disimpan",
  "credential.remove": "Kunci Mengantar dihapus",
  "integration.partner_id": "Partner ID",
  "discount.terms": "Diskon gerai",
  "discount.template": "Templat diskon gerai",
  "shipment.batch_pay": "Pembayaran batch Mengantar",
  "shipment.close_failed": "Percobaan pengiriman ditutup",
  "outlet.mengantar_pickup": "Alamat pickup outlet",
  "partner.onboarding_begin": "Pendaftaran akun Mengantar dimulai",
  "partner.onboarding_complete": "Akun Mengantar terhubung",
  "partner.onboarding_outcome": "Hasil pendaftaran akun Mengantar",
  "tenant.contact_whatsapp": "WhatsApp gerai",
  "tenant.masking": "Izin masking pengirim",
  "label.snapshot": "Snapshot label",
  "invoice.snapshot": "Snapshot invoice",
  "export.shipments": "Ekspor daftar pengiriman",
  // T-081 / T-080 (G2): append-only provider configuration versions.
  "declaration_text.append": "Versi teks pernyataan isi paket",
  "billable_weight_rule.append": "Versi aturan berat Mengantar",
  // T-084 / PR-46: per-courier masking acceptance (outcome = the new state).
  "masking_acceptance.set": "Penerimaan label masking kurir",
  // T-093: customer-data reads (phone kept masked plus a SHA-256 in the detail).
  "customer_data.lookup": "Pencarian data pelanggan",
  "customer_data.tenant_view": "Data pelanggan gerai dibuka",
};

// Category tabs group the decision types; every type belongs to exactly one category.
const CATEGORIES: Record<string, { label: string; actions: string[] }> = {
  gerai: { label: "Gerai", actions: ["tenant.lifecycle", "application.review", "registration.toggle", "tenant.contact_whatsapp", "tenant.masking", "declaration_text.append"] },
  akses: { label: "Akses admin", actions: ["platform.grant", "platform.revoke"] },
  anggota: { label: "Anggota", actions: ["member.invite", "member.invite_revoke", "member.accept", "member.role", "member.deactivate"] },
  integrasi: {
    label: "Integrasi",
    actions: ["credential.store", "credential.remove", "integration.partner_id", "partner.onboarding_begin", "partner.onboarding_complete", "partner.onboarding_outcome", "outlet.mengantar_pickup", "billable_weight_rule.append", "masking_acceptance.set"],
  },
  diskon: { label: "Diskon", actions: ["discount.terms", "discount.template"] },
  pelanggan: { label: "Data pelanggan", actions: ["customer_data.lookup", "customer_data.tenant_view"] },
  pengiriman: { label: "Pengiriman", actions: ["shipment.batch_pay", "shipment.close_failed", "label.snapshot", "invoice.snapshot", "export.shipments"] },
};

// Outcome codes written by the audit commands, in plain Bahasa. Unknown codes fall back to the raw
// code so a new command is never hidden; the discount outcome is the value status (STATUS_LABEL).
const OUTCOME: Record<string, string> = {
  ...STATUS_LABEL,
  // shipment.batch_pay
  authorized: "Diotorisasi", authorization_withheld: "Otorisasi ditahan", claimed: "Diklaim", sent: "Terkirim ke Mengantar",
  paid: "Dibayar", unknown: "Hasil belum pasti", rejected: "Ditolak", released: "Dilepas", reconciled_paid: "Dicek ulang: sudah dibayar",
  // label.snapshot
  masked: "Dengan masking pengirim", gerai_identity: "Dengan identitas gerai",
  // invoice.snapshot, export.shipments
  issued: "Diterbitkan", ok: "Berhasil", truncated: "Dipotong di batas baris",
  // tenant.contact_whatsapp, tenant.masking, outlet.mengantar_pickup, integration.partner_id
  set: "Diatur", changed: "Diubah", cleared: "Dikosongkan", allowed: "Diizinkan", disabled: "Dinonaktifkan",
  // tenant.lifecycle
  provisioning: "Disiapkan", active: "Aktif", suspended: "Dibekukan", archived: "Diarsipkan",
  // application.review
  approve: "Disetujui", reject: "Ditolak", request_changes: "Perlu perbaikan",
  // registration, grants, members, credentials
  opened: "Dibuka", closed: "Ditutup", granted: "Diberikan", revoked: "Dicabut", invited: "Diundang",
  expired_replaced: "Kedaluwarsa, diganti", accepted: "Diterima", tenant_admin: "Admin gerai", operator: "Operator",
  stored: "Disimpan", removed: "Dihapus",
  // partner.onboarding_*
  registration_pending: "Menunggu pendaftaran", connected: "Terhubung", not_connected: "Belum terhubung",
  consent_recorded: "Persetujuan dicatat", registered_key_pending: "Kunci API menunggu", existing_account_required: "Perlu akun Mengantar yang sudah ada",
  // masking_acceptance.set
  unverified: "Belum terverifikasi", verified: "Terverifikasi", refused: "Ditolak kurir",
  // customer_data.*
  found: "Ditemukan", none: "Tidak ada kiriman", viewed: "Dibuka",
  quota_wait: "Menunggu kuota", provider_restricted: "Dibatasi Mengantar", configuration_blocked: "Konfigurasi belum siap",
};

type Detail = { from?: string; to?: string; capabilities?: string[]; old_bps?: number | null; new_bps?: number; new_version?: number } & Record<string, unknown>;

type AuditRow = {
  id: number; at: string; action: string; outcome: string; reason: string | null;
  actor_email: string | null; target_tenant_name: string | null; target_user_email: string | null;
  detail: Detail | null;
};

function describe(detail: Detail): string | null {
  if (detail.from && detail.to) return `${detail.from} → ${detail.to}`;
  if (detail.new_bps !== undefined) {
    const old = detail.old_bps == null ? "belum ada" : formatPercentBps(detail.old_bps);
    return `Versi ${detail.new_version}: ${old} → ${formatPercentBps(detail.new_bps)}`;
  }
  if (detail.capabilities) return `Kemampuan: ${detail.capabilities.join(", ")}`;
  return null;
}

const DETAIL_LABEL: Record<string, string> = {
  from: "Sebelum", to: "Sesudah", capabilities: "Kemampuan", old_bps: "Diskon lama", new_bps: "Diskon baru", new_version: "Versi baru",
  phone_hint: "Nomor (disamarkan)", phone_sha256: "SHA-256 nomor", shipments: "Kiriman", gerai_count: "Jumlah gerai", rows: "Baris dibuka", total: "Total kiriman",
};

// One readable value per recorded key: percentages from basis points, known codes in Bahasa (with
// the stored code kept beside it), lists joined; anything structured stays JSON.
function detailValue(key: string, value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (key.endsWith("_bps") && typeof value === "number") return formatPercentBps(value);
  if (key === "capabilities" && Array.isArray(value)) return value.map((c) => CAPABILITY_LABELS[c as keyof typeof CAPABILITY_LABELS] ?? String(c)).join(", ");
  if (typeof value === "boolean") return value ? "Ya" : "Tidak";
  if (typeof value === "string") return OUTCOME[value] ? `${OUTCOME[value]} (${value})` : value;
  if (Array.isArray(value)) return value.map((v) => (typeof v === "object" ? JSON.stringify(v) : String(v))).join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

const SUMMARY = "inline-flex min-h-11 cursor-pointer list-none items-center gap-1.5 text-sm font-semibold text-primary [&::-webkit-details-marker]:hidden";

function DetailRows({ detail }: { detail: Detail }) {
  // Stored detail is jsonb (keys come back sorted by length): known keys first, in reading order.
  const known = Object.keys(DETAIL_LABEL);
  const rank = (key: string) => (known.includes(key) ? known.indexOf(key) : known.length);
  const entries = Object.entries(detail).sort(([a], [b]) => rank(a) - rank(b));
  if (entries.length === 0) return null;
  return (
    <details className="group/detail">
      <summary className={SUMMARY}>
        Rincian perubahan
        <ChevronDown className="size-4 transition-transform group-open/detail:rotate-180" aria-hidden="true" />
      </summary>
      <dl className="mt-1 divide-y divide-border border-y border-border text-sm">
        {entries.map(([key, value]) => (
          <div key={key} className="grid gap-x-4 gap-y-0.5 py-2 sm:grid-cols-[140px_minmax(0,1fr)]">
            <dt className="text-muted-foreground">{DETAIL_LABEL[key] ?? key.replaceAll("_", " ")}</dt>
            <dd className="break-words tabular">{detailValue(key, value)}</dd>
          </div>
        ))}
      </dl>
      <details className="group/json mt-1">
        <summary className={cn(SUMMARY, "font-normal text-muted-foreground")}>
          Lihat JSON asli
          <ChevronDown className="size-4 transition-transform group-open/json:rotate-180" aria-hidden="true" />
        </summary>
        <pre className="overflow-x-auto rounded-sm bg-muted p-3 font-mono text-sm">{JSON.stringify(detail, null, 2)}</pre>
      </details>
    </details>
  );
}

// PR-28: append-only decision history, newest first, filterable by category, decision type and a
// search over actor, target and reason. Shows who acted, on what, and the recorded change; never
// customer data or secrets.
export default async function PlatformAuditPage({ searchParams }: { searchParams: Promise<{ jenis?: string; kategori?: string; q?: string }> }) {
  await requirePlatform("audit_review");
  const { jenis, kategori, q } = await searchParams;
  const action = jenis && Object.hasOwn(ACTIONS, jenis) ? jenis : null;
  const category = action
    ? Object.keys(CATEGORIES).find((key) => CATEGORIES[key].actions.includes(action))!
    : kategori && Object.hasOwn(CATEGORIES, kategori) ? kategori : null;
  const query = (q ?? "").trim().slice(0, 100);
  const db = await dbServer();

  // One decision type, one category (its types merged, newest first) or everything.
  const types = action ? [action] : category ? CATEGORIES[category].actions : [null];
  const results = await Promise.all(types.map((t) => db.rpc("platform_audit", { p_action: t, p_limit: 100 })));
  const error = results.find((r) => r.error)?.error ?? null;
  const merged = results
    .flatMap((r) => (r.data ?? []) as AuditRow[])
    .sort((a, b) => b.at.localeCompare(a.at) || b.id - a.id)
    .slice(0, 100);
  const needle = query.toLowerCase();
  const data = needle
    ? merged.filter((e) =>
      [e.actor_email, e.target_tenant_name, e.target_user_email, e.reason, ACTIONS[e.action], OUTCOME[e.outcome]]
        .some((v) => v?.toLowerCase().includes(needle)))
    : merged;

  const tabs = [
    { href: "/admin/audit", label: "Semua", current: category === null },
    ...Object.entries(CATEGORIES).map(([key, c]) => ({ href: `/admin/audit?kategori=${key}`, label: c.label, current: category === key })),
  ];
  const resetHref = category ? `/admin/audit?kategori=${category}` : "/admin/audit";
  const filtered = Boolean(action || query);
  const options = category ? CATEGORIES[category].actions : Object.keys(ACTIONS);

  return (
    <div className="flex max-w-[1160px] flex-col gap-6">
      <PageHeader title="Audit" description="100 keputusan terakhir. Catatan audit tidak bisa diubah atau dihapus lewat aplikasi maupun API." />
      <SegmentedNav label="Kategori keputusan" items={tabs} />

      {/* Keyed by every URL filter: soft navigation keeps client state, so an unsubmitted choice or search
          text would otherwise survive a tab, "Hapus filter" or back/forward and be re-applied by Terapkan. */}
      <form key={JSON.stringify([category, action, query])} role="search" className="flex flex-col gap-3 rounded-lg bg-card p-4 ring-1 ring-border md:flex-row md:items-end">
        {category ? <input type="hidden" name="kategori" value={category} /> : null}
        <div className="flex min-w-0 flex-col gap-2 md:w-[280px]">
          <Label htmlFor="audit-jenis">Jenis keputusan</Label>
          <AuditActionSelect id="audit-jenis" defaultValue={action ?? ""}
            allLabel={category ? `Semua di ${CATEGORIES[category].label}` : "Semua jenis"}
            options={options.map((key) => ({ value: key, label: ACTIONS[key] }))} />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <Label htmlFor="audit-q">Cari</Label>
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input id="audit-q" name="q" type="search" defaultValue={query} placeholder="Email, gerai, atau alasan" className="min-h-11 rounded-full pl-10" />
          </div>
        </div>
        <div className="flex gap-2">
          <Button type="submit" variant="outline" className="max-md:flex-1">Terapkan</Button>
          {filtered ? <Button asChild variant="ghost" className="max-md:flex-1"><Link href={resetHref}>Hapus filter</Link></Button> : null}
        </div>
      </form>
      {category === null && !action ? (
        <p className="-mt-2 text-sm text-muted-foreground">
          &ldquo;Semua&rdquo; tidak memuat snapshot label dan snapshot invoice karena jumlahnya besar; buka kategori Pengiriman atau pilih jenisnya untuk melihatnya.
        </p>
      ) : null}

      {error ? (
        <LoadError href="/admin/audit">Audit belum bisa dimuat.</LoadError>
      ) : data.length === 0 ? (
        <EmptyState
          icon={ScrollText}
          title={filtered ? "Tidak ada keputusan yang cocok" : "Belum ada keputusan tercatat"}
          description={filtered ? "Ubah jenis atau kata pencarian." : undefined}
          action={filtered ? <Button asChild variant="outline" size="sm"><Link href={resetHref}>Hapus filter</Link></Button> : null}
        />
      ) : (
        <div className={RT.frame}>
          <Table className={cn(RT.table, "md:table-fixed")}>
            <TableHeader className={RT.head}>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-[150px]">Waktu</TableHead>
                <TableHead>Keputusan</TableHead>
                <TableHead className="w-[26%] max-lg:hidden">Pelaku</TableHead>
                <TableHead className="w-[22%]">Target</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className={RT.body}>
              {data.map((e) => {
                const summary = e.detail ? describe(e.detail) : null;
                return (
                  <TableRow key={e.id} data-testid="audit-event" className={RT.row}>
                    <TableCell className={cn(RT.cell, "text-sm text-muted-foreground tabular max-md:hidden")}>
                      <time dateTime={e.at}>{formatWib(e.at)}</time>
                    </TableCell>
                    <TableCell className={cn(RT.cell, "min-w-0")}>
                      <span className="block font-semibold break-words">{ACTIONS[e.action] ?? e.action} · {OUTCOME[e.outcome] ?? e.outcome}</span>
                      {/* Narrow cards carry who, when and the target under the title, before the long detail. */}
                      <span className="block text-sm break-all text-muted-foreground lg:hidden">
                        oleh {e.actor_email ?? "sistem"}<span className="md:hidden"> · <time dateTime={e.at} className="tabular">{formatWib(e.at)}</time></span>
                      </span>
                      {e.target_tenant_name || e.target_user_email ? (
                        <span className="block text-sm break-words md:hidden">Target: {e.target_tenant_name ?? e.target_user_email}</span>
                      ) : null}
                      {summary ? <span className="block text-sm break-words">{summary}</span> : null}
                      {e.reason ? <span className="block text-sm break-words">Alasan: {e.reason}</span> : null}
                      {e.detail ? <DetailRows detail={e.detail} /> : null}
                    </TableCell>
                    <TableCell className="hidden align-top text-sm break-all lg:table-cell">
                      <span className="sr-only">oleh </span>{e.actor_email ?? "sistem"}
                    </TableCell>
                    <TableCell className={cn(RT.cell, "text-sm break-words max-md:hidden")}>
                      {e.target_tenant_name || e.target_user_email ? (
                        <><CardLabel>Target:</CardLabel>{e.target_tenant_name ?? e.target_user_email}</>
                      ) : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
