import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { workerSecret } from "@/lib/worker-secret";
import { env } from "./server";

// DEC-010: the machine identity (Supabase secret key, a Worker secret). It bypasses RLS, so it is
// used only for the service_role-only commands (dispatch_*, machine_seller_key,
// record_live_quotes), and only after the caller's membership was checked with the user's own
// session. Never pass user input as a table filter here. Missing secret => null (fail closed).
export function machineClient(): SupabaseClient | null {
  const key = workerSecret("SUPABASE_SECRET_KEY");
  if (!key) return null;
  return createClient(env("SUPABASE_URL"), key, { auth: { persistSession: false, autoRefreshToken: false } });
}
