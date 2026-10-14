import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { signOutAction } from "@/lib/auth-actions";
import { formatWib } from "@/lib/format";
import { supabaseServer } from "@/lib/supabase/server";
import { AcceptInvitationForm } from "@/modules/members/forms";
import { ROLE_LABEL } from "@/modules/members/labels";

export const metadata: Metadata = { title: "Undangan" };

type Invite = { id: string; tenant_name: string; role: string; expires_at: string };

// PR-31 / UX-8: invitations addressed to this verified email; nothing is granted until accepted.
export default async function InvitationsPage() {
  const supabase = await supabaseServer();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user || auth.user.is_anonymous) redirect("/masuk");
  const { data } = await supabase.rpc("my_invitations");
  const invites = (data ?? []) as Invite[];

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[560px] flex-col justify-center gap-6 px-5 py-12">
      <header className="flex flex-col gap-2">
        <p className="text-sm text-muted-foreground">GeraiExpress · {auth.user.email}</p>
        <h1 className="text-3xl tracking-tight">Undangan gerai</h1>
      </header>
      {invites.length === 0 ? (
        <p className="rounded-lg bg-card p-6 ring-1 ring-border">Tidak ada undangan aktif untuk email ini. Undangan berlaku 7 hari dan hanya untuk email yang diundang.</p>
      ) : (
        <ul className="divide-y divide-border rounded-lg bg-card ring-1 ring-border">
          {invites.map((x) => (
            <li key={x.id} className="flex flex-col gap-3 p-4" data-testid="my-invitation">
              <span>
                <span className="font-semibold">{x.tenant_name}</span>
                <span className="block text-sm text-muted-foreground">Sebagai {ROLE_LABEL[x.role] ?? x.role} · berlaku sampai {formatWib(x.expires_at)}</span>
              </span>
              <AcceptInvitationForm id={x.id} tenantName={x.tenant_name} />
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-3">
        <Button asChild variant="outline"><Link href="/">Lanjut tanpa menerima</Link></Button>
        <form action={signOutAction}><Button type="submit" variant="ghost">Keluar</Button></form>
      </div>
    </main>
  );
}
