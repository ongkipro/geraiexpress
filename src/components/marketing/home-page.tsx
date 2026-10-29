import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { ContactsPreview } from "@/components/marketing/contacts-preview";
import { CounterPreview } from "@/components/marketing/counter-preview";
import {
  CONTAINER,
  CtaLinks,
  DISPLAY_HOME,
  HEADLINE,
  LEAD,
  MarketingClosingCta,
  MarketingSection,
  MarketingShell,
} from "@/components/marketing/marketing-shell";
import { COUNTER_STEPS } from "@/components/marketing/counter-steps";
import { TariffExample } from "@/components/marketing/tariff-example";
import { ORDERABLE_COURIERS } from "@/lib/marketing-data";
import { cn } from "@/lib/utils";

// Public home (C10, design/DIRECTION.md "Page anatomy"): one idea per full-width section, sections
// alternating parchment and white, and only approved, implemented claims (PR-35, T-036).

const SUMMARY_POINTS = [
  ["Konfirmasi dulu, baru dikirim.", "Pesanan diteruskan ke kurir hanya setelah kasir menekan konfirmasi."],
  ["Tarif nyata untuk gerai terhubung.", "Gerai yang akun Mengantar-nya terhubung melihat tarif dari Mengantar."],
  ["Harga contoh di demo.", "Demo memakai harga contoh yang ditandai simulasi, bukan tarif kurir."],
  ["COD bila kurir mendukung.", "Opsi COD hanya tampil untuk kurir yang mendukungnya pada rute tersebut."],
] as const;

const CONTROL_POINTS = [
  ["Kontak tersimpan.", "Pengirim dan penerima langganan tersimpan, siap dipilih lagi di kiriman berikutnya."],
  [
    "Riwayat kiriman.",
    "Setiap kiriman tercatat bersama nomor resinya. Cari lewat referensi, nama, atau resi.",
  ],
  [
    "Peran pemilik dan operator.",
    "Undang staf sebagai admin gerai atau operator. Setiap gerai hanya melihat datanya sendiri.",
  ],
] as const;

const MORE_LINK =
  "inline-flex min-h-11 items-center gap-1 text-[17px] text-primary underline-offset-4 hover:underline";

export function MarketingHomePage() {
  const courierCount = ORDERABLE_COURIERS.length;

  return (
    <MarketingShell currentPath="/">
      <section className="bg-background pb-20 pt-4 sm:pb-28 sm:pt-14 lg:pb-32 lg:pt-24" aria-labelledby="judul">
        <div
          className={cn(
            CONTAINER,
            "grid items-center gap-6 sm:gap-10 md:grid-cols-2 md:gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,32rem)] lg:gap-14",
          )}
        >
          <div>
            <h1 id="judul" className={cn(DISPLAY_HOME, "lg:max-w-[14ch]")}>
              Buka loket pengiriman <span className="whitespace-nowrap">multi-kurir</span> di toko Anda.
            </h1>
            <p className={cn(LEAD, "mt-4 max-w-[34rem] sm:mt-6")}>
              Bandingkan tarif {courierCount} kurir dan buat kiriman drop-off dari satu layar di meja kasir.
            </p>
            <CtaLinks className="mt-5 sm:mt-9" />
            <p className="mt-4 max-w-[30rem] text-sm text-muted-foreground">
              Demo memakai gerai contoh: harga dan resi simulasi, tanpa akun Mengantar.
            </p>
          </div>
          <TariffExample />
        </div>
      </section>

      <MarketingSection tone="white" id="alur" labelledBy="judul-alur">
        <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between md:gap-10">
          <h2 id="judul-alur" className={cn(HEADLINE, "max-w-[17ch]")}>
            Satu kiriman, dari meja kasir sampai serah terima.
          </h2>
          <Link href="/cara-kerja" className={cn(MORE_LINK, "shrink-0")}>
            Lihat alur kasir lengkap
            <ChevronRight className="size-4" aria-hidden="true" />
          </Link>
        </div>
        <ol className="mt-12 grid sm:mt-16 lg:grid-cols-4 lg:gap-10">
          {COUNTER_STEPS.map((step, index) => (
            <li
              key={step.title}
              className="grid grid-cols-[2.75rem_minmax(0,1fr)] gap-x-4 border-t border-border py-8 md:grid-cols-[4rem_minmax(0,1fr)] lg:block lg:pb-0"
            >
              <span className="tabular text-3xl font-semibold leading-none text-primary lg:text-[2.75rem]" aria-hidden="true">
                {index + 1}
              </span>
              <div className="lg:mt-8">
                <h3 className="text-xl font-semibold leading-snug text-balance">{step.title}</h3>
                <p className="mt-2 max-w-[36rem] text-base leading-relaxed text-muted-foreground">{step.text}</p>
              </div>
            </li>
          ))}
        </ol>
      </MarketingSection>

      <MarketingSection tone="parchment" labelledBy="judul-ringkasan">
        <div className="grid items-center gap-12 md:grid-cols-2 md:gap-10 lg:grid-cols-[minmax(0,29rem)_minmax(0,1fr)] lg:gap-20">
          <div className="order-2 md:order-1">
            <CounterPreview />
          </div>
          <div className="order-1 md:order-2">
            <h2 id="judul-ringkasan" className={cn(HEADLINE, "max-w-[16ch] md:max-w-none lg:max-w-[16ch]")}>
              Ringkasan jelas, lalu konfirmasi.
            </h2>
            <p className={cn(LEAD, "mt-5 max-w-[32rem]")}>
              Penerima, paket, kurir, dan total ongkir tampil di satu ringkasan sebelum pesanan dikirim.
            </p>
            <ul className="mt-8 flex max-w-[32rem] flex-col gap-4">
              {SUMMARY_POINTS.map(([lead, rest]) => (
                <li key={lead} className="text-base leading-relaxed text-muted-foreground">
                  <strong className="font-semibold text-foreground">{lead}</strong> {rest}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </MarketingSection>

      <MarketingSection tone="white" labelledBy="judul-kurir">
        <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)] lg:gap-20">
          <div>
            <h2 id="judul-kurir">
              <span
                data-stat="kurir"
                className="tabular block text-[clamp(5.5rem,3rem+8vw,8.5rem)] font-semibold leading-[0.9] tracking-[-0.04em]"
              >
                {courierCount}
              </span>{" "}
              <span className={cn(HEADLINE, "mt-4 block max-w-[14ch]")}>kurir dapat dipesan dari satu layar.</span>
            </h2>
            <p className="mt-5 max-w-[30rem] text-base leading-relaxed text-muted-foreground">
              Pesanan diteruskan lewat Mengantar. Ketersediaan tiap kurir mengikuti rute dan hasil cek tarif.
            </p>
          </div>
          <ul className="grid grid-cols-2 content-start gap-x-6 sm:grid-cols-4 lg:grid-cols-2 lg:gap-x-10" data-testid="courier-list">
            {ORDERABLE_COURIERS.map((courier) => (
              <li
                key={courier.code}
                className="border-t border-border py-5 text-xl font-semibold leading-snug lg:text-[1.375rem]"
              >
                {courier.name}
              </li>
            ))}
          </ul>
        </div>
      </MarketingSection>

      <MarketingSection tone="parchment" labelledBy="judul-kendali">
        <h2 id="judul-kendali" className={cn(HEADLINE, "max-w-[22ch]")}>
          Data kiriman tetap rapi di gerai Anda.
        </h2>
        <div className="mt-10 grid items-start gap-12 sm:mt-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,29rem)] lg:gap-20">
          <div>
            <ul className="flex max-w-[40rem] flex-col gap-7">
              {CONTROL_POINTS.map(([lead, rest]) => (
                <li key={lead} className="text-[19px] leading-[1.45] text-muted-foreground sm:text-xl sm:leading-[1.42]">
                  <strong className="font-semibold text-foreground">{lead}</strong> {rest}
                </li>
              ))}
            </ul>
            <Link href="/fitur" className={cn(MORE_LINK, "mt-8")}>
              Lihat semua fitur
              <ChevronRight className="size-4" aria-hidden="true" />
            </Link>
          </div>
          <ContactsPreview />
        </div>
      </MarketingSection>

      <MarketingClosingCta />
    </MarketingShell>
  );
}
