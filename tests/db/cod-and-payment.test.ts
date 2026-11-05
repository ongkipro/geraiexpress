// T-025 (COD shipments, two-pass COD fee pricing, provider refusal detail),
// T-026 (batch pay-unpaid review, digest-bound claim, and per-order payment recording) and
// T-033 (batch payment attempts: authorization, fencing, unknown-payment reconciliation).
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { TestClient } from "./helpers";
import { credentialAad, sealCredential } from "../../src/lib/credential-crypto";
import { payUnpaidShipmentBatch } from "../../src/lib/mengantar/dispatcher";
import { IDS, client, demoVisitor, machine, realOperation, signIn, sql } from "./helpers";

describe("COD quotes, confirmation, and provider refusal detail (T-025)", () => {
  it("requires goods_value_idr >= 1000 for COD quotes, stores cod_fee_idr and customer_charge_idr, and keeps net cost private", async () => {
    const f = await realOperation();
    sql(`update public.shipments set submission_state = 'draft' where id = '${f.shipment}';
      update public.shipments set is_cod = true, goods_value_idr = 500 where id = '${f.shipment}'`);
    const rev = Number(sql(`select revision from public.shipments where id = '${f.shipment}'`));
    const m = machine();
    const codRows = [
      { courier: "JT", tariff: 93000, cod_fee: 4994, cod_supported: true, net: 65100, eta: "2 - 4 days" },
      { courier: "JNE", tariff: 40000, cod_fee: 3150, cod_supported: true, net: 32000, eta: "1 - 2 days" },
    ];

    // Below Rp1.000 goods value is refused for COD
    expect((await m.rpc("record_live_quotes", {
      p_tenant: f.tenant, p_shipment: f.shipment, p_expected_revision: rev, p_rows: codRows,
      p_origin_area_id: "5fc62f60f8f44b34aa4c0dcd", p_origin_address_id: "6acf44a4771fe2b474c055ca",
    })).error?.message).toBe("cod_goods_value_required");

    sql(`update public.shipments set goods_value_idr = 50000 where id = '${f.shipment}'`);
    const rev2 = Number(sql(`select revision from public.shipments where id = '${f.shipment}'`));

    // All-unsupported COD rows are filtered out, leaving count = 0 and submission_state = draft
    expect((await m.rpc("record_live_quotes", {
      p_tenant: f.tenant,
      p_shipment: f.shipment,
      p_expected_revision: rev2,
      p_origin_area_id: "5fc62f60f8f44b34aa4c0dcd", p_origin_address_id: "6acf44a4771fe2b474c055ca",
      p_rows: [{ courier: "JT", tariff: 93000, cod_fee: 0, cod_supported: false, net: 65100, eta: "2 - 4 days" }],
    })).data).toBe(0);
    expect(sql(`select submission_state from public.shipments where id = '${f.shipment}'`)).toBe("draft");

    expect((await m.rpc("record_live_quotes", {
      p_tenant: f.tenant, p_shipment: f.shipment, p_expected_revision: rev2, p_rows: codRows,
      p_origin_area_id: "5fc62f60f8f44b34aa4c0dcd", p_origin_address_id: "6acf44a4771fe2b474c055ca",
    })).data).toBe(2);

    expect(sql(`select string_agg(courier || ':' || normal_tariff_idr || ':' || cod_fee_idr || ':' || customer_charge_idr || ':' || cod_supported, ',' order by customer_charge_idr)
      from public.shipment_quotes where shipment_id = '${f.shipment}' and expires_at > now()`))
      .toBe("JNE:40000:3150:43150:true,JT:93000:4994:97994:true");
  });

  it("skips unknown COD fees but retains an explicit zero in either provider spelling", async () => {
    const f = await realOperation();
    sql(`update public.shipments set submission_state = 'draft' where id = '${f.shipment}';
      update public.shipments set is_cod = true, goods_value_idr = 50000 where id = '${f.shipment}'`);
    const args = {
      p_tenant: f.tenant, p_shipment: f.shipment,
      p_expected_revision: Number(sql(`select revision from public.shipments where id = '${f.shipment}'`)),
      p_origin_area_id: "5fc62f60f8f44b34aa4c0dcd", p_origin_address_id: "6acf44a4771fe2b474c055ca",
    };
    const row = { courier: "JT", tariff: 12000, net: 10000, cod_supported: true, eta: "1-2" };
    const m = machine();
    for (const fee of [{}, { cod_fee: null }, { codFee: null }, { cod_fee: null, codFee: null }]) {
      const result = await m.rpc("record_live_quotes", { ...args, p_rows: [{ ...row, ...fee }] });
      expect(result.error).toBeNull();
      expect(result.data).toBe(0);
      expect(sql(`select submission_state from public.shipments where id = '${f.shipment}'`)).toBe("draft");
      expect(sql(`select count(*) from public.shipment_quotes where shipment_id = '${f.shipment}' and expires_at > now()`)).toBe("0");
    }
    for (const fee of [{ cod_fee: 0 }, { codFee: "0" }]) {
      const result = await m.rpc("record_live_quotes", { ...args, p_rows: [{ ...row, ...fee }] });
      expect(result.error).toBeNull();
      expect(result.data).toBe(1);
      expect(sql(`select cod_fee_idr || '|' || customer_charge_idr from public.shipment_quotes
        where shipment_id = '${f.shipment}' and expires_at > now()`)).toBe("0|12000");
    }
  });

  it("freezes customer_charge_idr = tariff + cod_fee and cod_amount_idr = goods + customer_charge on confirm, and compares estimatedPrice without false price_mismatch", async () => {
    const f = await realOperation();
    sql(`update public.shipments set submission_state = 'draft', selected_quote_id = null, customer_charge_idr = null where id = '${f.shipment}';
      update public.shipments set is_cod = true, goods_value_idr = 52006 where id = '${f.shipment}'`);
    const rev = Number(sql(`select revision from public.shipments where id = '${f.shipment}'`));
    const m = machine();
    expect((await m.rpc("record_live_quotes", {
      p_tenant: f.tenant,
      p_shipment: f.shipment,
      p_expected_revision: rev,
      p_origin_area_id: "5fc62f60f8f44b34aa4c0dcd", p_origin_address_id: "6acf44a4771fe2b474c055ca",
      p_rows: [{ courier: "JT", tariff: 93000, cod_fee: 4994, cod_supported: true, net: 65100, eta: "2 - 4 days" }],
    })).data).toBe(1);

    const quoteId = sql(`select id from public.shipment_quotes where shipment_id = '${f.shipment}' and expires_at > now() limit 1`);
    sql(`update public.shipments set
      submission_state = 'queued',
      selected_quote_id = '${quoteId}',
      customer_charge_idr = 97994,
      cod_amount_idr = 150000,
      submitted_at = now()
      where id = '${f.shipment}'`);

    const claim = await m.rpc("dispatch_claim", { p_operation: f.op, p_env: "sandbox" });
    expect(claim.error).toBeNull();
    expect(claim.data).toMatchObject({
      operation_id: f.op,
      is_cod: true,
      goods_value_idr: 52006,
      cod_amount_idr: 150000,
    });

    // Mengantar returns estimatedPrice = 97994 (tariff 93000 + codFee 4994) -> matches customer_charge_idr (97994)
    const rec = await m.rpc("dispatch_record", {
      p_operation: f.op,
      p_attempt: 1,
      p_outcome: "issued",
      p_order_id: "2610142JG95B",
      p_tracking: "JO6948371799",
      p_batch: "26101416Q0L7LJ",
      p_price: 97994,
    });
    expect(rec.error).toBeNull();
    expect(rec.data).toEqual({ state: "succeeded", replayed: false, price_mismatch: false });
  });

  it("persists provider_error_detail when an operation is rejected with p_detail", async () => {
    const f = await realOperation();
    const m = machine();
    await m.rpc("dispatch_claim", { p_operation: f.op, p_env: "sandbox" });
    const rec = await m.rpc("dispatch_record", {
      p_operation: f.op,
      p_attempt: 1,
      p_outcome: "rejected",
      p_code: "PROVIDER_REJECTED",
      p_detail: "Ekspedisi Anteraja tidak mendukung pengiriman Drop Off",
    });
    expect(rec.error).toBeNull();
    expect(sql(`select result_code || '|' || coalesce(provider_error_detail, '') from public.provider_operations where id = '${f.op}'`))
      .toBe("PROVIDER_REJECTED|Ekspedisi Anteraja tidak mendukung pengiriman Drop Off");
  });
});

describe("batch pay-unpaid review and digest-bound payment recovery (T-026)", () => {
  it("restricts review_unpaid_batch to tenant_admin of the owning tenant and binds dispatch_begin_batch_payment to batch_digest", async () => {
    // Use tenantA so we can sign in as owner-a (tenant_admin), operator-a (operator), and owner-b (other tenant)
    const ship1 = randomUUID();
    const ship2 = randomUUID();
    const quote1 = randomUUID();
    const quote2 = randomUUID();
    const op1 = randomUUID();
    const op2 = randomUUID();
    const batchCode = "261027BATCH001";

    try {
      const actorId = sql(`select user_id from public.memberships where tenant_id = '${IDS.tenantA}' and role = 'tenant_admin' limit 1`);
      sql(`
        insert into public.shipments (
          id, tenant_id, outlet_id, reference, submission_state, payment_state, is_simulated,
          sender_name, sender_phone, recipient_name, recipient_phone, recipient_address,
          recipient_area, recipient_area_id, recipient_postal_code, weight_grams, item_description,
          goods_value_idr, customer_charge_idr, pickup_snapshot, submitted_at, created_by
        ) values
        ('${ship1}', '${IDS.tenantA}', '${IDS.outletA}', 'GX261027-BTCH01', 'awaiting_payment', 'unpaid', false,
          'Pengirim A', '081234567890', 'Penerima Satu', '081298765432', 'Jl. Tujuan No. 1',
          'KEBAYORAN BARU', '5fc63169f8f44b34aa4c2ee1', '12110', 1000, 'Buku', 50000, 18000, '{"outlet":"Utama"}'::jsonb, now(), '${actorId}'),
        ('${ship2}', '${IDS.tenantA}', '${IDS.outletA}', 'GX261027-BTCH02', 'awaiting_payment', 'unpaid', false,
          'Pengirim A', '081234567890', 'Penerima Dua', '081298765433', 'Jl. Tujuan No. 2',
          'KEBAYORAN BARU', '5fc63169f8f44b34aa4c2ee1', '12110', 1500, 'Pakaian', 75000, 27000, '{"outlet":"Utama"}'::jsonb, now(), '${actorId}');

        insert into public.shipment_quotes (id, tenant_id, shipment_id, shipment_revision, courier, service, normal_tariff_idr, eta_days, is_simulated, expires_at)
        values
        ('${quote1}', '${IDS.tenantA}', '${ship1}', 1, 'JT', 'REG', 18000, '1-2', false, now() + interval '1 hour'),
        ('${quote2}', '${IDS.tenantA}', '${ship2}', 1, 'JT', 'REG', 27000, '1-2', false, now() + interval '1 hour');

        update public.shipments set selected_quote_id = '${quote1}' where id = '${ship1}';
        update public.shipments set selected_quote_id = '${quote2}' where id = '${ship2}';

        insert into public.provider_operations (
          id, tenant_id, shipment_id, kind, idempotency_key, input_digest, state, is_simulated, attempts,
          provider_env, dispatched_at, provider_order_id, provider_batch, result_code, provider_price_idr, actor
        ) values
        ('${op1}', '${IDS.tenantA}', '${ship1}', 'create_order', 'k-${op1}', 'd-${op1}', 'succeeded', false, 1,
          'sandbox', now() - interval '10 minutes', '261027ORD001', '${batchCode}', 'UNPAID', 18000, '${actorId}'),
        ('${op2}', '${IDS.tenantA}', '${ship2}', 'create_order', 'k-${op2}', 'd-${op2}', 'succeeded', false, 1,
          'sandbox', now() - interval '10 minutes', '261027ORD002', '${batchCode}', 'UNPAID', 27000, '${actorId}');
      `);

      // Denied for anon, operator of same tenant, and admin of another tenant
      for (const c of [client(), await signIn("operator-a@geraiexpress.test"), await signIn("owner-b@geraiexpress.test")]) {
        expect((await c.rpc("review_unpaid_batch", { p_shipment: ship1 })).error).not.toBeNull();
        expect((await c.rpc("authorize_batch_payment", { p_shipment: ship1, p_batch_digest: "x" })).error).not.toBeNull();
        expect((await c.rpc("dispatch_begin_batch_payment", { p_shipment: ship1, p_batch_digest: "x", p_env: "sandbox" })).error).not.toBeNull();
      }

      const ownerA = await signIn("owner-a@geraiexpress.test");
      const review = await ownerA.rpc("review_unpaid_batch", { p_shipment: ship1 });
      expect(review.error).toBeNull();
      const data = review.data as {
        batch: string;
        courier: string;
        batch_digest: string;
        member_count: number;
        total_customer_charge_idr: number;
        members: { shipment_id: string; provider_order_id: string; customer_charge_idr: number }[];
      };
      expect(data.batch).toBe(batchCode);
      expect(data.courier).toBe("JT");
      expect(data.member_count).toBe(2);
      expect(data.total_customer_charge_idr).toBe(45000);
      expect(data.members).toHaveLength(2);

      // Machine claim with wrong digest fails closed
      const m = machine();
      expect((await m.rpc("dispatch_begin_batch_payment", {
        p_shipment: ship1, p_batch_digest: "wrong-digest", p_env: "sandbox",
      })).error?.message).toBe("batch_digest_mismatch");

      // Without a tenant admin's authorization of this digest the claim is refused (DIL-06)
      expect((await m.rpc("dispatch_begin_batch_payment", {
        p_shipment: ship1, p_batch_digest: data.batch_digest, p_env: "sandbox",
      })).error?.message).toBe("authorization_required");
      expect((await ownerA.rpc("authorize_batch_payment", { p_shipment: ship1, p_batch_digest: data.batch_digest })).error).toBeNull();

      // Machine claim with matching digest and authorization succeeds and opens an attempt
      const claim = await m.rpc("dispatch_begin_batch_payment", {
        p_shipment: ship1, p_batch_digest: data.batch_digest, p_env: "sandbox",
      });
      expect(claim.error).toBeNull();
      expect(claim.data).toMatchObject({ mode: "pay", batch: batchCode, batch_id: null });
      const claimed: { attempt_id: string } = claim.data;
      const attempt = claimed.attempt_id;

      // A second claim while the first attempt is live is refused as account_busy
      expect((await m.rpc("dispatch_begin_batch_payment", {
        p_shipment: ship1, p_batch_digest: data.batch_digest, p_env: "sandbox",
      })).error?.message).toBe("account_busy");

      // Record payment for both orders
      const rec1 = await m.rpc("dispatch_record_payment", {
        p_operation: op1, p_order_id: "261027ORD001", p_paid: true, p_tracking: "JO2610270001", p_price: 18000,
      });
      const rec2 = await m.rpc("dispatch_record_payment", {
        p_operation: op2, p_order_id: "261027ORD002", p_paid: true, p_tracking: "JO2610270002", p_price: 27000,
      });
      expect(rec1.error).toBeNull();
      expect(rec2.error).toBeNull();
      expect((await m.rpc("dispatch_release_batch_payment", { p_attempt: attempt })).data).toMatchObject({ state: "released" });

      expect(sql(`select submission_state || ':' || payment_state || ':' || coalesce(awb, '') from public.shipments where id = '${ship1}'`))
        .toBe("issued:paid:JO2610270001");
      expect(sql(`select submission_state || ':' || payment_state || ':' || coalesce(awb, '') from public.shipments where id = '${ship2}'`))
        .toBe("issued:paid:JO2610270002");
    } finally {
      sql(`delete from public.shipments where id in ('${ship1}', '${ship2}')`);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// T-033: every test builds its own tenant (owner-a is its admin, operator-a its operator) so the
// attempt and authorization rows of one test never meet another's.
const SEAL_KEY = Buffer.alloc(32, 9).toString("base64");
const SELLER_KEY = "API-UNITTESTKEY0001";
const OBJECT_ID = "6acf476a6b00a9b494ff04b8";
const OTHER_OBJECT_ID = "6acf476a6b00a9b494ff0000";
const OWNER_A_ID = "00000000-0000-4000-a000-0000000000a1";

type Member = { shipment: string; op: string; order: string; reference: string; charge: number };
type Batch = { tenant: string; code: string; objectId: string | null; members: Member[]; digest: string };

async function batchFixture(opts: { count?: number; objectId?: string | null } = {}): Promise<Batch> {
  const objectId = opts.objectId === undefined ? OBJECT_ID : opts.objectId;
  const tenant = randomUUID();
  const outlet = randomUUID();
  const suffix = randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase();
  const code = `2610T033${suffix}`;
  const sealed = await sealCredential(SELLER_KEY, credentialAad(tenant, 1), SEAL_KEY);
  const operatorId = sql(`select id from auth.users where email = 'operator-a@geraiexpress.test'`);
  const members: Member[] = Array.from({ length: opts.count ?? 2 }, (_, i) => ({
    shipment: randomUUID(), op: randomUUID(), order: `T033${suffix}${i}`, reference: `GX261028-${suffix.slice(0, 5)}${i}`, charge: 18000 + i * 9000,
  }));
  const rows = members.map((m) => {
    const quote = randomUUID();
    return `
      insert into public.shipments (id, tenant_id, outlet_id, reference, submission_state, payment_state, is_simulated,
        sender_name, sender_phone, recipient_name, recipient_phone, recipient_address, recipient_area, recipient_area_id,
        recipient_postal_code, weight_grams, item_description, goods_value_idr, customer_charge_idr, pickup_snapshot, submitted_at, created_by)
      values ('${m.shipment}', '${tenant}', '${outlet}', '${m.reference}', 'awaiting_payment', 'unpaid', false,
        'Pengirim', '081234567890', 'Penerima', '081298765432', 'Jl. Tujuan No. 1', 'KEBAYORAN BARU', '5fc63169f8f44b34aa4c2ee1',
        '12110', 1000, 'Buku', 50000, ${m.charge}, '{"outlet":"Utama"}'::jsonb, now(), '${OWNER_A_ID}');
      insert into public.shipment_quotes (id, tenant_id, shipment_id, shipment_revision, courier, service, normal_tariff_idr, eta_days, is_simulated, expires_at)
      values ('${quote}', '${tenant}', '${m.shipment}', 1, 'JT', 'REG', ${m.charge}, '1-2', false, now() + interval '1 hour');
      update public.shipments set selected_quote_id = '${quote}' where id = '${m.shipment}';
      insert into public.provider_operations (id, tenant_id, shipment_id, kind, idempotency_key, input_digest, state, is_simulated, attempts,
        provider_env, credential_version, dispatched_at, provider_order_id, provider_batch, provider_batch_id, result_code, provider_price_idr, actor)
      values ('${m.op}', '${tenant}', '${m.shipment}', 'create_order', 'k-${m.op}', 'd-${m.op}', 'succeeded', false, 1,
        'sandbox', 1, now() - interval '10 minutes', '${m.order}', '${code}', ${objectId ? `'${objectId}'` : "null"}, 'UNPAID', ${m.charge}, '${OWNER_A_ID}');`;
  });
  sql(`
    insert into public.tenants (id, name, lifecycle, is_demo) values ('${tenant}', 'Gerai Batch T033', 'active', false);
    insert into private.seller_credentials (tenant_id, mode, ciphertext, iv, key_version, hint, version)
      values ('${tenant}', 'byok', '${sealed.ciphertext}', '${sealed.iv}', '${sealed.keyVersion}', 'Y01', 1);
    insert into public.outlets (tenant_id, id, name, mengantar_pickup_address_id, mengantar_area_id)
      values ('${tenant}', '${outlet}', 'Outlet B', '6acf44a4771fe2b474c055ca', '5fc62f60f8f44b34aa4c0dcd');
    insert into public.memberships (tenant_id, user_id, role)
      values ('${tenant}', '${OWNER_A_ID}', 'tenant_admin'), ('${tenant}', '${operatorId}', 'operator');
    ${rows.join("\n")}`);
  const owner = await signIn("owner-a@geraiexpress.test");
  const review = await owner.rpc("review_unpaid_batch", { p_shipment: members[0].shipment });
  expect(review.error).toBeNull();
  return { tenant, code, objectId, members, digest: review.data.batch_digest };
}

const authorize = (c: TestClient, f: Batch, digest = f.digest) =>
  c.rpc("authorize_batch_payment", { p_shipment: f.members[0].shipment, p_batch_digest: digest });
const claim = (f: Batch, digest = f.digest) =>
  machine().rpc("dispatch_begin_batch_payment", { p_shipment: f.members[0].shipment, p_batch_digest: digest, p_env: "sandbox" });
const attempts = (f: Batch) => sql(`select coalesce(string_agg(state, ',' order by created_at), '') from private.batch_payment_attempts where tenant_id = '${f.tenant}'`);
const attemptState = (id: string) => sql(`select state from private.batch_payment_attempts where id = '${id}'`);
const auditOutcomes = (f: Batch) => sql(`select coalesce(string_agg(outcome, ',' order by id), '') from public.audit_events where target_tenant = '${f.tenant}' and action = 'shipment.batch_pay'`);
const openAuthorizations = (f: Batch) => Number(sql(`select count(*) from private.batch_payment_authorizations where tenant_id = '${f.tenant}' and consumed_at is null and superseded_at is null`));
const paidMembers = (f: Batch) => sql(`select count(*) from public.shipments where tenant_id = '${f.tenant}' and payment_state = 'paid'`);
const payRecord = (m: Member) => machine().rpc("dispatch_record_payment", { p_operation: m.op, p_order_id: m.order, p_paid: true, p_tracking: `JO${m.order}`, p_price: m.charge });
const backdateAttempts = (f: Batch) => sql(`update private.batch_payment_attempts set lease_expires_at = now() - interval '1 hour', sent_at = case when sent_at is null then null else now() - interval '1 hour' end where tenant_id = '${f.tenant}'`);
// The fixture tenant gives owner-a a membership, so it must not outlive its test: other suites list
// the tenants a member can see.
const cleanup = (f: Batch) => sql(`update public.shipments set selected_quote_id = null where tenant_id = '${f.tenant}';
  delete from public.shipments where tenant_id = '${f.tenant}';
  delete from public.tenants where id = '${f.tenant}'`);

describe("batch payment authorization (T-033, DIL-06)", () => {
  it("is tenant-admin only and audits actor, batch digest and expiry; operators and outsiders are refused", async () => {
    const f = await batchFixture();
    try {
      for (const [who, c] of [["anon", client()], ["operator", await signIn("operator-a@geraiexpress.test")], ["other tenant", await signIn("owner-b@geraiexpress.test")]] as const) {
        const res = await authorize(c, f);
        expect(res.error, who).not.toBeNull();
      }
      expect((await authorize(await signIn("operator-a@geraiexpress.test"), f)).error?.message).toBe("admin_required");
      expect(openAuthorizations(f)).toBe(0);
      expect(auditOutcomes(f)).toBe("");

      const owner = await signIn("owner-a@geraiexpress.test");
      expect((await authorize(owner, f, "wrong-digest")).error?.message).toBe("batch_digest_mismatch");
      const ok = await authorize(owner, f);
      expect(ok.error).toBeNull();
      expect(ok.data).toMatchObject({ authorized: true, batch: f.code, batch_digest: f.digest });
      expect(openAuthorizations(f)).toBe(1);
      // Actor (the signed-in admin), digest and expiry are in the audit log.
      expect(sql(`select count(*) from public.audit_events where target_tenant = '${f.tenant}' and action = 'shipment.batch_pay'
        and outcome = 'authorized' and actor = '${OWNER_A_ID}' and detail->>'batch_digest' = '${f.digest}'
        and (detail->>'expires_at')::timestamptz > now() and (detail->>'expires_at')::timestamptz <= now() + interval '10 minutes'`)).toBe("1");
      // A repeated click supersedes the earlier authorization: one open row, never two spends.
      expect((await authorize(owner, f)).error).toBeNull();
      expect(openAuthorizations(f)).toBe(1);
      expect(sql(`select count(*) from private.batch_payment_authorizations where tenant_id = '${f.tenant}'`)).toBe("2");
    } finally {
      cleanup(f);
    }
  });

  it("is not executable by anon and creates nothing for a batch that is not payable", async () => {
    const f = await batchFixture();
    try {
      expect((await authorize(client(), f)).error?.code).toBe("42501");
      sql(`update public.shipments set payment_state = 'paid', submission_state = 'issued', awb = 'JO00000001' where id = '${f.members[0].shipment}'`);
      const owner = await signIn("owner-a@geraiexpress.test");
      expect((await authorize(owner, f)).error?.message).toBe("batch_not_payable");
    } finally {
      cleanup(f);
    }
  });
});

describe("machine claim consumes exactly one authorization (T-033, DIL-06)", () => {
  it("needs an authorization; consumes it once; it expires; a digest change or demotion voids it", async () => {
    const f = await batchFixture();
    try {
      const owner = await signIn("owner-a@geraiexpress.test");
      expect((await claim(f)).error?.message).toBe("authorization_required");

      // Single use: the claim consumes it, a second claim (after the first is freed) needs a new one.
      await authorize(owner, f);
      const first = await claim(f);
      expect(first.error).toBeNull();
      expect(openAuthorizations(f)).toBe(0);
      expect(sql(`select count(*) from private.batch_payment_authorizations where tenant_id = '${f.tenant}' and consumed_by_attempt = '${first.data.attempt_id}'`)).toBe("1");
      expect((await machine().rpc("dispatch_release_batch_payment", { p_attempt: first.data.attempt_id })).data).toMatchObject({ state: "released" });
      expect((await claim(f)).error?.message).toBe("authorization_required");
      // The claim is audited with the authorizing admin as the target user.
      expect(sql(`select count(*) from public.audit_events where target_tenant = '${f.tenant}' and action = 'shipment.batch_pay'
        and outcome = 'claimed' and target_user = '${OWNER_A_ID}' and detail->>'authorization' is not null`)).toBe("1");

      // Expiry
      await authorize(owner, f);
      sql(`update private.batch_payment_authorizations set expires_at = now() - interval '1 second' where tenant_id = '${f.tenant}'`);
      expect((await claim(f)).error?.message).toBe("authorization_required");

      // The authorization names one digest; a claim for another digest is refused first.
      await authorize(owner, f);
      expect((await claim(f, "0".repeat(64))).error?.message).toBe("batch_digest_mismatch");
      expect(openAuthorizations(f)).toBe(1);

      // A demotion between authorization and claim voids it (the role is re-checked at the claim).
      sql(`update public.memberships set status = 'revoked' where tenant_id = '${f.tenant}' and user_id = '${OWNER_A_ID}'`);
      expect((await claim(f)).error?.message).toBe("authorization_required");
      expect(attempts(f)).toBe("released");
    } finally {
      cleanup(f);
    }
  });
});

describe("payment attempt state machine (T-033, BIZ-05)", () => {
  it("claimed -> sent -> unknown blocks every later claim; lease expiry never reopens it; release is fenced", async () => {
    const f = await batchFixture();
    try {
      const owner = await signIn("owner-a@geraiexpress.test");
      const m = machine();
      await authorize(owner, f);
      const c1 = await claim(f);
      expect(c1.data).toMatchObject({ mode: "pay", batch: f.code, batch_id: OBJECT_ID, attempt_state: "claimed" });
      const attempt: string = c1.data.attempt_id;

      // The write-ahead mark validates the id's shape and agrees with the stored object id.
      expect((await m.rpc("dispatch_mark_batch_payment_sent", { p_attempt: attempt, p_batch_object_id: f.code })).error?.message).toBe("invalid_batch_id");
      expect((await m.rpc("dispatch_mark_batch_payment_sent", { p_attempt: attempt, p_batch_object_id: OTHER_OBJECT_ID })).error?.message).toBe("batch_scope_mismatch");
      expect((await m.rpc("dispatch_mark_batch_payment_sent", { p_attempt: attempt, p_batch_object_id: OBJECT_ID })).data).toMatchObject({ state: "sent" });
      expect((await m.rpc("dispatch_mark_batch_payment_sent", { p_attempt: attempt, p_batch_object_id: OBJECT_ID })).error?.message).toBe("stale_attempt");

      // Once sent, a release does nothing: the batch is not payable again.
      expect((await m.rpc("dispatch_release_batch_payment", { p_attempt: attempt })).data).toMatchObject({ state: "sent", released: false });
      expect(attemptState(attempt)).toBe("sent");

      // A fresh authorization is withheld and the claim hands back the ORIGINAL attempt to reconcile.
      expect((await authorize(owner, f)).data).toMatchObject({ authorized: false, reason: "payment_unresolved" });
      expect(openAuthorizations(f)).toBe(0);
      const again = await claim(f);
      expect(again.data).toMatchObject({ mode: "reconcile", attempt_id: attempt, batch_id: OBJECT_ID });
      expect(again.data.members).toHaveLength(2);
      expect(attempts(f)).toBe("sent");

      // Ambiguity: unknown. A lease expiry (or any elapsed time) does not make it payable.
      expect((await m.rpc("dispatch_finish_batch_payment", { p_attempt: attempt, p_outcome: "unknown" })).data).toMatchObject({ state: "unknown" });
      backdateAttempts(f);
      expect((await authorize(owner, f)).data).toMatchObject({ authorized: false });
      expect((await claim(f)).data).toMatchObject({ mode: "reconcile", attempt_id: attempt });
      expect(attempts(f)).toBe("unknown");

      // An attempt whose answer was lost can never be concluded "refused"; "paid" needs paid members.
      expect((await m.rpc("dispatch_finish_batch_payment", { p_attempt: attempt, p_outcome: "rejected" })).error?.message).toBe("invalid_transition");
      expect((await m.rpc("dispatch_finish_batch_payment", { p_attempt: attempt, p_outcome: "paid" })).error?.message).toBe("members_not_paid");
      expect((await m.rpc("dispatch_finish_batch_payment", { p_attempt: attempt, p_outcome: "later" })).error?.message).toBe("invalid_outcome");

      // An unpaid per-order read proves nothing: the attempt keeps blocking.
      for (const mem of f.members) {
        expect((await m.rpc("dispatch_record_payment", { p_operation: mem.op, p_order_id: mem.order, p_paid: false })).data).toMatchObject({ paid: false });
      }
      expect(attempts(f)).toBe("unknown");

      // The paid result appears at the provider: per-order reads reconcile the ORIGINAL attempt.
      expect((await payRecord(f.members[0])).error).toBeNull();
      expect(attempts(f)).toBe("unknown");
      expect((await payRecord(f.members[1])).error).toBeNull();
      expect(attempts(f)).toBe("paid");
      expect(paidMembers(f)).toBe("2");
      expect(auditOutcomes(f)).toContain("reconciled_paid");
      expect((await m.rpc("dispatch_finish_batch_payment", { p_attempt: attempt, p_outcome: "paid" })).data).toMatchObject({ state: "paid", replayed: true });
      expect((await claim(f)).error?.message).toBe("batch_not_payable");
    } finally {
      cleanup(f);
    }
  });

  it("a claim that sent nothing is freed when its lease runs out, and a late release of it cannot touch the new claim", async () => {
    const f = await batchFixture();
    try {
      const owner = await signIn("owner-a@geraiexpress.test");
      const m = machine();
      await authorize(owner, f);
      const a = (await claim(f)).data.attempt_id;
      backdateAttempts(f);
      // The expired claim must not send, and a fresh authorization is not withheld by it.
      expect((await m.rpc("dispatch_mark_batch_payment_sent", { p_attempt: a, p_batch_object_id: OBJECT_ID })).error?.message).toBe("stale_attempt");
      expect((await authorize(owner, f)).data).toMatchObject({ authorized: true });
      const b = (await claim(f)).data.attempt_id;
      expect(b).not.toBe(a);
      expect(attemptState(a)).toBe("released");
      expect(attemptState(b)).toBe("claimed");
      // Fenced: releasing the old attempt id changes nothing about the new one.
      expect((await m.rpc("dispatch_release_batch_payment", { p_attempt: a })).data).toMatchObject({ state: "released" });
      expect(attemptState(b)).toBe("claimed");
      expect((await m.rpc("dispatch_finish_batch_payment", { p_attempt: b, p_outcome: "paid" })).error?.message).toBe("stale_attempt");
      // The new claim is live: another claim is busy, not a second attempt.
      await authorize(owner, f);
      expect((await claim(f)).error?.message).toBe("account_busy");
      expect(attempts(f)).toBe("released,claimed");
    } finally {
      cleanup(f);
    }
  });

  it("a definite refusal ends the attempt as rejected and a new authorization can pay again", async () => {
    const f = await batchFixture();
    try {
      const owner = await signIn("owner-a@geraiexpress.test");
      const m = machine();
      await authorize(owner, f);
      const a = (await claim(f)).data.attempt_id;
      await m.rpc("dispatch_mark_batch_payment_sent", { p_attempt: a, p_batch_object_id: OBJECT_ID });
      expect((await m.rpc("dispatch_finish_batch_payment", { p_attempt: a, p_outcome: "rejected" })).data).toMatchObject({ state: "rejected" });
      expect((await authorize(owner, f)).data).toMatchObject({ authorized: true });
      const b = await claim(f);
      expect(b.data).toMatchObject({ mode: "pay" });
      expect(attempts(f)).toBe("rejected,claimed");
    } finally {
      cleanup(f);
    }
  });

  it("a missing stored object id is backfilled by the write-ahead mark, and conflicting ids are refused", async () => {
    const f = await batchFixture({ objectId: null });
    try {
      const owner = await signIn("owner-a@geraiexpress.test");
      const m = machine();
      await authorize(owner, f);
      const c = await claim(f);
      expect(c.data).toMatchObject({ mode: "pay", batch_id: null });
      sql(`update public.provider_operations set provider_batch_id = '${OTHER_OBJECT_ID}' where id = '${f.members[1].op}'`);
      expect((await m.rpc("dispatch_mark_batch_payment_sent", { p_attempt: c.data.attempt_id, p_batch_object_id: OBJECT_ID })).error?.message).toBe("batch_scope_mismatch");
      sql(`update public.provider_operations set provider_batch_id = null where id = '${f.members[1].op}'`);
      expect((await m.rpc("dispatch_mark_batch_payment_sent", { p_attempt: c.data.attempt_id, p_batch_object_id: OBJECT_ID })).data).toMatchObject({ state: "sent", batch_id: OBJECT_ID });
      expect(sql(`select batch_object_id from private.batch_payment_attempts where id = '${c.data.attempt_id}'`)).toBe(OBJECT_ID);
    } finally {
      cleanup(f);
    }
  });

  it("members of one batch with different provider object ids are not payable (scope mismatch)", async () => {
    const f = await batchFixture();
    try {
      sql(`update public.provider_operations set provider_batch_id = '${OTHER_OBJECT_ID}' where id = '${f.members[1].op}'`);
      const owner = await signIn("owner-a@geraiexpress.test");
      expect((await owner.rpc("review_unpaid_batch", { p_shipment: f.members[0].shipment })).error?.message).toBe("batch_scope_mismatch");
    } finally {
      cleanup(f);
    }
  });

  it("a payment on the wire keeps the seller busy for new creates; a lost one stops blocking them after two minutes", async () => {
    const f = await batchFixture();
    try {
      const owner = await signIn("owner-a@geraiexpress.test");
      const other = await realOperation({ tenant: f.tenant });
      await authorize(owner, f);
      const a = (await claim(f)).data.attempt_id;
      expect((await machine().rpc("dispatch_claim", { p_operation: other.op, p_env: "sandbox" })).error?.message).toBe("account_busy");
      await machine().rpc("dispatch_mark_batch_payment_sent", { p_attempt: a, p_batch_object_id: OBJECT_ID });
      expect((await machine().rpc("dispatch_claim", { p_operation: other.op, p_env: "sandbox" })).error?.message).toBe("account_busy");
      sql(`update private.batch_payment_attempts set sent_at = now() - interval '3 minutes' where id = '${a}'`);
      expect((await machine().rpc("dispatch_claim", { p_operation: other.op, p_env: "sandbox" })).error).toBeNull();
    } finally {
      cleanup(f);
    }
  });
});

// A fake Mengantar for one batch whose code and object id differ. Like the documented endpoint it
// takes only the object id on POST /order/pay-unpaid; the order filter takes the code.
function fakeProvider(f: Batch, pay: (paid: Set<string>) => Response | "drop") {
  const paid = new Set<string>();
  const posts: Record<string, unknown>[] = [];
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const row = (m: Member) => ({
    ORDER_ID: m.order, batch: f.code, batch_id: f.objectId, destinationMark: m.reference, estimatedPrice: m.charge, status: "active",
    isPaid: paid.has(m.order), cnote_no: paid.has(m.order) ? `JO${m.order}` : null, createdAt: "2026-10-28T09:12:10Z",
  });
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = new URL(String(url));
    if (init?.method === "POST") {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      posts.push(body);
      if (body.batch_id !== f.objectId) return json({ success: false, message: "Batch tidak ditemukan" }, 400);
      const answer = pay(paid);
      if (answer === "drop") throw new TypeError("connection reset");
      return answer;
    }
    const wanted = u.searchParams.get("order_id");
    const list = wanted ? f.members.filter((m) => m.order === wanted) : f.members;
    return json({ success: true, data: list.map(row) });
  }) as typeof fetch;
  return { impl, paid, posts };
}
const dispatcherDeps = (impl: typeof fetch) => ({
  rpc: (fn: string, args: Record<string, unknown>) => machine().rpc(fn, args),
  environment: "sandbox" as const, credentialKey: SEAL_KEY, fetchImpl: impl,
});
const payAll = (f: Batch, paid: Set<string>) => { for (const m of f.members) paid.add(m.order); };

describe("batch payment through the dispatcher against the database (T-033)", () => {
  it("lost response, a second action and a lease expiry send exactly one pay-unpaid; the original is reconciled when its paid result appears", async () => {
    const f = await batchFixture();
    try {
      const owner = await signIn("owner-a@geraiexpress.test");
      // The request is applied nowhere visible and its answer is lost (connection reset).
      const provider = fakeProvider(f, () => "drop");
      const deps = dispatcherDeps(provider.impl);

      await authorize(owner, f);
      expect(await payUnpaidShipmentBatch(f.members[0].shipment, f.digest, deps)).toEqual({ status: "inconclusive", reason: "payment_unconfirmed" });
      expect(provider.posts).toEqual([{ batch_id: OBJECT_ID, courier: "JT" }]);
      expect(attempts(f)).toBe("unknown");

      // Second action: the admin clicks again. No new authorization, no second POST.
      expect((await authorize(owner, f)).data).toMatchObject({ authorized: false, reason: "payment_unresolved" });
      expect(await payUnpaidShipmentBatch(f.members[0].shipment, f.digest, deps)).toEqual({ status: "inconclusive", reason: "payment_unresolved" });
      expect(provider.posts).toHaveLength(1);

      // The lease (and the time since the send) expires: still not payable again.
      backdateAttempts(f);
      await authorize(owner, f);
      expect(await payUnpaidShipmentBatch(f.members[0].shipment, f.digest, deps)).toEqual({ status: "inconclusive", reason: "payment_unresolved" });
      expect(provider.posts).toHaveLength(1);
      expect(attempts(f)).toBe("unknown");
      expect(paidMembers(f)).toBe("0");

      // The original payment shows up at the provider: reconciled by per-order reads, still no POST.
      payAll(f, provider.paid);
      expect(await payUnpaidShipmentBatch(f.members[0].shipment, f.digest, deps)).toEqual({ status: "recorded", outcome: "issued" });
      expect(provider.posts).toHaveLength(1);
      expect(attempts(f)).toBe("paid");
      expect(paidMembers(f)).toBe("2");
      expect(sql(`select string_agg(awb, ',' order by awb) from public.shipments where tenant_id = '${f.tenant}'`)).toBe(f.members.map((m) => `JO${m.order}`).sort().join(","));
      expect(auditOutcomes(f)).toBe("authorized,claimed,sent,unknown,authorization_withheld,authorization_withheld,reconciled_paid");
    } finally {
      cleanup(f);
    }
  });

  it("crash after the write-ahead mark: the next action reconciles, never pays again", async () => {
    const f = await batchFixture();
    try {
      const owner = await signIn("owner-a@geraiexpress.test");
      const provider = fakeProvider(f, (paid) => { payAll(f, paid); return new Response(JSON.stringify({ success: true, data: 2, cnote_no: f.members.map((m) => `JO${m.order}`) }), { headers: { "content-type": "application/json" } }); });
      await authorize(owner, f);
      const c = await claim(f);
      await machine().rpc("dispatch_mark_batch_payment_sent", { p_attempt: c.data.attempt_id, p_batch_object_id: OBJECT_ID });
      // The Worker dies here: no POST result, no finish. A lease expiry changes nothing.
      backdateAttempts(f);
      expect(await payUnpaidShipmentBatch(f.members[0].shipment, f.digest, dispatcherDeps(provider.impl))).toEqual({ status: "inconclusive", reason: "payment_unresolved" });
      expect(provider.posts).toEqual([]);
      expect(attempts(f)).toBe("sent");
      // The provider did apply the original request: the reads reconcile it.
      payAll(f, provider.paid);
      expect(await payUnpaidShipmentBatch(f.members[0].shipment, f.digest, dispatcherDeps(provider.impl))).toEqual({ status: "recorded", outcome: "issued" });
      expect(provider.posts).toEqual([]);
      expect(attempts(f)).toBe("paid");
    } finally {
      cleanup(f);
    }
  });

  it("pays once with the object id, records every member, and a repeated action has nothing left to pay", async () => {
    const f = await batchFixture();
    try {
      const owner = await signIn("owner-a@geraiexpress.test");
      const provider = fakeProvider(f, (paid) => { payAll(f, paid); return new Response(JSON.stringify({ success: true, data: 2, cnote_no: f.members.map((m) => `JO${m.order}`) }), { headers: { "content-type": "application/json" } }); });
      await authorize(owner, f);
      expect(await payUnpaidShipmentBatch(f.members[0].shipment, f.digest, dispatcherDeps(provider.impl))).toEqual({ status: "recorded", outcome: "issued" });
      expect(provider.posts).toEqual([{ batch_id: OBJECT_ID, courier: "JT" }]);
      expect(paidMembers(f)).toBe("2");
      expect(attempts(f)).toBe("paid");
      expect((await authorize(owner, f)).error?.message).toBe("batch_not_payable");
    } finally {
      cleanup(f);
    }
  });

  it("a stored object id missing from older operations is taken from the provider and persisted by the mark", async () => {
    const f = await batchFixture({ objectId: null });
    // The provider's rows carry the object id even though the database never stored one.
    const withId: Batch = { ...f, objectId: OBJECT_ID };
    try {
      const owner = await signIn("owner-a@geraiexpress.test");
      const provider = fakeProvider(withId, (paid) => { payAll(f, paid); return new Response(JSON.stringify({ success: true, data: 2, cnote_no: f.members.map((m) => `JO${m.order}`) }), { headers: { "content-type": "application/json" } }); });
      await authorize(owner, f);
      expect(await payUnpaidShipmentBatch(f.members[0].shipment, f.digest, dispatcherDeps(provider.impl))).toEqual({ status: "recorded", outcome: "issued" });
      expect(provider.posts).toEqual([{ batch_id: OBJECT_ID, courier: "JT" }]);
      expect(sql(`select batch_object_id from private.batch_payment_attempts where tenant_id = '${f.tenant}'`)).toBe(OBJECT_ID);
    } finally {
      cleanup(f);
    }
  });

  it("a definite refusal ends the attempt; a fresh authorization then pays", async () => {
    const f = await batchFixture();
    try {
      const owner = await signIn("owner-a@geraiexpress.test");
      let refuse = true;
      const provider = fakeProvider(f, (paid) => {
        if (refuse) return new Response(JSON.stringify({ success: false, message: "Saldo tidak mencukupi" }), { status: 400, headers: { "content-type": "application/json" } });
        payAll(f, paid);
        return new Response(JSON.stringify({ success: true, data: 2, cnote_no: f.members.map((m) => `JO${m.order}`) }), { headers: { "content-type": "application/json" } });
      });
      const deps = dispatcherDeps(provider.impl);
      await authorize(owner, f);
      expect(await payUnpaidShipmentBatch(f.members[0].shipment, f.digest, deps)).toEqual({ status: "not_reconcilable", reason: "mengantar_refused", detail: "Saldo tidak mencukupi" });
      expect(attempts(f)).toBe("rejected");
      refuse = false;
      await authorize(owner, f);
      expect(await payUnpaidShipmentBatch(f.members[0].shipment, f.digest, deps)).toEqual({ status: "recorded", outcome: "issued" });
      expect(provider.posts).toHaveLength(2);
      expect(attempts(f)).toBe("rejected,paid");
    } finally {
      cleanup(f);
    }
  });
});

describe("batch payment lock order (T-033, DIL-14)", () => {
  it("a claim racing per-order payment writes and checks on its members never deadlocks (40P01)", async () => {
    const f = await batchFixture({ count: 3 });
    try {
      const owner = await signIn("owner-a@geraiexpress.test");
      const errors: string[] = [];
      for (let round = 0; round < 12; round++) {
        await authorize(owner, f);
        const racers = [
          claim(f),
          ...f.members.flatMap((m) => [
            machine().rpc("dispatch_record_payment", { p_operation: m.op, p_order_id: m.order, p_paid: false }),
            machine().rpc("dispatch_begin_payment_check", { p_operation: m.op, p_env: "sandbox" }),
          ]),
        ];
        const results = await Promise.all(racers);
        for (const r of results) if (r.error) errors.push(`${r.error.code}:${r.error.message}`);
        const got = results[0];
        if (got.data?.attempt_id) await machine().rpc("dispatch_release_batch_payment", { p_attempt: got.data.attempt_id });
      }
      expect(errors.filter((e) => e.startsWith("40P01"))).toEqual([]);
    } finally {
      cleanup(f);
    }
  });
});
