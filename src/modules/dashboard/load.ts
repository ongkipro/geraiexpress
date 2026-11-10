import "server-only";
import { cache } from "react";
import { dbServer } from "@/lib/db/server";
import { keysetClause } from "@/modules/exports/shipments-export";
import { ATTENTION_STATES } from "@/modules/shell/attention";
import { ROW_BOUND, periodWindow, summarize, type DashboardSummary, type PeriodDays, type PeriodRow } from "./aggregate";

// Dashboard reads (UX-16). Everything goes through the caller's session (`dbServer()`), so row-level
// security keeps each read inside the gerai; the tenant filter is explicit as well.

const PAGE = 1000; // PostgREST max_rows: a larger request is silently cut to it.

// One instant per request, so every region agrees on what "today" is.
export const requestNow = cache(() => new Date());

type RawPeriodRow = {
  id: string;
  created_at: string;
  submission_state: string;
  customer_charge_idr: number | null;
  is_cod: boolean;
  quote: { courier: string } | null;
};

// The period's rows, newest first, at most ROW_BOUND + 1 (one past the bound says it was reached).
// One logical read, paged on a (created_at, id) keyset because PostgREST returns at most 1000 rows.
// Shared by the stat strip and the charts within one request.
export const loadSummary = cache(async (tenantId: string, periodDays: PeriodDays, sample: boolean): Promise<DashboardSummary | null> => {
  const now = requestNow();
  const { gte, lt } = periodWindow(now, periodDays);
  const db = await dbServer();
  const rows: RawPeriodRow[] = [];
  let cursor: { created_at: string; id: string } | null = null;
  while (rows.length <= ROW_BOUND) {
    const size = Math.min(PAGE, ROW_BOUND + 1 - rows.length);
    let query = db.from("shipments")
      .select("id, created_at, submission_state, customer_charge_idr, is_cod, quote:shipment_quotes!shipments_tenant_id_selected_quote_id_fkey(courier)")
      .eq("tenant_id", tenantId).gte("created_at", gte).lt("created_at", lt)
      .order("created_at", { ascending: false }).order("id", { ascending: false })
      .limit(size);
    if (cursor) query = query.or(keysetClause(cursor));
    const { data, error } = await query.returns<RawPeriodRow[]>();
    if (error || !data) return null;
    rows.push(...data);
    if (data.length < size) break;
    cursor = { created_at: data[data.length - 1].created_at, id: data[data.length - 1].id };
  }
  const periodRows: PeriodRow[] = rows.map((r) => ({
    created_at: r.created_at, submission_state: r.submission_state, customer_charge_idr: r.customer_charge_idr,
    is_cod: r.is_cod, courier: r.quote?.courier ?? null,
  }));
  return summarize(periodRows, { now, periodDays, sample });
});

export type AttentionRow = { id: string; reference: string; submission_state: string; recipient_name: string | null; updated_at: string };
export const ATTENTION_LIMIT = 6;

// "Perlu tindakan": the oldest waiting first, the same tier and order as the shipment list.
export async function loadAttention(tenantId: string) {
  const db = await dbServer();
  const { data, count, error } = await db.from("shipments")
    .select("id, reference, submission_state, recipient_name, updated_at", { count: "exact" })
    .eq("tenant_id", tenantId).in("submission_state", ATTENTION_STATES)
    .order("updated_at").limit(ATTENTION_LIMIT).returns<AttentionRow[]>();
  if (error || !data) return null;
  return { rows: data, count: count ?? data.length };
}

// Current-state counts of the stat strip (not bound to the period): head counts, no rows.
export async function loadOpenCounts(tenantId: string) {
  const db = await dbServer();
  const head = (state: string) => db.from("shipments").select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId).eq("submission_state", state);
  const [awaiting, drafts] = await Promise.all([head("awaiting_payment"), head("draft")]);
  return {
    awaiting: awaiting.error ? null : (awaiting.count ?? 0),
    drafts: drafts.error ? null : (drafts.count ?? 0),
  };
}

export type RecentRow = {
  id: string; reference: string; submission_state: string; recipient_name: string | null; recipient_area: string | null;
  awb: string | null; customer_charge_idr: number | null; created_at: string; quote: { courier: string; service: string } | null;
};

// "Terbaru": the last five shipments created, whatever the period.
export async function loadRecent(tenantId: string) {
  const db = await dbServer();
  const { data, error } = await db.from("shipments")
    .select("id, reference, submission_state, recipient_name, recipient_area, awb, customer_charge_idr, created_at, quote:shipment_quotes!shipments_tenant_id_selected_quote_id_fkey(courier, service)")
    .eq("tenant_id", tenantId).order("created_at", { ascending: false }).order("id", { ascending: false })
    .limit(5).returns<RecentRow[]>();
  return error || !data ? null : data;
}

export type SetupCheck = { key: "mengantar" | "alamat-jemput" | "whatsapp-gerai"; label: string; done: boolean; todo: string };

// The three setup facts a tenant admin can act on, from the same data /pengaturan reads (no provider
// call): a stored Mengantar connection, the outlet's Mengantar pickup address, the gerai WhatsApp.
export async function loadSetup(tenantId: string, mengantarPickupId: string | null): Promise<SetupCheck[] | null> {
  const db = await dbServer();
  const [credential, tenant] = await Promise.all([
    db.rpc("seller_credential_status", { p_tenant: tenantId }),
    db.from("tenants").select("contact_whatsapp").eq("id", tenantId).maybeSingle(),
  ]);
  if (credential.error || tenant.error) return null;
  const configured = Boolean(((credential.data ?? []) as { configured: boolean }[])[0]?.configured);
  return [
    { key: "mengantar", label: "Akun Mengantar", done: configured, todo: "Hubungkan akun Mengantar untuk cek ongkir dan menerbitkan resi." },
    { key: "alamat-jemput", label: "Alamat pickup", done: Boolean(mengantarPickupId), todo: "Pilih alamat pickup gerai dari akun Mengantar." },
    { key: "whatsapp-gerai", label: "WhatsApp gerai", done: Boolean(tenant.data?.contact_whatsapp), todo: "Isi nomor WhatsApp gerai agar label bisa dicetak." },
  ];
}
