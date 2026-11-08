import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { machine, realOperation, signIn, sql } from "./helpers";

// T-045 slice 2: DELETE /order cancel decision with read-back, provider-private batch-delete refund, and the
// provider weight / hub city seam in ingestion.
async function issued() {
  const f = await realOperation();
  const orderId = `ORD${randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}`;
  sql(`update public.provider_operations set state = 'succeeded', provider_env = 'sandbox', provider_order_id = '${orderId}', credential_version = 1 where id = '${f.op}';
       update public.shipments set submission_state = 'issued', awb = 'JP${orderId.slice(3)}', issued_at = now() - interval '3 hours' where id = '${f.shipment}';`);
  return { ...f, orderId };
}
const begin = (f: { tenant: string; shipment: string }, env = "sandbox") => machine().rpc("cancel_begin", { p_tenant: f.tenant, p_env: env, p_shipment: f.shipment });
const record = (f: { tenant: string; shipment: string }, outcome: string) => machine().rpc("cancel_record", { p_tenant: f.tenant, p_env: "sandbox", p_shipment: f.shipment, p_outcome: outcome });
const cancelState = (shipment: string) => JSON.parse(sql(`select json_build_object('state', cancel_state, 'kind', provider_status_kind) from public.shipments where id = '${shipment}'`));
const ingest = (p: Record<string, unknown>) => machine().rpc("ingest_provider_status", { p_env: "sandbox", p_source: "webhook", p_awb: null, ...p });
const ts = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString();

describe("cancel decision (T-045 slice 2)", () => {
  it("lets exactly one decision send the DELETE; a pending outcome only reads back", async () => {
    const f = await issued();
    const first = await begin(f);
    expect(first.error).toBeNull();
    expect(first.data[0]).toMatchObject({ action: "send", order_id: f.orderId, courier: "JT" });
    expect(cancelState(f.shipment).state).toBe("requested");
    // A crash before the outcome is recorded (unknown outcome): the next decision may only read back.
    expect((await begin(f)).data[0].action).toBe("readback");
    expect((await record(f, "unknown")).data).toBe("unknown");
    expect((await begin(f)).data[0].action).toBe("readback");
    const [a, b] = await Promise.all([issued(), issued()]);
    const racing = await Promise.all([begin(a), begin(a), begin(a)]);
    expect(racing.map((r) => r.data?.[0]?.action).sort()).toEqual(["readback", "readback", "send"]);
    expect(b.shipment).not.toBe(a.shipment);
  });

  it("a courier-refused order stays not-cancelled and may be decided again; a proven cancellation becomes final", async () => {
    const f = await issued();
    await begin(f);
    expect((await record(f, "refused")).data).toBe("refused");
    expect(cancelState(f.shipment)).toEqual({ state: "refused", kind: null });
    expect((await begin(f)).data[0].action).toBe("send");
    expect((await record(f, "cancelled")).data).toBe("cancelled");
    expect(cancelState(f.shipment)).toEqual({ state: "cancelled", kind: "cancelled" });
    expect((await begin(f)).data[0].action).toBe("done");
    expect(Number(sql(`select count(*) from public.shipment_events where shipment_id = '${f.shipment}' and kind = 'cancelled'`))).toBe(1);
    // Nothing to record once decided.
    expect((await record(f, "unknown")).error?.message).toBe("stale_state");
  });

  it("refuses a delivered, simulated, unissued or other-environment shipment, and an unknown outcome value", async () => {
    const delivered = await issued();
    await ingest({ p_tenant: delivered.tenant, p_provider_ts: ts(5), p_order_id: delivered.orderId, p_status: "DELIVERED" });
    expect((await begin(delivered)).error?.message).toBe("not_cancellable");
    const f = await issued();
    expect((await begin(f, "production")).error?.message).toBe("not_cancellable");
    const queued = await realOperation();
    expect((await begin(queued)).error?.message).toBe("not_cancellable");
    await begin(f);
    expect((await record(f, "deleted")).error?.message).toBe("invalid_input");
    expect(cancelState(f.shipment).state).toBe("requested");
  });

  it("a cancellation read back after the parcel was delivered is a conflict and never rewrites the delivery", async () => {
    const f = await issued();
    await begin(f);
    await ingest({ p_tenant: f.tenant, p_provider_ts: ts(5), p_order_id: f.orderId, p_status: "DELIVERED" });
    expect((await record(f, "cancelled")).data).toBe("conflict");
    expect(cancelState(f.shipment)).toEqual({ state: "unknown", kind: "delivered" });
  });

  it("is machine-only and keeps the private detail unreadable by operators", async () => {
    const owner = await signIn("owner-a@geraiexpress.test");
    const f = await issued();
    expect((await owner.rpc("cancel_begin", { p_tenant: f.tenant, p_env: "sandbox", p_shipment: f.shipment })).error).not.toBeNull();
    expect((await owner.rpc("cancel_record", { p_tenant: f.tenant, p_env: "sandbox", p_shipment: f.shipment, p_outcome: "cancelled" })).error).not.toBeNull();
    expect((await owner.rpc("record_batch_delete", { p_tenant: f.tenant, p_env: "sandbox", p_batch_id: "a".repeat(24), p_courier: "spx", p_deleted: 1, p_undeleted: 0, p_total: 1, p_is_draft: false, p_orders_count: 1, p_refund_idr: 1000, p_refused_count: 0 })).error).not.toBeNull();
    expect((await owner.from("shipments").update({ cancel_state: "cancelled" }).eq("id", f.shipment)).error).not.toBeNull();
    for (const table of ["shipment_cancellations", "provider_batch_deletions"]) {
      expect(Number(sql(`select count(*) from information_schema.role_table_grants where table_schema = 'private' and table_name = '${table}' and grantee in ('authenticated','anon','service_role','public')`))).toBe(0);
    }
  });
});

describe("batch delete record (T-045 slice 2, refund is provider-private and absent is not 0)", () => {
  const rec = (f: { tenant: string }, p: Record<string, unknown>) => machine().rpc("record_batch_delete", {
    p_tenant: f.tenant, p_env: "sandbox", p_batch_id: "a".repeat(24), p_courier: "spx", p_deleted: 2, p_undeleted: 1, p_total: 3, p_is_draft: false,
    p_orders_count: 3, p_refund_idr: 25500, p_refused_count: 1, ...p });

  it("stores the refund for a reporting courier and keeps null (unknown) for the others", async () => {
    const f = await issued();
    expect((await rec(f, {})).error).toBeNull();
    expect((await rec(f, { p_courier: "JNE", p_orders_count: null, p_refund_idr: null, p_refused_count: null })).error).toBeNull();
    expect((await rec(f, { p_courier: "pos", p_orders_count: null, p_refund_idr: null, p_refused_count: null })).error).toBeNull();
    expect((await rec(f, { p_courier: "lion", p_refund_idr: 0, p_refused_count: 0 })).error).toBeNull();
    const rows = JSON.parse(sql(`select json_agg(json_build_object('c', courier, 'refund', refund_idr) order by id) from private.provider_batch_deletions where tenant_id = '${f.tenant}'`));
    expect(rows).toEqual([{ c: "spx", refund: 25500 }, { c: "JNE", refund: null }, { c: "pos", refund: null }, { c: "lion", refund: 0 }]);
  });

  it("refuses a refund for a courier that does not report one, a negative amount and inconsistent shape", async () => {
    const f = await issued();
    expect((await rec(f, { p_courier: "JNE" })).error?.message).toBe("invalid_input");
    expect((await rec(f, { p_refund_idr: -1 })).error?.message).toBe("invalid_input");
    expect((await rec(f, { p_courier: "Ninja", p_orders_count: null, p_refund_idr: null, p_refused_count: null })).error?.message).toBe("invalid_input");
    expect((await rec(f, { p_batch_id: "XYZ" })).error?.message).toBe("invalid_input");
    expect((await rec({ tenant: randomUUID() }, {})).error?.message).toBe("not_found");
  });
});

describe("provider weight and hub city in ingestion (T-045 slice 2)", () => {
  const weights = (shipment: string) => JSON.parse(sql(`select json_build_object('provider', provider_weight_grams, 'measured', weight_grams, 'snapshot', weight_snapshot) from public.shipments where id = '${shipment}'`));

  it("stores the provider weight without touching the measured weight, and a null never erases it", async () => {
    const f = await issued();
    const before = weights(f.shipment);
    expect(before).toMatchObject({ provider: null, measured: 1000 });
    expect((await ingest({ p_tenant: f.tenant, p_provider_ts: ts(30), p_order_id: f.orderId, p_status: "PICKED UP", p_provider_weight_grams: 1500, p_hub_city: " Jakarta Timur " })).data).toBe("applied");
    expect(weights(f.shipment)).toEqual({ ...before, provider: 1500 });
    expect(sql(`select hub_city from public.shipment_events where shipment_id = '${f.shipment}' and provider_ts is not null`)).toBe("Jakarta Timur");
    await ingest({ p_tenant: f.tenant, p_provider_ts: ts(20), p_order_id: f.orderId, p_status: "ON DELIVERY" });
    expect(weights(f.shipment).provider).toBe(1500);
    // A newer reading replaces it; an older one (stale) never does.
    await ingest({ p_tenant: f.tenant, p_provider_ts: ts(10), p_order_id: f.orderId, p_status: "ON DELIVERY", p_provider_weight_grams: 1700 });
    expect(weights(f.shipment).provider).toBe(1700);
    expect((await ingest({ p_tenant: f.tenant, p_provider_ts: ts(25), p_order_id: f.orderId, p_status: "PENDING PICKUP", p_provider_weight_grams: 900 })).data).toBe("stale");
    expect(weights(f.shipment).provider).toBe(1700);
  });

  it("a final shipment keeps its measured provider weight but accepts one while it has none; untrusted history never writes it", async () => {
    const f = await issued();
    await ingest({ p_tenant: f.tenant, p_provider_ts: ts(20), p_order_id: f.orderId, p_status: "DELIVERED", p_provider_weight_grams: 1200 });
    expect((await ingest({ p_tenant: f.tenant, p_provider_ts: ts(5), p_order_id: f.orderId, p_status: "ON DELIVERY", p_provider_weight_grams: 5000 })).data).toBe("final");
    expect(weights(f.shipment).provider).toBe(1200);
    const g = await issued();
    await ingest({ p_tenant: g.tenant, p_provider_ts: ts(20), p_order_id: g.orderId, p_status: "DELIVERED" });
    await ingest({ p_tenant: g.tenant, p_provider_ts: ts(5), p_order_id: g.orderId, p_status: "ON DELIVERY", p_provider_weight_grams: 800 });
    expect(weights(g.shipment).provider).toBe(800);
    const h = await issued();
    expect((await ingest({ p_tenant: h.tenant, p_source: "pull", p_ts_trusted: false, p_provider_ts: ts(0), p_order_id: h.orderId, p_status: "PICKED UP", p_provider_weight_grams: 700, p_hub_city: "Bandung" })).data).toBe("history_only");
    expect(weights(h.shipment).provider).toBeNull();
  });

  it("refuses an out-of-range weight and an unprintable hub city, and the public timeline never carries either", async () => {
    const f = await issued();
    for (const bad of [{ p_provider_weight_grams: 0 }, { p_provider_weight_grams: 2_000_000 }, { p_hub_city: "x".repeat(61) }, { p_hub_city: "Kota\nBaru" }]) {
      expect((await ingest({ p_tenant: f.tenant, p_provider_ts: ts(1), p_order_id: f.orderId, p_status: "PICKED UP", ...bad })).error?.message, JSON.stringify(bad)).toBe("invalid_input");
    }
    const token = randomUUID().replace(/-/g, "").repeat(2).slice(0, 43);
    const ownerId = sql(`select id from auth.users where email = 'owner-a@geraiexpress.test'`);
    await ingest({ p_tenant: f.tenant, p_provider_ts: ts(5), p_order_id: f.orderId, p_status: "PICKED UP", p_provider_weight_grams: 1500, p_hub_city: "Surabaya" });
    sql(`insert into public.tracking_links (tenant_id, shipment_id, token_hash, created_by, shared_at)
      values ('${f.tenant}', '${f.shipment}', encode(extensions.digest(convert_to('${token}', 'utf8'), 'sha256'), 'hex'), '${ownerId}', now())`);
    const shown = sql(`select public.track_shipment('${token}')::text`);
    expect(shown).not.toContain("Surabaya");
    expect(shown).not.toContain("1500");
  });
});
