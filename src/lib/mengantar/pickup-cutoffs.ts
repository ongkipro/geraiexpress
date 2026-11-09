// T-043 amendment: per-courier same-day pickup cut-offs, as configuration (not constants scattered in code).
//
// Source: the Mengantar help article below, fetched 2026-11-09 (the article's own "updated" date is
// 2026-11-04). It says an order INPUT before the courier's cut-off (WIB) is picked up the same day and
// one input after it is picked up the next day. It does NOT say a later slot is refused, so this table
// drives a warning at intake only; it never blocks a draft or a confirmation.
// Keys are the stored Mengantar courier codes (COURIER_NAME in src/lib/format.ts). A courier that is not
// listed has no known cut-off: no warning, never an invented time.
import { courierName } from "../format";
import { wibDate } from "./pickup";

export type PickupCutoff = {
  hour: number;
  minute: number;
  // The article lists Anteraja as pickup only (no drop-off). Informational here; the drop-off filter
  // is DROP_OFF_UNSUPPORTED in public-api.ts.
  pickupOnly?: true;
};

export const PICKUP_CUTOFF_SOURCE = {
  url: "https://help.mengantar.com/id/articles/5502313-jne-sicepat-sap-idexpress-jandt-lion-parcel-anteraja-pos-ind-dan-spx",
  verifiedOn: "2026-11-09",
} as const;

export const PICKUP_CUTOFFS: Readonly<Record<string, PickupCutoff>> = {
  JNE: { hour: 15, minute: 0 },
  SiCepat: { hour: 12, minute: 0 },
  Sap: { hour: 15, minute: 0 },
  iDexpress: { hour: 11, minute: 0 },
  JT: { hour: 12, minute: 0 },
  lion: { hour: 15, minute: 0 },
  anteraja: { hour: 15, minute: 0, pickupOnly: true },
  pos: { hour: 16, minute: 0 },
  spx: { hour: 15, minute: 0 },
};

const WIB_OFFSET_MS = 7 * 3_600_000;

// "15.00" for a cut-off.
export const cutoffLabel = (c: PickupCutoff) => `${String(c.hour).padStart(2, "0")}.${String(c.minute).padStart(2, "0")}`;

// The warning to show when the chosen pickup is today (WIB) and `now`, the moment the order is being
// entered, is at or after the courier's cut-off; otherwise null (unknown courier, another date, or in time).
export function pickupCutoffWarning(courier: string | null | undefined, pickupDate: string, now: Date): string | null {
  const cutoff = courier && Object.hasOwn(PICKUP_CUTOFFS, courier) ? PICKUP_CUTOFFS[courier] : null;
  if (!cutoff || pickupDate !== wibDate(now)) return null;
  const msOfDay = (now.getTime() + WIB_OFFSET_MS) % 86_400_000;
  if (msOfDay < (cutoff.hour * 60 + cutoff.minute) * 60_000) return null;
  return `Kurir ${courierName(courier!)} menjemput di hari yang sama untuk pesanan yang diinput sebelum ${cutoffLabel(cutoff)} WIB. Pesanan ini kemungkinan dijemput besok.`;
}
