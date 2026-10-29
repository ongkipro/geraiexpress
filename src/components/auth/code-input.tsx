"use client";

import { useState } from "react";
import { REGEXP_ONLY_DIGITS } from "input-otp";
import { InlineError } from "@/components/auth/auth-shell";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { cn } from "@/lib/utils";

// UI-5: a 6-digit one-time code as six boxes over one real input, so the whole code is still
// submitted as a single `name` value, a pasted "123 456" fills every box and the platform
// offers the code from the mail or SMS (autocomplete=one-time-code). Remount it (a `key`) after
// each attempt to clear it, like the browser resets a plain form.
export function CodeInput({ id, name = "code", label, hint, error, autoFocus }: {
  id: string;
  name?: string;
  label: string;
  hint?: React.ReactNode;
  error?: string;
  autoFocus?: boolean;
}) {
  const hintId = `${id}-hint`;
  const errorId = `${id}-err`;
  return (
    <Field className="gap-2">
      <FieldLabel htmlFor={id} className="text-base">{label}</FieldLabel>
      <InputOTP
        id={id}
        name={name}
        maxLength={6}
        pattern={REGEXP_ONLY_DIGITS}
        inputMode="numeric"
        autoComplete="one-time-code"
        pasteTransformer={(pasted) => pasted.replace(/\D/g, "")}
        pushPasswordManagerStrategy="none"
        autoFocus={autoFocus}
        aria-invalid={error ? true : undefined}
        // The error alone while it shows: it is what the person must act on.
        aria-describedby={error ? errorId : hint ? hintId : undefined}
        containerClassName="w-fit max-w-full"
      >
        <InputOTPGroup className="gap-2">
          {[0, 1, 2, 3, 4, 5].map((index) => (
            <InputOTPSlot
              key={index}
              index={index}
              className={cn(
                "size-11 rounded-sm border border-input bg-card text-xl tabular text-foreground first:rounded-sm first:border-l last:rounded-sm sm:size-12",
                error && "border-2 border-danger",
              )}
            />
          ))}
        </InputOTPGroup>
      </InputOTP>
      {hint ? <FieldDescription id={hintId}>{hint}</FieldDescription> : null}
      {error ? <InlineError id={errorId}>{error}</InlineError> : null}
    </Field>
  );
}

// A key that changes whenever `signal` (an action state) is a new object: pass it as the
// CodeInput `key` so every completed attempt starts from empty boxes.
export function useResetKey(signal: unknown): number {
  const [seen, setSeen] = useState({ signal, key: 0 });
  if (seen.signal === signal) return seen.key;
  const next = { signal, key: seen.key + 1 };
  setSeen(next);
  return next.key;
}
