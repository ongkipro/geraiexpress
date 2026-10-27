import type { Metadata } from "next";
import Link from "next/link";
import { MarketingPageHero, MarketingShell } from "@/components/marketing/marketing-shell";
import {
  BRAND,
  SIGN_IN_URL,
  SIGN_UP_URL,
  WHATSAPP_DISPLAY,
  WHATSAPP_URL,
} from "@/lib/marketing-data";

export const metadata: Metadata = {
  title: "Hubungi Tim Onboarding dan Bantuan Loket Multi-Kurir",
  description:
    "Hubungi tim GeraiExpress untuk panduan daftar loket kasir multi-kurir gratis, koneksi akun Mengantar, dan cetak resi thermal pertama lewat WhatsApp.",
};

export default function HubungiKamiPage() {
  return (
    <MarketingShell currentPath="/hubungi-kami">
      <MarketingPageHero
        title="Aktifkan loket di toko Anda, gratis"
        lead={`Tim onboarding ${BRAND} memandu pendaftaran, koneksi akun Mengantar gerai, dan cetak resi thermal pertama Anda.`}
        showSignUp={false}
      />

      <section className="border-b border-border bg-background py-14 sm:py-20" aria-label="Cara menghubungi kami">
        <div className="mx-auto grid max-w-6xl gap-x-10 gap-y-10 px-4 sm:px-6 md:grid-cols-[1.4fr_1fr_1fr] lg:px-8">
          <div className="border-t-4 border-primary pt-4">
            <h2 className="text-lg font-semibold text-foreground">WhatsApp onboarding</h2>
            <p className="mt-1.5 text-base leading-relaxed text-muted-foreground">
              Tanya langsung ke admin {BRAND} soal pendaftaran, persetujuan gerai, atau koneksi Mengantar.
            </p>
            <p className="mt-3 text-xl font-semibold tabular-nums text-foreground">{WHATSAPP_DISPLAY}</p>
            <a
              href={WHATSAPP_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 inline-flex min-h-11 min-w-11 items-center gap-2 rounded-full border border-border bg-card px-5 text-base font-semibold text-foreground transition-colors hover:border-primary hover:text-primary"
            >
              <svg
                aria-hidden="true"
                className="size-5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
              </svg>
              Chat lewat WhatsApp
            </a>
          </div>

          <div className="border-t-2 border-primary pt-4">
            <h2 className="text-lg font-semibold text-foreground">Jam dukungan</h2>
            <p className="mt-1.5 text-base leading-relaxed text-muted-foreground">
              Kami membantu koneksi printer thermal dan transaksi pertama sampai lancar.
            </p>
            <dl className="mt-3 space-y-1 text-base text-foreground">
              <div className="flex justify-between gap-4">
                <dt>Senin–Sabtu</dt>
                <dd className="font-semibold tabular-nums">08.00–21.00 WIB</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt>Minggu &amp; libur</dt>
                <dd className="font-semibold tabular-nums">09.00–17.00 WIB</dd>
              </div>
            </dl>
          </div>

          <div className="border-t-2 border-primary pt-4">
            <h2 className="text-lg font-semibold text-foreground">Jangkauan</h2>
            <p className="mt-1.5 text-base leading-relaxed text-muted-foreground">
              Untuk konter pulsa, toko fotokopi, sembako, dan minimarket di Indonesia. Penjemputan mengikuti jangkauan
              pickup kurir lewat Mengantar di area toko Anda.
            </p>
          </div>
        </div>
      </section>

      <section className="py-14 sm:py-16" aria-labelledby="judul-daftar">
        <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
          <h2 id="judul-daftar" className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            Mendaftar sendiri
          </h2>
          <ol className="mt-6 list-decimal space-y-3 pl-5 text-base leading-relaxed text-foreground marker:font-semibold marker:text-primary">
            <li>Daftar dengan email dan nomor WhatsApp gerai, lalu pilih awalan nomor kiriman.</li>
            <li>Verifikasi email dari tautan atau kode yang kami kirim.</li>
            <li>Masuk, lalu hubungkan akun Mengantar gerai Anda di Pengaturan.</li>
            <li>
              <strong className="font-semibold">Tunggu persetujuan admin {BRAND}.</strong> Setelah disetujui, gerai bisa
              membuat kiriman.
            </li>
          </ol>
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
              className="inline-flex min-h-12 min-w-11 items-center justify-center rounded-full border border-border bg-card px-7 text-base font-semibold text-foreground transition-colors hover:bg-secondary"
            >
              Masuk / Coba demo
            </Link>
          </div>
        </div>
      </section>
    </MarketingShell>
  );
}
