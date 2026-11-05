"use client";

// T-086 / UX-20 item 4, UX-13 "Tutup kasus": tenant administrator only. Closing requires an outcome;
// a compensation requires the decided amount and who decided it (courier or Mengantar). The amount is
// what was decided, never a figure GeraiExpress proposes.
import { useActionState, useEffect, useId, useState } from "react";
import { Notice } from "@/components/notice";
import { SubmitButton } from "@/components/submit-button";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { closeCaseAction, type CaseActionState } from "./actions";
import { CASE_COPY, CASE_TYPE_LABEL, CLAIM_TYPE_LABEL, DECIDED_BY_LABEL, OUTCOMES, OUTCOME_LABEL, type CaseOutcome, type DecidedBy } from "./copy";
import type { CaseRecord } from "./types";

const radio = "flex min-h-11 cursor-pointer items-center gap-2 rounded-sm border border-input bg-card px-3 has-[:checked]:border-primary has-[:checked]:ring-1 has-[:checked]:ring-primary";
const ERR = {
  outcome: "Pilih hasil.",
  amount: "Isi nilai yang diputuskan dalam rupiah, lebih dari nol.",
  decided_by: "Pilih siapa yang memutuskan.",
  note: "Catatan paling panjang 500 karakter.",
} as const;

export function CloseCaseDialog({ record, reference, reloadHref, isDemo }: { record: CaseRecord; reference: string; reloadHref: string; isDemo: boolean }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<CaseActionState, FormData>(closeCaseAction, {});
  const [outcome, setOutcome] = useState<CaseOutcome | "">("");
  const [decidedBy, setDecidedBy] = useState<DecidedBy | "">("");
  const id = useId();
  useEffect(() => { if (state.ok) setOpen(false); }, [state]);
  const err = state.fieldErrors ?? {};
  const error = (key: keyof typeof ERR) => err[key] ? <FieldError id={`${id}-${key}-error`}>{ERR[key]}</FieldError> : null;
  const compensated = outcome === "compensated";
  return (
    <Dialog open={open} onOpenChange={(value) => { if (!pending) setOpen(value); }}>
      <DialogTrigger asChild><Button type="button" variant="outline" className="w-full sm:w-auto" data-testid="case-close">{CASE_COPY.closeButton}</Button></DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader className="pr-12">
          <DialogTitle>{CASE_COPY.closeTitle} <span className="tabular whitespace-nowrap">{reference}</span></DialogTitle>
          <DialogDescription>
            {CASE_TYPE_LABEL[record.case_type]} · {CLAIM_TYPE_LABEL[record.claim_type]}. {CASE_COPY.decisionNote} Kasus yang ditutup tidak dapat diubah.
          </DialogDescription>
        </DialogHeader>
        {state.error ? <Notice tone="danger" data-testid="case-close-error">{state.error}</Notice> : null}
        <form action={action} className="flex flex-col gap-5" onSubmit={(event) => { if (state.reconcile || pending) event.preventDefault(); }}>
          <input type="hidden" name="case_id" value={record.id} />
          <FieldGroup className="gap-5">
            <FieldSet>
              <FieldLegend variant="label">{CASE_COPY.outcomeLegend}</FieldLegend>
              <div className="grid grid-cols-2 gap-2">
                {OUTCOMES.map((value) => (
                  <label key={value} className={radio}>
                    <input type="radio" name="outcome" value={value} required checked={outcome === value} onChange={() => setOutcome(value)} className="size-4 accent-primary"
                      aria-invalid={!!err.outcome} aria-describedby={err.outcome ? `${id}-outcome-error` : undefined} />
                    <span>{OUTCOME_LABEL[value]}</span>
                  </label>
                ))}
              </div>
              {error("outcome")}
            </FieldSet>
            {compensated ? <>
              <Field data-invalid={!!err.amount || undefined}>
                <FieldLabel htmlFor={`${id}-amount`}>{CASE_COPY.amountLabel}{isDemo ? " (contoh)" : ""}</FieldLabel>
                <Input id={`${id}-amount`} name="amount" inputMode="numeric" autoComplete="off" required className="tabular"
                  aria-invalid={!!err.amount} aria-describedby={[`${id}-amount-hint`, err.amount ? `${id}-amount-error` : null].filter(Boolean).join(" ")} />
                <FieldDescription id={`${id}-amount-hint`}>{CASE_COPY.amountHint}</FieldDescription>
                {error("amount")}
              </Field>
              <FieldSet>
                <FieldLegend variant="label">{CASE_COPY.decidedByLegend}</FieldLegend>
                <div className="grid grid-cols-2 gap-2">
                  {(["courier", "mengantar"] as const).map((value) => (
                    <label key={value} className={radio}>
                      <input type="radio" name="decided_by" value={value} required checked={decidedBy === value} onChange={() => setDecidedBy(value)} className="size-4 accent-primary"
                        aria-invalid={!!err.decided_by} aria-describedby={err.decided_by ? `${id}-decided_by-error` : undefined} />
                      <span>{DECIDED_BY_LABEL[value]}</span>
                    </label>
                  ))}
                </div>
                {error("decided_by")}
              </FieldSet>
            </> : null}
            <Field data-invalid={!!err.note || undefined}>
              <FieldLabel htmlFor={`${id}-note`}>{CASE_COPY.noteLabel}</FieldLabel>
              <Textarea id={`${id}-note`} name="note" rows={2} maxLength={500}
                aria-invalid={!!err.note} aria-describedby={err.note ? `${id}-note-error` : undefined} />
              {error("note")}
            </Field>
          </FieldGroup>
          <DialogFooter className="gap-3">
            <DialogClose asChild><Button type="button" variant="outline" disabled={pending}>{CASE_COPY.back}</Button></DialogClose>
            {state.reconcile ? <Button asChild><a href={reloadHref}>{CASE_COPY.reload}</a></Button>
              : <SubmitButton pendingLabel={CASE_COPY.pending} data-testid="case-close-save">{CASE_COPY.closeSubmit}</SubmitButton>}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
