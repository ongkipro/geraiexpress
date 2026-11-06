"use client";

import Link from "next/link";
import { useActionState } from "react";
import { StatusAlert } from "@/components/auth/auth-shell";
import { Turnstile, useCaptchaGate } from "@/components/turnstile";
import { SubmitButton } from "@/components/submit-button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { signInAction, startDemoAction, type DemoState, type SignInState } from "@/lib/auth-actions";
import { cn } from "@/lib/utils";

// `codeEntry`: the host also serves /daftar, so a forgotten password has a way in (an emailed code).
export function SignInForm({ siteKey, codeEntry }: { siteKey: string | undefined; codeEntry: boolean }) {
  const [state, action] = useActionState<SignInState, FormData>(signInAction, {});
  const { onToken, guard, hint } = useCaptchaGate();
  const describedBy = state.error ? "signin-error" : undefined;
  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      <FieldGroup className="gap-5">
        <Field className="gap-2">
          <FieldLabel htmlFor="email">Email</FieldLabel>
          <Input id="email" name="email" type="email" autoComplete="email" inputMode="email" required
            defaultValue={state.email} aria-invalid={state.error ? true : undefined} aria-describedby={describedBy} />
        </Field>
        <Field className="gap-2">
          <FieldLabel htmlFor="password">Kata sandi</FieldLabel>
          <Input id="password" name="password" type="password" autoComplete="current-password" required
            aria-invalid={state.error ? true : undefined} aria-describedby={describedBy} />
        </Field>
      </FieldGroup>
      {state.error ? (
        <StatusAlert variant="destructive" id="signin-error">
          {state.error}
          {codeEntry ? (
            <span className="mt-1 block">
              Lupa kata sandi? <Link href="/daftar" className="font-semibold whitespace-nowrap">Masuk dengan kode</Link>
            </span>
          ) : null}
        </StatusAlert>
      ) : null}
      <SubmitButton pendingLabel="Memeriksa…" {...guard} className={cn("w-full", guard.className)}>Masuk</SubmitButton>
      {hint}
      {/* Below the button: while verifying, the widget's frame can overflow its box and would
          otherwise cover the button and swallow the click. */}
      <Turnstile siteKey={siteKey} resetSignal={state} onToken={onToken} />
    </form>
  );
}

export function DemoEntry({ siteKey }: { siteKey: string | undefined }) {
  const [state, action] = useActionState<DemoState, FormData>(startDemoAction, {});
  const { onToken, guard, hint } = useCaptchaGate();
  return (
    <form action={action} className="flex flex-col gap-3">
      <SubmitButton variant="outline" pendingLabel="Menyiapkan gerai contoh…" {...guard} className={cn("w-full bg-card", guard.className)}>Coba demo</SubmitButton>
      {hint}
      <Turnstile siteKey={siteKey} resetSignal={state} onToken={onToken} />
      {state.error ? <StatusAlert variant="destructive">{state.error}</StatusAlert> : null}
    </form>
  );
}
