import { courierName, etaLabel, formatIdr } from "@/lib/format";
import { dbServer } from "@/lib/db/server";
import { GERAI_COST_LABEL, GERAI_COST_NOTE, geraiCostText } from "./display";

// Derived gerai cost of one quote (gerai_cost_for_quote): tenant administrators only (the database
// refuses everyone else). Returns null for unknown and for any error: never 0.
export async function geraiCostForQuote(tenantId: string, quoteId: string): Promise<number | null> {
  const db = await dbServer();
  const { data, error } = await db.rpc("gerai_cost_for_quote", { p_tenant: tenantId, p_quote: quoteId });
  return !error && typeof data === "number" ? data : null;
}

export type CostQuote = { id: string; courier: string; service: string; eta_days: string | null; normal_tariff_idr: number | null };

// Tenant-administrator-only list under the services of an estimated shipment (inside the "Ongkir"
// step, so it draws no frame of its own). The sender-facing quote prices are untouched (the sender
// pays the normal tariff).
export async function GeraiCostQuotePanel({ tenantId, quotes }: { tenantId: string; quotes: CostQuote[] }) {
  if (quotes.length === 0) return null;
  const costs = await Promise.all(quotes.map((q) => geraiCostForQuote(tenantId, q.id)));
  return (
    <section aria-labelledby="gerai-cost-heading" className="flex flex-col gap-3" data-testid="gerai-cost-panel">
      <h3 id="gerai-cost-heading" className="text-base font-semibold">{GERAI_COST_LABEL}</h3>
      <p className="text-sm text-muted-foreground">{GERAI_COST_NOTE} Hanya terlihat oleh admin gerai.</p>
      <ul className="flex flex-col divide-y divide-border border-y border-border">
        {quotes.map((q, i) => (
          <li key={q.id} className="flex items-start justify-between gap-3 py-2.5 text-sm" data-testid="gerai-cost-row">
            <span className="flex min-w-0 flex-col">
              <span className="font-semibold">{courierName(q.courier)} {q.service}</span>
              <span className="text-muted-foreground">{etaLabel(q.eta_days)} · tarif normal <span className="tabular">{formatIdr(q.normal_tariff_idr)}</span></span>
            </span>
            <span className="tabular shrink-0 font-medium" data-testid="gerai-cost-value">{geraiCostText(costs[i])}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
