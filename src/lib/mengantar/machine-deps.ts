import { mintStaticJwt } from "../auth/jwt";
import { dataClient, DB_TIMEOUT_MS, SCHEDULED_DB_TIMEOUT_MS, type Db } from "../db/client";
import { keyMaterialFromBindings, resolveKeyRing } from "../credential-crypto";
import { rewrapCandidatePage, type TenantIdPage } from "../credential-keyring";
import type { DispatcherDeps } from "./dispatcher";

// DEC-010: dispatcher dependencies from the environment values, shared by server actions (through
// `config`) and the internal cron route (src/lib/mengantar/scheduled.ts). Any missing piece => null: fail closed.
export type MachineBindings = {
  POSTGREST_URL?: string;
  AUTH_JWT_SECRET?: string;
  CREDENTIAL_KEY?: string;
  // SEC-7 key ring: when CREDENTIAL_KEYS is set, CREDENTIAL_KEY_CURRENT names the sealing version.
  CREDENTIAL_KEYS?: string;
  CREDENTIAL_KEY_CURRENT?: string;
  MENGANTAR_ENV?: string;
};

type Rpc = DispatcherDeps["rpc"];

// The machine identity is the static service_role JWT signed with AUTH_JWT_SECRET. It is minted on the
// first call and the client is cached per closure, so a run that never reaches the database mints nothing.
// Only the scheduled tasks inject a fetch (scheduledFetch, bounded by the 270 s cron deadline): their
// requests get the longer per-request bound; interactive callers keep the default (T-105).
function machineDb(url: string, jwtSecret: string, fetchImpl?: typeof fetch): () => Promise<Db> {
  let machine: Promise<Db> | null = null;
  const timeoutMs = fetchImpl ? SCHEDULED_DB_TIMEOUT_MS : DB_TIMEOUT_MS;
  return () =>
    (machine ??= mintStaticJwt(jwtSecret, "service_role").then((jwt) => dataClient(url, jwt, fetchImpl, timeoutMs))).catch((error) => {
      machine = null;
      throw error;
    });
}

function machineRpc(url: string, jwtSecret: string, fetchImpl?: typeof fetch): Rpc {
  const client = machineDb(url, jwtSecret, fetchImpl);
  return async (fn, args) => (await client()).rpc(fn, args);
}

export function dispatcherDeps(b: MachineBindings, fetchImpl?: typeof fetch): DispatcherDeps | null {
  const environment = b.MENGANTAR_ENV;
  if (!b.POSTGREST_URL || !b.AUTH_JWT_SECRET) return null;
  if (environment !== "sandbox" && environment !== "production") return null;
  // The dispatcher carries the key ring as one string (serialized); a missing or malformed ring is
  // a missing key: fail closed.
  let credentialKey: string | null;
  try {
    credentialKey = keyMaterialFromBindings(b);
  } catch {
    return null;
  }
  if (!credentialKey) return null;
  return { rpc: machineRpc(b.POSTGREST_URL, b.AUTH_JWT_SECRET, fetchImpl), environment, credentialKey, fetchImpl };
}

// Demo cleanup (T-030, DEL-1) calls one service_role RPC and touches no provider or credential,
// so it needs only the PostgREST URL and the JWT secret: a preview without CREDENTIAL_KEY or a
// Mengantar environment still removes expired demo workspaces (T-051).
export function cleanupRpc(b: MachineBindings, fetchImpl?: typeof fetch): Rpc | null {
  if (!b.POSTGREST_URL || !b.AUTH_JWT_SECRET) return null;
  return machineRpc(b.POSTGREST_URL, b.AUTH_JWT_SECRET, fetchImpl);
}

// SEC-7 rewrap (T-057) needs exactly the dispatcher's bindings (key ring and MENGANTAR_ENV): any
// missing piece => null, so the hourly run never rewraps with a partial configuration.
export function rewrapDeps(b: MachineBindings, fetchImpl?: typeof fetch) {
  const deps = dispatcherDeps(b, fetchImpl);
  if (!deps) return null;
  const current = resolveKeyRing(deps.credentialKey).current;
  const page: TenantIdPage = (after, limit) => rewrapCandidatePage(deps.rpc, deps.environment, current, after, limit);
  return { rpc: deps.rpc, environment: deps.environment, key: deps.credentialKey, page };
}
