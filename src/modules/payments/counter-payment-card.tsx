// T-082 / UX-17 items 1-3: the counter payment state of a confirmed shipment ("Pelanggan: belum
// bayar / sudah bayar"), shown apart from the Mengantar order payment state (UX-1, UX-14): it never
// hides or replaces the provider unpaid state. Differences and voided records are for the tenant
// administrator only.
import Link from "next/link";
import { Receipt } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Notice } from "@/components/notice";
import { Button } from "@/components/ui/button";
import { formatIdr, formatWib } from "@/lib/format";
import { PAYMENT_METHOD_LABEL, type PaymentMethod } from "./messages";
import { PaymentDialog } from "./payment-dialog";
import { staffFirstName } from "./receipt";
import { VoidPaymentDialog } from "./void-payment-dialog";
import { isPresentableRupiah, UNSUPPORTED_PAYMENT_AMOUNT } from "./money";

export type CounterPaymentRecord = {
  id: string;
  method: PaymentMethod;
  amount_idr: number;
  cash_received_idr: number | null;
  recorded_by_label: string;
  recorded_at: string;
  voided_at: string | null;
  receipt_gerai_name: string;
  receipt_gerai_whatsapp: string | null;
};

// Matches member-safe column grants. Expected charge and stored administrative reasons are read
// only through counter_payment_admin_details, never as hidden fields in an operator's data response.
export const COUNTER_PAYMENT_COLUMNS =
  "id, method, amount_idr, cash_received_idr, recorded_by_label, recorded_at, voided_at, receipt_gerai_name, receipt_gerai_whatsapp";

export type CounterPaymentAdminDetails = {
  payment_id: string;
  expected_idr: number;
  difference_reason: string | null;
  void_reason: string | null;
};

// Mirrors record_counter_payment's confirmed states (20261104120000_counter_payments.sql).
const CONFIRMED = ["queued", "in_flight", "unknown", "issued"];

export function counterPaymentApplies(state: string): boolean {
  return CONFIRMED.includes(state);
}

export function CounterPaymentCard({ shipmentId, reference, state, chargeIdr, isCod, isAdmin, isDemo, payments, adminDetails }: {
  shipmentId: string;
  reference: string;
  state: string;
  chargeIdr: number | null;
  isCod: boolean;
  isAdmin: boolean;
  isDemo: boolean;
  // Newest first; includes voided records.
  payments: CounterPaymentRecord[];
  adminDetails: CounterPaymentAdminDetails[];
}) {
  const confirmed = counterPaymentApplies(state);
  if (!confirmed && payments.length === 0) return null;
  const active = payments.find((p) => !p.voided_at) ?? null;
  const voided = payments.filter((p) => p.voided_at);
  const activeDetails = isAdmin ? adminDetails.find((details) => details.payment_id === active?.id) : undefined;
  const contoh = isDemo ? " (contoh)" : "";
  // Retained voided history must not block a new payment. Only the current charge/active record
  // determines eligibility; each historical amount is independently guarded at its render site.
  const currentAmountsSupported = isPresentableRupiah(chargeIdr, true)
    && (!active || (isPresentableRupiah(active.amount_idr) && isPresentableRupiah(active.cash_received_idr, true)))
    && (!activeDetails || isPresentableRupiah(activeDetails.expected_idr));

  let body: React.ReactNode;
  if (!currentAmountsSupported) {
    body = (
      <div className="flex flex-col gap-3">
        <p data-testid="counter-payment-state">{active ? "Pembayaran pelanggan sudah tercatat." : "Tidak ada catatan pembayaran aktif."}</p>
        <Notice tone="danger">{UNSUPPORTED_PAYMENT_AMOUNT}</Notice>
        {isAdmin && active ? <VoidPaymentDialog shipmentId={shipmentId} paymentId={active.id} reference={reference}
          amountIdr={active.amount_idr} method={active.method} staffLabel={active.recorded_by_label} isDemo={isDemo} /> : null}
      </div>
    );
  } else if (chargeIdr == null) {
    body = <p className="text-sm text-muted-foreground" data-testid="counter-payment-state">Tarif belum pasti</p>;
  } else if (isCod) {
    body = (
      <p className="text-sm" data-testid="counter-payment-state">
        <Badge variant="info">Ditagih kurir (COD)</Badge>{" "}
        <span className="text-muted-foreground">Ongkir ditagih kurir ke penerima bersama nilai COD, bukan dibayar di kasir.</span>
      </p>
    );
    // COD is not paid at the counter; its receipt carries only the courier collection instruction.
    body = (
      <div className="flex flex-col gap-3">
        {body}
        <Button asChild variant="outline" className="w-full sm:w-auto">
          <Link href={`/pengiriman/${shipmentId}/struk`}><Receipt aria-hidden="true" />Cetak struk</Link>
        </Button>
      </div>
    );
  } else if (active) {
    body = (
      <div className="flex flex-col gap-3">
        <p className="flex flex-wrap items-center gap-2" data-testid="counter-payment-state">
          <Badge variant="success">Lunas</Badge>
          <span>
            Pelanggan: sudah bayar (Lunas) · {PAYMENT_METHOD_LABEL[active.method]} · {staffFirstName(active.recorded_by_label)} · {formatWib(active.recorded_at)}
          </span>
        </p>
        <p className="text-sm text-muted-foreground">
          Dibayar <span className="tabular text-foreground">{formatIdr(active.amount_idr)}{contoh}</span>
        </p>
        {activeDetails && active.amount_idr !== activeDetails.expected_idr ? (
          <p className="rounded-md bg-warning-soft px-3 py-2 text-sm" data-testid="counter-payment-difference">
            <span className="font-semibold">Selisih</span>{" "}
            <span className="tabular">{formatIdr(active.amount_idr - activeDetails.expected_idr)}{contoh}</span> dari tarif{" "}
            <span className="tabular">{formatIdr(activeDetails.expected_idr)}{contoh}</span>: {activeDetails.difference_reason}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-3">
          {confirmed ? <Button asChild variant="outline" className="w-full sm:w-auto">
            <Link href={`/pengiriman/${shipmentId}/struk`}><Receipt aria-hidden="true" />Cetak struk</Link>
          </Button> : null}
          {isAdmin ? <VoidPaymentDialog shipmentId={shipmentId} paymentId={active.id} reference={reference}
            amountIdr={active.amount_idr} method={active.method} staffLabel={active.recorded_by_label} isDemo={isDemo} /> : null}
        </div>
      </div>
    );
  } else if (confirmed) {
    body = (
      <div className="flex flex-col gap-3">
        <p data-testid="counter-payment-state">Pelanggan: belum bayar</p>
        <PaymentDialog shipmentId={shipmentId} reference={reference} chargeIdr={chargeIdr} isDemo={isDemo} />
      </div>
    );
  } else {
    body = <p className="text-sm text-muted-foreground">Pembayaran belum bisa dicatat pada status pengiriman ini.</p>;
  }

  return (
    <section aria-labelledby="counter-payment-heading" className="flex flex-col gap-3 rounded-lg bg-card p-5 ring-1 ring-border" data-testid="counter-payment">
      <h2 id="counter-payment-heading" className="text-[17px]">Pembayaran pelanggan</h2>
      {body}
      {isAdmin && voided.length ? (
        <ul className="flex flex-col gap-2 border-t border-border pt-3 text-sm text-muted-foreground" data-testid="counter-payment-voided">
          {voided.map((p) => (
            <li key={p.id}>
              <Badge variant="neutral">Dibatalkan</Badge>{" "}
              {isPresentableRupiah(p.amount_idr)
                ? <span className="line-through tabular">{formatIdr(p.amount_idr)}{contoh}</span>
                : <span>Jumlah tidak dapat ditampilkan dengan tepat{contoh}</span>}{" "}
              · {PAYMENT_METHOD_LABEL[p.method]} · {formatWib(p.voided_at)} · {adminDetails.find((details) => details.payment_id === p.id)?.void_reason}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
