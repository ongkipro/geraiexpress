"use client";

import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import {
  Building2, ClipboardCheck, Contact, LifeBuoy, LayoutDashboard, Package, PackagePlus, Percent, Plug, ScrollText, Settings, ShieldCheck, UserCog,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

// Icons are looked up by name because a Server Component cannot hand a component to a client one.
const ICONS = {
  "layout-dashboard": LayoutDashboard,
  package: Package,
  "package-plus": PackagePlus,
  contacts: Contact,
  members: UserCog,
  settings: Settings,
  tenants: Building2,
  review: ClipboardCheck,
  integration: Plug,
  discount: Percent,
  access: ShieldCheck,
  audit: ScrollText,
  cases: LifeBuoy,
} satisfies Record<string, LucideIcon>;

export type NavIcon = keyof typeof ICONS;
// `count` is a positive number of items needing action behind this link (shown as a badge).
export type NavItem = { href: string; label: string; icon?: NavIcon; group?: string; count?: number | null };

// Shown on the clicked item while the server renders the next page, so a slow round trip still
// gets instant feedback (a route-level loading.js would stream and turn 404s into 200s).
function Pending() {
  const { pending } = useLinkStatus();
  return <span aria-hidden className={cn("size-2 shrink-0 rounded-full bg-primary max-lg:hidden", pending ? "motion-safe:animate-pulse" : "hidden")} />;
}

// Highlights the most specific matching item, so "/admin" is not active on "/admin/akses".
// `rail` shows icons only between md and lg (the label stays in the accessible name); the
// mobile sheet and the full sidebar always show labels. The current item is a tinted pill with a
// 3px primary indicator; a count reads "3 perlu tindakan" to assistive technology.
export function WorkspaceNav({ onNavigate, items, rail = false }: { onNavigate?: () => void; items: NavItem[]; rail?: boolean }) {
  const path = usePathname();
  // "/" (Dashboard) matches only itself: "//" never prefixes a pathname.
  const matches = (href: string) => path === href || path.startsWith(`${href}/`);
  const best = items.filter((i) => matches(i.href)).sort((a, b) => b.href.length - a.href.length)[0]?.href;
  const groups = items.reduce<{ name: string | undefined; items: NavItem[] }[]>((acc, item) => {
    const last = acc[acc.length - 1];
    if (last && last.name === item.group) last.items.push(item);
    else acc.push({ name: item.group, items: [item] });
    return acc;
  }, []);
  return (
    <nav aria-label="Navigasi utama" className="flex flex-col gap-5">
      {groups.map((group, index) => (
        <div key={group.name ?? index} className="flex flex-col gap-1">
          {group.name ? (
            <p className={cn("px-3 pb-1 text-[13px] font-semibold tracking-wide text-muted-foreground uppercase", rail && "max-lg:sr-only")}>{group.name}</p>
          ) : null}
          <ul className="flex flex-col gap-0.5">
            {group.items.map((item) => {
              const Icon = item.icon ? ICONS[item.icon] : null;
              const current = item.href === best;
              const count = item.count && item.count > 0 ? item.count : null;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={current ? "page" : undefined}
                    className={cn(
                      "relative flex min-h-11 items-center gap-3 rounded-[10px] px-3 text-base transition-colors",
                      rail && "max-lg:justify-center max-lg:px-0",
                      current
                        ? "bg-info-soft font-semibold text-primary before:absolute before:top-1/2 before:left-0 before:h-5 before:w-[3px] before:-translate-y-1/2 before:rounded-full before:bg-primary"
                        : "text-foreground hover:bg-accent",
                    )}
                  >
                    {Icon ? <Icon className={cn("size-5 shrink-0", !current && "text-muted-foreground")} aria-hidden="true" /> : null}
                    <span className={cn("min-w-0 flex-1 truncate", rail && "max-lg:sr-only")}>{item.label}</span>{" "}
                    {count ? (
                      <span
                        className={cn(
                          "flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-warning-soft px-1.5 text-[13px] leading-none font-semibold text-warning tabular",
                          rail && "max-lg:absolute max-lg:top-0 max-lg:right-0 max-lg:ring-2 max-lg:ring-sidebar",
                        )}
                      >
                        {count}
                        <span className="sr-only"> perlu tindakan</span>
                      </span>
                    ) : null}
                    <Pending />
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
