import { beforeEach, describe, expect, it, vi } from "vitest";

// T-105 / F-1: the shipment Server Actions redirect and log stable codes only. Raw PostgREST/PostgreSQL text
// (which can echo submitted input) and a non-UUID shipment id never reach the redirect target or a log line.
const SHIPMENT = "00000000-0000-4000-b000-0000000000a1";
const OPERATION = "00000000-0000-4000-b000-0000000000a2";
const RAW = `invalid input syntax for type uuid: "x'<script>"`;
const rpc = vi.fn();
const maybeSingle = vi.fn();
const chain = { select: () => chain, eq: () => chain, order: () => chain, limit: () => chain, maybeSingle };
const reconcileOperation = vi.fn();

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`); } }));
vi.mock("@/lib/db/server", () => ({ dbServer: async () => ({ rpc, from: () => chain }), machineClient: async () => null }));
vi.mock("@/lib/errors", () => vi.importActual("../../src/lib/errors"));
vi.mock("@/lib/format", () => vi.importActual("../../src/lib/format"));
vi.mock("@/lib/log", () => vi.importActual("../../src/lib/log"));
vi.mock("@/lib/mengantar/public-api", () => ({ InvalidOrderRequest: class extends Error {} }));
vi.mock("@/lib/mengantar/billable-quotes", () => ({ estimateBillableQuotes: vi.fn() }));
vi.mock("@/lib/mengantar/tenant", () => ({ mengantarFailure: vi.fn(), tenantMengantar: vi.fn() }));
vi.mock("@/lib/config", () => ({ config: () => undefined }));
vi.mock("@/lib/mengantar/dispatcher", () => ({
  checkPayment: vi.fn(), dispatchOperation: vi.fn(), payUnpaidShipmentBatch: vi.fn(),
  reconcileOperation: (...args: unknown[]) => reconcileOperation(...args),
}));
vi.mock("@/lib/mengantar/machine-deps", () => ({ dispatcherDeps: () => ({ environment: "sandbox" }) }));
vi.mock("@/lib/workspace", () => ({ requireWorkspace: async () => ({ tenant: { id: "t" }, outlet: { id: "o" }, role: "tenant_admin" }) }));

const actions = await import("../../src/modules/shipments/actions");

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}
const redirectOf = async (run: Promise<unknown>) => {
  try {
    await run;
  } catch (error) {
    return String((error as Error).message).replace(/^redirect:/, "");
  }
  throw new Error("no redirect");
};

beforeEach(() => {
  vi.resetAllMocks();
  maybeSingle.mockResolvedValue({ data: null, error: null });
});

describe("shipment action redirects (T-105 F-1)", () => {
  const redirecting = [
    actions.reopenAction, actions.closeFailedAction, actions.closeAmbiguousReservationAction, actions.requestLabelAction,
    actions.reconcileAction, actions.checkPaymentAction, actions.dispatchQueuedAction, actions.payUnpaidBatchAction,
    actions.closeUnknownBatchPaymentAction,
  ];

  it.each(redirecting.map((action) => [action.name, action]))("%s refuses a non-UUID shipment id before the database", async (_, action) => {
    const target = await redirectOf(action(form({ shipment_id: "x'<script>", reason: "alasan cukup", attempt_id: OPERATION })));
    expect(target).toBe("/pengiriman?galat=not_found");
    expect(rpc).not.toHaveBeenCalled();
    expect(maybeSingle).not.toHaveBeenCalled();
  });

  it.each([actions.reopenAction, actions.closeFailedAction, actions.closeAmbiguousReservationAction, actions.requestLabelAction])(
    "%o maps raw database text to unknown and keeps a stable code", async (action) => {
      rpc.mockResolvedValueOnce({ data: null, error: { message: RAW, code: "22P02" } });
      expect(await redirectOf(action(form({ shipment_id: SHIPMENT, reason: "alasan cukup" })))).toBe(`/pengiriman/${SHIPMENT}?galat=unknown`);
      rpc.mockResolvedValueOnce({ data: null, error: { message: "payment_recorded" } });
      expect(await redirectOf(action(form({ shipment_id: SHIPMENT, reason: "alasan cukup" })))).toBe(`/pengiriman/${SHIPMENT}?galat=payment_recorded`);
    });

  it("maps a raw reason of a dispatch summary to unknown in both the redirect and the log line", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    maybeSingle.mockResolvedValue({ data: { id: OPERATION, state: "unknown", result_code: null, is_simulated: false }, error: null });
    reconcileOperation.mockResolvedValueOnce({ status: "inconclusive", reason: RAW });
    const target = await redirectOf(actions.reconcileAction(form({ shipment_id: SHIPMENT })));
    expect(target).toBe(`/pengiriman/${SHIPMENT}?info=unknown`);
    const line = String(log.mock.calls.at(-1)![0]);
    expect(JSON.parse(line)).toEqual({ event: "dispatch_action", correlationId: expect.stringMatching(/^[0-9a-f-]{36}$/), step: "reconcile",
      status: "inconclusive", reason: "unknown" });
    expect(line).not.toContain("invalid input");

    reconcileOperation.mockResolvedValueOnce({ status: "not_reconcilable", reason: RAW });
    expect(await redirectOf(actions.reconcileAction(form({ shipment_id: SHIPMENT })))).toBe(`/pengiriman/${SHIPMENT}?galat=unknown`);
    reconcileOperation.mockResolvedValueOnce({ status: "inconclusive", reason: "lookup_failed" });
    expect(await redirectOf(actions.reconcileAction(form({ shipment_id: SHIPMENT })))).toBe(`/pengiriman/${SHIPMENT}?info=lookup_failed`);
  });

  it("creates a draft only into a UUID path; raw text never reaches the list URL", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: RAW } });
    expect(await redirectOf(actions.createDraftAction())).toBe("/pengiriman?galat=unknown");
    rpc.mockResolvedValueOnce({ data: "../admin", error: null });
    expect(await redirectOf(actions.createDraftAction())).toBe("/pengiriman?galat=unknown");
    rpc.mockResolvedValueOnce({ data: SHIPMENT, error: null });
    expect(await redirectOf(actions.createDraftAction())).toBe(`/pengiriman/${SHIPMENT}`);
  });

  it("returns not_found from the form actions for a non-UUID id without a database call", async () => {
    expect(await actions.saveDraftAction({}, form({ shipment_id: "1 or 1=1" }))).toEqual({ error: expect.any(String) });
    expect(await actions.confirmShipmentAction({}, form({ shipment_id: "1 or 1=1" }))).toEqual({ error: expect.any(String) });
    expect(maybeSingle).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });
});
