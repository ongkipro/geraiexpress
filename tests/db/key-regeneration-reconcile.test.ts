// Wave F1 (migration 20261028250000): M2 reconcile / payment-check / batch-payment work survives a
// Partner key regeneration, L1 no onboarding while a regeneration is in flight, L4 a rewrap never
// lowers a key version, L6 staleness is decided before the credential lookup.
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { credentialAad, openCredential, sealCredential } from "../../src/lib/credential-crypto";
import { machine, realOperation, signIn, sql } from "./helpers";

const SEAL = Buffer.alloc(32, 5).toString("base64");
const PLAIN = "API-REGENTESTKEY0001";
const OWNER_A = "00000000-0000-4000-a000-0000000000a1";
const OBJECT_ID = "6acf476a6b00a9b494ff04b9";

type Mode = "partner" | "byok";
type Env = "sandbox" | "production";
type Tenant = { tenant: string; outlet: string; seller: string };

async function insertCredential(tenant: string, version: number, mode: Mode, env: Env, keyVersion = "v1") {
  const s = await sealCredential(PLAIN, credentialAad(tenant, version), SEAL);
  sql(`insert into private.seller_credentials (tenant_id, mode, ciphertext, iv, key_version, hint, version, provider_env)
    values ('${tenant}', '${mode}', '${s.ciphertext}', '${s.iv}', '${keyVersion}', '01', ${version}, '${env}')`);
}

// Supersede (as a regeneration or removal does) every active credential of one environment.
const supersede = (tenant: string, env: Env) =>
  sql(`update private.seller_credentials set superseded_at = now(), ciphertext = null, iv = null
    where tenant_id = '${tenant}' and provider_env = '${env}' and superseded_at is null`);

// A tenant of its own (owner-a is its admin) holding credential v1.
async function tenantWith(mode: Mode, env: Env = "sandbox"): Promise<Tenant> {
  const tenant = randomUUID(), outlet = randomUUID();
  const seller = randomUUID().replace(/-/g, "").slice(0, 24);
  sql(`insert into public.tenants (id, name, lifecycle, is_demo) values ('${tenant}', 'Gerai Regen', 'active', false);
    insert into public.outlets (tenant_id, id, name, mengantar_pickup_address_id, mengantar_area_id)
      values ('${tenant}', '${outlet}', 'Outlet R', '6acf44a4771fe2b474c055ca', '5fc62f60f8f44b34aa4c0dcd');
    insert into public.memberships (tenant_id, user_id, role) values ('${tenant}', '${OWNER_A}', 'tenant_admin');`);
  if (mode === "partner") {
    sql(`insert into private.tenant_mengantar_onboarding (tenant_id, external_user_id, connection_mode, onboarding_state,
        partner_seller_id, owner_name, owner_email, owner_phone, terms_version, privacy_version, consent_actor_id, provider_env)
      values ('${tenant}', 'geraiexpress:tenant:${tenant}', 'partner_managed', 'connected', '${seller}',
        'Budi Santoso', 'budi.santoso@gerai-uji.id', '081234567890', 'terms-1', 'privacy-1', '${OWNER_A}', '${env}')`);
  }
  await insertCredential(tenant, 1, mode, env);
  return { tenant, outlet, seller };
}

// One shipment with a real operation created on credential v1 (provider_env as given).
// `extra` adds provider_operations columns (name -> SQL literal).
function addOrder(t: Tenant, state: "unknown" | "succeeded", env: Env = "sandbox", extra: Record<string, string> = {}) {
  const shipment = randomUUID(), quote = randomUUID(), op = randomUUID();
  const ref = `GX261028-${randomUUID().slice(0, 6).toUpperCase()}`;
  const columns = Object.entries(state === "succeeded"
    ? { provider_order_id: `'T0RG${op.slice(0, 8).toUpperCase()}'`, result_code: "'UNPAID'", ...extra } : extra);
  sql(`
    insert into public.shipments (tenant_id, outlet_id, id, reference, submission_state, payment_state, recipient_name, recipient_phone,
      recipient_address, recipient_area, recipient_area_id, recipient_postal_code, sender_name, sender_phone, item_description, weight_grams,
      goods_value_idr, customer_charge_idr, submitted_at, is_simulated, created_by)
      values ('${t.tenant}', '${t.outlet}', '${shipment}', '${ref}', '${state === "unknown" ? "unknown" : "awaiting_payment"}', 'unpaid',
      'Penerima Uji', '081234567890', 'Jl. Uji 1', 'KEBAYORAN BARU', '5fc63169f8f44b34aa4c2ee1', '12110', 'Pengirim', '081234567890',
      'Dokumen', 1000, 50000, 9000, now(), false, '${OWNER_A}');
    insert into public.shipment_quotes (tenant_id, shipment_id, id, shipment_revision, courier, service, normal_tariff_idr, eta_days, is_simulated, expires_at)
      values ('${t.tenant}', '${shipment}', '${quote}', 1, 'JT', 'REG', 9000, '1-2', false, now() + interval '1 hour');
    update public.shipments set selected_quote_id = '${quote}',
      pickup_snapshot = jsonb_build_object('outlet', 'Outlet R', 'mengantar_pickup_address_id', '6acf44a4771fe2b474c055ca',
        'mengantar_area_id', '5fc62f60f8f44b34aa4c0dcd') where id = '${shipment}';
    insert into public.provider_operations (tenant_id, shipment_id, id, kind, idempotency_key, input_digest, state, is_simulated, attempts,
      provider_env, credential_version, dispatched_at, actor${columns.map(([c]) => ", " + c).join("")})
      values ('${t.tenant}', '${shipment}', '${op}', 'create_order', 'k-${op}', 'd-${op}', '${state}', false, 1,
      '${env}', 1, now() - interval '10 minutes', '${OWNER_A}'${columns.map(([, v]) => ", " + v).join("")})`);
  return { shipment, op };
}

const FENCE_ARGS = (t: Tenant, version: number, env: Env = "sandbox") =>
  ({ p_tenant: t.tenant, p_actor: OWNER_A, p_seller_id: t.seller, p_expected_version: version, p_env: env });
async function storeArgs(t: Tenant, version: number, env: Env = "sandbox") {
  const s = await sealCredential(PLAIN, credentialAad(t.tenant, version + 1), SEAL);
  return { ...FENCE_ARGS(t, version, env), p_ciphertext: s.ciphertext, p_iv: s.iv, p_key_version: s.keyVersion, p_hint: "01", p_source: "regenerated" };
}

// Regenerate as the Worker does: fence (old key gone), then store the new key.
async function regenerate(t: Tenant, fromVersion: number) {
  const fence = await machine().rpc("fence_partner_key_rotation", FENCE_ARGS(t, fromVersion));
  expect(fence.error).toBeNull();
  return async () => {
    const store = await machine().rpc("store_partner_seller_key", await storeArgs(t, fromVersion));
    expect(store.error).toBeNull();
    expect(store.data).toBe(fromVersion + 1);
  };
}

type Payload = { credential: { ciphertext: string; iv: string; key_version: string; version: number } | null; provider_env: string };
async function opens(p: Payload, tenant: string, version: number) {
  expect(p.credential?.version).toBe(version);
  expect(await openCredential(p.credential!, credentialAad(tenant, version), SEAL)).toBe(PLAIN);
}
const cleanup = (t: Tenant) => sql(`update public.shipments set selected_quote_id = null where tenant_id = '${t.tenant}';
  delete from public.shipments where tenant_id = '${t.tenant}';
  delete from public.tenants where id = '${t.tenant}'`);

describe("an unknown operation reconciles across a Partner key regeneration (M2)", () => {
  it("dispatch_begin_reconcile returns the new key once it is stored, and none while the old one is fenced", async () => {
    const t = await tenantWith("partner");
    try {
      const { op } = addOrder(t, "unknown");
      const worker = machine();
      await opens((await worker.rpc("dispatch_begin_reconcile", { p_operation: op, p_env: "sandbox" })).data, t.tenant, 1);

      const store = await regenerate(t, 1);
      // Fenced: nothing is returned (the Worker answers credential_unavailable and the sweep retries).
      expect(((await worker.rpc("dispatch_begin_reconcile", { p_operation: op, p_env: "sandbox" })).data as Payload).credential).toBeNull();
      await store();
      await opens((await worker.rpc("dispatch_begin_reconcile", { p_operation: op, p_env: "sandbox" })).data, t.tenant, 2);

      // A second regeneration still serves the very same operation (it stays on v1).
      const again = await regenerate(t, 2);
      await again();
      await opens((await worker.rpc("dispatch_begin_reconcile", { p_operation: op, p_env: "sandbox" })).data, t.tenant, 3);
      expect(sql(`select credential_version from public.provider_operations where id = '${op}'`)).toBe("1");
    } finally {
      cleanup(t);
    }
  });

  it("dispatch_begin_payment_check of a created, unpaid order opens the new key too", async () => {
    const t = await tenantWith("partner");
    try {
      const { op } = addOrder(t, "succeeded");
      const store = await regenerate(t, 1);
      await store();
      const check = await machine().rpc("dispatch_begin_payment_check", { p_operation: op, p_env: "sandbox" });
      expect(check.error).toBeNull();
      await opens(check.data, t.tenant, 2);
    } finally {
      cleanup(t);
    }
  });

  it("an open batch payment attempt reconciles with the new key", async () => {
    const t = await tenantWith("partner");
    try {
      const batch = `2610T0RG${randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`;
      const { shipment } = addOrder(t, "succeeded", "sandbox",
        { provider_batch: `'${batch}'`, provider_batch_id: `'${OBJECT_ID}'`, provider_price_idr: "9000" });
      const owner = await signIn("owner-a@geraiexpress.test");
      const review = await owner.rpc("review_unpaid_batch", { p_shipment: shipment });
      expect(review.error).toBeNull();
      const digest = review.data.batch_digest as string;
      expect((await owner.rpc("authorize_batch_payment", { p_shipment: shipment, p_batch_digest: digest })).error).toBeNull();
      const claim = await machine().rpc("dispatch_begin_batch_payment", { p_shipment: shipment, p_batch_digest: digest, p_env: "sandbox" });
      expect(claim.error).toBeNull();
      await opens(claim.data, t.tenant, 1);
      expect((await machine().rpc("dispatch_mark_batch_payment_sent", { p_attempt: claim.data.attempt_id, p_batch_object_id: OBJECT_ID })).error).toBeNull();

      const store = await regenerate(t, 1);
      const fenced = await machine().rpc("dispatch_begin_batch_payment", { p_shipment: shipment, p_batch_digest: digest, p_env: "sandbox" });
      expect(fenced.data).toMatchObject({ mode: "reconcile", credential: null });
      await store();
      const reconcile = await machine().rpc("dispatch_begin_batch_payment", { p_shipment: shipment, p_batch_digest: digest, p_env: "sandbox" });
      expect(reconcile.data).toMatchObject({ mode: "reconcile", provider_env: "sandbox" });
      await opens(reconcile.data, t.tenant, 2);
    } finally {
      cleanup(t);
    }
  }, 30000);
});

describe("what never crosses versions (M2)", () => {
  it("BYOK keys: a replaced BYOK key, and a mode change in either direction, stay credential-less", async () => {
    for (const [from, to] of [["byok", "byok"], ["partner", "byok"], ["byok", "partner"]] as const) {
      const t = await tenantWith(from);
      try {
        const { op } = addOrder(t, "unknown");
        supersede(t.tenant, "sandbox");
        await insertCredential(t.tenant, 2, to, "sandbox");
        const reconcile = await machine().rpc("dispatch_begin_reconcile", { p_operation: op, p_env: "sandbox" });
        expect(reconcile.error, `${from} -> ${to}`).toBeNull();
        expect((reconcile.data as Payload).credential, `${from} -> ${to}`).toBeNull();
      } finally {
        cleanup(t);
      }
    }
  });

  it("the environments stay separate: only the operation's own environment is considered", async () => {
    const t = await tenantWith("partner");
    try {
      const { op } = addOrder(t, "unknown");
      supersede(t.tenant, "sandbox");
      await insertCredential(t.tenant, 2, "partner", "production"); // another environment only
      const worker = machine();
      expect(((await worker.rpc("dispatch_begin_reconcile", { p_operation: op, p_env: "sandbox" })).data as Payload).credential).toBeNull();
      await insertCredential(t.tenant, 3, "partner", "sandbox"); // the regenerated sandbox key
      const reconcile = await worker.rpc("dispatch_begin_reconcile", { p_operation: op, p_env: "sandbox" });
      expect(reconcile.data).toMatchObject({ provider_env: "sandbox" });
      await opens(reconcile.data, t.tenant, 3);
    } finally {
      cleanup(t);
    }
  });

  it("a production operation is never served a sandbox key", async () => {
    const t = await tenantWith("partner", "production");
    try {
      const { op } = addOrder(t, "unknown", "production");
      supersede(t.tenant, "production");
      await insertCredential(t.tenant, 2, "partner", "sandbox");
      expect(((await machine().rpc("dispatch_begin_reconcile", { p_operation: op, p_env: "production" })).data as Payload).credential).toBeNull();
      // T-057: a sandbox runtime is refused outright for a production operation.
      expect((await machine().rpc("dispatch_begin_reconcile", { p_operation: op, p_env: "sandbox" })).error?.message).toBe("provider_env_mismatch");
    } finally {
      cleanup(t);
    }
  });

  it("the new helper is internal: no API role can execute it", () => {
    for (const role of ["anon", "authenticated", "service_role"]) {
      expect(sql(`select has_function_privilege('${role}', 'private.operation_credential(uuid, text, integer)', 'execute')`)).toBe("f");
    }
  });
});

describe("no onboarding while a regeneration is in flight (L1)", () => {
  it("begin and complete refuse in rotation_unknown and work again once the key is stored", async () => {
    const t = await tenantWith("partner");
    try {
      const store = await regenerate(t, 1);
      expect(sql(`select onboarding_state from private.tenant_mengantar_onboarding where tenant_id = '${t.tenant}'`)).toBe("rotation_unknown");
      const owner = await signIn("owner-a@geraiexpress.test");
      const begin = await owner.rpc("begin_partner_seller_onboarding", {
        p_tenant: t.tenant, p_owner_name: "Budi Santoso", p_owner_email: "budi.santoso@gerai-uji.id", p_owner_phone: "081234567890",
        p_terms_version: "terms-1", p_privacy_version: "privacy-1", p_agreed: true,
      });
      expect(begin.error?.message).toBe("rotation_unknown");
      expect(begin.error?.code).toBe("55000");
      const sealed = await sealCredential("API-PRESTALEKEY00001", credentialAad(t.tenant, 2), SEAL);
      const complete = await machine().rpc("complete_partner_seller_onboarding", {
        p_tenant: t.tenant, p_seller_id: t.seller, p_ciphertext: sealed.ciphertext, p_iv: sealed.iv, p_key_version: sealed.keyVersion,
        p_hint: "01", p_expected_version: 1, p_env: "sandbox",
      });
      expect(complete.error?.message).toBe("rotation_unknown");
      expect(sql(`select count(*) from private.seller_credentials where tenant_id = '${t.tenant}' and superseded_at is null`)).toBe("0");
      await store();
      expect(sql(`select onboarding_state from private.tenant_mengantar_onboarding where tenant_id = '${t.tenant}'`)).toBe("connected");
    } finally {
      cleanup(t);
    }
  });
});

describe("rewrap never lowers a key version (L4)", () => {
  it("accepts only a higher new key version than the stored one", async () => {
    const t = await tenantWith("byok");
    try {
      supersede(t.tenant, "sandbox");
      await insertCredential(t.tenant, 2, "byok", "sandbox", "v2");
      const s = await sealCredential(PLAIN, credentialAad(t.tenant, 2), SEAL);
      const call = (expected: string, next: string) => machine().rpc("rewrap_seller_credential", {
        p_tenant: t.tenant, p_version: 2, p_expected_key_version: expected, p_ciphertext: s.ciphertext, p_iv: s.iv, p_new_key_version: next,
      });
      expect((await call("v2", "v1")).error?.message).toBe("invalid_input"); // rollback configuration
      expect((await call("v2", "v2")).error?.message).toBe("invalid_input");
      expect((await call("v2", "v10")).error).toBeNull(); // numeric, not lexical, comparison
      expect(sql(`select key_version from private.seller_credentials where tenant_id = '${t.tenant}' and version = 2`)).toBe("v10");
      expect((await call("v10", "v9")).error?.message).toBe("invalid_input");
    } finally {
      cleanup(t);
    }
  });
});

describe("a stale operation expires even without a credential of the environment (L6)", () => {
  it("dispatch_claim answers stale before credential_missing, and a fresh one still fails closed", async () => {
    const stale = await realOperation(); // sandbox credential only
    const fresh = await realOperation();
    try {
      sql(`update public.provider_operations set created_at = now() - interval '7 hours' where id = '${stale.op}'`);
      const worker = machine();
      const expired = await worker.rpc("dispatch_claim", { p_operation: stale.op, p_env: "production" });
      expect(expired.error).toBeNull();
      expect(expired.data).toEqual({ stale: true });
      expect(sql(`select state || '|' || result_code from public.provider_operations where id = '${stale.op}'`)).toBe("failed|QUOTE_STALE");
      expect(sql(`select submission_state from public.shipments where id = '${stale.shipment}'`)).toBe("failed");

      expect((await worker.rpc("dispatch_claim", { p_operation: fresh.op, p_env: "production" })).error?.message).toBe("credential_missing");
      expect(sql(`select state from public.provider_operations where id = '${fresh.op}'`)).toBe("queued");
    } finally {
      for (const f of [stale, fresh]) cleanup({ tenant: f.tenant, outlet: "", seller: "" });
    }
  });
});
