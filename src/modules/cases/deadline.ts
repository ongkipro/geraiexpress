// T-086 / DATA-15 / UX-20 item 3: the claim filing deadline. Mirrors private.claim_deadline in
// db/migrations/20261105170000_return_claim_cases.sql; the database value is authoritative and this
// copy exists for display (age, 80% warning) and unit tests. Pure: no '@/' imports.
//
// - hours and calendar days are exact (24 h per day; WIB has no daylight saving);
// - working days are counted on the WIB calendar and skip Saturday and Sunday only. No holiday
//   calendar is configured, so public holidays are NOT excluded and the screen must say so;
// - NULL whenever the rule, its anchor event or the anchor instant is unknown (never a default).

export type WindowUnit = "working_days" | "days" | "hours";
export type AnchorEvent = "last_status" | "delivered" | "rts";

export type ClaimRule = {
  id: string;
  courier: string;
  case_type: string | null;
  region: "java_sumatra_bali_ntb" | "other" | null;
  window_value: number;
  window_unit: WindowUnit;
  anchor: AnchorEvent | null;
  region_note: string | null;
  source_url: string;
  source_updated_at: string;
  effective_at: string;
};

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const WIB = 7 * HOUR;

export function claimDeadline(anchorIso: string | null, value: number | null, unit: WindowUnit | null): string | null {
  if (!anchorIso || value == null || !Number.isInteger(value) || value <= 0 || !unit) return null;
  const anchor = Date.parse(anchorIso);
  if (!Number.isFinite(anchor)) return null;
  if (unit === "hours") return new Date(anchor + value * HOUR).toISOString();
  if (unit === "days") return new Date(anchor + value * DAY).toISOString();
  if (unit !== "working_days") return null;
  let local = anchor + WIB;
  let left = value;
  while (left > 0) {
    local += DAY;
    const weekday = new Date(local).getUTCDay();
    if (weekday !== 0 && weekday !== 6) left--;
  }
  return new Date(local - WIB).toISOString();
}

// Whole working days (Mon–Fri on the WIB calendar) from `fromIso` up to `toIso`, not counting the
// start day. Public holidays are not excluded (no calendar configured).
export function workingDaysBetween(fromIso: string, toIso: string): number {
  const from = Date.parse(fromIso), to = Date.parse(toIso);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return 0;
  let count = 0;
  for (let t = from + WIB + DAY; t <= to + WIB; t += DAY) {
    const weekday = new Date(t).getUTCDay();
    if (weekday !== 0 && weekday !== 6) count++;
  }
  return count;
}

export function calendarDaysBetween(fromIso: string, toIso: string): number {
  const from = Date.parse(fromIso), to = Date.parse(toIso);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return 0;
  return Math.floor((to - from) / DAY);
}

export type DeadlineStatus =
  | { kind: "no_rule" }
  | { kind: "no_anchor_event"; rule: ClaimRule }
  | { kind: "no_anchor"; rule: ClaimRule }
  | { kind: "known"; rule: ClaimRule; deadline: string; used: number; warning: boolean; overdue: boolean };

// The 80% warning compares elapsed time with the whole window (anchor to deadline).
export function deadlineStatus(input: { rule: ClaimRule | null; anchorAt: string | null; deadlineAt: string | null; now: Date }): DeadlineStatus {
  const { rule, anchorAt, deadlineAt, now } = input;
  if (!rule) return { kind: "no_rule" };
  if (!rule.anchor) return { kind: "no_anchor_event", rule };
  if (!anchorAt || !deadlineAt) return { kind: "no_anchor", rule };
  const start = Date.parse(anchorAt), end = Date.parse(deadlineAt), at = now.getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return { kind: "no_anchor", rule };
  const used = Math.max(0, (at - start) / (end - start));
  return { kind: "known", rule, deadline: deadlineAt, used, warning: used >= 0.8 && at < end, overdue: at >= end };
}

// The rule that applies to a courier, case type and region: a case-type rule beats a general one,
// the newest version wins. Mirrors private.claim_rule_for. Rules are passed newest-first or any order.
export function ruleFor(rules: ClaimRule[], courier: string | null, caseType: string, region: string | null): ClaimRule | null {
  if (!courier) return null;
  const matching = rules.filter((r) => r.courier === courier && (r.case_type === null || r.case_type === caseType)
    && (r.region === null || r.region === region));
  matching.sort((a, b) => (Number(b.case_type !== null) - Number(a.case_type !== null)) || Date.parse(b.effective_at) - Date.parse(a.effective_at));
  return matching[0] ?? null;
}
