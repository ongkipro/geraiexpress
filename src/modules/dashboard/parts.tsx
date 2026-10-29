import Link from "next/link";
import type { ReactNode } from "react";
import { AlertTriangle, RotateCw } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

// Dashboard building blocks. One surface level only (no card inside a card): a white frame with a
// hairline and the softest shadow; inner grouping uses dividers.
export const SURFACE = "rounded-lg bg-card ring-1 ring-border shadow-xs";

export function Surface({ className, children, ...props }: React.ComponentProps<"section">) {
  return <section className={cn(SURFACE, "flex min-w-0 flex-col", className)} {...props}>{children}</section>;
}

// UX-16 (4): a demo workspace labels every figure "contoh".
export function SampleTag({ show }: { show: boolean }) {
  if (!show) return null;
  return <span className="inline-flex h-5 shrink-0 items-center rounded-full bg-info-soft px-2 text-xs font-normal tracking-normal text-info">contoh</span>;
}

export function RegionHeading({ id, title, sample, aside, description }: {
  id: string; title: string; sample: boolean; aside?: ReactNode; description?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-5 pt-5 sm:px-6">
      <div className="flex min-w-0 flex-col gap-0.5">
        <h2 id={id} className="flex flex-wrap items-center gap-2 text-[19px] leading-tight tracking-tight">
          {title}
          <SampleTag show={sample} />
        </h2>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {aside}
    </div>
  );
}

// A region whose read failed: says so and offers the next action (reload this page).
export function RegionError({ title, href }: { title: string; href: string }) {
  return (
    <Surface aria-label={title} className="gap-3 p-5 sm:p-6">
      <h2 className="text-[19px] leading-tight tracking-tight">{title}</h2>
      <p className="flex items-start gap-2 text-[15px] text-danger" role="alert">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        Bagian ini belum bisa dimuat.
      </p>
      <Link href={href} prefetch={false} className="inline-flex min-h-11 items-center gap-2 self-start text-[15px] text-primary hover:underline">
        <RotateCw className="size-4" aria-hidden="true" /> Muat ulang
      </Link>
    </Surface>
  );
}

export function RegionSkeleton({ title, lines = 3, className }: { title: string; lines?: number; className?: string }) {
  return (
    <Surface aria-label={title} aria-busy="true" className={cn("gap-4 p-5 sm:p-6", className)}>
      <h2 className="text-[19px] leading-tight tracking-tight">{title}</h2>
      <span className="sr-only">Memuat…</span>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className="h-10 rounded-md motion-reduce:animate-none" />
      ))}
    </Surface>
  );
}

const AVATAR_TONES = ["bg-info-soft text-info", "bg-pending-soft text-pending", "bg-success-soft text-success", "bg-warning-soft text-warning"];

// A person (the recipient) as initials; the tone is derived from the name so it stays stable.
export function Initials({ name }: { name: string | null }) {
  // Words that start with a letter or digit only: "Sari (contoh)" reads "S", not "S(".
  const words = (name ?? "").trim().split(/\s+/).filter((w) => /^[\p{L}\p{N}]/u.test(w));
  const initials = words.length === 0 ? "?" : (words[0][0] + (words.length > 1 ? words[words.length - 1][0] : "")).toUpperCase();
  let hash = 0;
  for (const ch of name ?? "") hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return (
    <span aria-hidden="true" className={cn("flex size-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold", AVATAR_TONES[hash % AVATAR_TONES.length])}>
      {initials}
    </span>
  );
}
