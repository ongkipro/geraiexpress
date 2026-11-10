"use client";

// T-084 / PR-46: change one courier's masking acceptance with a confirmation dialog that states the effect
// on printing, an evidence reference for verified/refused and a reason for the audit.
import { useActionState, useState } from "react";
import { Notice } from "@/components/notice";
import { SubmitButton } from "@/components/submit-button";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { setMaskingAcceptanceAction, type FormState } from "@/lib/platform-actions";

const STATES = [
  { value: "unverified", label: "Belum terverifikasi", help: "Operator harus mencentang konfirmasi sebelum mencetak label masking." },
  { value: "verified", label: "Terverifikasi", help: "Kurir menerima label masking; konfirmasi operator tidak diminta lagi." },
  { value: "refused", label: "Ditolak kurir", help: "Label masking tetap bisa dicetak hanya dengan konfirmasi operator." },
] as const;

export function MaskingAcceptanceForm({ courier, courierLabel, state, evidenceRef, recordedAt }: {
  courier: string; courierLabel: string; state: string; evidenceRef: string | null; recordedAt: string | null;
}) {
  const [result, action] = useActionState<FormState, FormData>(setMaskingAcceptanceAction, {});
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState(result);
  if (result !== seen) {
    setSeen(result);
    if (result.ok) setOpen(false);
  }
  const id = `acceptance-${courier}`;
  return (
    <div className="flex flex-col items-start gap-1">
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)} aria-haspopup="dialog">
        <span>Ubah status<span className="sr-only"> {courierLabel}</span></span>
      </Button>
      {result.ok && !open ? <p role="status" className="text-sm text-success">{result.ok}</p> : null}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader className="pr-12">
            <DialogTitle>Penerimaan label masking {courierLabel}</DialogTitle>
            <DialogDescription>
              Berlaku untuk cetak berikutnya di semua gerai. Riwayat cetak yang sudah ada tidak berubah. Status terverifikasi hanya setelah uji scan kurir dan sinkronisasi Mengantar.
            </DialogDescription>
          </DialogHeader>
          <form action={action} className="flex flex-col gap-5">
            {result.error ? <Notice tone="danger">{result.error}</Notice> : null}
            <input type="hidden" name="courier" value={courier} />
            <input type="hidden" name="expected_recorded_at" value={recordedAt ?? ""} />
            <FieldGroup className="gap-4">
              <FieldSet>
                <FieldLegend variant="label">Status</FieldLegend>
                <div className="flex flex-col gap-1">
                  {STATES.map((option) => (
                    <label key={option.value} className="flex min-h-11 cursor-pointer items-start gap-3 py-1">
                      <input type="radio" name="state" value={option.value} defaultChecked={option.value === state} required className="mt-1 size-4 accent-primary" />
                      <span className="flex flex-col"><span>{option.label}</span><span className="text-sm text-muted-foreground">{option.help}</span></span>
                    </label>
                  ))}
                </div>
              </FieldSet>
              <Field>
                <FieldLabel htmlFor={`${id}-evidence`}>Referensi bukti</FieldLabel>
                <Input id={`${id}-evidence`} name="evidence_ref" maxLength={500} defaultValue={evidenceRef ?? ""} />
                <FieldDescription>Wajib untuk terverifikasi atau ditolak, misalnya nomor tiket uji scan atau catatan sinkronisasi.</FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor={`${id}-reason`}>Alasan (dicatat di audit)</FieldLabel>
                <Textarea id={`${id}-reason`} name="reason" rows={2} required minLength={5} maxLength={500} />
                <FieldDescription>Minimal 5 karakter.</FieldDescription>
              </Field>
            </FieldGroup>
            <DialogFooter className="gap-3">
              <DialogClose asChild><Button type="button" variant="ghost">Batal</Button></DialogClose>
              <SubmitButton pendingLabel="Menyimpan…">Simpan status</SubmitButton>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
