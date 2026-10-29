// T-043: the "Status slot" line of a pickup shipment. Pure so the precedence is testable: a FINAL
// state (issued, awaiting payment, failed with its result code) always wins over the reservation
// phase, because the phase is never cleared (a refused slot keeps phase 'reserving'). Only a
// non-final shipment reads its phase.

export type PickupPhase = "reserving" | "reserved" | "creating" | null;

// Result codes that mean the provider refused the step it was asked, so that step created nothing
// (mirrors private.definitely_not_created, minus the codes that are conclusions of a re-check).
const REFUSED_BEFORE_RESERVATION = ["PICKUP_SLOT_UNAVAILABLE", "PICKUP_TIME_INVALID", "NOT_ALLOWED", "INPUT_INVALID", "INPUT_INCOMPLETE", "PICKUP_NOT_FOUND", "QUOTE_STALE"];
const ORDER_REFUSED = ["PROVIDER_REJECTED", "NOT_ALLOWED", "INPUT_INVALID"];
// Codes after which the shipment page states that no order exists (the reopen path), whatever the phase.
const NO_ORDER_CREATED = [...REFUSED_BEFORE_RESERVATION, "CLOSED_NOT_CREATED"];

// A time id is stored from 'reserved' on, so Mengantar holds a slot for this shipment.
export const slotHeld = (phase: PickupPhase) => phase === "reserved" || phase === "creating";

// The shared QUOTE_STALE reason says nothing was sent to Mengantar; with a held slot that is false.
export function pickupFailureReason(resultCode: string | null, phase: PickupPhase, shared: string | undefined): string | undefined {
  return resultCode === "QUOTE_STALE" && slotHeld(phase)
    ? "Pesanan terlalu lama di antrean sehingga ongkirnya kedaluwarsa; pesanan tidak dikirim, tetapi slot jemput sudah dipesan di Mengantar."
    : shared;
}

export function pickupReservationText(input: { shipmentState: string; phase: PickupPhase; resultCode: string | null }): string {
  const { shipmentState, phase, resultCode } = input;
  if (shipmentState === "issued" || shipmentState === "awaiting_payment") return "Slot dipesan dan pesanan dibuat.";
  if (shipmentState === "failed") {
    // A time id exists from 'reserved' on: the slot was reserved before the order failed.
    if (slotHeld(phase)) {
      if (ORDER_REFUSED.includes(resultCode ?? "")) {
        return "Slot sudah dipesan di Mengantar, tetapi Mengantar menolak pesanan. Tidak ada pesanan yang dibuat.";
      }
      return NO_ORDER_CREATED.includes(resultCode ?? "")
        ? "Slot sudah dipesan di Mengantar; tidak ada pesanan yang dibuat."
        : "Slot sudah dipesan di Mengantar; pesanan belum terkonfirmasi dibuat.";
    }
    return REFUSED_BEFORE_RESERVATION.includes(resultCode ?? "")
      ? "Slot tidak dipesan."
      : "Slot jemput tidak terkonfirmasi di Mengantar dan tidak ada pesanan yang dibuat.";
  }
  if (phase === "reserving") return "Memesan slot… hasil belum pasti; sistem membaca ulang tanpa memesan lagi.";
  if (phase === "reserved") return "Slot sudah dipesan di Mengantar; pesanan belum dikirim.";
  if (phase === "creating") return "Slot dipesan; hasil pembuatan pesanan belum pasti.";
  return "Slot belum dipesan; dipesan saat pesanan dikirim.";
}
