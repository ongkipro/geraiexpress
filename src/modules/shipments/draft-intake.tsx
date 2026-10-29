import { dbServer } from "@/lib/db/server";
import { GeraiCostQuotePanel } from "@/modules/pricing/gerai-cost";
import { contactSearch } from "./contact-search";
import { DRAFT_FIELDS, type DraftValues } from "./draft";
import { IntakeForm, type ContactOption, type QuoteOption } from "./intake-form";

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
  const [{ data: contactRows }, { data: quotes }] = await Promise.all([
    contactsQuery,
    s.submission_state === "estimated"
      ? db.from("shipment_quotes").select("id, courier, service, normal_tariff_idr, cod_supported, cod_fee_idr, customer_charge_idr, eta_days, is_simulated")
          .eq("tenant_id", tenantId).eq("shipment_id", s.id).eq("shipment_revision", s.revision)
          .gt("expires_at", new Date().toISOString()).order("customer_charge_idr")
      : Promise.resolve({ data: [] as QuoteOption[] }),
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
  const quoteOptions = (quotes ?? []) as QuoteOption[];
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
      idempotencyKey={crypto.randomUUID()}
      live={!isDemo}
      costPanel={isAdmin && !isDemo && s.submission_state === "estimated"
        ? <GeraiCostQuotePanel tenantId={tenantId} quotes={quoteOptions.filter((q) => !q.is_simulated)} />
        : undefined}
    />
  );
}
