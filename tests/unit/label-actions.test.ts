import { beforeEach, describe, expect, it, vi } from "vitest";
import { printLabelAction, type PrintInput } from "../../src/modules/labels/actions";
import { LABEL_UNKNOWN_RESULT, labelError } from "../../src/modules/labels/messages";

const shipmentId = "00000000-0000-4000-b000-000000000001";
const tenantId = "00000000-0000-4000-b000-000000000003";
const snapshotId = "00000000-0000-4000-b000-000000000004";
const input: PrintInput = { shipmentId, mask: false, size: "10x15", sender: { name: "Budi", phone: "081234567890", city: "Bandung", address: "" } };
const rpc = vi.fn();
const eq = vi.fn();
const maybeSingle = vi.fn();
const from = vi.fn();
const query = { select: () => query, eq: (column: string, value: string) => { eq(column, value); return query; }, maybeSingle };
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/workspace", () => ({ requireWorkspace: async () => ({ tenant: { id: tenantId } }) }));
vi.mock("@/lib/db/server", () => ({ dbServer: async () => ({ from, rpc }) }));

beforeEach(() => {
  vi.resetAllMocks();
  from.mockReturnValue(query);
  maybeSingle.mockResolvedValue({ data: { id: shipmentId }, error: null });
  rpc.mockImplementation(async (name: string) => ({ data: name === "create_label_snapshot" ? snapshotId : 1, error: null }));
});

describe("printLabelAction", () => {
  it("refuses a stale-tab shipment outside the selected tenant before either RPC", async () => {
    // Membership in another tenant does not authorize printing it under this workspace.
    maybeSingle.mockResolvedValue({ data: null, error: null });
    expect(await printLabelAction(input)).toEqual({ ok: false, error: labelError({ message: "not_found" }) });
    expect(from).toHaveBeenCalledExactlyOnceWith("shipments");
    expect(eq).toHaveBeenCalledWith("tenant_id", tenantId);
    expect(eq).toHaveBeenCalledWith("id", shipmentId);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("scopes both shipment and snapshot reads to the selected tenant", async () => {
    maybeSingle.mockResolvedValueOnce({ data: { id: shipmentId }, error: null })
      .mockResolvedValueOnce({ data: { id: snapshotId }, error: null });
    expect(await printLabelAction(input)).toEqual({ ok: true, snapshot: { id: snapshotId } });
    expect(eq.mock.calls.filter(([column]) => column === "tenant_id")).toEqual([["tenant_id", tenantId], ["tenant_id", tenantId]]);
    expect(eq).toHaveBeenCalledWith("id", snapshotId);
    expect(from).toHaveBeenCalledWith("label_snapshots");
    expect(maybeSingle.mock.invocationCallOrder[0]).toBeLessThan(rpc.mock.invocationCallOrder[0]);
    expect(rpc).toHaveBeenCalledWith("record_label_print", { p_snapshot: snapshotId });
  });

  it.each([
    null, undefined, [], "bad", {},
    { ...input, shipmentId: 123 }, { ...input, shipmentId: "-".repeat(36) },
    { ...input, mask: "true" }, { ...input, size: "A4" },
    { ...input, mask: true, sender: null }, { ...input, mask: true, sender: [] },
    { ...input, mask: true, sender: {} },
    ...["name", "phone", "city", "address"].map((key) => ({ ...input, mask: true, sender: { ...input.sender, [key]: 123 } })),
  ])("rejects malformed payload %# without DB access or exceptions", async (payload) => {
    expect(await printLabelAction(payload as PrintInput)).toEqual({ ok: false, error: labelError({ message: "invalid_input" }) });
    expect(from).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("blocks replay after an uncertain print write or a failed post-write snapshot read", async () => {
    rpc.mockResolvedValueOnce({ data: snapshotId, error: null })
      .mockResolvedValueOnce({ error: { message: "FetchError: response lost" } });
    expect(await printLabelAction(input)).toEqual({ ok: false, error: LABEL_UNKNOWN_RESULT, reconcile: true });
    expect(rpc).toHaveBeenCalledTimes(2);
    maybeSingle.mockResolvedValueOnce({ data: { id: shipmentId }, error: null })
      .mockResolvedValueOnce({ data: null, error: { message: "read failed" } });
    expect(await printLabelAction(input)).toEqual({ ok: false, error: LABEL_UNKNOWN_RESULT, reconcile: true });
    expect(rpc).toHaveBeenCalledTimes(4); // No hidden write retry.
  });

  it("keeps a definite RPC refusal recoverable instead of treating it as unknown", async () => {
    rpc.mockResolvedValueOnce({ error: { message: "masking_disabled" } });
    expect(await printLabelAction(input)).toEqual({ ok: false, error: labelError({ message: "masking_disabled" }), reconcile: false });
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
