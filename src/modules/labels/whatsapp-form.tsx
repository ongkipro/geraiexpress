"use client";

import { useActionState } from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { setContactWhatsappAction, type WhatsappState } from "./actions";

// PR-34 / UX-9: the tenant administrator edits the gerai WhatsApp printed on the label while masking is
// off. The refusal message sits next to the input; a successful save shows the stored (normalized) value.
export function WhatsappForm({ value, revision }: { value: string | null; revision: number }) {
  const [state, action, pending] = useActionState<WhatsappState, FormData>(setContactWhatsappAction, {});
  const shown = state.value ?? value ?? "";
  const currentRevision = state.revision ?? revision;
  return (
    <form action={action} className="flex flex-col gap-3" noValidate>
      <input type="hidden" name="revision" value={currentRevision} />
      <div className="flex flex-col gap-2">
        <Label htmlFor="whatsapp">Nomor WhatsApp gerai</Label>
        <p id="whatsapp-hint" className="text-sm text-muted-foreground">
          Contoh: 081234567890. Awalan +62 atau 62 diubah menjadi 0. Nomor ini dicetak di label saat masking pengirim tidak dipakai.
        </p>
        <Input
          key={shown}
          id="whatsapp"
          name="whatsapp"
          type="tel"
          inputMode="tel"
          autoComplete="off"
          defaultValue={shown}
          aria-invalid={state.error ? true : undefined}
          aria-describedby={state.error ? "whatsapp-hint whatsapp-error" : "whatsapp-hint"}
          className="max-w-[320px]"
        />
        {state.error ? (
          <p id="whatsapp-error" role="alert" className="flex items-start gap-1.5 text-sm text-danger">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />{state.error}
          </p>
        ) : null}
      </div>
      {state.ok ? <p role="status" className="flex items-start gap-2 rounded-md bg-success-soft p-3 text-sm"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />{state.ok}</p> : null}
      <Button type="submit" disabled={pending} aria-busy={pending} className="self-start">
        {pending ? "Menyimpan…" : "Simpan nomor"}
      </Button>
    </form>
  );
}
