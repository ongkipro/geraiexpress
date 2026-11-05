// T-086 / UX-20: the case Server Actions pass only what staff typed (never a deadline), scope to the
// selected tenant, refuse an operator close before any RPC, and never replay after a lost response.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { closeCaseAction, openCaseAction, updateCaseAction } from "../../src/modules/cases/actions";
import { CASE_COPY } from "../../src/modules/cases/copy";
import { parseCaseInputs, parseCloseInputs, wibLocalValue } from "../../src/modules/cases/form";

const shipment = "00000000-0000-4000-e000-00000000000a";
const caseId = "00000000-0000-4000-f000-000000000001";
const workspace = { tenant: { id: "tenant-a" }, role: "operator" };
const rpc = vi.fn(), revalidate = vi.fn(), eq = vi.fn(), maybeSingle = vi.fn();
const query = { select: () => query, eq: (column: string, value: string) => { eq(column, value); return query; }, maybeSingle };
vi.mock("next/cache", () => ({ revalidatePath: (...args: unknown[]) => revalidate(...args) }));
vi.mock("@/lib/workspace", () => ({ requireWorkspace: async () => workspace }));
vi.mock("@/lib/db/server", () => ({ dbServer: async () => ({ from: () => query, rpc }) }));

const form = (values: Record<string, string>) => {
  const data = new FormData();
  for (const [k, v] of Object.entries(values)) data.set(k, v);
  return data;
};
const openForm = (over: Record<string, string> = {}) => form({
  shipment_id: shipment, case_type: "lost", claim_type: "full_value", description: "Paket tidak sampai setelah 10 hari",
  evidence: "foto-resi.jpg\n\n https://contoh.test/chat ", ticket: " TKT-123 ", region: "", anchor: "", ...over,
});

beforeEach(() => {
  vi.clearAllMocks(); workspace.role = "operator";
  rpc.mockResolvedValue({ error: null });
  maybeSingle.mockResolvedValue({ data: { id: shipment, shipment_id: shipment }, error: null });
});

describe("openCaseAction", () => {
  it("sends the typed fields only, scoped to the workspace tenant, with an unknown anchor as null", async () => {
    expect((await openCaseAction({}, openForm({ deadline_at: "2030-01-01T00:00:00Z" }))).ok).toBe(CASE_COPY.saved);
    expect(eq).toHaveBeenCalledWith("tenant_id", "tenant-a");
    expect(rpc).toHaveBeenCalledWith("open_shipment_case", {
      p_shipment: shipment, p_case_type: "lost", p_claim_type: "full_value", p_description: "Paket tidak sampai setelah 10 hari",
      p_evidence_refs: ["foto-resi.jpg", "https://contoh.test/chat"], p_provider_ticket: "TKT-123", p_region: null, p_anchor_at: null,
    });
    expect(revalidate).toHaveBeenCalledWith("/kasus", "layout");
  });

  it("reads an operator-entered anchor as WIB", async () => {
    await openCaseAction({}, openForm({ anchor: "2026-11-02T10:00", region: "other" }));
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_anchor_at: "2026-11-02T03:00:00.000Z", p_region: "other" });
  });

  it("names invalid fields without calling the database", async () => {
    const result = await openCaseAction({}, openForm({ case_type: "stolen", claim_type: "", description: "abc", region: "mars", anchor: "2999-01-01T00:00" }));
    expect(result.fieldErrors).toEqual({ case_type: true, claim_type: true, description: true, region: true, anchor: true });
    expect(rpc).not.toHaveBeenCalled();
    expect((await openCaseAction({}, openForm({ shipment_id: "other" }))).error).toBeTruthy();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("does not open a case on a shipment outside the workspace", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null });
    expect((await openCaseAction({}, openForm())).error).toBeTruthy();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("maps stable refusals and treats a thrown dispatch as unknown, never retried", async () => {
    rpc.mockResolvedValueOnce({ error: { message: "case_open_exists", code: "55000" } });
    expect(await openCaseAction({}, openForm())).toMatchObject({ reconcile: true, error: expect.stringContaining("sudah punya kasus") });
    rpc.mockRejectedValueOnce(new Error("socket hang up"));
    expect(await openCaseAction({}, openForm())).toEqual({ error: CASE_COPY.unknownResult, reconcile: true });
    expect(rpc).toHaveBeenCalledTimes(2);
  });
});

describe("updateCaseAction", () => {
  it("sends the expected revision and the chosen state, never a deadline", async () => {
    await updateCaseAction({}, form({ case_id: caseId, revision: "3", state: "submitted", claim_type: "return", description: "Diajukan lewat Live Chat", evidence: "", ticket: "", region: "", anchor: "" }));
    expect(rpc).toHaveBeenCalledWith("update_shipment_case", expect.objectContaining({ p_case: caseId, p_expected_revision: 3, p_state: "submitted" }));
    expect(Object.keys(rpc.mock.calls[0][1])).not.toContain("p_deadline_at");
  });

  it("refuses the closed state through update", async () => {
    expect((await updateCaseAction({}, form({ case_id: caseId, revision: "1", state: "closed", claim_type: "return", description: "Sudah selesai" }))).fieldErrors?.state).toBe(true);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("closeCaseAction", () => {
  it("refuses an operator before any database call", async () => {
    expect((await closeCaseAction({}, form({ case_id: caseId, outcome: "rejected" }))).error).toMatch(/admin gerai/);
    expect(rpc).not.toHaveBeenCalled();
    expect(maybeSingle).not.toHaveBeenCalled();
  });

  it("requires an amount and the deciding party only for a compensation", async () => {
    workspace.role = "tenant_admin";
    expect((await closeCaseAction({}, form({ case_id: caseId, outcome: "compensated" }))).fieldErrors).toEqual({ amount: true, decided_by: true });
    expect(rpc).not.toHaveBeenCalled();
    await closeCaseAction({}, form({ case_id: caseId, outcome: "compensated", amount: "150.000", decided_by: "mengantar" }));
    expect(rpc).toHaveBeenLastCalledWith("close_shipment_case", { p_case: caseId, p_outcome: "compensated", p_decided_amount_idr: 150000, p_decided_by_party: "mengantar", p_note: null });
    await closeCaseAction({}, form({ case_id: caseId, outcome: "rejected", amount: "5000" }));
    expect(rpc).toHaveBeenLastCalledWith("close_shipment_case", expect.objectContaining({ p_outcome: "rejected", p_decided_amount_idr: null }));
  });
});

describe("form helpers", () => {
  it("parses and round-trips WIB anchors", () => {
    const now = new Date("2026-11-05T00:00:00Z");
    expect(parseCaseInputs(form({ claim_type: "other", description: "Paket rusak", anchor: "2026-11-04T08:30" }), now).inputs?.anchorAt).toBe("2026-11-04T01:30:00.000Z");
    expect(wibLocalValue("2026-11-04T01:30:00.000Z")).toBe("2026-11-04T08:30");
    expect(wibLocalValue(null)).toBe("");
    expect(parseCloseInputs(form({ outcome: "other", decided_by: "somebody" })).fieldErrors).toEqual({ decided_by: true });
  });
});
