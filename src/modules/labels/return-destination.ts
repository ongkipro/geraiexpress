// T-084 / PR-46 / UX-9 acceptance gate: where a returned (RTS) parcel goes, shown as help text in the print
// view (never on the printout). Mengantar help 14715369 (updated 2026-10-17): a seller return address is
// used only for JNE, SiCepat and SAP when origin AND destination are both on Java; otherwise the pickup
// address replaces it. Create Order has no return-address field, so an API order cannot send one; whether
// a return address saved in the seller's web settings applies to API orders is Unknown ("belum
// terverifikasi"). A return never goes to the printed (masked) sender.
// Pure module with relative imports only, so the unit matrix runs without the '@/' alias.

export const RETURN_DESTINATION_SOURCE = "https://help.mengantar.com/id/articles/14715369";

// Create-order courier codes (src/lib/mengantar/public-api.ts COURIERS) with the Java-only return-address rule.
export const JAVA_RETURN_ADDRESS_COURIERS: ReadonlySet<string> = new Set(["JNE", "SiCepat", "Sap"]);

// Province names as the Mengantar area catalogue spells them (public.mengantar_areas, 2026-10-30 dataset).
export const JAVA_PROVINCES: ReadonlySet<string> = new Set([
  "BANTEN", "DKI JAKARTA", "JAWA BARAT", "JAWA TENGAH", "DI YOGYAKARTA", "JAWA TIMUR",
]);

export type ReturnRoute = { originProvince: string | null; destinationProvince: string | null };

// `pickup`: the parcel returns to the provider pickup address.
// `java_web_return_unverified`: JNE/SiCepat/SAP Java-to-Java; the API order still sends no return address,
//   so the pickup address applies unless a web-setting return address does, which is not verified.
// `route_unknown`: JNE/SiCepat/SAP with a province missing; the pickup address is the only known destination.
export type ReturnDestinationKind = "pickup" | "java_web_return_unverified" | "route_unknown";

const isJava = (province: string | null) => province !== null && JAVA_PROVINCES.has(province.trim().toUpperCase());

export function returnDestinationKind(courier: string | null, route: ReturnRoute): ReturnDestinationKind {
  if (!courier || !JAVA_RETURN_ADDRESS_COURIERS.has(courier)) return "pickup";
  if (!route.originProvince || !route.destinationProvince) return "route_unknown";
  return isJava(route.originProvince) && isJava(route.destinationProvince) ? "java_web_return_unverified" : "pickup";
}

// The operator-facing sentence (Bahasa Indonesia). `pickupAddress` is the pickup shown on the shipment detail.
export function returnDestinationNote(courier: string | null, route: ReturnRoute, pickupAddress: string | null): string {
  const pickup = pickupAddress ? `alamat pickup (${pickupAddress})` : "alamat pickup yang tercatat di rincian pengiriman";
  const head = `Jika paket diretur, paket kembali ke ${pickup}, bukan ke pengirim yang tercetak di label.`;
  switch (returnDestinationKind(courier, route)) {
    case "java_web_return_unverified":
      return `${head} Rute ini Jawa–Jawa: alamat retur dari pengaturan web Mengantar hanya dipakai JNE, SiCepat dan SAP untuk rute Jawa–Jawa, dan apakah alamat itu berlaku untuk pesanan lewat API belum terverifikasi.`;
    case "route_unknown":
      return `${head} Rute tidak diketahui (provinsi asal atau tujuan tidak ada di katalog wilayah), jadi aturan alamat retur Jawa–Jawa belum bisa dinilai.`;
    default:
      return `${head} Pesanan lewat API tidak mengirim alamat retur.`;
  }
}
