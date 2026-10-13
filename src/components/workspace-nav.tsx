"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const ITEMS = [
  { href: "/pengiriman", label: "Pengiriman" },
  { href: "/pengiriman/baru", label: "Buat pengiriman" },
  { href: "/kontak", label: "Kontak" },
  { href: "/pengaturan", label: "Pengaturan" },
];

export function WorkspaceNav({ onNavigate }: { onNavigate?: () => void }) {
  const path = usePathname();
  const active = (href: string) =>
    href === "/pengiriman" ? path === href || (path.startsWith("/pengiriman/") && !path.startsWith("/pengiriman/baru")) : path.startsWith(href);
  return (
    <nav aria-label="Navigasi utama">
      <ul className="flex flex-col gap-1">
        {ITEMS.map((item) => (
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
