import { CARGO_ORDER_COURIERS, DROP_OFF_UNSUPPORTED, OFFERED_COURIERS } from "../../lib/mengantar/public-api";

// Anteraja refuses drop-off orders (T-020) but is offered for pickup; the tariff itself does not
// depend on the handover (documentation: no pickup surcharge), so nothing else changes. Pure, so a
// test can prove the filter without a server (a "use server" module can only export actions).
export function couriersForHandover<T extends { courier: string }>(estimates: readonly T[], handover: unknown): T[] {
  return estimates.filter((e) => handover === "pickup" || !DROP_OFF_UNSUPPORTED.has(e.courier));
}

// Regular services always; non-COD cargo (base courier + orders[].cargo) only for couriers whose cargo
// order contract is documented. Cargo COD stays off: its provider fee semantics are unverified.
export function quoteServices(isCod: boolean) {
  return [
    ...[...OFFERED_COURIERS].map((courier) => ({ courier, service_class: "regular" as const })),
    ...(isCod ? [] : CARGO_ORDER_COURIERS.map((courier) => ({ courier, service_class: "cargo" as const }))),
  ];
}
