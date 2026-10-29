import { Fragment } from "react";
import Link from "next/link";
import { Archive, CheckCircle2, CircleDashed, PauseCircle, ShieldCheck, type LucideIcon } from "lucide-react";
import { Notice } from "@/components/notice";
import { Badge } from "@/components/ui/badge";
import {
  Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { cn } from "@/lib/utils";

// UI-4 / C7: the Super Admin pages share one header grammar: the persistent "Platform" scope chip,
// a large title, one line of context, breadcrumbs only at depth >= 2 and actions right on >= 768.

export function PlatformChip() {
  return (
    <Badge variant="info" data-testid="platform-scope">
      <ShieldCheck aria-hidden="true" />
      Platform
    </Badge>
  );
}

type Crumb = { href: string; label: string };

export const LIFECYCLE: Record<string, { label: string; Icon: LucideIcon; variant: "success" | "destructive" | "pending" | "neutral" }> = {
  active: { label: "Aktif", Icon: CheckCircle2, variant: "success" },
  suspended: { label: "Dibekukan", Icon: PauseCircle, variant: "destructive" },
  provisioning: { label: "Menunggu persetujuan", Icon: CircleDashed, variant: "pending" },
  archived: { label: "Diarsipkan", Icon: Archive, variant: "neutral" },
};

export function LifecycleBadge({ lifecycle }: { lifecycle: string }) {
  const { label, Icon, variant } = LIFECYCLE[lifecycle] ?? LIFECYCLE.archived;
  return <Badge variant={variant}><Icon aria-hidden="true" />{label}</Badge>;
}

export function PageHeader({ title, description, crumbs, current, actions, meta }: {
  title: React.ReactNode;
  description?: React.ReactNode;
  // Parent pages, outermost first; the current page label closes the trail.
  crumbs?: Crumb[];
  current?: string;
  actions?: React.ReactNode;
  // Extra chips next to the scope chip (e.g. the Mengantar environment).
  meta?: React.ReactNode;
}) {
  return (
    <header className="flex flex-col gap-3">
      {crumbs ? (
        <Breadcrumb>
          <BreadcrumbList className="gap-1 text-sm">
            {crumbs.map((c) => (
              <Fragment key={c.href}>
                <BreadcrumbItem>
                  <BreadcrumbLink asChild className="inline-flex min-h-11 min-w-11 items-center">
                    <Link href={c.href}>{c.label}</Link>
                  </BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator />
              </Fragment>
            ))}
            {current ? (
              <BreadcrumbItem className="min-w-0">
                <BreadcrumbPage className="truncate">{current}</BreadcrumbPage>
              </BreadcrumbItem>
            ) : null}
          </BreadcrumbList>
        </Breadcrumb>
      ) : null}
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <PlatformChip />
            {meta}
          </div>
          <h1 className="text-3xl font-semibold tracking-tight break-words">{title}</h1>
          {description ? <p className="max-w-[70ch] text-muted-foreground">{description}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap gap-3 max-md:*:w-full">{actions}</div> : null}
      </div>
    </header>
  );
}

export function SectionHeader({ id, title, description, action }: {
  id: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="flex min-w-0 flex-col gap-1">
        <h2 id={id} className="text-xl font-semibold tracking-tight">{title}</h2>
        {description ? <p className="max-w-[70ch] text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {action ? <div className="flex shrink-0 flex-wrap gap-3">{action}</div> : null}
    </div>
  );
}

// Load failure with the next action (reload the same page).
export function LoadError({ children, href }: { children: React.ReactNode; href: string }) {
  return (
    <Notice tone="danger">
      <span>{children} </span>
      <Link href={href} className="inline-flex min-h-11 items-center font-semibold text-primary underline-offset-4 hover:underline">Muat ulang</Link>
    </Notice>
  );
}

export function EmptyState({ icon: Icon, title, description, action }: {
  icon: LucideIcon;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg bg-card px-6 py-10 text-center ring-1 ring-border">
      <span className="mb-1 flex size-11 items-center justify-center rounded-full bg-muted">
        <Icon className="size-5 text-muted-foreground" aria-hidden="true" />
      </span>
      <p className="text-lg font-semibold">{title}</p>
      {description ? <p className="max-w-[48ch] text-sm text-muted-foreground">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

// Segmented link navigation (tabs that are links, so the query parameter stays the source of truth).
export function SegmentedNav({ label, items, className }: {
  label: string;
  items: { href: string; label: string; current: boolean; count?: number }[];
  className?: string;
}) {
  return (
    <nav aria-label={label} className={cn("-mx-1 overflow-x-auto px-1 pb-1", className)}>
      <ul className="inline-flex min-w-max gap-1 rounded-full bg-muted p-1 ring-1 ring-border">
        {items.map((i) => (
          <li key={i.href}>
            <Link
              href={i.href}
              aria-current={i.current ? "page" : undefined}
              className={cn(
                "inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-full px-4 text-sm whitespace-nowrap transition-colors",
                i.current ? "bg-card font-semibold text-foreground ring-1 ring-border" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {i.label}
              {i.count !== undefined ? <span className="tabular text-muted-foreground">{i.count}</span> : null}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

// Responsive table: a real table on >= 768, the same rows as stacked record cards below it (one DOM,
// so locators and screen readers see each record once).
export const RT = {
  frame: "overflow-hidden rounded-lg bg-card ring-1 ring-border",
  table: "max-md:block",
  head: "max-md:hidden",
  body: "max-md:block",
  row: "hover:bg-transparent max-md:flex max-md:flex-col max-md:gap-1.5 max-md:p-4",
  cell: "align-top max-md:block max-md:min-h-0 max-md:p-0",
} as const;

// A label shown only on the stacked card (the table header carries it on wider screens).
export function CardLabel({ children }: { children: React.ReactNode }) {
  return <span className="text-muted-foreground md:sr-only">{children} </span>;
}
