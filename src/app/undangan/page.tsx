import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CalendarClock, Mail, Store, UserRound } from "lucide-react";
import { AuthCard, AuthFooter, AuthHeading, AuthShell, authLinkClass } from "@/components/auth/auth-shell";
import { SubmitButton } from "@/components/submit-button";
import { Separator } from "@/components/ui/separator";
import { signOutAction } from "@/lib/auth-actions";
import { formatWib } from "@/lib/format";
import { currentUser, dbServer } from "@/lib/db/server";
import { AcceptInvitationForm } from "@/modules/members/forms";
import { ROLE_LABEL } from "@/modules/members/labels";

export const metadata: Metadata = { title: "Undangan" };

type Invite = { id: string; tenant_name: string; role: string; expires_at: string; invited_by_email: string | null };

// PR-31 / UX-8: invitations addressed to this verified email; nothing is granted until accepted.
// Signed in with another address, the way out is to sign out and come back with the invited one.
export default async function InvitationsPage() {
  const user = await currentUser();
  if (!user || user.isAnonymous) redirect("/masuk");
  const db = await dbServer();
  const { data } = await db.rpc("my_invitations");
  const invites = (data ?? []) as Invite[];
  const account = <span className="font-semibold text-foreground wrap-anywhere">{user.email}</span>;

  return (
    <AuthShell>
      <AuthCard>
        <AuthHeading
          eyebrow={<>Masuk sebagai {account}</>}
          title={invites.length === 0 ? "Belum ada undangan" : "Undangan gerai"}
          description={invites.length === 0
            ? <>Tidak ada undangan aktif untuk {account}. Undangan berlaku 7 hari dan hanya untuk email yang diundang.</>
            : "Terima undangan untuk mulai bekerja di gerai itu. Akses baru berlaku setelah Anda menerimanya."}
        />

        {invites.length > 0 ? (
          <ul className="flex flex-col divide-y divide-border">
            {invites.map((x) => (
              <li key={x.id} className="flex flex-col gap-4 py-4 first:pt-0 last:pb-0" data-testid="my-invitation">
                <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 gap-y-2 text-[15px]">
                  <dt className="flex items-center gap-2 text-muted-foreground"><Store aria-hidden="true" className="size-4" />Gerai</dt>
                  <dd className="font-semibold break-words">{x.tenant_name}</dd>
                  <dt className="flex items-center gap-2 text-muted-foreground"><UserRound aria-hidden="true" className="size-4" />Peran</dt>
                  <dd>{ROLE_LABEL[x.role] ?? x.role}</dd>
                  <dt className="flex items-center gap-2 text-muted-foreground"><CalendarClock aria-hidden="true" className="size-4" />Berlaku</dt>
                  <dd className="tabular">sampai {formatWib(x.expires_at)}</dd>
                  {x.invited_by_email ? (
                    <>
                      <dt className="flex items-center gap-2 text-muted-foreground"><Mail aria-hidden="true" className="size-4" />Diundang oleh</dt>
                      <dd className="wrap-anywhere" data-testid="invitation-inviter">{x.invited_by_email}</dd>
                    </>
                  ) : null}
                </dl>
                <AcceptInvitationForm id={x.id} tenantName={x.tenant_name} />
              </li>
            ))}
          </ul>
        ) : null}

        <Separator />
        <section aria-labelledby="other-account" className="flex flex-col gap-3">
          <h2 id="other-account" className="text-base font-semibold">
            {invites.length === 0 ? "Diundang dengan email lain?" : "Bukan email yang diundang?"}
          </h2>
          <p className="text-[15px] text-muted-foreground">
            Undangan hanya bisa diterima oleh email yang dituju. Keluar, lalu masuk dengan email yang tertulis di undangan.
          </p>
          <form action={signOutAction}>
            <SubmitButton variant={invites.length === 0 ? "default" : "outline"} className="w-full" pendingLabel="Keluar…">Keluar dan ganti akun</SubmitButton>
          </form>
        </section>
      </AuthCard>
      <AuthFooter>
        <Link href="/" className={authLinkClass}>Lanjut tanpa menerima</Link>
      </AuthFooter>
    </AuthShell>
  );
}
