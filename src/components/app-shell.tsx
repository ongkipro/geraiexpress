import { PackageCheck } from "lucide-react";
import { MobileNav } from "@/components/mobile-nav";
import { WorkspaceNav, type NavItem } from "@/components/workspace-nav";

// UI-1 / UX-11 / UX-16 / UI-4: one shell for the gerai workspace and the Super Admin workspace.
//  >= 1024  sidebar: brand, scope card, grouped navigation; app header (breadcrumb, search, action, account)
//  768-1023 icon rail (labels stay in the accessible name) beside the same app header
//  < 768    top bar with the scope, an optional search button and a menu sheet carrying navigation and
//           session actions
// The current scope (gerai and outlet, or "Platform") is visible at every width. The sticky bars are
// kept clear of focused controls by the document's scroll padding (WCAG 2.4.11).
export function AppShell({
  brand,
  scope,
  scopeNote,
  initials,
  items,
  session,
  header,
  mobileActions,
  banner,
  children,
}: {
  brand: string;
  scope: React.ReactNode;
  // A short line under the scope in the sidebar card (role or workspace kind).
  scopeNote?: string;
  initials: string;
  items: NavItem[];
  // Session actions for the mobile sheet; from 768 px they live in the header's account menu.
  session: React.ReactNode;
  header: React.ReactNode;
  mobileActions?: React.ReactNode;
  banner?: React.ReactNode;
  children: React.ReactNode;
}) {
  const mark = (
    <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-primary text-base font-semibold text-primary-foreground">
      {initials}
    </span>
  );
  return (
    <div className="min-h-dvh md:grid md:grid-cols-[72px_minmax(0,1fr)] lg:grid-cols-[264px_minmax(0,1fr)] print:block print:bg-white [html:has(&)]:scroll-pt-[72px]">
      <a href="#konten" className="print:hidden sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-sm focus:bg-card focus:p-3">
        Lewati ke konten
      </a>
      <div className="hidden border-r border-border bg-sidebar md:block print:hidden">
        <aside className="sticky top-0 flex h-dvh flex-col">
          <div className="flex h-16 shrink-0 items-center gap-2.5 border-b border-border px-3 max-lg:justify-center lg:px-5">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-foreground text-background">
              <PackageCheck className="size-5" aria-hidden="true" />
            </span>
            <p className="truncate text-[17px] font-semibold tracking-tight max-lg:sr-only">{brand}</p>
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-6 p-3 lg:p-4">
            <div className="flex flex-col gap-3 rounded-xl bg-muted p-3 max-lg:hidden">
              <div className="flex min-w-0 items-center gap-3">
                {mark}
                {scope}
              </div>
              {scopeNote ? <p className="border-t border-border pt-2.5 text-sm text-muted-foreground">{scopeNote}</p> : null}
            </div>
            <WorkspaceNav items={items} rail />
          </div>
        </aside>
      </div>

      <div className="flex min-w-0 flex-col">
        {header}
        <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-border bg-card py-2 pr-2 pl-2 md:hidden print:hidden">
          <MobileNav items={items}>{session}</MobileNav>
          <div className="flex min-w-0 flex-1 items-center gap-3">
            {mark}
            {scope}
          </div>
          {mobileActions}
        </header>
        {banner}
        <main id="konten" tabIndex={-1} className="mx-auto w-full max-w-[1440px] flex-1 px-4 py-6 md:px-6 lg:px-8 lg:py-8 print:p-0">
          {children}
        </main>
      </div>
    </div>
  );
}
