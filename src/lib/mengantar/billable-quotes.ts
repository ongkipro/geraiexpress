import { billableWeight, type BillableWeightRule, type MeasuredParcel, type WeightExclusion } from "../billable-weight";
import { estimateServiceKey, estimateTwoPassCod, type CourierEstimate, type EstimateRequest } from "./public-api";

// Each response contains all couriers at ONE weight. Filter before either COD pass can mix tariffs.
export async function estimateBillableQuotes(
  estimate: (input: EstimateRequest) => Promise<CourierEstimate[]>,
  input: { originAreaId: string; destinationAreaId: string; goodsValueIdr?: number },
  parcel: MeasuredParcel,
  rules: readonly BillableWeightRule[],
  services: readonly { courier: string; service_class: "regular" | "cargo" }[],
) {
  const groups = new Map<number, Map<string, ReturnType<typeof billableWeight>>>();
  const exclusions: { courier: string; reason: WeightExclusion }[] = [];
  for (const service of services) {
    const rule = rules.find((r) => r.courier === service.courier && r.service_class === service.service_class) ?? null;
    // Unknown cargo route minimum cannot be inferred from the published regional range.
    const weight = billableWeight(parcel, rule);
    const reason = service.service_class === "cargo" && rule?.min_weight_grams == null ? "cargo_minimum_unverified" : weight.exclusion;
    if (reason) { exclusions.push({ courier: service.courier, reason }); continue; }
    const group = groups.get(weight.billable_weight_grams) ?? new Map();
    group.set(estimateServiceKey(service), weight);
    groups.set(weight.billable_weight_grams, group);
  }
  const rows = [];
  for (const [weightGrams, couriers] of groups) {
    const filteredEstimate = async (request: EstimateRequest) => (await estimate(request)).filter((e) => {
      const weight = couriers.get(estimateServiceKey(e));
      if (!weight) return false;
      // A dated rule alone cannot stand in for this route's current minimum. Never silently
      // price another minimum or borrow the same courier's regular row for cargo.
      return e.service_class !== "cargo" || e.minimum_weight_grams === rules.find((r) => r.id === weight.weight_rule_id)?.min_weight_grams;
    });
    const includeCargo = services.some((s) => s.service_class === "cargo" && couriers.has(estimateServiceKey(s)));
    const base = { originAreaId: input.originAreaId, destinationAreaId: input.destinationAreaId, weightGrams,
      ...(includeCargo ? { includeCargo: true } : {}) };
    const estimates = input.goodsValueIdr === undefined ? await filteredEstimate(base)
      : await estimateTwoPassCod(filteredEstimate, { ...base, goodsValueIdr: input.goodsValueIdr });
    for (const estimate of estimates) rows.push({ ...estimate, ...couriers.get(estimateServiceKey(estimate))! });
  }
  return { rows, exclusions };
}
