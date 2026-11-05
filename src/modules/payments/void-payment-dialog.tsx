"use client";

// T-082 / UX-17 item 3: "Batalkan catatan" (tenant administrator only; the database re-checks). A
// reason is required and the voided record stays visible.
import { useActionState, useEffect, useState } from "react";
import { Notice } from "@/components/notice";
import { SubmitButton } from "@/components/submit-button";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { voidCounterPaymentAction, type PaymentState } from "./actions";
import { VoidPaymentSummary, type VoidPaymentSummaryProps } from "./void-payment-summary";

export function VoidPaymentDialog({ shipmentId, paymentId, reference, amountIdr, method, staffLabel, isDemo }:
  { shipmentId: string; paymentId: string } & VoidPaymentSummaryProps) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState<PaymentState, FormData>(voidCounterPaymentAction, {});
  const [reason, setReason] = useState("");
  useEffect(() => {
    if (state.ok) setOpen(false);
  }, [state]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" className="w-full sm:w-auto" data-testid="void-payment">Batalkan catatan</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="pr-12">
          <DialogTitle>Batalkan catatan pembayaran <span className="tabular whitespace-nowrap">{reference}</span>?</DialogTitle>
          <DialogDescription>Catatan tetap terlihat sebagai dibatalkan. Setelah itu pembayaran bisa dicatat ulang.</DialogDescription>
        </DialogHeader>
        <VoidPaymentSummary reference={reference} amountIdr={amountIdr} method={method} staffLabel={staffLabel} isDemo={isDemo} />
        {state.error ? <Notice tone="danger" data-testid="void-error">{state.error}</Notice> : null}
        <form action={action} onSubmit={(event) => { if (state.reconcile) event.preventDefault(); }} className="flex flex-col gap-5">
          <input type="hidden" name="shipment_id" value={shipmentId} />
          <input type="hidden" name="payment_id" value={paymentId} />
          <Field data-invalid={!!state.fieldErrors?.reason || undefined}>
            <FieldLabel htmlFor="void-reason">Alasan</FieldLabel>
            <Textarea id="void-reason" name="reason" required minLength={5} maxLength={500} rows={2}
              value={reason} onChange={(e) => setReason(e.target.value)} aria-invalid={!!state.fieldErrors?.reason}
              aria-describedby={state.fieldErrors?.reason ? "void-reason-error" : undefined} />
            {state.fieldErrors?.reason ? <FieldError id="void-reason-error">{state.fieldErrors.reason}</FieldError> : null}
          </Field>
          <DialogFooter className="gap-3">
            <DialogClose asChild><Button type="button" variant="outline">Kembali</Button></DialogClose>
            {state.reconcile ? <Button asChild><a href={`/pengiriman/${shipmentId}`}>Muat ulang</a></Button> : (
              <SubmitButton pendingLabel="Membatalkan…" variant="destructive" data-testid="void-save">Batalkan catatan</SubmitButton>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
