import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ClipboardCheck } from "lucide-react";
import { dbServer } from "@/lib/db/server";
import { formatWib } from "@/lib/format";
import { requirePlatform } from "@/lib/platform";
import { EmptyState, LoadError, PageHeader } from "../ui";

export const metadata: Metadata = { title: "Pengajuan menunggu · Super Admin" };

type Pending = { id: string; business_name: string | null; outlet_name: string | null; pickup_area: string | null; submitted_at: string | null; revision: number };

// T-092: read-only list behind the "Pengajuan menunggu" signal for platform_monitoring. Business names,
// area and wait time only; applicant contact data and the review actions stay on /admin/pengajuan
// (tenant_governance).
export default async function PendingApplicationsMonitorPage() {
  const session = await requirePlatform();
  if (!session.capabilities.includes("platform_monitoring") && !session.capabilities.includes("tenant_governance")) notFound();
  const { data, error } = await (await dbServer()).rpc("platform_pending_applications");
  const rows = (data ?? []) as Pending[];
  return (
    <div className="flex max-w-[880px] flex-col gap-6">
      <PageHeader crumbs={[{ href: "/admin", label: "Gerai" }]} current="Pengajuan menunggu" title="Pengajuan menunggu"
        description="Daftar pemantauan saja. Peninjauan dilakukan oleh admin dengan kemampuan Tata kelola gerai." />
      {error ? (
        <LoadError href="/admin/pantau-pengajuan">Daftar pengajuan belum bisa dimuat.</LoadError>
      ) : rows.length === 0 ? (
        <EmptyState icon={ClipboardCheck} title="Tidak ada pengajuan yang menunggu" />
      ) : (
        <ul className="divide-y divide-border rounded-lg bg-card px-5 ring-1 ring-border" data-testid="pending-applications">
          {rows.map((a) => (
            <li key={a.id} className="flex flex-col gap-1 py-3" data-testid="pending-application">
              <span className="font-semibold break-words">{a.business_name ?? "—"}</span>
              <span className="text-sm text-muted-foreground">
                {a.outlet_name ?? "—"}{a.pickup_area ? ` · ${a.pickup_area}` : ""} · diajukan {formatWib(a.submitted_at)}{a.revision > 1 ? ` · revisi ${a.revision}` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
