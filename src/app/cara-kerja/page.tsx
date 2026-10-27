import type { Metadata } from "next";
import {
  MarketingClosingCta,
  MarketingPageHero,
  MarketingShell,
} from "@/components/marketing/marketing-shell";
import { BRAND } from "@/lib/marketing-data";

export const metadata: Metadata = {
  title: "Alur 4 Langkah Kasir Loket Pengiriman Multi-Kurir",
  description:
    "Alur kasir loket GeraiExpress: isi data pengirim, timbang paket dan cek ongkir, terima pembayaran, lalu cetak resi thermal 100 x 150 mm untuk kurir.",
  robots: { index: true, follow: true },
  alternates: { canonical: "/cara-kerja" },
  openGraph: {
    title: "Alur 4 Langkah Kasir Loket Pengiriman Multi-Kurir · GeraiExpress",
    description:
      "Alur kasir loket GeraiExpress: isi data pengirim, timbang paket dan cek ongkir, terima pembayaran, lalu cetak resi thermal 100 x 150 mm untuk kurir.",
    url: "https://geraiexpress.com/cara-kerja",
    siteName: "GeraiExpress",
    locale: "id_ID",
    type: "website",
  },
};

const STEPS = [
  [
    "Isi data pengirim dan penerima",
    "Pilih dari kontak tersimpan atau ketik baru. Pelanggan langganan tidak perlu mengetik ulang dari awal.",
    "Contoh: penerima Ibu Contoh, Coblong, Kota Bandung.",
  ],
  [
    "Timbang paket dan cek ongkir",
    "Masukkan berat dan, bila perlu, ukuran kardus. Tarif ekspedisi tampil berdampingan untuk dipilih pelanggan.",
    "Contoh: 1 kg, J&T Rp 15.000 dipilih dari daftar tarif.",
  ],
  [
    "Terima pembayaran",
    "Pelanggan membayar ongkir di kasir, tunai atau lewat QRIS milik toko. Komisi 20%–25% menjadi laba toko.",
    "Contoh: pelanggan bayar ongkir tunai di kasir.",
  ],
  [
    "Cetak resi thermal",
    "Tekan Cetak resi, atau Cetak resi + invoice untuk sekalian memberi nota. Label 100 × 150 mm siap ditempel di kardus.",
    "Contoh: resi JP0000000000001 tercetak 10 × 15 cm.",
  ],
] as const;

const PICKUP_FLOW = [
  [
    "Jadwalkan jemput",
    "Saat membuat kiriman, pilih penjemputan dan jamnya. Jadwal diteruskan ke kurir lewat Mengantar.",
  ],
  [
    "Kurir datang ke toko",
    "Kurir resmi datang mengambil paket di toko Anda tanpa biaya jemput.",
  ],
  [
    "Tandai serah terima",
    "Kasir menandai paket yang sudah diserahkan, jadi antrean selalu jelas: belum dicetak, siap diserahkan, atau sudah diserahkan.",
  ],
] as const;

const EQUIPMENT = [
  [
    "Laptop, komputer, atau HP",
    `Buka ${BRAND} lewat browser di perangkat kasir yang sudah ada.`,
  ],
  [
    "Timbangan meja digital",
    "Timbangan digital biasa yang sudah dipakai toko sudah cukup.",
  ],
  [
    "Printer thermal",
    "Printer label 100 × 150 mm untuk resi; printer struk 80 mm bisa dipakai untuk nota.",
  ],
  [
    "Koneksi internet",
    "WiFi toko atau hotspot HP sudah cukup untuk melayani transaksi.",
  ],
] as const;

export default function CaraKerjaPage() {
  return (
    <MarketingShell currentPath="/cara-kerja">
      <MarketingPageHero
        title="Alur 4 langkah kasir: cepat, praktis, gratis"
        lead="Staf kasir baru langsung bisa melayani. Isi data pengirim, timbang paket, terima pembayaran, lalu cetak resi thermal."
      />

      <section className="py-14 sm:py-20" aria-labelledby="judul-langkah">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
          <h2 id="judul-langkah" className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            4 langkah melayani kiriman di meja kasir
          </h2>
          <p className="mt-2 max-w-2xl text-base leading-relaxed text-muted-foreground">
            Semua tahap dilakukan di depan pelanggan dari satu layar.
          </p>
          <ol className="mt-10 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map(([heading, text, example], index) => (
              <li key={heading} className="rounded-2xl border border-border bg-card p-5">
                <span
                  className="flex size-10 items-center justify-center rounded-full bg-primary text-base font-semibold text-primary-foreground"
                  aria-hidden="true"
                >
                  {index + 1}
                </span>
                <h3 className="mt-4 text-lg font-semibold text-foreground">{heading}</h3>
                <p className="mt-1.5 text-base leading-relaxed text-muted-foreground">{text}</p>
                <p className="mt-3 border-l-2 border-primary pl-3 text-sm font-semibold text-foreground">{example}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="border-y border-border bg-[#1d1d1f] py-14 text-white sm:py-20" aria-labelledby="judul-jemput">
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 sm:px-6 lg:grid-cols-2 lg:px-8">
          <div>
            <h2 id="judul-jemput" className="text-2xl font-semibold tracking-tight sm:text-3xl">
              Kurir resmi menjemput paket ke toko
            </h2>
            <p className="mt-3 text-base leading-relaxed text-[#cccccc]">
              Tidak perlu mengantar paket ke kantor cabang. Kurir yang datang ke toko Anda.
            </p>
            <ol className="mt-8 space-y-6">
              {PICKUP_FLOW.map(([heading, text]) => (
                <li key={heading} className="border-l-2 border-[#2997ff] pl-5">
                  <h3 className="text-lg font-semibold">{heading}</h3>
                  <p className="mt-1 text-base leading-relaxed text-[#cccccc]">{text}</p>
                </li>
              ))}
            </ol>
          </div>

          <div
            className="rounded-2xl border border-white/15 bg-[#272729] p-6 text-sm text-white"
            aria-label="Ilustrasi antrean penjemputan kurir di loket"
          >
            <p className="text-xs font-semibold uppercase tracking-wider text-[#cccccc]">
              Contoh Antrean Serah Terima Loket
            </p>
            <ul className="mt-4 space-y-3">
              <li className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-[#1d1d1f] p-3.5">
                <div>
                  <p className="font-semibold">J&amp;T Express · JP0000000000001</p>
                  <p className="text-xs text-[#cccccc]">Tujuan: Coblong, Kota Bandung · 1 kg</p>
                </div>
                <span className="rounded-sm bg-primary px-2.5 py-1 text-xs font-semibold text-white">
                  Siap diserahkan
                </span>
              </li>
              <li className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-[#1d1d1f] p-3.5">
                <div>
                  <p className="font-semibold">SiCepat · 004190000002</p>
                  <p className="text-xs text-[#cccccc]">Tujuan: Tebet, Jakarta Selatan · 2 kg</p>
                </div>
                <span className="rounded-sm border border-white/20 px-2.5 py-1 text-xs font-semibold text-[#cccccc]">
                  Sudah diserahkan
                </span>
              </li>
              <li className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-[#1d1d1f] p-3.5">
                <div>
                  <p className="font-semibold">JNE · 8800000000003</p>
                  <p className="text-xs text-[#cccccc]">Tujuan: Gubeng, Surabaya · 1 kg</p>
                </div>
                <span className="rounded-sm border border-white/20 px-2.5 py-1 text-xs font-semibold text-[#cccccc]">
                  Belum dicetak
                </span>
              </li>
            </ul>
          </div>
        </div>
      </section>

      <section className="py-14 sm:py-20" aria-labelledby="judul-perangkat">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 sm:px-6 lg:grid-cols-[1fr_2fr] lg:px-8">
          <div>
            <h2 id="judul-perangkat" className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
              Pakai perangkat toko yang sudah ada
            </h2>
            <p className="mt-3 text-base leading-relaxed text-muted-foreground">
              Tidak perlu membeli paket alat khusus. Ini yang dibutuhkan di meja kasir.
            </p>
          </div>
          <ul className="grid gap-x-10 gap-y-8 sm:grid-cols-2">
            {EQUIPMENT.map(([heading, text]) => (
              <li key={heading} className="border-t-2 border-primary pt-4">
                <h3 className="text-lg font-semibold text-foreground">{heading}</h3>
                <p className="mt-1.5 text-base leading-relaxed text-muted-foreground">{text}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <MarketingClosingCta
        heading="Siap melayani kiriman pertama?"
        text="Siapkan printer thermal dan akun Mengantar gerai, lalu ikuti tiga tahap ini:"
      />
    </MarketingShell>
  );
}
