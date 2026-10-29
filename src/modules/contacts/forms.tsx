"use client";

import { useActionState, useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { SubmitButton } from "@/components/submit-button";
import { addAddressAction, archiveContactAction, createContactAction, updateContactAction, type ContactState } from "./actions";

function Field({ name, label, state, defaultValue, type = "text", inputMode, textarea, className }: {
  name: string; label: string; state: ContactState; defaultValue?: string; type?: string;
  inputMode?: "tel" | "numeric"; textarea?: boolean; className?: string;
}) {
  const id = `c-${name}`;
  const error = state.fieldErrors?.[name];
  const value = state.values?.[name] ?? defaultValue ?? "";
  const props = { id, name, defaultValue: value, "aria-invalid": error ? true : undefined, "aria-describedby": error ? `${id}-err` : undefined };
  return (
    <div className={`flex flex-col gap-2 ${className ?? ""}`}>
      <Label htmlFor={id}>{label}</Label>
      {textarea ? <Textarea {...props} rows={2} /> : <Input {...props} type={type} inputMode={inputMode} autoComplete="off" />}
      {error ? <p id={`${id}-err`} className="text-sm text-danger"><span aria-hidden="true">⚠ </span>{error}</p> : null}
    </div>
  );
}

function Status({ state }: { state: ContactState }) {
  if (state.error) return <p role="alert" className="rounded-md bg-danger-soft p-3 text-[15px] text-danger"><span aria-hidden="true">⚠ </span>{state.error}</p>;
  if (state.ok) return <p role="status" className="rounded-md bg-success-soft p-3 text-[15px] text-success">{state.ok}</p>;
  return null;
}

function Roles({ state, sender, recipient }: { state: ContactState; sender?: boolean; recipient?: boolean }) {
  const v = state.values;
  return (
    <fieldset className="flex flex-col gap-2" aria-describedby={state.fieldErrors?.role ? "c-role-err" : undefined}>
      <legend className="mb-2 text-sm font-semibold">Dipakai sebagai</legend>
      <div className="flex flex-wrap gap-x-6">
        <label className="flex min-h-11 items-center gap-3"><Checkbox name="is_sender" defaultChecked={v ? v.is_sender === "on" : sender} /> Pengirim</label>
        <label className="flex min-h-11 items-center gap-3"><Checkbox name="is_recipient" defaultChecked={v ? v.is_recipient === "on" : recipient} /> Penerima</label>
      </div>
      {state.fieldErrors?.role ? <p id="c-role-err" className="text-sm text-danger"><span aria-hidden="true">⚠ </span>{state.fieldErrors.role}</p> : null}
    </fieldset>
  );
}

function NewContactForm() {
  const [state, action, pending] = useActionState<ContactState, FormData>(createContactAction, {});
  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      <Status state={state} />
      <Field name="name" label="Nama" state={state} />
      <Field name="phone" label="No. HP" type="tel" inputMode="tel" state={state} />
      <Roles state={state} recipient />
      <details className="group rounded-md ring-1 ring-border" open={Boolean(state.values?.address_line)}>
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-4 font-semibold text-primary [&::-webkit-details-marker]:hidden">
          <Plus className="size-4 transition-transform group-open:rotate-45" aria-hidden="true" />
          Tambahkan alamat (opsional)
        </summary>
        <div className="grid gap-4 border-t border-border p-4">
          <Field name="label" label="Label alamat" state={state} />
          <Field name="address_line" label="Alamat lengkap" state={state} textarea />
          <Field name="area" label="Kecamatan / kota" state={state} />
          <Field name="postal_code" label="Kode pos" inputMode="numeric" state={state} />
        </div>
      </details>
      <Button type="submit" className="w-full sm:w-auto sm:self-start" disabled={pending} aria-busy={pending}>{pending ? "Menyimpan…" : "Simpan kontak"}</Button>
    </form>
  );
}

// New contact in a sheet: the list stays the page; saving opens the new contact.
export function NewContactSheet({ label = "Tambah kontak", className }: { label?: string; className?: string }) {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button className={className}>{label}</Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-full overflow-y-auto data-[side=right]:w-full sm:data-[side=right]:max-w-lg">
        <SheetHeader className="pr-16">
          <SheetTitle>Tambah kontak</SheetTitle>
          <SheetDescription>Pengirim atau penerima yang sering dipakai. Kontak bukan akun login.</SheetDescription>
        </SheetHeader>
        <div className="px-6 pb-6">
          <NewContactForm />
        </div>
      </SheetContent>
    </Sheet>
  );
}

export function EditContactForm({ contact }: { contact: { id: string; revision: number; name: string; phone: string; is_sender: boolean; is_recipient: boolean } }) {
  const [state, action, pending] = useActionState<ContactState, FormData>(updateContactAction, {});
  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      <input type="hidden" name="contact_id" value={contact.id} />
      <input type="hidden" name="revision" value={contact.revision} />
      <Status state={state} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field name="name" label="Nama" state={state} defaultValue={contact.name} />
        <Field name="phone" label="No. HP" type="tel" inputMode="tel" state={state} defaultValue={contact.phone} />
      </div>
      <Roles state={state} sender={contact.is_sender} recipient={contact.is_recipient} />
      <Button type="submit" variant="outline" className="w-full sm:w-auto sm:self-start" disabled={pending} aria-busy={pending}>{pending ? "Menyimpan…" : "Simpan perubahan"}</Button>
    </form>
  );
}

export function AddAddressForm({ contactId }: { contactId: string }) {
  const [state, action, pending] = useActionState<ContactState, FormData>(addAddressAction, {});
  return (
    <form action={action} className="flex flex-col gap-5" noValidate key={state.ok ? Date.now() : "form"}>
      <input type="hidden" name="contact_id" value={contactId} />
      <Status state={state} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field name="label" label="Label alamat" state={state} className="sm:col-span-2" />
        <Field name="address_line" label="Alamat lengkap" state={state} textarea className="sm:col-span-2" />
        <Field name="area" label="Kecamatan / kota" state={state} />
        <Field name="postal_code" label="Kode pos" inputMode="numeric" state={state} />
      </div>
      <Button type="submit" variant="outline" className="w-full sm:w-auto sm:self-start" disabled={pending}>Tambah alamat</Button>
    </form>
  );
}

// Archiving hides the contact from the active list and the intake picker, so it confirms in a
// dialog first; confirmed shipments keep their own copy of the data.
export function ArchiveContactForm({ contact }: { contact: { id: string; revision: number; name: string } }) {
  const [state, action] = useActionState<ContactState, FormData>(archiveContactAction, {});
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="w-full border-danger text-danger sm:w-auto sm:self-start">Arsipkan kontak</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader className="pr-12">
          <DialogTitle>Arsipkan kontak?</DialogTitle>
          <DialogDescription>
            <span className="font-semibold break-words text-foreground">{contact.name}</span> hilang dari daftar kontak aktif dan
            pilihan kontak saat membuat pengiriman. Pengiriman lama tidak berubah.
          </DialogDescription>
        </DialogHeader>
        <form action={action} className="flex flex-col gap-5">
          <input type="hidden" name="contact_id" value={contact.id} />
          <input type="hidden" name="revision" value={contact.revision} />
          <Status state={state} />
          <DialogFooter>
            <DialogClose asChild><Button type="button" variant="ghost">Batal</Button></DialogClose>
            <SubmitButton variant="destructive" pendingLabel="Mengarsipkan…">Arsipkan kontak</SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
