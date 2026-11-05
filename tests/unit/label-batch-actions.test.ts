import { beforeEach, describe, expect, it, vi } from "vitest";
import { printBatchLabelsAction } from "../../src/modules/labels/batch-actions";
import { FORMAT_LOCKED, LABEL_UNKNOWN_RESULT, MASKING_ACK_REQUIRED } from "../../src/modules/labels/messages";

const id = "00000000-0000-4000-b000-000000000001";
const otherId = "00000000-0000-4000-b000-000000000002";
const tenantId = "00000000-0000-4000-b000-000000000003";
const input = { ids: [id], mask: false, size: "10x15", city: "", acknowledged: false };
const row = { id, reference: "GX1", submission_state: "issued", awb: "JP12345678", is_simulated: false };
const rpc = vi.fn();
const eq = vi.fn();
const rows = vi.fn();
const maybeSingle = vi.fn();
const from = vi.fn();
const query = { select: () => query, eq: (column: string, value: string) => { eq(column, value); return query; }, in: rows, maybeSingle };
vi.mock("@/lib/workspace", () => ({ requireWorkspace: async () => ({ tenant: { id: tenantId } }) }));
vi.mock("@/lib/db/server", () => ({ dbServer: async () => ({ from, rpc }) }));

beforeEach(() => {
  vi.resetAllMocks();
  from.mockReturnValue(query);
  rows.mockResolvedValue({ data: [row], error: null });
  maybeSingle.mockResolvedValue({ data: { contact_whatsapp: "081234567890", masking_allowed: true }, error: null });
  rpc.mockImplementation(async (name: string) => ({ data: name === "create_label_snapshot" ? otherId : 1, error: null }));
});

describe("printBatchLabelsAction", () => {
  it.each([
    null, undefined, [], "bad", {},
    { ...input, ids: null }, { ...input, ids: [123] }, { ...input, ids: [] },
    { ...input, ids: ["bad"] }, { ...input, ids: [`${id},${otherId}`] },
    { ...input, ids: Array(51).fill(id) }, { ...input, mask: "true" },
    { ...input, size: "A4" }, { ...input, city: null }, { ...input, city: "x".repeat(101) },
    { ...input, acknowledged: undefined }, { ...input, acknowledged: "yes" },
  ])("rejects malformed payload %# before DB access", async (payload) => {
    expect(await printBatchLabelsAction(payload as typeof input)).toEqual({ snapshots: [], error: "Pilihan label tidak valid." });
    expect(from).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses the whole batch before any RPC if a selected id is absent from the tenant-filtered rows", async () => {
    const result = await printBatchLabelsAction({ ...input, ids: [id, otherId] });
    expect(result.error).toContain("Pilihan pengiriman berubah");
    expect(eq).toHaveBeenCalledWith("tenant_id", tenantId);
    expect(rows).toHaveBeenCalledWith("id", [id, otherId]);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("propagates an unknown print outcome and stops before the next shipment", async () => {
    rows.mockResolvedValue({ data: [row, { ...row, id: otherId, reference: "GX2" }], error: null });
    rpc.mockResolvedValueOnce({ data: otherId, error: null })
      .mockResolvedValueOnce({ error: { message: "FetchError: response lost" } });
    expect(await printBatchLabelsAction({ ...input, ids: [id, otherId] })).toEqual({
      snapshots: [], error: `GX1: ${LABEL_UNKNOWN_RESULT}`, reconcile: true,
    });
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it("reports a concurrent format lock refusal in Bahasa for the shipment, without a print event or unknown-outcome retry", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "label_format_locked", code: "55000" } });
    expect(await printBatchLabelsAction(input)).toEqual({ snapshots: [], error: `GX1: ${FORMAT_LOCKED}` });
    expect(rpc).toHaveBeenCalledExactlyOnceWith("create_label_snapshot", expect.objectContaining({ p_shipment: id, p_size: "10x15" }));
  });

  it("requires reconciliation when a print committed but its snapshot cannot be read", async () => {
    maybeSingle.mockResolvedValueOnce({ data: { contact_whatsapp: "081234567890" }, error: null })
      .mockResolvedValueOnce({ data: null, error: { message: "read failed" } });
    expect(await printBatchLabelsAction(input)).toEqual({ snapshots: [], error: `GX1: ${LABEL_UNKNOWN_RESULT}`, reconcile: true });
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(eq.mock.calls.filter(([column]) => column === "tenant_id")).toEqual([["tenant_id", tenantId], ["tenant_id", tenantId]]);
  });

  // T-084 / PR-46: one acknowledgement per batch.
  const maskedRow = { ...row, sender_name: "Toko Uji", sender_phone: "081311112222", sender_address: null, sender_area: "Bandung", quote: { courier: "JT" } };

  it("refuses an unacknowledged masked batch with an unverified courier before any snapshot or print", async () => {
    rows.mockResolvedValue({ data: [maskedRow], error: null });
    rpc.mockImplementation(async (name: string) => ({ data: name === "masking_acceptance_for" ? { state: "unverified" } : null, error: null }));
    expect(await printBatchLabelsAction({ ...input, mask: true })).toEqual({ snapshots: [], error: MASKING_ACK_REQUIRED });
    expect(rpc).toHaveBeenCalledExactlyOnceWith("masking_acceptance_for", { p_courier: "JT" });
  });

  it("passes the batch acknowledgement to every masked record_label_print", async () => {
    rows.mockResolvedValue({ data: [maskedRow], error: null });
    maybeSingle.mockResolvedValueOnce({ data: { contact_whatsapp: "081234567890", masking_allowed: true }, error: null })
      .mockResolvedValueOnce({ data: { id: otherId }, error: null });
    expect(await printBatchLabelsAction({ ...input, mask: true, acknowledged: true })).toEqual({ snapshots: [{ id: otherId }] });
    expect(rpc).not.toHaveBeenCalledWith("masking_acceptance_for", expect.anything());
    expect(rpc).toHaveBeenCalledWith("record_label_print", { p_snapshot: otherId, p_acknowledged: true });
  });
});
