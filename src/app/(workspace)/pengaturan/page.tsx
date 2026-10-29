import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, CircleSlash, FlaskConical, HelpCircle, Info } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { formatWib } from "@/lib/format";
import { dbServer } from "@/lib/db/server";
import { requireWorkspace } from "@/lib/workspace";
import {
  PartnerSellerOnboardingForm,
  RemoveSellerKeyForm,
  SellerKeyForm,
  type PartnerOnboardingStatus,
} from "@/modules/credentials/forms";
import { PickupForm } from "@/modules/mengantar/pickup-form";
import { mengantarFailure, tenantMengantar } from "@/lib/mengantar/tenant";
import type { PickupAddress } from "@/lib/mengantar/public-api";
import { friendlyError } from "@/lib/errors";
import { WhatsappForm } from "@/modules/labels/whatsapp-form";
import { MASKING_DISABLED, RETENTION_NOTE } from "@/modules/labels/messages";
import { GeraiDiscountCard } from "@/modules/pricing/gerai-discount-card";
import { SettingsNav, type SettingsSection } from "./settings-nav";

type CredentialStatus = { configured: boolean; mode?: string | null; hint: string | null; version: number | null; created_at: string | null; latest_version: number };

export const metadata: Metadata = { title: "Pengaturan" };

type Readiness = "ready" | "simulated" | "blocked" | "unverified";
const STATE: Record<Readiness, { label: string; Icon: typeof CheckCircle2; variant: "success" | "info" | "neutral" | "pending" }> = {
  ready: { label: "Siap", Icon: CheckCircle2, variant: "success" },
  simulated: { label: "Simulasi", Icon: FlaskConical, variant: "info" },
  blocked: { label: "Belum tersedia", Icon: CircleSlash, variant: "neutral" },
  unverified: { label: "Belum diverifikasi", Icon: HelpCircle, variant: "pending" },
};

function ReadinessBadge({ state }: { state: Readiness }) {
  const { label, Icon, variant } = STATE[state];
  return <Badge variant={variant}><Icon aria-hidden="true" />{label}</Badge>;
}

// One settings group: a title and a short line outside, single-level cards inside (C8).
function Group({ id, title, description, children }: { id: string; title: string; description?: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="flex scroll-mt-20 flex-col gap-3 lg:scroll-mt-8">
      <div className="flex flex-col gap-1">
        <h2 id={`${id}-title`} className="text-xl">{title}</h2>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

const CARD = "flex flex-col gap-4 rounded-lg bg-card p-5 ring-1 ring-border sm:p-6";

// PR-8: each capability has its own readiness; a connected account is never "all ready".
export default async function SettingsPage() {
  const ws = await requireWorkspace();
  const db = await dbServer();
  const [{ data: raw }, { data: rawOnboarding }, { data: tenantRow }] = await Promise.all([
    db.rpc("seller_credential_status", { p_tenant: ws.tenant.id }),
    db.rpc("partner_onboarding_status", { p_tenant: ws.tenant.id }),
    db.from("tenants").select("contact_whatsapp, contact_whatsapp_revision, masking_allowed").eq("id", ws.tenant.id).maybeSingle(),
  ]);
  // PR-34: the gerai WhatsApp printed on the local label while masking is off, and the platform's masking flag.
  const whatsapp = tenantRow?.contact_whatsapp ?? null;
  const maskingAllowed = tenantRow?.masking_allowed ?? true;
  const credential = ((raw ?? []) as CredentialStatus[])[0] ?? { configured: false, mode: null, hint: null, version: null, created_at: null, latest_version: 0 };
  const onboarding = ((rawOnboarding ?? []) as PartnerOnboardingStatus[])[0] ?? {
    connection_mode: credential.configured ? (credential.mode === "partner" ? "partner_managed" : "byok") : "none",
    onboarding_state: credential.configured ? "connected" : "not_connected",
    partner_seller_id: null,
    owner_name: null,
    owner_email: null,
    owner_phone: null,
    consent_recorded_at: null,
    last_error_code: null,
    retry_after_at: null,
  };
  const isAdmin = ws.role === "tenant_admin";

  // T-023: with a stored key, the server reads the seller's saved pickup addresses through it; a
  // successful read is the first proof the key works against Mengantar. Only for admins, who
  // can act on it: operators see the stored state without spending provider calls.
  let pickupOptions: PickupAddress[] | null = null;
  let mengantarProblem: string | null = null;
  let checkedAt: string | null = null;
  if (!ws.isDemo && credential.configured && isAdmin) {
    checkedAt = new Date().toISOString();
    const mengantar = await tenantMengantar(ws.tenant.id);
    if (!mengantar.ok) mengantarProblem = friendlyError({ message: `mengantar_${mengantar.reason}` });
    else {
      try {
        pickupOptions = await mengantar.client.listPickupAddresses();
      } catch (error) {
        mengantarProblem = friendlyError({ message: mengantarFailure(error) });
      }
    }
  }
  const keyWorks = pickupOptions !== null;
  // Orders still being checked with the current key (T-024 audit): replacing the key would leave
  // them to be checked by hand in the Mengantar app.
  let openOrders = 0;
  if (!ws.isDemo && credential.configured && isAdmin) {
    const [{ count: ops }, { count: unpaid }] = await Promise.all([
      db.from("provider_operations").select("id", { count: "exact", head: true }).eq("tenant_id", ws.tenant.id)
        .eq("is_simulated", false).in("state", ["queued", "in_flight", "unknown"]),
      db.from("shipments").select("id", { count: "exact", head: true }).eq("tenant_id", ws.tenant.id).eq("submission_state", "awaiting_payment"),
    ]);
    openOrders = (ops ?? 0) + (unpaid ?? 0);
  }
  // Demo outlets ship from free text; real outlets need the Mengantar pickup address.
  // A pickup that no longer exists in the seller's account is not ready.
  const pickupReady = ws.isDemo ? Boolean(ws.outlet.pickupAddress && ws.outlet.pickupArea)
    : Boolean(ws.outlet.mengantarPickupId) && (pickupOptions === null || pickupOptions.some((a) => a.id === ws.outlet.mengantarPickupId));
  const provider: Readiness = ws.isDemo ? "simulated" : keyWorks ? "ready" : credential.configured ? "unverified" : "blocked";
  const quoting: Readiness = ws.isDemo ? "simulated" : keyWorks && pickupReady ? "ready" : "blocked";
  const rows: { name: string; state: Readiness; detail: string }[] = [
    { name: "Alamat pickup outlet", state: pickupReady ? "ready" : "blocked",
      detail: pickupReady ? `${ws.outlet.pickupAddress}, ${ws.outlet.pickupArea}`
        : ws.isDemo ? "Isi alamat pickup sebelum cek ongkir." : "Admin gerai memilih alamat pickup dari akun Mengantar." },
    { name: "Akun Mengantar", state: provider,
      detail: ws.isDemo ? "Demo memakai penyedia simulasi; tidak terhubung ke Mengantar."
        : keyWorks ? `Terhubung: kunci berakhiran …${credential.hint} berhasil membaca akun Mengantar.`
        : credential.configured ? `Kunci API berakhiran …${credential.hint} tersimpan terenkripsi (${formatWib(credential.created_at)}). ${mengantarProblem ?? "Belum diverifikasi ke Mengantar."}`
        : "Belum terhubung. Admin gerai bisa menyimpan kunci API akun Mengantar milik bisnis ini." },
    { name: "Cek ongkir", state: quoting,
      detail: ws.isDemo ? "Harga adalah contoh." : quoting === "ready" ? "Ongkir langsung dari Mengantar dengan kunci gerai ini." : "Butuh akun Mengantar yang terhubung dan alamat pickup." },
    { name: "Penerbitan resi", state: ws.isDemo ? "simulated" : quoting,
      detail: ws.isDemo ? "Resi adalah contoh." : quoting === "ready" ? "Resi diterbitkan langsung di akun Mengantar gerai ini dan dibayar dari saldonya." : "Butuh akun Mengantar yang terhubung dan alamat pickup." },
    { name: "Label cetak lokal (barcode resi)", state: ws.isDemo ? "simulated" : whatsapp ? "unverified" : "blocked",
      detail: ws.isDemo ? "Demo hanya menampilkan label contoh berwatermark."
        : whatsapp ? "Label dicetak dari GeraiExpress setelah resi terbit. Penerimaan kurir terhadap label cetak lokal belum terbukti."
        : "Nomor WhatsApp gerai belum diisi, jadi label belum bisa dicetak. Admin gerai mengisinya di bagian Identitas label." },
    { name: "Masking pengirim di label", state: ws.isDemo ? "simulated" : maskingAllowed ? "unverified" : "blocked",
      detail: ws.isDemo ? "Tidak berlaku di demo."
        : maskingAllowed ? "Dipilih per label dan standarnya mati. Penerimaan kurir terhadap label bermasking belum terbukti."
        : "Dinonaktifkan oleh administrator platform. Label dicetak dengan identitas gerai." },
    { name: "Pelacakan status kurir", state: "blocked", detail: "Belum diaktifkan pada versi ini." },
  ];

  const connectionMode = onboarding.connection_mode === "partner_managed" ? "Partner Mengantar"
    : onboarding.connection_mode === "byok" || credential.configured ? "Kunci API sendiri" : "Belum ada akun terhubung";

  const sections: SettingsSection[] = ws.isDemo
    ? [{ id: "kesiapan", label: "Kesiapan" }, { id: "demo", label: "Demo" }]
    : [
        { id: "kesiapan", label: "Kesiapan" },
        { id: "mengantar", label: "Mengantar" },
        { id: "alamat-jemput", label: "Alamat jemput" },
        { id: "whatsapp-gerai", label: "WhatsApp gerai" },
        { id: "harga", label: "Harga & diskon" },
      ];

  return (
    <div className="flex max-w-[1120px] flex-col gap-6 lg:gap-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-[28px] leading-tight tracking-tight md:text-3xl">Pengaturan</h1>
        <p className="text-muted-foreground">Kesiapan {ws.outlet.name} untuk setiap kemampuan. Peran Anda: {isAdmin ? "Admin gerai" : "Operator"}.</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[200px_minmax(0,1fr)] lg:gap-10">
        <SettingsNav sections={sections} />

        <div className="flex min-w-0 flex-col gap-10">
          <Group id="kesiapan" title="Kesiapan outlet" description="Setiap kemampuan punya status sendiri; akun yang terhubung belum berarti semuanya siap.">
            <ul className="divide-y divide-border rounded-lg bg-card ring-1 ring-border">
              {rows.map((r) => (
                <li key={r.name} className="flex flex-col gap-2 px-5 py-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
                  <span className="min-w-0">
                    <span className="block">{r.name}</span>
                    <span className="block text-sm text-muted-foreground">{r.detail}</span>
                  </span>
                  <span className="shrink-0 self-start"><ReadinessBadge state={r.state} /></span>
                </li>
              ))}
            </ul>
          </Group>

          {ws.isDemo ? (
            <Group id="demo" title="Dibatasi di demo">
              <div className={CARD}>
                <p>Menghubungkan akun Mengantar, membuat akun penjual, mengundang staf, dan pembayaran sungguhan hanya tersedia di ruang kerja gerai asli yang sudah disetujui.</p>
              </div>
            </Group>
          ) : (
            <>
              <Group id="mengantar" title="Mengantar" description="Akun penjual Mengantar milik bisnis ini dipakai untuk cek ongkir, penerbitan resi dan alamat jemput.">
                <div className="flex flex-col rounded-lg bg-card ring-1 ring-border">
                  <dl className="divide-y divide-border">
                    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 px-5 py-4">
                      <dt>Koneksi</dt>
                      <dd><ReadinessBadge state={provider} /></dd>
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 px-5 py-4">
                      <dt>Cara terhubung</dt>
                      <dd className="text-muted-foreground">{connectionMode}</dd>
                    </div>
                    {checkedAt ? (
                      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 px-5 py-4">
                        <dt>Terakhir diperiksa</dt>
                        <dd className="text-muted-foreground tabular">{formatWib(checkedAt)} · {keyWorks ? "akun terbaca" : "belum terbaca"}</dd>
                      </div>
                    ) : null}
                  </dl>
                  {!isAdmin ? (
                    <p className="border-t border-border px-5 py-4 text-sm text-muted-foreground">
                      Hanya admin gerai yang dapat menghubungkan, mengganti atau menghapus akun Mengantar.
                    </p>
                  ) : null}
                </div>

                {isAdmin ? (
                  <section aria-labelledby="partner-onboarding-heading" className={CARD}>
                    <div className="flex flex-col gap-1">
                      <h3 id="partner-onboarding-heading" className="text-[17px]">Pendaftaran akun Mengantar baru (Partner)</h3>
                      <p className="text-sm text-muted-foreground">
                        Belum punya akun Mengantar untuk gerai ini? Daftarkan akun penjual baru secara resmi melalui integrasi Partner Mengantar.
                      </p>
                    </div>
                    <PartnerSellerOnboardingForm onboarding={onboarding} />
                  </section>
                ) : null}

                {isAdmin ? (
                  <section aria-labelledby="mengantar-heading" className={CARD}>
                    <div className="flex flex-col gap-1">
                      <h3 id="mengantar-heading" className="text-[17px]">Akun Mengantar (kunci API sendiri)</h3>
                      <p className="text-sm text-muted-foreground">
                        Hubungkan akun penjual Mengantar yang sudah dimiliki bisnis ini. GeraiExpress tidak pernah meminta kata sandi Mengantar.
                        Kunci dipakai server untuk membaca alamat pickup, cek ongkir dan menerbitkan resi.
                      </p>
                    </div>
                    {credential.configured && credential.version ? (
                      <div className="flex flex-col gap-2 border-y border-border py-4 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex min-w-0 flex-col gap-1">
                          <p data-testid="seller-key-status">Tersimpan: kunci berakhiran <span className="tabular">…{credential.hint}</span> (versi {credential.version}).</p>
                          <p className="text-sm text-muted-foreground">Kunci tidak pernah ditampilkan lagi setelah disimpan.</p>
                        </div>
                        <RemoveSellerKeyForm version={credential.version} />
                      </div>
                    ) : null}
                    {openOrders > 0 ? (
                      <Alert role="note" className="border-0 bg-warning-soft" data-testid="open-orders-warning">
                        <AlertTriangle className="text-warning" aria-hidden="true" />
                        <AlertDescription className="text-foreground">
                          {openOrders} pengiriman masih diproses atau menunggu pembayaran dengan kunci ini. Jika kunci diganti, pengiriman itu harus diperiksa manual di aplikasi Mengantar.
                        </AlertDescription>
                      </Alert>
                    ) : null}
                    <SellerKeyForm latestVersion={credential.latest_version} replacing={credential.configured} />
                  </section>
                ) : null}
              </Group>

              <Group id="alamat-jemput" title="Alamat jemput" description={`Alamat tempat kurir menjemput paket ${ws.outlet.name}.`}>
                {isAdmin && credential.configured ? (
                  <section aria-labelledby="pickup-heading" className={CARD}>
                    <div className="flex flex-col gap-1">
                      <h3 id="pickup-heading" className="text-[17px]">Alamat pickup Mengantar</h3>
                      <p className="text-sm text-muted-foreground">
                        Pilih alamat pickup {ws.outlet.name} dari alamat yang tersimpan di akun Mengantar. Alamat baru dibuat atau diubah di aplikasi Mengantar.
                      </p>
                    </div>
                    {pickupOptions === null ? (
                      <Alert className="border-0 bg-warning-soft">
                        <AlertTriangle className="text-warning" aria-hidden="true" />
                        <AlertDescription className="text-foreground">{mengantarProblem}</AlertDescription>
                      </Alert>
                    ) : pickupOptions.length === 0 ? (
                      <p className="rounded-md bg-muted p-3">Akun Mengantar ini belum punya alamat pickup. Tambahkan dulu di aplikasi Mengantar.</p>
                    ) : (
                      <PickupForm addresses={pickupOptions} current={ws.outlet.mengantarPickupId} />
                    )}
                  </section>
                ) : (
                  <div className={CARD}>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <p className="min-w-0">{pickupReady ? `${ws.outlet.pickupAddress}, ${ws.outlet.pickupArea}` : "Alamat jemput belum dipilih."}</p>
                      <ReadinessBadge state={pickupReady ? "ready" : "blocked"} />
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {isAdmin
                        ? "Hubungkan akun Mengantar di atas dulu; alamat jemput dipilih dari alamat yang tersimpan di akun itu."
                        : "Alamat jemput dipilih admin gerai dari akun Mengantar."}
                    </p>
                  </div>
                )}
              </Group>

              <Group id="whatsapp-gerai" title="WhatsApp gerai" description="Nomor ini dicetak di label sebagai kontak pengirim saat masking pengirim tidak dipakai.">
                <section aria-labelledby="label-identity-heading" className={CARD}>
                  <div className="flex flex-col gap-1">
                    <h3 id="label-identity-heading" className="text-[17px]">Identitas label</h3>
                    <p className="text-sm text-muted-foreground">
                      Label cetak memakai nama gerai, nomor WhatsApp gerai dan alamat pickup sebagai pengirim. Operator dapat memakai masking pengirim per label untuk menampilkan nama, nomor HP dan kota yang diisi sendiri.
                    </p>
                  </div>
                  {isAdmin ? (
                    <WhatsappForm value={whatsapp} revision={tenantRow?.contact_whatsapp_revision ?? 0} />
                  ) : (
                    <div className="flex flex-col gap-1" data-testid="whatsapp-readonly">
                      <span>Nomor WhatsApp gerai</span>
                      <span className="tabular">{whatsapp ?? "Belum diisi"}</span>
                      <span className="text-sm text-muted-foreground">Hanya admin gerai yang dapat mengubah nomor ini.</span>
                    </div>
                  )}
                  {!maskingAllowed ? (
                    <Alert role="note" className="border-0 bg-muted" data-testid="masking-disabled-note">
                      <Info aria-hidden="true" />
                      <AlertDescription className="text-foreground">{MASKING_DISABLED}</AlertDescription>
                    </Alert>
                  ) : null}
                  {isAdmin ? <p className="text-sm text-muted-foreground">{RETENTION_NOTE}</p> : null}
                </section>
              </Group>

              <Group id="harga" title="Harga & diskon" description="Ketentuan harga yang ditetapkan GeraiExpress untuk gerai ini. Hanya dapat dibaca.">
                {isAdmin ? (
                  <GeraiDiscountCard tenantId={ws.tenant.id} />
                ) : (
                  <div className={CARD}>
                    <p className="text-sm text-muted-foreground">Diskon dan biaya gerai hanya terlihat oleh admin gerai.</p>
                  </div>
                )}
              </Group>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
