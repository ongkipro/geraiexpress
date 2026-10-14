"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export type NavItem = { href: string; label: string };

const ITEMS: NavItem[] = [
  { href: "/pengiriman", label: "Pengiriman" },
  { href: "/pengiriman/baru", label: "Buat pengiriman" },
  { href: "/kontak", label: "Kontak" },
  { href: "/pengaturan", label: "Pengaturan" },
];

// Highlights the most specific matching item, so "/admin" is not active on "/admin/akses".
export function WorkspaceNav({ onNavigate, items = ITEMS }: { onNavigate?: () => void; items?: NavItem[] }) {
  const path = usePathname();
  const matches = (href: string) => path === href || path.startsWith(`${href}/`);
  const best = items.filter((i) => matches(i.href)).sort((a, b) => b.href.length - a.href.length)[0]?.href;
  const active = (href: string) => href === best;
  return (
    <nav aria-label="Navigasi utama">
      <ul className="flex flex-col gap-1">
        {items.map((item) => (
          <li key={item.href}>
            <Link
              href={item.href}
              onClick={onNavigate}
              aria-current={active(item.href) ? "page" : undefined}
              className={cn(
                "flex min-h-11 items-center rounded-sm px-3 text-base",
                active(item.href) ? "bg-accent font-semibold text-primary" : "text-foreground hover:bg-accent",
              )}
            >
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
