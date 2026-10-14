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

// T-016: local Auth requires a Turnstile token; Cloudflare's test secret accepts its documented
// dummy token, so every client attaches it to the captcha-protected entry points.
export const DUMMY_CAPTCHA = "XXXX.DUMMY.TOKEN.XXXX";

export function client(): SupabaseClient {
  const c = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const auth = c.auth as unknown as Record<string, (p?: { options?: object }) => unknown>;
  for (const name of ["signInWithPassword", "signInAnonymously", "signInWithOtp", "signUp"]) {
    const original = auth[name].bind(c.auth);
    auth[name] = (p = {}) => original({ ...p, options: { ...p.options, captchaToken: DUMMY_CAPTCHA } });
  }
  return c;
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

// PR-24: a platform session upgraded to aal2 with the fixture TOTP secret.
import { FIXTURE_TOTP, totp } from "../totp";
export async function signInAal2(email: keyof typeof FIXTURE_TOTP): Promise<SupabaseClient> {
  const c = await signIn(email);
  const { data } = await c.auth.mfa.listFactors();
  const { error } = await c.auth.mfa.challengeAndVerify({ factorId: data!.totp[0].id, code: totp(FIXTURE_TOTP[email]) });
  if (error) throw new Error(`mfa ${email}: ${error.message}`);
  return c;
}

import { mailCode } from "../mail";
export { mailCode };

// PR-29: a brand-new identity that proved inbox control with the mailed code.
export async function verifiedNewUser(prefix = "applicant"): Promise<{ c: SupabaseClient; email: string; id: string }> {
  const email = `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@geraiexpress.test`;
  const c = client();
  const { error } = await c.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
  if (error) throw new Error(`otp ${email}: ${error.message}`);
  const { data, error: e2 } = await c.auth.verifyOtp({ email, token: await mailCode(email), type: "email" });
  if (e2) throw new Error(`verify ${email}: ${e2.message}`);
  return { c, email, id: data.user!.id };
}
