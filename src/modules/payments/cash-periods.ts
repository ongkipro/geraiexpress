import { PAYMENT_METHODS, type PaymentMethod } from "./messages";
import { isPresentableRupiah, UNSUPPORTED_PAYMENT_AMOUNT } from "./money";

export type CashPeriod = {
  id: string; outlet_id: string; opened_at: string; closed_at: string | null;
  closed_by: string | null; counted_cash_idr: number | null; expected_cash_idr: number | null; variance_idr: number | null;
};
export type PeriodPayment = { method: PaymentMethod; amount_idr: number; recorded_by: string; recorded_by_label: string };
export type PeriodTotals = { methods: Record<PaymentMethod, number>; staff: { id: string; label: string; total: number }[]; expected: number };

// Group by identity, not the fallback display label: two different members can both be "Petugas".
export function cashPeriodTotals(payments: PeriodPayment[]): PeriodTotals {
  const methods = Object.fromEntries(PAYMENT_METHODS.map((m) => [m, 0])) as Record<PaymentMethod, number>;
  const staff = new Map<string, { id: string; label: string; total: number }>();
  for (const p of payments) {
    if (!isPresentableRupiah(p.amount_idr)) throw new Error(UNSUPPORTED_PAYMENT_AMOUNT);
    const member = staff.get(p.recorded_by) ?? { id: p.recorded_by, label: p.recorded_by_label, total: 0 };
    methods[p.method] += p.amount_idr;
    member.total += p.amount_idr;
    if (!Number.isSafeInteger(methods[p.method]) || !Number.isSafeInteger(member.total)) throw new Error(UNSUPPORTED_PAYMENT_AMOUNT);
    staff.set(p.recorded_by, member);
  }
  return { methods, staff: [...staff.values()], expected: methods.cash };
}

export const CASH_UNKNOWN_RESULT = "Hasil penyimpanan kas belum pasti. Muat ulang halaman untuk memeriksa status periode sebelum mencoba lagi.";
const CASH_ERRORS: Record<string, string> = {
  not_found: "Periode tidak ditemukan atau Anda tidak memiliki akses.",
  not_a_member: "Anda tidak memiliki akses ke gerai ini.",
  admin_required: "Hanya admin gerai yang dapat membuka ulang kas.",
  reason_required: "Tuliskan alasan (5–500 karakter).",
  counted_cash_invalid: "Isi uang tunai terhitung dalam rupiah, minimal Rp0.",
  period_closed: "Periode sudah ditutup. Muat ulang untuk melihat hasil penutupan.",
  period_open: "Periode sudah terbuka. Muat ulang untuk melihat status kas.",
  period_open_exists: "Outlet ini memiliki periode terbuka. Tutup periode yang sedang terbuka sebelum membuka ulang periode ini.",
};
export const cashPeriodError = (error: { message?: string | null }) => CASH_ERRORS[error.message ?? ""] ?? CASH_UNKNOWN_RESULT;
