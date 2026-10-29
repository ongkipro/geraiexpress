import Link from "next/link";
import { Plus, TriangleAlert } from "lucide-react";
import { AppHeaderBreadcrumb } from "@/components/app-header-breadcrumb";
import { SearchForm } from "@/components/app-header-search";
import { SubmitButton } from "@/components/submit-button";
import { createDraftAction } from "@/modules/shipments/actions";

// "3 perlu tindakan": a tinted warning chip (icon + number + words) linking to the exception list.
// Rendered only for a positive count; an unreadable count (null) shows nothing rather than a guess.
export function AttentionLink({ count }: { count: number | null }) {
  if (!count) return null;
  return (
    <Link
      href="/pengiriman#perlu-tindakan"
      prefetch={false}
      className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full bg-warning-soft px-3.5 text-[15px] font-semibold text-warning transition-colors hover:bg-warning-soft/70"
    >
      <TriangleAlert className="size-4" aria-hidden="true" />
      <span className="tabular">{count}</span>{" "}
      <span className="font-normal max-xl:sr-only">perlu tindakan</span>
    </Link>
  );
}

// C4: the header's primary action posts createDraftAction directly (redirects to the new draft).
// Icon-only with its name kept for assistive technology between 768 and 1023 px.
export function CreateShipmentButton() {
  return (
    <form action={createDraftAction} className="shrink-0">
      <SubmitButton className="max-lg:size-11 max-lg:px-0">
        <Plus className="size-5" aria-hidden="true" />
        <span className="max-lg:sr-only">Buat pengiriman</span>
      </SubmitButton>
    </form>
  );
}

// UX-16 app header, from 768 px: page context on the left (an optional scope, then the breadcrumb),
// then the gerai's global search, the attention count, the primary action and the account menu.
// Sticky, solid and hairline-separated (no blur); hidden in print.
export function AppHeader({
  scope,
  search = false,
  attention = null,
  action,
  account,
}: {
  scope?: React.ReactNode;
  search?: boolean;
  attention?: number | null;
  action?: React.ReactNode;
  account: React.ReactNode;
}) {
  return (
    <header className="sticky top-0 z-30 hidden border-b border-border bg-card md:block print:hidden">
      <div className="mx-auto flex h-16 w-full max-w-[1440px] items-center gap-2 px-6 lg:gap-3 lg:px-8">
        {scope}
        <div className="min-w-0 flex-1">
          <AppHeaderBreadcrumb />
        </div>
        {search ? <SearchForm id="gx-search" className="w-48 shrink lg:w-64 xl:w-80" /> : null}
        <AttentionLink count={attention} />
        {action}
        {account}
      </div>
    </header>
  );
}
