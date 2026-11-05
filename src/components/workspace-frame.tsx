import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AppHeader, CreateShipmentButton } from "@/components/app-header";
import { AccountMenu, type AccountAction } from "@/components/app-header-account";
import { MobileSearch } from "@/components/app-header-search";
import { AppShell } from "@/components/app-shell";
import { SubmitButton } from "@/components/submit-button";
import type { NavItem } from "@/components/workspace-nav";
import { resetDemoAction, signOutAction } from "@/lib/auth-actions";
import { TENANT_COOKIE, requireWorkspace } from "@/lib/workspace";
import { attentionCount } from "@/modules/shell/attention";

// UX-11: leave the current gerai without signing out. Only the selector cookie is cleared; the
// session stays, and /pilih-gerai lists the memberships and validates the next choice against them.
async function switchWorkspaceAction() {
  "use server";
  (await cookies()).delete(TENANT_COOKIE);
  redirect("/pilih-gerai");
}

const ROLE_LABEL = { tenant_admin: "Admin gerai", operator: "Operator" } as const;

// "owner-a@x" -> "OA"; a demo session has no email, so the gerai's first letter stands in.
function personInitials(email: string | null, fallback: string): string {
  const parts = (email?.split("@")[0] ?? "").split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  return (parts.slice(0, 2).map((p) => p.charAt(0)).join("") || fallback).toUpperCase();
}

// UI-1 / UX-11 / UX-16: the gerai workspace frame (sidebar, app header, mobile top bar, demo banner)
// around any page that runs inside a gerai: the `(workspace)` route group and the Dashboard at "/".
export async function WorkspaceFrame({ children }: { children: React.ReactNode }) {
  const ws = await requireWorkspace();
  const hasSeveralGerai = ws.activeMembershipCount > 1;
  const attention = await attentionCount(ws.tenant.id);
  const gerai = ws.tenant.name.trim().charAt(0).toUpperCase() || "G";
  // DEC-008: member management is a tenant-admin page of a real gerai.
  const items: NavItem[] = [
    { href: "/", label: "Dashboard", icon: "layout-dashboard" },
    { href: "/pengiriman", label: "Pengiriman", icon: "package", group: "Kirim", count: attention },
    { href: "/pengiriman/baru", label: "Buat pengiriman", icon: "package-plus", group: "Kirim" },
    { href: "/kas", label: "Kas", icon: "audit", group: "Data" },
    { href: "/kontak", label: "Kontak", icon: "contacts", group: "Data" },
    ...(ws.role === "tenant_admin" && !ws.isDemo ? [{ href: "/anggota", label: "Anggota", icon: "members", group: "Pengelolaan" } as NavItem] : []),
    { href: "/pengaturan", label: "Pengaturan", icon: "settings", group: "Pengelolaan" },
  ];
  const role = ws.isDemo ? "Mode demo" : ROLE_LABEL[ws.role];

  const scope = (
    <div className="flex min-w-0 flex-col">
      <span className="truncate font-semibold" data-testid="tenant-name">{ws.tenant.name}</span>
      <span className="truncate text-sm text-muted-foreground" data-testid="outlet-name">{ws.outlet.name}</span>
    </div>
  );
  // From 768 px the session actions live in the account menu; below it they stay in the menu sheet.
  const actions: AccountAction[] = [
    ...(hasSeveralGerai ? [{ label: "Ganti gerai", pendingLabel: "Membuka…", icon: "switch", action: switchWorkspaceAction } as const] : []),
    ...(ws.isDemo ? [{ label: "Atur ulang demo", pendingLabel: "Mengatur ulang…", icon: "reset", action: resetDemoAction } as const] : []),
    { label: "Keluar", pendingLabel: "Keluar…", icon: "sign-out", action: signOutAction },
  ];
  const session = (
    <div className="flex flex-col gap-2">
      {hasSeveralGerai ? (
        <form action={switchWorkspaceAction}>
          <SubmitButton variant="outline" size="sm" className="w-full" pendingLabel="Membuka…">Ganti gerai</SubmitButton>
        </form>
      ) : null}
      {ws.isDemo ? (
        <form action={resetDemoAction}>
          <SubmitButton variant="secondary" size="sm" className="w-full" pendingLabel="Mengatur ulang…">Atur ulang demo</SubmitButton>
        </form>
      ) : null}
      <form action={signOutAction}>
        <SubmitButton variant="ghost" size="sm" className="w-full justify-start" pendingLabel="Keluar…">Keluar</SubmitButton>
      </form>
    </div>
  );

  return (
    <AppShell
      brand="GeraiExpress"
      scope={scope}
      scopeNote={role}
      initials={gerai}
      items={items}
      session={session}
      header={
        <AppHeader
          scope={
            <div className="flex min-w-0 max-w-44 shrink-0 items-center gap-3 border-r border-border pr-3 text-[15px] lg:hidden">
              {scope}
            </div>
          }
          search
          attention={attention}
          action={<CreateShipmentButton />}
          account={
            <AccountMenu
              initials={personInitials(ws.email, gerai)}
              title={ws.tenant.name}
              details={[ws.outlet.name, role, ...(ws.email ? [ws.email] : [])]}
              actions={actions}
            />
          }
        />
      }
      mobileActions={<MobileSearch />}
      banner={ws.isDemo ? (
        <div role="status" className="border-b border-border bg-info-soft px-4 py-2 text-sm text-info md:px-6 lg:px-8 print:hidden">
          <strong className="font-semibold">Demo · Simulasi.</strong> Harga, resi dan label di sini adalah contoh,
          bukan transaksi Mengantar sungguhan.
        </div>
      ) : null}
    >
      {children}
    </AppShell>
  );
}
