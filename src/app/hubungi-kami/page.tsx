import { MessageCircle } from "lucide-react";
import type { Metadata } from "next";
import { Button } from "@/components/ui/button";
import {
  CtaLinks,
  HEADLINE,
  LEAD,
  MarketingPageHero,
  MarketingSection,
  MarketingShell,
} from "@/components/marketing/marketing-shell";
import { BRAND, WHATSAPP_DISPLAY, WHATSAPP_URL } from "@/lib/marketing-data";
import { cn } from "@/lib/utils";

const TITLE = "Hubungi Tim Onboarding Loket Multi-Kurir";
const DESCRIPTION =
  "Hubungi tim GeraiExpress lewat WhatsApp untuk pertanyaan pendaftaran gerai, persetujuan, dan koneksi akun Mengantar.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  robots: { index: true, follow: true },
  alternates: { canonical: "/hubungi-kami" },
  openGraph: {
    title: `${TITLE} · GeraiExpress`,
    description: DESCRIPTION,
    url: "https://geraiexpress.com/hubungi-kami",
    siteName: "GeraiExpress",
    locale: "id_ID",
    type: "website",
  },
};

const SIGN_UP_STEPS = [
  "Daftar dengan email gerai, verifikasi kode 6 digit, lalu atur kata sandi.",
  "Ajukan profil gerai Anda.",
  `Tunggu persetujuan admin ${BRAND}. Pendaftaran dibuka bertahap; hubungi admin bila Anda belum bisa mendaftar.`,
  "Setelah disetujui, hubungkan akun Mengantar gerai Anda di Pengaturan untuk membuat kiriman.",
] as const;

// The page's single contact action (owner rule: one WhatsApp CTA per page, secondary style,
// monochrome icon) sits in the contact section; the hero carries no CTA.
export default function HubungiKamiPage() {
  return (
    <MarketingShell currentPath="/hubungi-kami">
      <MarketingPageHero
        title="Aktifkan loket di toko Anda"
        lead={`Tim onboarding ${BRAND} menjawab pertanyaan seputar pendaftaran, persetujuan gerai, dan koneksi akun Mengantar.`}
        cta="none"
      />

      <MarketingSection tone="parchment" label="Cara menghubungi kami">
        <div className="grid gap-14 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] md:gap-12 lg:gap-20">
          <div>
            <h2 className={cn(HEADLINE, "max-w-[14ch]")}>WhatsApp onboarding</h2>
            <p className={cn(LEAD, "mt-5 max-w-[32rem]")}>
              Tanya langsung ke admin {BRAND} soal pendaftaran, persetujuan gerai, atau koneksi Mengantar.
            </p>
            <p className="tabular mt-8 text-[clamp(1.75rem,1.4rem+1.4vw,2.5rem)] font-semibold tracking-tight">
              {WHATSAPP_DISPLAY}
            </p>
            <Button asChild variant="outline" size="lg" className="mt-6 font-semibold hover:bg-info-soft">
              <a href={WHATSAPP_URL} target="_blank" rel="noopener noreferrer">
                <MessageCircle className="size-5" aria-hidden="true" />
                Chat lewat WhatsApp
              </a>
            </Button>
          </div>

          <div className="md:self-center md:border-l md:border-border md:py-6 md:pl-12 lg:pl-20">
            <h2 className="text-xl font-semibold leading-snug">Ingin mencoba dulu?</h2>
            <p className="mt-2 text-base leading-relaxed text-muted-foreground">
              Masuk lewat tombol demo untuk mencoba alur kasir dengan gerai contoh. Harga dan resi di demo adalah
              simulasi.
            </p>
          </div>
        </div>
      </MarketingSection>

      <MarketingSection tone="white" labelledBy="judul-daftar">
        <div className="max-w-[46rem]">
          <h2 id="judul-daftar" className={HEADLINE}>
            Mendaftar sendiri
          </h2>
          <ol className="mt-10">
            {SIGN_UP_STEPS.map((step, index) => (
              <li
                key={step}
                className="grid grid-cols-[2.75rem_minmax(0,1fr)] items-baseline gap-x-4 border-t border-border py-6 text-[19px] leading-[1.45] sm:text-xl md:grid-cols-[4rem_minmax(0,1fr)]"
              >
                <span className="tabular text-3xl font-semibold leading-none text-primary" aria-hidden="true">
                  {index + 1}
                </span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
          <CtaLinks lead="daftar" className="mt-10" />
        </div>
      </MarketingSection>
    </MarketingShell>
  );
}
