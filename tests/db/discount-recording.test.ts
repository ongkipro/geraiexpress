// T-053 / DATA-9: the provider's discount is stored per quote (private.quote_costs.provider_discount_bps)
// and is the observed value when present; the amount-derived value of T-041 stays the fallback for
// rows without it. record_live_quotes keeps its signature and reads an optional `discount_bps` per row.
// Also: platform_tenant_masking, the read side of the platform masking control.
import { randomUUID } from "node:crypto";
import type { TestClient } from "./helpers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { client, machine, realOperation, signIn, signInAal2, sql } from "./helpers";

const AREA = "5fc62f60f8f44b34aa4c0dcd";
const ADDRESS = "6acf44a4771fe2b474c055ca";
const OWNER_A = "00000000-0000-4000-a000-0000000000a1";

let admin: TestClient;
let owner: TestClient;
let tenant: string;
let shipment: string;
const today = () => sql(`select (now() at time zone 'Asia/Jakarta')::date`);

const revision = () => Number(sql(`select revision from public.shipments where id = '${shipment}'`));
const record = (rows: unknown) =>
  machine().rpc("record_live_quotes", {
    p_tenant: tenant, p_shipment: shipment, p_expected_revision: revision(), p_rows: rows,
    p_origin_area_id: AREA, p_origin_address_id: ADDRESS,
  });
const costOf = (courier: string) =>
  sql(`select coalesce(c.provider_discount_bps::text, 'NULL') from public.shipment_quotes q join private.quote_costs c on c.quote_id = q.id
    where q.shipment_id = '${shipment}' and q.courier = '${courier}' and q.expires_at > now()`);
const observedByCourier = () =>
  sql(`select coalesce(string_agg(courier || '=' || observed_bps, ',' order by courier), '') from private.latest_observed_batch('${tenant}')`);
const ceiling = () => sql(`select coalesce(observed_bps::text, 'NULL') from private.latest_observed_discount('${tenant}')`);

beforeAll(async () => {
  const f = await realOperation();
  tenant = f.tenant;
  shipment = f.shipment;
  sql(`insert into public.memberships (tenant_id, user_id, role) values ('${tenant}', '${OWNER_A}', 'tenant_admin');
    delete from public.provider_operations where id = '${f.op}';
    update public.shipments set submission_state = 'draft', selected_quote_id = null, pickup_snapshot = null where id = '${shipment}';
    update public.shipments set sender_name = 'Pengirim', sender_phone = '081234567890', recipient_area = 'Wilayah Tujuan' where id = '${shipment}';
    update public.outlets set pickup_address = 'Jl. Pickup A No. 1', pickup_area = 'Wilayah A' where tenant_id = '${tenant}'`);
  admin = await signInAal2("admin@geraiexpress.test");
  owner = await signIn("owner-a@geraiexpress.test");
});

afterAll(() => {
  sql(`begin; set local session_replication_role = replica;
    delete from public.gerai_discount_terms where tenant_id = '${tenant}';
    commit;
    update public.shipments set selected_quote_id = null where tenant_id = '${tenant}';
    delete from public.shipments where tenant_id = '${tenant}'; delete from public.tenants where id = '${tenant}'`);
});

describe("provider_discount_bps recording (DATA-9)", () => {
  it("record_live_quotes keeps its six-argument signature and stores a present value, a present zero and unknown apart", async () => {
    expect(sql(`select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'record_live_quotes'`)).toBe("1");
    expect(sql(`select pg_get_function_identity_arguments(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'record_live_quotes'`))
      .toBe("p_tenant uuid, p_shipment uuid, p_expected_revision integer, p_rows jsonb, p_origin_area_id text, p_origin_address_id text");
    const result = await record([
      { courier: "JT", tariff: 12345, net: 9568, discount_bps: 2250, eta: "1-2" },
      { courier: "JNE", tariff: 10000, net: 7000, eta: "1-2" }, // field absent
      { courier: "SiCepat", tariff: 10000, net: 8000, discount_bps: null, eta: "1-2" }, // JSON null
      { courier: "Sap", tariff: 10000, net: 9000, discount_bps: 0, eta: "1-2" }, // a real 0%
    ]);
    expect(result.error).toBeNull();
    expect(result.data).toBe(4);
    expect([costOf("JT"), costOf("JNE"), costOf("SiCepat"), costOf("Sap")]).toEqual(["2250", "NULL", "NULL", "0"]);
  });

  it("refuses a malformed or out-of-range discount_bps and writes nothing", async () => {
    const before = sql(`select count(*) from public.shipment_quotes where shipment_id = '${shipment}'`);
    for (const bad of [10001, -1, 22.5, "2250", "x", true, {}, [], 100000]) {
      const result = await record([{ courier: "JT", tariff: 10000, net: 7000, discount_bps: bad, eta: "1-2" }]);
      expect(result.error?.message, JSON.stringify(bad)).toBe("invalid_input");
    }
    expect(sql(`select count(*) from public.shipment_quotes where shipment_id = '${shipment}'`)).toBe(before);
    expect(() => sql(`insert into private.quote_costs (tenant_id, quote_id, net_shipping_idr, provider_discount_bps)
      select tenant_id, id, 1, 10001 from public.shipment_quotes where shipment_id = '${shipment}' limit 1`)).toThrow();
  });
});

describe("observed discount source (provider value first, amount-derived fallback)", () => {
  it("uses provider_discount_bps when present and the ceil-derived value otherwise, per courier within the latest batch", async () => {
    const result = await record([
      { courier: "JNE", tariff: 10000, net: 7000, eta: "1-2" }, // derived 3000
      { courier: "JT", tariff: 10000, net: 7000, discount_bps: 2500, eta: "1-2" }, // provider 2500 beats derived 3000
      { courier: "SiCepat", tariff: 10000, net: 8000, discount_bps: null, eta: "1-2" }, // derived 2000
      { courier: "Sap", tariff: 10000, net: 9000, discount_bps: 0, eta: "1-2" }, // present 0, not the derived 1000
    ]);
    expect(result.error).toBeNull();
    expect(observedByCourier()).toBe("JNE=3000,JT=2500,Sap=0,SiCepat=2000");
    // the assignment ceiling is still the batch MAXIMUM
    expect(ceiling()).toBe("3000");
  });

  it("rows without a provider value keep exactly the T-041 derived result, including after the column is cleared", () => {
    const q = sql(`select q.id from public.shipment_quotes q where q.shipment_id = '${shipment}' and q.courier = 'JT' and q.expires_at > now()`);
    expect(sql(`select observed_bps from private.quote_observed_discount where quote_id = '${q}'`)).toBe("2500");
    sql(`update private.quote_costs set provider_discount_bps = null where quote_id = '${q}'`);
    expect(sql(`select observed_bps from private.quote_observed_discount where quote_id = '${q}'`)).toBe(
      sql("select private.observed_discount_bps(10000, 7000)"));
    expect(sql(`select observed_bps from private.quote_observed_discount where quote_id = '${q}'`)).toBe("3000");
    // old-style row: no provider value, no known net cost -> still no observation
    const old = randomUUID();
    sql(`insert into public.shipment_quotes (tenant_id, shipment_id, id, shipment_revision, courier, service, normal_tariff_idr,
        eta_days, is_simulated, quoted_at, expires_at)
        values ('${tenant}', '${shipment}', '${old}', 1, 'Lion', 'Reguler', 9000, '1-2', false, now() - interval '1 day', now() - interval '1 day');
      insert into private.quote_costs (tenant_id, quote_id, net_shipping_idr) values ('${tenant}', '${old}', null)`);
    expect(sql(`select observed_bps is null from private.quote_observed_discount where quote_id = '${old}'`)).toBe("t");
    sql(`delete from public.shipment_quotes where id = '${old}'`);
  });

  it("makes the provider value the assignment ceiling: above it is refused, equal to it is provider_observed", async () => {
    const result = await record([{ courier: "JT", tariff: 10000, net: 7000, discount_bps: 2500, eta: "1-2" }]);
    expect(result.error).toBeNull();
    // the amounts alone would observe 3000; the provider said 2500
    expect(ceiling()).toBe("2500");
    const set = (bps: number, status: string) => admin.rpc("platform_set_gerai_discount", {
      p_tenant: tenant, p_expected_version: Number(sql(`select coalesce(max(version), 0) from public.gerai_discount_terms where tenant_id = '${tenant}'`)),
      p_bps: bps, p_effective: today(), p_status: status, p_source: "Uji pencatatan diskon", p_verification: null, p_reason: "Uji ceiling dari persen Mengantar",
    });
    const above = await set(2800, "owner_stated");
    expect(above.error?.message).toBe("discount_above_observed");
    expect(above.error?.details).toContain("observed_bps=2500");
    expect((await set(2500, "provider_observed")).error).toBeNull();
  });

  it("gerai_cost_for_quote is unchanged for the amounts: capped by the quote's own derived observation, NULL when unknown", async () => {
    // terms in force are 2500 bps (created now): age them so the quotes below fall under them
    sql(`begin; set local session_replication_role = replica;
      update public.gerai_discount_terms set created_at = created_at - interval '1 day', effective_from = effective_from - interval '1 day' where tenant_id = '${tenant}';
      commit`);
    expect((await record([
      { courier: "JNE", tariff: 10000, net: 7000, eta: "1-2" },
      { courier: "JT", tariff: 10000, net: 7000, discount_bps: 2500, eta: "1-2" },
    ])).error).toBeNull();
    const idOf = (courier: string) => sql(`select id from public.shipment_quotes where shipment_id = '${shipment}' and courier = '${courier}' and expires_at > now()`);
    // 10000 - floor(10000 * 2500 / 10000) = 7500 for both, whatever the provider percent says
    expect((await owner.rpc("gerai_cost_for_quote", { p_tenant: tenant, p_quote: idOf("JNE") })).data).toBe(7500);
    expect((await owner.rpc("gerai_cost_for_quote", { p_tenant: tenant, p_quote: idOf("JT") })).data).toBe(7500);
    // unknown net cost stays NULL (never 0)
    const unknown = randomUUID();
    sql(`insert into public.shipment_quotes (tenant_id, shipment_id, id, shipment_revision, courier, service, normal_tariff_idr,
        eta_days, is_simulated, expires_at) values ('${tenant}', '${shipment}', '${unknown}', 1, 'Pos', 'Reguler', 9000, '1-2', false, now() + interval '1 hour');
      insert into private.quote_costs (tenant_id, quote_id, net_shipping_idr, provider_discount_bps) values ('${tenant}', '${unknown}', null, 2000)`);
    const { data, error } = await owner.rpc("gerai_cost_for_quote", { p_tenant: tenant, p_quote: unknown });
    expect(error).toBeNull();
    expect(data).toBeNull();
  });
});

describe("platform_tenant_masking", () => {
  it("is readable only with tenant_governance at aal2 and reports the current flag and the last audited change", async () => {
    expect((await client().rpc("platform_tenant_masking", { p_tenant: tenant })).error).not.toBeNull();
    for (const [who, c] of Object.entries({ owner, aal1: await signIn("admin@geraiexpress.test") })) {
      expect((await c.rpc("platform_tenant_masking", { p_tenant: tenant })).error?.message, who).toBe("platform_access_required");
    }
    const first = await admin.rpc("platform_tenant_masking", { p_tenant: tenant });
    expect(first.error).toBeNull();
    expect(first.data).toEqual([expect.objectContaining({ masking_allowed: true, last_changed_at: null, last_outcome: null })]);
    expect((await admin.rpc("platform_set_masking_allowed", { p_tenant: tenant, p_allowed: false, p_reason: "Pemberitahuan kurir" })).data).toBe(false);
    const after = await admin.rpc("platform_tenant_masking", { p_tenant: tenant });
    expect(after.data).toEqual([expect.objectContaining({ masking_allowed: false, last_outcome: "disabled" })]);
    expect(after.data[0].last_changed_at).not.toBeNull();
    // unknown tenant and demo tenant: no row
    expect((await admin.rpc("platform_tenant_masking", { p_tenant: randomUUID() })).data).toEqual([]);
    const demoTenant = sql(`select id from public.tenants where is_demo limit 1`);
    if (demoTenant) expect((await admin.rpc("platform_tenant_masking", { p_tenant: demoTenant })).data).toEqual([]);
  });
});
