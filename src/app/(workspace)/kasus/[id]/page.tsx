import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LoadError } from "@/components/notice";
import { dbServer } from "@/lib/db/server";
import { requireWorkspace } from "@/lib/workspace";
import { CasePanel } from "@/modules/cases/case-panel";
import { loadCaseEvents, loadClaimRules, ruleById } from "@/modules/cases/load";
import { CASE_COLUMNS, type CaseRecord } from "@/modules/cases/types";

export const metadata: Metadata = { title: "Kasus" };

type Row = CaseRecord & { shipment: { reference: string; quote: { courier: string } | null } | null };

// UX-20 items 3-6: one case with its deadline, guidance, history and the update/close dialogs.
export default async function CasePage({ params }: { params: Promise<{ id: string }> }) {
  const ws = await requireWorkspace();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const db = await dbServer();
  const { data, error } = await db.from("shipment_cases")
    .select(`${CASE_COLUMNS}, shipment:shipments!shipment_cases_tenant_id_shipment_id_fkey(reference, quote:shipment_quotes!shipments_tenant_id_selected_quote_id_fkey(courier))`)
    .eq("tenant_id", ws.tenant.id).eq("id", id).maybeSingle<Row>();
  if (error) return <LoadError title="Kasus" what="Kasus" />;
  if (!data) notFound();
  const [rules, events] = await Promise.all([loadClaimRules(ws.tenant.id), loadCaseEvents(ws.tenant.id, data.id)]);
  if (!rules || !events) return <LoadError title="Kasus" what="Kasus" />;
  const reference = data.shipment?.reference ?? "Pengiriman";
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Link href="/kasus" className="inline-flex min-h-11 w-fit items-center text-primary hover:underline">Kembali ke daftar kasus</Link>
        <h1 className="text-[28px] leading-tight tracking-tight tabular sm:text-3xl [overflow-wrap:anywhere]">{reference}</h1>
      </div>
      <CasePanel record={data} reference={reference} courier={data.shipment?.quote?.courier ?? null} rule={ruleById(rules, data.rule_id)}
        events={events} now={new Date()} viewerId={ws.userId} isAdmin={ws.role === "tenant_admin"} isDemo={ws.isDemo}
        reloadHref={`/kasus/${data.id}`} showShipmentLink />
    </div>
  );
}
