import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { formatWib } from "@/lib/format";
import { supabaseServer } from "@/lib/supabase/server";
import { requireWorkspace } from "@/lib/workspace";
import { InviteForm, MemberControls, RevokeInvitationForm } from "@/modules/members/forms";
import { ROLE_LABEL } from "@/modules/members/labels";

export const metadata: Metadata = { title: "Anggota" };

type Member = { user_id: string; email: string; role: string; status: string; revision: number; is_self: boolean };
type Invitation = { id: string; email: string; role: string; expires_at: string; revision: number };

// PR-31 / DEC-008: tenant admins manage staff of the current gerai only; operators and demo
// sessions do not get this page (the database refuses their commands as well).
export default async function MembersPage() {
  const ws = await requireWorkspace();
  if (ws.role !== "tenant_admin" || ws.isDemo) notFound();
  const supabase = await supabaseServer();
  const [{ data: m }, { data: i }] = await Promise.all([
    supabase.rpc("tenant_members", { p_tenant: ws.tenant.id }),
    supabase.rpc("tenant_invitations_list", { p_tenant: ws.tenant.id }),
  ]);
  const members = (m ?? []) as Member[];
  const invitations = (i ?? []) as Invitation[];
  const h = await headers();
  const signUpUrl = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host")}/masuk`;

  return (
    <div className="flex max-w-[980px] flex-col gap-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl tracking-tight">Anggota</h1>
        <p className="text-muted-foreground">Staf {ws.tenant.name}. Operator bisa membuat dan menerbitkan pengiriman; admin gerai juga mengatur anggota dan pemulihan pengiriman.</p>
      </div>

      <section aria-labelledby="members-heading" className="flex flex-col gap-3">
        <h2 id="members-heading" className="text-xl">Anggota aktif</h2>
        <ul className="divide-y divide-border rounded-lg bg-card ring-1 ring-border">
          {members.filter((x) => x.status === "active").map((x) => (
            <li key={x.user_id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between" data-testid="member">
              <span className="min-w-0">
                <span className="font-semibold break-all">{x.email}{x.is_self ? " (Anda)" : ""}</span>
                <span className="block text-sm text-muted-foreground">{ROLE_LABEL[x.role] ?? x.role}</span>
              </span>
              <MemberControls userId={x.user_id} email={x.email} role={x.role} revision={x.revision} />
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="pending-heading" className="flex flex-col gap-3">
        <h2 id="pending-heading" className="text-xl">Undangan menunggu</h2>
        {invitations.length === 0 ? (
          <p className="rounded-lg bg-card p-4 ring-1 ring-border">Tidak ada undangan yang menunggu.</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg bg-card ring-1 ring-border">
            {invitations.map((x) => (
              <li key={x.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-start sm:justify-between" data-testid="invitation">
                <span className="min-w-0">
                  <span className="font-semibold break-all">{x.email}</span>
                  <span className="block text-sm text-muted-foreground">{ROLE_LABEL[x.role]} · berlaku sampai {formatWib(x.expires_at)}</span>
                </span>
                <RevokeInvitationForm id={x.id} revision={x.revision} email={x.email} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="invite-heading" className="flex flex-col gap-3 rounded-lg bg-card p-6 ring-1 ring-border">
        <h2 id="invite-heading" className="text-xl">Undang staf</h2>
        <p className="text-sm text-muted-foreground">Undangan hanya bisa diterima oleh pemilik email tersebut setelah ia memverifikasi emailnya. Belum ada email otomatis; bagikan tautan masuk ke staf.</p>
        <InviteForm signUpUrl={signUpUrl} />
      </section>
    </div>
  );
}
