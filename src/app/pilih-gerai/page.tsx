import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthCard, AuthFooter, AuthHeading, AuthShell, StatusAlert, authLinkClass } from "@/components/auth/auth-shell";
import { SubmitButton } from "@/components/submit-button";
import { signOutAction } from "@/lib/auth-actions";
import { dbServer } from "@/lib/db/server";
import { loadWorkspace } from "@/lib/workspace";
import { listSwitchableTenants } from "@/lib/workspace-switch";
import { TenantList } from "./tenant-list";

export const metadata: Metadata = { title: "Pilih gerai" };

// chooseTenantAction sends a refused selection back here with `galat` (SUP-14).
export default async function ChooseTenantPage({ searchParams }: { searchParams: Promise<{ galat?: string }> }) {
  const [current, { galat }] = await Promise.all([loadWorkspace(), searchParams]);
  let tenants: { id: string; name: string }[];
  let currentId: string | null = null;
  if (current.kind === "choose") {
    tenants = current.tenants;
  } else if (current.kind === "ready") {
    // A gerai is already selected: the page stays reachable for a user who has several (UX-11).
    tenants = await listSwitchableTenants(await dbServer(), current.workspace.userId);
    currentId = current.workspace.tenant.id;
    if (tenants.length < 2) redirect("/");
  } else {
    redirect("/");
  }

  return (
    <AuthShell>
      <AuthCard>
        <AuthHeading
          title="Pilih gerai"
          description={currentId
            ? "Akun Anda terdaftar di beberapa gerai. Pilih gerai lain, atau kembali ke gerai yang sedang dipakai."
            : "Akun Anda terdaftar di beberapa gerai. Pilih gerai yang ingin dikelola sekarang."}
        />
        {galat ? (
          <StatusAlert variant="destructive">Gerai itu tidak tersedia untuk akun Anda. Pilih salah satu gerai di bawah.</StatusAlert>
        ) : null}
        <TenantList tenants={tenants} currentId={currentId} />
      </AuthCard>
      <AuthFooter>
        {currentId ? <Link href="/" className={authLinkClass}>Kembali ke gerai yang sedang dipakai</Link> : null}
        <form action={signOutAction}>
          <SubmitButton variant="ghost" pendingLabel="Keluar…">Keluar</SubmitButton>
        </form>
      </AuthFooter>
    </AuthShell>
  );
}
