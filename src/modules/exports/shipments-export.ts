import type { Db } from "../../lib/db/client";
import type { CsvCell } from "../../lib/csv";
import { dayBounds, parseDay, wibIso } from "../../lib/export-format";
import { SUBMISSION_LABEL, courierName } from "../../lib/format";

// The operational shipment export (PR-16). The sender-facing fields only: nothing here reads the private
// net cost, a discount, an observed percentage or a platform share, and no sender WhatsApp is exported.
// The rows come from the caller's own session, so row-level security keeps them inside the tenant.

export const EXPORT_ROW_CAP = 10000;
const PAGE = 1000; // PostgREST max_rows is 1000: a larger request is silently cut to it.

export const EXPORT_HEADER = [
  "Referensi", "Dibuat (WIB)", "Status", "Kurir", "Layanan", "Resi", "Nama penerima", "Telepon penerima",
  "Area penerima", "Berat (gram)", "Nilai barang (Rp)", "Ongkir pelanggan (Rp)", "Nominal COD (Rp)",
  "Status pembayaran", "Masking pengirim",
] as const;

export const TRUNCATION_NOTE =
  "Ekspor dibatasi 10.000 baris pertama. Persempit filter (status atau tanggal) lalu ekspor lagi.";

const PAYMENT_LABEL: Record<string, string> = {
  not_applicable: "Tidak berlaku", unpaid: "Belum dibayar", paid: "Sudah dibayar",
};

// The same filters as the shipment list, plus an optional range of WIB calendar days on the creation time.
export type ShipmentFilters = { q: string; status: string; from: string; to: string };

export function parseShipmentFilters(params: { q?: string | null; status?: string | null; from?: string | null; to?: string | null }): ShipmentFilters {
  const status = params.status && Object.hasOwn(SUBMISSION_LABEL, params.status) ? params.status : "";
  let from = parseDay(params.from), to = parseDay(params.to);
  if (from && to && from > to) [from, to] = [to, from];
  return {
    q: (params.q ?? "").replace(/[,()*%_\\]/g, " ").trim().slice(0, 80),
    status, from, to,
  };
}

export const searchClause = (q: string) =>
  `reference.ilike.*${q}*,sender_name.ilike.*${q}*,recipient_name.ilike.*${q}*,awb.ilike.*${q}*`;

// What the audit row records: the filters in use, the text search only as present (a term can be a name).
export function auditFilters(f: ShipmentFilters): Record<string, string | boolean> {
  return {
    ...(f.status && { status: f.status }),
    ...(f.from && { from: f.from }),
    ...(f.to && { to: f.to }),
    ...(f.q && { has_query: true }),
  };
}

type RawRow = {
  reference: string;
  created_at: string;
  submission_state: string;
  payment_state: string;
  awb: string | null;
  recipient_name: string | null;
  recipient_phone: string | null;
  recipient_area: string | null;
  weight_grams: number | null;
  goods_value_idr: number | null;
  customer_charge_idr: number | null;
  is_cod: boolean;
  cod_amount_idr: number | null;
  quote: { courier: string; service: string } | null;
  labels: { version: number; mask_sender: boolean }[] | null;
};

const SELECT =
  "id, reference, created_at, submission_state, payment_state, awb, recipient_name, recipient_phone, recipient_area, weight_grams, goods_value_idr, customer_charge_idr, is_cod, cod_amount_idr, "
  + "quote:shipment_quotes!shipments_tenant_id_selected_quote_id_fkey(courier, service), labels:label_snapshots(version, mask_sender)";

// A shipment's masking answer comes from its newest label snapshot; without any label it is unknown and
// stays empty-worded ("Belum ada label"), never "Tidak".
function maskingCell(labels: RawRow["labels"]): string {
  if (!labels || labels.length === 0) return "Belum ada label";
  const newest = labels.reduce((a, b) => (b.version > a.version ? b : a));
  return newest.mask_sender ? "Ya" : "Tidak";
}

export function exportRowCells(r: RawRow): CsvCell[] {
  return [
    r.reference, wibIso(r.created_at), SUBMISSION_LABEL[r.submission_state] ?? r.submission_state,
    r.quote ? courierName(r.quote.courier) : null, r.quote?.service ?? null, r.awb,
    r.recipient_name, r.recipient_phone, r.recipient_area,
    r.weight_grams, r.goods_value_idr, r.customer_charge_idr, r.is_cod ? r.cod_amount_idr : null,
    PAYMENT_LABEL[r.payment_state] ?? r.payment_state, maskingCell(r.labels),
  ];
}

export type ExportFetch =
  | { ok: true; rows: CsvCell[][]; truncated: boolean }
  | { ok: false };

// The rows strictly after a cursor in (created_at desc, id desc) order. Both values are quoted: a
// timestamp carries ':' and '+' which the filter grammar would otherwise have to guess about.
export const keysetClause = (cursor: { created_at: string; id: string }) =>
  `created_at.lt."${cursor.created_at}",and(created_at.eq."${cursor.created_at}",id.lt."${cursor.id}")`;

// Reads at most EXPORT_ROW_CAP rows and one row past the cap to know whether the result was truncated.
// Pages follow a keyset cursor (created_at, id), not an offset: a draft created while the export runs
// sorts before the cursor, so it can never shift the following pages and repeat a row.
export async function fetchExportRows(db: Db, tenantId: string, f: ShipmentFilters): Promise<ExportFetch> {
  const bounds = dayBounds(f.from, f.to);
  const all: (RawRow & { id: string })[] = [];
  let cursor: { created_at: string; id: string } | null = null;
  while (all.length <= EXPORT_ROW_CAP) {
    const size = Math.min(PAGE, EXPORT_ROW_CAP + 1 - all.length);
    let query = db.from("shipments").select(SELECT)
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false }).order("id", { ascending: false })
      .limit(size);
    if (f.status) query = query.eq("submission_state", f.status);
    if (bounds.gte) query = query.gte("created_at", bounds.gte);
    if (bounds.lt) query = query.lt("created_at", bounds.lt);
    if (f.q) query = query.or(searchClause(f.q));
    if (cursor) query = query.or(keysetClause(cursor));
    const { data, error } = await query.returns<(RawRow & { id: string })[]>();
    if (error || !data) return { ok: false };
    all.push(...data);
    if (data.length < size) break;
    cursor = { created_at: data[data.length - 1].created_at, id: data[data.length - 1].id };
  }
  const truncated = all.length > EXPORT_ROW_CAP;
  return { ok: true, rows: all.slice(0, EXPORT_ROW_CAP).map(exportRowCells), truncated };
}
