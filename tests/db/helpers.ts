import { randomUUID } from "node:crypto";
import { PostgrestClient } from "@supabase/postgrest-js";
import { createAuth, type Auth, type AuthConfig, type SessionTokens } from "../../src/lib/auth";
import { hashPassword } from "../../src/lib/auth/password";
import type { Db } from "../../src/lib/db/client";
import { mintJwt, type Claims } from "./mint-jwt";

// Plain-PostgreSQL stack (ADR-0002): PostgREST at POSTGREST_URL, JWTs minted locally from AUTH_JWT_SECRET,
// superuser SQL through the compose container. All values come from infra/dev/.env (tests/db/global-setup.ts).
export const DB_CONTAINER = process.env.GX_DB_CONTAINER ?? "gxdb-postgres-1";
export const DB_NAME = process.env.GX_DB_NAME ?? "gxdb";

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

const FIXTURE_EMAIL_DOMAIN = "geraiexpress.test";

type TestUser = { id: string; email: string | null; is_anonymous: boolean };
type Session = { token: string; user: TestUser | null };

// The suite's client type: the application's data client plus the small `auth` shim of `connect` below.
export type TestClient = Db & {
  auth: {
    getUser(): Promise<{ data: { user: TestUser }; error: null } | { data: { user: null }; error: { message: string } }>;
    signInAnonymously(): Promise<{ data: { user: TestUser; session: { access_token: string } }; error: { message: string } | null }>;
  };
};

// A PostgREST client whose bearer follows `session`. `auth` offers only what the identity-only suites use:
// getUser (verified claims of this session) and signInAnonymously (a fresh anonymous auth.users row).
// Everything else about identity goes through `authService()` (real codes, passwords and sessions).
function connect(session: Session): TestClient {
  const base = process.env.POSTGREST_URL;
  if (!base) throw new Error("POSTGREST_URL missing: run `pnpm db:up` first");
  const api = new PostgrestClient(base, {
    fetch: (input, init) => {
      const headers = new Headers(init?.headers);
      headers.set("Authorization", `Bearer ${session.token}`);
      return fetch(input, { ...init, headers });
    },
  });
  const auth = {
    async getUser() {
      return session.user
        ? { data: { user: session.user }, error: null }
        : { data: { user: null }, error: { message: "Auth session missing!" } };
    },
    async signInAnonymously() {
      const id = randomUUID();
      sql(`insert into auth.users (id, is_anonymous, raw_app_meta_data) values ('${id}', true, '{"provider":"anonymous","providers":["anonymous"]}')`);
      session.token = mintJwt({ sub: id, role: "authenticated", is_anonymous: true });
      session.user = { id, email: null, is_anonymous: true };
      return { data: { user: session.user, session: { access_token: session.token } }, error: null };
    },
  };
  return Object.assign(api, { auth }) as unknown as TestClient;
}

const asUser = (user: TestUser, claims: Partial<Claims> = {}): TestClient =>
  connect({ token: mintJwt({ sub: user.id, role: "authenticated", email: user.email ?? "", is_anonymous: user.is_anonymous, ...claims }), user });

export function client(): TestClient {
  return connect({ token: mintJwt({ role: "anon" }), user: null });
}

// DEC-010: the dispatcher's machine identity (service_role JWT). Only for dispatch_* tests.
export function machine(): TestClient {
  return connect({ token: mintJwt({ role: "service_role" }, 3600), user: null });
}

// The application's own auth service against the live stack: the machine client is its store, the
// secrets are the ones PostgREST validates with. CAPTCHA is off unless a test passes its own setting.
export function authService(captcha: AuthConfig["captcha"] = "disabled"): Auth {
  const jwtSecret = process.env.AUTH_JWT_SECRET;
  const authSecret = process.env.AUTH_SECRET;
  if (!jwtSecret || !authSecret) throw new Error("AUTH_JWT_SECRET / AUTH_SECRET missing: run `pnpm db:up` first");
  return createAuth({ store: machine(), jwtSecret, authSecret, captcha });
}

// A PostgREST client carrying a real access token of a live session created by the auth service.
export function sessionClient(session: SessionTokens): TestClient {
  return connect({
    token: session.accessToken,
    user: { id: session.userId, email: session.email, is_anonymous: session.isAnonymous },
  });
}

// Registers or signs in through the whole emailed-code flow (the service returns the code, no mail).
export async function codeSignIn(email: string): Promise<{ c: TestClient; id: string; session: SessionTokens }> {
  const auth = authService();
  const sent = await auth.requestEmailCode({ email, captchaToken: undefined });
  if (sent.status !== "sent") throw new Error(`code ${email}: ${sent.status}`);
  const verified = await auth.verifyEmailCode({ email, code: sent.code, captchaToken: undefined });
  if (!verified.ok) throw new Error(`verify ${email}: ${verified.reason}`);
  return { c: sessionClient(verified.session), id: verified.session.userId, session: verified.session };
}

export async function anonymousSession(): Promise<{ c: TestClient; id: string; session: SessionTokens }> {
  const result = await authService().signInAnonymous({ captchaToken: undefined });
  if (!result.ok) throw new Error(`anonymous sign-in: ${result.reason}`);
  return { c: sessionClient(result.session), id: result.session.userId, session: result.session };
}

// A confirmed account holding a real scrypt password, created with superuser SQL (the signed-in path
// of an owner who set a password earlier). Never touches the seeded fixture users.
export async function passwordUser(prefix = "pwuser", password = "fixture-password-123"): Promise<{ id: string; email: string; password: string }> {
  const email = `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@${FIXTURE_EMAIL_DOMAIN}`;
  const id = randomUUID();
  const hash = await hashPassword(password);
  sql(`insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data) values ('${id}', '${email}', '${hash}', now(), '{"provider":"email","providers":["email"]}')`);
  return { id, email, password };
}

// Looks the fixture user up with superuser SQL and mints its access token. The password is not
// checked: password verification belongs to the owned auth core (T-065).
function fixtureUser(email: string): TestUser {
  const row = sql(`select id || '|' || is_anonymous from auth.users where lower(email) = lower('${email.replace(/'/g, "''")}') and deleted_at is null`);
  if (!row) throw new Error(`sign-in ${email}: no such user (is the seed loaded?)`);
  const [id, anonymous] = row.split("|");
  return { id, email, is_anonymous: anonymous === "t" };
}

export async function signIn(email: string): Promise<TestClient> {
  return asUser(fixtureUser(email));
}

export async function demoVisitor(): Promise<{ c: TestClient; tenant: string; outlet: string }> {
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
  return execFileSync("docker", ["exec", DB_CONTAINER, "psql", "-U", "postgres", "-d", DB_NAME, "-tA", "-v", "ON_ERROR_STOP=1", "-c", statement], {
    encoding: "utf8",
  }).trim();
}

// PR-24: a platform session at aal2. The token is minted with aal2; the real TOTP verification flow
// (sealed secret, replay guard) is rewritten against the new auth functions in T-065.
export async function signInAal2(email: string): Promise<TestClient> {
  return asUser(fixtureUser(email), { aal: "aal2", amr: [{ method: "totp", timestamp: Math.floor(Date.now() / 1000) }] });
}

// PR-29: a brand-new identity whose inbox control is recorded as proven (email_confirmed_at set, no password,
// like a user that completed the emailed-code step). The OTP flow itself is T-065.
export async function verifiedNewUser(prefix = "applicant"): Promise<{ c: TestClient; email: string; id: string }> {
  const email = `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@${FIXTURE_EMAIL_DOMAIN}`;
  const id = randomUUID();
  sql(`insert into auth.users (id, email, email_confirmed_at, raw_app_meta_data) values ('${id}', '${email}', now(), '{"provider":"email","providers":["email"]}')`);
  return { c: asUser({ id, email, is_anonymous: false }), email, id };
}

// TD-3 / DEC-010 dispatcher fixtures.
import { credentialAad, sealCredential } from "../../src/lib/credential-crypto";
const OWNER_A = "00000000-0000-4000-a000-0000000000a1";

export type Fixture = { tenant: string; shipment: string; op: string };

// A fresh active tenant with a Mengantar-ready outlet, a submitted shipment, a real quote, a
// sealed seller key and one queued real operation. Built as superuser: confirm_shipment does not
// create real operations until T-024.
export async function realOperation(opts: { tenant?: string; demo?: boolean; simulated?: boolean; sellerKey?: string; sealKey?: string; noCredential?: boolean; credentialEnv?: "sandbox" | "production" } = {}): Promise<Fixture> {
  const tenant = opts.tenant ?? randomUUID();
  const outlet = randomUUID(), shipment = randomUUID(), quote = randomUUID(), op = randomUUID();
  const ref = `GX261014-${randomUUID().slice(0, 6).toUpperCase()}`;
  const sealed = await sealCredential(opts.sellerKey ?? "API-TESTSELLERKEY01", credentialAad(tenant, 1), opts.sealKey ?? Buffer.alloc(32, 7).toString("base64"));
  sql(`
    ${opts.tenant ? "" : `insert into public.tenants (id, name, lifecycle, is_demo) values ('${tenant}', 'Gerai Dispatch', 'active', ${opts.demo ? "true" : "false"});
    ${opts.noCredential ? "" : `insert into private.seller_credentials (tenant_id, mode, ciphertext, iv, key_version, hint, version, provider_env)
      values ('${tenant}', 'byok', '${sealed.ciphertext}', '${sealed.iv}', '${sealed.keyVersion}', 'Y01', 1, '${opts.credentialEnv ?? "sandbox"}');`}`}
    insert into public.outlets (tenant_id, id, name, mengantar_pickup_address_id, mengantar_area_id)
      values ('${tenant}', '${outlet}', 'Outlet D', '6acf44a4771fe2b474c055ca', '5fc62f60f8f44b34aa4c0dcd');
    insert into public.shipments (tenant_id, outlet_id, id, reference, submission_state, recipient_name, recipient_phone,
      recipient_address, recipient_area_id, item_description, weight_grams, goods_value_idr, is_simulated, created_by)
      values ('${tenant}', '${outlet}', '${shipment}', '${ref}', 'queued', 'Penerima Uji', '081234567890',
      'Jl. Uji 1', '5fc63169f8f44b34aa4c2ee1', 'Dokumen', 1000, 50000, ${opts.simulated ? "true" : "false"}, '${OWNER_A}');
    insert into public.shipment_quotes (tenant_id, shipment_id, id, shipment_revision, courier, service, normal_tariff_idr,
      eta_days, is_simulated, expires_at)
      values ('${tenant}', '${shipment}', '${quote}', 1, 'JT', 'REG', 9000, '1-2', ${opts.simulated ? "true" : "false"}, now() + interval '1 hour');
    update public.shipments set selected_quote_id = '${quote}',
      pickup_snapshot = jsonb_build_object('outlet', 'Outlet D',
        'mengantar_pickup_address_id', '6acf44a4771fe2b474c055ca', 'mengantar_area_id', '5fc62f60f8f44b34aa4c0dcd')
      where id = '${shipment}';
    insert into public.provider_operations (tenant_id, shipment_id, id, kind, idempotency_key, input_digest, state, is_simulated, actor)
      values ('${tenant}', '${shipment}', '${op}', 'create_order', 'key-${op}', 'digest', 'queued', ${opts.simulated ? "true" : "false"}, '${OWNER_A}');
  `);
  return { tenant, shipment, op };
}

