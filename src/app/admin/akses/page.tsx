import type { Metadata } from "next";
import { CheckCircle2, KeyRound, ShieldAlert, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatWib } from "@/lib/format";
import { CAPABILITY_LABELS, requirePlatform, type Capability } from "@/lib/platform";
import { dbServer } from "@/lib/db/server";
import { cn } from "@/lib/utils";
import { GrantForm, RevokeForm } from "../forms";
import { EmptyState, LoadError, PageHeader, RT, SectionHeader } from "../ui";

export const metadata: Metadata = { title: "Akses Super Admin" };

type AdminRow = {
  user_id: string; email: string; capabilities: Capability[]; granted_at: string;
  revoked_at: string | null; revision: number; has_totp: boolean;
};

// PR-24 / DEC-008: governed grants. The database keeps at least one access governor with a
// verified authenticator; there is no public promotion path.
export default async function PlatformAccessPage() {
  await requirePlatform("access_governance");
  const db = await dbServer();
  const { data: raw, error } = await db.rpc("platform_admins");
  const data = (raw ?? []) as AdminRow[];
  const capabilities = Object.entries(CAPABILITY_LABELS).map(([value, label]) => ({ value, label }));

  return (
    <div className="flex max-w-[1160px] flex-col gap-8">
      <PageHeader
        title="Akses Super Admin"
        description="Setiap perubahan butuh alasan dan tercatat di audit. Admin baru wajib memasang autentikator saat pertama masuk."
      />

      <section aria-labelledby="admins-heading" className="flex flex-col gap-4">
        <SectionHeader id="admins-heading" title="Admin platform" />
        {error ? (
          <LoadError href="/admin/akses">Daftar admin belum bisa dimuat.</LoadError>
        ) : data.length === 0 ? (
          <EmptyState icon={Users} title="Belum ada admin platform" description="Beri akses lewat formulir di bawah." />
        ) : (
          <div className={RT.frame}>
            <Table className={RT.table}>
              <TableHeader className={RT.head}>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Admin</TableHead>
                  <TableHead>Kemampuan</TableHead>
                  <TableHead>Autentikator</TableHead>
                  <TableHead className="text-right"><span className="sr-only">Tindakan</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody className={RT.body}>
                {data.map((a) => (
                  <TableRow key={a.user_id} data-testid="platform-admin" className={cn(RT.row, a.revoked_at && "text-muted-foreground")}>
                    <TableCell className={cn(RT.cell, "min-w-0")}>
                      <span className="block font-semibold break-words md:whitespace-nowrap">{a.email}</span>
                      <span className="block text-sm text-muted-foreground">
                        {a.revoked_at ? `Dicabut ${formatWib(a.revoked_at)}` : `Aktif sejak ${formatWib(a.granted_at)}`}
                      </span>
                    </TableCell>
                    <TableCell className={RT.cell}>
                      <span className="sr-only">Kemampuan: </span>
                      <ul className="flex flex-wrap gap-1.5 md:max-w-[340px]">
                        {a.capabilities.map((c) => (
                          <li key={c}><Badge variant="neutral" className="whitespace-normal">{CAPABILITY_LABELS[c] ?? c}</Badge></li>
                        ))}
                      </ul>
                    </TableCell>
                    <TableCell className={RT.cell}>
                      {a.has_totp ? (
                        <Badge variant="success"><CheckCircle2 aria-hidden="true" />Autentikator terpasang</Badge>
                      ) : (
                        <Badge variant="warning"><ShieldAlert aria-hidden="true" />Autentikator belum dipasang</Badge>
                      )}
                    </TableCell>
                    <TableCell className={cn(RT.cell, "max-md:pt-2 md:text-right")}>
                      {a.revoked_at ? null : <RevokeForm userId={a.user_id} email={a.email} revision={a.revision} />}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      <section aria-labelledby="grant-heading" className="flex max-w-[760px] flex-col gap-5 rounded-lg bg-card p-5 ring-1 ring-border md:p-6">
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted" aria-hidden="true">
            <KeyRound className="size-5 text-muted-foreground" />
          </span>
          <div className="flex flex-col gap-1">
            <h2 id="grant-heading" className="text-xl font-semibold tracking-tight">Beri atau ubah akses</h2>
            <p className="text-sm text-muted-foreground">Mengubah akses akun yang sudah ada menggantikan seluruh kemampuannya.</p>
          </div>
        </div>
        <GrantForm capabilities={capabilities} />
      </section>
    </div>
  );
}
