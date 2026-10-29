// T-024: real issuance for connected gerai. confirm_shipment creates a real queued operation
// (the Worker dispatches it); a definite refusal can be reopened; the machine finds due work;
// unpaid orders are re-checked; saved addresses keep their Mengantar area only while unchanged.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { IDS, client, machine, realOperation, signIn, sql } from "./helpers";

const AREA = "5fc63169f8f44b34aa4c2ee1";
let outletBefore = "";
// Shipments these tests add to the shared fixture tenant A; removed afterwards so other suites
// (e.g. the paginated shipment list) see only the seeded fixtures.
const created: string[] = [];

// Tenant A as a connected gerai: an active (fake) sealed key and a Mengantar pickup.
beforeAll(() => {
  outletBefore = sql(`select coalesce(pickup_address,'') || '|' || coalesce(pickup_area,'') from public.outlets where id = '${IDS.outletA}'`);
  const v = Number(sql(`select coalesce(max(version), 0) from private.seller_credentials where tenant_id = '${IDS.tenantA}'`));
  sql(`update private.seller_credentials set superseded_at = now(), ciphertext = null, iv = null where tenant_id = '${IDS.tenantA}' and superseded_at is null;
    insert into private.seller_credentials (tenant_id, mode, ciphertext, iv, key_version, hint, version)
      values ('${IDS.tenantA}', 'byok', 'aXNzdWFuY2UtdGVzdC1jaXBoZXI=', 'aXYtMTIzNDU2Nzg=', 'v1', 'TST', ${v + 1});
    update public.outlets set mengantar_pickup_address_id = '6acf44a4771fe2b474c055ca', mengantar_area_id = '5fc62f60f8f44b34aa4c0dcd' where id = '${IDS.outletA}'`);
});
afterAll(() => {
  if (created.length) {
    const ids = created.map((id) => `'${id}'`).join(",");
    sql(`update public.shipments set selected_quote_id = null where id in (${ids}); delete from public.shipments where id in (${ids})`);
  }
  const [address, area] = outletBefore.split("|");
  sql(`update private.seller_credentials set superseded_at = now(), ciphertext = null, iv = null where tenant_id = '${IDS.tenantA}' and superseded_at is null;
    update public.outlets set mengantar_pickup_address_id = null, mengantar_area_id = null,
      pickup_address = nullif('${address}', ''), pickup_area = nullif('${area}', '') where id = '${IDS.outletA}'`);
});

// A complete real draft of tenant A with a live quote, ready to confirm.
async function quotedRealDraft(overrides: Record<string, unknown> = {}) {
  const owner = await signIn("owner-a@geraiexpress.test");
  const { data: id } = await owner.rpc("create_shipment_draft", { p_outlet: IDS.outletA });
  created.push(id as string);
  const { error } = await owner.from("shipments").update({
    sender_name: "Pengirim Uji", sender_phone: "081200001111", recipient_name: "Penerima Uji", recipient_phone: "081200002222",
    recipient_address: "Jl. Kapitan 1 RT 01/04", recipient_area: "SUKATANI, TAPOS, DEPOK", recipient_area_id: AREA,
    item_description: "Dokumen", weight_grams: 1000, goods_value_idr: 50000, ...overrides,
  }).eq("id", id);
  expect(error).toBeNull();
  const revision = Number(sql(`select revision from public.shipments where id = '${id}'`));
  const quotes = await machine().rpc("record_live_quotes", { p_tenant: IDS.tenantA, p_shipment: id, p_expected_revision: revision,
    p_origin_area_id: "5fc62f60f8f44b34aa4c0dcd", p_origin_address_id: "6acf44a4771fe2b474c055ca",
    p_rows: [{ courier: "JT", tariff: 9000, net: 6300, eta: "1 - 2 days" }] });
  expect(quotes.error).toBeNull();
  const quote = sql(`select id from public.shipment_quotes where shipment_id = '${id}' and expires_at > now()`);
  return { owner, id: id as string, revision, quote };
}

const confirm = (c: Awaited<ReturnType<typeof signIn>>, id: string, quote: string, revision: number, key = randomUUID()) =>
  c.rpc("confirm_shipment", { p_shipment: id, p_quote: quote, p_expected_revision: revision, p_idempotency_key: key });

describe("confirming a real shipment (T-024)", () => {
  it("creates one real queued operation for the dispatcher; a replay never creates another", async () => {
    const { owner, id, revision, quote } = await quotedRealDraft();
    const key = randomUUID();
    const { data, error } = await confirm(owner, id, quote, revision, key);
    expect(error).toBeNull();
    expect(data).toMatchObject({ state: "queued", simulated: false, replayed: false, awb: null });
    expect(sql(`select state || '|' || is_simulated from public.provider_operations where shipment_id = '${id}'`)).toBe("queued|false");
    expect(sql(`select submission_state || '|' || customer_charge_idr from public.shipments where id = '${id}'`)).toBe("queued|9000");
    expect((await confirm(owner, id, quote, revision, key)).data).toMatchObject({ replayed: true, simulated: false });
    expect((await confirm(owner, id, quote, revision)).data).toMatchObject({ replayed: true });
    expect(sql(`select count(*) from public.provider_operations where shipment_id = '${id}'`)).toBe("1");
  });

  it("refuses when a dispatch input is missing", async () => {
    const noValue = await quotedRealDraft({ goods_value_idr: 0 });
    expect((await confirm(noValue.owner, noValue.id, noValue.quote, noValue.revision)).error?.message).toBe("goods_value_required");
    const noArea = await quotedRealDraft({ recipient_area_id: null });
    expect((await confirm(noArea.owner, noArea.id, noArea.quote, noArea.revision)).error?.message).toBe("area_required");
    const d = await quotedRealDraft();
    sql(`update public.outlets set mengantar_pickup_address_id = null where id = '${IDS.outletA}'`);
    try {
      expect((await confirm(d.owner, d.id, d.quote, d.revision)).error?.message).toBe("pickup_not_set");
    } finally {
      sql(`update public.outlets set mengantar_pickup_address_id = '6acf44a4771fe2b474c055ca' where id = '${IDS.outletA}'`);
    }
    // A simulated quote cannot be confirmed on a real shipment.
    sql(`update public.shipment_quotes set is_simulated = true where id = '${d.quote}'`);
    expect((await confirm(d.owner, d.id, d.quote, d.revision)).error?.message).toBe("stale_quote");
  });
});

describe("reopening after a definite refusal (T-024)", () => {
  it("only a refusal that created nothing reopens the draft for another confirmation", async () => {
    const d = await quotedRealDraft();
    const first = (await confirm(d.owner, d.id, d.quote, d.revision)).data as { operation_id: string };
    expect((await d.owner.rpc("reopen_shipment", { p_shipment: d.id })).error?.message).toBe("not_reopenable");
    await machine().rpc("dispatch_claim", { p_operation: first.operation_id, p_env: "sandbox" });
    await machine().rpc("dispatch_record", { p_operation: first.operation_id, p_attempt: 1, p_outcome: "rejected", p_code: "PROVIDER_REJECTED" });
    expect((await d.owner.rpc("reopen_shipment", { p_shipment: d.id })).error).toBeNull();
    expect(sql(`select submission_state || '|' || coalesce(selected_quote_id::text, '-') from public.shipments where id = '${d.id}'`)).toBe("draft|-");
    // Quote and confirm again: a second operation is allowed, the first stays as history.
    const revision = Number(sql(`select revision from public.shipments where id = '${d.id}'`));
    await machine().rpc("record_live_quotes", { p_tenant: IDS.tenantA, p_shipment: d.id, p_expected_revision: revision,
      p_origin_area_id: "5fc62f60f8f44b34aa4c0dcd", p_origin_address_id: "6acf44a4771fe2b474c055ca",
      p_rows: [{ courier: "SiCepat", tariff: 9500, net: 7000, eta: "" }] });
    const quote = sql(`select id from public.shipment_quotes where shipment_id = '${d.id}' and expires_at > now()`);
    expect((await confirm(d.owner, d.id, quote, revision)).data).toMatchObject({ state: "queued", replayed: false });
    expect(sql(`select string_agg(state || ':' || coalesce(result_code, '-'), ',' order by created_at) from public.provider_operations where shipment_id = '${d.id}'`))
      .toBe("failed:PROVIDER_REJECTED,queued:-");
  });

  it("a failure that may still become an order blocks reopening and a second operation", async () => {
    const d = await quotedRealDraft();
    const op = ((await confirm(d.owner, d.id, d.quote, d.revision)).data as { operation_id: string }).operation_id;
    await machine().rpc("dispatch_claim", { p_operation: op, p_env: "sandbox" });
    await machine().rpc("dispatch_record", { p_operation: op, p_attempt: 1, p_outcome: "failed", p_code: "PROVIDER_ERROR_ITEM" });
    expect((await d.owner.rpc("reopen_shipment", { p_shipment: d.id })).error?.message).toBe("not_reopenable");
    // Even forcing the shipment back to a quoted draft cannot create a second live operation.
    sql(`update public.shipments set submission_state = 'estimated' where id = '${d.id}'`);
    expect((await confirm(d.owner, d.id, d.quote, d.revision)).data).toMatchObject({ replayed: true });
    expect(sql(`select count(*) from public.provider_operations where shipment_id = '${d.id}'`)).toBe("1");
  });
});

describe("due work and payment checks (machine only)", () => {
  it("lists queued, stale, unknown and unpaid operations, throttled after a check", async () => {
    // Operations left by earlier tests and runs would fill the 50-row page (oldest first).
    sql(`update public.provider_operations set last_checked_at = now() where not is_simulated`);
    const queued = await realOperation();
    sql(`update public.provider_operations set updated_at = now() - interval '2 minutes' where id = '${queued.op}'`);
    const fresh = await realOperation();
    const stale = await realOperation();
    await machine().rpc("dispatch_claim", { p_operation: stale.op, p_env: "sandbox" });
    sql(`update public.provider_operations set dispatched_at = now() - interval '3 minutes' where id = '${stale.op}'`);
    const unpaid = await realOperation();
    await machine().rpc("dispatch_claim", { p_operation: unpaid.op, p_env: "sandbox" });
    await machine().rpc("dispatch_record", { p_operation: unpaid.op, p_attempt: 1, p_outcome: "unpaid", p_order_id: "261014H0JAFR", p_batch: "26101416827JYE" });

    const due = async () => {
      const { data, error } = await machine().rpc("dispatch_due", { p_limit: 50, p_env: "sandbox" });
      expect(error).toBeNull();
      return new Map((data as { operation_id: string; action: string }[]).map((r) => [r.operation_id, r.action]));
    };
    let map = await due();
    expect(map.get(queued.op)).toBe("dispatch");
    expect(map.has(fresh.op)).toBe(false);
    expect(map.get(stale.op)).toBe("reconcile");
    expect(map.get(unpaid.op)).toBe("payment");

    const check = await machine().rpc("dispatch_begin_payment_check", { p_operation: unpaid.op, p_env: "sandbox" });
    expect(check.data).toMatchObject({ provider_order_id: "261014H0JAFR", provider_batch: "26101416827JYE", provider_env: "sandbox" });
    await machine().rpc("dispatch_begin_reconcile", { p_operation: stale.op, p_env: "sandbox" });
    map = await due();
    expect(map.has(unpaid.op)).toBe(false); // checked just now
    expect(map.has(stale.op)).toBe(false);
    expect((await machine().rpc("dispatch_begin_payment_check", { p_operation: queued.op, p_env: "sandbox" })).error?.message).toBe("nothing_to_check");

    // Claims that would certainly be refused are not due.
    const keyless = await realOperation({ noCredential: true });
    sql(`update public.provider_operations set updated_at = now() - interval '2 minutes' where id = '${keyless.op}'`);
    expect((await due()).has(keyless.op)).toBe(false);

    // A released operation (nothing sent) is not retried on every sweep.
    const released = await realOperation();
    sql(`update public.provider_operations set updated_at = now() - interval '2 minutes' where id = '${released.op}'`);
    expect((await due()).get(released.op)).toBe("dispatch");
    await machine().rpc("dispatch_claim", { p_operation: released.op, p_env: "sandbox" });
    await machine().rpc("dispatch_release", { p_operation: released.op, p_attempt: 1 });
    sql(`update public.provider_operations set updated_at = now() - interval '2 minutes' where id = '${released.op}'`);
    expect((await due()).has(released.op)).toBe(false);

    for (const c of [client(), await signIn("owner-a@geraiexpress.test")]) {
      expect((await c.rpc("dispatch_due", { p_limit: 5, p_env: "sandbox" })).error).not.toBeNull();
      expect((await c.rpc("dispatch_begin_payment_check", { p_operation: unpaid.op, p_env: "sandbox" })).error).not.toBeNull();
    }
  });
});

describe("saved addresses keep their Mengantar area (T-024)", () => {
  it("the area id survives other edits and is dropped when the area text changes", async () => {
    const owner = await signIn("owner-a@geraiexpress.test");
    const { data: contact } = await owner.from("contacts").insert({ tenant_id: IDS.tenantA, name: "Penerima Area", phone: "081233334444", is_recipient: true }).select("id").single();
    const { data: address, error } = await owner.from("contact_addresses").insert({ tenant_id: IDS.tenantA, contact_id: contact!.id,
      address_line: "Jl. Area No. 1", area: "SUKATANI, TAPOS, DEPOK", area_id: AREA, is_primary: true }).select("id").single();
    expect(error).toBeNull();
    const areaId = () => sql(`select coalesce(area_id, '-') from public.contact_addresses where id = '${address!.id}'`);
    await owner.from("contact_addresses").update({ address_line: "Jl. Area No. 2" }).eq("id", address!.id);
    expect(areaId()).toBe(AREA);
    await owner.from("contact_addresses").update({ area: "Tapos, Depok" }).eq("id", address!.id);
    expect(areaId()).toBe("-");
    expect((await owner.from("contact_addresses").update({ area_id: "bad" }).eq("id", address!.id)).error).not.toBeNull();
  });
});

describe("review and audit follow-ups (T-024)", () => {
  const record = (op: string, args: Record<string, unknown>) => machine().rpc("dispatch_record", { p_operation: op, p_attempt: 1, ...args });

  it("a reconciled unpaid order is payment-checked and gets its resi", async () => {
    const f = await realOperation();
    await machine().rpc("dispatch_claim", { p_operation: f.op, p_env: "sandbox" });
    await record(f.op, { p_outcome: "unknown" });
    await record(f.op, { p_outcome: "unpaid", p_order_id: "261014RECON1", p_batch: "26101416RECON1", p_code: "RECONCILED" });
    expect((await machine().rpc("dispatch_begin_payment_check", { p_operation: f.op, p_env: "sandbox" })).data).toMatchObject({ provider_order_id: "261014RECON1" });
    expect((await record(f.op, { p_outcome: "issued", p_order_id: "261014RECON1", p_tracking: "JO5555555555", p_batch: "26101416RECON1" })).error).toBeNull();
    expect(sql(`select submission_state || '|' || payment_state || '|' || awb from public.shipments where id = '${f.shipment}'`)).toBe("issued|paid|JO5555555555");
  });

  it("records the price Mengantar charged and flags a difference from the customer charge", async () => {
    const f = await realOperation();
    sql(`update public.shipments set customer_charge_idr = 9000 where id = '${f.shipment}'`);
    await machine().rpc("dispatch_claim", { p_operation: f.op, p_env: "sandbox" });
    await record(f.op, { p_outcome: "issued", p_order_id: "261014PRICE1", p_tracking: "JO1212121212", p_batch: "26101416PRICE1", p_price: 9500 });
    expect(sql(`select provider_price_idr from public.provider_operations where id = '${f.op}'`)).toBe("9500");
    expect(sql(`select detail from public.shipment_events where shipment_id = '${f.shipment}' and kind = 'price_mismatch'`)).toBe("Mengantar menagih Rp9500, ongkir pelanggan Rp9000");
    const same = await realOperation();
    sql(`update public.shipments set customer_charge_idr = 9000 where id = '${same.shipment}'`);
    await machine().rpc("dispatch_claim", { p_operation: same.op, p_env: "sandbox" });
    await record(same.op, { p_outcome: "issued", p_order_id: "261014PRICE2", p_tracking: "JO1313131313", p_batch: "26101416PRICE2", p_price: 9000 });
    expect(sql(`select count(*) from public.shipment_events where shipment_id = '${same.shipment}' and kind = 'price_mismatch'`)).toBe("0");
  });

  it("an operation that waited hours is failed as stale without sending, and is reopenable", async () => {
    const d = await quotedRealDraft();
    const op = ((await confirm(d.owner, d.id, d.quote, d.revision)).data as { operation_id: string }).operation_id;
    sql(`update public.provider_operations set created_at = now() - interval '7 hours' where id = '${op}'`);
    expect((await machine().rpc("dispatch_claim", { p_operation: op, p_env: "sandbox" })).data).toEqual({ stale: true });
    expect(sql(`select state || '|' || result_code || '|' || attempts from public.provider_operations where id = '${op}'`)).toBe("failed|QUOTE_STALE|0");
    expect((await d.owner.rpc("reopen_shipment", { p_shipment: d.id })).error).toBeNull();
  });

  it("an admin closes an unresolved provider-error failure only after a re-check and some time", async () => {
    const d = await quotedRealDraft();
    const op = ((await confirm(d.owner, d.id, d.quote, d.revision)).data as { operation_id: string }).operation_id;
    await machine().rpc("dispatch_claim", { p_operation: op, p_env: "sandbox" });
    await record(op, { p_outcome: "failed", p_code: "PROVIDER_ERROR_ITEM" });
    const operator = await signIn("operator-a@geraiexpress.test");
    expect((await operator.rpc("close_failed_operation", { p_shipment: d.id, p_reason: "Sudah dicek di aplikasi" })).error?.message).toBe("admin_required");
    expect((await d.owner.rpc("close_failed_operation", { p_shipment: d.id, p_reason: "Sudah dicek di aplikasi" })).error?.message).toBe("not_closable");
    // The re-check is allowed for a provider error item now.
    expect((await machine().rpc("dispatch_begin_reconcile", { p_operation: op, p_env: "sandbox" })).error).toBeNull();
    sql(`update public.provider_operations set dispatched_at = now() - interval '40 minutes' where id = '${op}'`);
    expect((await d.owner.rpc("close_failed_operation", { p_shipment: d.id, p_reason: "x" })).error).not.toBeNull();
    expect((await d.owner.rpc("close_failed_operation", { p_shipment: d.id, p_reason: "Sudah dicek di aplikasi Mengantar" })).error).toBeNull();
    expect(sql(`select result_code from public.provider_operations where id = '${op}'`)).toBe("CLOSED_NOT_CREATED");
    expect(sql(`select count(*) from public.audit_events where action = 'shipment.close_failed' and detail->>'operation' = '${op}'`)).toBe("1");
    expect((await d.owner.rpc("reopen_shipment", { p_shipment: d.id })).error).toBeNull();
    // A late truthful result for a closed operation is refused, by design.
    expect((await record(op, { p_outcome: "issued", p_order_id: "261014LATE99", p_tracking: "JO9999999999", p_batch: "26101416LATE99" })).error?.message).toBe("already_recorded");
  });

  it("re-checks recent 'not created' conclusions hourly, keeps duplicate reasons, refuses sample labels for real shipments", async () => {
    const f = await realOperation();
    await machine().rpc("dispatch_claim", { p_operation: f.op, p_env: "sandbox" });
    await record(f.op, { p_outcome: "unknown" });
    await record(f.op, { p_outcome: "unknown", p_code: "DUPLICATE_ORDERS" });
    expect(sql(`select result_code from public.provider_operations where id = '${f.op}'`)).toBe("DUPLICATE_ORDERS");
    sql(`update public.provider_operations set dispatched_at = now() - interval '6 minutes' where id = '${f.op}'`);
    await record(f.op, { p_outcome: "not_created" });
    const due = async () => new Map(((await machine().rpc("dispatch_due", { p_limit: 50, p_env: "sandbox" })).data as { operation_id: string; action: string }[]).map((r) => [r.operation_id, r.action]));
    expect((await due()).get(f.op)).toBe("reconcile");
    await machine().rpc("dispatch_begin_reconcile", { p_operation: f.op, p_env: "sandbox" });
    expect((await due()).has(f.op)).toBe(false);

    const owner = await signIn("owner-a@geraiexpress.test");
    const { data: real } = await owner.rpc("create_shipment_draft", { p_outlet: IDS.outletA });
    created.push(real as string);
    sql(`update public.shipments set submission_state = 'issued', awb = 'JO4444444444' where id = '${real}'`);
    expect((await owner.rpc("request_label", { p_shipment: real })).error?.message).toBe("provider_label_required");
  });

  it("records the price on reconciled and corrected results too, and counts operations past the re-check windows", async () => {
    const f = await realOperation();
    sql(`update public.shipments set customer_charge_idr = 9000 where id = '${f.shipment}'`);
    await machine().rpc("dispatch_claim", { p_operation: f.op, p_env: "sandbox" });
    await record(f.op, { p_outcome: "unknown" });
    sql(`update public.provider_operations set dispatched_at = now() - interval '6 minutes' where id = '${f.op}'`);
    await record(f.op, { p_outcome: "not_created" });
    const corrected = await record(f.op, { p_outcome: "issued", p_order_id: "261014CORR01", p_tracking: "JO7878787878", p_batch: "26101416CORR01", p_price: 9900 });
    expect(corrected.data).toMatchObject({ state: "succeeded", price_mismatch: true });
    expect(sql(`select provider_price_idr from public.provider_operations where id = '${f.op}'`)).toBe("9900");

    const before = (await machine().rpc("dispatch_stuck_counts", {})).data as Record<string, number>;
    const old = await realOperation();
    await machine().rpc("dispatch_claim", { p_operation: old.op, p_env: "sandbox" });
    await record(old.op, { p_outcome: "unknown" });
    sql(`update public.provider_operations set dispatched_at = now() - interval '8 days' where id = '${old.op}'`);
    const after = (await machine().rpc("dispatch_stuck_counts", {})).data as Record<string, number>;
    expect(after.unknown).toBe(before.unknown + 1);
    expect((await client().rpc("dispatch_stuck_counts", {})).error).not.toBeNull();
  });

  it("reports a price difference once when an unpaid order is paid, and an unreadable price as unknown", async () => {
    const f = await realOperation();
    sql(`update public.shipments set customer_charge_idr = 9000 where id = '${f.shipment}'`);
    await machine().rpc("dispatch_claim", { p_operation: f.op, p_env: "sandbox" });
    const unpaid = await record(f.op, { p_outcome: "unpaid", p_order_id: "261014ONCE01", p_batch: "26101416ONCE01", p_price: 9500 });
    expect(unpaid.data).toMatchObject({ price_mismatch: true });
    const paid = await record(f.op, { p_outcome: "issued", p_order_id: "261014ONCE01", p_tracking: "JO2323232323", p_batch: "26101416ONCE01", p_price: 9500 });
    expect(paid.data).toMatchObject({ state: "succeeded", price_mismatch: false });
    expect(sql(`select count(*) from public.shipment_events where shipment_id = '${f.shipment}' and kind = 'price_mismatch'`)).toBe("1");

    const blind = await realOperation();
    await machine().rpc("dispatch_claim", { p_operation: blind.op, p_env: "sandbox" });
    const unknown = await record(blind.op, { p_outcome: "issued", p_order_id: "261014BLIND1", p_tracking: "JO3434343434", p_batch: "26101416BLIND1" });
    expect(unknown.data).toMatchObject({ state: "succeeded", price_mismatch: null });
    expect(sql(`select coalesce(provider_price_idr::text, 'none') from public.provider_operations where id = '${blind.op}'`)).toBe("none");
    for (const role of ["anon", "authenticated"]) {
      expect(sql(`select has_function_privilege('${role}', 'private.record_provider_price(public.provider_operations, bigint)', 'execute')`)).toBe("f");
    }
  });

  it("counts failures, unpaid orders and queued operations past their windows", async () => {
    const counts = async () => (await machine().rpc("dispatch_stuck_counts", {})).data as Record<string, number>;
    const before = await counts();
    const failed = await realOperation();
    await machine().rpc("dispatch_claim", { p_operation: failed.op, p_env: "sandbox" });
    await record(failed.op, { p_outcome: "failed", p_code: "PROVIDER_ERROR_ITEM", p_batch: "26101416STUCK1" });
    const unpaid = await realOperation();
    await machine().rpc("dispatch_claim", { p_operation: unpaid.op, p_env: "sandbox" });
    await record(unpaid.op, { p_outcome: "unpaid", p_order_id: "261014STUCK2", p_batch: "26101416STUCK2" });
    const queued = await realOperation();
    expect(await counts()).toEqual(before);
    sql(`update public.provider_operations set dispatched_at = now() - interval '25 hours' where id = '${failed.op}'`);
    sql(`update public.provider_operations set updated_at = now() - interval '8 days' where id = '${unpaid.op}'`);
    sql(`update public.provider_operations set created_at = now() - interval '7 hours' where id = '${queued.op}'`);
    expect(await counts()).toEqual({ ...before, failed_unresolved: before.failed_unresolved + 1, unpaid: before.unpaid + 1, queued: before.queued + 1 });
  });
});
