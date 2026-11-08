import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { machine, realOperation, sql } from "./helpers";

// Backend review wave X (migration 20261109100000): P1-1 delivery_state sync, P1-2 cancel fence and release,
// P1-3 stored Partner ID reader, P2-2 post-lock role rechecks, P2-6 environment-scoped known time ids,
// P3-2 no membership lock on a settings read.
async function issued() {
  const f = await realOperation();
  const orderId = `ORD${randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}`;
  sql(`update public.provider_operations set state = 'succeeded', provider_env = 'sandbox', provider_order_id = '${orderId}', credential_version = 1 where id = '${f.op}';
       update public.shipments set submission_state = 'issued', awb = 'JP${orderId.slice(3)}', issued_at = now() - interval '3 hours' where id = '${f.shipment}';`);
  return { ...f, orderId };
}
const ingest = (p: Record<string, unknown>) => machine().rpc("ingest_provider_status", { p_env: "sandbox", p_source: "webhook", p_awb: null, ...p });
const ts = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString();
const row = (shipment: string) => JSON.parse(sql(`select json_build_object('state', delivery_state, 'kind', provider_status_kind) from public.shipments where id = '${shipment}'`));
const begin = (f: { tenant: string; shipment: string }) => machine().rpc("cancel_begin", { p_tenant: f.tenant, p_env: "sandbox", p_shipment: f.shipment });
const mark = (f: { tenant: string; shipment: string }) => machine().rpc("cancel_mark_sent", { p_tenant: f.tenant, p_env: "sandbox", p_shipment: f.shipment });
const release = (f: { tenant: string; shipment: string }) => machine().rpc("cancel_release", { p_tenant: f.tenant, p_env: "sandbox", p_shipment: f.shipment });
const cancelState = (shipment: string) => sql(`select coalesce(cancel_state, '-') from public.shipments where id = '${shipment}'`);
const FENCE = "private.provider_mutation_fence";

afterEach(() => sql(`update ${FENCE} set engaged = false, cluster_identity = private.provider_cluster_identity()`));

describe("delivery_state follows the provider status (P1-1)", () => {
  it("moves forward, never regresses a final state, and ignores kinds without a delivery meaning", async () => {
    const f = await issued();
    const call = (status: string, minutesAgo: number) => ingest({ p_tenant: f.tenant, p_provider_ts: ts(minutesAgo), p_order_id: f.orderId, p_status: status });
    expect((await call("PENDING PICKUP", 50)).data).toBe("applied");
    expect(row(f.shipment)).toEqual({ state: "unobserved", kind: "awaiting_pickup" });
    expect((await call("ON DELIVERY", 40)).data).toBe("applied");
    expect(row(f.shipment)).toEqual({ state: "in_transit", kind: "in_transit" });
    expect((await call("RTS", 30)).data).toBe("applied");
    expect(row(f.shipment)).toEqual({ state: "returned", kind: "returned" });
    // Final: a later status is history only; delivery_state stays returned.
    expect((await call("DELIVERED", 10)).data).toBe("final");
    expect(row(f.shipment)).toEqual({ state: "returned", kind: "returned" });
    const d = await issued();
    expect((await ingest({ p_tenant: d.tenant, p_provider_ts: ts(5), p_order_id: d.orderId, p_status: "DELIVERED" })).data).toBe("applied");
    expect(row(d.shipment)).toEqual({ state: "delivered", kind: "delivered" });
  });

  it("an older (stale) status never moves delivery_state back", async () => {
    const f = await issued();
    await ingest({ p_tenant: f.tenant, p_provider_ts: ts(10), p_order_id: f.orderId, p_status: "UNDELIVERED" });
    expect(row(f.shipment).state).toBe("problem");
    expect((await ingest({ p_tenant: f.tenant, p_provider_ts: ts(20), p_order_id: f.orderId, p_status: "ON DELIVERY" })).data).toBe("stale");
    expect(row(f.shipment).state).toBe("problem");
  });
});

describe("cancel pre-send key failure and the restore fence (P1-2)", () => {
  it("releases a decision that sent nothing back to NULL, so the next decision may send", async () => {
    const f = await issued();
    expect((await begin(f)).data[0].action).toBe("send");
    expect(cancelState(f.shipment)).toBe("requested");
    expect((await release(f)).data).toBe(true);
    expect(cancelState(f.shipment)).toBe("-");
    expect(sql(`select attempts from private.shipment_cancellations where shipment_id = '${f.shipment}'`)).toBe("0");
    expect((await begin(f)).data[0].action).toBe("send");
  });

  it("never releases once the DELETE was marked as sent, nor a legacy pending decision", async () => {
    const f = await issued();
    await begin(f);
    expect((await mark(f)).error).toBeNull();
    expect((await release(f)).data).toBe(false);
    expect(cancelState(f.shipment)).toBe("requested");
    expect((await begin(f)).data[0].action).toBe("readback");
    // cancel_mark_sent only applies to a pending decision.
    const idle = await issued();
    expect((await mark(idle)).error?.message).toBe("stale_state");
    expect((await release(idle)).data).toBe(false);
  });

  it("is refused under the post-restore fence, writes nothing, and read-back stays possible", async () => {
    const pending = await issued();
    await begin(pending);
    const fresh = await issued();
    sql(`update ${FENCE} set cluster_identity = 'restored-from-backup:0:0:1', engaged = false`);
    expect((await begin(fresh)).error?.message).toBe("provider_fence_engaged");
    expect(cancelState(fresh.shipment)).toBe("-");
    expect((await mark(pending)).error?.message).toBe("provider_fence_engaged");
    expect((await begin(pending)).data[0].action).toBe("readback");
  });

  it("cancel_release and cancel_mark_sent are machine-only", async () => {
    for (const fn of ["cancel_release", "cancel_mark_sent"]) {
      expect(sql(`select has_function_privilege('authenticated', 'public.${fn}(uuid,text,uuid)', 'execute')`)).toBe("f");
      expect(sql(`select has_function_privilege('service_role', 'public.${fn}(uuid,text,uuid)', 'execute')`)).toBe("t");
    }
  });
});

describe("stored Partner ID reader (P1-3)", () => {
  it("returns the Super Admin's stored value to the machine only, null when none", async () => {
    const before = sql(`select value::text from private.settings where key = 'mengantar_partner_id'`);
    try {
      sql(`update private.settings set value = '"gx-wave-x-partner"'::jsonb where key = 'mengantar_partner_id'`);
      expect((await machine().rpc("machine_partner_id")).data).toBe("gx-wave-x-partner");
      sql(`update private.settings set value = 'null'::jsonb where key = 'mengantar_partner_id'`);
      expect((await machine().rpc("machine_partner_id")).data).toBeNull();
    } finally {
      sql(`update private.settings set value = '${before}'::jsonb where key = 'mengantar_partner_id'`);
    }
    expect(sql(`select has_function_privilege('authenticated', 'public.machine_partner_id()', 'execute')`)).toBe("f");
  });
});

describe("role rechecked under the row locks (P2-2) and no lock on a settings read (P3-2)", () => {
  const def = (fn: string) => sql(`select pg_get_functiondef('${fn}'::regprocedure)`);
  it("close_failed_operation locks memberships FOR SHARE after the shipment and rechecks admin", () => {
    const body = def("public.close_failed_operation(uuid,text)");
    const shipments = body.indexOf("from public.shipments where tenant_id = v_tenant and id = p_shipment for update");
    const share = body.indexOf("from public.memberships where tenant_id = v_tenant and user_id = (select auth.uid()) for share");
    expect(shipments).toBeGreaterThan(body.indexOf("from public.provider_operations"));
    expect(share).toBeGreaterThan(shipments);
    expect(body.indexOf("require_member(v_tenant) <> 'tenant_admin'", share)).toBeGreaterThan(share);
  });
  it("record_label_print locks the shipment, then memberships FOR SHARE, then rechecks membership", () => {
    const body = def("public.record_label_print(uuid,boolean)");
    const lock = body.indexOf("lock_member_shipment(v.shipment_id)");
    const share = body.indexOf("from public.memberships where tenant_id = v.tenant_id and user_id = (select auth.uid()) for share");
    expect(lock).toBeGreaterThan(-1);
    expect(share).toBeGreaterThan(lock);
    expect(body.indexOf("require_member(v.tenant_id)", share)).toBeGreaterThan(share);
  });
  it("webhook_endpoint_status takes the membership lock only when it has to create the endpoint", () => {
    const body = def("public.webhook_endpoint_status(uuid,text)");
    expect(body.indexOf("require_tenant_admin_locked")).toBeGreaterThan(body.indexOf("if not exists"));
    expect(body.indexOf("member_role(p_tenant)")).toBeLessThan(body.indexOf("if not exists"));
  });
});

describe("pickup time ids are scoped to the operation's environment (P2-6)", () => {
  it("another environment's id is not 'known' to this operation", async () => {
    const first = await realOperation();
    const outlet = sql(`select outlet_id from public.shipments where id = '${first.shipment}'`);
    const second = await realOperation({ tenant: first.tenant, outlet });
    const TIME_ID = "6b0c2a1e9d3f4a5b6c7d8e91";
    try {
      sql(`update public.provider_operations set provider_env = 'sandbox', pickup_phase = 'reserved', pickup_time_id = '${TIME_ID}' where id = '${first.op}';
           update public.provider_operations set provider_env = 'production' where id = '${second.op}'`);
      expect((await machine().rpc("dispatch_pickup_known_time_ids", { p_operation: second.op })).data).toEqual([]);
      sql(`update public.provider_operations set provider_env = 'sandbox' where id = '${second.op}'`);
      expect((await machine().rpc("dispatch_pickup_known_time_ids", { p_operation: second.op })).data).toEqual([TIME_ID]);
    } finally {
      sql(`update public.shipments set selected_quote_id = null where tenant_id = '${first.tenant}'; delete from public.tenants where id = '${first.tenant}'`);
    }
  });
});

describe("unknown money is never coalesced to a tariff or zero (P2-5)", () => {
  const def = (fn: string) => sql(`select pg_get_functiondef('${fn}'::regprocedure)`);
  it("batch review/payload drop the tariff and zero fallbacks and refuse an unknown member charge", () => {
    for (const fn of ["private.compute_unpaid_batch(uuid,uuid,boolean)", "private.batch_attempt_payload(private.batch_payment_attempts,text)"]) {
      const body = def(fn);
      expect(body, fn).not.toMatch(/coalesce\(sh\.customer_charge_idr, sq\.customer_charge_idr, sq\.normal_tariff_idr/);
      expect(body, fn).toContain("coalesce(sh.customer_charge_idr, sq.customer_charge_idr)");
      expect(body, fn).toMatch(/v_unknown/);
    }
  });
  it("platform_tenant_summary reports an unknown 30-day charge as null with the unknown count", () => {
    const body = def("public.platform_tenant_summary(uuid)");
    expect(body).toContain("charge_unknown_30_days");
    expect(body).toMatch(/customer_charge_idr is null\) > 0\s+then null/);
  });
});
