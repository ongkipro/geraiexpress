import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { courierName } from "@/lib/format";
import { courierTrackingUrl, publicTracking } from "@/modules/tracking/projection";
import { TRACKING_PROJECTION_HEADER } from "@/modules/tracking/public-read";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Lacak pengiriman",
  robots: { index: false, follow: false, noarchive: true },
};

const date = (value: string) => new Intl.DateTimeFormat("id-ID", {
  dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta",
}).format(new Date(value));

export default async function TrackingPage() {
  // This header is always stripped and replaced by the host-gated proxy, never trusted from a visitor.
  const raw = (await headers()).get(TRACKING_PROJECTION_HEADER);
  let projection = null;
  try { projection = raw ? publicTracking(JSON.parse(decodeURIComponent(raw))) : null; } catch { /* fail closed */ }
  if (!projection) notFound();
  const courierUrl = courierTrackingUrl(projection.courier);
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col gap-6 px-5 py-10">
      <header className="space-y-2">
        <p className="text-sm text-muted-foreground">GeraiExpress</p>
        <h1 className="text-2xl font-semibold tracking-tight">Lacak pengiriman</h1>
        {projection.gerai_label ? <p>{projection.gerai_label}</p> : null}
      </header>
      <section aria-label="Informasi pengiriman" className="space-y-4 rounded-xl border bg-card p-5">
        <p className="font-medium">{projection.courier ? courierName(projection.courier) : "Kurir belum tersedia"} {projection.service}</p>
        <dl className="grid gap-4 text-sm">
          <div><dt className="text-muted-foreground">Nomor resi</dt><dd className="break-all text-xl font-semibold">{projection.awb}</dd></div>
          <div><dt className="text-muted-foreground">Kota tujuan</dt><dd>{projection.destination_city ?? "Belum tersedia"}</dd></div>
          <div><dt className="text-muted-foreground">Pengirim</dt><dd>{projection.sender_initials ?? "Disembunyikan"}</dd></div>
          <div><dt className="text-muted-foreground">Penerima</dt><dd>{projection.recipient_initials ?? "Disembunyikan"}</dd></div>
          <div><dt className="text-muted-foreground">Dibuat (WIB)</dt><dd>{date(projection.created_at)}</dd></div>
          {projection.issued_at ? <div><dt className="text-muted-foreground">Resi terbit (WIB)</dt><dd>{date(projection.issued_at)}</dd></div> : null}
        </dl>
      </section>
      <section aria-label="Riwayat status" className="space-y-3 rounded-xl border bg-card p-5">
        <h2 className="font-semibold">{projection.status_label}</h2>
        <p className="text-sm text-muted-foreground">Riwayat perjalanan dari kurir belum tersedia di halaman ini. Tidak ada perkiraan status yang ditampilkan.</p>
        {courierUrl ? <a className="inline-flex min-h-11 items-center text-sm font-medium text-primary underline underline-offset-4" href={courierUrl} target="_blank" rel="noopener noreferrer">Lacak di situs kurir</a> : null}
      </section>
      <p className="text-sm text-muted-foreground">Halaman ini tidak meminta pembayaran atau kode OTP. Simpan tautan ini hanya untuk pihak yang berkepentingan.</p>
    </main>
  );
}
