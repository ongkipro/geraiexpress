import { describe, expect, it } from "vitest";
import { courierName, etaLabel } from "../../src/lib/format";

describe("courier display (T-023)", () => {
  it("shows Mengantar courier codes as names counter staff know", () => {
    expect(courierName("JT")).toBe("J&T Express");
    expect(courierName("spx")).toBe("SPX Express");
    expect(courierName("Sap")).toBe("SAP Express");
    expect(courierName("Kurir Simulasi")).toBe("Kurir Simulasi");
  });

  it("normalizes Mengantar delivery estimates to Indonesian day ranges", () => {
    expect(etaLabel("1 - 2 days")).toBe("1–2 hari");
    expect(etaLabel("2 - 1 days")).toBe("1–2 hari"); // provider sometimes sends the range reversed
    expect(etaLabel("1 - 2 Days")).toBe("1–2 hari");
    expect(etaLabel("1-2 Day")).toBe("1–2 hari");
    expect(etaLabel("4 HARI")).toBe("4 hari");
    expect(etaLabel("2 - 4 Hari")).toBe("2–4 hari");
    expect(etaLabel("—")).toBe("—");
    expect(etaLabel("2–3 hari")).toBe("2–3 hari");
    expect(etaLabel("")).toBe("—");
  });
});
