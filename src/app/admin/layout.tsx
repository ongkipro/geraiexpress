import { ShieldCheck } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { AccountMenu } from "@/components/app-header-account";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import type { NavItem } from "@/components/workspace-nav";
import { signOutAction } from "@/lib/auth-actions";
import { requirePlatform, type Capability } from "@/lib/platform";

const ITEMS: (NavItem & { capability: Capability })[] = [
  { href: "/admin", label: "Gerai", icon: "tenants", group: "Gerai", capability: "tenant_governance" },
  { href: "/admin/pengajuan", label: "Pengajuan gerai", icon: "review", group: "Gerai", capability: "tenant_governance" },
  { href: "/admin/integrasi", label: "Integrasi Mengantar", icon: "integration", group: "Operasional", capability: "integration_operations" },
  { href: "/admin/diskon", label: "Diskon gerai", icon: "discount", group: "Operasional", capability: "integration_operations" },
  { href: "/admin/akses", label: "Akses Super Admin", icon: "access", group: "Keamanan", capability: "access_governance" },
  { href: "/admin/audit", label: "Audit", icon: "audit", group: "Keamanan", capability: "audit_review" },
];

// PR-24 / TEN-4: a separate platform workspace with its own explicit context; it grants no
// tenant membership and shows no customer data. UX-16: the same header with its own scope chip and
// an account menu that only signs out (no search, no gerai actions).
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await requirePlatform();
  const items: NavItem[] = ITEMS.filter((i) => session.capabilities.includes(i.capability)).map(({ capability: _capability, ...item }) => item);
  const initials = (session.email?.charAt(0) || "S").toUpperCase();

  const scope = (
    <div className="flex min-w-0 flex-col">
      <span className="truncate font-semibold">Super Admin</span>
      <span className="truncate text-sm text-muted-foreground" data-testid="platform-email">{session.email}</span>
    </div>
  );
  const sessionActions = (
    <form action={signOutAction}>
      <Button type="submit" variant="ghost" size="sm" className="w-full justify-start">Keluar</Button>
    </form>
  );

  return (
    <AppShell
      brand="GeraiExpress"
      scope={scope}
      scopeNote="Tanpa akses data pelanggan gerai"
      initials="P"
      items={items}
      session={sessionActions}
      header={
        <AppHeader
          scope={
            <span className="inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-full bg-info-soft px-3 text-sm font-semibold text-info">
              <ShieldCheck className="size-4" aria-hidden="true" />
              Super Admin
            </span>
          }
          account={
            <AccountMenu
              initials={initials}
              title="Super Admin"
              details={session.email ? [session.email] : []}
              actions={[{ label: "Keluar", pendingLabel: "Keluar…", icon: "sign-out", action: signOutAction }]}
            />
          }
        />
      }
    >
      {children}
    </AppShell>
  );
}
