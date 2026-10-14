"use client";

import { useActionState } from "react";
import { Turnstile, useCaptchaGate } from "@/components/turnstile";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  requestCodeAction, saveApplicationAction, setPasswordAction, verifyCodeAction, withdrawApplicationAction,
  type CodeState, type FormState,
} from "@/lib/registration-actions";

function Alert({ error, ok }: { error?: string; ok?: string }) {
  if (error) return <p role="alert" className="rounded-md bg-card p-3 ring-1 ring-foreground"><span aria-hidden="true">⚠ </span>{error}</p>;
  if (ok) return <p role="status" className="rounded-md bg-card p-3 ring-1 ring-border">{ok}</p>;
  return null;
}

function Field({ name, label, state, defaultValue, type = "text", textarea, autoComplete, inputMode, hint }: {
  name: string; label: string; state: FormState; defaultValue?: string | null; type?: string; textarea?: boolean;
  autoComplete?: string; inputMode?: "tel" | "email" | "numeric"; hint?: string;
}) {
  const id = `f-${name}`;
  const error = state.fieldErrors?.[name];
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-err` : null].filter(Boolean).join(" ") || undefined;
  const props = { id, name, defaultValue: state.values?.[name] ?? defaultValue ?? "", "aria-invalid": error ? true : undefined, "aria-describedby": describedBy };
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      {hint ? <p id={`${id}-hint`} className="text-sm text-muted-foreground">{hint}</p> : null}
      {textarea ? <Textarea {...props} rows={2} /> : <Input {...props} type={type} autoComplete={autoComplete ?? "off"} inputMode={inputMode} />}
      {error ? <p id={`${id}-err`} className="text-sm"><span aria-hidden="true">⚠ </span>{error}</p> : null}
    </div>
  );
}

// PR-29: email → 6-digit code, in one place, so a returning user simply signs in.
export function CodeFlow({ siteKey }: { siteKey: string | undefined }) {
  const [requested, request, requesting] = useActionState<CodeState, FormData>(requestCodeAction, { step: "email" });
  const { onToken, guard, hint } = useCaptchaGate();
  const [verified, verify, verifying] = useActionState<CodeState, FormData>(
    (prev, form) => verifyCodeAction({ ...requested, ...prev, email: requested.email }, form), {});

  if (requested.step !== "code") {
    return (
      <form action={request} className="flex flex-col gap-4" noValidate>
        <Alert error={requested.error} />
        <div className="flex flex-col gap-2">
          <Label htmlFor="reg-email">Email</Label>
          <Input id="reg-email" name="email" type="email" autoComplete="email" inputMode="email" defaultValue={requested.email} required />
        </div>
        <Button type="submit" disabled={requesting} {...guard}>{requesting ? "Mengirim kode…" : "Kirim kode"}</Button>
        {hint}
        <Turnstile siteKey={siteKey} resetSignal={requested} onToken={onToken} />
      </form>
    );
  }
  return (
    <form action={verify} className="flex flex-col gap-4" noValidate>
      <Alert error={verified.error} ok={verified.error ? undefined : requested.notice} />
      <div className="flex flex-col gap-2">
        <Label htmlFor="reg-code">Kode 6 digit dari email</Label>
        <Input id="reg-code" name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={7} required />
      </div>
      <Button type="submit" disabled={verifying}>{verifying ? "Memeriksa…" : "Verifikasi"}</Button>
      <p className="text-sm text-muted-foreground">Kode untuk {requested.email}. Salah alamat? Muat ulang halaman ini.</p>
    </form>
  );
}

export function PasswordForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(setPasswordAction, {});
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <Alert error={state.error} />
      <Field name="password" label="Kata sandi baru" type="password" autoComplete="new-password" state={state} hint="Minimal 10 karakter." />
      <Field name="confirm" label="Ulangi kata sandi" type="password" autoComplete="new-password" state={state} />
      <Button type="submit" disabled={pending}>Simpan kata sandi</Button>
    </form>
  );
}

type Application = {
  id: string; revision: number; business_name: string | null; outlet_name: string | null;
  pickup_address: string | null; pickup_area: string | null; contact_phone: string | null;
};

export function ApplicationForm({ application }: { application: Application | null }) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveApplicationAction, {});
  const a = application;
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <Alert error={state.error} ok={state.ok} />
      <input type="hidden" name="revision" value={a?.revision ?? 0} />
      <Field name="business_name" label="Nama bisnis / gerai" state={state} defaultValue={a?.business_name} />
      <Field name="outlet_name" label="Nama outlet pertama" state={state} defaultValue={a?.outlet_name} hint="Contoh: Outlet Dago. Outlet lain bisa ditambah setelah disetujui." />
      <Field name="pickup_address" label="Alamat pickup outlet" textarea state={state} defaultValue={a?.pickup_address} />
      <Field name="pickup_area" label="Kecamatan / kota" state={state} defaultValue={a?.pickup_area} />
      <Field name="contact_phone" label="No. HP penanggung jawab" type="tel" inputMode="tel" autoComplete="tel" state={state} defaultValue={a?.contact_phone} />
      <div className="flex flex-wrap gap-3">
        <Button type="submit" name="intent" value="submit" disabled={pending}>Ajukan untuk ditinjau</Button>
        <Button type="submit" name="intent" value="save" variant="outline" disabled={pending}>Simpan draf</Button>
      </div>
    </form>
  );
}

export function WithdrawForm({ id, revision }: { id: string; revision: number }) {
  const [state, action, pending] = useActionState<FormState, FormData>(withdrawApplicationAction, {});
  return (
    <form action={action} className="flex flex-col gap-3">
      <Alert error={state.error} ok={state.ok} />
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="revision" value={revision} />
      <Button type="submit" variant="ghost" disabled={pending} className="self-start">Batalkan pengajuan</Button>
    </form>
  );
}
