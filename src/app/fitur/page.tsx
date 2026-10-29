import type { Metadata } from "next";
import { CounterPreview } from "@/components/marketing/counter-preview";
import {
  HEADLINE,
  LEAD,
  MarketingClosingCta,
  MarketingPageHero,
  MarketingSection,
  MarketingShell,
} from "@/components/marketing/marketing-shell";
import { TariffExample } from "@/components/marketing/tariff-example";
import { BRAND, ORDERABLE_COURIERS } from "@/lib/marketing-data";
import { cn } from "@/lib/utils";

const COURIER_LIST = ORDERABLE_COURIERS.map((courier) => courier.name).join(", ");

const TITLE = "Fitur Kasir Loket Pengiriman Multi-Kurir";
const DESCRIPTION =
  "Fitur loket GeraiExpress yang tersedia sekarang: cek tarif banyak kurir, kiriman drop-off, kontak pelanggan tersimpan, peran admin dan operator, serta demo simulasi.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  robots: { index: true, follow: true },
  alternates: { canonical: "/fitur" },
  openGraph: {
    title: `${TITLE} · GeraiExpress`,
    description: DESCRIPTION,
    url: "https://geraiexpress.com/fitur",
    siteName: "GeraiExpress",
    locale: "id_ID",
    type: "website",
  },
};

const FEATURE_GROUPS = [
  {
    id: "kurir",
    heading: "Banyak kurir di satu layar",
    lead: "Pelanggan bisa memilih kurir dari hasil cek tarif, dan kasir tidak perlu membuka banyak situs.",
    items: [
      [
        "Cek tarif banyak kurir sekaligus",
        `Bandingkan tarif ${COURIER_LIST} dalam satu layar, sebelum memilih. Kurir yang tidak melayani rute tertentu tidak ditampilkan.`,
      ],
      [
        "Kiriman COD dan non-COD",
        "Pilih jenis kiriman saat membuat pesanan. Opsi COD hanya tampil untuk kurir yang mendukungnya pada rute tersebut.",
      ],
      [
        "Tarif nyata untuk gerai terhubung",
        "Gerai yang akun Mengantar-nya terhubung melihat tarif nyata dari Mengantar. Mode demo memakai harga contoh.",
      ],
    ],
  },
  {
    id: "kasir",
    heading: "Proses kasir yang jelas",
    lead: "Selesai di depan pelanggan: isi data, cek tarif, konfirmasi, lalu serahkan paket.",
    items: [
      [
        "Kontak pelanggan tersimpan",
        "Pengirim dan penerima langganan tersimpan, jadi kasir tidak perlu mengetik ulang dari awal.",
      ],
      [
        "Konfirmasi sebelum pesanan dikirim",
        "Pesanan hanya dikirim ke Mengantar setelah kasir mengonfirmasi ringkasan kiriman.",
      ],
      [
        "Kiriman drop-off",
        "Versi ini melayani drop-off: paket diserahkan oleh gerai ke kurir. Resi tercatat di halaman kiriman.",
      ],
      [
        "Demo simulasi",
        "Coba alur lengkap dengan gerai contoh. Harga dan resi di demo adalah simulasi dan tidak dikirim ke kurir.",
      ],
    ],
  },
  {
    id: "tim",
    heading: "Tim dan data gerai terpisah",
    lead: "Pemilik mengatur siapa yang bisa bekerja di gerai, dan setiap gerai hanya melihat datanya sendiri.",
    items: [
      [
        "Peran admin gerai dan operator",
        "Undang staf lewat tautan dan atur perannya. Tindakan tertentu, seperti membayar kiriman yang tertunda, hanya untuk admin gerai.",
      ],
      [
        "Data antar gerai terpisah",
        "Kontak dan kiriman satu gerai tidak terlihat oleh gerai lain.",
      ],
      [
        "Status kesiapan di Pengaturan",
        "Halaman Pengaturan menunjukkan kemampuan mana yang sudah aktif untuk gerai Anda dan mana yang belum.",
      ],
    ],
  },
] as const;

// Three groups, three compositions (C10.5): heading beside the list, heading above a two-column list,
// and a single reading column; all open typography separated by hairlines, no cards.
export default function FiturPage() {
  const [kurir, kasir, tim] = FEATURE_GROUPS;
  return (
    <MarketingShell currentPath="/fitur">
      <MarketingPageHero
        title="Fitur kasir loket multi-kurir"
        lead={`Yang sudah berjalan di ${BRAND} sekarang: cek tarif banyak kurir, kiriman drop-off, kontak pelanggan tersimpan, dan demo simulasi.`}
      />

      <MarketingSection tone="parchment" labelledBy={`judul-${kurir.id}`}>
        <h2 id={`judul-${kurir.id}`} className={cn(HEADLINE, "max-w-[18ch]")}>
          {kurir.heading}
        </h2>
        <p className={cn(LEAD, "mt-5 max-w-[36rem]")}>{kurir.lead}</p>
        <div className="mt-12 grid items-start gap-12 sm:mt-16 md:grid-cols-2 md:gap-10 lg:grid-cols-[minmax(0,27rem)_minmax(0,1fr)] lg:gap-16">
          <TariffExample sample="surabaya" />
          <FeatureList items={kurir.items} />
        </div>
      </MarketingSection>

      <MarketingSection tone="white" labelledBy={`judul-${kasir.id}`}>
        <h2 id={`judul-${kasir.id}`} className={cn(HEADLINE, "max-w-[18ch]")}>
          {kasir.heading}
        </h2>
        <p className={cn(LEAD, "mt-5 max-w-[36rem]")}>{kasir.lead}</p>
        <div className="mt-12 grid gap-12 sm:mt-16 lg:grid-cols-[minmax(0,1fr)_minmax(0,27rem)] lg:gap-16">
          <FeatureList items={kasir.items} className="md:grid-cols-2 md:gap-x-12 lg:grid-cols-1" />
          <CounterPreview state="issued" className="lg:sticky lg:top-24 lg:self-start" />
        </div>
      </MarketingSection>

      <MarketingSection tone="parchment" labelledBy={`judul-${tim.id}`}>
        <div className="max-w-[44rem]">
          <h2 id={`judul-${tim.id}`} className={cn(HEADLINE, "max-w-[16ch]")}>
            {tim.heading}
          </h2>
          <p className={cn(LEAD, "mt-5")}>{tim.lead}</p>
          <FeatureList items={tim.items} className="mt-10" />
        </div>
      </MarketingSection>

      <MarketingClosingCta />
    </MarketingShell>
  );
}

function FeatureList({ items, className }: { items: readonly (readonly [string, string])[]; className?: string }) {
  return (
    <ul className={cn("grid content-start", className)}>
      {items.map(([heading, text]) => (
        <li key={heading} className="border-t border-border py-6">
          <h3 className="text-xl font-semibold leading-snug">{heading}</h3>
          <p className="mt-2 text-base leading-relaxed text-muted-foreground">{text}</p>
        </li>
      ))}
    </ul>
  );
}
