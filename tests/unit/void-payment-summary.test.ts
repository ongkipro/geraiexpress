import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { VoidPaymentSummary, type VoidPaymentSummaryProps } from "../../src/modules/payments/void-payment-summary";

const payment: VoidPaymentSummaryProps = {
  reference: "GERA-261104-001",
  amountIdr: 12000,
  method: "qris",
  staffLabel: "Petugas",
  isDemo: false,
};
const render = (props: VoidPaymentSummaryProps) => renderToStaticMarkup(createElement(VoidPaymentSummary, props)).replace(/\u00a0/g, " ");

describe("VoidPaymentSummary", () => {
  it("identifies the reference, payment amount, method and collecting staff inside the confirmation", () => {
    const html = render(payment);
    for (const text of [payment.reference, "Rp 12.000", "QRIS", "Petugas penerima", "Petugas"]) expect(html).toContain(text);
    expect(html).not.toContain("contoh");
  });

  it("labels the demo amount as contoh", () => {
    expect(render({ ...payment, isDemo: true })).toContain("Rp 12.000 (contoh)");
  });

  it("preserves recovery context without displaying a rounded unsafe amount", () => {
    const html = render({ ...payment, amountIdr: Number.MAX_SAFE_INTEGER + 1, method: "transfer", isDemo: true });
    for (const text of [payment.reference, "Jumlah tidak dapat ditampilkan dengan tepat", "Hubungi admin GeraiExpress", "Transfer", "Petugas", "contoh"]) {
      expect(html).toContain(text);
    }
    expect(html).not.toMatch(/9[.,]?007|9007199254740992|Rp /);
  });
});
