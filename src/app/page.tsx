import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { MarketingClosingCta, MarketingShell } from "@/components/marketing/marketing-shell";
import { ProfitSimulator } from "@/components/marketing/profit-simulator";
import { TariffExample } from "@/components/marketing/tariff-example";
import {
  BRAND,
  ORDERABLE_COURIERS,
  QUOTE_ONLY_COURIERS,
  SAMPLE_LABEL as label,
  SIGN_IN_URL,
  SIGN_UP_URL,
  encodeCode128B,
  formatIdr,
} from "@/lib/marketing-data";
import { loadPlatform } from "@/lib/platform";
import { supabaseServer } from "@/lib/supabase/server";
import { loadWorkspace } from "@/lib/workspace";

export const metadata: Metadata = {
  title: "Kasir Loket Pengiriman Multi-Kurir Gratis · GeraiExpress",
  description:
    "Buka loket 12+ layanan ekspedisi di toko Anda bersama GeraiExpress. Komisi 20%–25% per paket lewat Mengantar, cetak resi thermal 10 x 15 cm, dan kurir jemput ke toko.",
  robots: { index: true, follow: true },
  alternates: { canonical: "/" },
  openGraph: {
    title: "Kasir Loket Pengiriman Multi-Kurir Gratis · GeraiExpress",
    description:
      "Buka loket 12+ layanan ekspedisi di toko Anda bersama GeraiExpress. Komisi 20%–25% per paket lewat Mengantar, cetak resi thermal 10 x 15 cm, dan kurir jemput ke toko.",
    url: "https://geraiexpress.com/",
    siteName: "GeraiExpress",
    locale: "id_ID",
    type: "website",
  },
};

const BUSINESS_TYPES = [
  {
    tag: "PPOB & Seluler",
    title: "Konter pulsa & PPOB",
    text: "Terima kiriman paket dengan komisi bersih Rp 3.000–Rp 15.000 per paket. Kirim 40 paket sehari, tambahan laba sekitar Rp 4 juta per bulan.",
  },
  {
    tag: "Jasa & Cetak",
    title: "Toko fotokopi & ATK",
    text: "Warga, pelajar, dan olshop sekitar bisa langsung titip kirim paket. Pengunjung bertambah, omzet fotokopi ikut naik.",
  },
  {
    tag: "Ritel Harian",
    title: "Toko sembako & kelontong",
    text: "Pakai sudut meja kasir yang sudah ada. Pembeli sembako sekalian kirim paket, kasir jadi lebih produktif.",
  },
  {
    tag: "Swalayan",
    title: "Minimarket & swalayan lokal",
    text: "Layanan toko makin lengkap. Jadi titik drop paket warga sekitar dengan komisi harian.",
  },
  {
    tag: "Loket Mandiri",
    title: "Agen pengiriman baru",
    text: "Buka loket multi-kurir resmi tanpa modal franchise puluhan juta. Semua pilihan ekspedisi ada di satu sistem.",
  },
  {
    tag: "Kuliner & Oleh-oleh",
    title: "Toko makanan & oleh-oleh",
    text: "Layani kiriman hampers, kue kering, dan oleh-oleh pelanggan langsung dari toko Anda.",
  },
] as const;

const PROBLEMS = [
  [
    "Franchise mahal & cuma 1 kurir",
    "Ada biaya kemitraan jutaan rupiah, tapi hanya dapat 1 ekspedisi. Pelanggan pindah ke toko lain kalau kurir yang dicari tidak ada.",
  ],
  [
    "Uang kasir rawan bocor",
    "Catatan manual sulit dipantau. Transaksi bisa dibatalkan diam-diam tanpa diketahui pemilik toko.",
  ],
  [
    "Tekor denda salah timbang",
    "Salah ukur kardus, selisih ongkir dipotong dari kantong toko. Hasil kerja seharian habis untuk denda.",
  ],
] as const;

const COMPARISON_ROWS = [
  ["Modal awal kemitraan", "Ada biaya kemitraan", "Gratis, tapi tanpa sistem kasir", "Gratis, tanpa biaya kemitraan"],
  ["Keuntungan per paket", "Komisi lebih kecil, sering ada target", "Tarif normal kurir, tanpa margin", "Komisi 20%–25% jadi laba toko"],
  ["Pilihan ekspedisi", "Cuma 1 kurir", "Buka banyak tab, kasir pusing", "Banyak kurir resmi di 1 layar"],
  ["Kewajiban beli alat", "Wajib beli paket alat", "Alat seadanya tanpa printer resi", "Pakai HP, laptop & printer toko"],
  ["Bagi hasil / royalti", "Dipotong royalti bulanan", "Tidak ada bagi hasil", "100% milik toko, bebas royalti"],
  ["Penjemputan paket", "Sering antar sendiri ke hub", "Telepon agen kurir manual", "Jadwalkan jemput kurir dari aplikasi"],
  ["Selisih berat & ukuran", "Sering nombok denda selisih", "Rawan salah timbang", "Ongkir dihitung dari berat dan ukuran sebelum resi terbit"],
  ["Keamanan uang kasir", "Rawan kecurangan kasir", "Rawan selisih saat tutup toko", "Peran kasir dibatasi, pemilik pantau dari HP"],
] as const;

const ADVANTAGES = [
  [
    "Gratis tanpa biaya franchise",
    "Tanpa biaya pendaftaran dan tanpa iuran bulanan. Cukup pakai laptop, HP, dan printer yang sudah ada di toko.",
  ],
  [
    "Komisi bersih 20%–25%",
    "Pelanggan bayar tarif resmi kurir, komisi 20%–25% jadi laba toko tanpa potongan royalti.",
  ],
  [
    "Kurir resmi jemput ke toko",
    "Jadwalkan penjemputan dari aplikasi, kurir resmi datang mengambil paket di toko Anda.",
  ],
  [
    "Drop point multi-ekspedisi",
    "Warga dan seller online sekitar bisa titip kirim lewat banyak ekspedisi di toko Anda.",
  ],
  [
    "Cek ongkir banyak kurir sekaligus",
    "Bandingkan tarif ekspedisi di satu layar. Pelanggan langsung pilih yang termurah atau tercepat.",
  ],
  [
    "Anti-nombok selisih berat",
    "Masukkan berat dan ukuran kardus, ongkir dihitung sebelum resi terbit, jadi toko tidak menanggung selisih.",
  ],
  [
    "COD presisi, cair setiap hari",
    "Nilai COD dihitung otomatis supaya setelah fee COD Mengantar harga barang tetap tertutup. Mengantar mencairkan dana COD setiap hari; kalau paket retur, ongkir pulangnya gratis.",
  ],
  [
    "Cetak resi & kirim via WhatsApp",
    "Cetak label thermal 10 × 15 cm sekali klik, lalu kirim nomor resi ke WhatsApp penerima dari halaman kiriman.",
  ],
  [
    "Kasir aman, pantau dari HP",
    "Operator bekerja dari antrean cetak resi. Pemilik gerai memantau kiriman dan uang gerai dari HP.",
  ],
] as const;

const COUNTER_STEPS = [
  [
    "Ketik data pengirim & penerima",
    "Kontak pelanggan tersimpan, jadi pelanggan langganan tidak perlu ketik ulang dari awal.",
    "Contoh: penerima Ibu Contoh, Coblong, Kota Bandung.",
  ],
  [
    "Timbang & cek ongkir",
    "Masukkan berat dan ukuran, lalu pilih kurir termurah atau tercepat.",
    "Contoh: 1 kg, J&T Rp 15.000 dipilih dari daftar tarif.",
  ],
  [
    "Terima pembayaran",
    "Pelanggan bayar di kasir, tunai atau QRIS milik toko. Komisi jadi laba toko.",
    "Contoh: pelanggan bayar ongkir tunai di kasir.",
  ],
  [
    "Cetak resi & serahkan",
    "Resi thermal keluar sekali klik, lalu paket diserahkan ke kurir yang menjemput.",
    "Contoh: resi JP0000000000001 tercetak 10 × 15 cm.",
  ],
] as const;

function MarketingHomePage() {
  const bars = encodeCode128B(label.awb);
  const cod = label.cod;

  return (
    <MarketingShell currentPath="/">
      <section className="border-b border-border bg-[#1d1d1f] text-white" aria-labelledby="judul">
        <div className="mx-auto max-w-6xl px-4 pb-12 pt-14 sm:px-6 sm:pb-16 sm:pt-20 lg:px-8 lg:pt-24">
          <div className="max-w-3xl">
            <p className="text-sm font-semibold uppercase tracking-wider text-[#cccccc]">
              {BRAND} · Kasir Loket Multi-Kurir
            </p>
            <h1 id="judul" className="mt-3 text-3xl font-semibold leading-tight tracking-tight sm:text-5xl">
              Buka loket 12+ layanan ekspedisi di toko Anda. Gratis.
            </h1>
            <p className="mt-3 text-xl font-semibold tracking-tight text-[#2997ff] sm:text-2xl">
              Komisi 20%–25% per paket, kurir jemput ke toko
            </p>
            <p className="mt-4 max-w-xl text-base leading-relaxed text-[#cccccc] sm:text-lg">
              Konter pulsa, toko kelontong, dan fotokopi bisa langsung terima kiriman J&amp;T, JNE, SiCepat, dan kurir
              lainnya lewat Mengantar. Komisi bersih Rp 3.000–Rp 15.000 per paket, tanpa biaya franchise.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link
                href={SIGN_UP_URL}
                data-cta="daftar"
                className="inline-flex min-h-12 min-w-11 items-center justify-center rounded-full bg-primary px-8 text-base font-semibold text-primary-foreground transition-opacity hover:opacity-90"
              >
                Daftar gratis
              </Link>
              <Link
                href={SIGN_IN_URL}
                data-cta="demo"
                className="inline-flex min-h-12 min-w-11 items-center justify-center rounded-full border border-white/40 px-7 text-base font-semibold text-white transition-colors hover:bg-white/10"
              >
                Coba demo / Masuk
              </Link>
              <a
                href="#simulasi"
                className="inline-flex min-h-12 min-w-11 items-center justify-center rounded-full border border-white/25 px-6 text-base font-semibold text-[#cccccc] transition-colors hover:bg-white/10 hover:text-white"
              >
                Hitung komisi
              </a>
            </div>
          </div>

          <dl className="mt-12 grid max-w-3xl grid-cols-2 gap-x-8 gap-y-5 border-t border-white/15 pt-6 sm:grid-cols-4">
            <div className="flex flex-col">
              <dt className="text-sm text-[#cccccc]">Layanan ekspedisi</dt>
              <dd className="order-first text-2xl font-semibold sm:text-3xl">12+</dd>
            </div>
            <div className="flex flex-col">
              <dt className="text-sm text-[#cccccc]">Komisi per paket</dt>
              <dd className="order-first text-2xl font-semibold text-[#2997ff] sm:text-3xl">20%–25%</dd>
            </div>
            <div className="flex flex-col">
              <dt className="text-sm text-[#cccccc]">Biaya franchise</dt>
              <dd className="order-first text-2xl font-semibold sm:text-3xl">Gratis</dd>
            </div>
            <div className="flex flex-col">
              <dt className="text-sm text-[#cccccc]">Penjemputan</dt>
              <dd className="order-first text-2xl font-semibold sm:text-3xl">Ke toko</dd>
            </div>
          </dl>

          <div className="mt-4">
            <Link
              href="/simulasi#diskon"
              className="inline-flex min-h-11 min-w-11 items-center text-sm font-semibold text-[#2997ff] underline underline-offset-4 hover:text-white"
            >
              Dikembangkan bersama tim Mengantar · Dari mana komisi 20%–25% berasal? →
            </Link>
          </div>
        </div>
      </section>

      <section className="py-14 sm:py-16" aria-labelledby="judul-kurir">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-2xl text-center">
            <h2 id="judul-kurir" className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
              Ekspedisi resmi lewat Mengantar
            </h2>
            <p className="mt-2 text-base leading-relaxed text-muted-foreground">
              {BRAND} terhubung ke jaringan agregator Mengantar. Resi resmi dari kurir, bisa dilacak di aplikasi
              masing-masing. 12+ layanan: delapan kurir di bawah ditambah layanan kargo JNE, SAP, SiCepat, dan ID
              Express.
            </p>
          </div>

          <p className="mt-10 text-center text-sm font-semibold text-foreground">Bisa langsung dipesan</p>
          <ul className="mx-auto mt-4 grid max-w-5xl grid-cols-2 gap-3 sm:grid-cols-4">
            {ORDERABLE_COURIERS.map((courier) => (
              <li
                key={courier.code}
                className="flex flex-col justify-between rounded-lg border border-border bg-background p-4"
              >
                <span className="text-base font-semibold text-foreground">{courier.name}</span>
                <span className="mt-1 text-xs text-muted-foreground">{courier.services}</span>
              </li>
            ))}
          </ul>

          <p className="mt-6 text-center text-sm text-muted-foreground">
            Tarif sudah tampil di cek ongkir, pemesanan menyusul:{" "}
            {QUOTE_ONLY_COURIERS.map((c) => c.name).join(", ")}.
          </p>
        </div>
      </section>

      <section className="border-y border-border bg-background py-14 sm:py-20" aria-labelledby="judul-usaha">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
          <div className="mx-auto mb-10 max-w-2xl text-center sm:mb-12">
            <h2 id="judul-usaha" className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
              Cocok untuk berbagai jenis usaha
            </h2>
            <p className="mt-2 text-base leading-relaxed text-muted-foreground">
              Pakai meja kasir dan perangkat yang sudah ada di toko. Tanpa sewa tempat baru, tanpa biaya franchise.
            </p>
          </div>
          <ul className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {BUSINESS_TYPES.map((item) => (
              <li key={item.title} className="rounded-2xl border border-border bg-card p-6">
                <span className="inline-block rounded-sm bg-background px-2.5 py-1 text-xs font-semibold text-primary">
                  {item.tag}
                </span>
                <h3 className="mt-3 text-lg font-semibold leading-snug text-foreground">{item.title}</h3>
                <p className="mt-2 text-base leading-relaxed text-muted-foreground">{item.text}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="py-14 sm:py-20" aria-labelledby="judul-masalah">
        <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
          <h2 id="judul-masalah" className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            Masalah agen kurir konvensional
          </h2>
          <p className="mt-2 max-w-2xl text-base leading-relaxed text-muted-foreground">
            Franchise kurir biasa umumnya mahal dan penuh syarat yang membebani pemilik toko.
          </p>
          <ul className="mt-8 grid gap-x-10 gap-y-8 md:grid-cols-3">
            {PROBLEMS.map(([heading, text]) => (
              <li key={heading} className="border-l-4 border-foreground pl-5">
                <h3 className="text-lg font-semibold text-foreground">{heading}</h3>
                <p className="mt-1.5 text-base leading-relaxed text-muted-foreground">{text}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="border-y border-border bg-background py-14 sm:py-20" aria-labelledby="judul-banding">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
          <div className="mx-auto mb-10 max-w-2xl text-center">
            <h2 id="judul-banding" className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
              {BRAND} dibanding agen biasa
            </h2>
            <p className="mt-2 text-base leading-relaxed text-muted-foreground">
              Bandingkan membuka loket {BRAND} dengan franchise kurir konvensional.
            </p>
          </div>

          <ul className="divide-y divide-border rounded-2xl border border-border bg-card md:hidden">
            {COMPARISON_ROWS.map(([need, franchise, manual, ours]) => (
              <li key={need} className="p-4">
                <p className="text-sm font-semibold text-muted-foreground">{need}</p>
                <p className="mt-1 rounded-md bg-background px-2.5 py-1.5 text-base font-semibold text-primary">
                  {BRAND}: {ours}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Franchise: {franchise}. Tab manual: {manual}.
                </p>
              </li>
            ))}
          </ul>

          <div className="hidden overflow-x-auto rounded-2xl border border-border bg-card md:block">
            <table className="w-full border-collapse text-left text-sm sm:text-base">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th scope="col" className="p-4 font-semibold">
                    Kebutuhan loket
                  </th>
                  <th scope="col" className="bg-background p-4 font-semibold text-primary">
                    {BRAND}
                  </th>
                  <th scope="col" className="p-4 font-semibold">
                    Franchise konvensional
                  </th>
                  <th scope="col" className="p-4 font-semibold">
                    Buka tab web manual
                  </th>
                </tr>
              </thead>
              <tbody>
                {COMPARISON_ROWS.map(([need, franchise, manual, ours]) => (
                  <tr key={need} className="border-b border-border last:border-0">
                    <th scope="row" className="p-4 font-semibold text-foreground">
                      {need}
                    </th>
                    <td className="bg-background/70 p-4 font-semibold text-foreground">{ours}</td>
                    <td className="p-4 text-muted-foreground">{franchise}</td>
                    <td className="p-4 text-muted-foreground">{manual}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="py-14 sm:py-20" aria-labelledby="judul-keunggulan">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 sm:px-6 lg:grid-cols-[1fr_2fr] lg:px-8">
          <div>
            <h2 id="judul-keunggulan" className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
              Keunggulan loket {BRAND} di toko Anda
            </h2>
            <p className="mt-3 text-base leading-relaxed text-muted-foreground">
              Kemudahan operasional dan keuntungan dalam satu sistem kasir loket.
            </p>
            <div className="mt-4">
              <Link
                href="/fitur"
                className="inline-flex min-h-11 min-w-11 items-center font-semibold text-primary underline-offset-4 hover:underline"
              >
                Lihat semua fitur →
              </Link>
            </div>
          </div>
          <ul className="grid gap-x-10 gap-y-9 sm:grid-cols-2">
            {ADVANTAGES.map(([heading, text]) => (
              <li key={heading} className="border-t-2 border-primary pt-4">
                <h3 className="text-lg font-semibold text-foreground">{heading}</h3>
                <p className="mt-1.5 text-base leading-relaxed text-muted-foreground">{text}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section id="simulasi" className="border-y border-border bg-background py-14 sm:py-20" aria-labelledby="judul-simulasi">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
          <div className="mx-auto mb-10 max-w-2xl text-center">
            <h2 id="judul-simulasi" className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
              Hitung tambahan keuntungan toko Anda
            </h2>
            <p className="mt-2 text-base leading-relaxed text-muted-foreground">
              Geser target kiriman dan rata-rata ongkir untuk melihat simulasi margin dari komisi 20%–25%.
            </p>
          </div>
          <ProfitSimulator id="beranda" />
        </div>
      </section>

      <section id="alur" className="py-14 sm:py-20" aria-labelledby="judul-alur">
        <div className="mx-auto grid max-w-6xl items-start gap-x-12 gap-y-10 px-4 sm:px-6 lg:grid-cols-[1fr_26rem] lg:px-8">
          <div>
            <h2 id="judul-alur" className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
              Satu kiriman, dari meja kasir sampai resi
            </h2>
            <p className="mt-3 max-w-xl text-base leading-relaxed text-muted-foreground">
              Melayani kiriman semudah mengisi satu formulir. Ikuti satu contoh paket ke Bandung.
            </p>
            <ol className="mt-8 space-y-6">
              {COUNTER_STEPS.map(([heading, text, example], index) => (
                <li key={heading} className="grid grid-cols-[2rem_1fr] gap-x-4">
                  <span
                    className="flex size-8 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground"
                    aria-hidden="true"
                  >
                    {index + 1}
                  </span>
                  <div>
                    <h3 className="text-lg font-semibold text-foreground">{heading}</h3>
                    <p className="mt-1 text-base leading-relaxed text-muted-foreground">{text}</p>
                    <p className="mt-2 text-sm font-semibold text-foreground">{example}</p>
                    {index === 1 && (
                      <div className="mt-4 lg:hidden">
                        <TariffExample />
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ol>
            <div className="mt-8">
              <Link
                href="/cara-kerja"
                className="inline-flex min-h-11 min-w-11 items-center font-semibold text-primary underline-offset-4 hover:underline"
              >
                Lihat alur kasir selengkapnya →
              </Link>
            </div>
          </div>

          <div className="hidden lg:sticky lg:top-24 lg:block">
            <TariffExample />
          </div>
        </div>
      </section>

      <section className="border-t border-border bg-background py-14 sm:py-20" aria-labelledby="judul-bukti">
        <div className="mx-auto grid max-w-6xl items-start gap-x-12 gap-y-10 px-4 sm:px-6 lg:grid-cols-[1fr_22rem] lg:px-8">
          <div className="lg:col-start-1 lg:row-start-1">
            <h2 id="judul-bukti" className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
              Resi thermal yang jelas, nilai COD yang presisi
            </h2>
            <p className="mt-3 max-w-2xl text-base leading-relaxed text-muted-foreground">
              Mengantar memotong fee COD 3% ditambah PPN (3,33%) dari nilai yang ditagih ke penerima. {BRAND}{" "}
              menghitung nilai COD terkecil, dibulatkan ke rupiah penuh, yang setelah dipotong biaya itu tetap menutup
              harga barang dan ongkir. Kasir tidak perlu menghitung manual.
            </p>
            <table className="mt-8 w-full max-w-xl border-collapse text-base tabular-nums">
              <caption className="pb-3 text-left text-sm text-muted-foreground">
                Contoh satu kiriman COD (data rekaan)
              </caption>
              <tbody className="divide-y divide-border border-y border-border">
                <tr>
                  <th scope="row" className="py-3 text-left font-normal text-foreground">
                    Harga barang
                  </th>
                  <td className="py-3 text-right font-semibold text-foreground" data-cod="goods">
                    {formatIdr(cod.goodsIdr)}
                  </td>
                </tr>
                <tr>
                  <th scope="row" className="py-3 text-left font-normal text-foreground">
                    Ongkir Mengantar
                  </th>
                  <td className="py-3 text-right font-semibold text-foreground" data-cod="shipping">
                    {formatIdr(cod.shippingIdr)}
                  </td>
                </tr>
                <tr className="outline outline-2 -outline-offset-2 outline-foreground">
                  <th scope="row" className="px-2 py-3 text-left font-semibold text-foreground">
                    Nilai COD ditagih ke penerima
                    <span className="block text-sm font-normal text-muted-foreground">
                      angka yang sama tercetak di label
                    </span>
                  </th>
                  <td className="px-2 py-3 text-right font-semibold text-foreground" data-cod="cod">
                    {formatIdr(cod.codIdr)}
                  </td>
                </tr>
                <tr>
                  <th scope="row" className="py-3 text-left font-normal text-foreground">
                    Biaya COD Mengantar (3,33%)
                  </th>
                  <td className="py-3 text-right font-semibold text-foreground" data-cod="fee">
                    − {formatIdr(cod.mengantarFeeIdr)}
                  </td>
                </tr>
                <tr>
                  <th scope="row" className="py-3 text-left font-normal text-foreground">
                    Ongkir dibayar dari dana COD
                  </th>
                  <td className="py-3 text-right font-semibold text-foreground">
                    − {formatIdr(cod.shippingIdr)}
                  </td>
                </tr>
                <tr className="bg-card">
                  <th scope="row" className="px-2 py-3 text-left font-semibold text-foreground">
                    Estimasi dana dicairkan Mengantar
                  </th>
                  <td className="px-2 py-3 text-right font-semibold text-primary" data-cod="disbursement">
                    {formatIdr(cod.disbursementIdr)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <ul className="grid max-w-2xl gap-2 text-base text-muted-foreground lg:col-start-1 lg:row-start-2">
            <li>
              <strong className="font-semibold text-foreground">10 × 15 cm bawaan:</strong> label paket ditambah bukti
              serah terima untuk pengirim, atau 10 × 10 cm saja.
            </li>
            <li>
              <strong className="font-semibold text-foreground">Barcode Code 128</strong> diukur untuk printer thermal
              203 dpi.
            </li>
            <li>
              <strong className="font-semibold text-foreground">Jelas apa yang ditagih:</strong> COD, COD Ongkir
              (&ldquo;tagih ongkir saja&rdquo;), atau Non-COD (&ldquo;jangan tagih penerima&rdquo;).
            </li>
            <li>
              <strong className="font-semibold text-foreground">Bukti pengirim</strong> tidak memuat nama, alamat, atau
              nomor telepon penerima.
            </li>
          </ul>

          <figure className="row-start-2 grid justify-items-center gap-3 lg:col-start-2 lg:row-span-2 lg:row-start-1">
            <div
              className="w-full max-w-[22rem] rounded-sm border border-border bg-card p-3 text-xs leading-snug text-foreground tabular-nums"
              aria-hidden="true"
            >
              <div className="flex items-baseline justify-between gap-2 pb-1.5">
                <span className="text-base font-semibold">{label.courier}</span>
                <span className="text-xs font-semibold uppercase tracking-wider">{label.senderName}</span>
              </div>
              <div className="border-t border-foreground py-2">
                <svg
                  className="block h-12 w-full"
                  viewBox={`0 0 ${bars.modules} 1`}
                  preserveAspectRatio="none"
                  shapeRendering="crispEdges"
                >
                  {bars.bars.map(([x, width]) => (
                    <rect key={x} x={x} y="0" width={width} height="1" fill="#000" />
                  ))}
                </svg>
                <p className="mt-1 text-center font-mono text-sm font-semibold tracking-wider">{label.awb}</p>
              </div>
              <div className="border-t border-foreground py-2">
                <p>
                  <span className="font-semibold uppercase">Penerima</span>{" "}
                  <span className="font-semibold">{label.recipientName}</span> {label.recipientPhone}
                </p>
                <p>{label.recipientArea}</p>
                <p>{label.recipientAddress}</p>
              </div>
              <div className="border-t border-foreground py-2">
                <p className="flex items-baseline justify-between gap-2 border-2 border-foreground px-2 py-1 font-semibold">
                  <span>COD — tagih ke penerima</span>
                  <span>{formatIdr(cod.codIdr)}</span>
                </p>
                <div className="mt-1.5 grid gap-0.5">
                  <div className="flex justify-between">
                    <span>Nilai barang</span>
                    <span>{formatIdr(cod.goodsIdr)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Ongkir</span>
                    <span>{formatIdr(cod.labelOngkirIdr)}</span>
                  </div>
                </div>
              </div>
              <div className="border-t border-foreground py-1.5">
                <p>
                  <strong className="font-semibold">Isi</strong> {label.content} · {label.weight} · 1 koli ·{" "}
                  {label.publicReference}
                </p>
              </div>
              <p className="my-2 border-t border-dashed border-foreground pt-1 text-center text-xs font-semibold">
                ✂ potong di sini · Bukti serah terima pengirim
              </p>
              <div>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-semibold">{label.courier}</span>
                  <span>
                    COD <strong className="font-semibold">{formatIdr(cod.codIdr)}</strong>
                  </span>
                </div>
                <p className="mt-1 text-center font-mono text-xs font-semibold">{label.awb}</p>
              </div>
            </div>
            <figcaption className="max-w-[22rem] text-center text-sm text-muted-foreground">
              Contoh label 10 × 15 cm dengan data rekaan. Nama pengirim di label memakai nama gerai Anda.
            </figcaption>
          </figure>
        </div>
      </section>

      <MarketingClosingCta heading="Buka loket ekspedisi di toko Anda sekarang" />
    </MarketingShell>
  );
}

// PR-32 & T-029: route from current verified identity, own onboarding and memberships to the next
// permitted action; render the public GeraiExpress marketing landing page for unauthenticated visitors.
export default async function Home() {
  const current = await loadWorkspace();
  if (current.kind === "anonymous") {
    return <MarketingHomePage />;
  }
  if (current.kind === "no-access" && current.isAnonymous) redirect("/masuk");

  const supabase = await supabaseServer();
  const { data } = await supabase.rpc("my_account_state");
  const account = (data as { has_password: boolean; application_status: string | null }[] | null)?.[0];
  // An identity verified by email code sets its own password before anything else (DEC-007).
  if (account && !account.has_password) redirect("/daftar/kata-sandi");

  if (current.kind === "ready") redirect("/pengiriman");
  if (current.kind === "choose") redirect("/pilih-gerai");
  if (await loadPlatform()) redirect("/admin");
  const { data: invites } = await supabase.rpc("my_invitations");
  if ((invites ?? []).length > 0) redirect("/undangan");
  if (account?.application_status) redirect("/daftar/gerai");
  redirect("/akses");
}
