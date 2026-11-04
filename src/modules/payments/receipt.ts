// T-082 / DEC-026: customer receipts use confirmed shipment facts and payment-time gerai identity,
// or COD first-print identity (current tenant preview until then). No staff, net cost, gerai discount
// or platform remainder enters this input type or its rendered output (DEC-003/DEC-016).
// No tax line (DEC-023 gate).
import { courierName, formatIdr, formatWib } from "../../lib/format";
import { PAYMENT_METHOD_LABEL, type PaymentMethod } from "./messages";
import { isPresentableRupiah, UNSUPPORTED_PAYMENT_AMOUNT } from "./money";

export type ReceiptInput = {
  geraiName: string;
  geraiWhatsapp: string | null;
  outletName: string | null;
  reference: string;
  awb: string | null;
  courier: string | null;
  service: string | null;
  customerChargeIdr: number;
  isCod: boolean;
  codAmountIdr: number | null;
  // Demo workspaces label every amount "contoh" (UX-17 item 7).
  isDemo: boolean;
  payment: {
    id: string;
    method: PaymentMethod;
    amountIdr: number;
    cashReceivedIdr: number | null;
    recordedAt: string;
  } | null;
};

export type ReceiptLine = { label: string; value: string };

export type Receipt = {
  title: string;
  header: string[];
  lines: ReceiptLine[];
  notes: string[];
};

// "Rp12.000 (contoh)" in demo workspaces.
export function receiptAmount(value: number | null, isDemo: boolean): string {
  if (!isPresentableRupiah(value, true)) throw new RangeError(UNSUPPORTED_PAYMENT_AMOUNT);
  const text = formatIdr(value);
  return isDemo && value != null ? `${text} (contoh)` : text;
}

// Internal member/void presentation only. Customer receipts omit staff because no real name field
// exists (owner decision 2026-11-05); never infer a person's name from their email.
export function staffFirstName(label: string): string {
  const first = label.trim().split(/[\s._-]+/)[0] ?? "";
  return first ? first.charAt(0).toUpperCase() + first.slice(1) : "Petugas";
}

export function receiptAmountsSupported(input: ReceiptInput): boolean {
  return isPresentableRupiah(input.customerChargeIdr) && isPresentableRupiah(input.codAmountIdr, true)
    && (!input.payment || (isPresentableRupiah(input.payment.amountIdr) && isPresentableRupiah(input.payment.cashReceivedIdr, true)));
}

export function buildReceipt(input: ReceiptInput): Receipt {
  if (!receiptAmountsSupported(input)) throw new RangeError(UNSUPPORTED_PAYMENT_AMOUNT);
  const header = [input.geraiName];
  const outlet = input.outletName?.trim();
  if (outlet && outlet !== input.geraiName.trim()) header.push(`Outlet ${outlet}`);
  if (input.geraiWhatsapp) header.push(`WhatsApp ${input.geraiWhatsapp}`);
  const lines: ReceiptLine[] = [
    { label: "Referensi", value: input.reference },
    { label: "AWB", value: input.awb ?? "Belum terbit" },
    {
      label: "Kurir",
      value: input.courier ? [courierName(input.courier), input.service].filter(Boolean).join(" ") : "—",
    },
  ];
  const notes: string[] = [];
  if (input.isCod) {
    lines.push({ label: "Ongkir", value: receiptAmount(input.customerChargeIdr, input.isDemo) });
    lines.push({ label: "Pembayaran ongkir", value: "Ditagih kurir (COD)" });
    lines.push({ label: "Tagihan COD ke penerima", value: receiptAmount(input.codAmountIdr, input.isDemo) });
    notes.push("COD: kurir menagih ongkir dan nilai barang ke penerima saat paket diantar.");
  } else {
    lines.push({ label: "Ongkir", value: receiptAmount(input.customerChargeIdr, input.isDemo) });
  }
  if (input.payment && !input.isCod) {
    const p = input.payment;
    lines.push({ label: "No. pembayaran", value: `PAY-${p.id.replaceAll("-", "").slice(0, 8).toUpperCase()}` });
    lines.push({ label: "Dibayar", value: receiptAmount(p.amountIdr, input.isDemo) });
    lines.push({ label: "Cara bayar", value: PAYMENT_METHOD_LABEL[p.method] });
    if (p.method === "cash" && p.cashReceivedIdr != null) {
      lines.push({ label: "Uang diterima", value: receiptAmount(p.cashReceivedIdr, input.isDemo) });
      lines.push({ label: "Kembalian", value: receiptAmount(p.cashReceivedIdr - p.amountIdr, input.isDemo) });
    }
    lines.push({ label: "Waktu", value: formatWib(p.recordedAt) });
  }
  if (input.isDemo) notes.push("Struk contoh dari mode demo, bukan bukti pembayaran.");
  return { title: input.isDemo ? "STRUK CONTOH" : "STRUK PENGIRIMAN", header, lines, notes };
}

// Plain-text receipt for the WhatsApp message.
export function receiptText(input: ReceiptInput): string {
  const r = buildReceipt(input);
  return [
    `*${r.title}*`,
    ...r.header,
    "",
    ...r.lines.map((l) => `${l.label}: ${l.value}`),
    ...(r.notes.length ? ["", ...r.notes] : []),
    "",
    "Terima kasih.",
  ].join("\n");
}

// assistant-recommended: wa.me/62<number without the leading 0>; null when the number is not a
// usable Indonesian phone. Opening the link sends nothing by itself.
export function whatsappNumber(phone: string | null | undefined): string | null {
  const digits = (phone ?? "").replace(/[^0-9+]/g, "").replace(/^\+/, "");
  const national = digits.startsWith("62") ? digits.slice(2) : digits.startsWith("0") ? digits.slice(1) : digits;
  return /^[1-9][0-9]{7,12}$/.test(national) ? `62${national}` : null;
}

export function whatsappReceiptLink(phone: string | null | undefined, input: ReceiptInput): string {
  const number = whatsappNumber(phone);
  const text = encodeURIComponent(receiptText(input));
  return number ? `https://wa.me/${number}?text=${text}` : `https://wa.me/?text=${text}`;
}
