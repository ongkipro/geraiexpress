import { describe, expect, it } from "vitest";
import { parsePaymentRupiah } from "../../src/modules/payments/rupiah";

describe("parsePaymentRupiah", () => {
  it("accepts whole rupiah with optional Rp and Indonesian thousands separators", () => {
    for (const raw of ["12000", "12.000", "Rp 12.000", " 12000 "]) expect(parsePaymentRupiah(raw)).toBe(12000);
    expect(parsePaymentRupiah("0")).toBe(0); // The record action/RPC separately enforce amount > 0.
  });

  it("does not silently turn negative, fractional, malformed or unsafe values into a payment", () => {
    for (const raw of ["", "-12000", "+12000", "12,50", "12.50", "12.000,00", "1e3", "abc12000", "12 000", "9.007.199.254.740.992"]) {
      expect(parsePaymentRupiah(raw)).toBeNull();
    }
  });
});
