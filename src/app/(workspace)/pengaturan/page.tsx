import type { Metadata } from "next";
import { CheckCircle2, CircleSlash, FlaskConical, HelpCircle } from "lucide-react";
import { formatWib } from "@/lib/format";
import { supabaseServer } from "@/lib/supabase/server";
import { requireWorkspace } from "@/lib/workspace";
import { RemoveSellerKeyForm, SellerKeyForm } from "@/modules/credentials/forms";

type CredentialStatus = { configured: boolean; hint: string | null; version: number | null; created_at: string | null; latest_version: number };

export const metadata: Metadata = { title: "Pengaturan" };

type Readiness = "ready" | "simulated" | "blocked" | "unverified";
const STATE: Record<Readiness, { label: string; Icon: typeof CheckCircle2 }> = {
  ready: { label: "Siap", Icon: CheckCircle2 },
  simulated: { label: "Simulasi", Icon: FlaskConical },
  blocked: { label: "Belum tersedia", Icon: CircleSlash },
  unverified: { label: "Belum diverifikasi", Icon: HelpCircle },
};

// PR-8: each capability has its own readiness; a connected account is never "all ready".
export default async function SettingsPage() {
  const ws = await requireWorkspace();
  const pickupReady = Boolean(ws.outlet.pickupAddress && ws.outlet.pickupArea);
  const { data: raw } = await (await supabaseServer()).rpc("seller_credential_status", { p_tenant: ws.tenant.id });
  const credential = ((raw ?? []) as CredentialStatus[])[0] ?? { configured: false, hint: null, version: null, created_at: null, latest_version: 0 };
  // A stored key is not a verified connection: it stays "Belum diverifikasi" until a provider check exists.
  const provider: Readiness = ws.isDemo ? "simulated" : credential.configured ? "unverified" : "blocked";
  const rows: { name: string; state: Readiness; detail: string }[] = [
    { name: "Alamat pickup outlet", state: pickupReady ? "ready" : "blocked",
      detail: pickupReady ? `${ws.outlet.pickupAddress}, ${ws.outlet.pickupArea}` : "Isi alamat pickup sebelum cek ongkir." },
    { name: "Akun Mengantar", state: provider,
      detail: ws.isDemo ? "Demo memakai penyedia simulasi; tidak terhubung ke Mengantar."
        : credential.configured ? `Kunci API berakhiran …${credential.hint} tersimpan terenkripsi (${formatWib(credential.created_at)}). Belum diverifikasi ke Mengantar.`
        : "Belum terhubung. Admin gerai bisa menyimpan kunci API akun Mengantar milik bisnis ini." },
    { name: "Cek ongkir & penerbitan resi", state: provider,
      detail: ws.isDemo ? "Harga dan resi adalah contoh." : "Butuh akun Mengantar yang terhubung dan terverifikasi." },
    { name: "Identitas pengirim pelanggan (dropshipper)", state: ws.isDemo ? "simulated" : "unverified",
      detail: "Nama/HP pelanggan di resi resmi butuh izin dropshipper di akun Mengantar." },
    { name: "Label resmi (PDF kurir)", state: ws.isDemo ? "simulated" : "unverified",
      detail: ws.isDemo ? "Demo hanya menampilkan label contoh berwatermark." : "Butuh izin pembuatan label di akun Mengantar." },
    { name: "Pelacakan status kurir", state: "blocked", detail: "Belum diaktifkan pada versi ini." },
  ];

  return (
    <div className="flex max-w-[980px] flex-col gap-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl tracking-tight">Pengaturan</h1>
        <p className="text-muted-foreground">Kesiapan {ws.outlet.name} untuk setiap kemampuan. Peran Anda: {ws.role === "tenant_admin" ? "Admin gerai" : "Operator"}.</p>
      </div>

      <section aria-labelledby="ready-heading" className="flex flex-col gap-3">
        <h2 id="ready-heading" className="text-xl">Kesiapan outlet</h2>
        <ul className="divide-y divide-border rounded-lg bg-card ring-1 ring-border">
          {rows.map((r) => {
            const { label, Icon } = STATE[r.state];
            return (
              <li key={r.name} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-start sm:justify-between">
                <span className="min-w-0">
                  <span className="font-semibold">{r.name}</span>
                  <span className="block text-sm text-muted-foreground">{r.detail}</span>
                </span>
                <span className="inline-flex shrink-0 items-center gap-1.5 self-start rounded-full bg-muted px-2.5 py-1 text-sm ring-1 ring-border">
                  <Icon className="size-4" aria-hidden="true" /> {label}
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      {ws.role === "tenant_admin" && !ws.isDemo ? (
        <section aria-labelledby="mengantar-heading" className="flex flex-col gap-3 rounded-lg bg-card p-6 ring-1 ring-border">
          <h2 id="mengantar-heading" className="text-xl">Akun Mengantar (kunci API sendiri)</h2>
          <p className="text-sm text-muted-foreground">
            Hubungkan akun penjual Mengantar yang sudah dimiliki bisnis ini. GeraiExpress tidak pernah meminta kata sandi Mengantar.
            Kunci baru dipakai setelah fitur verifikasi dan pengiriman langsung diaktifkan.
          </p>
          {credential.configured && credential.version ? (
            <div className="flex flex-col gap-2 rounded-md bg-muted p-4">
              <p data-testid="seller-key-status">Tersimpan: kunci berakhiran <span className="font-semibold">…{credential.hint}</span> (versi {credential.version}).</p>
              <RemoveSellerKeyForm version={credential.version} />
            </div>
          ) : null}
          <SellerKeyForm latestVersion={credential.latest_version} replacing={credential.configured} />
        </section>
      ) : null}

      {ws.isDemo ? (
        <section aria-labelledby="demo-heading" className="flex flex-col gap-2 rounded-lg bg-card p-6 ring-1 ring-border">
          <h2 id="demo-heading" className="text-xl">Dibatasi di demo</h2>
          <p>Menghubungkan akun Mengantar, membuat akun penjual, mengundang staf, dan pembayaran sungguhan hanya tersedia di ruang kerja gerai asli yang sudah disetujui.</p>
        </section>
      ) : null}
    </div>
  );
}
