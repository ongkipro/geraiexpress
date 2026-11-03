import { describe, expect, it } from "vitest";
import { billableWeight, weightExclusionText, type BillableWeightRule } from "../../src/lib/billable-weight";

export const regularRule: BillableWeightRule = {
  id: "rule-regular", courier: "SiCepat", service_class: "regular", divisor: 6000, tolerance_grams: 300,
  max_weight_grams: 50000, min_weight_grams: null, cargo_minimum_range_grams: null,
  source_url: "https://help.mengantar.com/id/articles/5387484", source_updated_at: "2026-10-19", effective_at: "2026-10-19T00:00:00Z",
};
const dims = { lengthCm: 10, widthCm: 10, heightCm: 10 };

describe("billableWeight (PR-43 / DATA-14)", () => {
  it.each([[1000, 1000], [1300, 1000], [1301, 2000], [1310, 2000], [2000, 2000], [2300, 2000], [2301, 3000]])(
    "rounds the heavier actual %ig at the sourced tolerance to %ig with complete dimensions", (actual, expected) => {
      expect(billableWeight({ actualWeightGrams: actual, ...dims }, regularRule).billable_weight_grams).toBe(expected);
    });
  it.each([1, 299, 300, 301, 499, 500, 999, 1000])("preserves positive sub-kg actual %ig at integer-gram precision", (actual) => {
    expect(billableWeight({ actualWeightGrams: actual, lengthCm: 1, widthCm: 1, heightCm: 1 }, regularRule).billable_weight_grams).toBe(actual);
  });
  it("preserves volumetric-dominant sub-kg weight without a synthetic minimum or half-fare", () => {
    expect(billableWeight({ actualWeightGrams: 1, lengthCm: 10, widthCm: 10, heightCm: 29 }, regularRule)).toMatchObject({
      actual_weight_grams: 1, volumetric_weight_grams: 484, billable_weight_grams: 484,
    });
  });
  it("uses Lion's 310g tolerance, not the regular 300g tolerance", () => {
    const lion = { ...regularRule, courier: "lion", tolerance_grams: 310, max_weight_grams: 100000 };
    expect(billableWeight({ actualWeightGrams: 1310, ...dims }, lion).billable_weight_grams).toBe(1000);
    expect(billableWeight({ actualWeightGrams: 1311, ...dims }, lion).billable_weight_grams).toBe(2000);
  });
  it("uses per-service divisors: 6000 regular, 4000 JNE and IDX cargo", () => {
    const parcel = { actualWeightGrams: 1000, lengthCm: 30, widthCm: 20, heightCm: 20 };
    expect(billableWeight(parcel, regularRule)).toMatchObject({ volumetric_weight_grams: 2000, billable_weight_grams: 2000 });
    for (const rule of [
      { ...regularRule, courier: "JNE", divisor: 4000 },
      { ...regularRule, courier: "iDexpress", divisor: 4000, service_class: "cargo" as const, min_weight_grams: 1000 },
    ]) expect(billableWeight(parcel, rule)).toMatchObject({ volumetric_weight_grams: 3000, billable_weight_grams: 3000 });
  });
  it("rounds volume at the exact tolerance without intermediate integer truncation", () => {
    expect(billableWeight({ actualWeightGrams: 100, lengthCm: 13, widthCm: 20, heightCm: 30 }, regularRule)).toMatchObject({ volumetric_weight_grams: 1000 });
    expect(billableWeight({ actualWeightGrams: 100, lengthCm: 13, widthCm: 20, heightCm: 31 }, regularRule)).toMatchObject({ volumetric_weight_grams: 2000 });
  });
  it("keeps actual unchanged with each missing dimension or an unknown formula, never zero", () => {
    for (const side of ["lengthCm", "widthCm", "heightCm"] as const) {
      expect(billableWeight({ actualWeightGrams: 1301, ...dims, [side]: null }, regularRule)).toMatchObject({
        actual_weight_grams: 1301, volumetric_weight_grams: null, billable_weight_grams: 1301,
      });
    }
    expect(billableWeight({ actualWeightGrams: 1310, ...dims }, null)).toMatchObject({ volumetric_weight_grams: null, billable_weight_grams: 1310, weight_rule_id: null });
    expect(billableWeight({ actualWeightGrams: 1310, ...dims }, { ...regularRule, divisor: null, tolerance_grams: null }).volumetric_weight_grams).toBeNull();
  });
  it("enforces billable, not merely measured maxima, retaining named exclusion reasons", () => {
    const parcel = { actualWeightGrams: 1000, lengthCm: 100, widthCm: 60, heightCm: 60 };
    expect(billableWeight(parcel, regularRule).exclusion).toBe("max_weight_exceeded");
    expect(billableWeight(parcel, { ...regularRule, max_weight_grams: 100000 }).exclusion).toBeNull();
    expect(billableWeight({ actualWeightGrams: 30000 }, { ...regularRule, max_weight_grams: 30000 }).exclusion).toBeNull();
    expect(billableWeight({ actualWeightGrams: 30001 }, { ...regularRule, max_weight_grams: 30000 }).exclusion).toBe("max_weight_exceeded");
  });
  it("does not execute regional cargo range endpoints as a route minimum or maximum", () => {
    const cargo = { ...regularRule, service_class: "cargo" as const, max_weight_grams: null, cargo_minimum_range_grams: [10000, 70000] };
    expect(billableWeight({ actualWeightGrams: 40000 }, cargo).exclusion).toBe("cargo_minimum_unverified");
    expect(billableWeight({ actualWeightGrams: 1000 }, { ...cargo, min_weight_grams: 10000 }).exclusion).toBe("min_weight_not_met");
    expect(weightExclusionText("IDX Kargo", "cargo_minimum_unverified")).toContain("Hubungi admin");
  });
  it("rejects invalid measured values and malformed formulas", () => {
    for (const weight of [0, -1, 50001, 1.5, NaN, Infinity]) expect(() => billableWeight({ actualWeightGrams: weight }, regularRule)).toThrow();
    for (const side of [0, -1, 201, 1.5, NaN]) expect(() => billableWeight({ actualWeightGrams: 1, lengthCm: side }, regularRule)).toThrow();
    expect(() => billableWeight({ actualWeightGrams: 1, ...dims }, { ...regularRule, divisor: 0 })).toThrow();
    expect(() => billableWeight({ actualWeightGrams: 1, ...dims }, { ...regularRule, tolerance_grams: 1000 })).toThrow();
  });
});

describe("cargoMinimumSummary (T-089 F9)", () => {
  it("names only the excluded subset when another cargo service is still eligible", async () => {
    const { cargoMinimumSummary } = await import("../../src/lib/billable-weight");
    const text = cargoMinimumSummary([
      { courier: "JNE", minimumGrams: 10000, belowMinimum: true },
      { courier: "SiCepat", minimumGrams: 10000, belowMinimum: true },
      { courier: "iDexpress", minimumGrams: 10000, belowMinimum: false },
    ]);
    expect(text).toBe("JNE Kargo, SiCepat Kargo belum tersedia: berat ditagih di bawah minimum (10 kg, 10 kg).");
    expect(text).not.toContain("Layanan Kargo");
    expect(text).not.toContain("iDexpress");
  });
  it("says all of Kargo only when every verified cargo service is below its minimum", async () => {
    const { cargoMinimumSummary } = await import("../../src/lib/billable-weight");
    expect(cargoMinimumSummary([
      { courier: "JNE", minimumGrams: 10000, belowMinimum: true },
      { courier: "iDexpress", minimumGrams: 5500, belowMinimum: true },
    ])).toBe("Layanan Kargo belum tersedia: berat ditagih di bawah minimum kargo (minimum terendah 5,5 kg).");
  });
  it("says nothing when no cargo service is below its minimum or none has a verified minimum", async () => {
    const { cargoMinimumSummary } = await import("../../src/lib/billable-weight");
    expect(cargoMinimumSummary([{ courier: "JNE", minimumGrams: 10000, belowMinimum: false }])).toBeNull();
    expect(cargoMinimumSummary([])).toBeNull();
  });
});

describe("F9 reviewer scenario: 1 kg, 40x40x30 cm against the seeded cargo rules", () => {
  it("excludes JNE/SiCepat cargo (8 kg) but keeps iDexpress cargo (12 kg), and the summary says so", async () => {
    const { cargoMinimumSummary } = await import("../../src/lib/billable-weight");
    const cargo = (courier: string, divisor: number): BillableWeightRule => ({ id: courier, courier, service_class: "cargo", divisor,
      tolerance_grams: 300, max_weight_grams: 70000, min_weight_grams: 10000, cargo_minimum_range_grams: null,
      source_url: "https://help.mengantar.com/id/articles/5502313", source_updated_at: "2026-09-24", effective_at: "2026-11-03T00:00:00Z" });
    const parcel = { actualWeightGrams: 1000, lengthCm: 40, widthCm: 40, heightCm: 30 };
    const results = [cargo("JNE", 6000), cargo("SiCepat", 6000), cargo("iDexpress", 4000)].map((r) => {
      const w = billableWeight(parcel, r);
      return { courier: r.courier, minimumGrams: 10000, belowMinimum: w.exclusion === "min_weight_not_met", billable: w.billable_weight_grams };
    });
    expect(results.map((r) => r.billable)).toEqual([8000, 8000, 12000]);
    expect(cargoMinimumSummary(results)).toBe("JNE Kargo, SiCepat Kargo belum tersedia: berat ditagih di bawah minimum (10 kg, 10 kg).");
  });
});
