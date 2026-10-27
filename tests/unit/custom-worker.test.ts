import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SweepSummary } from "../../src/lib/mengantar/dispatcher";
import type { MachineBindings } from "../../src/lib/mengantar/machine-deps";

const sweepMock = vi.fn<(...args: unknown[]) => Promise<SweepSummary>>();
const rpcMock = vi.fn<(...args: unknown[]) => Promise<{ data: unknown; error: { message: string } | null }>>();

vi.mock("../../.open-next/worker.js", () => ({
  default: { fetch: vi.fn() },
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    rpc: (...args: unknown[]) => rpcMock(...args),
  }),
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

describe("custom-worker scheduled sweep (T-024 / T-028 / T-030)", () => {
  beforeEach(() => {
    sweepMock.mockReset();
    rpcMock.mockReset();
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

    await expect(worker.scheduled({ cron: "*/5 * * * *" }, VALID_BINDINGS)).resolves.toBeUndefined();

    expect(rpcMock).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(log.mock.calls[0][0]))).toEqual({
      event: "dispatch_sweep",
      failed: true,
    });
  });

  it("invokes cleanup_expired_demos on the 0 * * * * hourly schedule and logs demo_cleanup counts", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    sweepMock.mockResolvedValueOnce({
      checked: 0,
      results: [],
      stuck: { unknown: 0, failed_unresolved: 0, unpaid: 0, queued: 0 },
    });
    rpcMock.mockResolvedValueOnce({
      data: [{ deleted_tenants: 2, deleted_users: 3 }],
      error: null,
    });

    await worker.scheduled({ cron: "0 * * * *" }, VALID_BINDINGS);

    expect(sweepMock).toHaveBeenCalledTimes(1);
    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(rpcMock).toHaveBeenCalledWith("cleanup_expired_demos", { p_max_age_hours: 24 });
    expect(log).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(log.mock.calls[1][0]))).toEqual({
      event: "demo_cleanup",
      deletedTenants: 2,
      deletedUsers: 3,
      failed: false,
    });
  });
});
