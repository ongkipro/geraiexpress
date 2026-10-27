import type { Metadata } from "next";
import {
  MarketingClosingCta,
  MarketingPageHero,
  MarketingShell,
} from "@/components/marketing/marketing-shell";
import { ProfitSimulator } from "@/components/marketing/profit-simulator";
import { BRAND, MENGANTAR_DISCOUNT_TIERS, MENGANTAR_URL } from "@/lib/marketing-data";

export const metadata: Metadata = {
  title: "Simulasi Margin dan Komisi Loket Ekspedisi",
  description:
    "Hitung estimasi keuntungan loket ekspedisi di toko Anda dengan simulator komisi GeraiExpress. Komisi 20%-25% per paket, tanpa franchise atau royalti.",
};

const COMPARISON = [
  ["Biaya kemitraan awal", "Gratis", "Ada biaya kemitraan"],
  ["Keuntungan diskon ongkir", "Komisi 20%–25% jadi laba", "Komisi lebih kecil, sering ada target"],
  ["Pilihan ekspedisi", "Banyak kurir resmi di 1 layar", "Cuma 1 kurir"],
  ["Royalti bulanan", "Tidak ada, 100% milik toko", "Dipotong royalti atau lisensi"],
  ["Syarat tempat", "Meja kasir yang sudah ada", "Wajib sewa ruko dan cat khusus"],
  ["Target minimum paket", "Tanpa target, tanpa penalti", "Wajib capai target"],
  ["Penjemputan paket", "Kurir resmi jemput ke toko", "Sebagian wajib antar ke hub"],
] as const;

const FAQ_ITEMS = [
  [
    "Dari mana asal keuntungan toko saya?",
    "Dari diskon ongkir Mengantar. Setiap kiriman otomatis mendapat diskon 20%, dan diskonnya naik sampai 25% sesuai jumlah kiriman per bulan (lihat tabel di atas). Pelanggan membayar tarif normal kurir, dan selisih diskonnya menjadi laba toko tanpa potongan royalti.",
  ],
  [
    `Siapa di balik ${BRAND}?`,
    `${BRAND} dikembangkan bersama tim Mengantar, agregator pengiriman yang menghubungkan gerai Anda ke ekspedisi resmi. Kiriman, resi, dan pencairan COD berjalan lewat akun Mengantar milik gerai Anda.`,
  ],
  [
    "Bagaimana dana COD sampai ke rekening toko?",
    `Mengantar mencairkan dana COD setiap hari, termasuk akhir pekan dan hari libur: kiriman yang terkirim sebelum 19.45 WIB dicairkan pukul 20.00 WIB hari itu, ke akun Mengantar gerai Anda. Di ${BRAND}, pemilik gerai memantau estimasi dana cair di menu Pencairan COD.`,
  ],
  [
    "Bagaimana kalau paket COD retur?",
    "Ongkir pulang paket retur digratiskan Mengantar. Gerai hanya membayar ongkir pergi, yang sudah dipotong diskon.",
  ],
  [
    "Apakah benar tidak ada biaya tersembunyi?",
    `Benar. ${BRAND} tidak memungut biaya pendaftaran, iuran bulanan, maupun lisensi. Tarif kurir dan fee COD (3% ditambah PPN) tampil sebelum resi terbit. Mengantar mengasuransikan paket di bawah Rp 500 ribu secara gratis; di atasnya biayanya Rp 1 ribu per paket.`,
  ],
  [
    "Apakah gerai langsung aktif setelah daftar?",
    `Daftar dengan email dan nomor WhatsApp gerai, lalu verifikasi email. Setelah masuk, lengkapi profil dan hubungkan akun Mengantar gerai di Pengaturan. Gerai mulai mengirim setelah pendaftaran disetujui admin ${BRAND}.`,
  ],
] as const;

export default function SimulasiPage() {
  return (
    <MarketingShell currentPath="/simulasi">
      <MarketingPageHero
        title="Hitung potensi tambahan keuntungan toko Anda"
        lead="Geser target kiriman per hari dan rata-rata ongkir. Estimasi komisi harian, bulanan, dan tahunan langsung dihitung."
        showSignUp={false}
      />

      <section className="border-b border-border bg-background py-10 sm:py-14" aria-label="Simulator komisi">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
          <ProfitSimulator id="simulasi" />
        </div>
      </section>

      <section id="diskon" className="py-14 sm:py-20" aria-labelledby="judul-diskon">
        <div className="mx-auto grid max-w-6xl items-start gap-10 px-4 sm:px-6 lg:grid-cols-2 lg:px-8">
          <div>
            <h2 id="judul-diskon" className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
              Diskon ongkir naik mengikuti volume
            </h2>
            <p className="mt-3 text-base leading-relaxed text-muted-foreground">
              Komisi toko berasal dari diskon ongkir Mengantar. Setiap kiriman otomatis mendapat diskon 20%, dan
              diskonnya naik sampai 25% sesuai jumlah kiriman per bulan. Diskon berlaku untuk kiriman COD maupun
              Non-COD.
            </p>
            <p className="mt-4 text-sm text-muted-foreground">
              Sumber: tingkat diskon 20%–25% dari ketentuan diskon resmi Mengantar (dibaca Oktober 2026). Ketentuan bisa
              berubah mengikuti Mengantar.
            </p>
            <div className="mt-2">
              <a
                href={MENGANTAR_URL}
                rel="noopener noreferrer"
                className="inline-flex min-h-11 min-w-11 items-center text-sm font-semibold text-primary underline-offset-4 hover:underline"
              >
                Lihat ketentuan resmi di mengantar.com →
              </a>
            </div>
          </div>

          <div className="overflow-hidden rounded-2xl border border-border bg-card">
            <table className="w-full border-collapse text-left text-base tabular-nums">
              <caption className="sr-only">
                Diskon ongkir Mengantar per jumlah kiriman sebulan, 20% sampai 25%
              </caption>
              <thead>
                <tr className="border-b border-border bg-background text-sm text-muted-foreground">
                  <th scope="col" className="p-4 font-semibold">
                    Kiriman per bulan
                  </th>
                  <th scope="col" className="p-4 text-right font-semibold">
                    Diskon ongkir
                  </th>
                </tr>
              </thead>
              <tbody>
                {MENGANTAR_DISCOUNT_TIERS.map((tier) => (
                  <tr key={tier.volume} className="border-b border-border last:border-0">
                    <th scope="row" className="p-4 font-normal text-foreground">
                      {tier.volume} paket
                    </th>
                    <td className="p-4 text-right font-semibold text-primary">{tier.discount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="border-y border-border bg-background py-14 sm:py-20" aria-labelledby="judul-banding">
        <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
          <h2 id="judul-banding" className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            {BRAND} dibanding franchise biasa
          </h2>
          <p className="mt-2 text-base leading-relaxed text-muted-foreground">
            Syarat dan keuntungan membuka loket di toko Anda.
          </p>

          <ul className="mt-8 divide-y divide-border rounded-2xl border border-border bg-card md:hidden">
            {COMPARISON.map(([criterion, ours, franchise]) => (
              <li key={criterion} className="p-4">
                <p className="text-sm font-semibold text-muted-foreground">{criterion}</p>
                <p className="mt-1 rounded-md bg-background px-2.5 py-1.5 text-base font-semibold text-primary">
                  {BRAND}: {ours}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">Franchise: {franchise}</p>
              </li>
            ))}
          </ul>

          <div className="mt-8 hidden overflow-x-auto rounded-2xl border border-border bg-card md:block">
            <table className="w-full border-collapse text-left text-sm sm:text-base">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th scope="col" className="p-4 font-semibold">
                    Kriteria
                  </th>
                  <th scope="col" className="bg-background p-4 font-semibold text-primary">
                    Loket {BRAND}
                  </th>
                  <th scope="col" className="p-4 font-semibold">
                    Franchise kurir konvensional
                  </th>
                </tr>
              </thead>
              <tbody>
                {COMPARISON.map(([criterion, ours, franchise]) => (
                  <tr key={criterion} className="border-b border-border last:border-0">
                    <th scope="row" className="p-4 font-semibold text-foreground">
                      {criterion}
                    </th>
                    <td className="bg-background/70 p-4 font-semibold text-foreground">{ours}</td>
                    <td className="p-4 text-muted-foreground">{franchise}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section id="faq" className="py-14 sm:py-20" aria-labelledby="judul-faq">
        <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
          <h2 id="judul-faq" className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            Pertanyaan seputar komisi loket
          </h2>
          <div className="mt-8 divide-y divide-border border-y border-border">
            {FAQ_ITEMS.map(([question, answer], index) => (
              <details key={question} className="group py-2" open={index === 0}>
                <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-4 text-left text-base font-semibold text-foreground [&::-webkit-details-marker]:hidden">
                  <span>{question}</span>
                  <span
                    aria-hidden="true"
                    className="inline-flex size-6 shrink-0 items-center justify-center rounded-full border border-border text-xs text-muted-foreground"
                  >
                    ▾
                  </span>
                </summary>
                <p className="pb-4 pr-8 text-base leading-relaxed text-muted-foreground">{answer}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <MarketingClosingCta heading="Mulai kumpulkan komisi dari toko Anda" />
    </MarketingShell>
  );
}
