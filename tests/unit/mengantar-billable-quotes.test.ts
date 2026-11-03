import { describe, expect, it } from "vitest";
import type { BillableWeightRule } from "../../src/lib/billable-weight";
import { estimateBillableQuotes } from "../../src/lib/mengantar/billable-quotes";
import type { CourierEstimate, EstimateRequest } from "../../src/lib/mengantar/public-api";

const rule = (courier: string, overrides: Partial<BillableWeightRule> = {}): BillableWeightRule => ({
  id: `rule-${courier}`, courier, service_class: "regular", divisor: 6000, tolerance_grams: 300,
  max_weight_grams: 50000, min_weight_grams: null, cargo_minimum_range_grams: null,
  source_url: "https://help.mengantar.com/id/articles/5387484", source_updated_at: "2026-10-19", effective_at: "2026-10-19T00:00:00Z", ...overrides,
});
const parcel = { actualWeightGrams: 1000, lengthCm: 30, widthCm: 20, heightCm: 20 };
const input = { originAreaId: "origin", destinationAreaId: "destination" };
const rules = [rule("JNE", { divisor: 4000 }), rule("JT"), rule("lion", { tolerance_grams: 310, max_weight_grams: 100000 })];
const services = rules.map(({ courier, service_class }) => ({ courier, service_class }));
const row = (courier: string, tariff: number, codFee = 0): CourierEstimate => ({ courier, tariff, codFee, netShipping: tariff * 0.8, discountBps: null, etaText: "1–2 hari" });

describe("estimateBillableQuotes", () => {
  it("makes one non-COD estimate per distinct weight and retains only that weight's couriers", async () => {
    const calls: EstimateRequest[] = [];
    const result = await estimateBillableQuotes(async (request) => {
      calls.push(request);
      return services.map(({ courier }) => row(courier, request.weightGrams * 10));
    }, input, parcel, rules, services);
    expect(calls.map((c) => c.weightGrams).sort()).toEqual([2000, 3000]);
    expect(result.rows).toHaveLength(3);
    expect(result.rows.find((r) => r.courier === "JNE")).toMatchObject({ tariff: 30000, billable_weight_grams: 3000, weight_rule_id: "rule-JNE" });
    expect(result.rows.find((r) => r.courier === "JT")).toMatchObject({ tariff: 20000, billable_weight_grams: 2000 });
    expect(result.exclusions).toEqual([]);
  });
  it("preserves two-pass COD within each weight group and never uses another group's tariff or fee", async () => {
    const calls: EstimateRequest[] = [];
    const result = await estimateBillableQuotes(async (request) => {
      calls.push(request);
      return services.map(({ courier }) => row(courier, request.weightGrams * 10, Math.ceil(request.codAmount! * 0.03)));
    }, { ...input, goodsValueIdr: 100000 }, parcel, rules, services);
    expect(calls.map((c) => [c.weightGrams, c.codAmount]).sort()).toEqual([[2000, 100000], [2000, 120000], [3000, 100000], [3000, 130000]]);
    expect(result.rows.find((r) => r.courier === "JNE")).toMatchObject({ tariff: 30000, codFee: 3900, billable_weight_grams: 3000 });
    expect(result.rows.find((r) => r.courier === "JT")).toMatchObject({ tariff: 20000, codFee: 3600 });
  });
  it("drops over-limit and unresolved cargo services by name without suppressing valid services", async () => {
    const localRules = [rule("anteraja", { max_weight_grams: 30000 }), rule("lion", { max_weight_grams: 100000 }),
      rule("iDexpress", { service_class: "cargo", divisor: 4000, cargo_minimum_range_grams: [10000, 70000], max_weight_grams: null })];
    const calls: number[] = [];
    const result = await estimateBillableQuotes(async (r) => {
      calls.push(r.weightGrams); return [row("anteraja", 100), row("lion", 200), row("iDexpress", 300)];
    }, input, { actualWeightGrams: 1000, lengthCm: 100, widthCm: 60, heightCm: 40 }, localRules,
    localRules.map(({ courier, service_class }) => ({ courier, service_class })));
    expect(calls).toEqual([40000]);
    expect(result.rows.map((r) => r.courier)).toEqual(["lion"]);
    expect(result.exclusions).toEqual([{ courier: "anteraja", reason: "max_weight_exceeded" }, { courier: "iDexpress", reason: "cargo_minimum_unverified" }]);
  });
  it("uses exact actual grams and unknown volume when no formula exists", async () => {
    const result = await estimateBillableQuotes(async (r) => { expect(r.weightGrams).toBe(1310); return [row("JT", 9000)]; }, input,
      { ...parcel, actualWeightGrams: 1310 }, [], [{ courier: "JT", service_class: "regular" }]);
    expect(result.rows[0]).toMatchObject({ billable_weight_grams: 1310, volumetric_weight_grams: null, weight_rule_id: null });
  });
  it("supports a verified cargo minimum without enabling other unverified cargo services", async () => {
    const localRules = [rule("iDexpress", { service_class: "cargo", min_weight_grams: 1000 }), rule("Sap", { service_class: "cargo" })];
    const result = await estimateBillableQuotes(async () => [{ ...row("iDexpress", 100), service_class: "cargo", minimum_weight_grams: 1000 }, row("Sap", 200)], input, parcel, localRules,
      localRules.map(({ courier, service_class }) => ({ courier, service_class })));
    expect(result.rows.map((r) => r.courier)).toEqual(["iDexpress"]);
    expect(result.exclusions).toEqual([{ courier: "Sap", reason: "cargo_minimum_unverified" }]);
  });

  it("keeps regular and cargo of the same courier at the same weight separate", async () => {
    const localRules = [rule("JNE"), rule("JNE", { id: "rule-JNE-cargo", service_class: "cargo", min_weight_grams: 10000 })];
    const calls: EstimateRequest[] = [];
    const result = await estimateBillableQuotes(async (r) => {
      calls.push(r);
      return [row("JNE", 110000), { ...row("JNE", 45000), service_class: "cargo", minimum_weight_grams: 10000 }];
    }, input, { actualWeightGrams: 10000 }, localRules, localRules.map(({ courier, service_class }) => ({ courier, service_class })));
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ weightGrams: 10000, includeCargo: true });
    expect(result.rows).toHaveLength(2);
    expect(result.rows.find((r) => r.service_class === "cargo")).toMatchObject({ tariff: 45000, weight_rule_id: "rule-JNE-cargo" });
    expect(result.rows.find((r) => !r.service_class)).toMatchObject({ tariff: 110000, weight_rule_id: "rule-JNE" });
  });

  it("keeps same-courier service identities isolated across different weight groups", async () => {
    const localRules = [rule("JNE", { divisor: 4000 }), rule("JNE", { id: "cargo-JNE", service_class: "cargo", min_weight_grams: 1000 })];
    const result = await estimateBillableQuotes(async (r) => [
      row("JNE", r.weightGrams * 10),
      { ...row("JNE", r.weightGrams * 20), service_class: "cargo", minimum_weight_grams: 1000 },
    ], input, parcel, localRules, localRules.map(({ courier, service_class }) => ({ courier, service_class })));
    expect(result.rows).toHaveLength(2);
    expect(result.rows.find((r) => r.service_class === "cargo")).toMatchObject({ tariff: 40000, billable_weight_grams: 2000, weight_rule_id: "cargo-JNE" });
    expect(result.rows.find((r) => !r.service_class)).toMatchObject({ tariff: 30000, billable_weight_grams: 3000, weight_rule_id: "rule-JNE" });
  });

  it.each([undefined, 5000, 15000])("excludes cargo when the provider route minimum %s does not match the verified rule", async (minimum) => {
    const localRules = [rule("JNE", { service_class: "cargo", min_weight_grams: 10000 })];
    const result = await estimateBillableQuotes(async () => [
      row("JNE", 100000), { ...row("JNE", 45000), service_class: "cargo", minimum_weight_grams: minimum },
    ], input, { actualWeightGrams: 10000 }, localRules, [{ courier: "JNE", service_class: "cargo" }]);
    expect(result.rows).toEqual([]);
  });
});
