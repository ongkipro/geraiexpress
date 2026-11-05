"use client";

// T-082 / UX-17 items 1-3, UX-13: one-step "Catat pembayaran" dialog. Prefills the counter-payable
// amount from the confirmation snapshot (customer_charge_idr); Tunai accepts the amount received and
// shows "Kembalian"; an amount different from the customer charge needs a short reason. The submit
// button refuses repeat clicks while pending and the database refuses a second active record.
import { useActionState, useEffect, useState } from "react";
import { Wallet } from "lucide-react";
import { Notice } from "@/components/notice";
import { SubmitButton } from "@/components/submit-button";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatIdr } from "@/lib/format";
import { recordCounterPaymentAction, type PaymentState } from "./actions";
import { PAYMENT_METHODS, PAYMENT_METHOD_LABEL, type PaymentMethod } from "./messages";
import { parsePaymentRupiah } from "./rupiah";

export function PaymentDialog({ shipmentId, reference, chargeIdr, isDemo }: {
  shipmentId: string;
  reference: string;
  chargeIdr: number;
  isDemo: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState<PaymentState, FormData>(recordCounterPaymentAction, {});
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [amount, setAmount] = useState(String(chargeIdr));
  const [received, setReceived] = useState("");
  const [reason, setReason] = useState("");

  // A saved record closes the dialog; the revalidated page then shows "Pelanggan: sudah bayar".
  useEffect(() => {
    if (state.ok) setOpen(false);
  }, [state]);

  const amountValue = parsePaymentRupiah(amount);
  const receivedValue = parsePaymentRupiah(received);
  const differs = amountValue != null && amountValue !== chargeIdr;
  const change = method === "cash" && amountValue != null && receivedValue != null && receivedValue >= amountValue
    ? receivedValue - amountValue : null;
  const contoh = isDemo ? " (contoh)" : "";
  const err = state.fieldErrors ?? {};

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" className="w-full sm:w-auto" data-testid="record-payment">
          <Wallet aria-hidden="true" />Catat pembayaran
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="pr-12">
          <DialogTitle>Catat pembayaran <span className="tabular whitespace-nowrap">{reference}</span></DialogTitle>
          <DialogDescription>
            Tarif pelanggan <span className="tabular text-foreground">{formatIdr(chargeIdr)}{contoh}</span>. GeraiExpress hanya mencatat pembayaran, tidak memprosesnya.
          </DialogDescription>
        </DialogHeader>
        {state.error ? <Notice tone="danger" data-testid="payment-error">{state.error}</Notice> : null}
        <form action={action} onSubmit={(event) => { if (state.reconcile) event.preventDefault(); }} className="flex flex-col gap-5">
          <input type="hidden" name="shipment_id" value={shipmentId} />
          <input type="hidden" name="expected" value={chargeIdr} />
          <FieldGroup className="gap-5">
            <FieldSet>
              <FieldLegend variant="label">Cara bayar</FieldLegend>
              <div className="grid grid-cols-2 gap-2">
                {PAYMENT_METHODS.map((m) => (
                  <label key={m} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-sm border border-input bg-card px-3 has-[:checked]:border-primary has-[:checked]:ring-1 has-[:checked]:ring-primary">
                    <input type="radio" name="method" value={m} checked={method === m} onChange={() => setMethod(m)} className="size-4 accent-primary"
                      aria-invalid={!!err.method} aria-describedby={err.method ? "payment-method-error" : undefined} />
                    <span>{PAYMENT_METHOD_LABEL[m]}</span>
                  </label>
                ))}
              </div>
              {err.method ? <FieldError id="payment-method-error">{err.method}</FieldError> : null}
            </FieldSet>
            <Field data-invalid={!!err.amount || undefined}>
              <FieldLabel htmlFor="payment-amount">Jumlah dibayar (Rp){contoh}</FieldLabel>
              <Input id="payment-amount" name="amount" inputMode="numeric" autoComplete="off" required className="tabular"
                value={amount} onChange={(e) => setAmount(e.target.value)} aria-invalid={!!err.amount}
                aria-describedby={err.amount ? "payment-amount-error" : undefined} />
              {err.amount ? <FieldError id="payment-amount-error">{err.amount}</FieldError> : null}
            </Field>
            {method === "cash" ? (
              <Field data-invalid={!!err.received || undefined}>
                <FieldLabel htmlFor="payment-received">Uang diterima (Rp){contoh}</FieldLabel>
                <Input id="payment-received" name="received" inputMode="numeric" autoComplete="off" className="tabular"
                  value={received} onChange={(e) => setReceived(e.target.value)} aria-invalid={!!err.received}
                  aria-describedby={err.received ? "payment-change payment-received-error" : "payment-change"} />
                <FieldDescription id="payment-change" aria-live="polite" data-testid="payment-change">
                  Kembalian: <span className="tabular text-foreground">{change == null ? "—" : `${formatIdr(change)}${contoh}`}</span>
                </FieldDescription>
                {err.received ? <FieldError id="payment-received-error">{err.received}</FieldError> : null}
              </Field>
            ) : null}
            {differs || err.reason ? (
              <Field data-invalid={!!err.reason || undefined}>
                <FieldLabel htmlFor="payment-reason">Alasan selisih</FieldLabel>
                <Textarea id="payment-reason" name="reason" required minLength={5} maxLength={500} rows={2}
                  value={reason} onChange={(e) => setReason(e.target.value)} aria-invalid={!!err.reason}
                  aria-describedby={err.reason ? "payment-reason-hint payment-reason-error" : "payment-reason-hint"} />
                <FieldDescription id="payment-reason-hint">Jumlah berbeda dari tarif pelanggan. Selisih ditampilkan ke admin gerai.</FieldDescription>
                {err.reason ? <FieldError id="payment-reason-error">{err.reason}</FieldError> : null}
              </Field>
            ) : null}
          </FieldGroup>
          <DialogFooter className="gap-3">
            <DialogClose asChild><Button type="button" variant="outline">Kembali</Button></DialogClose>
            {state.reconcile ? <Button asChild><a href={`/pengiriman/${shipmentId}`}>Muat ulang</a></Button> : (
              <SubmitButton pendingLabel="Menyimpan…" data-testid="payment-save">Simpan</SubmitButton>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
