// T-062 / DEC-020: the scheduler sidecar. Replaces the Workers cron trigger: once a minute, aligned to the
// wall clock, it POSTs the secret-protected internal cron routes of the app:
//   /api/internal/cron/dispatch  every 5 minutes  (dispatcher sweep, T-024)
//   /api/internal/cron/cleanup   every hour       (expired demo and auth cleanup, T-030 / T-066)
// Node built-ins only (node:http, timers): no dependency, no cron daemon. It runs from the app image
// (`node scheduler.mjs`), talks to the app over the compose network with the internal Host name, and holds
// only CRON_SECRET (never the app's other secrets). The app serializes work itself (in-process lock per
// task + the database's one-in-flight-per-tenant rule); this process also never starts a task while its
// previous call is still waiting, and gives up on a call after CALL_TIMEOUT_MS.
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

// POST one task. Resolves { status } for any HTTP answer and { error } for a transport failure or timeout;
// never rejects and never logs the secret.
export function callTask({ task, target, hostHeader = INTERNAL_HOST, secret, timeoutMs = CALL_TIMEOUT_MS, request = http.request }) {
  const url = new URL(`/api/internal/cron/${task}`, target);
  return new Promise((resolve) => {
    const req = request(
      url,
      { method: "POST", headers: { host: hostHeader, authorization: `Bearer ${secret}`, "content-length": "0" }, timeout: timeoutMs },
      (res) => {
        res.resume();
        res.on("end", () => resolve({ status: res.statusCode ?? 0 }));
        res.on("error", () => resolve({ error: "response" }));
      },
    );
    req.on("timeout", () => { req.destroy(); resolve({ error: "timeout" }); });
    req.on("error", () => resolve({ error: "connect" }));
    req.end();
  });
}

export function createScheduler({ target, hostHeader, secret, log = (line) => console.log(JSON.stringify(line)), call = callTask, now = Date.now }) {
  const running = new Set();
  async function run(task) {
    if (running.has(task)) {
      log({ event: "scheduler_skipped", task, reason: "previous_call_running" });
      return;
    }
    running.add(task);
    const started = now();
    try {
      const result = await call({ task, target, hostHeader, secret });
      log({ event: "scheduler_call", task, ...result, ms: now() - started });
    } finally {
      running.delete(task);
    }
  }
  return {
    // Fires every task due at this minute without awaiting them (a slow dispatch never delays cleanup).
    tick(date = new Date(now())) {
      const tasks = dueTasks(date);
      for (const task of tasks) void run(task);
      return tasks;
    },
    running: () => [...running],
  };
}

function main() {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error(JSON.stringify({ event: "scheduler_disabled", reason: "CRON_SECRET is not set" }));
    process.exit(1);
  }
  const scheduler = createScheduler({
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
  for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => { clearTimeout(timer); process.exit(0); });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
