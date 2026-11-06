import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SweepSummary } from "../../src/lib/mengantar/dispatcher";
import type { MachineBindings } from "../../src/lib/mengantar/machine-deps";
import type { TaskResult } from "../../src/lib/mengantar/scheduled";

// Port of the former custom-worker scheduled tests (T-024 / T-028 / T-030 / T-051) to the internal cron
// route (T-062): same dispatcher sweep, same demo cleanup, same log events, now behind the host, secret
// and lock gates of src/lib/cron.ts.
const sweepMock = vi.fn<(...args: unknown[]) => Promise<SweepSummary>>();
const pullMock = vi.fn(async (..._args: unknown[]) => ({ checked: 0, applied: 0, unchanged: 0, skipped: 0, failed: 0 }));
const rpcMock = vi.fn<(...args: unknown[]) => Promise<{ data: unknown; error: { message: string } | null }>>();
const clientOptions = vi.fn();
// The rewrap selection (T-057 rewrap, T-105 keyset, T-109 RPC): machine_rewrap_candidates is answered by
// tenantPages(after, limit); every other machine RPC goes to rpcMock. The machine identity reads no table.
const tenantPages = vi.fn<(after: string | null, limit: number) => Promise<{ data: string[] | null; error: { message: string } | null }>>();
const candidateArgs = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("@supabase/postgrest-js", () => ({
  PostgrestClient: class {
    constructor(url: string, options: unknown) {
      clientOptions(url, options);
    }
    rpc(fn: string, args: { p_after?: string | null; p_limit?: number }) {
      if (fn === "machine_rewrap_candidates") {
        candidateArgs(args);
        return tenantPages(args.p_after ?? null, args.p_limit!);
      }
      // T-045: no webhook secret needs a rewrap in these runs (covered by mengantar-webhook-rewrap.test.ts).
      if (fn === "machine_webhook_rewrap_candidates") return Promise.resolve({ data: [], error: null });
      return rpcMock(fn, args);
    }
    from(table: string) {
      throw new Error(`unexpected table read: ${table}`);
    }
  },
}));
vi.mock("../../src/lib/mengantar/dispatcher", () => ({ sweep: (...args: unknown[]) => sweepMock(...args) }));
// T-045: the status pull is its own module (tested in mengantar-status-pull.test.ts); here it is a step.
vi.mock("../../src/lib/mengantar/status-pull", () => ({ pullStatuses: (...args: unknown[]) => pullMock(...args) }));
vi.mock("@/lib/config", () => vi.importActual("../../src/lib/config"));
vi.mock("@/lib/hosts", () => vi.importActual("../../src/lib/hosts"));
vi.mock("@/lib/mengantar/scheduled", () => vi.importActual("../../src/lib/mengantar/scheduled"));
vi.mock("@/lib/cron", () => vi.importActual("../../src/lib/cron"));

const { AUTH_PURGE_BATCH, AUTH_PURGE_MAX_BATCHES, runAuthPurge, runCleanup, runCredentialRewrap, runDemoCleanup, runDispatchSweep, scheduledFetch } = await import("../../src/lib/mengantar/scheduled");
const { REWRAP_BATCH, resetRewrapCursors } = await import("../../src/lib/credential-keyring");
const { cleanupRpc } = await import("../../src/lib/mengantar/machine-deps");
const { handleCron, resetCronLocks, secretMatches } = await import("../../src/lib/cron");
const route = await import("../../src/app/api/internal/cron/[task]/route");

const VALID_BINDINGS: MachineBindings = {
  POSTGREST_URL: "http://postgrest.test:3000",
  AUTH_JWT_SECRET: "unit-test-jwt-secret-0123456789abcdef0123456789abcdef",
  CREDENTIAL_KEY: Buffer.alloc(32, 7).toString("base64"),
  MENGANTAR_ENV: "sandbox",
};
const CLEANUP_ONLY: MachineBindings = { POSTGREST_URL: VALID_BINDINGS.POSTGREST_URL, AUTH_JWT_SECRET: VALID_BINDINGS.AUTH_JWT_SECRET };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const EMPTY_SWEEP: SweepSummary = { checked: 0, results: [], stuck: { unknown: 0, failed_unresolved: 0, unpaid: 0, queued: 0 } };

beforeEach(() => {
  sweepMock.mockReset();
  pullMock.mockClear();
  rpcMock.mockReset();
  tenantPages.mockReset();
  tenantPages.mockResolvedValue({ data: [], error: null });
  candidateArgs.mockClear();
  clientOptions.mockClear();
  resetCronLocks();
  resetRewrapCursors();
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe("dispatch sweep (T-024 / T-028)", () => {
  it("logs disabled and skips the sweep when machine bindings are incomplete", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    for (const env of [
      {},
      { ...VALID_BINDINGS, AUTH_JWT_SECRET: undefined },
      { ...VALID_BINDINGS, POSTGREST_URL: undefined },
      { ...VALID_BINDINGS, CREDENTIAL_KEY: undefined },
      { ...VALID_BINDINGS, MENGANTAR_ENV: undefined },
      { ...VALID_BINDINGS, MENGANTAR_ENV: "invalid" },
    ]) {
      await expect(runDispatchSweep(env)).resolves.toBe("disabled");
    }
    expect(sweepMock).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledTimes(6);
    for (const call of log.mock.calls) expect(JSON.parse(String(call[0]))).toEqual({ event: "dispatch_sweep", outcome: "disabled", disabled: true });
  });

  it("invokes the sweep and logs tallies, price flags and stuck counts when bindings are valid", async () => {
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

    await expect(runDispatchSweep(VALID_BINDINGS)).resolves.toBe("done");

    expect(sweepMock).toHaveBeenCalledTimes(1);
    expect(sweepMock.mock.calls[0][0]).toMatchObject({ environment: "sandbox", credentialKey: VALID_BINDINGS.CREDENTIAL_KEY });
    expect(log).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(log.mock.calls[0][0]))).toEqual({
      event: "dispatch_sweep",
      outcome: "done",
      checked: 5,
      failed: false,
      tally: { "dispatch:recorded": 2, "reconcile:recorded": 1, "payment:recorded": 1, "payment:inconclusive": 1 },
      priceMismatch: 1,
      priceUnknown: 1,
      stuck: { unknown: 1, failed_unresolved: 2, unpaid: 3, queued: 0 },
    });
  });

  it("logs failed: true without throwing when the sweep rejects", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    sweepMock.mockRejectedValueOnce(new Error("unexpected rpc crash"));
    await expect(runDispatchSweep(VALID_BINDINGS)).resolves.toBe("failed");
    expect(rpcMock).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(log.mock.calls[0][0]))).toEqual({ event: "dispatch_sweep", outcome: "failed", failed: true });
  });

  it("reports a failing due-list query as failed", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    sweepMock.mockResolvedValueOnce({ checked: 0, failed: true, results: [] });
    await expect(runDispatchSweep(VALID_BINDINGS)).resolves.toBe("failed");
  });
});

describe("demo cleanup (T-030 / T-051 / DIL-19)", () => {
  it("invokes cleanup_expired_demos and logs demo_cleanup counts", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    rpcMock.mockResolvedValueOnce({ data: [{ deleted_tenants: 2, deleted_users: 3, has_more: false }], error: null });
    await expect(runDemoCleanup(VALID_BINDINGS)).resolves.toBe("done");
    expect(sweepMock).not.toHaveBeenCalled();
    expect(rpcMock).toHaveBeenCalledExactlyOnceWith("cleanup_expired_demos", { p_max_age_hours: 24 });
    expect(JSON.parse(String(log.mock.calls[0][0]))).toEqual({ event: "demo_cleanup", outcome: "done", deletedTenants: 2, deletedUsers: 3, hasMore: false, failed: false });
  });

  it("cleans up with only the PostgREST URL and the JWT secret; has_more is a partial run", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    rpcMock.mockResolvedValue({ data: { deleted_tenants: 4, deleted_users: 5, has_more: true }, error: null });
    await expect(runDemoCleanup(CLEANUP_ONLY)).resolves.toBe("partial");
    expect(JSON.parse(String(log.mock.calls[0][0]))).toEqual({ event: "demo_cleanup", outcome: "partial", deletedTenants: 4, deletedUsers: 5, hasMore: true, failed: false });
  });

  it("does nothing but log disabled when the URL or the JWT secret is missing", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    for (const env of [{}, { POSTGREST_URL: CLEANUP_ONLY.POSTGREST_URL }, { AUTH_JWT_SECRET: CLEANUP_ONLY.AUTH_JWT_SECRET }]) {
      await expect(runDemoCleanup(env)).resolves.toBe("disabled");
    }
    expect(rpcMock).not.toHaveBeenCalled();
    expect(log.mock.calls.map((c) => JSON.parse(String(c[0])))).toEqual(Array(3).fill({ event: "demo_cleanup", outcome: "disabled", disabled: true }));
  });

  it("treats a null, empty or malformed reply as failed, never as zero work (T-105)", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    for (const data of [null, undefined, [], [{}, {}], "ok", { deleted_tenants: 1, deleted_users: 1 },
      { deleted_tenants: "1", deleted_users: 0, has_more: false }, { deleted_tenants: 0, deleted_users: -1, has_more: false },
      { deleted_tenants: 0, deleted_users: 0, has_more: "no" }]) {
      rpcMock.mockResolvedValueOnce({ data, error: null });
      await expect(runDemoCleanup(CLEANUP_ONLY), JSON.stringify(data)).resolves.toBe("failed");
      expect(JSON.parse(String(log.mock.calls.at(-1)![0]))).toEqual({ event: "demo_cleanup", outcome: "failed", failed: true, malformed: true });
    }
  });

  it("logs failed: true when the RPC errors or throws", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    await expect(runDemoCleanup(VALID_BINDINGS)).resolves.toBe("failed");
    rpcMock.mockRejectedValueOnce(new Error("network"));
    await expect(runDemoCleanup(VALID_BINDINGS)).resolves.toBe("failed");
    expect(log.mock.calls.map((c) => JSON.parse(String(c[0])))).toEqual([
      { event: "demo_cleanup", outcome: "failed", failed: true }, { event: "demo_cleanup", outcome: "failed", failed: true }]);
  });
});

describe("auth purge and combined hourly cleanup (T-065 / T-066 / T-104)", () => {
  it("invokes auth_purge_expired with the batch size and logs auth_purge counts", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    rpcMock.mockResolvedValueOnce({ data: { sessions: 7, otp_codes: 12, remaining: false }, error: null });
    await expect(runAuthPurge(CLEANUP_ONLY)).resolves.toBe("done");
    expect(sweepMock).not.toHaveBeenCalled();
    expect(rpcMock).toHaveBeenCalledExactlyOnceWith("auth_purge_expired", { p_limit: AUTH_PURGE_BATCH });
    expect(JSON.parse(String(log.mock.calls[0][0]))).toEqual({ event: "auth_purge", outcome: "done", sessions: 7, otpCodes: 12, hasMore: false, failed: false });
  });

  it("runs further batches while work remains, bounded per run, and sums the counts", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    rpcMock
      .mockResolvedValueOnce({ data: { sessions: 1000, otp_codes: 3, remaining: true }, error: null })
      .mockResolvedValueOnce({ data: { sessions: 5, otp_codes: 0, remaining: false }, error: null });
    await expect(runAuthPurge(CLEANUP_ONLY)).resolves.toBe("done");
    expect(rpcMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(log.mock.calls.at(-1)![0]))).toEqual({ event: "auth_purge", outcome: "done", sessions: 1005, otpCodes: 3, hasMore: false, failed: false });

    rpcMock.mockReset();
    rpcMock.mockResolvedValue({ data: { sessions: 1000, otp_codes: 1000, remaining: true }, error: null });
    await expect(runAuthPurge(CLEANUP_ONLY)).resolves.toBe("partial");
    expect(rpcMock).toHaveBeenCalledTimes(AUTH_PURGE_MAX_BATCHES);
    expect(JSON.parse(String(log.mock.calls.at(-1)![0]))).toMatchObject({ outcome: "partial", hasMore: true, failed: false });
  });

  it("reports the cleanup step and the whole cleanup partial when the purge exhausts its batch budget", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    // Demo cleanup answers first (done), then every purge batch reports remaining work.
    rpcMock.mockResolvedValueOnce({ data: { deleted_tenants: 0, deleted_users: 0, has_more: false }, error: null });
    rpcMock.mockResolvedValue({ data: { sessions: 1000, otp_codes: 0, remaining: true }, error: null });
    await expect(runCleanup(CLEANUP_ONLY)).resolves.toEqual({
      result: "partial", steps: { demo_cleanup: "done", auth_purge: "partial", credential_rewrap: "disabled", webhook_secret_rewrap: "disabled", status_pull: "disabled" } });
  });

  it("treats a null or malformed reply as failed, not as zero work", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    for (const data of [null, undefined, [], "ok", { sessions: 1, otp_codes: 2 }, { sessions: "1", otp_codes: 2, remaining: false },
      { sessions: -1, otp_codes: 0, remaining: false }, { sessions: 0, otp_codes: null, remaining: false }]) {
      rpcMock.mockResolvedValueOnce({ data, error: null });
      await expect(runAuthPurge(CLEANUP_ONLY), JSON.stringify(data)).resolves.toBe("failed");
      expect(JSON.parse(String(log.mock.calls.at(-1)![0]))).toMatchObject({ event: "auth_purge", failed: true });
    }
    // A failure after a successful batch keeps the counts already purged.
    rpcMock
      .mockResolvedValueOnce({ data: { sessions: 2, otp_codes: 3, remaining: true }, error: null })
      .mockResolvedValueOnce({ data: { sessions: 2 }, error: null });
    await expect(runAuthPurge(CLEANUP_ONLY)).resolves.toBe("failed");
    expect(JSON.parse(String(log.mock.calls.at(-1)![0]))).toEqual({ event: "auth_purge", outcome: "failed", sessions: 2, otpCodes: 3, hasMore: true, failed: true, malformed: true });
  });

  it("stops before the next batch once the scheduled deadline aborted", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const controller = new AbortController();
    rpcMock.mockImplementationOnce(async () => {
      controller.abort(new DOMException("deadline", "TimeoutError"));
      return { data: { sessions: 1000, otp_codes: 0, remaining: true }, error: null };
    });
    await expect(runAuthPurge(CLEANUP_ONLY, controller.signal)).resolves.toBe("failed");
    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(log.mock.calls.at(-1)![0]))).toEqual({ event: "auth_purge", outcome: "failed", sessions: 1000, otpCodes: 0, hasMore: true, failed: true });
  });

  it("does nothing when the URL or the JWT secret is missing, and reports every cleanup step disabled", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    for (const env of [{}, { POSTGREST_URL: CLEANUP_ONLY.POSTGREST_URL }, { AUTH_JWT_SECRET: CLEANUP_ONLY.AUTH_JWT_SECRET }]) {
      await expect(runAuthPurge(env)).resolves.toBe("disabled");
      await expect(runCleanup(env)).resolves.toEqual({
        result: "disabled", steps: { demo_cleanup: "disabled", auth_purge: "disabled", credential_rewrap: "disabled", webhook_secret_rewrap: "disabled", status_pull: "disabled" } });
    }
    expect(rpcMock).not.toHaveBeenCalled();
    for (const call of log.mock.calls) expect(JSON.parse(String(call[0]))).toMatchObject({ outcome: "disabled", disabled: true });
  });

  it("logs failed: true when auth_purge_expired errors or throws, and runCleanup still runs both steps", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    await expect(runAuthPurge(VALID_BINDINGS)).resolves.toBe("failed");
    rpcMock.mockRejectedValueOnce(new Error("network"));
    await expect(runAuthPurge(VALID_BINDINGS)).resolves.toBe("failed");
    expect(JSON.parse(String(log.mock.calls.at(-1)![0]))).toEqual({ event: "auth_purge", outcome: "failed", sessions: 0, otpCodes: 0, hasMore: true, failed: true });

    rpcMock
      .mockResolvedValueOnce({ data: { deleted_tenants: 1, deleted_users: 1, has_more: false }, error: { message: "demo_err" } })
      .mockResolvedValueOnce({ data: { sessions: 3, otp_codes: 4, remaining: false }, error: null });
    await expect(runCleanup(CLEANUP_ONLY)).resolves.toEqual({
      result: "failed", steps: { demo_cleanup: "failed", auth_purge: "done", credential_rewrap: "disabled", webhook_secret_rewrap: "disabled", status_pull: "disabled" } });
    const events = log.mock.calls.map((c) => JSON.parse(String(c[0])));
    expect(events.filter((e) => e.event === "auth_purge").at(-1)).toEqual({ event: "auth_purge", outcome: "done", sessions: 3, otpCodes: 4, hasMore: false, failed: false });
    // A cleanup-only configuration has no key ring: the rewrap step is disabled, not failed.
    expect(events.at(-3)).toEqual({ event: "credential_rewrap", outcome: "disabled", disabled: true });
    expect(events.at(-2)).toEqual({ event: "webhook_secret_rewrap", outcome: "disabled", disabled: true });
    expect(events.at(-1)).toEqual({ event: "status_pull", outcome: "disabled", disabled: true });
  });
});

describe("hourly credential rewrap (T-057, SEC-7)", () => {
  const V1 = Buffer.alloc(32, 1).toString("base64");
  const V2 = Buffer.alloc(32, 2).toString("base64");
  const RING: MachineBindings = { ...VALID_BINDINGS, CREDENTIAL_KEY: undefined,
    CREDENTIAL_KEYS: JSON.stringify({ v1: V1, v2: V2 }), CREDENTIAL_KEY_CURRENT: "v2" };

  it("fails closed without touching the database when any rewrap binding is missing or invalid", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    for (const env of [CLEANUP_ONLY, { ...VALID_BINDINGS, MENGANTAR_ENV: undefined }, { ...VALID_BINDINGS, MENGANTAR_ENV: "staging" },
      { ...RING, CREDENTIAL_KEY_CURRENT: "v9" }, { ...VALID_BINDINGS, CREDENTIAL_KEY: "short" }]) {
      await expect(runCredentialRewrap(env)).resolves.toBe("disabled");
    }
    expect(rpcMock).not.toHaveBeenCalled();
    expect(tenantPages).not.toHaveBeenCalled();
    expect(log.mock.calls.map((c) => JSON.parse(String(c[0])))).toEqual(Array(5).fill({ event: "credential_rewrap", outcome: "disabled", disabled: true }));
  });

  it("reads this environment's credential for every listed tenant and logs counts only", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const tenants = ["00000000-0000-4000-a000-0000000000c1", "00000000-0000-4000-a000-0000000000c2"];
    tenantPages.mockResolvedValueOnce({ data: tenants, error: null });
    rpcMock.mockResolvedValue({ data: null, error: null });
    await expect(runCredentialRewrap({ ...RING, MENGANTAR_ENV: "production" })).resolves.toBe("done");
    expect(rpcMock.mock.calls).toEqual(tenants.map((t) => ["machine_seller_key", { p_tenant: t, p_env: "production" }]));
    const line = String(log.mock.calls.at(-1)![0]);
    expect(JSON.parse(line)).toEqual({ event: "credential_rewrap", outcome: "done", environment: "production", scanned: 2, rewrapped: 0,
      alreadyCurrent: 0, noCredential: 2, conflicts: 0, failed: 0, pending: false });
    for (const t of tenants) expect(line).not.toContain(t);
    expect(tenantPages).toHaveBeenCalledExactlyOnceWith(null, REWRAP_BATCH);
    // T-109: the database selects only this environment's tenants below the ring's current key version.
    expect(candidateArgs).toHaveBeenCalledExactlyOnceWith({ p_env: "production", p_current_version: "v2", p_after: null, p_limit: REWRAP_BATCH });
  });

  it("treats a malformed candidate list as a failed run, not as an empty one (T-109)", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    for (const data of [null, {}, [1], [{ id: "00000000-0000-4000-a000-0000000000c1" }]]) {
      tenantPages.mockResolvedValueOnce({ data: data as string[] | null, error: null });
      await expect(runCredentialRewrap(RING), JSON.stringify(data)).resolves.toBe("failed");
    }
    expect(rpcMock).not.toHaveBeenCalled();
    expect(JSON.parse(String(log.mock.calls.at(-1)![0]))).toEqual({ event: "credential_rewrap", outcome: "failed", failed: true });
  });

  it("handles one bounded batch per run and resumes after it on the next run instead of restarting (T-105)", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const id = (n: number) => `00000000-0000-4000-a000-${String(n).padStart(12, "0")}`;
    const all = Array.from({ length: REWRAP_BATCH + 3 }, (_, n) => id(n + 1));
    tenantPages.mockImplementation(async (after, limit) => {
      const start = after ? all.indexOf(after) + 1 : 0;
      return { data: all.slice(start, start + limit), error: null };
    });
    rpcMock.mockResolvedValue({ data: null, error: null });
    await expect(runCredentialRewrap(RING)).resolves.toBe("partial");
    expect(JSON.parse(String(log.mock.calls.at(-1)![0]))).toMatchObject({ outcome: "partial", scanned: REWRAP_BATCH, pending: true });
    // A failed page read keeps the cursor: the retry resumes at the same place.
    tenantPages.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    await expect(runCredentialRewrap(RING)).resolves.toBe("failed");
    await expect(runCredentialRewrap(RING)).resolves.toBe("done");
    expect(JSON.parse(String(log.mock.calls.at(-1)![0]))).toMatchObject({ outcome: "done", scanned: 3, pending: false });
    expect(tenantPages.mock.calls.map(([after]) => after)).toEqual([null, id(REWRAP_BATCH), id(REWRAP_BATCH)]);
    // The pass ended: the next run starts over.
    await runCredentialRewrap(RING);
    expect(tenantPages.mock.calls.at(-1)![0]).toBeNull();
    expect(rpcMock).toHaveBeenCalledTimes(2 * REWRAP_BATCH + 3);
  });

  it("reports a failed tenant list or a failed tenant as failed, and makes runCleanup fail", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    tenantPages.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    await expect(runCredentialRewrap(RING)).resolves.toBe("failed");
    expect(rpcMock).not.toHaveBeenCalled();
    expect(JSON.parse(String(log.mock.calls.at(-1)![0]))).toEqual({ event: "credential_rewrap", outcome: "failed", failed: true });

    tenantPages.mockResolvedValueOnce({ data: ["00000000-0000-4000-a000-0000000000c1"], error: null });
    rpcMock
      .mockResolvedValueOnce({ data: { deleted_tenants: 0, deleted_users: 0, has_more: false }, error: null })
      .mockResolvedValueOnce({ data: { sessions: 0, otp_codes: 0, remaining: false }, error: null })
      .mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    await expect(runCleanup(RING)).resolves.toMatchObject({ result: "failed", steps: { credential_rewrap: "failed", webhook_secret_rewrap: "done", status_pull: "done" } });
    expect(rpcMock).toHaveBeenLastCalledWith("machine_seller_key", { p_tenant: "00000000-0000-4000-a000-0000000000c1", p_env: "sandbox" });
  });
});

describe("the internal cron route gates (T-062)", () => {
  const SECRET = "unit-test-cron-secret-0123456789abcdef";
  const INTERNAL = "internal.geraiexpress.local:3000";
  const call = (task: string, { host = INTERNAL, authorization = `Bearer ${SECRET}`, method = "POST" } = {}) => {
    const headers = new Headers({ host });
    if (authorization) headers.set("authorization", authorization);
    return handleCron(new Request(`http://${host}/api/internal/cron/${task}`, { method, headers }), task);
  };

  beforeEach(() => {
    vi.stubEnv("CRON_SECRET", SECRET);
    vi.stubEnv("POSTGREST_URL", VALID_BINDINGS.POSTGREST_URL!);
    vi.stubEnv("AUTH_JWT_SECRET", VALID_BINDINGS.AUTH_JWT_SECRET!);
    vi.stubEnv("CREDENTIAL_KEY", VALID_BINDINGS.CREDENTIAL_KEY!);
    vi.stubEnv("MENGANTAR_ENV", "sandbox");
    sweepMock.mockResolvedValue(EMPTY_SWEEP);
    rpcMock.mockImplementation(async (fn) => fn === "auth_purge_expired"
      ? { data: { sessions: 0, otp_codes: 0, remaining: false }, error: null }
      : { data: { deleted_tenants: 0, deleted_users: 0, has_more: false }, error: null });
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("is disabled (404) while CRON_SECRET is unset or empty, even with a matching-looking header", async () => {
    for (const value of ["", undefined]) {
      vi.stubEnv("CRON_SECRET", value as string);
      for (const authorization of [`Bearer ${SECRET}`, "Bearer ", ""]) {
        expect((await call("dispatch", { authorization })).status).toBe(404);
      }
    }
    expect(sweepMock).not.toHaveBeenCalled();
  });

  it("answers 404 on every public, shared and unknown host, with the right secret", async () => {
    for (const host of [
      "geraiexpress.com", "app.geraiexpress.com", "owner.geraiexpress.com", "hooks.geraiexpress.com",
      "staging.geraiexpress.com", "127.0.0.1:3100", "localhost:3100", "app.localhost:3100", "example.com", "",
      "internal.geraiexpress.local.evil.example",
    ]) {
      expect((await call("dispatch", { host })).status, host).toBe(404);
      expect((await call("cleanup", { host })).status, host).toBe(404);
    }
    expect(sweepMock).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("answers 401 without a valid bearer secret on the internal host and runs nothing", async () => {
    for (const authorization of ["", "Bearer", "Bearer wrong", `Bearer ${SECRET}x`, `Bearer ${SECRET.slice(0, -1)}`, `bearer ${SECRET}`, `Basic ${SECRET}`, SECRET]) {
      const res = await call("dispatch", { authorization });
      expect(res.status, authorization).toBe(401);
      expect(res.headers.get("www-authenticate")).toBe("Bearer");
      expect(await res.text()).not.toContain(SECRET);
    }
    expect(sweepMock).not.toHaveBeenCalled();
  });

  it("compares equal-length digests in constant time", () => {
    expect(secretMatches(`Bearer ${SECRET}`, SECRET)).toBe(true);
    expect(secretMatches("Bearer x", SECRET)).toBe(false);
    expect(secretMatches(null, SECRET)).toBe(false);
    expect(secretMatches("Bearer ", "")).toBe(false);
  });

  it("answers 404 for an unknown task after authentication, and only POST is exported", async () => {
    expect((await call("nope")).status).toBe(404);
    expect((await call("constructor")).status).toBe(404);
    expect(Object.keys(route).filter((k) => /^(GET|PUT|PATCH|DELETE|HEAD|OPTIONS|POST)$/.test(k))).toEqual(["POST"]);
  });

  it("runs the dispatch sweep and the cleanup through the route", async () => {
    const dispatch = await call("dispatch");
    expect(dispatch.status).toBe(200);
    expect(await dispatch.json()).toEqual({ task: "dispatch", result: "done", correlationId: expect.stringMatching(UUID) });
    expect(sweepMock).toHaveBeenCalledTimes(1);
    const cleanup = await call("cleanup");
    expect(cleanup.status).toBe(200);
    expect(await cleanup.json()).toEqual({ task: "cleanup", result: "done", correlationId: expect.stringMatching(UUID),
      steps: { demo_cleanup: "done", auth_purge: "done", credential_rewrap: "done", webhook_secret_rewrap: "done", status_pull: "done" } });
    expect(rpcMock).toHaveBeenNthCalledWith(1, "cleanup_expired_demos", { p_max_age_hours: 24 });
    expect(rpcMock).toHaveBeenNthCalledWith(2, "auth_purge_expired", { p_limit: AUTH_PURGE_BATCH });
    expect(sweepMock).toHaveBeenCalledTimes(1);
  });

  it("reaches the route handler through the Next entry point", async () => {
    const res = await route.POST(
      new Request(`http://${INTERNAL}/api/internal/cron/dispatch`, { method: "POST", headers: { host: INTERNAL, authorization: `Bearer ${SECRET}` } }),
      { params: Promise.resolve({ task: "dispatch" }) },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("answers 500 when the task failed", async () => {
    sweepMock.mockRejectedValueOnce(new Error("boom"));
    const res = await call("dispatch");
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ task: "dispatch", result: "failed", correlationId: expect.stringMatching(UUID) });
  });

  it("answers 500 when a cleanup RPC answer is malformed, and 200 for a disabled task (T-105)", async () => {
    rpcMock.mockImplementation(async () => ({ data: null, error: null }));
    const malformed = await call("cleanup");
    expect(malformed.status).toBe(500);
    expect(await malformed.json()).toMatchObject({ result: "failed", steps: { demo_cleanup: "failed", auth_purge: "failed" } });
    vi.stubEnv("MENGANTAR_ENV", "");
    const disabled = await call("dispatch");
    expect(disabled.status).toBe(200);
    expect(await disabled.json()).toMatchObject({ result: "disabled" });
  });

  it("stamps every event of one run with the run's correlation id and logs no secret (T-105)", async () => {
    const log = vi.mocked(console.log);
    log.mockClear();
    const first = await (await call("cleanup")).json();
    const second = await (await call("cleanup")).json();
    expect(first.correlationId).not.toBe(second.correlationId);
    const events = log.mock.calls.map((c) => JSON.parse(String(c[0])));
    const ofFirst = events.filter((e) => e.correlationId === first.correlationId).map((e) => e.event);
    expect(ofFirst).toEqual(["demo_cleanup", "auth_purge", "credential_rewrap", "webhook_secret_rewrap", "status_pull", "cron_run"]);
    expect(events.every((e) => UUID.test(e.correlationId))).toBe(true);
    const text = log.mock.calls.join("\n");
    for (const secret of [SECRET, VALID_BINDINGS.AUTH_JWT_SECRET!, VALID_BINDINGS.CREDENTIAL_KEY!]) expect(text).not.toContain(secret);
  });

  it("does not overlap a task with itself (409) and releases the lock afterwards", async () => {
    let finish: (summary: SweepSummary) => void = () => {};
    sweepMock.mockImplementationOnce(() => new Promise<SweepSummary>((resolve) => { finish = resolve; }));
    const first = call("dispatch");
    await vi.waitFor(() => expect(sweepMock).toHaveBeenCalledTimes(1));
    const second = await call("dispatch");
    expect(second.status).toBe(409);
    expect(await second.json()).toEqual({ task: "dispatch", result: "in_flight", correlationId: expect.stringMatching(UUID) });
    // A different task is independent.
    expect((await call("cleanup")).status).toBe(200);
    finish(EMPTY_SWEEP);
    expect((await first).status).toBe(200);
    expect((await call("dispatch")).status).toBe(200);
    expect(sweepMock).toHaveBeenCalledTimes(2);
  });

  it("aborts and expires a hung run's lock at the deadline; a late finish cannot release a newer lock", async () => {
    vi.useFakeTimers();
    const firstRun = Promise.withResolvers<TaskResult>();
    const nextRun = Promise.withResolvers<TaskResult>();
    let firstSignal: AbortSignal | undefined;
    const run = vi.fn((_env: MachineBindings, signal?: AbortSignal) => {
      firstSignal ??= signal;
      return run.mock.calls.length === 1 ? firstRun.promise : nextRun.promise;
    });
    const request = () => new Request(`http://${INTERNAL}/api/internal/cron/dispatch`, {
      method: "POST", headers: { host: INTERNAL, authorization: `Bearer ${SECRET}` },
    });
    const slow = handleCron(request(), "dispatch", { run: { dispatch: run }, deadlineMs: 10 });
    await vi.advanceTimersByTimeAsync(10);
    expect((await slow).status).toBe(504);
    expect(firstSignal?.aborted).toBe(true);
    const next = handleCron(request(), "dispatch", { run: { dispatch: run }, deadlineMs: 1000 });
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(2);
    firstRun.resolve("done");
    await vi.advanceTimersByTimeAsync(0);
    expect((await call("dispatch")).status).toBe(409);
    nextRun.resolve("done");
    expect((await next).status).toBe(200);
    expect((await call("dispatch")).status).toBe(200);
    vi.useRealTimers();
  });
});

describe("scheduled network deadline", () => {
  it("cancels in-flight fetches and refuses later fetches after abort without reaching the network", async () => {
    const controller = new AbortController();
    const network = vi.fn<typeof fetch>((_input, init) => {
      const pending = Promise.withResolvers<Response>();
      init?.signal?.addEventListener("abort", () => pending.reject(init.signal?.reason), { once: true });
      return pending.promise;
    });
    const bounded = scheduledFetch(controller.signal, network);
    const request = bounded("https://example.test/").catch((error: Error) => error.name);
    controller.abort(new DOMException("deadline", "TimeoutError"));
    expect(await request).toBe("TimeoutError");
    expect(() => bounded("https://example.test/late")).toThrow("deadline");
    expect(network).toHaveBeenCalledTimes(1);
  });

  it("propagates abort through the real dispatcher and cleanup database fetch adapters", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const controller = new AbortController();
    sweepMock.mockImplementation(async (deps) => {
      await (deps as { rpc: (fn: string, args: object) => Promise<unknown> }).rpc("dispatch_noop", {});
      return EMPTY_SWEEP;
    });
    rpcMock.mockResolvedValue({ data: [], error: null });
    await runDispatchSweep(VALID_BINDINGS, controller.signal);
    await runDemoCleanup(VALID_BINDINGS, controller.signal);
    expect(clientOptions).toHaveBeenCalledTimes(2);
    controller.abort(new DOMException("deadline", "TimeoutError"));
    for (const [, options] of clientOptions.mock.calls) {
      await expect(options.fetch("https://example.test/never-sent")).rejects.toThrow("deadline");
    }
  });
});

describe("the machine identity of the scheduled work (DEC-010)", () => {
  const claimsOf = (authorization: string) =>
    JSON.parse(Buffer.from(authorization.replace("Bearer ", "").split(".")[1], "base64url").toString("utf8")) as Record<string, unknown>;

  it("mints the static service_role token on first use and caches the client per closure", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    rpcMock.mockResolvedValue({ data: [], error: null });
    const rpc = cleanupRpc(VALID_BINDINGS)!;
    expect(clientOptions).not.toHaveBeenCalled();
    await rpc("cleanup_expired_demos", { p_max_age_hours: 24 });
    await rpc("cleanup_expired_demos", { p_max_age_hours: 24 });
    expect(clientOptions).toHaveBeenCalledTimes(1);
    const [url, options] = clientOptions.mock.calls[0];
    expect(url).toBe(VALID_BINDINGS.POSTGREST_URL);
    expect(claimsOf(options.headers.Authorization)).toMatchObject({ role: "service_role" });
    await cleanupRpc(VALID_BINDINGS)!("cleanup_expired_demos", {});
    expect(clientOptions).toHaveBeenCalledTimes(2);
  });

  it("keeps an injected fetch on the client", async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });
    const fetchImpl = vi.fn(async () => new Response("[]"));
    await cleanupRpc(VALID_BINDINGS, fetchImpl as unknown as typeof fetch)!("cleanup_expired_demos", {});
    // Wrapped with the per-request database deadline (T-105), and still sent through the injected fetch.
    await clientOptions.mock.calls[0][1].fetch("https://example.test/", {});
    expect(fetchImpl).toHaveBeenCalledExactlyOnceWith("https://example.test/", { signal: expect.any(AbortSignal) });
  });

  it("does not cache a failed mint", async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });
    const rpc = cleanupRpc({ ...VALID_BINDINGS, AUTH_JWT_SECRET: "too-short" })!;
    await expect(rpc("cleanup_expired_demos", {})).rejects.toThrow("at least 32 bytes");
    await expect(rpc("cleanup_expired_demos", {})).rejects.toThrow("at least 32 bytes");
    expect(clientOptions).not.toHaveBeenCalled();
  });
});
