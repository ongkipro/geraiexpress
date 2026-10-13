"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { addAddressAction, createContactAction, updateContactAction, type ContactState } from "./actions";

function Field({ name, label, state, defaultValue, type = "text", inputMode, textarea }: {
  name: string; label: string; state: ContactState; defaultValue?: string; type?: string;
  inputMode?: "tel" | "numeric"; textarea?: boolean;
}) {
  const id = `c-${name}`;
  const error = state.fieldErrors?.[name];
  const value = state.values?.[name] ?? defaultValue ?? "";
  const props = { id, name, defaultValue: value, "aria-invalid": error ? true : undefined, "aria-describedby": error ? `${id}-err` : undefined };
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      {textarea ? <Textarea {...props} rows={2} /> : <Input {...props} type={type} inputMode={inputMode} autoComplete="off" />}
      {error ? <p id={`${id}-err`} className="text-sm"><span aria-hidden="true">⚠ </span>{error}</p> : null}
    </div>
  );
}

function Status({ state }: { state: ContactState }) {
  if (state.error) return <p role="alert" className="rounded-md bg-card p-3 ring-1 ring-foreground"><span aria-hidden="true">⚠ </span>{state.error}</p>;
  if (state.ok) return <p role="status" className="rounded-md bg-card p-3 ring-1 ring-border">{state.ok}</p>;
  return null;
}

function Roles({ state, sender, recipient }: { state: ContactState; sender?: boolean; recipient?: boolean }) {
  const v = state.values;
  return (
    <fieldset className="flex flex-col gap-2" aria-describedby={state.fieldErrors?.role ? "c-role-err" : undefined}>
      <legend className="text-sm font-semibold">Dipakai sebagai</legend>
      <div className="flex flex-wrap gap-6">
        <label className="flex min-h-11 items-center gap-3"><Checkbox name="is_sender" defaultChecked={v ? v.is_sender === "on" : sender} /> Pengirim</label>
        <label className="flex min-h-11 items-center gap-3"><Checkbox name="is_recipient" defaultChecked={v ? v.is_recipient === "on" : recipient} /> Penerima</label>
      </div>
      {state.fieldErrors?.role ? <p id="c-role-err" className="text-sm"><span aria-hidden="true">⚠ </span>{state.fieldErrors.role}</p> : null}
    </fieldset>
  );
}

export function NewContactForm() {
  const [state, action, pending] = useActionState<ContactState, FormData>(createContactAction, {});
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <Status state={state} />
      <div className="grid gap-4 md:grid-cols-2">
        <Field name="name" label="Nama" state={state} />
        <Field name="phone" label="No. HP" type="tel" inputMode="tel" state={state} />
      </div>
      <Roles state={state} recipient />
      <details className="rounded-md bg-muted p-4" open={Boolean(state.values?.address_line)}>
        <summary className="min-h-11 cursor-pointer content-center font-semibold">Tambahkan alamat (opsional)</summary>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <Field name="label" label="Label alamat" state={state} />
          <Field name="address_line" label="Alamat lengkap" state={state} textarea />
          <Field name="area" label="Kecamatan / kota" state={state} />
          <Field name="postal_code" label="Kode pos" inputMode="numeric" state={state} />
        </div>
      </details>
      <Button type="submit" className="self-start" disabled={pending} aria-busy={pending}>{pending ? "Menyimpan…" : "Simpan kontak"}</Button>
    </form>
  );
}

export function EditContactForm({ contact }: { contact: { id: string; revision: number; name: string; phone: string; is_sender: boolean; is_recipient: boolean } }) {
  const [state, action, pending] = useActionState<ContactState, FormData>(updateContactAction, {});
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <input type="hidden" name="contact_id" value={contact.id} />
      <input type="hidden" name="revision" value={contact.revision} />
      <Status state={state} />
      <div className="grid gap-4 md:grid-cols-2">
        <Field name="name" label="Nama" state={state} defaultValue={contact.name} />
        <Field name="phone" label="No. HP" type="tel" inputMode="tel" state={state} defaultValue={contact.phone} />
      </div>
      <Roles state={state} sender={contact.is_sender} recipient={contact.is_recipient} />
      <Button type="submit" variant="outline" className="self-start" disabled={pending} aria-busy={pending}>{pending ? "Menyimpan…" : "Simpan perubahan"}</Button>
    </form>
  );
}

export function AddAddressForm({ contactId }: { contactId: string }) {
  const [state, action, pending] = useActionState<ContactState, FormData>(addAddressAction, {});
  return (
    <form action={action} className="flex flex-col gap-4" noValidate key={state.ok ? Date.now() : "form"}>
      <input type="hidden" name="contact_id" value={contactId} />
      <Status state={state} />
      <div className="grid gap-4 md:grid-cols-2">
        <Field name="label" label="Label alamat" state={state} />
        <Field name="address_line" label="Alamat lengkap" state={state} textarea />
        <Field name="area" label="Kecamatan / kota" state={state} />
        <Field name="postal_code" label="Kode pos" inputMode="numeric" state={state} />
      </div>
      <Button type="submit" variant="outline" className="self-start" disabled={pending}>Tambah alamat</Button>
    </form>
  );
}
