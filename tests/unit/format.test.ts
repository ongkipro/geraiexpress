import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DISPATCH_INFO, courierName, etaLabel } from "../../src/lib/format";
import { friendlyError } from "../../src/lib/errors";

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

describe("Bahasa copy for operator-visible codes (B-copy)", () => {
  it("has copy for the error codes the database and dispatcher raise", () => {
    for (const code of ["authorization_required", "batch_id_unavailable", "account_busy", "invalid_order_request", "provider_observed_mismatch"]) {
      const text = friendlyError({ message: code });
      expect(text, code).not.toBe("Terjadi kesalahan. Coba lagi.");
      expect(text, code).not.toContain(code);
    }
  });

  it("covers every reason the dispatcher can hand to the detail page", () => {
    const source = readFileSync(join(__dirname, "../../src/lib/mengantar/dispatcher.ts"), "utf8");
    const reasons = new Set([...source.matchAll(/(?:reason: |release\()"([a-z_]+)"/g)].map((m) => m[1]));
    for (const code of ["payment_unresolved", "payment_unconfirmed", "payment_count_mismatch", "attempt_not_recorded", "missing_attempt"]) reasons.add(code);
    expect(reasons.size).toBeGreaterThan(10);
    expect(reasons).toContain("pickup_reservation_not_recorded"); // the release() form is scanned too
    for (const reason of reasons) expect(DISPATCH_INFO[reason], reason).toBeTruthy();
  });

  it("keeps the batch-payment wording of attempt_not_recorded: the detail page does not repaint it for pickup", () => {
    const page = readFileSync(join(__dirname, "../../src/app/(workspace)/pengiriman/[id]/page.tsx"), "utf8");
    expect(page).not.toMatch(/\battempt_not_recorded\b/);
    expect(DISPATCH_INFO.attempt_not_recorded).toMatch(/pembayaran/);
    expect(DISPATCH_INFO.pickup_reservation_not_recorded).toMatch(/antrean/);
    expect(DISPATCH_INFO.pickup_create_not_recorded).toMatch(/antrean/);
  });
});
