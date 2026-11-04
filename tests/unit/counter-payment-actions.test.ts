import { beforeEach, describe, expect, it, vi } from "vitest";
import { recordCounterPaymentAction, voidCounterPaymentAction } from "../../src/modules/payments/actions";
import { PAYMENT_UNKNOWN_RESULT } from "../../src/modules/payments/messages";

const shipmentId = "00000000-0000-4000-b000-000000000001";
const paymentId = "00000000-0000-4000-b000-000000000002";
const tenantId = "00000000-0000-4000-b000-000000000003";
const workspace = { tenant: { id: tenantId }, role: "operator" };
const rpc = vi.fn();
const revalidate = vi.fn();
const eq = vi.fn();
const maybeSingle = vi.fn();
const query = { select: () => query, eq: (column: string, value: string) => { eq(column, value); return query; }, maybeSingle };
vi.mock("next/cache", () => ({ revalidatePath: (path: string) => revalidate(path) }));
vi.mock("@/lib/workspace", () => ({ requireWorkspace: async () => workspace }));
vi.mock("@/lib/db/server", () => ({ dbServer: async () => ({ from: () => query, rpc }) }));

const form = (overrides: Record<string, string> = {}) => {
  const values = { shipment_id: shipmentId, payment_id: paymentId, method: "cash", amount: "12000", received: "20000", expected: "12000", ...overrides };
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
};

beforeEach(() => {
  vi.clearAllMocks();
  workspace.role = "operator";
  rpc.mockResolvedValue({ data: paymentId, error: null });
  maybeSingle.mockResolvedValue({ data: { id: shipmentId }, error: null });
});

describe("recordCounterPaymentAction", () => {
  it("scopes the shipment to the current workspace and passes only operator-entered fields", async () => {
    expect((await recordCounterPaymentAction({}, form())).ok).toBeTruthy();
    expect(eq).toHaveBeenCalledWith("tenant_id", tenantId);
    expect(eq).toHaveBeenCalledWith("id", shipmentId);
    expect(rpc).toHaveBeenCalledWith("record_counter_payment", {
      p_shipment: shipmentId, p_method: "cash", p_amount_idr: 12000, p_received_idr: 20000, p_difference_reason: null,
    });
    expect(revalidate).toHaveBeenCalledWith(`/pengiriman/${shipmentId}`);
  });

  it("rejects malformed whole rupiah and differences without a reason before any mutation", async () => {
    for (const amount of ["-12000", "12,50", "abc12000"]) {
      expect((await recordCounterPaymentAction({}, form({ amount }))).fieldErrors?.amount).toBeTruthy();
    }
    expect((await recordCounterPaymentAction({}, form({ amount: "10000" }))).fieldErrors?.reason).toBeTruthy();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("does not mutate a resource outside the selected workspace", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null });
    expect((await recordCounterPaymentAction({}, form())).error).toBeTruthy();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("keeps the database authoritative for a forged expected amount and blocks replay on unknown results", async () => {
    rpc.mockResolvedValueOnce({ error: { message: "difference_reason_required" } });
    const difference = await recordCounterPaymentAction({}, form({ amount: "10000", expected: "10000" }));
    expect(difference.fieldErrors?.reason).toBeTruthy();
    rpc.mockResolvedValueOnce({ error: { message: "FetchError: response lost" } });
    expect(await recordCounterPaymentAction({}, form())).toEqual({ error: PAYMENT_UNKNOWN_RESULT, reconcile: true });
    expect(rpc).toHaveBeenCalledTimes(2); // No hidden retry.
  });
});

describe("voidCounterPaymentAction", () => {
  it("requires an administrator and a reason and scopes the payment to the selected tenant and shipment", async () => {
    expect((await voidCounterPaymentAction({}, form({ reason: "Salah input" }))).error).toBeTruthy();
    expect(rpc).not.toHaveBeenCalled();
    workspace.role = "tenant_admin";
    expect((await voidCounterPaymentAction({}, form({ reason: "x" }))).fieldErrors?.reason).toBeTruthy();
    expect((await voidCounterPaymentAction({}, form({ reason: "Salah input" }))).ok).toBeTruthy();
    expect(eq).toHaveBeenCalledWith("tenant_id", tenantId);
    expect(eq).toHaveBeenCalledWith("shipment_id", shipmentId);
    expect(eq).toHaveBeenCalledWith("id", paymentId);
  });
});
