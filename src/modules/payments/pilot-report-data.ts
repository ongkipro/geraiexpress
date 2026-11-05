import type { Db } from "../../lib/db/client";
import { parsePilotReport, PILOT_REPORT_UNSUPPORTED, type PilotReportRow } from "./pilot-report";

// One read path for the page and the CSV route: the caller's own session calls the tenant-admin RPC
// public.pilot_report; the database refuses operators (admin_required) and other tenants (not_found).
export type PilotReportFetch =
  | { ok: true; rows: PilotReportRow[] }
  | { ok: false; code: string; message: string };

// PostgREST cuts every response at PGRST_DB_MAX_ROWS (1000). A report at that size may be cut, so it
// fails closed and asks for a shorter period instead of showing partial totals.
export const PILOT_REPORT_ROW_CAP = 1000;
export const PILOT_REPORT_TOO_LARGE = "Laporan terlalu besar untuk satu tampilan. Persempit periode lalu coba lagi.";

export async function fetchPilotReport(db: Db, tenantId: string, from: string, to: string): Promise<PilotReportFetch> {
  const { data, error } = await db.rpc("pilot_report", { p_tenant: tenantId, p_from: from, p_to: to });
  if (error) return { ok: false, code: error.message ?? "", message: error.message ?? "" };
  if (Array.isArray(data) && data.length >= PILOT_REPORT_ROW_CAP) return { ok: false, code: "too_large", message: PILOT_REPORT_TOO_LARGE };
  try {
    return { ok: true, rows: parsePilotReport(data) };
  } catch {
    return { ok: false, code: "unsupported", message: PILOT_REPORT_UNSUPPORTED };
  }
}
