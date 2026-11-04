import { describe, expect, it } from "vitest";
import { isPresentableRupiah } from "../../src/modules/payments/money";

describe("isPresentableRupiah", () => {
  it("accepts exact nonnegative whole rupiah through MAX_SAFE_INTEGER", () => {
    for (const value of [0, 12000, Number.MAX_SAFE_INTEGER]) expect(isPresentableRupiah(value)).toBe(true);
  });
  it("preserves null only where the source contract allows it", () => {
    expect(isPresentableRupiah(null)).toBe(false);
    expect(isPresentableRupiah(null, true)).toBe(true);
    expect(isPresentableRupiah(undefined, true)).toBe(false);
  });
  it("refuses unsafe, non-whole or nonnumeric JSON values rather than rounding them", () => {
    for (const value of [Number.MAX_SAFE_INTEGER + 1, -1, 1.5, NaN, Infinity, "12000"]) {
      expect(isPresentableRupiah(value)).toBe(false);
    }
  });
});
