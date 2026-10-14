"use client";

import { useActionState } from "react";
import { Turnstile, useCaptchaGate } from "@/components/turnstile";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signInAction, startDemoAction, type DemoState, type SignInState } from "@/lib/auth-actions";

export function SignInForm({ siteKey }: { siteKey: string | undefined }) {
  const [state, action, pending] = useActionState<SignInState, FormData>(signInAction, {});
  const { onToken, guard, hint } = useCaptchaGate();
  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      <div className="flex flex-col gap-2">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" autoComplete="email" inputMode="email" required
          defaultValue={state.email} aria-invalid={state.error ? true : undefined}
          aria-describedby={state.error ? "signin-error" : undefined} />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="password">Kata sandi</Label>
        <Input id="password" name="password" type="password" autoComplete="current-password" required
          aria-invalid={state.error ? true : undefined} aria-describedby={state.error ? "signin-error" : undefined} />
      </div>
      {state.error ? (
        <p id="signin-error" role="alert" className="text-sm text-foreground">
          <span aria-hidden="true">⚠ </span>{state.error}
        </p>
      ) : null}
      <Button type="submit" disabled={pending} aria-busy={pending} {...guard}>
        {pending ? "Memeriksa…" : "Masuk"}
      </Button>
      {hint}
      {/* Below the button: while verifying, the widget's frame can overflow its box and would
          otherwise cover the button and swallow the click. */}
      <Turnstile siteKey={siteKey} resetSignal={state} onToken={onToken} />
    </form>
  );
}

export function DemoEntry({ siteKey }: { siteKey: string | undefined }) {
  const [state, action, pending] = useActionState<DemoState, FormData>(startDemoAction, {});
  const { onToken, guard, hint } = useCaptchaGate();
  return (
    <form action={action} className="flex flex-col gap-3">
      <Button type="submit" variant="outline" disabled={pending} aria-busy={pending} {...guard}>
        {pending ? "Menyiapkan gerai contoh…" : "Coba demo"}
      </Button>
      {hint}
      <Turnstile siteKey={siteKey} resetSignal={state} onToken={onToken} />
      {state.error ? (
        <p role="alert" className="text-sm text-foreground"><span aria-hidden="true">⚠ </span>{state.error}</p>
      ) : null}
    </form>
  );
}
