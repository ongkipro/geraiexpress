import type { Metadata } from "next";
import { formatWib } from "@/lib/format";
import { CAPABILITY_LABELS, requirePlatform, type Capability } from "@/lib/platform";
import { supabaseServer } from "@/lib/supabase/server";
import { GrantForm, RevokeForm } from "../forms";

export const metadata: Metadata = { title: "Akses Super Admin" };

type AdminRow = {
  user_id: string; email: string; capabilities: Capability[]; granted_at: string;
  revoked_at: string | null; revision: number; has_totp: boolean;
};

// PR-24 / DEC-008: governed grants. The database keeps at least one access governor with a
// verified authenticator; there is no public promotion path.
export default async function PlatformAccessPage() {
  await requirePlatform("access_governance");
  const supabase = await supabaseServer();
  const { data: raw, error } = await supabase.rpc("platform_admins");
  const data = (raw ?? []) as AdminRow[];
  const capabilities = Object.entries(CAPABILITY_LABELS).map(([value, label]) => ({ value, label }));

  return (
    <div className="flex max-w-[980px] flex-col gap-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl tracking-tight">Akses Super Admin</h1>
        <p className="text-muted-foreground">Setiap perubahan butuh alasan dan tercatat di audit. Admin baru wajib memasang autentikator saat pertama masuk.</p>
      </div>

      <section aria-labelledby="admins-heading" className="flex flex-col gap-3">
        <h2 id="admins-heading" className="text-xl">Admin platform</h2>
        {error ? (
          <p role="alert" className="rounded-md bg-card p-4 ring-1 ring-foreground"><span aria-hidden="true">⚠ </span>Daftar admin belum bisa dimuat.</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg bg-card ring-1 ring-border">
            {data.map((a) => (
              <li key={a.user_id} className="flex flex-col gap-3 p-4" data-testid="platform-admin">
                <span className="min-w-0">
                  <span className="font-semibold break-all">{a.email}</span>
                  <span className="block text-sm text-muted-foreground">
                    {a.revoked_at ? `Dicabut ${formatWib(a.revoked_at)}` : `Aktif sejak ${formatWib(a.granted_at)}`}
                    {" · "}{a.has_totp ? "Autentikator terpasang" : "Autentikator belum dipasang"}
                  </span>
                  <span className="block text-sm">{a.capabilities.map((c) => CAPABILITY_LABELS[c] ?? c).join(", ")}</span>
                </span>
                {a.revoked_at ? null : <RevokeForm userId={a.user_id} email={a.email} revision={a.revision} />}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="grant-heading" className="flex flex-col gap-3 rounded-lg bg-card p-6 ring-1 ring-border">
        <h2 id="grant-heading" className="text-xl">Beri atau ubah akses</h2>
        <p className="text-sm text-muted-foreground">Akun harus sudah terdaftar dan emailnya terverifikasi. Mengubah akses akun yang sudah ada menggantikan kemampuannya.</p>
        <GrantForm capabilities={capabilities} />
      </section>
    </div>
  );
}
