// T-043 / PR-5 / TD-12 / UX-10: pickup scheduling rules shared by the draft validation, the
// intake hints and the dispatcher. Pure (no I/O, no clock of its own): the caller passes `now`.
//
// Contract evidence: docs/research/geraiexpress-mengantar-operations-contract.md section 2
// (Observed in the provider documentation, nothing here comes from a sandbox capture):
//  * POST /time takes `address_id`, `date` ("mm-dd-yyyy") and `time` (one of 9:00 ... 18:00);
//  * the pickup schedule must be at least 90 minutes from the current time ("invalid pickup time");
//    the web UI's own wording is 2 hours, which is the stricter default used here (PICKUP_LEAD_MINUTES);
//  * Create Order `pickup.type` is `scheduledPickup` or `dropOff`; `scheduledPickup` needs
//    `pickup.time_id` and `pickup.volume` (volumeTruck | volumeMobil | volumeMotor).
// Unknown (documentation silent): the time zone the date, time and the 90 minutes are measured in
// (WIB is assumed: the counter works in WIB), the slot length (the start hours are hourly; a
// one-hour slot is shown), the farthest date ahead, Sunday handling. Per-courier same-day cut-offs are
// documented by the help centre and live in ./pickup-cutoffs.ts (a warning, not a refusal).

export const PICKUP_FIRST_HOUR = 9;
export const PICKUP_LAST_HOUR = 18;
// The minimum lead time is a setting. This is its default; the database reads the setting
// private.settings 'pickup_min_lead_minutes' and falls back to the same 120 in private.pickup_slot_ok
// (migration 20261109200000). A row there overrides the database check; the application hints and the
// Worker's own re-check keep this default (tests/db/pickup-orders.test.ts keeps the two defaults equal).
export const PICKUP_LEAD_MINUTES = 120;
// Local policy, not a provider rule (the documentation states no maximum): keeps typos out.
export const PICKUP_MAX_DAYS_AHEAD = 14;

export const PICKUP_VOLUMES = ["volumeMotor", "volumeMobil", "volumeTruck"] as const;
export type PickupVolume = (typeof PICKUP_VOLUMES)[number];
export const DEFAULT_PICKUP_VOLUME: PickupVolume = "volumeMotor";

export const HANDOVERS = ["dropoff", "pickup"] as const;
export type Handover = (typeof HANDOVERS)[number];

// The start hours the documentation lists for POST /time.
export const PICKUP_SLOT_HOURS: readonly number[] = Array.from({ length: PICKUP_LAST_HOUR - PICKUP_FIRST_HOUR + 1 }, (_, i) => PICKUP_FIRST_HOUR + i);

const WIB_OFFSET_MS = 7 * 3_600_000; // Indonesia has no daylight saving; WIB is a fixed UTC+7.
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isPickupVolume(value: string): value is PickupVolume {
  return (PICKUP_VOLUMES as readonly string[]).includes(value);
}

// "YYYY-MM-DD" for a real calendar date, else null.
function parseDate(date: string): { y: number; m: number; d: number } | null {
  const match = DATE.exec(date);
  if (!match) return null;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const probe = new Date(Date.UTC(y, m - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d ? { y, m, d } : null;
}

// The calendar date in WIB of an instant, as YYYY-MM-DD.
export function wibDate(instant: Date): string {
  return new Date(instant.getTime() + WIB_OFFSET_MS).toISOString().slice(0, 10);
}

// The instant a slot starts, as epoch milliseconds, or null for an invalid date or hour.
export function slotStartMs(date: string, hour: number): number | null {
  const parts = parseDate(date);
  if (!parts || !Number.isInteger(hour) || hour < 0 || hour > 23) return null;
  return Date.UTC(parts.y, parts.m - 1, parts.d, hour) - WIB_OFFSET_MS;
}

export type PickupSlotError = "date_invalid" | "slot_invalid" | "too_soon" | "too_far";

// Why a date and start hour cannot be reserved at `now`, or null when they can. Mirrors the
// database check (private.pickup_slot_ok) for the lead time; the database is the authority.
export function pickupSlotError(date: string, hour: number, now: Date): PickupSlotError | null {
  if (!parseDate(date)) return "date_invalid";
  if (!PICKUP_SLOT_HOURS.includes(hour)) return "slot_invalid";
  const start = slotStartMs(date, hour)!;
  if (start < now.getTime() + PICKUP_LEAD_MINUTES * 60_000) return "too_soon";
  // The last offered date is `PICKUP_MAX_DAYS_AHEAD` days after today (WIB).
  const last = slotStartMs(wibDate(new Date(now.getTime() + PICKUP_MAX_DAYS_AHEAD * 86_400_000)), 23)!;
  return start > last ? "too_far" : null;
}

// The dates offered at `now`: today (WIB) and the following days, oldest first.
export function pickupDates(now: Date): string[] {
  return Array.from({ length: PICKUP_MAX_DAYS_AHEAD + 1 }, (_, i) => wibDate(new Date(now.getTime() + i * 86_400_000)));
}

// Request fields of POST /time, in the documented formats ("mm-dd-yyyy", "9:00" ... "18:00").
export function providerTimeFields(date: string, hour: number): { date: string; time: string } | null {
  const parts = parseDate(date);
  if (!parts || !PICKUP_SLOT_HOURS.includes(hour)) return null;
  return { date: `${String(parts.m).padStart(2, "0")}-${String(parts.d).padStart(2, "0")}-${parts.y}`, time: `${hour}:00` };
}

// "09.00–10.00 WIB": the end is the start plus the one hour the hourly start times imply.
export function slotLabel(hour: number): string {
  const pad = (h: number) => `${String(h).padStart(2, "0")}.00`;
  return `${pad(hour)}–${pad(hour + 1)} WIB`;
}

const DAYS = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
const MONTHS = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];

// "Rabu, 28 Oktober 2026" for a YYYY-MM-DD calendar date.
export function dateLabel(date: string): string {
  const parts = parseDate(date);
  if (!parts) return date;
  const weekday = new Date(Date.UTC(parts.y, parts.m - 1, parts.d)).getUTCDay();
  return `${DAYS[weekday]}, ${parts.d} ${MONTHS[parts.m - 1]} ${parts.y}`;
}

export const VOLUME_LABEL: Record<PickupVolume, string> = {
  volumeMotor: "Motor",
  volumeMobil: "Mobil",
  volumeTruck: "Truk",
};

// Bahasa field-error text for the draft validation and the confirmation check.
export const PICKUP_ERROR_TEXT: Record<PickupSlotError, string> = {
  date_invalid: "Pilih tanggal jemput.",
  slot_invalid: "Pilih jam jemput antara 09.00 dan 18.00 WIB.",
  too_soon: `Jam jemput harus minimal ${PICKUP_LEAD_MINUTES} menit dari sekarang (WIB). Pilih jam yang lebih lambat.`,
  too_far: `Tanggal jemput maksimal ${PICKUP_MAX_DAYS_AHEAD} hari ke depan.`,
};
