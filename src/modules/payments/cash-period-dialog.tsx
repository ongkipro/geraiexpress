"use client";

import { useActionState, useEffect, useId, useState } from "react";
import { Notice } from "@/components/notice";
import { SubmitButton } from "@/components/submit-button";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatIdr, formatWib } from "@/lib/format";
import { closeCashPeriodAction, reopenCashPeriodAction, type CashPeriodState } from "./cash-period-actions";
import type { CashPeriod, PeriodTotals } from "./cash-periods";
import { PAYMENT_METHODS, PAYMENT_METHOD_LABEL } from "./messages";
import { parsePaymentRupiah } from "./rupiah";

export function CashPeriodDialog({ period, outlet, totals, isDemo, reopen = false }: {
  period: CashPeriod; outlet: string; totals?: PeriodTotals; isDemo: boolean; reopen?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [counted, setCounted] = useState("");
  const [reason, setReason] = useState("");
  const [state, action, pending] = useActionState<CashPeriodState, FormData>(reopen ? reopenCashPeriodAction : closeCashPeriodAction, {});
  const id = useId();
  useEffect(() => { if (state.ok) setOpen(false); }, [state]);
  const money = (n: number | null) => `${formatIdr(n)}${isDemo ? " (contoh)" : ""}`;
  const count = reopen ? period.counted_cash_idr : parsePaymentRupiah(counted);
  const expected = reopen ? period.expected_cash_idr : totals?.expected ?? null;
  const variance = count !== null && expected !== null ? count - expected : null;
  const label = reopen ? "Buka ulang kas" : "Tutup kas";
  return <Dialog open={open} onOpenChange={(value) => { if (!pending) setOpen(value); }}>
    <DialogTrigger asChild><Button type="button" variant="outline">{label}</Button></DialogTrigger>
    <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
      <DialogHeader className="pr-12">
        <DialogTitle>{label} — {outlet}</DialogTitle>
        <DialogDescription>Periode mulai {formatWib(period.opened_at)}. {reopen ? "Riwayat penutupan tetap disimpan. Alasan pembukaan ulang dicatat." : "Periksa jumlah sebelum menutup. Catatan periode tertutup tidak dapat diubah; pembayaran berikutnya membuka periode baru. Tunai yang diharapkan dihitung ulang oleh server saat konfirmasi."}</DialogDescription>
      </DialogHeader>
      {totals ? <dl className="grid grid-cols-2 gap-2 text-sm">{PAYMENT_METHODS.map((m) => <div key={m}><dt>{PAYMENT_METHOD_LABEL[m]}</dt><dd className="tabular">{money(totals.methods[m])}</dd></div>)}</dl> : null}
      {state.error ? <Notice tone="danger">{state.error}</Notice> : null}
      <form action={action} className="flex flex-col gap-4" onSubmit={(event) => { if (state.reconcile || pending) event.preventDefault(); }}>
        <input type="hidden" name="period_id" value={period.id} />
        {reopen ? <Field>
          <FieldLabel htmlFor={`${id}-reason`}>Alasan buka ulang</FieldLabel>
          <Textarea id={`${id}-reason`} name="reason" required minLength={5} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} aria-invalid={!!state.fieldErrors?.reason}
            aria-describedby={state.fieldErrors?.reason ? `${id}-reason-error` : undefined} />
          {state.fieldErrors?.reason ? <FieldError id={`${id}-reason-error`}>{state.fieldErrors.reason}</FieldError> : null}
        </Field> : <Field>
          <FieldLabel htmlFor={`${id}-counted`}>Uang tunai terhitung (Rp){isDemo ? " (contoh)" : ""}</FieldLabel>
          <Input id={`${id}-counted`} name="counted" inputMode="numeric" required autoComplete="off" value={counted} onChange={(e) => setCounted(e.target.value)}
            aria-invalid={!!state.fieldErrors?.counted} aria-describedby={state.fieldErrors?.counted ? `${id}-counted-error` : undefined} />
          {state.fieldErrors?.counted ? <FieldError id={`${id}-counted-error`}>{state.fieldErrors.counted}</FieldError> : null}
        </Field>}
        <dl className="grid gap-2 text-sm tabular" aria-live="polite">
          <div><dt>Tunai yang diharapkan</dt><dd>{money(expected)}</dd></div>
          <div><dt>Tunai terhitung</dt><dd>{money(count)}</dd></div>
          <div data-testid="cash-variance"><dt>Selisih kas</dt><dd>{money(variance)}</dd></div>
        </dl>
        <DialogFooter>
          <DialogClose asChild><Button type="button" variant="outline" disabled={pending}>Kembali</Button></DialogClose>
          {state.reconcile ? <Button asChild><a href="/kas">Muat ulang</a></Button> : <SubmitButton pendingLabel="Menyimpan…">{reopen ? "Konfirmasi buka ulang" : "Konfirmasi tutup kas"}</SubmitButton>}
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}
