// PR-43 / DATA-14: provider facts are supplied as dated configuration, never defaults here.
export type BillableWeightRule = {
  id: string;
  courier: string;
  service_class: "regular" | "cargo";
  divisor: number | null;
  tolerance_grams: number | null;
  max_weight_grams: number | null;
  min_weight_grams: number | null;
  cargo_minimum_range_grams: number[] | null; // Evidence only: not a route-specific constraint.
  source_url: string;
  source_updated_at: string;
  effective_at: string;
};
export type MeasuredParcel = {
  actualWeightGrams: number;
  lengthCm?: number | null;
  widthCm?: number | null;
  heightCm?: number | null;
};
export type WeightExclusion = "max_weight_exceeded" | "min_weight_not_met" | "cargo_minimum_unverified";
export type BillableWeight = {
  actual_weight_grams: number;
  volumetric_weight_grams: number | null;
  billable_weight_grams: number;
  weight_rule_id: string | null;
  exclusion: WeightExclusion | null;
};

export function billableWeight(parcel: MeasuredParcel, rule: BillableWeightRule | null): BillableWeight {
  if (!Number.isSafeInteger(parcel.actualWeightGrams) || parcel.actualWeightGrams < 1 || parcel.actualWeightGrams > 50000) {
    throw new Error("invalid_measured_weight");
  }
  const sides = [parcel.lengthCm, parcel.widthCm, parcel.heightCm];
  if (sides.some((s) => s != null && (!Number.isSafeInteger(s) || s < 1 || s > 200))) throw new Error("invalid_dimensions");
  if (rule && ((rule.divisor !== null && (!Number.isSafeInteger(rule.divisor) || rule.divisor <= 0))
    || (rule.tolerance_grams !== null && (!Number.isSafeInteger(rule.tolerance_grams) || rule.tolerance_grams < 0 || rule.tolerance_grams >= 1000)))) {
    throw new Error("invalid_weight_rule");
  }
  // DATA-14 explicitly keeps actual weight unchanged when a dimension or verified formula is absent.
  const complete = sides.every((s) => s != null) && rule?.divisor != null && rule.tolerance_grams != null;
  // No sourced provider-wide sub-kg minimum: preserve positive weight at the API's integer-gram
  // precision below 1kg; the provider estimate, not this function, determines fractional tariffs.
  const round = (grams: number) => grams < 1000 ? Math.ceil(grams)
    : (Math.floor(grams / 1000) + (grams % 1000 > rule!.tolerance_grams! ? 1 : 0)) * 1000;
  const rawVolume = complete ? parcel.lengthCm! * parcel.widthCm! * parcel.heightCm! * 1000 / rule!.divisor! : null;
  const billable = rawVolume === null ? parcel.actualWeightGrams : round(Math.max(parcel.actualWeightGrams, rawVolume));
  const exclusion = rule?.service_class === "cargo" && rule.min_weight_grams === null ? "cargo_minimum_unverified"
    : rule?.max_weight_grams != null && billable > rule.max_weight_grams ? "max_weight_exceeded"
    : rule?.min_weight_grams != null && billable < rule.min_weight_grams ? "min_weight_not_met" : null;
  return {
    actual_weight_grams: parcel.actualWeightGrams,
    volumetric_weight_grams: rawVolume === null ? null : round(rawVolume),
    billable_weight_grams: billable,
    weight_rule_id: rule?.id ?? null,
    exclusion,
  };
}

export function weightExclusionText(courier: string, reason: WeightExclusion): string {
  const text = {
    max_weight_exceeded: "berat ditagih melebihi batas kurir. Pilih layanan lain atau ubah paket.",
    min_weight_not_met: "berat ditagih belum memenuhi minimum layanan. Pilih layanan lain.",
    cargo_minimum_unverified: "minimum kargo untuk rute ini belum terverifikasi. Hubungi admin untuk verifikasi atau pilih layanan reguler.",
  };
  return `${courier}: ${text[reason]}`;
}

// F9 (T-089): one sentence per intake, naming exactly the cargo services below their sourced minimum.
// "Semua layanan Kargo" only when every cargo service with a verified minimum is below it; otherwise the
// excluded subset is named, so an eligible cargo service is never described as unavailable.
export function cargoMinimumSummary(results: readonly { courier: string; minimumGrams: number; belowMinimum: boolean }[]): string | null {
  const below = results.filter((r) => r.belowMinimum);
  if (below.length === 0) return null;
  const kg = (g: number) => `${(g / 1000).toLocaleString("id-ID")} kg`;
  if (below.length === results.length) {
    return `Layanan Kargo belum tersedia: berat ditagih di bawah minimum kargo (minimum terendah ${kg(Math.min(...below.map((r) => r.minimumGrams)))}).`;
  }
  return `${below.map((r) => `${r.courier} Kargo`).join(", ")} belum tersedia: berat ditagih di bawah minimum (${below.map((r) => kg(r.minimumGrams)).join(", ")}).`;
}
