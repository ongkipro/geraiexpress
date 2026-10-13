const idr = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 });
const dateTime = new Intl.DateTimeFormat("id-ID", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Jakarta",
});

const shortDateTime = new Intl.DateTimeFormat("id-ID", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Asia/Jakarta",
});

export const formatIdr = (value: number | null | undefined) => (value == null ? "—" : idr.format(value));
export const formatWib = (iso: string | null | undefined) => (iso ? `${dateTime.format(new Date(iso))} WIB` : "—");
export const formatWibShort = (iso: string | null | undefined) => (iso ? shortDateTime.format(new Date(iso)) : "—");
export const formatWeight = (grams: number | null | undefined) =>
  grams == null ? "—" : grams >= 1000 ? `${(grams / 1000).toLocaleString("id-ID")} kg` : `${grams} g`;

export const SUBMISSION_LABEL: Record<string, string> = {
  draft: "Draf",
  estimated: "Sudah dicek ongkir",
  queued: "Dalam antrean",
  in_flight: "Sedang diproses",
  unknown: "Hasil belum pasti",
  issued: "Resi terbit",
  failed: "Gagal",
};
