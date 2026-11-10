import { describe, expect, it } from "vitest";
import { couriersForHandover } from "../../src/modules/shipments/handover";
import { pickupFailureReason, pickupReservationText } from "../../src/modules/shipments/pickup-status";

describe("couriersForHandover (T-043: AnterAja is offered for pickup only)", () => {
  const estimates = [{ courier: "jne" }, { courier: "anteraja" }, { courier: "jt" }];

  it("drops AnterAja for a drop-off shipment (and for an unset or unknown handover)", () => {
    for (const handover of ["dropoff", "", undefined, null, "other"]) {
      expect(couriersForHandover(estimates, handover).map((e) => e.courier), String(handover)).toEqual(["jne", "jt"]);
    }
  });

  it("keeps every courier, AnterAja included, for a pickup shipment", () => {
    expect(couriersForHandover(estimates, "pickup").map((e) => e.courier)).toEqual(["jne", "anteraja", "jt"]);
  });
});

describe("pickupReservationText (a final state wins over the never-cleared phase)", () => {
  const text = (shipmentState: string, phase: "reserving" | "reserved" | "creating" | null, resultCode: string | null = null) =>
    pickupReservationText({ shipmentState, phase, resultCode });

  it("a refused slot keeps phase 'reserving' but reads 'not reserved', never 'result unknown'", () => {
    for (const code of ["PICKUP_SLOT_UNAVAILABLE", "PICKUP_TIME_INVALID", "NOT_ALLOWED"]) {
      expect(text("failed", "reserving", code), code).toBe("Slot tidak dipesan.");
    }
    expect(text("failed", null, "PICKUP_NOT_FOUND")).toBe("Slot tidak dipesan.");
  });

  it("a refused order after a recorded reservation says the slot was reserved and the order refused", () => {
    expect(text("failed", "creating", "PROVIDER_REJECTED")).toMatch(/Slot sudah dipesan.*menolak pesanan.*Tidak ada pesanan yang dibuat/);
    expect(text("failed", "creating", "PROVIDER_REJECTED")).not.toMatch(/belum pasti/);
    expect(text("failed", "creating", "NOT_CREATED")).toMatch(/pesanan belum terkonfirmasi dibuat/);
  });

  it("a re-check that found no slot is not claimed as a refusal", () => {
    expect(text("failed", "reserving", "NOT_CREATED")).toMatch(/tidak terkonfirmasi/);
    expect(text("failed", "reserving", "CLOSED_NOT_CREATED")).toMatch(/tidak terkonfirmasi/);
  });

  it("issued and awaiting-payment shipments read reserved and created whatever the phase says", () => {
    for (const state of ["issued", "awaiting_payment"]) {
      for (const phase of ["reserving", "reserved", "creating", null] as const) {
        expect(text(state, phase), `${state}/${phase}`).toBe("Slot dipesan dan pesanan dibuat.");
      }
    }
  });

  it("only a non-final shipment reads its phase", () => {
    expect(text("unknown", "reserving")).toMatch(/Memesan slot… hasil belum pasti/);
    expect(text("queued", "reserved")).toMatch(/pesanan belum dikirim/);
    expect(text("unknown", "creating")).toMatch(/hasil pembuatan pesanan belum pasti/);
    expect(text("queued", null)).toMatch(/Slot belum dipesan/);
  });
});

describe("pickup failure copy over every phase and reopenable code (T-056 final review)", () => {
  const phases = ["reserving", "reserved", "creating", null] as const;
  // The codes the shipment page offers a reopen for: it states that no order was created beside the status line.
  const reopenable = ["PROVIDER_REJECTED", "NOT_ALLOWED", "INPUT_INVALID", "INPUT_INCOMPLETE", "PICKUP_NOT_FOUND", "QUOTE_STALE", "CLOSED_NOT_CREATED", "PICKUP_TIME_INVALID", "PICKUP_SLOT_UNAVAILABLE"];

  it("never reads 'order not confirmed created' beside the page's 'no order was created'", () => {
    for (const phase of phases) {
      for (const code of reopenable) {
        const line = pickupReservationText({ shipmentState: "failed", phase, resultCode: code });
        expect(line, `${phase}/${code}`).not.toMatch(/belum terkonfirmasi dibuat/);
      }
    }
  });

  it("says the slot is held whenever a time id is stored, and not reserved otherwise", () => {
    for (const code of reopenable) {
      for (const phase of ["reserved", "creating"] as const) {
        expect(pickupReservationText({ shipmentState: "failed", phase, resultCode: code }), `${phase}/${code}`).toMatch(/^Slot sudah dipesan di Mengantar/);
      }
    }
    for (const code of ["PICKUP_SLOT_UNAVAILABLE", "PICKUP_TIME_INVALID", "PICKUP_NOT_FOUND", "QUOTE_STALE"]) {
      expect(pickupReservationText({ shipmentState: "failed", phase: "reserving", resultCode: code }), code).toBe("Slot tidak dipesan.");
    }
  });

  it("QUOTE_STALE no longer claims nothing was sent while a reserved slot is held", () => {
    const shared = "tidak ada yang dikirim ke Mengantar.";
    for (const phase of ["reserved", "creating"] as const) {
      const reason = pickupFailureReason("QUOTE_STALE", phase, shared);
      expect(reason, phase).toMatch(/jadwal pickup sudah dipesan/);
      expect(reason, phase).not.toMatch(/tidak ada yang dikirim/);
    }
    for (const phase of ["reserving", null] as const) expect(pickupFailureReason("QUOTE_STALE", phase, shared), String(phase)).toBe(shared);
    expect(pickupFailureReason("PICKUP_TIME_INVALID", "reserved", "x")).toBe("x");
  });
});

describe("quoteServices (T-080: non-COD cargo)", () => {
  it("adds cargo for the four documented couriers only when the shipment is not COD", async () => {
    const { quoteServices } = await import("../../src/modules/shipments/handover");
    const cargo = (cod: boolean) => quoteServices(cod).filter((s) => s.service_class === "cargo").map((s) => s.courier).sort();
    expect(cargo(false)).toEqual(["JNE", "Sap", "SiCepat", "iDexpress"]);
    expect(cargo(true)).toEqual([]);
    expect(quoteServices(true).every((s) => s.service_class === "regular")).toBe(true);
    expect(quoteServices(false).filter((s) => s.service_class === "regular")).toEqual(quoteServices(true));
  });
});
