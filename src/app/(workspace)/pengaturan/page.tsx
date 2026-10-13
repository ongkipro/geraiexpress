import type { Metadata } from "next";
import { CheckCircle2, CircleSlash, FlaskConical, HelpCircle } from "lucide-react";
import { requireWorkspace } from "@/lib/workspace";

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
  const provider: Readiness = ws.isDemo ? "simulated" : "blocked";
  const rows: { name: string; state: Readiness; detail: string }[] = [
    { name: "Alamat pickup outlet", state: pickupReady ? "ready" : "blocked",
      detail: pickupReady ? `${ws.outlet.pickupAddress}, ${ws.outlet.pickupArea}` : "Isi alamat pickup sebelum cek ongkir." },
    { name: "Akun Mengantar", state: provider,
      detail: ws.isDemo ? "Demo memakai penyedia simulasi; tidak terhubung ke Mengantar." : "Belum terhubung. Penghubungan akun penjual akan dibuka setelah kebijakan pemilik akun disetujui." },
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

      {ws.isDemo ? (
        <section aria-labelledby="demo-heading" className="flex flex-col gap-2 rounded-lg bg-card p-6 ring-1 ring-border">
          <h2 id="demo-heading" className="text-xl">Dibatasi di demo</h2>
          <p>Menghubungkan akun Mengantar, membuat akun penjual, mengundang staf, dan pembayaran sungguhan hanya tersedia di ruang kerja gerai asli yang sudah disetujui.</p>
        </section>
      ) : null}
    </div>
  );
}
