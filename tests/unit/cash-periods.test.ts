import { describe, expect, it } from "vitest";
import { cashPeriodTotals } from "../../src/modules/payments/cash-periods";
import { formatIdr, formatWib } from "../../src/lib/format";

describe("cashPeriodTotals", () => {
  it("groups methods and staff identity without merging the shared Petugas label", () => {
    const totals = cashPeriodTotals([
      { method: "cash", amount_idr: 12000, recorded_by: "one", recorded_by_label: "Petugas" },
      { method: "qris", amount_idr: 5000, recorded_by: "two", recorded_by_label: "Petugas" },
      { method: "transfer", amount_idr: 1000, recorded_by: "one", recorded_by_label: "Petugas" },
    ]);
    expect(totals.methods).toEqual({ cash: 12000, qris: 5000, transfer: 1000, other: 0 });
    expect(totals.expected).toBe(12000);
    expect(totals.staff).toEqual([{ id: "one", label: "Petugas", total: 13000 }, { id: "two", label: "Petugas", total: 5000 }]);
  });
  it("keeps empty expected cash at zero and refuses unsupported individual or cumulative money", () => {
    expect(cashPeriodTotals([]).expected).toBe(0);
    const row = { method: "cash" as const, amount_idr: Number.MAX_SAFE_INTEGER, recorded_by: "one", recorded_by_label: "Petugas" };
    expect(() => cashPeriodTotals([{ ...row, amount_idr: Number.MAX_SAFE_INTEGER + 1 }])).toThrow();
    expect(() => cashPeriodTotals([row, { ...row, amount_idr: 1 }])).toThrow();
  });
  it("reuses the shared rupiah and WIB formatters for zero, signed variance and unknown amounts", () => {
    expect(formatIdr(0)).toMatch(/Rp\s*0/);
    expect(formatIdr(-500)).toMatch(/-Rp\s*500/);
    expect(formatIdr(null)).toBe("—");
    expect(formatWib("2026-11-04T17:30:00Z")).toContain("WIB");
  });
});
