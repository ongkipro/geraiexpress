import type { Metadata } from "next";
import { AlertCircle, CheckCircle2, ChevronDown, FlaskConical, HelpCircle, Plug, Rocket } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { COURIER_NAME, formatWib } from "@/lib/format";
import { OFFERED_COURIERS } from "@/lib/mengantar/public-api";
import { platformTitle, requirePlatform } from "@/lib/platform";
import { dbServer } from "@/lib/db/server";
import { keyMaterialFromReader } from "@/lib/credential-crypto";
import { config } from "@/lib/config";
import { cn } from "@/lib/utils";
import { PartnerIdForm } from "@/modules/credentials/forms";
import { resolvePartnerId } from "@/lib/mengantar/partner-onboarding";
import { Notice } from "@/components/notice";
import { EmptyState, LifecycleBadge, PageHeader, RT, SectionHeader } from "../ui";
import { LoadError } from "@/components/notice";
import { MaskingAcceptanceForm } from "./masking-acceptance-form";

export const generateMetadata = (): Promise<Metadata> => platformTitle("Integrasi Mengantar · Super Admin", ["integration_operations"]);

type AcceptanceRow = { courier: string; state: "unverified" | "verified" | "refused"; evidence_ref: string | null; recorded_at: string; recorded_by_email: string | null };
const ACCEPTANCE: Record<AcceptanceRow["state"], { label: string; ok: boolean | null }> = {
  unverified: { label: "Belum terverifikasi", ok: null },
  verified: { label: "Terverifikasi", ok: true },
  refused: { label: "Ditolak kurir", ok: false },
};

type Row = { tenant_id: string; tenant_name: string; lifecycle: string; configured: boolean; mode: string | null; hint: string | null; version: number | null; stored_at: string | null };

// Connection state as tone + icon + text: stored keys are not verified here, so they read as pending,
// never as a confirmed connection.
function StateBadge({ ok, label }: { ok: boolean | null; label: string }) {
  const Icon = ok === null ? HelpCircle : ok ? CheckCircle2 : AlertCircle;
  return <Badge variant={ok === null ? "pending" : ok ? "success" : "warning"}><Icon aria-hidden="true" />{label}</Badge>;
}

function EnvironmentBadge({ environment }: { environment: string | undefined }) {
  if (environment === "production") return <Badge variant="success" data-testid="mengantar-environment"><Rocket aria-hidden="true" />Mengantar: produksi</Badge>;
  if (environment === "sandbox") return <Badge variant="warning" data-testid="mengantar-environment"><FlaskConical aria-hidden="true" />Mengantar: sandbox</Badge>;
  return <Badge variant="neutral" data-testid="mengantar-environment"><HelpCircle aria-hidden="true" />Lingkungan belum diatur</Badge>;
}

const ENVIRONMENT_NOTE: Record<string, string> = {
  production: "Server ini memakai Mengantar produksi: resi, tagihan, dan pickup nyata.",
  sandbox: "Server ini memakai Mengantar sandbox: tidak ada resi, tagihan, atau pickup nyata.",
};

// PR-26 / SEC-3: platform configuration and per-gerai seller connection state, never values.
// The Partner Secret is a container environment secret; this page only reports whether it is present.
export default async function IntegrationsPage() {
  await requirePlatform("integration_operations");
  const db = await dbServer();
  const [{ data: partnerConfig, error: pe }, { data: raw, error: re }, { data: acceptanceRaw, error: ae }] = await Promise.all([
    db.rpc("platform_partner_config"),
    db.rpc("platform_integrations"),
    db.rpc("platform_masking_acceptance"),
  ]);
  if (pe || re || ae) return <LoadError title="Integrasi Mengantar" what="Konfigurasi Partner atau daftar akun penjual" />;
  const storedPartnerId = ((partnerConfig ?? []) as { partner_id: string | null }[])[0]?.partner_id ?? null;
  // The same resolution the Partner API callers use: stored value, else PARTNER_ID, else the default.
  const partnerId = resolvePartnerId(storedPartnerId, config("PARTNER_ID"));
  const secretPresent = Boolean(config("MENGANTAR_PARTNER_SECRET") ?? config("GERAIEXPRESS_MENGANTAR_SANDBOX_SECRET"));
  const sealingPresent = Boolean(keyMaterialFromReader(config));
  const environment = config("MENGANTAR_ENV");
  const rows = (raw ?? []) as Row[];
  // PR-46: every offered courier is listed; a courier without a recorded row is "belum terverifikasi".
  const recorded = new Map(((acceptanceRaw ?? []) as AcceptanceRow[]).map((r) => [r.courier, r]));
  const acceptance = [...new Set([...OFFERED_COURIERS, ...recorded.keys()])].map((courier) => ({ courier, row: recorded.get(courier) ?? null }));

  const settings = [
    {
      testId: "partner-id-status", title: "Partner ID", ok: true, label: storedPartnerId?.trim() ? "Terisi" : "Bawaan",
      body: storedPartnerId?.trim()
        ? <span className="break-all">{partnerId}</span>
        : <>Belum diisi di sini; server memakai <span className="break-all">{partnerId}</span> (dari variabel lingkungan atau bawaan).</>,
    },
    {
      testId: "partner-secret-status", title: "Partner Secret", ok: secretPresent, label: secretPresent ? "Terpasang" : "Belum dipasang",
      body: <>Dipasang oleh pemilik sebagai variabel lingkungan server (<code>MENGANTAR_PARTNER_SECRET</code> di berkas env kontainer), tidak lewat halaman ini.</>,
    },
    {
      testId: "sealing-key-status", title: "Kunci enkripsi kredensial", ok: sealingPresent, label: sealingPresent ? "Terpasang" : "Belum dipasang",
      body: <>Variabel lingkungan server <code>CREDENTIAL_KEY</code> (atau <code>CREDENTIAL_KEYS</code>) untuk menyegel kunci API penjual.</>,
    },
  ];

  return (
    <div className="flex max-w-[1160px] flex-col gap-8">
      <PageHeader
        title="Integrasi Mengantar"
        description="Status layanan konfigurasi platform dan koneksi akun penjual tiap gerai. Nilai rahasia tidak pernah ditampilkan."
        meta={<EnvironmentBadge environment={environment} />}
      />
      {environment === "production" || environment === "sandbox" ? (
        <Notice tone={environment === "production" ? "info" : "warning"}>{ENVIRONMENT_NOTE[environment]}</Notice>
      ) : (
        <Notice tone="warning">
          <code>MENGANTAR_ENV</code> belum diatur di server ini, jadi koneksi ke Mengantar tidak aktif. Isi <code>sandbox</code> atau <code>production</code> di berkas env kontainer.
        </Notice>
      )}

      <section aria-labelledby="platform-heading" className="flex flex-col gap-4">
        <SectionHeader id="platform-heading" title="Konfigurasi platform" />
        <ul className="divide-y divide-border rounded-lg bg-card ring-1 ring-border">
          {settings.map((s) => (
            <li key={s.testId} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6 md:p-5" data-testid={s.testId}>
              <span className="flex min-w-0 flex-col gap-1">
                <span className="font-semibold">{s.title}</span>
                <span className="text-sm text-muted-foreground">{s.body}</span>
              </span>
              <StateBadge ok={s.ok} label={s.label} />
            </li>
          ))}
          <li className="p-4 md:p-5">
            <details className="group">
              <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1.5 font-semibold text-primary [&::-webkit-details-marker]:hidden">
                Ubah Partner ID…
                <ChevronDown className="size-4 transition-transform group-open:rotate-180" aria-hidden="true" />
              </summary>
              <div className="mt-3 max-w-[560px]"><PartnerIdForm current={partnerId} /></div>
            </details>
          </li>
        </ul>
      </section>

      <section aria-labelledby="acceptance-heading" className="flex flex-col gap-4">
        <SectionHeader id="acceptance-heading" title="Penerimaan label masking per kurir"
          description="Bukti bahwa kurir menerima label masking yang dicetak gerai (PR-46). Selain terverifikasi, operator wajib mencentang konfirmasi sebelum mencetak label masking, dan konfirmasinya dicatat di riwayat cetak." />
        <ul className="divide-y divide-border rounded-lg bg-card ring-1 ring-border">
          {acceptance.map(({ courier, row }) => {
            const state = ACCEPTANCE[row?.state ?? "unverified"];
            const label = COURIER_NAME[courier] ?? courier;
            return (
              <li key={courier} data-testid="masking-acceptance-row" className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6 md:p-5">
                <span className="flex min-w-0 flex-col gap-1">
                  <span className="font-semibold">{label}</span>
                  <span className="text-sm break-words text-muted-foreground">
                    {row ? <>Bukti: {row.evidence_ref ?? "—"} · dicatat {formatWib(row.recorded_at)}{row.recorded_by_email ? ` oleh ${row.recorded_by_email}` : ""}</> : "Belum ada catatan; dianggap belum terverifikasi."}
                  </span>
                </span>
                <span className="flex flex-col items-start gap-2 sm:items-end">
                  <StateBadge ok={state.ok} label={state.label} />
                  <MaskingAcceptanceForm courier={courier} courierLabel={label} state={row?.state ?? "unverified"} evidenceRef={row?.evidence_ref ?? null} recordedAt={row?.recorded_at ?? null} />
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-labelledby="sellers-heading" className="flex flex-col gap-4">
        <SectionHeader id="sellers-heading" title="Akun penjual per gerai" description="Status di sini hanya menunjukkan apakah kunci API tersimpan; halaman ini tidak memverifikasinya ke Mengantar." />
        {rows.length === 0 ? (
          <EmptyState icon={Plug} title="Belum ada gerai terdaftar" description="Gerai muncul di sini setelah pengajuannya disetujui." />
        ) : (
          <div className={RT.frame}>
            <Table className={RT.table}>
              <TableHeader className={RT.head}>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Gerai</TableHead>
                  <TableHead>Akun penjual</TableHead>
                  <TableHead className="max-lg:hidden">Disimpan</TableHead>
                  <TableHead className="text-right">Koneksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody className={RT.body}>
                {rows.map((r) => (
                  <TableRow key={r.tenant_id} data-testid="seller-binding" className={RT.row}>
                    <TableCell className={cn(RT.cell, "min-w-0")}>
                      <span className="block font-semibold break-words">{r.tenant_name}</span>
                      {r.lifecycle !== "active" ? <span className="mt-1 block"><LifecycleBadge lifecycle={r.lifecycle} /></span> : null}
                    </TableCell>
                    <TableCell className={cn(RT.cell, "text-sm max-md:text-muted-foreground")}>
                      {r.configured ? (
                        <>
                          {r.mode === "partner_managed" || r.mode === "partner" ? "Akun Partner Mengantar" : "Kunci sendiri (BYOK)"} berakhiran{" "}
                          <span className="font-mono">…{r.hint}</span>, versi <span className="tabular">{r.version}</span>
                          <span className="block lg:hidden">Disimpan {formatWib(r.stored_at)}</span>
                        </>
                      ) : "Belum ada kunci API."}
                    </TableCell>
                    <TableCell className="hidden align-top text-sm text-muted-foreground lg:table-cell">
                      {r.configured ? formatWib(r.stored_at) : "—"}
                    </TableCell>
                    <TableCell className={cn(RT.cell, "max-md:pt-1 md:text-right")}>
                      <StateBadge ok={r.configured ? null : false} label={r.configured ? "Tersimpan, belum diverifikasi" : "Belum terhubung"} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
    </div>
  );
}
