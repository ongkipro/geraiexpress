import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

// UX-7: the registration journey always shows where the person is. A new gerai goes
// Email -> Kode -> Kata sandi -> Gerai -> Tinjauan; invited staff end at their invitation.
const JOURNEYS = {
  gerai: [["email", "Email"], ["kode", "Kode"], ["sandi", "Kata sandi"], ["gerai", "Gerai"], ["tinjauan", "Tinjauan"]],
  staf: [["email", "Email"], ["kode", "Kode"], ["sandi", "Kata sandi"], ["undangan", "Undangan"]],
} as const;

export type Journey = keyof typeof JOURNEYS;
export type Stage = (typeof JOURNEYS)[Journey][number][0];

// `current: "selesai"` marks every stage done (an approved gerai).
export function RegistrationSteps({ journey = "gerai", current }: { journey?: Journey; current: Stage | "selesai" }) {
  const steps = JOURNEYS[journey];
  const at = current === "selesai" ? steps.length : steps.findIndex(([key]) => key === current);
  return (
    <nav aria-label="Tahap pendaftaran">
      <ol className={cn("grid", steps.length === 5 ? "grid-cols-5" : "grid-cols-4")}>
        {steps.map(([key, label], i) => {
          const state = i < at ? "done" : i === at ? "current" : "upcoming";
          return (
            <li
              key={key}
              aria-current={state === "current" ? "step" : undefined}
              className={cn(
                "relative flex min-w-0 flex-col items-center gap-1.5 px-0.5 text-center",
                // Connector from the previous stage, drawn behind the markers.
                i > 0 && "before:absolute before:top-3.5 before:right-1/2 before:-left-1/2 before:h-px before:bg-border",
                i > 0 && i <= at && "before:bg-primary",
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "relative z-10 flex size-7 items-center justify-center rounded-full bg-card text-sm tabular",
                  state === "done" && "bg-primary text-primary-foreground",
                  state === "current" && "font-semibold text-primary ring-2 ring-primary",
                  state === "upcoming" && "text-muted-foreground ring-1 ring-border",
                )}
              >
                {state === "done" ? <Check className="size-4" strokeWidth={2.5} /> : i + 1}
              </span>
              <span className={cn("text-[13px] leading-tight break-words", state === "current" ? "font-semibold text-foreground" : "text-muted-foreground")}>
                {label}
                <span className="sr-only">{state === "done" ? " (selesai)" : state === "current" ? " (tahap saat ini)" : ""}</span>
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
