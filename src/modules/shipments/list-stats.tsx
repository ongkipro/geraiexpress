import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type ListStat = {
  label: string;
  hint: string;
  count: number | null;
  href: string;
  icon: LucideIcon;
  tone: "text-warning" | "text-success";
  active: boolean;
};

// C3 stat strip: actionable counts, each a link into the filtered list. One frame, hairline
// dividers, no per-stat cards. Tone sits on the icon only; the label carries the meaning.
export function StatStrip({ stats }: { stats: ListStat[] }) {
  return (
    <nav aria-label="Ringkasan tindakan">
      <ul className="grid grid-cols-3 divide-x divide-border overflow-hidden rounded-lg bg-card ring-1 ring-border">
        {stats.map(({ label, hint, count, href, icon: Icon, tone, active }) => (
          <li key={label} className="min-w-0">
            <Link
              href={href}
              prefetch={false}
              aria-current={active ? "true" : undefined}
              className={cn(
                "flex h-full min-h-11 flex-col gap-1 px-2 py-3 transition-colors hover:bg-muted min-[400px]:px-3 sm:px-5 sm:py-4",
                active && "bg-accent ring-2 ring-primary ring-inset",
              )}
            >
              {/* Below 640 px the icon sits above the label, and below 400 px the label is 13 px, so a long word
                  ("pembayaran") fits a third of a 320 px screen. */}
              <span className="flex flex-col items-start gap-1 text-[13px] text-muted-foreground min-[400px]:text-sm sm:flex-row sm:gap-1.5">
                <Icon className={cn("size-4 shrink-0 sm:mt-0.5", tone)} aria-hidden="true" />
                <span className="min-w-0 [overflow-wrap:anywhere]">{label}</span>
              </span>
              <span className="text-2xl font-semibold tracking-tight tabular sm:text-3xl">{count ?? "—"}</span>
              <span className="hidden text-sm text-muted-foreground sm:block">{hint}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
