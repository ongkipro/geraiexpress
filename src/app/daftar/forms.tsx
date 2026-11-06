"use client";

import { useActionState, useState, useTransition } from "react";
import { CheckCircle2, Circle, Eye, EyeOff } from "lucide-react";
import { AuthHeading, InlineError, StatusAlert } from "@/components/auth/auth-shell";
import { CodeInput, useResetKey } from "@/components/auth/code-input";
import { RegistrationSteps } from "@/components/auth/registration-steps";
import { Turnstile, useCaptchaGate } from "@/components/turnstile";
import { SubmitButton } from "@/components/submit-button";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { codeStepError } from "./code-state";
import {
  changeEmailAction, requestCodeAction, saveApplicationAction, setPasswordAction, verifyCodeAction, withdrawApplicationAction,
  type CodeState, type FormState,
} from "@/lib/registration-actions";

function FormMessage({ error, ok }: { error?: string; ok?: string }) {
  if (error) return <StatusAlert variant="destructive">{error}</StatusAlert>;
  if (ok) return <StatusAlert variant="success">{ok}</StatusAlert>;
  return null;
}

function TextField({ name, label, state, defaultValue, type = "text", textarea, autoComplete, inputMode, hint }: {
  name: string; label: string; state: FormState; defaultValue?: string | null; type?: string; textarea?: boolean;
  autoComplete?: string; inputMode?: "tel" | "email" | "numeric"; hint?: string;
}) {
  const id = `f-${name}`;
  const error = state.fieldErrors?.[name];
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-err` : null].filter(Boolean).join(" ") || undefined;
  const props = { id, name, defaultValue: state.values?.[name] ?? defaultValue ?? "", "aria-invalid": error ? true : undefined, "aria-describedby": describedBy };
  return (
    <Field className="gap-2">
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      {textarea ? <Textarea {...props} rows={2} /> : <Input {...props} type={type} autoComplete={autoComplete ?? "off"} inputMode={inputMode} />}
      {hint ? <FieldDescription id={`${id}-hint`}>{hint}</FieldDescription> : null}
      {error ? <InlineError id={`${id}-err`}>{error}</InlineError> : null}
    </Field>
  );
}

// PR-29: email → 6-digit code, in one place, so a returning user simply signs in. While public
// registration is closed the same flow is the invited staff's way in.
export function CodeFlow({ siteKey, registrationOpen }: { siteKey: string | undefined; registrationOpen: boolean }) {
  const [requested, request] = useActionState<CodeState, FormData>(requestCodeAction, { step: "email" });
  // "Ganti email" is derived from the state object it was pressed on, so the next completed request
  // (a new state object) returns to the code step without an effect.
  const [changedFrom, setChangedFrom] = useState<CodeState | null>(null);
  const [verified, verify, verifying] = useActionState<CodeState, FormData>(
    (prev, form) => verifyCodeAction({ ...requested, ...prev, email: requested.email }, form), {});
  const [clearedVerification, setClearedVerification] = useState<CodeState | null>(null);
  const [changing, startChange] = useTransition();
  const journey = registrationOpen ? "gerai" : "staf";
  const closed = registrationOpen ? null : (
    <StatusAlert variant="info">
      Pendaftaran gerai baru belum dibuka. Jika Anda diundang sebagai staf, lanjutkan dengan email yang diundang.
    </StatusAlert>
  );

  if (requested.step !== "code" || changedFrom === requested) {
    return (
      <>
        <RegistrationSteps journey={journey} current="email" />
        <AuthHeading
          title={registrationOpen ? "Daftarkan gerai Anda" : "Masuk dengan kode email"}
          description="Mulai dengan email. Kami kirim kode 6 digit untuk memastikan email itu milik Anda."
        />
        {closed}
        <EmailStep siteKey={siteKey} state={requested} action={request} />
      </>
    );
  }
  const codeError = verified === clearedVerification ? undefined : codeStepError(verified, requested);
  return (
    <>
      <RegistrationSteps journey={journey} current="kode" />
      <AuthHeading title="Masukkan kode" description="Buka email Anda dan masukkan 6 digit kode yang kami kirim." />
      {closed}
      <VerifyForm siteKey={siteKey} state={verified} action={verify} notice={codeError ? undefined : requested.notice} error={codeError} email={requested.email} />
      <div className="flex flex-col gap-3 border-t border-border pt-5">
        <p className="text-[15px] text-muted-foreground">Belum menerima kode? Periksa folder spam, minta kode baru, atau ganti alamat email.</p>
        <ResendForm key={requested.email} siteKey={siteKey} email={requested.email ?? ""}>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={verifying || changing}
            onClick={() => startChange(async () => {
              await changeEmailAction();
              setClearedVerification(verified);
              setChangedFrom(requested);
            })}
          >
            Ganti email
          </Button>
        </ResendForm>
      </div>
    </>
  );
}

// The code step is CAPTCHA-protected too: the auth service checks the challenge before it looks at the code.
// Its own gate, like every form with a widget: a token is single-use, so each attempt needs a fresh one.
function VerifyForm({ siteKey, state, action, notice, error, email }: {
  siteKey: string | undefined; state: CodeState; action: (form: FormData) => void;
  notice: string | undefined; error: string | undefined; email: string | undefined;
}) {
  const { onToken, guard, hint } = useCaptchaGate();
  const attempt = useResetKey(state);
  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      {notice && !error ? <StatusAlert variant="info">{notice}</StatusAlert> : null}
      <CodeInput
        key={attempt}
        id="reg-code"
        label="Kode 6 digit dari email"
        hint={<>Kode dikirim ke <span className="font-semibold wrap-anywhere text-foreground">{email}</span>.</>}
        error={error}
        autoFocus
      />
      <SubmitButton pendingLabel="Memeriksa…" {...guard} className={cn("w-full", guard.className)}>Verifikasi</SubmitButton>
      {hint}
      <Turnstile siteKey={siteKey} resetSignal={state} onToken={onToken} />
    </form>
  );
}

function EmailStep({ siteKey, state, action }: {
  siteKey: string | undefined; state: CodeState; action: (form: FormData) => void;
}) {
  // Its own gate: a captcha token is single-use, so a fresh widget needs a fresh gate.
  const { onToken, guard, hint } = useCaptchaGate();
  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      <Field className="gap-2">
        <FieldLabel htmlFor="reg-email">Email</FieldLabel>
        <Input id="reg-email" name="email" type="email" autoComplete="email" inputMode="email" defaultValue={state.email} required
          aria-invalid={state.error ? true : undefined} aria-describedby={state.error ? "reg-email-err" : undefined} />
        {state.error ? <InlineError id="reg-email-err">{state.error}</InlineError> : null}
      </Field>
      <SubmitButton pendingLabel="Mengirim kode…" {...guard} className={cn("w-full", guard.className)}>Kirim kode</SubmitButton>
      {hint}
      <Turnstile siteKey={siteKey} resetSignal={state} onToken={onToken} />
    </form>
  );
}

// "Kirim ulang kode" runs the same server action as the first request, so the Turnstile check and
// the OTP limiter apply unchanged; each request needs a fresh token, hence its own widget and gate.
// `children` sits next to the resend button (a plain button, never a nested form).
function ResendForm({ siteKey, email, children }: { siteKey: string | undefined; email: string; children: React.ReactNode }) {
  const [state, resend] = useActionState<CodeState, FormData>(requestCodeAction, { step: "code", email });
  const { onToken, guard, hint } = useCaptchaGate();
  // The initial state has no notice, so a notice means a resend completed.
  const sent = state.step === "code" && Boolean(state.notice) && !state.error;
  return (
    <form action={resend} className="flex flex-col gap-3" noValidate>
      <input type="hidden" name="email" value={email} />
      <p role="status" className="text-[15px] text-success empty:hidden">{state.error ? "" : sent ? `Kode baru diminta untuk ${email}. Permintaan berikutnya baru dikirim setelah satu menit.` : ""}</p>
      {state.error ? <StatusAlert variant="destructive">{state.error}</StatusAlert> : null}
      <div className="flex flex-wrap gap-2">
        <SubmitButton variant="outline" size="sm" pendingLabel="Mengirim ulang…" {...guard}>Kirim ulang kode</SubmitButton>
        {children}
      </div>
      {hint}
      <Turnstile siteKey={siteKey} resetSignal={state} onToken={onToken} />
    </form>
  );
}

// The rules themselves live on the server (MIN/MAX_PASSWORD_LENGTH); the page passes them in so
// the live checklist always says the same as the server's errors.
export function PasswordForm({ minLength, maxLength }: { minLength: number; maxLength: number }) {
  const [state, action] = useActionState<FormState, FormData>(setPasswordAction, {});
  // Typed values belong to the attempt they were typed in: React resets the form after each one.
  const [typed, setTyped] = useState({ state, password: "", confirm: "" });
  const live = typed.state === state ? typed : { state, password: "", confirm: "" };
  const [shown, setShown] = useState(false);
  const rules = [
    { label: `${minLength} karakter atau lebih`, met: live.password.length >= minLength },
    { label: `Tidak lebih dari ${maxLength} karakter`, met: live.password.length > 0 && live.password.length <= maxLength },
    { label: "Kedua isian sama", met: live.confirm.length > 0 && live.confirm === live.password },
  ];
  const passwordError = state.fieldErrors?.password;
  const confirmError = state.fieldErrors?.confirm;
  const type = shown ? "text" : "password";
  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      <FormMessage error={state.error} />
      <Field className="gap-2">
        <FieldLabel htmlFor="f-password">Kata sandi baru</FieldLabel>
        <div className="relative">
          <Input id="f-password" name="password" type={type} autoComplete="new-password" className="pr-12"
            onChange={(e) => setTyped({ ...live, password: e.target.value })}
            aria-invalid={passwordError ? true : undefined}
            aria-describedby={["password-rules", passwordError ? "f-password-err" : null].filter(Boolean).join(" ")} />
          <Button type="button" variant="ghost" size="icon" className="absolute inset-y-0 right-0 rounded-sm"
            aria-pressed={shown} aria-controls="f-password f-confirm" onClick={() => setShown((v) => !v)}>
            {shown ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
            <span className="sr-only">{shown ? "Sembunyikan" : "Tampilkan"} kata sandi</span>
          </Button>
        </div>
        {passwordError ? <InlineError id="f-password-err">{passwordError}</InlineError> : null}
      </Field>
      <Field className="gap-2">
        <FieldLabel htmlFor="f-confirm">Ulangi kata sandi</FieldLabel>
        <Input id="f-confirm" name="confirm" type={type} autoComplete="new-password"
          onChange={(e) => setTyped({ ...live, confirm: e.target.value })}
          aria-invalid={confirmError ? true : undefined} aria-describedby={confirmError ? "f-confirm-err" : undefined} />
        {confirmError ? <InlineError id="f-confirm-err">{confirmError}</InlineError> : null}
      </Field>
      <ul id="password-rules" className="flex flex-col gap-1.5 text-[15px]">
        {rules.map((rule) => (
          <li key={rule.label} className={cn("flex items-center gap-2", rule.met ? "text-success" : "text-muted-foreground")}>
            {rule.met ? <CheckCircle2 aria-hidden="true" className="size-4 shrink-0" /> : <Circle aria-hidden="true" className="size-4 shrink-0" />}
            <span>{rule.label}<span className="sr-only">{rule.met ? ": terpenuhi" : ": belum"}</span></span>
          </li>
        ))}
      </ul>
      <SubmitButton pendingLabel="Menyimpan…" className="w-full">Simpan kata sandi</SubmitButton>
    </form>
  );
}

type Application = {
  id: string; revision: number; business_name: string | null; outlet_name: string | null;
  pickup_address: string | null; pickup_area: string | null; contact_phone: string | null;
};

const legendClass = "mb-1 text-base font-semibold";

export function ApplicationForm({ application }: { application: Application | null }) {
  const [state, action] = useActionState<FormState, FormData>(saveApplicationAction, {});
  const a = application;
  return (
    <form action={action} className="flex flex-col gap-8" noValidate>
      <FormMessage error={state.error} ok={state.ok} />
      <input type="hidden" name="revision" value={a?.revision ?? 0} />
      <FieldSet className="gap-4">
        <FieldLegend className={legendClass}>Identitas usaha</FieldLegend>
        <FieldGroup className="gap-5">
          <TextField name="business_name" label="Nama bisnis / gerai" state={state} defaultValue={a?.business_name} />
          <TextField name="outlet_name" label="Nama outlet pertama" state={state} defaultValue={a?.outlet_name} hint="Contoh: Outlet Dago. Outlet lain bisa ditambah setelah disetujui." />
        </FieldGroup>
      </FieldSet>
      <FieldSet className="gap-4">
        <FieldLegend className={legendClass}>Kontak</FieldLegend>
        <TextField name="contact_phone" label="No. HP penanggung jawab" type="tel" inputMode="tel" autoComplete="tel" state={state} defaultValue={a?.contact_phone} hint="Contoh: 081234567890." />
      </FieldSet>
      <FieldSet className="gap-4">
        <FieldLegend className={legendClass}>Alamat</FieldLegend>
        <FieldGroup className="gap-5">
          <TextField name="pickup_address" label="Alamat pickup outlet" textarea state={state} defaultValue={a?.pickup_address} />
          <TextField name="pickup_area" label="Kecamatan / kota" state={state} defaultValue={a?.pickup_area} />
        </FieldGroup>
      </FieldSet>
      {/* One submit area; on small screens it stays at the bottom of the viewport while the form scrolls. */}
      <div className="sticky bottom-0 z-10 -mx-5 flex flex-wrap gap-2 border-t border-border bg-card px-5 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:-mx-8 sm:px-8 md:static md:mx-0 md:border-0 md:p-0">
        {/* First in the DOM: Enter in a field submits for review, as before. Compact on small screens so both fit one row. */}
        <SubmitButton name="intent" value="submit" pendingLabel="Mengajukan…" className="grow px-4 max-md:text-[15px] md:grow-0 md:px-[22px]">Ajukan untuk ditinjau</SubmitButton>
        <SubmitButton name="intent" value="save" variant="outline" className="grow px-4 max-md:text-[15px] md:grow-0 md:px-[22px]">Simpan draf</SubmitButton>
      </div>
    </form>
  );
}

// T-107: withdrawing ends the application (a new one starts from scratch), so it confirms in a dialog
// that names the gerai. An error keeps the dialog open; success re-renders the page as withdrawn.
export function WithdrawForm({ id, revision, name }: { id: string; revision: number; name: string | null }) {
  // Pending is held outside the dialog so close + reopen cannot submit twice (T-107 review).
  const [state, action, pending] = useActionState<FormState, FormData>(withdrawApplicationAction, {});
  const title = name ? `Batalkan pengajuan ${name}?` : "Batalkan pengajuan gerai?";
  return (
    <div className="flex flex-col gap-3">
      {state.ok ? <FormMessage ok={state.ok} /> : null}
      <Dialog>
        <DialogTrigger asChild>
          <Button type="button" variant="ghost" className="self-start text-danger" disabled={pending} aria-busy={pending || undefined}>Batalkan pengajuan</Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader className="pr-12">
            <DialogTitle className="break-words">{title}</DialogTitle>
            <DialogDescription>
              Pengajuan ini berhenti dan tidak ditinjau. Untuk membuka gerai nanti, Anda mengisi pengajuan baru.
            </DialogDescription>
          </DialogHeader>
          <form action={action} className="flex flex-col gap-5">
            <FormMessage error={state.error} />
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="revision" value={revision} />
            <DialogFooter>
              <DialogClose asChild><Button type="button" variant="ghost">Kembali</Button></DialogClose>
              <SubmitButton variant="destructive" pendingLabel="Membatalkan…">Ya, batalkan pengajuan</SubmitButton>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
