// T-082 / owner decision 2026-11-05: customer receipts use frozen gerai/outlet identity and payment
// facts, never staff, net cost, discount, remainder or tax; demo amounts say "contoh".
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ReceiptDocument } from "../../src/modules/payments/receipt-document";
import { buildReceipt, receiptAmountsSupported, receiptText, staffFirstName, whatsappNumber, whatsappReceiptLink, type ReceiptInput } from "../../src/modules/payments/receipt";

const base: ReceiptInput = {
  geraiName: "Gerai Uji",
  geraiWhatsapp: "081234567890",
  outletName: "Cabang Utara",
  reference: "GX261104-ABC123",
  awb: "JT0001234567",
  courier: "JT",
  service: "REG",
  customerChargeIdr: 12000,
  isCod: false,
  codAmountIdr: null,
  isDemo: false,
  payment: { id: "a1b2c3d4-1234-4567-89ab-123456789abc", method: "cash", amountIdr: 12000, cashReceivedIdr: 20000, recordedAt: "2026-11-04T03:15:00Z" },
};

const FORBIDDEN = /net|bersih|diskon|discount|potongan|sisa|remainder|platform|pajak|ppn|tax/i;
const plain = (s: string) => s.replace(/\u00a0/g, " ");

describe("receiptText", () => {
  it("lists gerai/outlet, payment number, reference, AWB, courier, charge, method, change and WIB time without staff", () => {
    const text = plain(receiptText(base));
    expect(text).toContain("Gerai Uji\nCabang Cabang Utara");
    expect(text).toContain("No. pembayaran: PAY-A1B2C3D4");
    expect(text).not.toContain(base.payment!.id);
    expect(text).toContain("WhatsApp 081234567890");
    expect(text).toContain("Referensi: GX261104-ABC123");
    expect(text).toContain("Resi: JT0001234567");
    expect(text).toContain("REG");
    expect(text).toContain("Ongkir: Rp 12.000");
    expect(text).toContain("Dibayar: Rp 12.000");
    expect(text).toContain("Cara bayar: Tunai");
    expect(text).toContain("Uang diterima: Rp 20.000");
    expect(text).toContain("Kembalian: Rp 8.000");
    expect(text).not.toMatch(/Petugas|Budi/i);
    expect(text).toMatch(/Waktu: .*10\.15 WIB/);
    expect(text).not.toContain("contoh");
  });

  it("never contains staff, net cost, discount, remainder or tax wording, in any variant", () => {
    const variants: ReceiptInput[] = [
      base,
      { ...base, payment: { ...base.payment!, method: "qris", cashReceivedIdr: null } },
      { ...base, isCod: true, codAmountIdr: 62000, payment: null },
      { ...base, isDemo: true },
    ];
    for (const v of variants) {
      expect(receiptText(v)).not.toMatch(FORBIDDEN);
      // The actual print document is tested, not only a parallel WhatsApp serializer. Extra private
      // properties from an accidentally wider object must never leak into either rendered variant.
      const tainted = { ...v, netCostIdr: 987654321, discount: "PRIVATE_DISCOUNT", remainder: "PRIVATE_REMAINDER",
        payment: v.payment ? { ...v.payment, staffLabel: "PRIVATE_STAFF", recordedBy: "PRIVATE_ACTOR" } : null };
      expect(receiptText(tainted)).not.toMatch(/987654321|PRIVATE_|Petugas/i);
      for (const width of ["58", "80"] as const) {
        const html = renderToStaticMarkup(createElement(ReceiptDocument, { input: tainted, width }));
        expect(html).not.toMatch(FORBIDDEN);
        expect(html).not.toMatch(/987654321|PRIVATE_|Petugas/i);
        if (v.payment) expect(html).toContain("PAY-A1B2C3D4");
        expect(html).toContain("Cabang Cabang Utara");
        expect(html).toContain(`data-width="${width}"`);
      }
      for (const line of buildReceipt(v).lines) expect(line.label).not.toMatch(FORBIDDEN);
    }
  });

  it("omits the outlet header when absent or identical to the gerai, and keeps available WhatsApp", () => {
    for (const outletName of [null, "", "Gerai Uji", " Gerai Uji "]) {
      const input = { ...base, outletName };
      expect(buildReceipt(input).header).toEqual(["Gerai Uji", "WhatsApp 081234567890"]);
      expect(receiptText(input)).not.toContain("Cabang");
    }
    expect(buildReceipt({ ...base, geraiWhatsapp: null }).header).toEqual(["Gerai Uji", "Cabang Cabang Utara"]);
  });

  it("labels every amount 'contoh' in a demo workspace", () => {
    const r = buildReceipt({ ...base, isDemo: true });
    expect(r.title).toBe("STRUK CONTOH");
    const money = r.lines.filter((l) => /Rp/.test(l.value));
    expect(money.length).toBe(4);
    for (const line of money) expect(line.value).toMatch(/\(contoh\)$/);
  });

  it("shows the COD collection instruction and never the shipping charge as counter cash", () => {
    const text = plain(receiptText({ ...base, isCod: true, codAmountIdr: 62000, payment: null }));
    expect(text).toContain("Ongkir: Rp 12.000");
    expect(text).toContain("Pembayaran ongkir: Ditagih kurir (COD)");
    expect(text).toContain("Tagihan COD ke penerima: Rp 62.000");
    expect(text).not.toContain("Cara bayar");
    expect(text).not.toContain("Dibayar");
    expect(text).not.toMatch(/No\. pembayaran|PAY-|Petugas/i);
  });

  it("omits received and change for non-cash methods", () => {
    const text = receiptText({ ...base, payment: { ...base.payment!, method: "transfer", cashReceivedIdr: null } });
    expect(text).toContain("Cara bayar: Transfer");
    expect(text).not.toContain("Kembalian");
    expect(text).not.toContain("Uang diterima");
  });
});

describe("receipt bigint presentation boundary", () => {
  it("supports exact safe whole rupiah and nullable optional amounts", () => {
    expect(receiptAmountsSupported(base)).toBe(true);
    const largest: ReceiptInput = { ...base, customerChargeIdr: Number.MAX_SAFE_INTEGER, payment: {
      ...base.payment!, amountIdr: Number.MAX_SAFE_INTEGER, cashReceivedIdr: Number.MAX_SAFE_INTEGER,
    } };
    expect(receiptAmountsSupported(largest)).toBe(true);
    expect(buildReceipt(largest).lines.find((line) => line.label === "Kembalian")?.value).toMatch(/0/);
    expect(receiptAmountsSupported({ ...base, payment: null, codAmountIdr: null })).toBe(true);
  });

  it("withholds rounded receipt, rendered print and WhatsApp content for unsafe fetched values", () => {
    const unsafe = Number.MAX_SAFE_INTEGER + 1;
    const variants: ReceiptInput[] = [
      { ...base, customerChargeIdr: unsafe },
      { ...base, isCod: true, codAmountIdr: unsafe, payment: null },
      { ...base, payment: { ...base.payment!, amountIdr: unsafe } },
      { ...base, payment: { ...base.payment!, cashReceivedIdr: unsafe } },
    ];
    for (const input of variants) {
      expect(receiptAmountsSupported(input)).toBe(false);
      expect(() => buildReceipt(input)).toThrow(RangeError);
      expect(() => whatsappReceiptLink(null, input)).toThrow(RangeError);
      expect(() => renderToStaticMarkup(createElement(ReceiptDocument, { input, width: "58" }))).toThrow(RangeError);
    }
  });
});

describe("WhatsApp receipt link", () => {
  it("normalizes Indonesian numbers to 62 without the leading 0", () => {
    expect(whatsappNumber("0812-3456-7890")).toBe("6281234567890");
    expect(whatsappNumber("+62 812 3456 7890")).toBe("6281234567890");
    expect(whatsappNumber("12")).toBeNull();
    expect(whatsappNumber(null)).toBeNull();
  });

  it("opens wa.me with the prefilled receipt text", () => {
    const link = whatsappReceiptLink("081298765432", base);
    expect(link.startsWith("https://wa.me/6281298765432?text=")).toBe(true);
    expect(decodeURIComponent(link.split("?text=")[1])).toBe(receiptText(base));
    expect(whatsappReceiptLink("x", base).startsWith("https://wa.me/?text=")).toBe(true);
  });

});

describe("internal staff label (not customer receipt content)", () => {
  it("retains the internal display helper used by void confirmation", () => {
    expect(staffFirstName("siti")).toBe("Siti");
    expect(staffFirstName("Petugas")).toBe("Petugas");
    expect(staffFirstName("")).toBe("Petugas");
  });
});
