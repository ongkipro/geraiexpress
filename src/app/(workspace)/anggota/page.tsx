import type { Metadata } from "next";
import { appOrigin } from "@/lib/hosts";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatWib } from "@/lib/format";
import { dbServer } from "@/lib/db/server";
import { requireWorkspace } from "@/lib/workspace";
import { InviteForm, MemberControls, RevokeInvitationForm } from "@/modules/members/forms";
import { ROLE_LABEL } from "@/modules/members/labels";

export const metadata: Metadata = { title: "Anggota" };

type Member = { user_id: string; email: string; role: string; status: string; revision: number; is_self: boolean };
type Invitation = { id: string; email: string; role: string; expires_at: string; revision: number };

// One table markup for every width: below 768 each row stacks into a record card (CSS only), so
// every member and invitation exists once in the page.
const ROW = "flex flex-col gap-2.5 px-4 py-4 md:table-row md:px-0 md:py-0";
const CELL = "block min-h-0 p-0 md:table-cell md:min-h-12 md:px-3 md:py-3";

// PR-31 / DEC-008: tenant admins manage staff of the current gerai only; operators and demo
// sessions do not get this page (the database refuses their commands as well).
export default async function MembersPage() {
  const ws = await requireWorkspace();
  if (ws.role !== "tenant_admin" || ws.isDemo) notFound();
  const db = await dbServer();
  const [{ data: m }, { data: i }] = await Promise.all([
    db.rpc("tenant_members", { p_tenant: ws.tenant.id }),
    db.rpc("tenant_invitations_list", { p_tenant: ws.tenant.id }),
  ]);
  const members = ((m ?? []) as Member[]).filter((x) => x.status === "active");
  const invitations = (i ?? []) as Invitation[];
  // Environment-configured app origin, never the request's Host or X-Forwarded-* headers (PR-36).
  const signUpUrl = `${appOrigin()}/masuk`;

  return (
    <div className="flex max-w-[1040px] flex-col gap-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-3xl tracking-tight">Anggota</h1>
        <p className="text-[15px] text-muted-foreground">
          Staf {ws.tenant.name}. Operator bisa membuat dan menerbitkan pengiriman; admin gerai juga mengatur anggota dan pemulihan pengiriman.
        </p>
      </header>

      <section aria-labelledby="members-heading" className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="members-heading" className="text-xl">Anggota aktif</h2>
          <span className="text-sm text-muted-foreground tabular">{members.length} orang</span>
        </div>
        <div className="overflow-hidden rounded-lg bg-card ring-1 ring-border">
          <Table className="block text-[15px] md:table">
            <TableCaption className="sr-only">Anggota aktif {ws.tenant.name}</TableCaption>
            <TableHeader className="hidden md:table-header-group">
              <TableRow className="hover:bg-transparent">
                <TableHead scope="col" className="pl-4">Email</TableHead>
                <TableHead scope="col">Peran</TableHead>
                <TableHead scope="col" className="pr-4 text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="block md:table-row-group">
              {members.map((x) => (
                <TableRow key={x.user_id} className={`${ROW} border-border hover:bg-transparent`} data-testid="member">
                  <TableCell className={`${CELL} md:pl-4`}>
                    <span className="font-semibold break-all">{x.email}</span>
                    {x.is_self ? <span className="text-muted-foreground"> (Anda)</span> : null}
                  </TableCell>
                  <TableCell className={CELL}>
                    <Badge variant={x.role === "tenant_admin" ? "info" : "neutral"}>{ROLE_LABEL[x.role] ?? x.role}</Badge>
                  </TableCell>
                  <TableCell className={`${CELL} md:pr-4`}>
                    <MemberControls userId={x.user_id} email={x.email} role={x.role} revision={x.revision} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>

      <section aria-labelledby="pending-heading" className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="pending-heading" className="text-xl">Undangan menunggu</h2>
          {invitations.length > 0 ? <span className="text-sm text-muted-foreground tabular">{invitations.length} undangan</span> : null}
        </div>
        {invitations.length === 0 ? (
          <p className="rounded-lg bg-card px-4 py-5 text-[15px] text-muted-foreground ring-1 ring-border">
            Tidak ada undangan yang menunggu. Undang staf lewat formulir di bawah.
          </p>
        ) : (
          <div className="overflow-hidden rounded-lg bg-card ring-1 ring-border">
            <Table className="block text-[15px] md:table">
              <TableCaption className="sr-only">Undangan yang belum diterima</TableCaption>
              <TableHeader className="hidden md:table-header-group">
                <TableRow className="hover:bg-transparent">
                  <TableHead scope="col" className="pl-4">Email</TableHead>
                  <TableHead scope="col">Peran</TableHead>
                  <TableHead scope="col">Berlaku sampai</TableHead>
                  <TableHead scope="col" className="pr-4 text-right">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody className="block md:table-row-group">
                {invitations.map((x) => (
                  <TableRow key={x.id} className={`${ROW} border-border hover:bg-transparent`} data-testid="invitation">
                    <TableCell className={`${CELL} md:pl-4`}><span className="font-semibold break-all">{x.email}</span></TableCell>
                    <TableCell className={CELL}>
                      <Badge variant={x.role === "tenant_admin" ? "info" : "neutral"}>{ROLE_LABEL[x.role] ?? x.role}</Badge>
                    </TableCell>
                    <TableCell className={`${CELL} text-sm text-muted-foreground tabular md:whitespace-nowrap`}>
                      <span className="md:sr-only">Berlaku sampai </span>{formatWib(x.expires_at)}
                    </TableCell>
                    <TableCell className={`${CELL} md:pr-4`}>
                      <RevokeInvitationForm id={x.id} revision={x.revision} email={x.email} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      <section aria-labelledby="invite-heading" className="flex flex-col overflow-hidden rounded-lg bg-card ring-1 ring-border">
        <div className="flex flex-col gap-1 border-b border-border px-5 py-5 sm:px-6">
          <h2 id="invite-heading" className="text-xl">Undang staf</h2>
          <p className="text-[15px] text-muted-foreground">
            Undangan hanya bisa diterima oleh pemilik email tersebut setelah ia memverifikasi emailnya. Belum ada email otomatis; bagikan tautan masuk ke staf.
          </p>
        </div>
        <div className="px-5 py-5 sm:px-6">
          <InviteForm signUpUrl={signUpUrl} />
        </div>
      </section>
    </div>
  );
}
