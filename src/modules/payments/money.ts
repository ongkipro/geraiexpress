// PostgreSQL keeps the full bigint domain. The current JSON/JavaScript read path cannot represent
// every bigint exactly; fail closed at presentation instead of rounding a customer's receipt.
export function isPresentableRupiah(value: unknown, nullable = false): boolean {
  return (nullable && value === null) || (typeof value === "number" && Number.isSafeInteger(value) && value >= 0);
}

export const UNSUPPORTED_PAYMENT_AMOUNT =
  "Nilai pembayaran di luar rentang yang dapat ditampilkan dengan tepat. Hubungi admin GeraiExpress; memuat ulang tidak mengubah nilai tersimpan.";
