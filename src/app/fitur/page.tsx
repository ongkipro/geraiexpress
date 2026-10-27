import type { Metadata } from "next";
import {
  MarketingClosingCta,
  MarketingPageHero,
  MarketingShell,
} from "@/components/marketing/marketing-shell";
import { BRAND } from "@/lib/marketing-data";

export const metadata: Metadata = {
  title: "Fitur Kasir Loket Pengiriman Multi-Kurir",
  description:
    "Fitur loket GeraiExpress: cek ongkir banyak kurir, cetak resi thermal 10 x 15 cm, nota pelanggan, COD presisi, jadwal jemput kurir, dan pantau uang gerai.",
};

const FEATURE_GROUPS = [
  {
    id: "ekspedisi",
    heading: "Banyak ekspedisi resmi di satu layar",
    lead: "Pelanggan bebas memilih kurir termurah atau tercepat. Resi resmi dari kurir dan bisa dilacak di aplikasi masing-masing.",
    items: [
      [
        "Cek ongkir banyak kurir sekaligus",
        "Bandingkan tarif J&T, JNE, SiCepat, Lion Parcel, ID Express, AnterAja, POS, dan SAP dalam satu layar, sebelum memilih.",
      ],
      [
        "COD presisi, cair setiap hari",
        "Nilai COD dihitung otomatis dari harga barang, ongkir, dan fee COD Mengantar (3% ditambah PPN), jadi toko tidak nombok. Mengantar mencairkan dana COD setiap hari, dan ongkir pulang paket retur gratis.",
      ],
      [
        "Layanan kargo untuk paket besar",
        "Kirim paket besar lewat layanan kargo JNE, SAP, SiCepat, dan ID Express yang tampil di cek ongkir.",
      ],
    ],
  },
  {
    id: "kasir",
    heading: "Proses kasir cepat dan bebas denda salah timbang",
    lead: "Selesai di depan pelanggan, dengan ongkir yang sudah memperhitungkan berat dan ukuran paket.",
    items: [
      [
        "Berat dan ukuran dihitung sebelum resi terbit",
        "Masukkan berat serta panjang, lebar, dan tinggi kardus. Ongkir dari kurir sudah memperhitungkannya, sehingga toko tidak menanggung selisih.",
      ],
      [
        "Cetak resi thermal 10 × 15 cm",
        "Label paket ditambah bukti serah terima untuk pengirim, atau 10 × 10 cm saja. Barcode tajam dari printer thermal kasir.",
      ],
      [
        "Nama gerai Anda di label",
        "Pengirim di label memakai nama, WhatsApp, dan alamat gerai, atau nama pengirim yang Anda ketik bila masking diaktifkan.",
      ],
      [
        "Nota untuk pelanggan",
        "Pilih Cetak resi + invoice untuk memberi pelanggan nota ongkir, di kertas thermal 80 mm atau A4.",
      ],
      [
        "Kontak pelanggan tersimpan",
        "Pengirim dan penerima langganan tersimpan, jadi kasir tidak perlu mengetik ulang dari awal.",
      ],
      [
        "Kirim resi via WhatsApp",
        "Kirim nomor resi ke WhatsApp penerima langsung dari halaman kiriman.",
      ],
    ],
  },
  {
    id: "pantau",
    heading: "Kasir aman, uang gerai terpantau",
    lead: "Pemilik toko memantau kiriman dan dana COD dari HP, sementara kasir fokus melayani.",
    items: [
      [
        "Peran kasir dibatasi",
        "Operator bekerja dari antrean cetak resi dan serah terima. Pembatalan kiriman dan laporan uang hanya untuk pemilik gerai.",
      ],
      [
        "Uang gerai dan Pencairan COD",
        "Lihat biaya kirim, biaya COD, dan estimasi dana yang dicairkan Mengantar per periode. Laporan pengiriman bisa diunduh sebagai CSV.",
      ],
      [
        "Kurir resmi jemput ke toko",
        "Jadwalkan penjemputan saat membuat kiriman, dan kurir datang mengambil paket di toko Anda.",
      ],
      [
        "Status, retur, dan cek resi",
        "Status kiriman mengikuti Mengantar otomatis. Paket retur punya halaman sendiri, dan resi bisa dicari dari nomor resi atau nomor kiriman.",
      ],
    ],
  },
] as const;

export default function FiturPage() {
  return (
    <MarketingShell currentPath="/fitur">
      <MarketingPageHero
        title="Fitur lengkap kasir loket multi-kurir, gratis"
        lead={`Semua kebutuhan loket pengiriman dalam satu aplikasi ${BRAND}: banyak ekspedisi resmi, cek ongkir cepat, anti-nombok selisih berat, dan komisi 20%–25% per paket untuk toko Anda.`}
      />

      {FEATURE_GROUPS.map((group, index) => (
        <section
          key={group.id}
          className={`py-14 sm:py-20 ${index % 2 === 1 ? "border-y border-border bg-background" : ""}`}
          aria-labelledby={`judul-${group.id}`}
        >
          <div className="mx-auto grid max-w-6xl gap-10 px-4 sm:px-6 lg:grid-cols-[1fr_2fr] lg:px-8">
            <div>
              <h2 id={`judul-${group.id}`} className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
                {group.heading}
              </h2>
              <p className="mt-3 text-base leading-relaxed text-muted-foreground">{group.lead}</p>
            </div>
            <ul className="grid gap-x-10 gap-y-8 sm:grid-cols-2">
              {group.items.map(([heading, text]) => (
                <li key={heading} className="border-t-2 border-primary pt-4">
                  <h3 className="text-lg font-semibold text-foreground">{heading}</h3>
                  <p className="mt-1.5 text-base leading-relaxed text-muted-foreground">{text}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>
      ))}

      <MarketingClosingCta heading="Semua fitur ini gratis untuk toko Anda" />
    </MarketingShell>
  );
}
