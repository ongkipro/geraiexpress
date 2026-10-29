import { AlertCircle, Check, Lock, PenLine } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

// C4: one step of the create flow. A numbered marker on a vertical spine (>= 768) or beside the
// title (< 768), one white frame per step, and the step state as icon + text: selesai (every field
// the step needs is filled), sedang diisi (open for input) or terkunci (an earlier step must finish
// first). The state is a hint; the server still validates every save.
export type StepState = "done" | "active" | "locked";

const STATE = {
  done: { label: "Selesai", icon: Check, variant: "success" },
  active: { label: "Sedang diisi", icon: PenLine, variant: "info" },
  locked: { label: "Terkunci", icon: Lock, variant: "neutral" },
} as const;

function StepMarker({ n, state, className }: { n: number; state: StepState; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold tabular",
        state === "done" && "bg-primary text-primary-foreground",
        state === "active" && "bg-card text-primary ring-2 ring-primary",
        state === "locked" && "bg-muted text-muted-foreground ring-1 ring-border",
        className,
      )}
    >
      {state === "done" ? <Check className="size-4" /> : n}
    </span>
  );
}

export function IntakeStep({
  n,
  total,
  title,
  state,
  description,
  last = false,
  children,
}: {
  n: number;
  total: number;
  title: string;
  state: StepState;
  description?: React.ReactNode;
  last?: boolean;
  children: React.ReactNode;
}) {
  const { label, icon: Icon, variant } = STATE[state];
  const headingId = `langkah-${n}`;
  return (
    <section aria-labelledby={headingId} className="grid grid-cols-[minmax(0,1fr)] md:grid-cols-[2rem_minmax(0,1fr)] md:gap-x-4" data-step-state={state}>
      <div aria-hidden="true" className="hidden md:flex md:flex-col md:items-center md:pt-5">
        <StepMarker n={n} state={state} />
        {last ? null : <span className={cn("mt-2 w-px flex-1", state === "done" ? "bg-primary" : "bg-border")} />}
      </div>
      <div className={cn("@container flex min-w-0 flex-col gap-5 rounded-lg bg-card p-5 ring-1 ring-border sm:p-6", last ? null : "mb-6")}>
        <header className="flex flex-col gap-1">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <StepMarker n={n} state={state} className="md:hidden" />
              <h2 id={headingId} className="text-xl">
                <span className="sr-only">Langkah {n} dari {total}: </span>
                {title}
              </h2>
            </div>
            <Badge variant={variant} className="shrink-0">
              <Icon aria-hidden="true" />
              {label}
            </Badge>
          </div>
          {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
        </header>
        {children}
      </div>
    </section>
  );
}

// Inline field error: icon + text (never color alone), referenced by the control's aria-describedby.
export function FieldMessage({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <p id={id} className="flex items-start gap-1.5 text-sm text-destructive">
      <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}
