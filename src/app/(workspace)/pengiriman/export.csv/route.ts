import { toCsv } from "@/lib/csv";
import { exportFetchAllowed, exportFilename } from "@/lib/export-format";
import { dbServer } from "@/lib/db/server";
import { loadWorkspace } from "@/lib/workspace";
import {
  EXPORT_HEADER, EXPORT_ROW_CAP, TRUNCATION_NOTE, auditFilters, fetchExportRows, parseShipmentFilters,
} from "@/modules/exports/shipments-export";

// PR-16: operational CSV export of the shipment list, tenant administrators only. Everything runs on the
// caller's own session: the rows are read through row-level security (never a service role) and the
// export is audited through record_export before any byte is released; if the audit fails nothing is sent.
// The response is never cached and carries no public URL.
const text = (message: string, status: number) =>
  new Response(message, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "private, no-store" },
  });

export async function GET(request: Request) {
  if (!exportFetchAllowed(request.headers)) return text("Ekspor hanya dapat dibuka dari halaman GeraiExpress.", 403);
  const loaded = await loadWorkspace();
  // No session, no gerai, or a host that serves no workspace: the route does not exist for this caller.
  if (loaded.kind !== "ready") return text("Tidak ditemukan.", 404);
  const ws = loaded.workspace;
  if (ws.role !== "tenant_admin") return text("Ekspor hanya untuk admin gerai.", 403);
  if (ws.isDemo) return text("Ekspor tidak tersedia di demo.", 403);

  const params = new URL(request.url).searchParams;
  const filters = parseShipmentFilters({
    q: params.get("q"), status: params.get("status"), from: params.get("from"), to: params.get("to"),
  });
  const db = await dbServer();
  const { data: tenant } = await db.from("tenants").select("slug").eq("id", ws.tenant.id).maybeSingle();
  if (!tenant) return text("Tidak ditemukan.", 404);

  const fetched = await fetchExportRows(db, ws.tenant.id, filters);
  if (!fetched.ok) return text("Ekspor belum bisa dibuat. Coba lagi.", 500);

  const { error } = await db.rpc("record_export", {
    p_tenant: ws.tenant.id, p_kind: "shipments", p_filters: auditFilters(filters),
    p_row_count: fetched.rows.length, p_truncated: fetched.truncated,
  });
  if (error) {
    return error.code === "42501" ? text("Ekspor hanya untuk admin gerai.", 403) : text("Ekspor belum bisa dibuat. Coba lagi.", 500);
  }

  const headers: Record<string, string> = {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="${exportFilename(tenant.slug, new Date())}"`,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "X-Export-Rows": String(fetched.rows.length),
    "X-Export-Truncated": fetched.truncated ? "true" : "false",
  };
  if (fetched.truncated) {
    headers["X-Export-Row-Cap"] = String(EXPORT_ROW_CAP);
    headers["X-Export-Note"] = TRUNCATION_NOTE;
  }
  return new Response(toCsv(EXPORT_HEADER, fetched.rows), { headers });
}
