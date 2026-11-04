import { beforeEach, describe, expect, it, vi } from "vitest";
import { recordReceiptPrintAction } from "../../src/modules/payments/print-actions";
import { PAYMENT_UNKNOWN_RESULT } from "../../src/modules/payments/messages";

const shipmentId = "00000000-0000-4000-b000-000000000001";
const paymentId = "00000000-0000-4000-b000-000000000002";
const tenantId = "00000000-0000-4000-b000-000000000003";
const identity = { geraiName: "Gerai Uji", geraiWhatsapp: "081234567890" };
const rpc = vi.fn();
const eq = vi.fn();
const maybeSingle = vi.fn();
const query = { select: () => query, eq: (column: string, value: string) => { eq(column, value); return query; }, maybeSingle };
vi.mock("@/lib/workspace", () => ({ requireWorkspace: async () => ({ tenant: { id: tenantId } }) }));
vi.mock("@/lib/db/server", () => ({ dbServer: async () => ({ from: () => query, rpc }) }));

beforeEach(() => {
  vi.clearAllMocks();
  rpc.mockResolvedValue({ data: 1, error: null });
  maybeSingle.mockResolvedValue({ data: { id: shipmentId }, error: null });
});

describe("recordReceiptPrintAction", () => {
  it("scopes to the current workspace and passes the exact preview, not a newly read identity", async () => {
    expect(await recordReceiptPrintAction(shipmentId, null, "58", identity)).toEqual({ ok: true });
    expect(eq).toHaveBeenCalledWith("tenant_id", tenantId);
    expect(eq).toHaveBeenCalledWith("id", shipmentId);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("record_receipt_print", {
      p_shipment: shipmentId, p_payment: null, p_width: "58",
      p_preview_gerai_name: "Gerai Uji", p_preview_gerai_whatsapp: "081234567890",
    });
  });

  it("preserves NULL WhatsApp and the non-COD payment binding", async () => {
    expect(await recordReceiptPrintAction(shipmentId, paymentId, "80", { ...identity, geraiWhatsapp: null })).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("record_receipt_print", expect.objectContaining({
      p_payment: paymentId, p_width: "80", p_preview_gerai_whatsapp: null,
    }));
  });

  it("fails stale previews with a Bahasa reload instruction and never reports print permission", async () => {
    rpc.mockResolvedValue({ error: { message: "receipt_identity_changed" } });
    const result = await recordReceiptPrintAction(shipmentId, null, "58", identity);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("Muat ulang struk sebelum mencetak");
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("refuses malformed or missing preview identity before any mutation", async () => {
    for (const preview of [
      { ...identity, geraiName: "" },
      { ...identity, geraiName: "x".repeat(121) },
      { ...identity, geraiWhatsapp: "+6281234567890" },
      null as unknown as typeof identity,
    ]) {
      expect((await recordReceiptPrintAction(shipmentId, null, "58", preview)).ok).toBe(false);
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it("does not mutate another workspace or replay an unknown result", async () => {
    maybeSingle.mockResolvedValueOnce({ data: null, error: null });
    expect((await recordReceiptPrintAction(shipmentId, null, "58", identity)).ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
    rpc.mockResolvedValueOnce({ error: { message: "FetchError: response lost" } });
    expect(await recordReceiptPrintAction(shipmentId, null, "58", identity)).toEqual({ ok: false, error: PAYMENT_UNKNOWN_RESULT });
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
