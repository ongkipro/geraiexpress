import Link from "next/link";
import { Notice } from "@/components/notice";
import { CaseBadge, caseMark } from "./case-badge";
import { CaseDialog } from "./case-dialog";
import { CasePanel } from "./case-panel";
import { CASE_COPY, CASE_TYPE_LABEL, OUTCOME_LABEL } from "./copy";
import { loadCaseEvents, loadClaimRules, loadShipmentCases, ruleById } from "./load";

// UX-20 items 1-2 on the shipment detail: the "Retur" state with the provider's return destination
// rule in words, the current non-closed case (or "Buka kasus" on an issued shipment) and earlier
// closed cases as links.
export async function ShipmentCaseCard({ tenantId, shipment, courier, viewerId, isAdmin, isDemo }: {
  tenantId: string;
  shipment: { id: string; reference: string; submission_state: string; delivery_state?: string | null };
  courier: string | null;
  viewerId: string;
  isAdmin: boolean;
  isDemo: boolean;
}) {
  const [cases, rules] = await Promise.all([loadShipmentCases(tenantId, shipment.id), loadClaimRules(tenantId)]);
  if (!cases || !rules) return <Notice tone="danger">Kasus pengiriman belum bisa dimuat. Muat ulang halaman sebelum membuka kasus.</Notice>;
  const current = cases.find((c) => c.state !== "closed") ?? null;
  const events = current ? await loadCaseEvents(tenantId, current.id) : [];
  if (!events) return <Notice tone="danger">Kasus pengiriman belum bisa dimuat. Muat ulang halaman sebelum membuka kasus.</Notice>;
  const mark = caseMark(shipment.delivery_state, current?.case_type ?? null);
  const earlier = cases.filter((c) => c.state === "closed");
  const reloadHref = `/pengiriman/${shipment.id}`;
  if (!current && shipment.submission_state !== "issued" && !mark && !earlier.length) return null;
  return (
    <section aria-labelledby="case-heading" className="flex flex-col gap-4" data-testid="shipment-cases">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="case-heading" className="text-xl">Retur dan kasus</h2>
        <CaseBadge mark={mark} />
      </div>
      {mark === "return" ? <Notice tone="info" data-testid="return-rule">{CASE_COPY.returnRule}</Notice> : null}
      {current ? (
        <CasePanel record={current} reference={shipment.reference} courier={courier} rule={ruleById(rules, current.rule_id)} events={events}
          now={new Date()} viewerId={viewerId} isAdmin={isAdmin} isDemo={isDemo} reloadHref={reloadHref} />
      ) : shipment.submission_state === "issued" ? (
        <div className="flex flex-col gap-3 rounded-lg bg-card p-5 ring-1 ring-border sm:p-6">
          <p>Paket hilang, rusak, terlambat atau retur? Catat kasusnya di sini lalu ajukan lewat Live Chat Mengantar. {CASE_COPY.decisionNote}</p>
          <div className="flex"><CaseDialog shipmentId={shipment.id} reference={shipment.reference} isJne={courier === "JNE"} reloadHref={reloadHref} /></div>
        </div>
      ) : null}
      {earlier.length ? (
        <ul className="flex flex-col gap-1 text-sm" aria-label="Kasus sebelumnya">
          {earlier.map((c) => (
            <li key={c.id}><Link href={`/kasus/${c.id}`} className="inline-flex min-h-11 items-center text-primary hover:underline">
              Kasus {CASE_TYPE_LABEL[c.case_type]} ditutup · {c.outcome ? OUTCOME_LABEL[c.outcome] : "—"}
            </Link></li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
