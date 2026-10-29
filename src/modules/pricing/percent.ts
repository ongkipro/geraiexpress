// DATA-9: the gerai discount is stored as integer basis points. Percent text is parsed and shown with
// integer arithmetic only (no floating point), so 12,5% is exactly 1250 and never 1249.99.

const PERCENT = /^(\d{1,3})(?:[.,](\d{1,2}))?$/;

// "20", "12,5" and "12.50" -> 2000, 1250, 1250. Anything else, or above 100%, is null.
export function parsePercentToBps(input: string): number | null {
  const match = PERCENT.exec(input.trim());
  if (!match) return null;
  const basisPoints = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  return basisPoints <= 10000 ? basisPoints : null;
}

// 1250 -> "12,50%"; unknown (null/undefined) is "tidak diketahui", never 0%.
export function formatPercentBps(basisPoints: number | null | undefined): string {
  if (basisPoints == null) return "tidak diketahui";
  const abs = Math.abs(basisPoints);
  return `${basisPoints < 0 ? "-" : ""}${Math.floor(abs / 100)},${String(abs % 100).padStart(2, "0")}%`;
}

// A difference of two discounts is a number of percentage points, not a percent.
export function formatPointsBps(basisPoints: number | null | undefined): string {
  if (basisPoints == null) return "belum diketahui";
  const abs = Math.abs(basisPoints);
  return `${basisPoints < 0 ? "-" : ""}${Math.floor(abs / 100)},${String(abs % 100).padStart(2, "0")} poin`;
}

// Editable text for an input: 1250 -> "12,50".
export const bpsToInput = (basisPoints: number): string => `${Math.floor(basisPoints / 100)},${String(basisPoints % 100).padStart(2, "0")}`;

export const STATUS_LABEL: Record<string, string> = {
  owner_stated: "Pernyataan pemilik",
  provider_observed: "Teramati dari Mengantar",
  provider_verified: "Terverifikasi Mengantar",
};

export const STATUS_NOTE: Record<string, string> = {
  owner_stated: "Nilai ini pernyataan pemilik dan belum diverifikasi Mengantar.",
  provider_observed: "Nilai ini sama persis dengan diskon Mengantar tertinggi yang teramati dari estimasi terbaru; belum ada konfirmasi tertulis.",
  provider_verified: "Nilai ini punya konfirmasi tertulis Mengantar.",
};
