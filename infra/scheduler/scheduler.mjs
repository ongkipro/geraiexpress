// T-062 / DEC-020: the scheduler sidecar. Replaces the Workers cron trigger: once a minute, aligned to the
// wall clock, it POSTs the secret-protected internal cron routes of the app:
//   /api/internal/cron/dispatch  every 5 minutes  (dispatcher sweep, T-024)
//   /api/internal/cron/cleanup   every hour       (expired demo and auth cleanup, T-030 / T-066)
// Node built-ins only (node:http, timers): no dependency, no cron daemon. It runs from the app image
// (`node scheduler.mjs`), talks to the app over the compose network with the internal Host name, and holds
// only CRON_SECRET (never the app's other secrets). The app serializes work itself (in-process lock per
// task + the database's one-in-flight-per-tenant rule); this process also never starts a task while its
// previous call is still waiting, and gives up on a call after CALL_TIMEOUT_MS.
//
// T-105: each call logs the app's bounded result envelope (task result, per-step outcomes, the run's
// correlationId) and `ok`; a failed, timed-out or unreadable run is `ok: false`. On SIGTERM/SIGINT no new
// tick starts and the process waits for in-flight calls (each bounded by CALL_TIMEOUT_MS) before exiting;
// compose.yaml gives the container a stop_grace_period longer than that.
import http from "node:http";
import { fileURLToPath } from "node:url";

export const INTERNAL_HOST = "internal.geraiexpress.local";
// Longer than the app's own response deadline (270 s) so the app answers 504 first.
export const CALL_TIMEOUT_MS = 285_000;

// Which tasks fall on this wall-clock minute (UTC). Dispatch on minutes divisible by 5, cleanup on minute 0.
export function dueTasks(date) {
  const minute = Math.floor(date.getTime() / 60_000) % 60;
  const tasks = [];
  if (minute % 5 === 0) tasks.push("dispatch");
  if (minute === 0) tasks.push("cleanup");
  return tasks;
}

export function msUntilNextMinute(nowMs) {
  return 60_000 - (nowMs % 60_000);
}

const RESULTS = ["done", "partial", "disabled", "failed", "timeout", "in_flight"];
const STEP_RESULTS = ["done", "partial", "disabled", "failed"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MAX_BODY_BYTES = 4096;

// Only known fields with known values leave the app's answer: nothing else reaches the log.
export function envelopeFields(text) {
  let body;
  try { body = JSON.parse(text); } catch { return {}; }
  if (!body || typeof body !== "object" || Array.isArray(body)) return {};
  const out = {};
  if (RESULTS.includes(body.result)) out.result = body.result;
  if (typeof body.correlationId === "string" && UUID.test(body.correlationId)) out.correlationId = body.correlationId;
  if (body.steps && typeof body.steps === "object" && !Array.isArray(body.steps)) {
    const steps = Object.entries(body.steps).filter(([name, value]) => /^[a-z_]{1,32}$/.test(name) && STEP_RESULTS.includes(value)).slice(0, 8);
    if (steps.length) out.steps = Object.fromEntries(steps);
  }
  return out;
}

// A run succeeded only when the app answered 200 with a non-failed result (disabled stays visible in the log).
export const callOk = (result) => result.status === 200 && ["done", "partial", "disabled"].includes(result.result);

// POST one task. Resolves { status, ...envelope } for any HTTP answer and { error } for a transport failure or
// timeout; never rejects and never logs the secret. At most MAX_BODY_BYTES of the answer are read.
export function callTask({ task, target, hostHeader = INTERNAL_HOST, secret, timeoutMs = CALL_TIMEOUT_MS, request = http.request }) {
  const url = new URL(`/api/internal/cron/${task}`, target);
  return new Promise((resolve) => {
    const req = request(
      url,
      { method: "POST", headers: { host: hostHeader, authorization: `Bearer ${secret}`, "content-length": "0" }, timeout: timeoutMs },
      (res) => {
        const chunks = [];
        let size = 0;
        res.on("data", (chunk) => {
          if (size < MAX_BODY_BYTES) chunks.push(chunk.subarray(0, MAX_BODY_BYTES - size));
          size += chunk.length;
        });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, ...envelopeFields(Buffer.concat(chunks).toString("utf8")) }));
        res.on("error", () => resolve({ error: "response" }));
      },
    );
    req.on("timeout", () => { req.destroy(); resolve({ error: "timeout" }); });
    req.on("error", () => resolve({ error: "connect" }));
    req.end();
  });
}

export function createScheduler({ target, hostHeader, secret, log = (line) => console.log(JSON.stringify(line)), call = callTask, now = Date.now }) {
  const running = new Map();
  let stopping = false;
  async function run(task) {
    const started = now();
    try {
      const result = await call({ task, target, hostHeader, secret });
      log({ event: "scheduler_call", task, ...result, ok: callOk(result), ms: now() - started });
    } finally {
      running.delete(task);
    }
  }
  return {
    // Fires every task due at this minute without awaiting them (a slow dispatch never delays cleanup).
    tick(date = new Date(now())) {
      if (stopping) return [];
      const tasks = dueTasks(date);
      for (const task of tasks) {
        if (running.has(task)) log({ event: "scheduler_skipped", task, reason: "previous_call_running" });
        else running.set(task, run(task));
      }
      return tasks;
    },
    running: () => [...running.keys()],
    // Stop starting ticks and wait for in-flight calls (each bounded by its own timeout).
    async drain() {
      stopping = true;
      await Promise.allSettled([...running.values()]);
    },
  };
}

function main() {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error(JSON.stringify({ event: "scheduler_disabled", reason: "CRON_SECRET is not set" }));
    process.exit(1);
  }
  const log = (line) => console.log(JSON.stringify(line));
  const scheduler = createScheduler({
    log,
    target: process.env.SCHEDULER_TARGET ?? "http://app:3000",
    hostHeader: process.env.SCHEDULER_HOST ?? INTERNAL_HOST,
    secret,
  });
  let timer;
  const loop = () => {
    timer = setTimeout(() => {
      scheduler.tick();
      loop();
    }, msUntilNextMinute(Date.now()));
  };
  loop();
  console.log(JSON.stringify({ event: "scheduler_started", target: process.env.SCHEDULER_TARGET ?? "http://app:3000" }));
  for (const signal of ["SIGTERM", "SIGINT"]) {
    process.once(signal, async () => {
      clearTimeout(timer);
      log({ event: "scheduler_stopping", inFlight: scheduler.running() });
      await scheduler.drain();
      process.exit(0);
    });
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
