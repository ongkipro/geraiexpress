"use client";

// T-086 / UX-20 item 2: "Buka kasus" and "Perbarui kasus" dialogs. Operators and administrators may
// open and update (IAM-1 counter rows). The deadline is computed by the database; this dialog only
// collects the inputs. The submit button refuses repeat clicks while pending (UX-13).
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
import { openCaseAction, updateCaseAction, type CaseActionState } from "./actions";
import {
  CASE_COPY, CASE_STATE_LABEL, CASE_TYPES, CASE_TYPE_LABEL, CLAIM_TYPES, CLAIM_TYPE_LABEL, REGIONS, REGION_LABEL,
  type CaseType, type ClaimType,
} from "./copy";
import { wibLocalValue } from "./form";
import type { CaseRecord } from "./types";

const ERR = {
  case_type: "Pilih jenis kasus.",
  claim_type: "Pilih jenis klaim Mengantar.",
  description: "Tuliskan keterangan (5–1000 karakter).",
  evidence: "Bukti maksimal 10 baris, masing-masing paling panjang 300 karakter.",
  ticket: "Nomor tiket paling panjang 80 karakter.",
  region: "Pilih wilayah tujuan.",
  anchor: "Tanggal titik awal tidak valid atau masih di masa depan.",
  state: "Pilih status kasus.",
} as const;

const radio = "flex min-h-11 cursor-pointer items-center gap-2 rounded-sm border border-input bg-card px-3 has-[:checked]:border-primary has-[:checked]:ring-1 has-[:checked]:ring-primary";

export function CaseDialog({ shipmentId, reference, isJne, existing, reloadHref }: {
  shipmentId: string;
  reference: string;
  // JNE windows differ by destination region; the region choice is shown for JNE only.
  isJne: boolean;
  existing?: CaseRecord;
  reloadHref: string;
}) {
  const update = !!existing;
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<CaseActionState, FormData>(update ? updateCaseAction : openCaseAction, {});
  const [caseType, setCaseType] = useState<CaseType | "">(existing?.case_type ?? "");
  const [claimType, setClaimType] = useState<ClaimType | "">(existing?.claim_type ?? "");
  const [caseState, setCaseState] = useState<"open" | "submitted">(existing?.state === "submitted" ? "submitted" : "open");
  const [region, setRegion] = useState<string>(existing?.region ?? "");
  const id = useId();
  useEffect(() => { if (state.ok) setOpen(false); }, [state]);
  const err = state.fieldErrors ?? {};
  const described = (key: keyof typeof ERR, hint?: string) => [hint, err[key] ? `${id}-${key}-error` : null].filter(Boolean).join(" ") || undefined;
  const error = (key: keyof typeof ERR) => err[key] ? <FieldError id={`${id}-${key}-error`}>{ERR[key]}</FieldError> : null;

  return (
    <Dialog open={open} onOpenChange={(value) => { if (!pending) setOpen(value); }}>
      <DialogTrigger asChild>
        <Button type="button" variant={update ? "outline" : "default"} className="w-full sm:w-auto" data-testid={update ? "case-update" : "case-open"}>
          {update ? CASE_COPY.updateButton : CASE_COPY.openButton}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader className="pr-12">
          <DialogTitle>{update ? CASE_COPY.updateTitle : CASE_COPY.openTitle} <span className="tabular whitespace-nowrap">{reference}</span></DialogTitle>
          <DialogDescription>{CASE_COPY.decisionNote} {CASE_COPY.noPromise}</DialogDescription>
        </DialogHeader>
        {state.error ? <Notice tone="danger" data-testid="case-error">{state.error}</Notice> : null}
        <form action={action} className="flex flex-col gap-5" onSubmit={(event) => { if (state.reconcile || pending) event.preventDefault(); }}>
          {update ? <>
            <input type="hidden" name="case_id" value={existing.id} />
            <input type="hidden" name="revision" value={existing.revision} />
          </> : <input type="hidden" name="shipment_id" value={shipmentId} />}
          <FieldGroup className="gap-5">
            {update ? (
              <FieldSet>
                <FieldLegend variant="label">{CASE_COPY.stateLabel}</FieldLegend>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {(["open", "submitted"] as const).map((value) => (
                    <label key={value} className={radio}>
                      <input type="radio" name="state" value={value} checked={caseState === value} onChange={() => setCaseState(value)} className="size-4 accent-primary"
                        aria-invalid={!!err.state} aria-describedby={described("state")} />
                      <span>{CASE_STATE_LABEL[value]}</span>
                    </label>
                  ))}
                </div>
                {error("state")}
              </FieldSet>
            ) : (
              <FieldSet>
                <FieldLegend variant="label">{CASE_COPY.caseTypeLegend}</FieldLegend>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {CASE_TYPES.map((value) => (
                    <label key={value} className={radio}>
                      <input type="radio" name="case_type" value={value} required checked={caseType === value} onChange={() => setCaseType(value)} className="size-4 accent-primary"
                        aria-invalid={!!err.case_type} aria-describedby={described("case_type")} />
                      <span>{CASE_TYPE_LABEL[value]}</span>
                    </label>
                  ))}
                </div>
                {error("case_type")}
              </FieldSet>
            )}
            <FieldSet>
              <FieldLegend variant="label">{CASE_COPY.claimTypeLabel}</FieldLegend>
              <div className="flex flex-col gap-2">
                {CLAIM_TYPES.map((value) => (
                  <label key={value} className={radio}>
                    <input type="radio" name="claim_type" value={value} required checked={claimType === value} onChange={() => setClaimType(value)} className="size-4 accent-primary"
                      aria-invalid={!!err.claim_type} aria-describedby={described("claim_type")} />
                    <span>{CLAIM_TYPE_LABEL[value]}</span>
                  </label>
                ))}
              </div>
              {error("claim_type")}
            </FieldSet>
            <Field data-invalid={!!err.description || undefined}>
              <FieldLabel htmlFor={`${id}-description`}>{CASE_COPY.descriptionLabel}</FieldLabel>
              <Textarea id={`${id}-description`} name="description" required minLength={5} maxLength={1000} rows={3} defaultValue={existing?.description ?? ""}
                aria-invalid={!!err.description} aria-describedby={described("description", `${id}-description-hint`)} />
              <FieldDescription id={`${id}-description-hint`}>{CASE_COPY.descriptionHint}</FieldDescription>
              {error("description")}
            </Field>
            <Field data-invalid={!!err.evidence || undefined}>
              <FieldLabel htmlFor={`${id}-evidence`}>{CASE_COPY.evidenceLabel}</FieldLabel>
              <Textarea id={`${id}-evidence`} name="evidence" rows={2} defaultValue={existing?.evidence_refs.join("\n") ?? ""}
                aria-invalid={!!err.evidence} aria-describedby={described("evidence", `${id}-evidence-hint`)} />
              <FieldDescription id={`${id}-evidence-hint`}>{CASE_COPY.evidenceHint}</FieldDescription>
              {error("evidence")}
            </Field>
            <Field data-invalid={!!err.ticket || undefined}>
              <FieldLabel htmlFor={`${id}-ticket`}>{CASE_COPY.ticketLabel}</FieldLabel>
              <Input id={`${id}-ticket`} name="ticket" maxLength={80} autoComplete="off" defaultValue={existing?.provider_ticket ?? ""}
                aria-invalid={!!err.ticket} aria-describedby={described("ticket")} />
              {error("ticket")}
            </Field>
            {isJne ? (
              <FieldSet>
                <FieldLegend variant="label">{CASE_COPY.regionLabel}</FieldLegend>
                <div className="flex flex-col gap-2">
                  {[...REGIONS, ""].map((value) => (
                    <label key={value || "none"} className={radio}>
                      <input type="radio" name="region" value={value} checked={region === value} onChange={() => setRegion(value)} className="size-4 accent-primary"
                        aria-invalid={!!err.region} aria-describedby={described("region")} />
                      <span>{value ? REGION_LABEL[value as keyof typeof REGION_LABEL] : CASE_COPY.regionNone}</span>
                    </label>
                  ))}
                </div>
                {error("region")}
              </FieldSet>
            ) : <input type="hidden" name="region" value={existing?.region ?? ""} />}
            <Field data-invalid={!!err.anchor || undefined}>
              <FieldLabel htmlFor={`${id}-anchor`}>{CASE_COPY.anchorLabel}</FieldLabel>
              <Input id={`${id}-anchor`} name="anchor" type="datetime-local" className="tabular" defaultValue={wibLocalValue(existing?.anchor_at ?? null)}
                aria-invalid={!!err.anchor} aria-describedby={described("anchor", `${id}-anchor-hint`)} />
              <FieldDescription id={`${id}-anchor-hint`}>{CASE_COPY.anchorHint}</FieldDescription>
              {error("anchor")}
            </Field>
          </FieldGroup>
          <DialogFooter className="gap-3">
            <DialogClose asChild><Button type="button" variant="outline" disabled={pending}>{CASE_COPY.back}</Button></DialogClose>
            {state.reconcile ? <Button asChild><a href={reloadHref}>{CASE_COPY.reload}</a></Button>
              : <SubmitButton pendingLabel={CASE_COPY.pending} data-testid="case-save">{update ? CASE_COPY.updateSubmit : CASE_COPY.openSubmit}</SubmitButton>}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
