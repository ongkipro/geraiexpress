// T-087 / PR-45: shaping of the pilot report (range parsing, row validation, masked share, unknown
// earnings, CSV through the formula guard of src/lib/csv.ts). Aggregates themselves are computed in the
// database (tests/db/pilot-report.test.ts).
import { describe, expect, it } from "vitest";
import { csvCell, toCsv } from "../../src/lib/csv";
import { exportFilename, wibIso } from "../../src/lib/export-format";
import {
  PILOT_CSV_HEADER, PILOT_UNKNOWN, earningsKnown, maskedSharePercent, maskedShareText, medianText, parsePilotRange,
  parsePilotReport, paymentMix, pilotCsvRows, pilotDefinitionRows, type PilotReportRow,
} from "../../src/modules/payments/pilot-report";

const row = (over: Partial<PilotReportRow> = {}): PilotReportRow => ({
  row_level: "day", outlet_id: "o1", outlet_name: "Outlet Satu", day: "2026-01-10",
  shipments_issued: 3, median_draft_to_resi_minutes: 20,
  cash_count: 1, cash_idr: 23000, qris_count: 1, qris_idr: 12345, transfer_count: 0, transfer_idr: 0, other_count: 0, other_idr: 0,
  labelled_shipments: 2, masked_shipments: 1, earnings_idr: 9069, earnings_unknown_count: 0,
  data_at: "2026-01-12T03:00:00.000Z", ...over,
});

describe("parsePilotRange", () => {
  const now = new Date("2026-01-11T18:30:00Z"); // 2026-01-12 01:30 WIB
  it("defaults to the last seven WIB days ending today", () => {
    expect(parsePilotRange({}, now)).toEqual({ from: "2026-01-06", to: "2026-01-12", error: null });
  });
  it("swaps reversed days, ignores invalid days and accepts exactly 92 days", () => {
    expect(parsePilotRange({ from: "2026-01-11", to: "2026-01-10" }, now)).toMatchObject({ from: "2026-01-10", to: "2026-01-11", error: null });
    expect(parsePilotRange({ from: "2026-02-31", to: "2026-01-10" }, now)).toMatchObject({ from: "2026-01-04", to: "2026-01-10" });
    expect(parsePilotRange({ from: "2026-01-01", to: "2026-04-02" }, now).error).toBeNull();
  });
  it("refuses a range longer than 92 days", () => {
    expect(parsePilotRange({ from: "2026-01-01", to: "2026-04-03" }, now).error).toMatch(/92 hari/);
  });
});

describe("report rows", () => {
  it("accepts well-formed rows and fails closed on unknown levels or unsafe integers", () => {
    expect(parsePilotReport([row(), row({ row_level: "total", outlet_id: null, day: null, earnings_idr: null })])).toHaveLength(2);
    expect(() => parsePilotReport([row({ row_level: "week" as PilotReportRow["row_level"] })])).toThrow();
    expect(() => parsePilotReport([row({ cash_idr: 2 ** 53 })])).toThrow();
    expect(() => parsePilotReport([row({ shipments_issued: -1 })])).toThrow();
    expect(() => parsePilotReport({})).toThrow();
  });

  it("derives the masked share from labelled shipments only; no label is unknown, never 0%", () => {
    expect(maskedSharePercent(row())).toBe(50);
    expect(maskedSharePercent(row({ labelled_shipments: 3, masked_shipments: 2 }))).toBe(67);
    expect(maskedSharePercent(row({ labelled_shipments: 0, masked_shipments: 0 }))).toBeNull();
    expect(maskedShareText(row({ labelled_shipments: 0, masked_shipments: 0 }))).toBe(PILOT_UNKNOWN);
    expect(maskedShareText(row())).toBe("50% (1/2)");
  });

  it("keeps the median and earnings unknown as 'Belum diketahui'", () => {
    expect(medianText(null)).toBe(PILOT_UNKNOWN);
    expect(medianText(25)).toBe("25 menit");
    expect(medianText(12.5)).toBe("12,5 menit");
    expect(earningsKnown(row())).toBe(true);
    expect(earningsKnown(row({ earnings_idr: null, earnings_unknown_count: 1 }))).toBe(false);
    // A count of unknown shipments makes the group unknown even if a partial sum were present.
    expect(earningsKnown(row({ earnings_idr: 100, earnings_unknown_count: 1 }))).toBe(false);
  });

  it("lists every payment method in the fixed order with counts and amounts", () => {
    expect(paymentMix(row()).map((m) => [m.label, m.count, m.amount])).toEqual([
      ["Tunai", 1, 23000], ["QRIS", 1, 12345], ["Transfer", 0, 0], ["Lainnya", 0, 0],
    ]);
  });
});

describe("pilot CSV", () => {
  const range = { from: "2026-01-10", to: "2026-01-11" };
  it("writes unknown as words, never 0, with period and data timestamp", () => {
    const [cells] = pilotCsvRows([row({ earnings_idr: null, earnings_unknown_count: 2, median_draft_to_resi_minutes: null, labelled_shipments: 0, masked_shipments: 0 })], range, wibIso);
    expect(cells[4]).toBe(PILOT_UNKNOWN);
    expect(cells[15]).toBe(PILOT_UNKNOWN);
    expect(cells[16]).toBe(PILOT_UNKNOWN);
    expect(cells[17]).toBe(2);
    expect(cells[18]).toBe("2026-01-10 s.d. 2026-01-11");
    expect(cells[19]).toBe("2026-01-12T10:00:00+07:00");
    expect(cells).toHaveLength(PILOT_CSV_HEADER.length);
  });

  it("neutralizes a formula-looking outlet name through the shared csvCell guard", () => {
    const rows = pilotCsvRows([row({ outlet_name: "=HYPERLINK(\"http://x\",\"y\")" })], range, wibIso);
    const doc = toCsv(PILOT_CSV_HEADER, rows);
    expect(doc).toContain(csvCell("=HYPERLINK(\"http://x\",\"y\")"));
    expect(doc).toContain(`"'=HYPERLINK(""http://x"",""y"")"`);
    expect(doc.startsWith("\uFEFF")).toBe(true);
  });

  it("labels outlet and grand totals and appends the measure definitions", () => {
    const rows = pilotCsvRows([row({ row_level: "outlet", day: null }), row({ row_level: "total", outlet_id: null, outlet_name: null, day: null })], range, wibIso);
    expect(rows.map((r) => r.slice(0, 3))).toEqual([["Total outlet", "Outlet Satu", ""], ["Total semua outlet", "Semua outlet", ""]]);
    expect(pilotDefinitionRows().map((r) => r[1])).toEqual(["Resi terbit", "Median draf ke resi", "Cara bayar", "Label masking", "Pendapatan (estimasi)"]);
  });

  it("names the download after the report kind, tenant slug and WIB date", () => {
    expect(exportFilename("gerai-a", new Date("2026-01-11T18:30:00Z"), "laporan-pilot")).toBe("laporan-pilot-gerai-a-20260112.csv");
    expect(exportFilename("gerai-a", new Date("2026-01-11T18:30:00Z"))).toBe("pengiriman-gerai-a-20260112.csv");
  });
});
