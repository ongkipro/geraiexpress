import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { config } from "@/lib/config";
import { randomUUID } from "node:crypto";
import { scopeForHost } from "@/lib/hosts";
import { logEvent, withCorrelation } from "./log";
import type { MachineBindings } from "@/lib/mengantar/machine-deps";
import { CRON_TASKS, machineBindings, type CronTask, type TaskReport, type TaskResult } from "@/lib/mengantar/scheduled";

// T-062 / DEC-020: the secret-protected internal route the scheduler container calls (POST
// /api/internal/cron/dispatch every 5 minutes, /api/internal/cron/cleanup every hour for demo and auth
// cleanup). Replaces the
// former Worker cron trigger; the logic and log events are the former `scheduled` handler's
// (src/lib/mengantar/scheduled.ts).
//
// Gates, in order (every refusal before the secret is checked looks like any unknown path):
//   1. Host: only the internal host name (`internal.geraiexpress.local`, src/lib/hosts.ts). The reverse
//      proxy forwards the original Host and does not route the /api/internal path from the internet
//      (infra/proxy), so a public host answers 404 here and at the proxy.
//   2. CRON_SECRET unset => the route is disabled: 404.
//   3. `Authorization: Bearer <CRON_SECRET>`, compared in constant time on equal-length SHA-256 digests.
//      Missing or wrong => 401. The secret is never logged or echoed.
//   4. A known task name, otherwise 404.
//   5. No overlap: an in-process lock per task (the database's one-in-flight-per-tenant rule stays the
//      real serialization, DEC-010). A call that finds its task running answers 409 and does nothing.
//   6. Bounded execution: at DEADLINE_MS the response is 504, all scheduled database/provider requests
//      are aborted and the lock expires. Every subsequent fetch refuses the aborted signal. A late
//      completion cannot delete a newer run's lock; the DB's one-in-flight rule remains authoritative.
//
// T-105 response envelope (bounded, no secrets): `{ task, result, correlationId, steps? }`. `result` is
// done | partial | disabled | failed | timeout | in_flight; `steps` names each step's outcome for a task
// made of several (cleanup). Status: 200 for done/partial/disabled, 500 failed, 504 timeout, 409 in flight.
// Every event of the run carries the same server-generated `correlationId` (src/lib/log.ts).
export const DEADLINE_MS = 270_000;

const LOCKS = Symbol.for("geraiexpress.cron-locks");
// The compiler cannot know about a Symbol.for slot on globalThis; the slot is created here and only here.
const holder = globalThis as typeof globalThis & { [LOCKS]?: Map<string, symbol> };

const digest = (value: string) => createHash("sha256").update(value).digest();

export function secretMatches(header: string | null, secret: string): boolean {
  const presented = /^Bearer (.+)$/.exec(header ?? "")?.[1] ?? "";
  // Equal-length digests: the comparison time depends on neither the length nor the content.
  return timingSafeEqual(digest(presented), digest(secret)) && presented.length > 0;
}

const json = (body: Record<string, unknown>, status: number, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
const notFound = () => new Response("Not Found", { status: 404, headers: { "Cache-Control": "no-store" } });

export type CronOptions = {
  run?: Readonly<Record<string, (env: MachineBindings, signal?: AbortSignal) => Promise<TaskResult | TaskReport>>>;
  deadlineMs?: number;
};

export async function handleCron(request: Request, task: string, options: CronOptions = {}): Promise<Response> {
  if (scopeForHost(request.headers.get("host")) !== "internal") return notFound();
  const secret = config("CRON_SECRET");
  if (!secret) return notFound();
  if (!secretMatches(request.headers.get("authorization"), secret)) {
    return json({ error: "unauthorized" }, 401, { "WWW-Authenticate": "Bearer" });
  }
  const table = options.run ?? CRON_TASKS;
  if (!Object.hasOwn(table, task)) return notFound();
  const name = task as CronTask;
  const correlationId = randomUUID();
  return withCorrelation(() => runTask(name, table, options.deadlineMs ?? DEADLINE_MS, correlationId), correlationId);
}

async function runTask(name: CronTask, table: NonNullable<CronOptions["run"]>, deadlineMs: number, correlationId: string): Promise<Response> {
  const locks = (holder[LOCKS] ??= new Map());
  if (locks.has(name)) {
    logEvent("cron_skipped", { task: name, reason: "in_flight" });
    return json({ task: name, result: "in_flight", correlationId }, 409);
  }
  const token = Symbol(name);
  locks.set(name, token);
  const release = () => { if (locks.get(name) === token) locks.delete(name); };
  const controller = new AbortController();
  const work = Promise.resolve().then(() => table[name](machineBindings(), controller.signal)).finally(release);

  const { promise: deadline, resolve: expire } = Promise.withResolvers<"timeout">();
  const timer = setTimeout(() => {
    controller.abort(new DOMException("Scheduled task deadline exceeded", "TimeoutError"));
    release();
    expire("timeout");
  }, deadlineMs);
  const settled = await Promise.race([work.catch((): TaskResult => "failed"), deadline]);
  clearTimeout(timer);
  if (settled === "timeout") {
    logEvent("cron_timeout", { task: name });
    return json({ task: name, result: settled, correlationId }, 504);
  }
  const report = typeof settled === "string" ? { result: settled } : settled;
  logEvent("cron_run", { task: name, ...report });
  return json({ task: name, ...report, correlationId }, report.result === "failed" ? 500 : 200);
}

// Test hook: forget held locks.
export function resetCronLocks() {
  holder[LOCKS]?.clear();
}
