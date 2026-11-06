import type { Metadata } from "next";
import {
  HEADLINE,
  LEAD,
  MarketingClosingCta,
  MarketingPageHero,
  MarketingSection,
  MarketingShell,
} from "@/components/marketing/marketing-shell";
import { BRAND } from "@/lib/marketing-data";
import { ContactsPreview } from "@/components/marketing/contacts-preview";
import { CounterPreview } from "@/components/marketing/counter-preview";
import { COUNTER_STEPS } from "@/components/marketing/counter-steps";
import { cn } from "@/lib/utils";
import { connection } from "next/server";

const TITLE = "Alur 4 Langkah Kasir Loket Pengiriman Multi-Kurir";
const DESCRIPTION =
  "Alur kasir loket GeraiExpress: isi data pengirim dan penerima, masukkan berat dan cek tarif, konfirmasi kiriman, lalu serahkan paket ke kurir (drop-off).";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  robots: { index: true, follow: true },
  alternates: { canonical: "/cara-kerja" },
  openGraph: {
    title: `${TITLE} · GeraiExpress`,
    description: DESCRIPTION,
    url: "https://geraiexpress.com/cara-kerja",
    siteName: "GeraiExpress",
    locale: "id_ID",
    type: "website",
  },
};

const DEMO_POINTS = [
  [
    "Masuk sebagai demo",
    "Tombol Coba demo membuka gerai contoh tanpa mendaftar dan tanpa akun Mengantar.",
  ],
  [
    "Harga contoh",
    "Tarif di demo adalah harga contoh yang ditandai simulasi, bukan tarif kurir.",
  ],
  [
    "Resi simulasi",
    "Resi yang terbit di demo ditandai simulasi dan tidak dikirim ke kurir mana pun.",
  ],
] as const;

const EQUIPMENT = [
  [
    "Laptop, komputer, atau HP",
    `Buka ${BRAND} lewat browser di perangkat kasir yang sudah ada.`,
  ],
  [
    "Timbangan",
    "Timbangan yang sudah dipakai toko cukup untuk mengisi berat paket.",
  ],
  [
    "Koneksi internet",
    "WiFi toko atau hotspot HP sudah cukup untuk melayani transaksi.",
  ],
] as const;

// The four steps are a real sequence, so they keep numerals and read as rows (numeral, step, detail)
// instead of the home page's three columns; the demo and equipment sections use open typography.
// SEC-6 / T-055: rendered per request so Next can attach this request's CSP nonce to its scripts.
export default async function CaraKerjaPage() {
  await connection();
  return (
    <MarketingShell currentPath="/cara-kerja">
      <MarketingPageHero
        title="Alur 4 langkah kasir"
        lead="Isi data pengirim dan penerima, masukkan berat dan cek tarif, konfirmasi kiriman, lalu serahkan paket ke kurir."
      />

      <MarketingSection tone="parchment" labelledBy="judul-langkah">
        <h2 id="judul-langkah" className={cn(HEADLINE, "max-w-[24ch]")}>
          Semua di depan pelanggan, dari satu layar.
        </h2>
        {/* Steps 1 and 3 carry the product panel they describe (saved contacts, the summary before
            confirming); hidden below 768 so the sequence stays short on phones. */}
        <ol className="mt-12 sm:mt-16">
          {COUNTER_STEPS.map(({ title: heading, text, example }, index) => {
            const panel = index === 0 ? <ContactsPreview /> : index === 2 ? <CounterPreview /> : null;
            return (
              <li
                key={heading}
                className="grid grid-cols-[2.75rem_minmax(0,1fr)] gap-x-4 border-t border-border py-8 md:grid-cols-[4rem_minmax(0,1fr)] lg:grid-cols-[5rem_minmax(0,1fr)_minmax(0,26rem)] lg:gap-x-12"
              >
                <span className="tabular text-3xl font-semibold leading-none text-primary lg:text-[2.75rem]" aria-hidden="true">
                  {index + 1}
                </span>
                <div>
                  <h3 className="text-xl font-semibold leading-snug lg:text-[1.5rem]">{heading}</h3>
                  <p className="mt-2 max-w-[36rem] text-base leading-relaxed text-muted-foreground">{text}</p>
                  <p className="mt-3 text-[15px] text-muted-foreground">{example}</p>
                </div>
                {panel && (
                  <div className="col-start-2 mt-6 hidden max-w-[26rem] md:block lg:col-start-3 lg:mt-0">{panel}</div>
                )}
              </li>
            );
          })}
        </ol>
      </MarketingSection>

      <MarketingSection tone="white" labelledBy="judul-demo">
        <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] lg:gap-20">
          <div>
            <h2 id="judul-demo" className={cn(HEADLINE, "max-w-[14ch]")}>
              Coba dulu lewat demo simulasi
            </h2>
            <p className={cn(LEAD, "mt-5 max-w-[32rem]")}>
              Demo memakai gerai contoh yang terpisah dari data gerai sungguhan. Tidak ada pesanan yang dikirim ke
              kurir.
            </p>
          </div>
          <ul className="flex flex-col gap-7 lg:pt-3">
            {DEMO_POINTS.map(([heading, text]) => (
              <li key={heading} className="text-[19px] leading-[1.45] text-muted-foreground sm:text-xl sm:leading-[1.42]">
                <strong className="font-semibold text-foreground">{heading}.</strong> {text}
              </li>
            ))}
          </ul>
        </div>
      </MarketingSection>

      <MarketingSection tone="parchment" labelledBy="judul-perangkat">
        <h2 id="judul-perangkat" className={cn(HEADLINE, "max-w-[18ch]")}>
          Pakai perangkat toko yang sudah ada
        </h2>
        <p className={cn(LEAD, "mt-5 max-w-[36rem]")}>Ini yang dibutuhkan di meja kasir.</p>
        <ul className="mt-12 grid gap-x-12 sm:mt-16 md:grid-cols-3">
          {EQUIPMENT.map(([heading, text]) => (
            <li key={heading} className="border-t border-border py-6">
              <h3 className="text-xl font-semibold leading-snug">{heading}</h3>
              <p className="mt-2 text-base leading-relaxed text-muted-foreground">{text}</p>
            </li>
          ))}
        </ul>
      </MarketingSection>

      <MarketingClosingCta heading="Siap melayani kiriman pertama?" />
    </MarketingShell>
  );
}
