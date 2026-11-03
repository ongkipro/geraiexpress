// T-080 / PR-43 / DATA-14: non-COD cargo through record_live_quotes, confirm_shipment and the real
// dispatcher with OFFLINE provider replies. The only network destination is disposable PostgREST.
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { dispatchOperation } from "../../src/lib/mengantar/dispatcher";
import { machine, realOperation, signIn, sql } from "./helpers";

const origin = { p_origin_area_id: "5fc62f60f8f44b34aa4c0dcd", p_origin_address_id: "6acf44a4771fe2b474c055ca" };
const fixture = (name: string) => JSON.parse(readFileSync(new URL(`../unit/fixtures/mengantar/${name}`, import.meta.url), "utf8"));
const cargoRule = (courier: string) => sql(`select id from private.billable_weight_rules where courier = '${courier}'
  and service_class = 'cargo' and min_weight_grams is not null order by effective_at desc limit 1`);
const regularRule = (courier: string) => sql(`select id from private.billable_weight_rules where courier = '${courier}'
  and service_class = 'regular' order by effective_at desc limit 1`);

const extraMembers = new Set<string>();
afterEach(() => {
  for (const tenant of extraMembers) sql(`delete from public.memberships where tenant_id = '${tenant}' and user_id = '00000000-0000-4000-a000-0000000000a1'`);
  extraMembers.clear();
});

// A 12 kg parcel without dimensions: billable weight is the exact actual weight for every rule.
async function draft(isCod = false) {
  const f = await realOperation();
  extraMembers.add(f.tenant);
  sql(`delete from public.provider_operations where id = '${f.op}';
    insert into public.memberships (tenant_id, user_id, role) values ('${f.tenant}', '00000000-0000-4000-a000-0000000000a1', 'tenant_admin');
    update public.shipments set submission_state = 'draft' where id = '${f.shipment}';
    update public.shipments set sender_name = 'Pengirim Uji', sender_phone = '081234567890',
      recipient_area = 'Wilayah Uji', weight_grams = 12000, length_cm = null, width_cm = null, height_cm = null,
      is_cod = ${isCod}, goods_value_idr = 150000 where id = '${f.shipment}';`);
  const revision = Number(sql(`select revision from public.shipments where id = '${f.shipment}'`));
  return { ...f, revision, args: { ...origin, p_tenant: f.tenant, p_shipment: f.shipment, p_expected_revision: revision } };
}
const cargoRow = (courier = "JNE", over: Record<string, unknown> = {}) => ({ courier, service_class: "cargo", minimum_weight_grams: 10000,
  tariff: 45000, net: 42750, billable_weight_grams: 12000, weight_rule_id: cargoRule(courier), ...over });

describe("non-COD cargo (T-080)", () => {
  it("seeds sourced min/max cargo versions for JNE, SiCepat and iDexpress only, keeping SAP unverified", () => {
    const rows = JSON.parse(sql(`select jsonb_object_agg(courier, jsonb_build_array(min_weight_grams, max_weight_grams, source_updated_at))
      from private.billable_weight_rules where service_class = 'cargo' and min_weight_grams is not null`));
    expect(rows).toEqual({ JNE: [10000, 30000, "2026-09-24"], SiCepat: [10000, 50000, "2026-09-24"], iDexpress: [10000, 70000, "2026-09-24"] });
    expect(sql(`select count(*) from private.billable_weight_rules where courier = 'Sap' and service_class = 'cargo' and min_weight_grams is not null`)).toBe("0");
  });

  it("stores a cargo quote beside the same courier's regular quote, then confirms and dispatches orders[].cargo", async () => {
    const f = await draft();
    const recorded = await machine().rpc("record_live_quotes", { ...f.args, p_rows: [
      { courier: "JNE", tariff: 140000, net: 112000, billable_weight_grams: 12000, weight_rule_id: regularRule("JNE") }, cargoRow()] });
    expect(recorded.error).toBeNull();
    expect(recorded.data).toBe(2);
    const quotes = JSON.parse(sql(`select jsonb_object_agg(service_class, jsonb_build_array(service, normal_tariff_idr, cod_supported))
      from public.shipment_quotes where shipment_id = '${f.shipment}' and expires_at > now()`));
    // Legacy rows without cod_supported inherit the (non-COD) shipment; cargo is never COD-capable.
    expect(quotes).toEqual({ regular: ["Reguler", 140000, false], cargo: ["Kargo", 45000, false] });
    const quote = sql(`select id from public.shipment_quotes where shipment_id = '${f.shipment}' and service_class = 'cargo' and expires_at > now()`);
    const owner = await signIn("owner-a@geraiexpress.test");
    const confirmed = await owner.rpc("confirm_shipment", { p_shipment: f.shipment, p_quote: quote, p_expected_revision: f.revision, p_idempotency_key: randomUUID(), p_declaration_version: 1 });
    expect(confirmed.error).toBeNull();
    expect(JSON.parse(sql(`select weight_snapshot from public.shipments where id = '${f.shipment}'`))).toMatchObject({ service_class: "cargo", billable_weight_grams: 12000 });

    let sent: { courier: string; orders: Record<string, unknown>[] } | null = null;
    const result = await dispatchOperation(confirmed.data.operation_id, {
      rpc: (fn, args) => machine().rpc(fn, args), environment: "sandbox", credentialKey: Buffer.alloc(32, 7).toString("base64"),
      fetchImpl: (async (url, init) => {
        if (String(url).endsWith("/address")) return Response.json(fixture("address-list-sandbox.json"));
        sent = JSON.parse(String(init?.body));
        const reply = fixture("order-create-jt-issued.json");
        Object.assign(reply.data[0], { destinationMark: sql(`select reference from public.shipments where id = '${f.shipment}'`), cargo: true, estimatedPrice: 45000 });
        return Response.json(reply);
      }) as typeof fetch,
    });
    expect(result).toEqual({ status: "recorded", outcome: "issued" });
    expect(sent!.courier).toBe("JNE");
    expect(sent!.orders[0]).toMatchObject({ cargo: true, weight: 12, goodsValue: 150000 });
    expect(sent!.orders[0]).not.toHaveProperty("COD");
  });

  it("refuses cargo rows for COD, unsupported couriers, missing/mismatched route minimum and wrong-class rules", async () => {
    const f = await draft();
    const bad = async (row: Record<string, unknown>) => (await machine().rpc("record_live_quotes", { ...f.args, p_rows: [row] })).error?.message;
    expect(await bad(cargoRow("JT", { weight_rule_id: cargoRule("JNE") }))).toBe("invalid_input");
    expect(await bad(cargoRow("JNE", { minimum_weight_grams: undefined }))).toBe("invalid_input");
    expect(await bad(cargoRow("JNE", { weight_rule_id: undefined }))).toBe("invalid_input");
    expect(await bad(cargoRow("JNE", { minimum_weight_grams: 5000 }))).toBe("invalid_weight_rule");
    expect(await bad(cargoRow("JNE", { weight_rule_id: regularRule("JNE") }))).toBe("invalid_weight_rule");
    expect(await bad(cargoRow("JNE", { service_class: "express" }))).toBe("invalid_input");
    // SAP has only the evidence row (no verified minimum): the row is refused, never priced.
    expect(await bad(cargoRow("Sap", { weight_rule_id: sql(`select id from private.billable_weight_rules where courier = 'Sap' and service_class = 'cargo' limit 1`) }))).toBe("invalid_weight_rule");
    const cod = await draft(true);
    expect((await machine().rpc("record_live_quotes", { ...cod.args, p_rows: [cargoRow()] })).error?.message).toBe("invalid_input");
  });

  it("excludes cargo outside its sourced weight range with a named reason, keeping regular", async () => {
    const f = await draft();
    sql(`update public.shipments set weight_grams = 8000 where id = '${f.shipment}'`);
    const revision = Number(sql(`select revision from public.shipments where id = '${f.shipment}'`));
    const result = await machine().rpc("record_live_quotes", { ...f.args, p_expected_revision: revision, p_rows: [
      { courier: "JNE", tariff: 90000, net: 72000, billable_weight_grams: 8000, weight_rule_id: regularRule("JNE") },
      cargoRow("JNE", { billable_weight_grams: 8000 })] });
    expect(result.error).toBeNull();
    expect(result.data).toBe(1);
    expect(sql(`select detail from public.shipment_events where shipment_id = '${f.shipment}' and kind = 'quote_weight_excluded'`)).toBe("JNE Kargo: min_weight_not_met");
  });

  it("the table itself refuses a cargo quote with COD support or a COD fee", async () => {
    const f = await draft();
    expect(() => sql(`insert into public.shipment_quotes (tenant_id, shipment_id, shipment_revision, courier, service, normal_tariff_idr,
      cod_supported, cod_fee_idr, customer_charge_idr, eta_days, is_simulated, expires_at, service_class)
      values ('${f.tenant}', '${f.shipment}', ${f.revision}, 'JNE', 'Kargo', 45000, true, 1000, 46000, '3 hari', false, now() + interval '5 minutes', 'cargo')`)).toThrow();
  });
});
