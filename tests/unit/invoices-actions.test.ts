import { beforeEach, describe, expect, it, vi } from "vitest";

// P2-1: the invoice commands act only on a shipment or label snapshot of the selected gerai.
const SHIPMENT = "00000000-0000-4000-b000-0000000000a1";
const TENANT = "00000000-0000-4000-b000-0000000000c1";
const rpc = vi.fn();
const maybeSingle = vi.fn();
const eq = vi.fn();
const from = vi.fn();
const chain = { select: () => chain, eq: (...args: unknown[]) => { eq(...args); return chain; }, maybeSingle };

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/errors", () => vi.importActual("../../src/lib/errors"));
vi.mock("@/lib/db/server", () => ({ dbServer: async () => ({ rpc, from: (table: string) => { from(table); return chain; } }) }));
vi.mock("@/lib/workspace", () => ({ requireWorkspace: async () => ({ tenant: { id: TENANT } }) }));

const { issueInvoiceAction, recordLabelPrintAction } = await import("../../src/modules/invoices/actions");

beforeEach(() => vi.resetAllMocks());

describe("invoice actions tenant scope (P2-1)", () => {
  it("issueInvoiceAction refuses a shipment of another gerai without the command", async () => {
    maybeSingle.mockResolvedValueOnce({ data: null, error: null });
    expect(await issueInvoiceAction(SHIPMENT)).toEqual({ ok: false, error: "Data tidak ditemukan atau Anda tidak memiliki akses." });
    expect(eq).toHaveBeenCalledWith("tenant_id", TENANT);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("recordLabelPrintAction refuses a snapshot of another gerai without the command", async () => {
    maybeSingle.mockResolvedValueOnce({ data: null, error: null });
    expect(await recordLabelPrintAction(SHIPMENT, false)).toEqual({ ok: false, error: "Data tidak ditemukan atau Anda tidak memiliki akses." });
    expect(from).toHaveBeenCalledWith("label_snapshots");
    expect(eq).toHaveBeenCalledWith("tenant_id", TENANT);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("forwards both commands after the scoped lookup finds the row", async () => {
    maybeSingle.mockResolvedValue({ data: { id: SHIPMENT }, error: null });
    rpc.mockResolvedValue({ data: null, error: null });
    expect(await issueInvoiceAction(SHIPMENT)).toEqual({ ok: true });
    expect(rpc).toHaveBeenLastCalledWith("create_invoice_snapshot", { p_shipment: SHIPMENT });
    expect(await recordLabelPrintAction(SHIPMENT, true)).toEqual({ ok: true });
    expect(rpc).toHaveBeenLastCalledWith("record_label_print", { p_snapshot: SHIPMENT, p_acknowledged: true });
  });
});
