import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const IDS = {
  tenantA: "00000000-0000-4000-b000-00000000000a",
  tenantB: "00000000-0000-4000-b000-00000000000b",
  outletA: "00000000-0000-4000-c000-00000000000a",
  outletB: "00000000-0000-4000-c000-00000000000b",
  contactA: "00000000-0000-4000-d000-00000000000a",
  contactB: "00000000-0000-4000-d000-00000000000b",
  shipmentA: "00000000-0000-4000-e000-00000000000a",
  shipmentB: "00000000-0000-4000-e000-00000000000b",
};

const FIXTURE_PASSWORD = "geraiexpress-local-dev";

export function client(): SupabaseClient {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function signIn(email: string): Promise<SupabaseClient> {
  const c = client();
  const { error } = await c.auth.signInWithPassword({ email, password: FIXTURE_PASSWORD });
  if (error) throw new Error(`sign-in ${email}: ${error.message}`);
  return c;
}

export async function demoVisitor(): Promise<{ c: SupabaseClient; tenant: string; outlet: string }> {
  const c = client();
  const { error } = await c.auth.signInAnonymously();
  if (error) throw new Error(`anonymous sign-in: ${error.message}`);
  const { data: tenant, error: e2 } = await c.rpc("start_demo");
  if (e2) throw new Error(`start_demo: ${e2.message}`);
  const { data: outlets } = await c.from("outlets").select("id").eq("tenant_id", tenant);
  return { c, tenant: tenant as string, outlet: outlets![0].id };
}

// Local-only superuser SQL for fixture setup and catalog assertions that the API cannot express.
import { execFileSync } from "node:child_process";
export function sql(statement: string): string {
  return execFileSync("docker", ["exec", "supabase_db_geraiexpress", "psql", "-U", "postgres", "-tA", "-v", "ON_ERROR_STOP=1", "-c", statement], {
    encoding: "utf8",
  }).trim();
}
