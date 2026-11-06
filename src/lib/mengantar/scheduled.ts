import "server-only";
import { config } from "@/lib/config";
import { sweep } from "./dispatcher";
import { pullStatuses } from "./status-pull";
import { rewrapNextBatch, rewrapWebhookSecrets } from "../credential-keyring";
import { logEvent } from "../log";
import { cleanupRpc, dispatcherDeps, rewrapDeps, type MachineBindings } from "./machine-deps";

// The scheduled work of the former Worker `scheduled` handler (T-024, T-030, T-051), now run by the
// secret-protected internal cron route that the scheduler container calls (T-062, DEC-020):
// the dispatcher sweep every 5 minutes, the demo and auth cleanup and the credential rewrap every hour. Both use the machine identity.
// Counts only in logs: no references, keys or recipient data.
//
// T-105 outcome contract: every task event carries `outcome` (done | partial | disabled | failed); an RPC
// answer of the wrong shape (null, missing or non-numeric counts) is `failed`, never zero work; `partial`
// means the task made progress and more remains for the next run. Events go through logEvent, so a cron run
// stamps them with its correlation id.

export function machineBindings(): MachineBindings {
  return {
    POSTGREST_URL: config("POSTGREST_URL"),
    AUTH_JWT_SECRET: config("AUTH_JWT_SECRET"),
    CREDENTIAL_KEY: config("CREDENTIAL_KEY"),
    CREDENTIAL_KEYS: config("CREDENTIAL_KEYS"),
    CREDENTIAL_KEY_CURRENT: config("CREDENTIAL_KEY_CURRENT"),
    MENGANTAR_ENV: config("MENGANTAR_ENV"),
  };
}

export type TaskResult = "done" | "partial" | "disabled" | "failed";
// A task made of several steps reports each one (the cron envelope returns them to the scheduler).
export type TaskReport = { result: TaskResult; steps: Record<string, TaskResult> };

// The first row of a jsonb or one-row RPC answer when every named field has its type (counts are
// non-negative safe integers); otherwise null.
export function rpcRow<F extends string>(data: unknown, fields: Record<F, "count" | "flag">): Record<F, number | boolean> | null {
  const row: unknown = Array.isArray(data) ? (data.length === 1 ? data[0] : null) : data;
  if (!row || typeof row !== "object") return null;
  for (const [name, kind] of Object.entries(fields)) {
    const value = (row as Record<string, unknown>)[name];
    if (kind === "count" ? !(Number.isSafeInteger(value) && (value as number) >= 0) : typeof value !== "boolean") return null;
  }
  return row as Record<F, number | boolean>;
}

const worst = (results: TaskResult[]): TaskResult =>
  results.includes("failed") ? "failed" : results.includes("partial") ? "partial" : results.includes("done") ? "done" : "disabled";

// Every scheduled network operation (database RPCs AND provider calls) observes the same deadline.
// After abort, no later step can send a request, even if an earlier adapter swallowed the abort error.
export function scheduledFetch(signal?: AbortSignal, fetchImpl: typeof fetch = fetch): typeof fetch {
  return (input, init) => {
    signal?.throwIfAborted();
    const requestSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    return fetchImpl(input, {
      ...init,
      signal: signal && requestSignal ? AbortSignal.any([signal, requestSignal]) : signal ?? requestSignal,
    });
  };
}

// Dispatches queued real operations nobody sent, reconciles stale or unknown ones and re-checks unpaid
// orders. The sweep needs the full machine bindings; without them it logs `disabled` and does nothing.
export async function runDispatchSweep(env: MachineBindings, signal?: AbortSignal): Promise<TaskResult> {
  const deps = dispatcherDeps(env, scheduledFetch(signal));
  if (!deps) {
    logEvent("dispatch_sweep", { outcome: "disabled", disabled: true });
    return "disabled";
  }
  try {
    const s = await sweep(deps);
    const tally: Record<string, number> = {};
    for (const r of s.results) tally[`${r.action}:${r.status}`] = (tally[`${r.action}:${r.status}`] ?? 0) + 1;
    const priceMismatch = s.results.filter((r) => r.priceMismatch).length;
    const priceUnknown = s.results.filter((r) => r.priceUnknown).length;
    const outcome: TaskResult = s.failed ? "failed" : "done";
    logEvent("dispatch_sweep", { outcome, checked: s.checked, failed: s.failed ?? false, tally, priceMismatch, priceUnknown, stuck: s.stuck });
    return outcome;
  } catch {
    logEvent("dispatch_sweep", { outcome: "failed", failed: true });
    return "failed";
  }
}

// Hourly expired-demo cleanup: needs only the PostgREST URL and the JWT secret, so it runs without the
// dispatcher bindings. `hasMore` (another batch remains) is a partial run.
export async function runDemoCleanup(env: MachineBindings, signal?: AbortSignal): Promise<TaskResult> {
  const rpc = cleanupRpc(env, scheduledFetch(signal));
  if (!rpc) {
    logEvent("demo_cleanup", { outcome: "disabled", disabled: true });
    return "disabled";
  }
  try {
    const { data, error } = await rpc("cleanup_expired_demos", { p_max_age_hours: 24 });
    const row = error ? null : rpcRow(data, { deleted_tenants: "count", deleted_users: "count", has_more: "flag" });
    if (!row) {
      logEvent("demo_cleanup", { outcome: "failed", failed: true, ...(error ? {} : { malformed: true }) });
      return "failed";
    }
    const outcome: TaskResult = row.has_more ? "partial" : "done";
    logEvent("demo_cleanup", { outcome, deletedTenants: row.deleted_tenants, deletedUsers: row.deleted_users, hasMore: row.has_more, failed: false });
    return outcome;
  } catch {
    logEvent("demo_cleanup", { outcome: "failed", failed: true });
    return "failed";
  }
}

// T-104: auth_purge_expired deletes at most AUTH_PURGE_BATCH rows per table per call; one hourly run
// drains at most AUTH_PURGE_MAX_BATCHES batches and leaves the rest (hasMore) to the next run.
export const AUTH_PURGE_BATCH = 1000;
export const AUTH_PURGE_MAX_BATCHES = 10;

type AuthPurgeBatch = { sessions: number; otpCodes: number; remaining: boolean };

// A missing or malformed reply is a failure, never "nothing to purge".
function authPurgeBatch(data: unknown): AuthPurgeBatch | null {
  const row: unknown = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== "object") return null;
  const { sessions, otp_codes: otpCodes, remaining } = row as Record<string, unknown>;
  const count = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
  if (!count(sessions) || !count(otpCodes) || typeof remaining !== "boolean") return null;
  return { sessions, otpCodes, remaining };
}

// Hourly expired-auth purge (T-065 / T-066 / T-104): removes sessions dead for > 7 days and OTP codes
// older than 1 day in bounded batches. Like demo cleanup, needs only the PostgREST URL and the JWT secret.
export async function runAuthPurge(env: MachineBindings, signal?: AbortSignal): Promise<TaskResult> {
  const rpc = cleanupRpc(env, scheduledFetch(signal));
  if (!rpc) {
    logEvent("auth_purge", { outcome: "disabled", disabled: true });
    return "disabled";
  }
  let sessions = 0;
  let otpCodes = 0;
  let hasMore = true;
  const log = (failed: boolean, malformed = false) =>
    logEvent("auth_purge", {
      outcome: failed ? "failed" : hasMore ? "partial" : "done",
      sessions, otpCodes, hasMore, failed, ...(malformed ? { malformed: true } : {}),
    });
  try {
    for (let batch = 0; hasMore && batch < AUTH_PURGE_MAX_BATCHES; batch++) {
      signal?.throwIfAborted();
      const { data, error } = await rpc("auth_purge_expired", { p_limit: AUTH_PURGE_BATCH });
      const result = error ? null : authPurgeBatch(data);
      if (!result) {
        log(true, !error);
        return "failed";
      }
      sessions += result.sessions;
      otpCodes += result.otpCodes;
      hasMore = result.remaining;
    }
    log(false);
    // A backlog left after the per-run batch budget is partial work, not completion (OBSERVABILITY.md).
    return hasMore ? "partial" : "done";
  } catch {
    log(true);
    return "failed";
  }
}

// Hourly SEC-7 rewrap (T-057): moves this MENGANTAR_ENV's active credentials sealed under an older
// key version to CREDENTIAL_KEY_CURRENT. Idempotent (a current row is skipped, the database fences the
// expected key version). Bounded and resumable (T-105): one batch of tenants per run after the previous
// run's cursor; `pending` (more tenants remain) is a partial run, a failed tenant fails the run.
// Counts only in logs; never tenant ids, key material or ciphertext.
export async function runCredentialRewrap(env: MachineBindings, signal?: AbortSignal): Promise<TaskResult> {
  const deps = rewrapDeps(env, scheduledFetch(signal));
  if (!deps) {
    logEvent("credential_rewrap", { outcome: "disabled", disabled: true });
    return "disabled";
  }
  try {
    const s = await rewrapNextBatch({ rpc: deps.rpc, key: deps.key, environment: deps.environment, page: deps.page });
    const outcome: TaskResult = s.failed.length ? "failed" : s.pending ? "partial" : "done";
    logEvent("credential_rewrap", {
      outcome, environment: deps.environment, scanned: s.scanned, rewrapped: s.rewrapped,
      alreadyCurrent: s.alreadyCurrent, noCredential: s.noCredential, conflicts: s.conflicts, failed: s.failed.length, pending: s.pending,
    });
    return outcome;
  } catch {
    logEvent("credential_rewrap", { outcome: "failed", failed: true });
    return "failed";
  }
}

// T-045: Webhook Secrets follow the same key-ring rotation (ADR-0003 §2.2). Counts only in logs.
export async function runWebhookSecretRewrap(env: MachineBindings, signal?: AbortSignal): Promise<TaskResult> {
  const deps = rewrapDeps(env, scheduledFetch(signal));
  if (!deps) {
    logEvent("webhook_secret_rewrap", { outcome: "disabled", disabled: true });
    return "disabled";
  }
  try {
    const s = await rewrapWebhookSecrets({ rpc: deps.rpc, key: deps.key, environment: deps.environment });
    const outcome: TaskResult = s.failed ? "failed" : s.pending ? "partial" : "done";
    logEvent("webhook_secret_rewrap", { outcome, environment: deps.environment, ...s });
    return outcome;
  } catch {
    logEvent("webhook_secret_rewrap", { outcome: "failed", failed: true });
    return "failed";
  }
}

// The hourly cleanup runs every step (a step without its bindings reports itself disabled) and reports each.
// T-045 / ADR-0003 §2.6: hourly status pull for issued shipments the webhook has not updated (missed, paused or
// not configured). Read-only GET /order with each seller's own key; bounded per run (STATUS_PULL_MAX).
export async function runStatusPull(env: MachineBindings, signal?: AbortSignal): Promise<TaskResult> {
  const deps = dispatcherDeps(env, scheduledFetch(signal));
  if (!deps) {
    logEvent("status_pull", { outcome: "disabled", disabled: true });
    return "disabled";
  }
  try {
    const s = await pullStatuses(deps);
    const outcome: TaskResult = s.failed ? (s.applied || s.unchanged ? "partial" : "failed") : "done";
    logEvent("status_pull", { outcome, ...s });
    return outcome;
  } catch {
    logEvent("status_pull", { outcome: "failed", failed: true });
    return "failed";
  }
}

export async function runCleanup(env: MachineBindings, signal?: AbortSignal): Promise<TaskReport> {
  const steps = {
    demo_cleanup: await runDemoCleanup(env, signal),
    auth_purge: await runAuthPurge(env, signal),
    credential_rewrap: await runCredentialRewrap(env, signal),
    webhook_secret_rewrap: await runWebhookSecretRewrap(env, signal),
    status_pull: await runStatusPull(env, signal),
  };
  return { result: worst(Object.values(steps)), steps };
}

export const CRON_TASKS = {
  dispatch: runDispatchSweep,
  cleanup: runCleanup,
} as const;
export type CronTask = keyof typeof CRON_TASKS;
