import type { CsvCell } from "../../lib/csv";
import { parseDay } from "../../lib/export-format";
import { PAYMENT_METHODS, PAYMENT_METHOD_LABEL, type PaymentMethod } from "./messages";

// T-087 / PR-45 / UX-17 item 6: shaping of the tenant-admin pilot report returned by
// public.pilot_report (db/migrations/20261105160000_pilot_report.sql). Every aggregate, including the
// medians of the outlet and grand totals, is computed in the database; this module only validates,
// derives the masked-label share and formats. The RPC returns no provider net cost or percentage.

export const PILOT_REPORT_MAX_DAYS = 92;
export const PILOT_REPORT_DEFAULT_DAYS = 7;
export const PILOT_UNKNOWN = "Belum diketahui";

export type PilotReportRow = {
  row_level: "day" | "outlet" | "total";
  outlet_id: string | null;
  outlet_name: string | null;
  day: string | null;
  shipments_issued: number;
  median_draft_to_resi_minutes: number | null;
  cash_count: number; cash_idr: number;
  qris_count: number; qris_idr: number;
  transfer_count: number; transfer_idr: number;
  other_count: number; other_idr: number;
  labelled_shipments: number;
  masked_shipments: number;
  earnings_idr: number | null;
  earnings_unknown_count: number;
  data_at: string;
};

// The measures and their definitions, shown on the page and repeated in the CSV (PR-45 acceptance:
// each measure has its definition, period and data timestamp).
export const PILOT_DEFINITIONS: readonly { measure: string; definition: string }[] = [
  { measure: "Resi terbit", definition: "Pengiriman berstatus terbit yang resinya terbit pada hari WIB itu (gerai nyata: bukan simulasi; demo: contoh simulasi)." },
  { measure: "Median draf ke resi", definition: "Median menit dari draf dibuat (created_at) sampai resi terbit (issued_at) untuk pengiriman tersebut." },
  { measure: "Cara bayar", definition: "Catatan pembayaran kasir aktif (tidak dibatalkan) per cara bayar, menurut hari WIB pencatatan dan cabang pembayaran." },
  { measure: "Label masking", definition: "Pengiriman yang snapshot label terakhirnya memakai masking pengirim, dibagi pengiriman yang sudah punya label." },
  { measure: "Pendapatan (estimasi)", definition: "Tarif normal layanan terpilih dikurangi biaya gerai dari diskon yang berlaku saat tarif dicek; biaya COD dan asuransi tidak dihitung. Bila ada biaya gerai yang belum diketahui, total ditampilkan \"Belum diketahui\", bukan 0." },
];

const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const dayNumber = (day: string) => Date.parse(`${day}T00:00:00Z`) / DAY_MS;
const dayString = (n: number) => new Date(n * DAY_MS).toISOString().slice(0, 10);

export type PilotRange = { from: string; to: string; error: string | null };

// Inclusive WIB days. Missing values default to the last seven WIB days ending today; reversed days are
// swapped; a range longer than 92 days is refused (the database refuses it too).
export function parsePilotRange(params: { from?: string | null; to?: string | null }, now: Date): PilotRange {
  const today = new Date(now.getTime() + WIB_OFFSET_MS).toISOString().slice(0, 10);
  let to = parseDay(params.to) || today;
  let from = parseDay(params.from) || dayString(dayNumber(to) - (PILOT_REPORT_DEFAULT_DAYS - 1));
  if (from > to) [from, to] = [to, from];
  const days = dayNumber(to) - dayNumber(from) + 1;
  return days > PILOT_REPORT_MAX_DAYS
    ? { from, to, error: `Periode laporan paling panjang ${PILOT_REPORT_MAX_DAYS} hari.` }
    : { from, to, error: null };
}

const isCount = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const isRupiah = isCount;

// Fail closed: a value JavaScript cannot represent exactly, or a malformed row, is never rounded into
// the report.
export function isPilotReportRow(value: unknown): value is PilotReportRow {
  if (!value || typeof value !== "object") return false;
  const r = value as Record<string, unknown>;
  const counts = ["shipments_issued", "cash_count", "qris_count", "transfer_count", "other_count", "labelled_shipments", "masked_shipments", "earnings_unknown_count"];
  const money = ["cash_idr", "qris_idr", "transfer_idr", "other_idr"];
  return ["day", "outlet", "total"].includes(r.row_level as string)
    && counts.every((k) => isCount(r[k])) && money.every((k) => isRupiah(r[k]))
    && (r.earnings_idr === null || isRupiah(r.earnings_idr))
    && (r.median_draft_to_resi_minutes === null || (typeof r.median_draft_to_resi_minutes === "number" && Number.isFinite(r.median_draft_to_resi_minutes) && r.median_draft_to_resi_minutes >= 0))
    && typeof r.data_at === "string";
}

export const PILOT_REPORT_UNSUPPORTED = "Laporan pilot memuat nilai yang tidak dapat ditampilkan dengan tepat. Hubungi admin GeraiExpress.";

export function parsePilotReport(data: unknown): PilotReportRow[] {
  if (!Array.isArray(data) || !data.every(isPilotReportRow)) throw new Error(PILOT_REPORT_UNSUPPORTED);
  return data;
}

// Masked-label share in whole percent of the shipments that have a label; NULL (unknown) without any label.
export function maskedSharePercent(row: Pick<PilotReportRow, "labelled_shipments" | "masked_shipments">): number | null {
  if (row.labelled_shipments === 0) return null;
  return Math.round((row.masked_shipments * 100) / row.labelled_shipments);
}

export function paymentMix(row: PilotReportRow): { method: PaymentMethod; label: string; count: number; amount: number }[] {
  return PAYMENT_METHODS.map((method) => ({
    method, label: PAYMENT_METHOD_LABEL[method], count: row[`${method}_count`], amount: row[`${method}_idr`],
  }));
}

// Earnings are known only when every issued shipment of the group has a known gerai cost.
export const earningsKnown = (row: PilotReportRow) => row.earnings_idr !== null && row.earnings_unknown_count === 0;

const minutesText = (m: number | null) => (m === null ? PILOT_UNKNOWN : `${m.toLocaleString("id-ID", { maximumFractionDigits: 1 })} menit`);
export const medianText = minutesText;
export const maskedShareText = (row: PilotReportRow) => {
  const share = maskedSharePercent(row);
  return share === null ? PILOT_UNKNOWN : `${share}% (${row.masked_shipments}/${row.labelled_shipments})`;
};

export const PILOT_CSV_HEADER = [
  "Baris", "Cabang", "Hari (WIB)", "Resi terbit", "Median draf ke resi (menit)",
  "Tunai (jumlah)", "Tunai (Rp)", "QRIS (jumlah)", "QRIS (Rp)", "Transfer (jumlah)", "Transfer (Rp)",
  "Lainnya (jumlah)", "Lainnya (Rp)", "Pengiriman berlabel", "Label masking", "Porsi label masking (%)",
  "Pendapatan estimasi (Rp)", "Pengiriman biaya gerai belum diketahui", "Periode (WIB)", "Data per (WIB)",
] as const;

const LEVEL_LABEL: Record<PilotReportRow["row_level"], string> = { day: "Hari", outlet: "Total cabang", total: "Total semua cabang" };

// Unknown is written as the word "Belum diketahui", never 0 or an empty cell. Outlet names are
// tenant-typed text and pass through the formula guard of csvCell in src/lib/csv.ts. Earnings are never
// negative (the gerai cost never exceeds the normal tariff), so the integer cells are valid CSV numbers.
export function pilotCsvRows(rows: PilotReportRow[], range: { from: string; to: string }, wib: (iso: string) => string): CsvCell[][] {
  return rows.map((r) => [
    LEVEL_LABEL[r.row_level], r.row_level === "total" ? "Semua cabang" : (r.outlet_name ?? "Cabang"), r.day ?? "",
    r.shipments_issued, r.median_draft_to_resi_minutes === null ? PILOT_UNKNOWN : String(r.median_draft_to_resi_minutes),
    r.cash_count, r.cash_idr, r.qris_count, r.qris_idr, r.transfer_count, r.transfer_idr, r.other_count, r.other_idr,
    r.labelled_shipments, r.masked_shipments, maskedSharePercent(r) ?? PILOT_UNKNOWN,
    earningsKnown(r) ? r.earnings_idr : PILOT_UNKNOWN, r.earnings_unknown_count,
    `${range.from} s.d. ${range.to}`, wib(r.data_at),
  ]);
}

export const pilotDefinitionRows = (): CsvCell[][] => PILOT_DEFINITIONS.map((d) => ["Definisi", d.measure, d.definition]);

export const PILOT_REPORT_ERRORS: Record<string, string> = {
  admin_required: "Laporan pilot hanya untuk admin gerai.",
  report_range_invalid: `Periode laporan tidak valid (paling panjang ${PILOT_REPORT_MAX_DAYS} hari).`,
};
