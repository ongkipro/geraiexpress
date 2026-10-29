import { DROP_OFF_UNSUPPORTED } from "../../lib/mengantar/public-api";

// Anteraja refuses drop-off orders (T-020) but is offered for pickup; the tariff itself does not
// depend on the handover (documentation: no pickup surcharge), so nothing else changes. Pure, so a
// test can prove the filter without a server (a "use server" module can only export actions).
export function couriersForHandover<T extends { courier: string }>(estimates: readonly T[], handover: unknown): T[] {
  return estimates.filter((e) => handover === "pickup" || !DROP_OFF_UNSUPPORTED.has(e.courier));
}
