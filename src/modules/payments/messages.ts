// T-082: Bahasa Indonesia texts for the counter payment record (UX-17 items 1-4, 7). Error codes are
// the stable codes raised by record_counter_payment / void_counter_payment / reopen_shipment
// (db/migrations/20261104120000_counter_payments.sql). Kept here because src/lib/errors.ts is outside
// T-082's allowed paths.

export type PaymentMethod = "cash" | "qris" | "transfer" | "other";

// DATA-11 / UX-17 method set and Bahasa labels.
export const PAYMENT_METHODS: readonly PaymentMethod[] = ["cash", "qris", "transfer", "other"];
export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: "Tunai",
  qris: "QRIS",
  transfer: "Transfer",
  other: "Lainnya",
};

export const isPaymentMethod = (value: string): value is PaymentMethod =>
  (PAYMENT_METHODS as readonly string[]).includes(value);

const PAYMENT_ERRORS: Record<string, string> = {
  not_found: "Data tidak ditemukan atau Anda tidak memiliki akses.",
  charge_unknown: "Tarif belum pasti, jadi pembayaran belum bisa dicatat.",
  cod_collected_by_courier: "Ongkir pengiriman COD ditagih kurir ke penerima, jadi tidak dicatat sebagai pembayaran di kasir.",
  payment_recorded: "Pembayaran untuk pengiriman ini sudah dicatat. Batalkan catatan lama dulu bila perlu diubah.",
  payment_invalid: "Pilih cara bayar dan isi jumlah lebih dari Rp0.",
  difference_reason_required: "Jumlah berbeda dari tarif pelanggan. Tuliskan alasan singkat (5–500 karakter).",
  cash_received_invalid: "Uang diterima harus sama atau lebih besar dari jumlah bayar.",
  period_closed: "Kas outlet ini sudah ditutup, jadi catatan tidak bisa diubah.",
  payment_voided: "Catatan ini sudah dibatalkan.",
  admin_required: "Hanya admin gerai yang dapat membatalkan catatan pembayaran.",
  reason_required: "Tuliskan alasan (5–500 karakter).",
  payment_append_only: "Catatan pembayaran tidak bisa diubah.",
  receipt_width_invalid: "Pilih lebar struk 58 mm atau 80 mm.",
  receipt_identity_changed: "Identitas gerai pada struk telah berubah. Muat ulang struk sebelum mencetak; struk belum dicetak.",
};

export const PAYMENT_UNKNOWN_RESULT =
  "Hasil penyimpanan belum pasti. Muat ulang halaman untuk melihat apakah pembayaran sudah tercatat sebelum mencoba lagi.";

export function paymentError(error: { message?: string | null } | null | undefined): string {
  const code = error?.message ?? "";
  return PAYMENT_ERRORS[code] ?? PAYMENT_UNKNOWN_RESULT;
}

export const PAYMENT_SAVED = "Pembayaran pelanggan dicatat.";
export const PAYMENT_VOIDED = "Catatan pembayaran dibatalkan.";
