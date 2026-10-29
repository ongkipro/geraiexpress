import "server-only";
import { config } from "@/lib/config";
import { sweep } from "./dispatcher";
import { reencryptCredentials } from "../credential-keyring";
import { cleanupRpc, dispatcherDeps, rewrapDeps, type MachineBindings } from "./machine-deps";

// The scheduled work of the former Worker `scheduled` handler (T-024, T-030, T-051), now run by the
// secret-protected internal cron route that the scheduler container calls (T-062, DEC-020):
// the dispatcher sweep every 5 minutes, the demo and auth cleanup and the credential rewrap every hour. Both use the machine identity.
// Counts only in logs: no references, keys or recipient data.

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

export type TaskResult = "done" | "disabled" | "failed";

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
    console.log(JSON.stringify({ event: "dispatch_sweep", disabled: true }));
    return "disabled";
  }
  try {
    const s = await sweep(deps);
    const tally: Record<string, number> = {};
    for (const r of s.results) tally[`${r.action}:${r.status}`] = (tally[`${r.action}:${r.status}`] ?? 0) + 1;
    const priceMismatch = s.results.filter((r) => r.priceMismatch).length;
    const priceUnknown = s.results.filter((r) => r.priceUnknown).length;
    console.log(JSON.stringify({ event: "dispatch_sweep", checked: s.checked, failed: s.failed ?? false, tally, priceMismatch, priceUnknown, stuck: s.stuck }));
    return s.failed ? "failed" : "done";
  } catch {
    console.log(JSON.stringify({ event: "dispatch_sweep", failed: true }));
    return "failed";
  }
}

// Hourly expired-demo cleanup: needs only the PostgREST URL and the JWT secret, so it runs without the
// dispatcher bindings. Nothing is logged when those two are missing (as before).
export async function runDemoCleanup(env: MachineBindings, signal?: AbortSignal): Promise<TaskResult> {
  const rpc = cleanupRpc(env, scheduledFetch(signal));
  if (!rpc) return "disabled";
  try {
    const { data, error } = await rpc("cleanup_expired_demos", { p_max_age_hours: 24 });
    const row: { deleted_tenants?: number; deleted_users?: number; has_more?: boolean } | null | undefined = Array.isArray(data) ? data[0] : data;
    console.log(
      JSON.stringify({
        event: "demo_cleanup",
        deletedTenants: row?.deleted_tenants ?? 0,
        deletedUsers: row?.deleted_users ?? 0,
        hasMore: row?.has_more ?? false,
        failed: Boolean(error),
      }),
    );
    return error ? "failed" : "done";
  } catch {
    console.log(JSON.stringify({ event: "demo_cleanup", deletedTenants: 0, deletedUsers: 0, hasMore: false, failed: true }));
    return "failed";
  }
}

// Hourly expired-auth purge (T-065 / T-066): removes sessions dead for > 7 days and OTP codes older
// than 1 day. Like demo cleanup, needs only the PostgREST URL and the JWT secret.
export async function runAuthPurge(env: MachineBindings, signal?: AbortSignal): Promise<TaskResult> {
  const rpc = cleanupRpc(env, scheduledFetch(signal));
  if (!rpc) return "disabled";
  try {
    const { data, error } = await rpc("auth_purge_expired", {});
    const row: { sessions?: number; otp_codes?: number } | null | undefined = Array.isArray(data) ? data[0] : data;
    console.log(
      JSON.stringify({
        event: "auth_purge",
        sessions: row?.sessions ?? 0,
        otpCodes: row?.otp_codes ?? 0,
        failed: Boolean(error),
      }),
    );
    return error ? "failed" : "done";
  } catch {
    console.log(JSON.stringify({ event: "auth_purge", sessions: 0, otpCodes: 0, failed: true }));
    return "failed";
  }
}

// Hourly SEC-7 rewrap (T-057): moves this MENGANTAR_ENV's active credentials sealed under an older
// key version to CREDENTIAL_KEY_CURRENT. Idempotent (a current row is skipped, the database fences the
// expected key version). Counts only in logs; never tenant ids, key material or ciphertext.
export async function runCredentialRewrap(env: MachineBindings, signal?: AbortSignal): Promise<TaskResult> {
  const deps = rewrapDeps(env, scheduledFetch(signal));
  if (!deps) {
    console.log(JSON.stringify({ event: "credential_rewrap", disabled: true }));
    return "disabled";
  }
  try {
    const s = await reencryptCredentials({ rpc: deps.rpc, key: deps.key, environment: deps.environment, tenantIds: await deps.tenantIds() });
    console.log(JSON.stringify({
      event: "credential_rewrap", environment: deps.environment, scanned: s.scanned, rewrapped: s.rewrapped,
      alreadyCurrent: s.alreadyCurrent, noCredential: s.noCredential, conflicts: s.conflicts, failed: s.failed.length,
    }));
    return s.failed.length ? "failed" : "done";
  } catch {
    console.log(JSON.stringify({ event: "credential_rewrap", failed: true }));
    return "failed";
  }
}

export async function runCleanup(env: MachineBindings, signal?: AbortSignal): Promise<TaskResult> {
  const demo = await runDemoCleanup(env, signal);
  if (demo === "disabled") return "disabled";
  const auth = await runAuthPurge(env, signal);
  const rewrap = await runCredentialRewrap(env, signal);
  return demo === "failed" || auth === "failed" || rewrap === "failed" ? "failed" : "done";
}

export const CRON_TASKS = {
  dispatch: runDispatchSweep,
  cleanup: runCleanup,
} as const;
export type CronTask = keyof typeof CRON_TASKS;
