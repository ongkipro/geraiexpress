import type { Metadata } from "next";
import { CheckCircle2, CircleSlash, FlaskConical, HelpCircle } from "lucide-react";
import { formatWib } from "@/lib/format";
import { supabaseServer } from "@/lib/supabase/server";
import { requireWorkspace } from "@/lib/workspace";
import { RemoveSellerKeyForm, SellerKeyForm } from "@/modules/credentials/forms";
import { PickupForm } from "@/modules/mengantar/pickup-form";
import { mengantarFailure, tenantMengantar } from "@/lib/mengantar/tenant";
import type { PickupAddress } from "@/lib/mengantar/public-api";
import { friendlyError } from "@/lib/errors";

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
  const { data: raw } = await (await supabaseServer()).rpc("seller_credential_status", { p_tenant: ws.tenant.id });
  const credential = ((raw ?? []) as CredentialStatus[])[0] ?? { configured: false, hint: null, version: null, created_at: null, latest_version: 0 };

  // T-023: with a stored key, the server reads the seller's saved pickup addresses through it; a
  // successful read is the first proof the key works against Mengantar. Only for admins, who
  // can act on it: operators see the stored state without spending provider calls.
  let pickupOptions: PickupAddress[] | null = null;
  let mengantarProblem: string | null = null;
  if (!ws.isDemo && credential.configured && ws.role === "tenant_admin") {
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
  if (!ws.isDemo && credential.configured && ws.role === "tenant_admin") {
    const sb = await supabaseServer();
    const [{ count: ops }, { count: unpaid }] = await Promise.all([
      sb.from("provider_operations").select("id", { count: "exact", head: true }).eq("tenant_id", ws.tenant.id)
        .eq("is_simulated", false).in("state", ["queued", "in_flight", "unknown"]),
      sb.from("shipments").select("id", { count: "exact", head: true }).eq("tenant_id", ws.tenant.id).eq("submission_state", "awaiting_payment"),
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
            Kunci dipakai server untuk membaca alamat pickup, cek ongkir dan menerbitkan resi.
          </p>
          {credential.configured && credential.version ? (
            <div className="flex flex-col gap-2 rounded-md bg-muted p-4">
              <p data-testid="seller-key-status">Tersimpan: kunci berakhiran <span className="font-semibold">…{credential.hint}</span> (versi {credential.version}).</p>
              <RemoveSellerKeyForm version={credential.version} />
            </div>
          ) : null}
          {openOrders > 0 ? (
            <p role="note" className="rounded-md bg-muted p-3 text-sm" data-testid="open-orders-warning">
              <span aria-hidden="true">⚠ </span>{openOrders} pengiriman masih diproses atau menunggu pembayaran dengan kunci ini. Jika kunci diganti, pengiriman itu harus diperiksa manual di aplikasi Mengantar.
            </p>
          ) : null}
          <SellerKeyForm latestVersion={credential.latest_version} replacing={credential.configured} />
        </section>
      ) : null}

      {ws.role === "tenant_admin" && !ws.isDemo && credential.configured ? (
        <section aria-labelledby="pickup-heading" className="flex flex-col gap-3 rounded-lg bg-card p-6 ring-1 ring-border">
          <h2 id="pickup-heading" className="text-xl">Alamat pickup Mengantar</h2>
          <p className="text-sm text-muted-foreground">
            Pilih alamat pickup {ws.outlet.name} dari alamat yang tersimpan di akun Mengantar. Alamat baru dibuat atau diubah di aplikasi Mengantar.
          </p>
          {pickupOptions === null ? (
            <p role="alert" className="rounded-md bg-muted p-3"><span aria-hidden="true">⚠ </span>{mengantarProblem}</p>
          ) : pickupOptions.length === 0 ? (
            <p className="rounded-md bg-muted p-3">Akun Mengantar ini belum punya alamat pickup. Tambahkan dulu di aplikasi Mengantar.</p>
          ) : (
            <PickupForm addresses={pickupOptions} current={ws.outlet.mengantarPickupId} />
          )}
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
