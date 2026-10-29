// Public data for the marketing pages (T-029, corrected by T-036 / PR-35).
// Rule: a public page states only what is implemented at this release and no numeric commission,
// discount, COD fee, insurance or payout term. Courier names derive from the application's own
// courier configuration (OFFERED_COURIERS / DROP_OFF_UNSUPPORTED) and its one name table
// (COURIER_NAME in format.ts), never from a second list.

import type { MetadataRoute } from "next";
import { COURIER_NAME, courierName } from "./format";
import { appHref, PRODUCTION_PUBLIC_HOSTS } from "./hosts";
import { DROP_OFF_UNSUPPORTED, OFFERED_COURIERS } from "./mengantar/public-api";

export const BRAND = "GeraiExpress";
export const SITE_ORIGIN = "https://geraiexpress.com";
export const SIGN_UP_URL = "/daftar";
export const SIGN_IN_URL = "/masuk";

// Sign-in and sign-up live on the app host (DEC-015): the public site links to them with the
// environment-configured app origin (APP_ORIGIN). Resolved from environment configuration only,
// never from the request, so the marketing pages can be prerendered; the build that produces the
// public site must therefore have APP_ORIGIN set: a production build throws without it (src/lib/hosts.ts).
export const signUpHref = () => appHref(SIGN_UP_URL);
export const signInHref = () => appHref(SIGN_IN_URL);

export const WHATSAPP_DISPLAY = "+62 831-9314-4001";
export const WHATSAPP_URL =
  "https://wa.me/6283193144001?text=Halo%20Admin%20GeraiExpress%2C%20saya%20ingin%20daftar%20loket%20toko";

export interface MarketingNavItem {
  href: string;
  label: string;
}

export const MARKETING_NAV: readonly MarketingNavItem[] = [
  { href: "/", label: "Beranda" },
  { href: "/fitur", label: "Fitur" },
  { href: "/simulasi", label: "Model layanan" },
  { href: "/cara-kerja", label: "Alur kasir" },
  { href: "/hubungi-kami", label: "Hubungi kami" },
];

// Couriers a gerai can actually order today: offered by the application and not refused for
// drop-off. Same predicate the quote action applies (src/modules/shipments/actions.ts). A courier
// without a display name in COURIER_NAME would vanish from the public list, so a unit test asserts
// the table covers OFFERED_COURIERS.
export interface CourierItem {
  name: string;
  code: string;
}

export const ORDERABLE_COURIERS: readonly CourierItem[] = [...OFFERED_COURIERS]
  .filter((code) => !DROP_OFF_UNSUPPORTED.has(code) && code in COURIER_NAME)
  .map((code) => ({ code, name: courierName(code) }));

const idrFormatter = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
});

export function formatIdr(value: number): string {
  return idrFormatter.format(value);
}

// Indexing control (SUP-15). Only the production apex is indexable; every other host (preview
// workers.dev, staging, localhost, unknown) is non-production. Canonical and Open Graph URLs stay on
// SITE_ORIGIN regardless of the serving host.
export const PRODUCTION_HOSTS: readonly string[] = PRODUCTION_PUBLIC_HOSTS;

export function isProductionHost(host: string | null | undefined): boolean {
  if (!host) return false;
  const bare = host.trim().toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "");
  return PRODUCTION_HOSTS.includes(bare);
}

export const NOINDEX_HEADER = "noindex, nofollow";

const APP_PATHS_DISALLOWED = [
  "/pengiriman",
  "/kontak",
  "/pengaturan",
  "/anggota",
  "/admin",
  "/api",
  "/masuk",
  "/daftar",
  "/undangan",
  "/verifikasi-2fa",
  "/akses",
  "/pilih-gerai",
];

export function robotsFor(host: string | null | undefined): MetadataRoute.Robots {
  if (!isProductionHost(host)) {
    return { rules: { userAgent: "*", disallow: "/" } };
  }
  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/fitur", "/simulasi", "/cara-kerja", "/hubungi-kami"],
      disallow: APP_PATHS_DISALLOWED,
    },
    sitemap: `${SITE_ORIGIN}/sitemap.xml`,
  };
}
