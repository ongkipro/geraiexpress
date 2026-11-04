import { PAYMENT_METHOD_LABEL, type PaymentMethod } from "./messages";
import { isPresentableRupiah, UNSUPPORTED_PAYMENT_AMOUNT } from "./money";
import { receiptAmount, staffFirstName } from "./receipt";

export type VoidPaymentSummaryProps = {
  reference: string;
  amountIdr: number;
  method: PaymentMethod;
  staffLabel: string;
  isDemo: boolean;
};

// The authorization context is present inside the dialog, including the unsupported-value recovery
// path. An unsafe stored amount must never be rounded merely to make a void confirmation possible.
export function VoidPaymentSummary({ reference, amountIdr, method, staffLabel, isDemo }: VoidPaymentSummaryProps) {
  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm" data-testid="void-payment-summary">
      <dt>Referensi</dt><dd className="tabular break-words">{reference}</dd>
      <dt>Jumlah dibayar{isDemo ? " (contoh)" : ""}</dt>
      <dd className="tabular break-words">{isPresentableRupiah(amountIdr)
        ? receiptAmount(amountIdr, isDemo)
        : `Jumlah tidak dapat ditampilkan dengan tepat. ${UNSUPPORTED_PAYMENT_AMOUNT}`}</dd>
      <dt>Cara bayar</dt><dd>{PAYMENT_METHOD_LABEL[method]}</dd>
      <dt>Petugas penerima</dt><dd>{staffFirstName(staffLabel)}</dd>
    </dl>
  );
}
