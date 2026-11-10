import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, ChevronRight, ClipboardCheck, CheckCircle2, CircleDashed, MessageSquareWarning, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatWib } from "@/lib/format";
import { platformTitle, requirePlatform } from "@/lib/platform";
import { dbServer } from "@/lib/db/server";
import { cn } from "@/lib/utils";
import { ReviewForm } from "../forms";
import { Notice } from "@/components/notice";
import { EmptyState, LoadError, PageHeader, SegmentedNav } from "../ui";

export const generateMetadata = (): Promise<Metadata> => platformTitle("Pengajuan gerai · Super Admin", ["tenant_governance"]);

const STATUS: Record<string, { label: string; Icon: typeof CheckCircle2; variant: "pending" | "warning" | "success" | "destructive" }> = {
  submitted: { label: "Menunggu tinjauan", Icon: CircleDashed, variant: "pending" },
  changes_requested: { label: "Perlu perbaikan", Icon: MessageSquareWarning, variant: "warning" },
  approved: { label: "Disetujui", Icon: CheckCircle2, variant: "success" },
  rejected: { label: "Ditolak", Icon: XCircle, variant: "destructive" },
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

function ApplicationBadge({ status }: { status: string }) {
  const s = STATUS[status] ?? STATUS.submitted;
  return <Badge variant={s.variant}><s.Icon aria-hidden="true" />{s.label}</Badge>;
}

function Facts({ title, rows }: { title: string; rows: [string, React.ReactNode][] }) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold text-muted-foreground">{title}</h3>
      <dl className="divide-y divide-border border-y border-border">
        {rows.map(([label, value]) => (
          <div key={label} className="grid gap-1 py-3 sm:grid-cols-[180px_minmax(0,1fr)] sm:gap-4">
            <dt className="text-sm text-muted-foreground">{label}</dt>
            <dd className="break-words">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

// UI-4: list and detail side by side on >= 1024. Below that the list and the selected application are
// separate views of the same URL (`id` selects the application; the status filter stays in the URL).
export default async function ApplicationsPage({ searchParams }: { searchParams: Promise<{ status?: string; keputusan?: string; id?: string }> }) {
  await requirePlatform("tenant_governance");
  const { status: requested, keputusan, id: selectedId } = await searchParams;
  const decided = keputusan && Object.hasOwn(DECIDED, keputusan) ? DECIDED[keputusan] : null;
  const status = requested && Object.hasOwn(STATUS, requested) ? requested : "submitted";
  const db = await dbServer();
  const { data: raw, error } = await db.rpc("platform_applications", { p_status: status });
  const rows = (raw ?? []) as Row[];
  const chosen = rows.find((r) => r.id === selectedId) ?? null;
  // Wide screens always show a detail; narrow screens show it only once an application is chosen.
  const shown = chosen ?? rows[0] ?? null;
  const listHref = `/admin/pengajuan?status=${status}`;

  return (
    <div className="flex max-w-[1160px] flex-col gap-6">
      <PageHeader title="Pengajuan gerai" description="Setiap keputusan butuh alasan dan tercatat di audit." />
      {decided ? <Notice tone="success">{decided}</Notice> : null}
      <SegmentedNav
        label="Filter status pengajuan"
        items={Object.entries(STATUS).map(([key, s]) => ({ href: `/admin/pengajuan?status=${key}`, label: s.label, current: status === key }))}
      />
      {error ? (
        <LoadError href={listHref}>Pengajuan belum bisa dimuat.</LoadError>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={ClipboardCheck}
          title="Tidak ada pengajuan dengan status ini"
          description={status === "submitted" ? "Pengajuan baru muncul di sini begitu pemohon mengirimkannya." : undefined}
          action={status === "submitted" ? null : <Button asChild variant="outline" size="sm"><Link href="/admin/pengajuan">Lihat yang menunggu tinjauan</Link></Button>}
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[340px_minmax(0,1fr)] lg:items-start">
          <section aria-label="Daftar pengajuan" className={cn(chosen && "max-lg:hidden")}>
            <ul className="divide-y divide-border overflow-hidden rounded-lg bg-card ring-1 ring-border">
              {rows.map((a) => {
                const current = shown?.id === a.id;
                return (
                  <li key={a.id} data-testid="application">
                    <Link
                      href={`${listHref}&id=${a.id}`}
                      aria-current={current ? "true" : undefined}
                      className={cn(
                        "flex min-h-11 items-start justify-between gap-3 border-l-[3px] border-l-transparent p-4 transition-colors hover:bg-accent",
                        current && "lg:border-l-primary lg:bg-accent",
                      )}
                    >
                      <span className="flex min-w-0 flex-col gap-1">
                        <span className="font-semibold break-words">{a.business_name}</span>
                        <span className="text-sm break-all text-muted-foreground">{a.applicant_email}</span>
                        <span className="text-sm text-muted-foreground">Diajukan {formatWib(a.submitted_at)}</span>
                        {a.review_reason ? <span className="line-clamp-2 text-sm">Catatan: {a.review_reason}</span> : null}
                      </span>
                      <ChevronRight className="mt-1 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>

          {shown ? (
            <article aria-labelledby="application-heading" data-testid="application-detail"
              className={cn("flex flex-col gap-6 rounded-lg bg-card p-5 ring-1 ring-border lg:sticky lg:top-6", !chosen && "max-lg:hidden")}>
              <Link href={listHref} className="-my-2 inline-flex min-h-11 items-center gap-1 self-start text-sm font-semibold text-primary lg:hidden">
                <ChevronLeft className="size-4" aria-hidden="true" />Semua pengajuan
              </Link>
              <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex min-w-0 flex-col gap-1">
                  <h2 id="application-heading" className="text-2xl font-semibold tracking-tight break-words">{shown.business_name}</h2>
                  <p className="text-sm text-muted-foreground">
                    Revisi <span className="tabular">{shown.revision}</span> · diajukan {formatWib(shown.submitted_at)}
                    {shown.reviewed_at ? ` · ditinjau ${formatWib(shown.reviewed_at)}` : ""}
                  </p>
                </div>
                <ApplicationBadge status={shown.status} />
              </header>
              <Facts title="Pemohon" rows={[
                ["Email", <span key="e" className="break-all">{shown.applicant_email}</span>],
                ["No. HP penanggung jawab", <span key="p" className="tabular">{shown.contact_phone}</span>],
              ]} />
              <Facts title="Outlet pertama" rows={[
                ["Nama outlet", shown.outlet_name],
                ["Alamat pickup", shown.pickup_address],
                ["Kecamatan/kota", shown.pickup_area],
              ]} />
              {shown.review_reason ? (
                <Facts title="Catatan peninjau" rows={[["Alasan terakhir", shown.review_reason]]} />
              ) : null}
              {shown.status === "submitted" ? (
                <section aria-labelledby="decision-heading" className="flex flex-col gap-3 border-t border-border pt-5">
                  <div className="flex flex-col gap-1">
                    <h3 id="decision-heading" className="text-lg font-semibold">Keputusan</h3>
                    <p className="text-sm text-muted-foreground">Pilih satu. Anda akan diminta alasan dan konfirmasi sebelum keputusan disimpan.</p>
                  </div>
                  <ReviewForm key={shown.id} id={shown.id} revision={shown.revision} name={shown.business_name} />
                </section>
              ) : null}
            </article>
          ) : null}
        </div>
      )}
    </div>
  );
}
