import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it, vi } from "vitest";
// @ts-expect-error plain ESM script shipped in the image, no type declarations
import { CALL_TIMEOUT_MS, INTERNAL_HOST, MAX_BODY_BYTES, callOk, callTask, createScheduler, dueTasks, envelopeFields, msUntilNextMinute } from "../../infra/scheduler/scheduler.mjs";

// T-062: the scheduler sidecar fires dispatch every 5 minutes and cleanup hourly (the cadence of the former
// Worker cron plus its aligned-hour cleanup tick).
const HOUR_MS = 3_600_000;
const ALIGNED = 1_790_000_000_000 - (1_790_000_000_000 % HOUR_MS); // a whole UTC hour

describe("schedule", () => {
  it("runs dispatch 288 times and cleanup 24 times over a day of one-minute ticks, cleanup on the hour", () => {
    let dispatch = 0;
    let cleanup = 0;
    for (let t = ALIGNED; t < ALIGNED + 24 * HOUR_MS; t += 60_000) {
      const due: string[] = dueTasks(new Date(t));
      if (due.includes("dispatch")) dispatch++;
      if (due.includes("cleanup")) {
        cleanup++;
        expect(t % HOUR_MS).toBe(0);
        expect(due).toContain("dispatch");
      }
    }
    expect([dispatch, cleanup]).toEqual([288, 24]);
  });

  it("runs nothing on an unaligned minute and only dispatch on a quarter past", () => {
    expect(dueTasks(new Date(ALIGNED + 60_000))).toEqual([]);
    expect(dueTasks(new Date(ALIGNED + 4 * 60_000))).toEqual([]);
    expect(dueTasks(new Date(ALIGNED + 15 * 60_000))).toEqual(["dispatch"]);
    expect(dueTasks(new Date(ALIGNED))).toEqual(["dispatch", "cleanup"]);
  });

  it("sleeps to the next whole minute", () => {
    expect(msUntilNextMinute(ALIGNED)).toBe(60_000);
    expect(msUntilNextMinute(ALIGNED + 59_999)).toBe(1);
    expect(msUntilNextMinute(ALIGNED + 12_345)).toBe(47_655);
  });
});

describe("scheduler loop", () => {
  it("calls due tasks with the secret and the internal host, and never starts a task while its previous call runs", async () => {
    const logs: Record<string, unknown>[] = [];
    let release: () => void = () => {};
    const call = vi.fn(({ task }: { task: string }) =>
      task === "dispatch" ? new Promise<{ status: number }>((resolve) => { release = () => resolve({ status: 200 }); }) : Promise.resolve({ status: 200 }));
    const scheduler = createScheduler({ target: "http://app:3000", hostHeader: INTERNAL_HOST, secret: "s3cret", log: (l: Record<string, unknown>) => logs.push(l), call });

    expect(scheduler.tick(new Date(ALIGNED))).toEqual(["dispatch", "cleanup"]);
    expect(call).toHaveBeenCalledTimes(2);
    expect(call.mock.calls[0][0]).toMatchObject({ task: "dispatch", target: "http://app:3000", hostHeader: INTERNAL_HOST, secret: "s3cret" });
    expect(call.mock.calls[1][0]).toMatchObject({ task: "cleanup", target: "http://app:3000", hostHeader: INTERNAL_HOST, secret: "s3cret" });
    // The next 5-minute tick finds dispatch still running: skipped, not stacked.
    expect(scheduler.tick(new Date(ALIGNED + 5 * 60_000))).toEqual(["dispatch"]);
    expect(call).toHaveBeenCalledTimes(2);
    expect(logs).toContainEqual({ event: "scheduler_skipped", task: "dispatch", reason: "previous_call_running" });
    release();
    await vi.waitFor(() => expect(scheduler.running()).toEqual([]));
    scheduler.tick(new Date(ALIGNED + 10 * 60_000));
    expect(call).toHaveBeenCalledTimes(3);
    expect(JSON.stringify(logs)).not.toContain("s3cret");
  });
});

describe("run outcome (T-105)", () => {
  const ID = "0b6f3c1e-2d4a-4f5b-8c7d-9e0f1a2b3c4d";

  it("keeps only known envelope fields, so nothing else from the answer reaches the log", () => {
    expect(envelopeFields(JSON.stringify({ task: "cleanup", result: "partial", correlationId: ID,
      steps: { demo_cleanup: "done", auth_purge: "partial", credential_rewrap: "disabled", "x y": "done", bad: "secret" }, token: "secret" })))
      .toEqual({ result: "partial", correlationId: ID, steps: { demo_cleanup: "done", auth_purge: "partial", credential_rewrap: "disabled" } });
    for (const text of ["", "Not Found", "[]", "null", JSON.stringify({ result: "ok", correlationId: "not-a-uuid", steps: [] })]) {
      expect(envelopeFields(text), text).toEqual({});
    }
  });

  it("counts only a 200 with done, partial or disabled as a successful run", () => {
    expect([{ status: 200, result: "done" }, { status: 200, result: "partial" }, { status: 200, result: "disabled" }].map(callOk)).toEqual([true, true, true]);
    expect([{ status: 500, result: "failed" }, { status: 200, result: "failed" }, { status: 200 }, { status: 504, result: "timeout" },
      { status: 409, result: "in_flight" }, { error: "timeout" }].map(callOk)).toEqual([false, false, false, false, false, false]);
  });

  it("logs the per-task outcome with ok:false for a failed run", async () => {
    const logs: Record<string, unknown>[] = [];
    const call = vi.fn(async ({ task }: { task: string }) => task === "dispatch"
      ? { status: 200, result: "done", correlationId: ID }
      : { status: 500, result: "failed", steps: { demo_cleanup: "failed" } });
    const scheduler = createScheduler({ target: "http://app:3000", secret: "s3cret", log: (l: Record<string, unknown>) => logs.push(l), call, now: () => 0 });
    scheduler.tick(new Date(ALIGNED));
    await scheduler.drain();
    expect(logs).toEqual([
      { event: "scheduler_call", task: "dispatch", status: 200, result: "done", correlationId: ID, ok: true, ms: 0 },
      { event: "scheduler_call", task: "cleanup", status: 500, result: "failed", steps: { demo_cleanup: "failed" }, ok: false, ms: 0 },
    ]);
  });

  it("on drain starts no new tick and waits for the in-flight call", async () => {
    let release: () => void = () => {};
    const call = vi.fn(() => new Promise<{ status: number }>((resolve) => { release = () => resolve({ status: 200 }); }));
    const scheduler = createScheduler({ target: "http://app:3000", secret: "s", log: () => {}, call });
    scheduler.tick(new Date(ALIGNED + 5 * 60_000));
    let drained = false;
    const drain = scheduler.drain().then(() => { drained = true; });
    expect(scheduler.tick(new Date(ALIGNED + 10 * 60_000))).toEqual([]);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(drained).toBe(false);
    release();
    await drain;
    expect(call).toHaveBeenCalledTimes(1);
    expect(scheduler.running()).toEqual([]);
  });
});

describe("callTask", () => {
  async function withServer(handler: (req: IncomingMessage) => number | "hang", body = "{}") {
    const seen: { method?: string; url?: string; host?: string; authorization?: string }[] = [];
    const server = createServer((req, res) => {
      seen.push({ method: req.method, url: req.url, host: req.headers.host, authorization: req.headers.authorization });
      const result = handler(req);
      if (result !== "hang") res.writeHead(result).end(body);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const target = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    return { seen, target, close: () => { server.closeAllConnections(); server.close(); } };
  }

  it("POSTs the task path with the bearer secret and the internal Host header", async () => {
    const s = await withServer(() => 200);
    try {
      expect(await callTask({ task: "dispatch", target: s.target, secret: "topsecret" })).toEqual({ status: 200 });
      expect(s.seen).toEqual([{ method: "POST", url: "/api/internal/cron/dispatch", host: INTERNAL_HOST, authorization: "Bearer topsecret" }]);
    } finally { s.close(); }
  });

  it("reports an HTTP refusal, a refused connection and a timeout without throwing", async () => {
    const refused = await withServer(() => 401);
    try { expect(await callTask({ task: "cleanup", target: refused.target, secret: "x" })).toEqual({ status: 401 }); } finally { refused.close(); }
    expect(await callTask({ task: "cleanup", target: "http://127.0.0.1:1", secret: "x" })).toEqual({ error: "connect" });
    const hung = await withServer(() => "hang");
    try { expect(await callTask({ task: "dispatch", target: hung.target, secret: "x", timeoutMs: 50 })).toEqual({ error: "timeout" }); } finally { hung.close(); }
  });

  it("returns the bounded envelope of the answer and reads no more than MAX_BODY_BYTES", async () => {
    const id = "0b6f3c1e-2d4a-4f5b-8c7d-9e0f1a2b3c4d";
    const s = await withServer(() => 200, JSON.stringify({ task: "cleanup", result: "done", correlationId: id, steps: { auth_purge: "done" } }));
    try {
      expect(await callTask({ task: "cleanup", target: s.target, secret: "x" })).toEqual({ status: 200, result: "done", correlationId: id, steps: { auth_purge: "done" } });
    } finally { s.close(); }
    const big = await withServer(() => 200, JSON.stringify({ result: "done", pad: "x".repeat(MAX_BODY_BYTES) }));
    try {
      expect(await callTask({ task: "cleanup", target: big.target, secret: "x" })).toEqual({ status: 200 });
    } finally { big.close(); }
  });

  it("waits longer than the app's own 270 s deadline", () => {
    expect(CALL_TIMEOUT_MS).toBeGreaterThan(270_000);
  });
});
