// T-025 (COD shipments, two-pass COD fee pricing, provider refusal detail) and
// T-026 (batch pay-unpaid review, digest-bound claim, and per-order payment recording).
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
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
    })).error?.message).toBe("cod_goods_value_required");

    sql(`update public.shipments set goods_value_idr = 50000 where id = '${f.shipment}'`);
    const rev2 = Number(sql(`select revision from public.shipments where id = '${f.shipment}'`));

    // All-unsupported COD rows are filtered out, leaving count = 0 and submission_state = draft
    expect((await m.rpc("record_live_quotes", {
      p_tenant: f.tenant,
      p_shipment: f.shipment,
      p_expected_revision: rev2,
      p_rows: [{ courier: "JT", tariff: 93000, cod_fee: 0, cod_supported: false, net: 65100, eta: "2 - 4 days" }],
    })).data).toBe(0);
    expect(sql(`select submission_state from public.shipments where id = '${f.shipment}'`)).toBe("draft");

    expect((await m.rpc("record_live_quotes", {
      p_tenant: f.tenant, p_shipment: f.shipment, p_expected_revision: rev2, p_rows: codRows,
    })).data).toBe(2);

    expect(sql(`select string_agg(courier || ':' || normal_tariff_idr || ':' || cod_fee_idr || ':' || customer_charge_idr || ':' || cod_supported, ',' order by customer_charge_idr)
      from public.shipment_quotes where shipment_id = '${f.shipment}' and expires_at > now()`))
      .toBe("JNE:40000:3150:43150:true,JT:93000:4994:97994:true");
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
        expect((await c.rpc("dispatch_begin_batch_payment", { p_shipment: ship1, p_batch_digest: "x" })).error).not.toBeNull();
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
        p_shipment: ship1, p_batch_digest: "wrong-digest",
      })).error?.message).toBe("batch_digest_mismatch");

      // Machine claim with matching digest succeeds and locks the batch
      const claim = await m.rpc("dispatch_begin_batch_payment", {
        p_shipment: ship1, p_batch_digest: data.batch_digest,
      });
      expect(claim.error).toBeNull();
      expect((claim.data as { batch: string }).batch).toBe(batchCode);

      // A second claim while payment_in_flight_at is active is refused as account_busy
      expect((await m.rpc("dispatch_begin_batch_payment", {
        p_shipment: ship1, p_batch_digest: data.batch_digest,
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
      await m.rpc("dispatch_release_batch_payment", { p_claim_operation: op1 });

      expect(sql(`select submission_state || ':' || payment_state || ':' || coalesce(awb, '') from public.shipments where id = '${ship1}'`))
        .toBe("issued:paid:JO2610270001");
      expect(sql(`select submission_state || ':' || payment_state || ':' || coalesce(awb, '') from public.shipments where id = '${ship2}'`))
        .toBe("issued:paid:JO2610270002");
    } finally {
      sql(`delete from public.shipments where id in ('${ship1}', '${ship2}')`);
    }
  });
});
