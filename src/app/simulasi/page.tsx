import { ChevronDown } from "lucide-react";
import type { Metadata } from "next";
import {
  HEADLINE,
  MarketingClosingCta,
  MarketingPageHero,
  MarketingSection,
  MarketingShell,
} from "@/components/marketing/marketing-shell";
import { BRAND, WHATSAPP_DISPLAY } from "@/lib/marketing-data";
import { cn } from "@/lib/utils";

// T-036 (PR-35): the former commission simulator published unapproved percentages and earnings.
// This route stays (nav, sitemap, inbound links) as a neutral model explanation with no figures.
const TITLE = "Model Layanan Loket GeraiExpress";
const DESCRIPTION =
  "Cara kerja model layanan loket GeraiExpress: tarif kurir dari Mengantar, kiriman drop-off, dan ketentuan komersial yang tidak dipublikasikan di situs ini.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  robots: { index: true, follow: true },
  alternates: { canonical: "/simulasi" },
  openGraph: {
    title: `${TITLE} · GeraiExpress`,
    description: DESCRIPTION,
    url: "https://geraiexpress.com/simulasi",
    siteName: "GeraiExpress",
    locale: "id_ID",
    type: "website",
  },
};

const MODEL_POINTS = [
  [
    "Tarif kurir tampil sebelum konfirmasi",
    "Cek tarif menampilkan tarif tiap kurir untuk rute dan berat paket. Pesanan baru dikirim setelah kasir mengonfirmasi.",
  ],
  [
    "Kiriman lewat Mengantar",
    `Pesanan ${BRAND} diteruskan ke kurir lewat Mengantar. Gerai sungguhan menghubungkan akun Mengantar di Pengaturan.`,
  ],
  [
    "Ketentuan komersial tidak dipublikasikan di sini",
    "Situs ini tidak mencantumkan angka komisi, diskon, biaya, atau ketentuan lain, dan tidak menjanjikan penghasilan tertentu.",
  ],
] as const;

// Who does what at a real gerai, from implemented scope only (drop-off, Mengantar connection, admin approval).
const ROLES = [
  [
    "Gerai",
    "Melayani pelanggan di meja kasir: mengisi data, menimbang paket, memilih kurir bersama pelanggan, lalu menyerahkan paket ke kurir (drop-off).",
  ],
  [
    BRAND,
    `Aplikasi kasirnya: cek tarif, kontak tersimpan, riwayat kiriman, dan peran tim. Admin ${BRAND} menyetujui pendaftaran gerai.`,
  ],
  [
    "Mengantar",
    "Meneruskan pesanan ke kurir pilihan. Tarif nyata datang dari akun Mengantar yang dihubungkan gerai di Pengaturan.",
  ],
] as const;

const FAQ_ITEMS = [
  [
    "Apa yang bisa saya coba sekarang?",
    "Demo simulasi: gerai contoh dengan harga dan resi simulasi, tanpa mendaftar dan tanpa akun Mengantar. Tidak ada pesanan yang dikirim ke kurir.",
  ],
  [
    "Berapa komisi atau keuntungan per paket?",
    `Situs ini tidak menjanjikan komisi atau keuntungan tertentu. Untuk pertanyaan soal ketentuan komersial, hubungi admin ${BRAND} lewat WhatsApp ${WHATSAPP_DISPLAY}.`,
  ],
  [
    "Apakah paket dijemput kurir?",
    "Versi ini melayani kiriman drop-off: paket diserahkan oleh gerai ke kurir.",
  ],
  [
    "Apakah gerai langsung aktif setelah daftar?",
    `Daftar dengan email gerai, lalu verifikasi kode dan ajukan profil gerai. Gerai mulai mengirim setelah pendaftaran disetujui admin ${BRAND} dan akun Mengantar gerai terhubung di Pengaturan.`,
  ],
] as const;

export default function SimulasiPage() {
  return (
    <MarketingShell currentPath="/simulasi">
      <MarketingPageHero
        title="Model layanan loket GeraiExpress"
        lead="Cara loket bekerja: tarif kurir, kiriman lewat Mengantar, dan aktivasi gerai. Cara terbaik memahaminya adalah mencoba demo simulasi."
      />

      <MarketingSection tone="parchment" labelledBy="judul-model">
        <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] lg:gap-20">
          <h2 id="judul-model" className={cn(HEADLINE, "max-w-[20ch]")}>
            Bagaimana model layanannya
          </h2>
          <ul className="flex flex-col gap-7">
            {MODEL_POINTS.map(([heading, text]) => (
              <li key={heading} className="text-[19px] leading-[1.45] text-muted-foreground sm:text-xl sm:leading-[1.42]">
                <strong className="font-semibold text-foreground">{heading}.</strong> {text}
              </li>
            ))}
          </ul>
        </div>
      </MarketingSection>

      <MarketingSection tone="white" labelledBy="judul-peran">
        <h2 id="judul-peran" className={cn(HEADLINE, "max-w-[20ch]")}>
          Siapa mengerjakan apa
        </h2>
        <dl className="mt-12 sm:mt-16">
          {ROLES.map(([role, text]) => (
            <div
              key={role}
              className="grid gap-2 border-t border-border py-7 md:grid-cols-[minmax(0,14rem)_minmax(0,1fr)] md:gap-10"
            >
              <dt className="text-[1.5rem] font-semibold leading-snug">{role}</dt>
              <dd className="max-w-[40rem] text-[19px] leading-[1.45] text-muted-foreground sm:text-xl">{text}</dd>
            </div>
          ))}
        </dl>
      </MarketingSection>

      <MarketingSection tone="parchment" id="faq" labelledBy="judul-faq">
        <div className="mx-auto max-w-[46rem]">
          <h2 id="judul-faq" className={HEADLINE}>
            Pertanyaan umum
          </h2>
          <div className="mt-10 divide-y divide-border border-y border-border">
            {FAQ_ITEMS.map(([question, answer], index) => (
              <details key={question} className="group" open={index === 0}>
                <summary className="flex min-h-16 cursor-pointer list-none items-center justify-between gap-4 py-3 text-left text-[19px] font-semibold leading-snug [&::-webkit-details-marker]:hidden">
                  <span>{question}</span>
                  <ChevronDown
                    aria-hidden="true"
                    className="size-5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180 motion-reduce:transition-none"
                  />
                </summary>
                <p className="pb-6 pr-9 text-base leading-relaxed text-muted-foreground">{answer}</p>
              </details>
            ))}
          </div>
        </div>
      </MarketingSection>

      <MarketingClosingCta />
    </MarketingShell>
  );
}
