import { createClient } from "@supabase/supabase-js";
import type { DispatcherDeps } from "./dispatcher";

// DEC-010: dispatcher dependencies from Worker bindings, shared by server actions (through
// workerSecret) and the cron handler (its env argument). Any missing piece => null: fail closed.
export type MachineBindings = {
  SUPABASE_URL?: string;
  SUPABASE_SECRET_KEY?: string;
  CREDENTIAL_KEY?: string;
  MENGANTAR_ENV?: string;
};

export function dispatcherDeps(b: MachineBindings, fetchImpl?: typeof fetch): DispatcherDeps | null {
  const environment = b.MENGANTAR_ENV;
  if (!b.SUPABASE_URL || !b.SUPABASE_SECRET_KEY || !b.CREDENTIAL_KEY) return null;
  if (environment !== "sandbox" && environment !== "production") return null;
  const machine = createClient(b.SUPABASE_URL, b.SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  return { rpc: (fn, args) => machine.rpc(fn, args), environment, credentialKey: b.CREDENTIAL_KEY, fetchImpl };
}
