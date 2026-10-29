import "server-only";
import { config } from "@/lib/config";
import { dataClient } from "@/lib/db/client";
import { createAuth, type Auth } from "./service";
import type { AuthStore } from "./store";

// The process-wide auth service (T-066). Every secret comes from the container environment through
// `config`; a missing or short secret fails closed at first use, never at build time. The store is the
// machine identity (service_role JWT minted from AUTH_JWT_SECRET, DEC-010): the only caller of the
// machine-only `auth_*` functions.
export function postgrestUrl(): string {
  const url = config("POSTGREST_URL");
  if (!url) throw new Error("Missing server environment variable POSTGREST_URL");
  return url;
}

let instance: Auth | null = null;
let keys: Promise<{ anon: string; service: string }> | null = null;

export function getAuth(): Auth {
  if (instance) return instance;
  const jwtSecret = config("AUTH_JWT_SECRET");
  const authSecret = config("AUTH_SECRET");
  if (!jwtSecret || !authSecret) throw new Error("AUTH_JWT_SECRET and AUTH_SECRET must be set");
  // Turnstile is enforced whenever its secret is configured. Without one, the stack must opt out
  // explicitly (local development, a preview without a widget); production never gets there by accident.
  const turnstile = config("TURNSTILE_SECRET_KEY");
  const captcha = turnstile ? { secret: turnstile } : config("AUTH_CAPTCHA_DISABLED") === "true" ? ("disabled" as const) : null;
  if (!captcha) throw new Error("Set TURNSTILE_SECRET_KEY, or AUTH_CAPTCHA_DISABLED=true for a stack without CAPTCHA");
  const store: AuthStore = {
    rpc: async (fn, args) => (await serviceClient()).rpc(fn, args) as ReturnType<AuthStore["rpc"]>,
  };
  instance = createAuth({ store, jwtSecret, authSecret, captcha });
  return instance;
}

// The static anon and service_role JWTs (long TTL, signed with AUTH_JWT_SECRET). Memoized per process.
export function staticKeys(): Promise<{ anon: string; service: string }> {
  keys ??= getAuth().staticKeys().catch((error) => {
    keys = null;
    throw error;
  });
  return keys;
}

export async function serviceClient() {
  return dataClient(postgrestUrl(), (await staticKeys()).service);
}

export async function anonClient() {
  return dataClient(postgrestUrl(), (await staticKeys()).anon);
}
