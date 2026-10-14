import type { Metadata } from "next";
import Link from "next/link";
import { formatWib } from "@/lib/format";
import { requirePlatform } from "@/lib/platform";
import { supabaseServer } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { ReviewForm } from "../forms";

export const metadata: Metadata = { title: "Pengajuan gerai · Super Admin" };

const STATUS: Record<string, string> = {
  submitted: "Menunggu tinjauan",
  changes_requested: "Perlu perbaikan",
  approved: "Disetujui",
  rejected: "Ditolak",
};

type Row = {
  id: string; status: string; revision: number; applicant_email: string; business_name: string;
  outlet_name: string; pickup_address: string; pickup_area: string; contact_phone: string;
  review_reason: string | null; submitted_at: string | null; reviewed_at: string | null;
};

// PR-15 / PR-30 / DEC-007: manual review during the pilot. Drafts and withdrawn applications are
// the applicant's own business and are not listed.
const DECIDED: Record<string, string> = {
  approve: "Disetujui. Gerai aktif dan pemohon menjadi admin gerai. Tidak ada akun Mengantar yang dibuat.",
  reject: "Pengajuan ditolak. Pemohon melihat alasannya.",
  request_changes: "Pemohon diminta memperbaiki data.",
};

export default async function ApplicationsPage({ searchParams }: { searchParams: Promise<{ status?: string; keputusan?: string }> }) {
  await requirePlatform("tenant_governance");
  const { status: requested, keputusan } = await searchParams;
  const decided = keputusan && Object.hasOwn(DECIDED, keputusan) ? DECIDED[keputusan] : null;
  const status = requested && Object.hasOwn(STATUS, requested) ? requested : "submitted";
  const supabase = await supabaseServer();
  const { data: raw, error } = await supabase.rpc("platform_applications", { p_status: status });
  const rows = (raw ?? []) as Row[];

  return (
    <div className="flex max-w-[980px] flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl tracking-tight">Pengajuan gerai</h1>
        <p className="text-muted-foreground">Setiap keputusan butuh alasan dan tercatat di audit.</p>
      </div>
      {decided ? <p role="status" className="rounded-md bg-card p-4 ring-1 ring-border">{decided}</p> : null}
      <nav aria-label="Filter status pengajuan">
        <ul className="flex flex-wrap gap-2">
          {Object.entries(STATUS).map(([key, label]) => (
            <li key={key}>
              <Link href={`/admin/pengajuan?status=${key}`} aria-current={status === key ? "page" : undefined}
                className={cn("inline-flex min-h-11 items-center rounded-full px-4 text-sm ring-1 ring-border",
                  status === key ? "bg-accent font-semibold text-primary" : "hover:bg-accent")}>
                {label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      {error ? (
        <p role="alert" className="rounded-md bg-card p-4 ring-1 ring-foreground"><span aria-hidden="true">⚠ </span>Pengajuan belum bisa dimuat.</p>
      ) : rows.length === 0 ? (
        <p className="rounded-lg bg-card p-6 ring-1 ring-border">Tidak ada pengajuan dengan status ini.</p>
      ) : (
        <ul className="divide-y divide-border rounded-lg bg-card ring-1 ring-border">
          {rows.map((a) => (
            <li key={a.id} className="flex flex-col gap-3 p-4" data-testid="application">
              <div className="flex flex-col gap-1">
                <span className="font-semibold">{a.business_name}</span>
                <span className="text-sm break-all text-muted-foreground">{a.applicant_email} · {a.contact_phone}</span>
                <span className="text-sm">{a.outlet_name} — {a.pickup_address}, {a.pickup_area}</span>
                <span className="text-sm text-muted-foreground">
                  Diajukan {formatWib(a.submitted_at)}{a.reviewed_at ? ` · ditinjau ${formatWib(a.reviewed_at)}` : ""}
                </span>
                {a.review_reason ? <span className="text-sm">Catatan: {a.review_reason}</span> : null}
              </div>
              {a.status === "submitted" ? <ReviewForm id={a.id} revision={a.revision} name={a.business_name} /> : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
