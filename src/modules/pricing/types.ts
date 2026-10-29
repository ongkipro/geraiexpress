// Row shapes of the Super Admin discount read models (platform_discount_* functions). Observed and
// remainder values exist only in these platform-only projections; tenants never receive them.
export type DiscountOverviewRow = {
  tenant_id: string;
  tenant_name: string;
  lifecycle: string;
  version: number | null;
  gerai_discount_bps: number | null;
  status: string | null;
  effective_from: string | null;
  source_reference: string | null;
  set_at: string | null;
  set_by_email: string | null;
  unverified: boolean | null;
  has_pending: boolean;
  // Highest observed discount among the couriers of the tenant's latest estimate batch (the
  // assignment ceiling); null = nothing observed.
  observed_bps: number | null;
  observed_at: string | null;
  // Derived estimate: highest observed minus the assigned value in force; null when either is unknown.
  remainder_bps: number | null;
  observed_by_courier: { courier: string; observed_bps: number }[] | null;
  remainder_is_estimate: boolean;
};

export type DiscountHistoryRow = {
  version: number;
  gerai_discount_bps: number;
  status: string;
  effective_from: string;
  source_reference: string;
  verification_reference: string | null;
  unverified: boolean | null;
  created_at: string;
  created_by_email: string | null;
  is_current: boolean;
};

export type DiscountObservation = { courier: string; observed_bps: number; observed_at: string };

// Calendar day in Asia/Jakarta as YYYY-MM-DD: the first day a new version may take effect.
export const jakartaToday = (): string => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Jakarta" }).format(new Date());
