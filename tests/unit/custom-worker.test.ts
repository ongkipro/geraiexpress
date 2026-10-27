import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SweepSummary } from "../../src/lib/mengantar/dispatcher";
import type { MachineBindings } from "../../src/lib/mengantar/machine-deps";

const sweepMock = vi.fn<(...args: unknown[]) => Promise<SweepSummary>>();

vi.mock("../../.open-next/worker.js", () => ({
  default: { fetch: vi.fn() },
}));

vi.mock("../../src/lib/mengantar/dispatcher", () => ({
  sweep: (...args: unknown[]) => sweepMock(...args),
}));

const { default: worker } = await import("../../custom-worker");

const VALID_BINDINGS: MachineBindings = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SECRET_KEY: "sb_secret_unit_test_key",
  CREDENTIAL_KEY: Buffer.alloc(32, 7).toString("base64"),
  MENGANTAR_ENV: "sandbox",
};

describe("custom-worker scheduled sweep (T-024 / T-028)", () => {
  beforeEach(() => {
    sweepMock.mockReset();
    vi.restoreAllMocks();
  });

  it("logs disabled and skips sweep when machine bindings are incomplete", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    for (const env of [
      {},
      { ...VALID_BINDINGS, SUPABASE_SECRET_KEY: undefined },
      { ...VALID_BINDINGS, CREDENTIAL_KEY: undefined },
      { ...VALID_BINDINGS, MENGANTAR_ENV: undefined },
      { ...VALID_BINDINGS, MENGANTAR_ENV: "invalid" },
    ]) {
      await expect(worker.scheduled({}, env)).resolves.toBeUndefined();
    }
    expect(sweepMock).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledTimes(5);
    for (const call of log.mock.calls) {
      expect(JSON.parse(String(call[0]))).toEqual({
        event: "dispatch_sweep",
        disabled: true,
      });
    }
  });

  it("invokes sweep and logs tallies, price flags and stuck counts when bindings are valid", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    sweepMock.mockResolvedValueOnce({
      checked: 5,
      results: [
        { action: "dispatch", status: "recorded", priceMismatch: true },
        { action: "dispatch", status: "recorded", priceUnknown: true },
        { action: "reconcile", status: "recorded" },
        { action: "payment", status: "recorded" },
        { action: "payment", status: "inconclusive" },
      ],
      stuck: { unknown: 1, failed_unresolved: 2, unpaid: 3, queued: 0 },
    });

    await worker.scheduled({}, VALID_BINDINGS);

    expect(sweepMock).toHaveBeenCalledTimes(1);
    expect(sweepMock.mock.calls[0][0]).toMatchObject({
      environment: "sandbox",
      credentialKey: VALID_BINDINGS.CREDENTIAL_KEY,
    });
    expect(log).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(log.mock.calls[0][0]))).toEqual({
      event: "dispatch_sweep",
      checked: 5,
      failed: false,
      tally: {
        "dispatch:recorded": 2,
        "reconcile:recorded": 1,
        "payment:recorded": 1,
        "payment:inconclusive": 1,
      },
      priceMismatch: 1,
      priceUnknown: 1,
      stuck: { unknown: 1, failed_unresolved: 2, unpaid: 3, queued: 0 },
    });
  });

  it("logs failed: true without throwing when sweep rejects", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    sweepMock.mockRejectedValueOnce(new Error("unexpected rpc crash"));

    await expect(worker.scheduled({}, VALID_BINDINGS)).resolves.toBeUndefined();

    expect(log).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(log.mock.calls[0][0]))).toEqual({
      event: "dispatch_sweep",
      failed: true,
    });
  });
});
