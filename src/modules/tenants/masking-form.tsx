"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { Notice } from "@/components/notice";
import { setMaskingAllowedAction, type MaskingState } from "./actions";

// One button flips the flag to the opposite of what the page showed; the reason is required and goes to the audit.
export function MaskingForm({ tenantId, tenantName, allowed }: { tenantId: string; tenantName: string; allowed: boolean }) {
  const [state, action] = useActionState<MaskingState, FormData>(setMaskingAllowedAction, {});
  const verb = allowed ? "Nonaktifkan masking" : "Izinkan masking";
  return (
    <form action={action} className="flex flex-col gap-4" data-testid="masking-form">
      {state.error ? <Notice tone="danger">{state.error}</Notice> : null}
      {state.ok ? <Notice tone="success" data-testid="masking-result">{state.ok}</Notice> : null}
      <input type="hidden" name="tenant_id" value={tenantId} />
      <input type="hidden" name="allowed" value={allowed ? "no" : "yes"} />
      <Field>
        <FieldLabel htmlFor="masking-reason">Alasan (dicatat di audit)</FieldLabel>
        <Textarea id="masking-reason" name="reason" rows={2} required minLength={5} maxLength={500} />
        <FieldDescription>
          {allowed
            ? `Setelah dinonaktifkan, ${tenantName} tidak bisa memilih masking dan label berikutnya memakai identitas gerai. Label yang sudah dibuat tidak berubah.`
            : `Setelah diizinkan, admin dan operator ${tenantName} bisa memilih masking per label. Standarnya tetap mati.`}
        </FieldDescription>
      </Field>
      <SubmitButton pendingLabel="Menyimpan…" variant={allowed ? "destructive" : "default"} className="self-start max-sm:w-full">{verb}</SubmitButton>
    </form>
  );
}
