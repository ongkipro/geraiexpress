"use client";

import { useActionState, useState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { Notice } from "@/components/notice";
import { setMaskingAllowedAction, type MaskingState } from "./actions";

// One button flips the flag to the opposite of what the page showed. Like the lifecycle control it opens a
// confirmation dialog that names the gerai and the effect; the reason is required and goes to the audit.
// The dialog closes on success (the result is shown next to the trigger); an error keeps it open with the
// typed reason intact.
export function MaskingForm({ tenantId, tenantName, allowed }: { tenantId: string; tenantName: string; allowed: boolean }) {
  const [state, action] = useActionState<MaskingState, FormData>(setMaskingAllowedAction, {});
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState(state);
  if (state !== seen) {
    setSeen(state);
    if (state.ok) setOpen(false);
  }
  const verb = allowed ? "Nonaktifkan masking" : "Izinkan masking";
  return (
    <div className="flex flex-col items-start gap-4" data-testid="masking-form">
      {state.ok && !open ? <Notice tone="success" data-testid="masking-result">{state.ok}</Notice> : null}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button type="button" variant="outline" aria-haspopup="dialog" className="max-sm:w-full">
            <span>{verb}<span className="sr-only"> untuk {tenantName}</span>…</span>
          </Button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-lg" data-testid="masking-dialog">
          <DialogHeader className="pr-12">
            <DialogTitle>{verb} untuk {tenantName}?</DialogTitle>
            <DialogDescription>
              {allowed
                ? `Setelah dinonaktifkan, ${tenantName} tidak bisa memilih masking dan label berikutnya memakai identitas gerai. Label yang sudah dibuat tidak berubah.`
                : `Setelah diizinkan, admin dan operator ${tenantName} bisa memilih masking per label. Standarnya tetap mati.`}
            </DialogDescription>
          </DialogHeader>
          <form action={action} className="flex flex-col gap-5">
            {state.error ? <Notice tone="danger">{state.error}</Notice> : null}
            <input type="hidden" name="tenant_id" value={tenantId} />
            <input type="hidden" name="allowed" value={allowed ? "no" : "yes"} />
            <Field>
              <FieldLabel htmlFor="masking-reason">Alasan (dicatat di audit)</FieldLabel>
              <Textarea id="masking-reason" name="reason" rows={2} required minLength={5} maxLength={500} />
              <FieldDescription>5–500 karakter.</FieldDescription>
            </Field>
            <DialogFooter className="gap-3">
              <DialogClose asChild><Button type="button" variant="ghost">Batal</Button></DialogClose>
              <SubmitButton pendingLabel="Menyimpan…" variant={allowed ? "destructive" : "default"} data-testid="masking-confirm">{verb}</SubmitButton>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
