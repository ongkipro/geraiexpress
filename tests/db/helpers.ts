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

const FIXTURE_PASSWORD: string = "geraiexpress-local-dev";

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

// DEC-010: the dispatcher's machine identity (local secret key). Only for dispatch_* tests.
export function machine(): SupabaseClient {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
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

// TD-3 / DEC-010 dispatcher fixtures.
import { randomUUID } from "node:crypto";
import { credentialAad, sealCredential } from "../../src/lib/credential-crypto";
const OWNER_A = "00000000-0000-4000-a000-0000000000a1";

export type Fixture = { tenant: string; shipment: string; op: string };

// A fresh active tenant with a Mengantar-ready outlet, a submitted shipment, a real quote, a
// sealed seller key and one queued real operation. Built as superuser: confirm_shipment does not
// create real operations until T-024.
export async function realOperation(opts: { tenant?: string; demo?: boolean; simulated?: boolean; sellerKey?: string; sealKey?: string; noCredential?: boolean } = {}): Promise<Fixture> {
  const tenant = opts.tenant ?? randomUUID();
  const outlet = randomUUID(), shipment = randomUUID(), quote = randomUUID(), op = randomUUID();
  const ref = `GX261014-${randomUUID().slice(0, 6).toUpperCase()}`;
  const sealed = await sealCredential(opts.sellerKey ?? "API-TESTSELLERKEY01", credentialAad(tenant, 1), opts.sealKey ?? Buffer.alloc(32, 7).toString("base64"));
  sql(`
    ${opts.tenant ? "" : `insert into public.tenants (id, name, lifecycle, is_demo) values ('${tenant}', 'Gerai Dispatch', 'active', ${opts.demo ? "true" : "false"});
    ${opts.noCredential ? "" : `insert into private.seller_credentials (tenant_id, mode, ciphertext, iv, key_version, hint, version)
      values ('${tenant}', 'byok', '${sealed.ciphertext}', '${sealed.iv}', '${sealed.keyVersion}', 'Y01', 1);`}`}
    insert into public.outlets (tenant_id, id, name, mengantar_pickup_address_id, mengantar_area_id)
      values ('${tenant}', '${outlet}', 'Outlet D', '6acf44a4771fe2b474c055ca', '5fc62f60f8f44b34aa4c0dcd');
    insert into public.shipments (tenant_id, outlet_id, id, reference, submission_state, recipient_name, recipient_phone,
      recipient_address, recipient_area_id, item_description, weight_grams, goods_value_idr, is_simulated, created_by)
      values ('${tenant}', '${outlet}', '${shipment}', '${ref}', 'queued', 'Penerima Uji', '081234567890',
      'Jl. Uji 1', '5fc63169f8f44b34aa4c2ee1', 'Dokumen', 1000, 50000, ${opts.simulated ? "true" : "false"}, '${OWNER_A}');
    insert into public.shipment_quotes (tenant_id, shipment_id, id, shipment_revision, courier, service, normal_tariff_idr,
      eta_days, is_simulated, expires_at)
      values ('${tenant}', '${shipment}', '${quote}', 1, 'JT', 'REG', 9000, '1-2', ${opts.simulated ? "true" : "false"}, now() + interval '1 hour');
    update public.shipments set selected_quote_id = '${quote}' where id = '${shipment}';
    insert into public.provider_operations (tenant_id, shipment_id, id, kind, idempotency_key, input_digest, state, is_simulated, actor)
      values ('${tenant}', '${shipment}', '${op}', 'create_order', 'key-${op}', 'digest', 'queued', ${opts.simulated ? "true" : "false"}, '${OWNER_A}');
  `);
  return { tenant, shipment, op };
}

