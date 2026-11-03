"use client";

// T-091 / DEC-024 (G1): append a new configuration version. Each form opens a confirmation dialog that
// states the effect (a new version, the old one stays in history) and needs a reason for the audit.
import { useActionState, useState } from "react";
import { Notice } from "@/components/notice";
import { SubmitButton } from "@/components/submit-button";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { addDeclarationTextAction, addWeightRuleAction, type FormState } from "@/lib/platform-actions";

function useDialogUntilSuccess(state: FormState) {
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState(state);
  if (state !== seen) {
    setSeen(state);
    if (state.ok) setOpen(false);
  }
  return [open, setOpen] as const;
}

function Reason({ id }: { id: string }) {
  return (
    <Field>
      <FieldLabel htmlFor={id}>Alasan (dicatat di audit)</FieldLabel>
      <Textarea id={id} name="reason" rows={2} required minLength={5} maxLength={500} />
      <FieldDescription>Minimal 5 karakter.</FieldDescription>
    </Field>
  );
}

export function DeclarationForm({ current }: { current: { body: string; prohibited_categories: string[]; source_url: string } | null }) {
  const [state, action] = useActionState<FormState, FormData>(addDeclarationTextAction, {});
  const [open, setOpen] = useDialogUntilSuccess(state);
  return (
    <div className="flex flex-col items-start gap-2">
      <Button type="button" variant="outline" onClick={() => setOpen(true)} aria-haspopup="dialog">Tambah versi teks pernyataan…</Button>
      {state.ok && !open ? <p role="status" className="text-sm text-success">{state.ok}</p> : null}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader className="pr-12">
            <DialogTitle>Tambah versi teks pernyataan isi paket</DialogTitle>
            <DialogDescription>
              Versi baru langsung berlaku untuk konfirmasi berikutnya di semua gerai. Versi lama tetap tersimpan di riwayat dan pada kiriman yang sudah dikonfirmasi.
            </DialogDescription>
          </DialogHeader>
          <form action={action} className="flex flex-col gap-5">
            {state.error ? <Notice tone="danger">{state.error}</Notice> : null}
            <FieldGroup className="gap-4">
              <Field>
                <FieldLabel htmlFor="decl-body">Teks pernyataan</FieldLabel>
                <Textarea id="decl-body" name="body" rows={3} required minLength={20} maxLength={2000} defaultValue={current?.body ?? ""} />
              </Field>
              <Field>
                <FieldLabel htmlFor="decl-categories">Kategori barang terlarang (satu per baris)</FieldLabel>
                <Textarea id="decl-categories" name="categories" rows={6} required defaultValue={current?.prohibited_categories.join("\n") ?? ""} />
              </Field>
              <Field>
                <FieldLabel htmlFor="decl-source">Sumber (URL https)</FieldLabel>
                <Input id="decl-source" name="source_url" type="url" required pattern="https://.*" defaultValue={current?.source_url ?? ""} />
              </Field>
              <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
                <input type="checkbox" name="provisional" defaultChecked className="size-5 accent-primary" />
                <span>Teks masih sementara (belum disetujui Mengantar/counsel)</span>
              </label>
              <Reason id="decl-reason" />
            </FieldGroup>
            <DialogFooter className="gap-3">
              <DialogClose asChild><Button type="button" variant="ghost">Batal</Button></DialogClose>
              <SubmitButton pendingLabel="Menyimpan…">Simpan versi baru</SubmitButton>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export type RulePrefill = {
  courier: string; service_class: "regular" | "cargo"; divisor: number | null; tolerance_grams: number | null;
  max_weight_grams: number | null; min_weight_grams: number | null; source_url: string; source_updated_at: string;
};

export function WeightRuleForm({ prefill }: { prefill: RulePrefill }) {
  const [state, action] = useActionState<FormState, FormData>(addWeightRuleAction, {});
  const [open, setOpen] = useDialogUntilSuccess(state);
  const name = `${prefill.courier} ${prefill.service_class === "cargo" ? "Kargo" : "Reguler"}`;
  const id = `${prefill.courier}-${prefill.service_class}`;
  const kg = (g: number | null) => (g === null ? "" : String(g / 1000));
  return (
    <div className="flex flex-col items-start gap-1">
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)} aria-haspopup="dialog">
        <span>Versi baru<span className="sr-only"> {name}</span>…</span>
      </Button>
      {state.ok && !open ? <p role="status" className="text-sm text-success">{state.ok}</p> : null}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader className="pr-12">
            <DialogTitle>Versi baru aturan {name}</DialogTitle>
            <DialogDescription>
              Ongkir berikutnya memakai versi ini sejak waktu berlaku. Kutipan dan kiriman yang sudah ada tetap memakai versinya sendiri. Kosongkan angka yang belum terverifikasi; jangan menebak.
            </DialogDescription>
          </DialogHeader>
          <form action={action} className="flex flex-col gap-5">
            {state.error ? <Notice tone="danger">{state.error}</Notice> : null}
            <input type="hidden" name="courier" value={prefill.courier} />
            <input type="hidden" name="service_class" value={prefill.service_class} />
            <FieldGroup className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor={`${id}-divisor`}>Pembagi volume</FieldLabel>
                <Input id={`${id}-divisor`} name="divisor" inputMode="numeric" defaultValue={prefill.divisor ?? ""} />
              </Field>
              <Field>
                <FieldLabel htmlFor={`${id}-tol`}>Toleransi (gram)</FieldLabel>
                <Input id={`${id}-tol`} name="tolerance_grams" inputMode="numeric" defaultValue={prefill.tolerance_grams ?? ""} />
              </Field>
              <Field>
                <FieldLabel htmlFor={`${id}-min`}>Minimum (kg)</FieldLabel>
                <Input id={`${id}-min`} name="min_kg" inputMode="numeric" defaultValue={kg(prefill.min_weight_grams)} />
              </Field>
              <Field>
                <FieldLabel htmlFor={`${id}-max`}>Maksimum (kg)</FieldLabel>
                <Input id={`${id}-max`} name="max_kg" inputMode="numeric" defaultValue={kg(prefill.max_weight_grams)} />
              </Field>
              <Field className="sm:col-span-2">
                <FieldLabel htmlFor={`${id}-src`}>Sumber (URL https)</FieldLabel>
                <Input id={`${id}-src`} name="source_url" type="url" required pattern="https://.*" defaultValue={prefill.source_url} />
              </Field>
              <Field>
                <FieldLabel htmlFor={`${id}-date`}>Tanggal sumber</FieldLabel>
                <Input id={`${id}-date`} name="source_updated_at" type="date" required defaultValue={prefill.source_updated_at} />
              </Field>
              <Field>
                <FieldLabel htmlFor={`${id}-eff`}>Berlaku mulai (WIB, kosong = sekarang)</FieldLabel>
                <Input id={`${id}-eff`} name="effective_at" type="datetime-local" />
              </Field>
            </FieldGroup>
            <Reason id={`${id}-reason`} />
            <DialogFooter className="gap-3">
              <DialogClose asChild><Button type="button" variant="ghost">Batal</Button></DialogClose>
              <SubmitButton pendingLabel="Menyimpan…">Simpan versi baru</SubmitButton>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
