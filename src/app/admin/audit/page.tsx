import type { Metadata } from "next";
import Link from "next/link";
import { formatWib } from "@/lib/format";
import { requirePlatform } from "@/lib/platform";
import { supabaseServer } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Audit · Super Admin" };

const ACTIONS: Record<string, string> = {
  "tenant.lifecycle": "Status gerai",
  "platform.grant": "Akses admin diberikan/diubah",
  "platform.revoke": "Akses admin dicabut",
  "application.review": "Tinjauan pengajuan gerai",
  "registration.toggle": "Pendaftaran publik",
  "member.invite": "Undangan staf",
  "member.invite_revoke": "Undangan dicabut",
  "member.accept": "Undangan diterima",
  "member.role": "Peran anggota",
  "member.deactivate": "Anggota dinonaktifkan",
  "credential.store": "Kunci Mengantar disimpan",
  "credential.remove": "Kunci Mengantar dihapus",
  "integration.partner_id": "Partner ID",
};

type AuditRow = {
  id: number; at: string; action: string; outcome: string; reason: string | null;
  actor_email: string | null; target_tenant_name: string | null; target_user_email: string | null;
  detail: { from?: string; to?: string; capabilities?: string[] };
};

function describe(e: AuditRow): string | null {
  if (e.detail.from && e.detail.to) return `${e.detail.from} → ${e.detail.to}`;
  if (e.detail.capabilities) return `Kemampuan: ${e.detail.capabilities.join(", ")}`;
  return null;
}

// PR-28: append-only decision history, newest first, filterable by decision type. Shows who
// acted, on what, and the recorded change; never customer data or secrets.
export default async function PlatformAuditPage({ searchParams }: { searchParams: Promise<{ jenis?: string }> }) {
  await requirePlatform("audit_review");
  const { jenis } = await searchParams;
  const action = jenis && Object.hasOwn(ACTIONS, jenis) ? jenis : null;
  const supabase = await supabaseServer();
  const { data: raw, error } = await supabase.rpc("platform_audit", { p_action: action, p_limit: 100 });
  const data = (raw ?? []) as AuditRow[];
  const filters = [{ key: null, label: "Semua" }, ...Object.entries(ACTIONS).map(([key, label]) => ({ key, label }))];

  return (
    <div className="flex max-w-[980px] flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl tracking-tight">Audit</h1>
        <p className="text-muted-foreground">100 keputusan terakhir. Catatan audit tidak bisa diubah atau dihapus lewat aplikasi maupun API.</p>
      </div>
      <nav aria-label="Filter jenis keputusan">
        <ul className="flex flex-wrap gap-2">
          {filters.map((f) => (
            <li key={f.label}>
              <Link href={f.key ? `/admin/audit?jenis=${f.key}` : "/admin/audit"} aria-current={action === f.key ? "page" : undefined}
                className={cn("inline-flex min-h-11 items-center rounded-full px-4 text-sm ring-1 ring-border",
                  action === f.key ? "bg-accent font-semibold text-primary" : "hover:bg-accent")}>
                {f.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      {error ? (
        <p role="alert" className="rounded-md bg-card p-4 ring-1 ring-foreground"><span aria-hidden="true">⚠ </span>Audit belum bisa dimuat.</p>
      ) : data.length === 0 ? (
        <p className="rounded-lg bg-card p-6 ring-1 ring-border">Belum ada keputusan tercatat.</p>
      ) : (
        <ol className="divide-y divide-border rounded-lg bg-card ring-1 ring-border">
          {data.map((e) => (
            <li key={e.id} className="flex flex-col gap-1 p-4" data-testid="audit-event">
              <span className="font-semibold">{ACTIONS[e.action] ?? e.action} · {e.outcome}</span>
              <span className="text-sm text-muted-foreground">
                {formatWib(e.at)} · oleh <span className="break-all">{e.actor_email ?? "sistem"}</span>
              </span>
              {e.target_tenant_name || e.target_user_email ? (
                <span className="text-sm break-all">Target: {e.target_tenant_name ?? e.target_user_email}</span>
              ) : null}
              {describe(e) ? <span className="text-sm">{describe(e)}</span> : null}
              {e.reason ? <span className="text-sm">Alasan: {e.reason}</span> : null}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
