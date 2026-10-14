import { Button } from "@/components/ui/button";
import { MobileNav } from "@/components/mobile-nav";
import { WorkspaceNav } from "@/components/workspace-nav";

const BASE_ITEMS = [
  { href: "/pengiriman", label: "Pengiriman" },
  { href: "/pengiriman/baru", label: "Buat pengiriman" },
  { href: "/kontak", label: "Kontak" },
];
import { resetDemoAction, signOutAction } from "@/lib/auth-actions";
import { requireWorkspace } from "@/lib/workspace";

export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const ws = await requireWorkspace();
  // DEC-008: member management is a tenant-admin page of a real gerai.
  const items = [...BASE_ITEMS, ...(ws.role === "tenant_admin" && !ws.isDemo ? [{ href: "/anggota", label: "Anggota" }] : []), { href: "/pengaturan", label: "Pengaturan" }];

  const scope = (
    <div className="flex min-w-0 flex-col">
      <span className="truncate font-semibold" data-testid="tenant-name">{ws.tenant.name}</span>
      <span className="truncate text-sm text-muted-foreground" data-testid="outlet-name">{ws.outlet.name}</span>
    </div>
  );
  const sessionActions = (
    <div className="flex flex-col gap-2">
      {ws.isDemo ? (
        <form action={resetDemoAction}>
          <Button type="submit" variant="secondary" size="sm" className="w-full">Atur ulang demo</Button>
        </form>
      ) : null}
      <form action={signOutAction}>
        <Button type="submit" variant="ghost" size="sm" className="w-full justify-start">Keluar</Button>
      </form>
    </div>
  );

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[264px_minmax(0,1fr)] print:block print:bg-white">
      <a href="#konten" className="print:hidden sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-sm focus:bg-card focus:p-3">
        Lewati ke konten
      </a>
      <div className="hidden border-r border-border bg-sidebar lg:block print:hidden">
      <aside className="flex flex-col gap-8 p-5 lg:sticky lg:top-0 lg:h-dvh">
        <p className="text-sm text-muted-foreground">GeraiExpress</p>
        {scope}
        <WorkspaceNav items={items} />
        <div className="mt-auto">{sessionActions}</div>
      </aside>
      </div>

      <div className="flex min-w-0 flex-col">
        <header className="print:hidden sticky top-0 z-30 flex items-center gap-3 border-b border-border bg-background/95 px-4 py-2 backdrop-blur lg:hidden">
          <MobileNav items={items}>{sessionActions}</MobileNav>
          {scope}
        </header>
        {ws.isDemo ? (
          <div role="status" className="border-b border-border bg-card px-4 py-2 text-sm lg:px-8 print:hidden">
            <strong className="font-semibold">Demo · Simulasi.</strong> Harga, resi dan label di sini adalah contoh,
            bukan transaksi Mengantar sungguhan.
          </div>
        ) : null}
        <main id="konten" tabIndex={-1} className="mx-auto w-full max-w-[1440px] flex-1 px-4 py-6 lg:px-8 lg:py-8 print:p-0">
          {children}
        </main>
      </div>
    </div>
  );
}
