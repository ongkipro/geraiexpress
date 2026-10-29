// T-053 / DEC-018 item 1: the gerai-facing cost is a basis, never a charge, and unknown is never Rp0.
import { describe, expect, it } from "vitest";
import { GERAI_COST_LABEL, GERAI_COST_NOTE, GERAI_COST_UNKNOWN, geraiCostText } from "../../src/modules/pricing/display";
import { unresolvedPaymentState } from "../../src/modules/shipments/payment-state";

describe("gerai cost display", () => {
  it("renders a known cost as rupiah and anything unknown as 'belum diketahui', never Rp0", () => {
    expect(geraiCostText(8500).replace(/\s/g, " ")).toMatch(/^Rp\s?8\.500$/);
    expect(geraiCostText(null)).toBe("belum diketahui");
    for (const unknown of [undefined, null, NaN, -1, 12.5, "8500", {}]) {
      expect(geraiCostText(unknown), String(unknown)).toBe(GERAI_COST_UNKNOWN);
    }
    expect(geraiCostText(null)).not.toMatch(/Rp\s?0\b/);
  });

  it("labels the amount as an estimate and explains it is a basis that follows GeraiExpress's assigned discount", () => {
    expect(GERAI_COST_LABEL).toBe("Biaya gerai (estimasi)");
    expect(GERAI_COST_NOTE).toContain("diskon yang ditetapkan GeraiExpress");
    expect(GERAI_COST_NOTE).toContain("bukan tagihan");
    expect(GERAI_COST_NOTE).toContain("tarif akun penjual");
  });
});

describe("unresolved batch payment state", () => {
  it("is reconcile-only for sent and unknown attempts and nothing else", () => {
    expect(unresolvedPaymentState("sent")).toBe("sent");
    expect(unresolvedPaymentState("unknown")).toBe("unknown");
    for (const other of [null, undefined, "claimed", "paid", "rejected", "released", "", 1]) {
      expect(unresolvedPaymentState(other), String(other)).toBeNull();
    }
  });
});
