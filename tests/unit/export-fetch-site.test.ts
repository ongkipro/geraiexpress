import { beforeEach, describe, expect, it, vi } from "vitest";

// T-105 / F-2: the audited CSV exports answer a cross-site browser request with 403 before the workspace,
// the database or record_export is touched. Same-origin, direct ("none") and header-less requests proceed.
const loadWorkspace = vi.fn();
const dbServer = vi.fn();
vi.mock("@/lib/workspace", () => ({ loadWorkspace: () => loadWorkspace() }));
vi.mock("@/lib/db/server", () => ({ dbServer: () => dbServer() }));
vi.mock("@/lib/csv", () => vi.importActual("../../src/lib/csv"));
vi.mock("@/lib/export-format", () => vi.importActual("../../src/lib/export-format"));
vi.mock("@/modules/exports/shipments-export", () => ({
  EXPORT_HEADER: [], EXPORT_ROW_CAP: 0, TRUNCATION_NOTE: "", auditFilters: vi.fn(), fetchExportRows: vi.fn(), parseShipmentFilters: vi.fn(),
}));
vi.mock("@/modules/payments/pilot-report", () => ({ PILOT_CSV_HEADER: [], parsePilotRange: vi.fn(), pilotCsvRows: vi.fn(), pilotDefinitionRows: vi.fn() }));
vi.mock("@/modules/payments/pilot-report-data", () => ({ fetchPilotReport: vi.fn() }));

const shipments = await import("../../src/app/(workspace)/pengiriman/export.csv/route");
const pilot = await import("../../src/app/(workspace)/kas/laporan/export.csv/route");
const { exportFetchAllowed } = await import("../../src/lib/export-format");

const request = (site?: string) =>
  new Request("https://app.geraiexpress.com/pengiriman/export.csv", { headers: site ? { "sec-fetch-site": site } : {} });

beforeEach(() => {
  vi.resetAllMocks();
  loadWorkspace.mockResolvedValue({ kind: "none" });
});

describe("export routes refuse cross-site fetches (T-105 F-2)", () => {
  it.each([["shipments", shipments.GET], ["pilot report", pilot.GET]])("%s: cross-site and same-site are 403 before any DB call", async (_, GET) => {
    for (const site of ["cross-site", "same-site"]) {
      const res = await GET(request(site));
      expect(res.status, site).toBe(403);
      expect(res.headers.get("cache-control")).toBe("private, no-store");
    }
    expect(loadWorkspace).not.toHaveBeenCalled();
    expect(dbServer).not.toHaveBeenCalled();
  });

  it.each([["shipments", shipments.GET], ["pilot report", pilot.GET]])("%s: same-origin, direct and header-less requests reach the workspace check", async (_, GET) => {
    for (const site of ["same-origin", "none", undefined]) expect((await GET(request(site))).status, String(site)).toBe(404);
    expect(loadWorkspace).toHaveBeenCalledTimes(3);
  });

  it("allows exactly same-origin, none and an absent header", () => {
    const allowed = (site?: string) => exportFetchAllowed(new Headers(site ? { "sec-fetch-site": site } : {}));
    expect([undefined, "same-origin", "none"].map(allowed)).toEqual([true, true, true]);
    expect(["cross-site", "same-site", "SAME-ORIGIN"].map(allowed)).toEqual([false, false, false]);
  });
});
