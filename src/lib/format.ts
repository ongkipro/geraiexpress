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

// Mengantar courier codes (stored as sent to create-order) → names counter staff know.
const COURIER_NAME: Record<string, string> = {
  JNE: "JNE", SiCepat: "SiCepat", Sap: "SAP Express", iDexpress: "ID Express", JT: "J&T Express",
  lion: "Lion Parcel", anteraja: "AnterAja", spx: "SPX Express", pos: "Pos Indonesia",
};
export const courierName = (code: string) => COURIER_NAME[code] ?? code;

// Mengantar's delivery estimates arrive as "1 - 2 days", "2 - 1 days", "4 HARI", "1-2 Day" or
// "—"; show them as Indonesian day ranges ("1–2 hari"), smallest first. Anything else is shown
// as given (simulated quotes already read "2–3 hari").
export function etaLabel(raw: string | null | undefined): string {
  if (!raw) return "—";
  const m = /^\s*(\d{1,2})\s*(?:[-–]\s*(\d{1,2}))?\s*(?:days?|hari)\s*$/i.exec(raw);
  if (!m) return raw;
  const [a, b] = [Number(m[1]), Number(m[2] ?? m[1])].sort((x, y) => x - y);
  return a === b ? `${a} hari` : `${a}–${b} hari`;
}
