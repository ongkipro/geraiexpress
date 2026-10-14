// T-023: outlet Mengantar pickup (tenant admin only) and live quotes written by the machine
// identity only; the seller key is readable only by the machine identity.
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { IDS, client, demoVisitor, machine, realOperation, signIn, sql } from "./helpers";

const PICKUP = { p_address_id: "6acf44a4771fe2b474c055ca", p_area_id: "5fc62f60f8f44b34aa4c0dcd", p_address: "Jl. Uji Sandbox No. 1", p_area: "MELAWAI, KEBAYORAN BARU, JAKARTA SELATAN" };

describe("outlet Mengantar pickup (T-023)", () => {
  it("only a tenant admin of a real gerai sets it, with valid ids, and it is audited", async () => {
    const before = sql(`select coalesce(pickup_address,'') || '|' || coalesce(pickup_area,'') from public.outlets where id = '${IDS.outletA}'`);
    try {
      for (const c of [await signIn("operator-a@geraiexpress.test"), await signIn("owner-b@geraiexpress.test"), client()]) {
        expect((await c.rpc("set_outlet_mengantar_pickup", { p_outlet: IDS.outletA, ...PICKUP })).error).not.toBeNull();
      }
      const owner = await signIn("owner-a@geraiexpress.test");
      expect((await owner.rpc("set_outlet_mengantar_pickup", { p_outlet: IDS.outletA, ...PICKUP, p_area_id: "nope" })).error?.message).toBe("invalid_input");
      expect((await owner.rpc("set_outlet_mengantar_pickup", { p_outlet: IDS.outletA, ...PICKUP })).error).toBeNull();
      expect(sql(`select mengantar_pickup_address_id || '|' || mengantar_area_id || '|' || pickup_area from public.outlets where id = '${IDS.outletA}'`))
        .toBe(`${PICKUP.p_address_id}|${PICKUP.p_area_id}|${PICKUP.p_area}`);
      expect(sql(`select count(*) from public.audit_events where action = 'outlet.mengantar_pickup' and target_tenant = '${IDS.tenantA}'`)).not.toBe("0");
      const demo = await demoVisitor();
      expect((await demo.c.rpc("set_outlet_mengantar_pickup", { p_outlet: demo.outlet, ...PICKUP })).error?.message).toBe("demo_restricted");
    } finally {
      const [address, area] = before.split("|");
      sql(`update public.outlets set mengantar_pickup_address_id = null, mengantar_area_id = null,
        pickup_address = nullif('${address}', ''), pickup_area = nullif('${area}', '') where id = '${IDS.outletA}'`);
    }
  });
});

describe("a new or removed seller key clears the outlet pickup (T-023 review)", () => {
  it("the old account's pickup is not reused with another account", async () => {
    const f = await realOperation();
    const outlet = sql(`select id from public.outlets where tenant_id = '${f.tenant}' limit 1`);
    const ids = () => sql(`select coalesce(mengantar_pickup_address_id, '-') || '|' || coalesce(mengantar_area_id, '-') from public.outlets where id = '${outlet}'`);
    expect(ids()).toBe("6acf44a4771fe2b474c055ca|5fc62f60f8f44b34aa4c0dcd");
    sql(`update private.seller_credentials set superseded_at = now(), ciphertext = null, iv = null where tenant_id = '${f.tenant}' and superseded_at is null`);
    expect(ids()).toBe("-|-");
    sql(`update public.outlets set mengantar_pickup_address_id = '6acf44a4771fe2b474c055ca', mengantar_area_id = '5fc62f60f8f44b34aa4c0dcd' where id = '${outlet}';
      insert into private.seller_credentials (tenant_id, mode, ciphertext, iv, key_version, hint, version)
      values ('${f.tenant}', 'byok', 'bmV3LWNpcGhlcnRleHQtMTIzNDU2', 'aXYtMTIzNDU2Nzg=', 'v1', 'NEW', 2)`);
    expect(ids()).toBe("-|-");
  });
});

describe("machine-only seller key read and live quotes (DEC-010)", () => {
  it("users cannot read the sealed key or write quotes; the machine can", async () => {
    const f = await realOperation();
    sql(`update public.shipments set submission_state = 'draft' where id = '${f.shipment}'`);
    const rev = Number(sql(`select revision from public.shipments where id = '${f.shipment}'`));
    const rows = [{ courier: "JT", tariff: 9000, net: 6300, eta: "1 - 2 days" }];
    for (const c of [client(), await signIn("owner-a@geraiexpress.test"), (await demoVisitor()).c]) {
      expect((await c.rpc("machine_seller_key", { p_tenant: f.tenant })).error).not.toBeNull();
      expect((await c.rpc("record_live_quotes", { p_tenant: f.tenant, p_shipment: f.shipment, p_expected_revision: rev, p_rows: rows })).error).not.toBeNull();
    }
    const key = await machine().rpc("machine_seller_key", { p_tenant: f.tenant });
    expect(key.data).toMatchObject({ version: 1, key_version: "v1" });
    expect((await machine().rpc("machine_seller_key", { p_tenant: (await demoVisitor()).tenant })).data).toBeNull();
    expect((await machine().rpc("machine_seller_key", { p_tenant: randomUUID() })).data).toBeNull();
  });

  it("records live quotes for the current revision only, keeps net cost private, and replaces older quotes", async () => {
    const f = await realOperation();
    sql(`update public.shipments set submission_state = 'draft' where id = '${f.shipment}'`);
    const rev = Number(sql(`select revision from public.shipments where id = '${f.shipment}'`));
    const m = machine();
    const rows = [{ courier: "JT", tariff: 9000, net: 6300, eta: "1 - 2 days" }, { courier: "spx", tariff: 8700, net: 5655, eta: "" }];
    expect((await m.rpc("record_live_quotes", { p_tenant: f.tenant, p_shipment: f.shipment, p_expected_revision: rev + 1, p_rows: rows })).error?.message).toBe("stale_revision");
    expect((await m.rpc("record_live_quotes", { p_tenant: IDS.tenantB, p_shipment: f.shipment, p_expected_revision: rev, p_rows: rows })).error?.message).toBe("not_found");
    for (const bad of [[{ courier: "JT", tariff: 0, net: 0 }], [{ courier: "JT", tariff: 9000, net: 9001 }], [{ courier: "J T!", tariff: 9000, net: 1 }], [{ courier: "JT", tariff: "9000; drop", net: 1 }]]) {
      expect((await m.rpc("record_live_quotes", { p_tenant: f.tenant, p_shipment: f.shipment, p_expected_revision: rev, p_rows: bad })).error?.message).toBe("invalid_input");
    }
    expect((await m.rpc("record_live_quotes", { p_tenant: f.tenant, p_shipment: f.shipment, p_expected_revision: rev, p_rows: rows })).data).toBe(2);
    expect(sql(`select string_agg(courier || ':' || normal_tariff_idr || ':' || eta_days || ':' || is_simulated, ',' order by normal_tariff_idr)
      from public.shipment_quotes where shipment_id = '${f.shipment}' and expires_at > now()`)).toBe("spx:8700:—:false,JT:9000:1 - 2 days:false");
    expect(sql(`select string_agg(c.net_shipping_idr::text, ',' order by c.net_shipping_idr) from private.quote_costs c
      join public.shipment_quotes q on q.id = c.quote_id where q.shipment_id = '${f.shipment}'`)).toBe("5655,6300");
    expect(sql(`select submission_state from public.shipments where id = '${f.shipment}'`)).toBe("estimated");
    // A second live estimate retires the first set; only one current set remains.
    expect((await m.rpc("record_live_quotes", { p_tenant: f.tenant, p_shipment: f.shipment, p_expected_revision: rev, p_rows: rows.slice(0, 1) })).data).toBe(1);
    expect(sql(`select count(*) from public.shipment_quotes where shipment_id = '${f.shipment}' and expires_at > now()`)).toBe("1");
    // No route: zero rows leave the draft unquoted.
    expect((await m.rpc("record_live_quotes", { p_tenant: f.tenant, p_shipment: f.shipment, p_expected_revision: rev, p_rows: [] })).data).toBe(0);
    expect(sql(`select submission_state from public.shipments where id = '${f.shipment}'`)).toBe("draft");
    // Submitted shipments and demo tenants are refused.
    sql(`update public.shipments set submission_state = 'queued' where id = '${f.shipment}'`);
    expect((await m.rpc("record_live_quotes", { p_tenant: f.tenant, p_shipment: f.shipment, p_expected_revision: rev, p_rows: rows })).error?.message).toBe("shipment_locked");
    const demo = await demoVisitor();
    const { data: draft } = await demo.c.rpc("create_shipment_draft", { p_outlet: demo.outlet });
    expect((await m.rpc("record_live_quotes", { p_tenant: demo.tenant, p_shipment: draft, p_expected_revision: 1, p_rows: rows })).error?.message).toBe("demo_restricted");
  });

  it("members still cannot read net cost through the Data API", async () => {
    const owner = await signIn("owner-a@geraiexpress.test");
    expect((await owner.schema("private" as "public").from("quote_costs").select("*")).error).not.toBeNull();
  });
});
