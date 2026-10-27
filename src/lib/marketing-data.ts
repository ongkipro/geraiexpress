// Data publik dan kalkulasi ilustrasi untuk halaman pemasaran GeraiExpress (T-029).
// Seluruh klaim produk mengacu pada fitur loket pengiriman multi-kurir dan ketentuan resmi Mengantar.

export const BRAND = "GeraiExpress";
export const SITE_ORIGIN = "https://geraiexpress.com";
export const SIGN_UP_URL = "/daftar";
export const SIGN_IN_URL = "/masuk";

export const WHATSAPP_DISPLAY = "+62 831-9314-4001";
export const WHATSAPP_URL =
  "https://wa.me/6283193144001?text=Halo%20Admin%20GeraiExpress%2C%20saya%20ingin%20daftar%20loket%20toko";

export const MENGANTAR_URL = "https://mengantar.com/";

export interface MarketingNavItem {
  href: string;
  label: string;
}

export const MARKETING_NAV: readonly MarketingNavItem[] = [
  { href: "/", label: "Beranda" },
  { href: "/fitur", label: "Fitur" },
  { href: "/simulasi", label: "Simulasi margin" },
  { href: "/cara-kerja", label: "Alur kasir" },
  { href: "/hubungi-kami", label: "Hubungi kami" },
];

export interface CourierItem {
  name: string;
  code: string;
  badge: string;
  services: string;
}

// D-26 / D-29: kurir yang dapat dipesan gerai melalui Mengantar.
export const ORDERABLE_COURIERS: readonly CourierItem[] = [
  { name: "J&T Express", code: "JT", badge: "J&T", services: "EZ Reguler & COD" },
  { name: "JNE", code: "JNE", badge: "JNE", services: "REG, YES & JTR Kargo" },
  { name: "SiCepat", code: "SiCepat", badge: "SiCepat", services: "REG, BEST & GOKIL Kargo" },
  { name: "Lion Parcel", code: "lion", badge: "Lion", services: "REGPACK & JAGOPACK" },
  { name: "ID Express", code: "iDexpress", badge: "ID Express", services: "STD & Cargo" },
  { name: "AnterAja", code: "anteraja", badge: "AnterAja", services: "Reguler" },
  { name: "POS Indonesia", code: "pos", badge: "POS", services: "Pos Reguler" },
  { name: "SAP Express", code: "Sap", badge: "SAP", services: "REG & DRX Kargo" },
];

export const QUOTE_ONLY_COURIERS: readonly { name: string; code: string; badge: string }[] = [
  { name: "Paxel", code: "paxel", badge: "Paxel" },
  { name: "SPX Express", code: "spx", badge: "SPX" },
];

export interface DiscountTier {
  volume: string;
  discount: string;
  rate: number;
  minPackages: number;
  maxPackages: number | null;
}

export const MENGANTAR_DISCOUNT_TIERS: readonly DiscountTier[] = [
  { volume: "0–2.500", discount: "20%", rate: 0.2, minPackages: 0, maxPackages: 2500 },
  { volume: "2.501–5.000", discount: "22,5%", rate: 0.225, minPackages: 2501, maxPackages: 5000 },
  { volume: "5.001–7.500", discount: "25%", rate: 0.25, minPackages: 5001, maxPackages: 7500 },
];

const idrFormatter = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
});

export function formatIdr(value: number): string {
  return idrFormatter.format(value);
}

export interface CommissionEstimate {
  packagesPerDay: number;
  avgTariffIdr: number;
  monthlyPackages: number;
  activeTierRate: number;
  activeTierLabel: string;
  perPackageTierIdr: number;
  perPackageMinIdr: number;
  perPackageMaxIdr: number;
  dailyMinIdr: number;
  dailyMaxIdr: number;
  dailyTierIdr: number;
  monthlyMinIdr: number;
  monthlyMaxIdr: number;
  monthlyTierIdr: number;
  yearlyTierIdr: number;
}

export function estimateCommission(packagesPerDay: number, avgTariffIdr: number): CommissionEstimate {
  const safePackages = Math.max(1, Math.round(packagesPerDay));
  const safeTariff = Math.max(1000, Math.round(avgTariffIdr));
  const monthlyPackages = safePackages * 30;

  let activeTierRate = 0.2;
  let activeTierLabel = "20%";
  if (monthlyPackages > 5000) {
    activeTierRate = 0.25;
    activeTierLabel = "25%";
  } else if (monthlyPackages > 2500) {
    activeTierRate = 0.225;
    activeTierLabel = "22,5%";
  }

  const perPackageMinIdr = Math.round(safeTariff * 0.2);
  const perPackageMaxIdr = Math.round(safeTariff * 0.25);
  const perPackageTierIdr = Math.round(safeTariff * activeTierRate);

  const dailyMinIdr = safePackages * perPackageMinIdr;
  const dailyMaxIdr = safePackages * perPackageMaxIdr;
  const dailyTierIdr = safePackages * perPackageTierIdr;

  const monthlyMinIdr = monthlyPackages * perPackageMinIdr;
  const monthlyMaxIdr = monthlyPackages * perPackageMaxIdr;
  const monthlyTierIdr = monthlyPackages * perPackageTierIdr;
  const yearlyTierIdr = monthlyTierIdr * 12;

  return {
    packagesPerDay: safePackages,
    avgTariffIdr: safeTariff,
    monthlyPackages,
    activeTierRate,
    activeTierLabel,
    perPackageTierIdr,
    perPackageMinIdr,
    perPackageMaxIdr,
    dailyMinIdr,
    dailyMaxIdr,
    dailyTierIdr,
    monthlyMinIdr,
    monthlyMaxIdr,
    monthlyTierIdr,
    yearlyTierIdr,
  };
}

/** Tabel simbol Code 128 B untuk ilustrasi barcode label thermal. */
const CODE128_PATTERNS = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312", "132212", "221213",
  "221312", "231212", "112232", "122132", "122231", "113222", "123122", "123221", "223211", "221132",
  "221231", "213212", "223112", "312131", "311222", "321122", "321221", "312212", "322112", "322211",
  "212123", "212321", "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313",
  "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121", "313121", "211331",
  "231131", "213113", "213311", "213131", "311123", "311321", "331121", "312113", "312311", "332111",
  "314111", "221411", "431111", "111224", "111422", "121124", "121421", "141122", "141221", "112214",
  "112412", "122114", "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
  "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112", "421211", "212141",
  "214121", "412121", "111143", "111341", "131141", "114113", "114311", "411113", "411311", "113141",
  "114131", "311141", "411131", "211412", "211214", "211232", "2331112",
];
const QUIET_ZONE_MODULES = 10;

export function encodeCode128B(text: string): { bars: [number, number][]; modules: number } {
  const values: number[] = [104];
  for (const character of text) {
    const code = character.codePointAt(0);
    if (code === undefined || code < 32 || code > 126) {
      throw new Error(`Code 128 B cannot encode ${JSON.stringify(character)}`);
    }
    values.push(code - 32);
  }
  const checksum =
    values.reduce((sum, value, index) => sum + value * (index === 0 ? 1 : index), 0) % 103;
  values.push(checksum, 106);

  const bars: [number, number][] = [];
  let cursor = QUIET_ZONE_MODULES;
  for (const value of values) {
    const widths = CODE128_PATTERNS[value];
    for (let index = 0; index < widths.length; index += 1) {
      const width = Number(widths[index]);
      if (index % 2 === 0) bars.push([cursor, width]);
      cursor += width;
    }
  }
  return { bars, modules: cursor + QUIET_ZONE_MODULES };
}

/**
 * Ilustrasi perhitungan COD (harga barang + ongkir setelah fee COD Mengantar 3,33%).
 */
export function codSample(goodsIdr: number, shippingIdr: number) {
  const base = BigInt(goodsIdr + shippingIdr);
  const cod = Number((base * 10000n + 9666n) / 9667n);
  const mengantarFee = Number((BigInt(cod) * 333n + 5000n) / 10000n);
  return {
    goodsIdr,
    shippingIdr,
    codIdr: cod,
    mengantarFeeIdr: mengantarFee,
    labelOngkirIdr: cod - goodsIdr,
    disbursementIdr: cod - shippingIdr - mengantarFee,
  };
}

export const SAMPLE_LABEL = {
  courier: "J&T Express",
  awb: "JP0000000000001",
  publicReference: "GX-CONTOH01",
  recipientName: "Ibu Contoh",
  recipientPhone: "0812-0000-0000",
  recipientArea: "Coblong, Kota Bandung",
  recipientAddress: "Jl. Contoh No. 1, RT 01/RW 02",
  senderName: "Gerai Contoh",
  outletName: "Outlet Contoh",
  content: "Pakaian",
  weight: "1 kg",
  cod: codSample(100_000, 15_000),
};
