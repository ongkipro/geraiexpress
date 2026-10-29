"use client";

import * as React from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Props = Omit<React.ComponentProps<typeof Button>, "type" | "asChild"> & {
  // Replaces the label while this button's submission is running. Both labels share one grid
  // cell, so the button keeps the width of the longer one and nothing around it moves.
  pendingLabel?: string;
};

// Whether a click on this submit button reaches the form's submit: a form that validates (no
// `noValidate`, no `formNoValidate`) with an invalid control is stopped by the browser first.
function willSubmit(button: { form: { noValidate: boolean; checkValidity: () => boolean } | null; formNoValidate: boolean }): boolean {
  const form = button.form;
  if (!form || form.noValidate || button.formNoValidate) return true;
  return form.checkValidity();
}

// UX-8 / UX-1: every money or provider action must refuse repeat clicks and say that it is
// working. Reads the enclosing form's status (`useFormStatus`), so it works with Server Actions
// and `useActionState` alike. While the form submits the button:
//  - stays focusable (aria-disabled, not `disabled`, so a keyboard user does not lose their place)
//    and swallows every further click or Enter-key submit, including one that lands in the same
//    tick before React has rendered the pending state;
//  - sets aria-busy, and shows `pendingLabel` when it is the button that was pressed.
// A genuinely `disabled` prop from the caller is passed through unchanged.
export function SubmitButton({ children, pendingLabel, onClick, className, ...props }: Props) {
  const { pending } = useFormStatus();
  const [pressed, setPressed] = React.useState(false);
  const locked = React.useRef(false);
  const sawPending = React.useRef(false);

  React.useEffect(() => {
    if (pending) {
      sawPending.current = true;
    } else if (sawPending.current) {
      sawPending.current = false;
      locked.current = false;
      setPressed(false);
    }
  }, [pending]);

  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    onClick?.(event);
    if (event.defaultPrevented) return;
    if (pending || locked.current) {
      event.preventDefault();
      return;
    }
    // Browser validation will block this click (empty required field): nothing is submitted, so
    // nothing may be locked, or the corrected resubmit would be swallowed.
    if (!willSubmit(event.currentTarget)) return;
    locked.current = true;
    setPressed(true);
    // If nothing submitted (another handler vetoed it later), do not stay locked forever.
    window.setTimeout(() => {
      if (!sawPending.current) {
        locked.current = false;
        setPressed(false);
      }
    }, 5000);
  };

  const showPending = pending && pressed;
  const blocked = pending || pressed;
  return (
    <Button
      {...props}
      type="submit"
      onClick={handleClick}
      aria-busy={pending || undefined}
      aria-disabled={blocked || props["aria-disabled"] || undefined}
      className={cn(blocked && "cursor-progress opacity-60", className)}
    >
      {pendingLabel ? (
        <span className="inline-grid">
          <span className={cn("col-start-1 row-start-1", showPending && "invisible")}>{children}</span>
          <span aria-hidden={!showPending} className={cn("col-start-1 row-start-1", !showPending && "invisible")}>{pendingLabel}</span>
        </span>
      ) : (
        children
      )}
    </Button>
  );
}
