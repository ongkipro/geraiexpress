import { billableWeight, cargoMinimumSummary, weightExclusionText, type BillableWeightRule } from "@/lib/billable-weight";
import { couriersForHandover, quoteServices } from "./handover";
import { dbServer } from "@/lib/db/server";
import { pickupLeadMinutes } from "@/lib/mengantar/pickup-lead";
import { GeraiCostQuotePanel } from "@/modules/pricing/gerai-cost";
import { contactSearch } from "./contact-search";
import { DRAFT_FIELDS, type DraftValues } from "./draft";
import { IntakeForm, type ContactOption, type Declaration, type QuoteOption } from "./intake-form";

const CONTACT_COLUMNS = "id, name, phone, is_sender, is_recipient, addresses:contact_addresses(id, label, address_line, area, area_id, postal_code, is_primary, archived_at)";

type ContactRow = Omit<ContactOption, "addresses"> & {
  addresses: (ContactOption["addresses"][number] & { is_primary: boolean; archived_at: string | null })[] | null;
};

// Draft and estimated shipments: loads the contact pickers and the current quotes, then renders the
// create flow (C4). Server component.
export async function DraftIntake({ s, tenantId, outlet, isAdmin, isDemo, kontak }: {
  s: Record<string, unknown> & {
    id: string; reference: string; revision: number; submission_state: string;
    sender_contact_id: string | null; recipient_contact_id: string | null;
  };
  tenantId: string;
  outlet: { name: string; pickupAddress: string | null; pickupArea: string | null };
  isAdmin: boolean;
  isDemo: boolean;
  kontak: string | undefined;
}) {
  const db = await dbServer();
  // T-051 / SUP-24: the contact pickers are capped at 300 rows; a name or phone filter (?kontak=) narrows them
  // server-side through the user's own session (RLS). The filter text is stripped of PostgREST filter syntax.
  const search = contactSearch(kontak ?? "");
  let contactsQuery = db.from("contacts").select(CONTACT_COLUMNS)
    .eq("tenant_id", tenantId).is("archived_at", null).order("name").limit(301);
  if (search.filter) contactsQuery = contactsQuery.or(search.filter);
  const [{ data: contactRows }, { data: quotes }, { data: ruleRows }, { data: declaration }, leadMinutes] = await Promise.all([
    contactsQuery,
    s.submission_state === "estimated"
      ? db.from("shipment_quotes").select("id, courier, service, normal_tariff_idr, cod_supported, cod_fee_idr, customer_charge_idr, eta_days, is_simulated, actual_weight_grams, volumetric_weight_grams, billable_weight_grams, weight_rule_id")
          .eq("tenant_id", tenantId).eq("shipment_id", s.id).eq("shipment_revision", s.revision)
          .gt("expires_at", new Date().toISOString()).order("customer_charge_idr")
      : Promise.resolve({ data: [] as QuoteOption[] }),
    db.rpc("billable_weight_rules", { p_tenant: tenantId }),
    // PR-41: the current declaration text (newest effective version) shown at confirmation.
    db.from("declaration_texts").select("version, body, prohibited_categories, provisional")
      .lte("effective_at", new Date().toISOString()).order("effective_at", { ascending: false }).limit(1).maybeSingle(),
    // T-043: the pickup lead time setting, the same number the server checks use (default when unreadable).
    pickupLeadMinutes(() => db.rpc("pickup_lead_minutes")),
  ]);
  const rows = (contactRows ?? []) as ContactRow[];
  const contactsTruncated = rows.length > 300;
  const contacts = rows.slice(0, 300);
  // Keep the contacts already chosen on this draft in the list even when the filter or the cap hides them.
  const chosenIds = [s.sender_contact_id, s.recipient_contact_id].filter((x): x is string => Boolean(x) && !contacts.some((c) => c.id === x));
  if (chosenIds.length) {
    const { data: chosen } = await db.from("contacts").select(CONTACT_COLUMNS)
      .eq("tenant_id", tenantId).is("archived_at", null).in("id", chosenIds);
    contacts.push(...((chosen ?? []) as ContactRow[]));
  }
  const initial = Object.fromEntries(DRAFT_FIELDS.map((f) => [f, s[f] == null ? "" : String(s[f])])) as DraftValues;
  const options: ContactOption[] = contacts.map((c) => ({
    ...c,
    addresses: (c.addresses ?? [])
      .filter((a) => !a.archived_at)
      .sort((a, b) => Number(b.is_primary) - Number(a.is_primary)),
  }));
  const rules = (ruleRows ?? []) as BillableWeightRule[];
  const quoteOptions = ((quotes ?? []) as QuoteOption[]).map((q) => {
    const rule = rules.find((r) => r.id === q.weight_rule_id);
    return { ...q, weight_formula_verified: rule?.divisor != null && rule?.tolerance_grams != null, weight_source: isAdmin && rule ? { url: rule.source_url, date: rule.source_updated_at } : null };
  });
  // T-080 / F9: the same services live quoting considers (regular, plus non-COD cargo), each with its
  // newest effective rule, so an excluded service is named instead of silently missing.
  const services = isDemo ? [{ courier: "SiCepat", service_class: "regular" as const }] : quoteServices(s.is_cod === true);
  const weightWarnings = typeof s.weight_grams === "number" ? couriersForHandover(services, s.handover).flatMap(({ courier, service_class }) => {
    const rule = rules.find((r) => r.courier === courier && r.service_class === service_class) ?? null;
    // A cargo service without a verified route minimum is not offered at all; say nothing rather than guess.
    if (service_class === "cargo" && rule?.min_weight_grams == null) return [];
    const weight = billableWeight({ actualWeightGrams: s.weight_grams as number,
      lengthCm: s.length_cm as number | null, widthCm: s.width_cm as number | null, heightCm: s.height_cm as number | null }, rule);
    // Below a cargo minimum is the normal case for small parcels: summarized once below, not per courier.
    if (service_class === "cargo" && weight.exclusion === "min_weight_not_met") return [];
    const name = isDemo ? "Kurir Simulasi" : service_class === "cargo" ? `${courier} Kargo` : courier;
    return weight.exclusion ? [weightExclusionText(name, weight.exclusion)] : [];
  }) : [];
  // F9: one summary naming exactly the cargo services below their sourced minimum (never all of Kargo
  // when one cargo service is still eligible).
  const cargoSummary = !isDemo && s.is_cod !== true && typeof s.weight_grams === "number"
    ? cargoMinimumSummary(services.filter((x) => x.service_class === "cargo").flatMap(({ courier }) => {
      const rule = rules.find((r) => r.courier === courier && r.service_class === "cargo");
      if (rule?.min_weight_grams == null) return [];
      const weight = billableWeight({ actualWeightGrams: s.weight_grams as number,
        lengthCm: s.length_cm as number | null, widthCm: s.width_cm as number | null, heightCm: s.height_cm as number | null }, rule);
      return [{ courier, minimumGrams: rule.min_weight_grams, belowMinimum: weight.exclusion === "min_weight_not_met" }];
    }))
    : null;
  if (cargoSummary) weightWarnings.push(cargoSummary);
  return (
    <IntakeForm
      shipmentId={s.id}
      reference={s.reference}
      revision={s.revision}
      initial={initial}
      senderContactId={s.sender_contact_id}
      recipientContactId={s.recipient_contact_id}
      outlet={outlet}
      contacts={options}
      contactsTruncated={contactsTruncated}
      contactQuery={search.text}
      quotes={quoteOptions}
      weightWarnings={weightWarnings}
      idempotencyKey={crypto.randomUUID()}
      declaration={(declaration ?? null) as Declaration | null}
      live={!isDemo}
      pickupLeadMinutes={leadMinutes}
      costPanel={isAdmin && !isDemo && s.submission_state === "estimated"
        ? <GeraiCostQuotePanel tenantId={tenantId} quotes={quoteOptions.filter((q) => !q.is_simulated)} />
        : undefined}
    />
  );
}
