// Dashboard (UX-16) aggregation as pure functions: every figure comes from the gerai's own shipment rows
// (read through row-level security by the caller) and every day is a WIB calendar day (UTC+7, no DST).
// No private cost, discount or COD amount enters here: the only money is the customer charge
// ("ongkir pelanggan") of issued shipments, and COD is a count.

import { courierName } from "../../lib/format";

export const PERIOD_OPTIONS = [7, 14, 30] as const;
export type PeriodDays = (typeof PERIOD_OPTIONS)[number];
export const DEFAULT_PERIOD: PeriodDays = 14;

// The Dashboard lives at "/"; the default period is the bare path, the others keep `?hari=` in the URL.
export const periodHref = (days: PeriodDays) => (days === DEFAULT_PERIOD ? "/" : `/?hari=${days}`);
// At most this many rows are counted per period; a larger period is shown with a "terbatas" note.
export const ROW_BOUND = 5000;

const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

// `?hari=7|14|30`; anything else (missing, repeated, 13, "abc") is the default period.
export function parsePeriod(raw: string | string[] | undefined): PeriodDays {
  const n = typeof raw === "string" ? Number(raw) : Number.NaN;
  return (PERIOD_OPTIONS as readonly number[]).includes(n) ? (n as PeriodDays) : DEFAULT_PERIOD;
}

// The WIB calendar day (yyyy-mm-dd) of an instant.
export function wibDay(instant: Date | string): string {
  const t = typeof instant === "string" ? Date.parse(instant) : instant.getTime();
  return new Date(t + WIB_OFFSET_MS).toISOString().slice(0, 10);
}

export function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

export type PeriodWindow = {
  days: string[]; // oldest first, the last one is today
  today: string;
  yesterday: string;
  gte: string; // 00:00 WIB of the first day
  lt: string; // 00:00 WIB of the day after today
};

// The last `length` WIB days up to and including today, as the half-open instant range the database filters on.
export function periodWindow(now: Date, length: PeriodDays): PeriodWindow {
  const today = wibDay(now);
  const days = Array.from({ length }, (_, i) => addDays(today, i - length + 1));
  return { days, today, yesterday: addDays(today, -1), gte: `${days[0]}T00:00:00+07:00`, lt: `${addDays(today, 1)}T00:00:00+07:00` };
}

export type PeriodRow = {
  created_at: string;
  submission_state: string;
  customer_charge_idr: number | null;
  is_cod: boolean;
  courier: string | null; // from the selected quote; null while no quote is chosen
};

export type DayBar = { day: string; issued: number; other: number; total: number };
export type Share = { count: number; share: number };
export type StatusShare = Share & { state: string };
export type CourierShare = Share & { code: string | null; name: string };

export type DashboardSummary = {
  periodDays: PeriodDays;
  sample: boolean; // a demo workspace: every figure is labelled "contoh"
  limited: boolean; // more than ROW_BOUND rows in the period: only the newest ROW_BOUND are counted
  window: PeriodWindow;
  daily: DayBar[];
  total: number;
  issued: number;
  peak: DayBar | null; // the busiest day; null when the period is empty
  today: { created: number; issued: number };
  yesterday: { created: number; issued: number };
  delta: { created: number; issued: number };
  statuses: StatusShare[];
  couriers: CourierShare[];
  chargeIdr: number; // sum of the customer charge of issued shipments ("ongkir pelanggan")
  codIssued: number; // issued shipments with COD, a count only
};

// Composition order: the outcome first, then what still needs someone, then work not yet sent.
export const STATUS_ORDER = ["issued", "awaiting_payment", "in_flight", "queued", "unknown", "failed", "estimated", "draft"] as const;
export const NO_COURIER = "Belum pilih kurir";

// Whole-number percentages that always sum to 100 for a non-empty total (largest remainder; ties go
// to the earlier entry). An empty total gives zeros.
export function sharesOf(counts: number[]): number[] {
  const total = counts.reduce((a, b) => a + b, 0);
  if (total === 0) return counts.map(() => 0);
  const exact = counts.map((c) => (c * 100) / total);
  const floors = exact.map(Math.floor);
  let left = 100 - floors.reduce((a, b) => a + b, 0);
  const order = exact.map((e, i) => ({ i, r: e - floors[i] })).sort((a, b) => b.r - a.r || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    floors[i] += 1;
    left -= 1;
  }
  return floors;
}

// A signed change for the stat strip: "+3", "−2" (minus sign), "0".
export function signed(n: number): string {
  if (n > 0) return `+${n.toLocaleString("id-ID")}`;
  if (n < 0) return `−${Math.abs(n).toLocaleString("id-ID")}`;
  return "0";
}

// `rows` are the period's rows newest first, as read (up to ROW_BOUND + 1 to detect the bound).
export function summarize(rows: PeriodRow[], opts: { now: Date; periodDays: PeriodDays; sample: boolean }): DashboardSummary {
  const window = periodWindow(opts.now, opts.periodDays);
  const limited = rows.length > ROW_BOUND;
  const byDay = new Map(window.days.map((day) => [day, { day, issued: 0, other: 0, total: 0 }]));
  const statusCounts = new Map<string, number>();
  const courierCounts = new Map<string | null, number>();
  let chargeIdr = 0;
  let codIssued = 0;
  let total = 0;

  for (const row of rows.slice(0, ROW_BOUND)) {
    const bar = byDay.get(wibDay(row.created_at));
    if (!bar) continue; // outside the window (clock skew or a stale read): never counted
    const issued = row.submission_state === "issued";
    bar.total += 1;
    if (issued) bar.issued += 1;
    else bar.other += 1;
    total += 1;
    statusCounts.set(row.submission_state, (statusCounts.get(row.submission_state) ?? 0) + 1);
    courierCounts.set(row.courier, (courierCounts.get(row.courier) ?? 0) + 1);
    if (issued) {
      chargeIdr += row.customer_charge_idr ?? 0;
      if (row.is_cod) codIssued += 1;
    }
  }

  const daily = [...byDay.values()];
  const issued = daily.reduce((a, d) => a + d.issued, 0);
  const peak = total === 0 ? null : daily.reduce((best, d) => (d.total > best.total ? d : best));
  const pick = (day: string) => {
    const d = byDay.get(day)!;
    return { created: d.total, issued: d.issued };
  };
  const today = pick(window.today);
  const yesterday = pick(window.yesterday);

  const known = new Set<string>(STATUS_ORDER);
  const states = [...STATUS_ORDER.filter((s) => statusCounts.has(s)), ...[...statusCounts.keys()].filter((s) => !known.has(s)).sort()];
  const statusShares = sharesOf(states.map((s) => statusCounts.get(s)!));
  const statuses = states.map((state, i) => ({ state, count: statusCounts.get(state)!, share: statusShares[i] }));

  const couriersRaw = [...courierCounts.entries()]
    .map(([code, count]) => ({ code, count, name: code === null ? NO_COURIER : courierName(code) }))
    // The busiest first; "no courier yet" is not a courier, so it always closes the ranking.
    .sort((a, b) => Number(a.code === null) - Number(b.code === null) || b.count - a.count || a.name.localeCompare(b.name, "id"));
  const courierShares = sharesOf(couriersRaw.map((c) => c.count));
  const couriers = couriersRaw.map((c, i) => ({ ...c, share: courierShares[i] }));

  return {
    periodDays: opts.periodDays,
    sample: opts.sample,
    limited,
    window,
    daily,
    total,
    issued,
    peak,
    today,
    yesterday,
    delta: { created: today.created - yesterday.created, issued: today.issued - yesterday.issued },
    statuses,
    couriers,
    chargeIdr,
    codIssued,
  };
}
