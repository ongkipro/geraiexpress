// T-084 / PR-46: courier masking-acceptance states and the UX-9 notice wording. Pure (server and client),
// relative imports only.
import { courierName } from "../../lib/format";

export type AcceptanceState = "unverified" | "verified" | "refused";
export type CourierAcceptance = { courier: string | null; state: AcceptanceState };

export const isAcceptanceState = (value: unknown): value is AcceptanceState =>
  value === "unverified" || value === "verified" || value === "refused";

const courierLabel = (courier: string | null) => (courier ? courierName(courier) : "kurir yang belum diketahui");

// The short state shown next to the masking switch (UX-9: "Belum terverifikasi untuk <kurir>").
export function acceptanceShortLabel(entry: CourierAcceptance): string {
  return `${entry.state === "refused" ? "Ditolak kurir" : "Belum terverifikasi"} untuk ${courierLabel(entry.courier)}`;
}

// One sentence per courier that is not `verified`. "Belum terverifikasi untuk <kurir>" is the UX-9 wording.
export function acceptanceNotice(entry: CourierAcceptance): string {
  return entry.state === "refused"
    ? `${acceptanceShortLabel(entry)}: catatan platform menyatakan label masking tidak diterima kurir ini.`
    : `${acceptanceShortLabel(entry)}: belum ada bukti kurir menerima label masking yang dicetak sendiri.`;
}

// Couriers whose masked print needs the acknowledgement, de-duplicated in first-seen order.
export function pendingAcceptance(entries: CourierAcceptance[]): CourierAcceptance[] {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    const key = entry.courier ?? "";
    if (entry.state === "verified" || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// History wording of a print event's acceptance fields (NULL for unmasked prints and older events).
export function acceptanceHistoryLabel(state: AcceptanceState | null, acknowledged: boolean | null): string | null {
  if (state === null) return null;
  if (state === "verified") return "Kurir terverifikasi";
  return acknowledged ? `${state === "refused" ? "Ditolak kurir" : "Belum terverifikasi"}, dikonfirmasi operator` : null;
}
