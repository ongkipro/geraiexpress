import { toCsv } from "@/lib/csv";
import { exportFilename, wibIso } from "@/lib/export-format";
import { dbServer } from "@/lib/db/server";
import { loadWorkspace } from "@/lib/workspace";
import { PILOT_CSV_HEADER, parsePilotRange, pilotCsvRows, pilotDefinitionRows } from "@/modules/payments/pilot-report";
import { fetchPilotReport } from "@/modules/payments/pilot-report-data";

// T-087 / PR-45: CSV of the pilot report, tenant administrators of a real gerai only. Same contract as
// the shipment export (/pengiriman/export.csv): the caller's own session, the database refuses
// operators, the export is audited through record_export ('pilot_report') before any byte is released,
// and the response is never cached. Cells go through the formula guard in src/lib/csv.ts.
const text = (message: string, status: number) =>
  new Response(message, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "private, no-store" },
  });

export async function GET(request: Request) {
  const loaded = await loadWorkspace();
  if (loaded.kind !== "ready") return text("Tidak ditemukan.", 404);
  const ws = loaded.workspace;
  if (ws.role !== "tenant_admin") return text("Laporan pilot hanya untuk admin gerai.", 403);
  if (ws.isDemo) return text("Ekspor tidak tersedia di demo.", 403);

  const params = new URL(request.url).searchParams;
  const range = parsePilotRange({ from: params.get("from"), to: params.get("to") }, new Date());
  if (range.error) return text(range.error, 400);

  const db = await dbServer();
  const { data: tenant } = await db.from("tenants").select("slug").eq("id", ws.tenant.id).maybeSingle();
  if (!tenant) return text("Tidak ditemukan.", 404);

  const report = await fetchPilotReport(db, ws.tenant.id, range.from, range.to);
  if (!report.ok) {
    if (report.code === "admin_required") return text("Laporan pilot hanya untuk admin gerai.", 403);
    if (report.code === "report_range_invalid") return text("Periode laporan tidak valid.", 400);
    return text("Ekspor belum bisa dibuat. Coba lagi.", 500);
  }

  const { error } = await db.rpc("record_export", {
    p_tenant: ws.tenant.id, p_kind: "pilot_report", p_filters: { from: range.from, to: range.to },
    p_row_count: report.rows.length, p_truncated: false,
  });
  if (error) {
    return error.code === "42501" ? text("Laporan pilot hanya untuk admin gerai.", 403) : text("Ekspor belum bisa dibuat. Coba lagi.", 500);
  }

  const body = toCsv(PILOT_CSV_HEADER, [...pilotCsvRows(report.rows, range, wibIso), [], ...pilotDefinitionRows()]);
  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${exportFilename(tenant.slug, new Date(), "laporan-pilot")}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Export-Rows": String(report.rows.length),
    },
  });
}
