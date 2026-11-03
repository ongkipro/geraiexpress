// PR-43 / DATA-14: sourced rules, tenancy, immutable confirmation and the real dispatcher with
// OFFLINE provider replies. The only network destination in these tests is disposable PostgREST.
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { billableWeight, type BillableWeightRule } from "../../src/lib/billable-weight";
import { dispatchOperation } from "../../src/lib/mengantar/dispatcher";
import { estimateBillableQuotes } from "../../src/lib/mengantar/billable-quotes";
import { IDS, client, demoVisitor, machine, realOperation, signIn, signInAal2, sql } from "./helpers";

const origin = { p_origin_area_id: "5fc62f60f8f44b34aa4c0dcd", p_origin_address_id: "6acf44a4771fe2b474c055ca" };
const fixture = (name: string) => JSON.parse(readFileSync(new URL(`../unit/fixtures/mengantar/${name}`, import.meta.url), "utf8"));
const ruleId = (courier = "JNE") => sql(`select id from private.billable_weight_rules where courier = '${courier}' and service_class = 'regular' order by effective_at desc limit 1`);
const newRule = () => ({ courier: "Test", service_class: "regular", divisor: 6000, tolerance_grams: 300,
  max_weight_grams: 50000, source_url: "https://help.mengantar.com/id/articles/5387484", source_updated_at: "2026-10-19", effective_at: new Date().toISOString() });

const fixtureMembershipTenants = new Set<string>();
afterEach(() => {
  for (const tenant of fixtureMembershipTenants) {
    sql(`delete from public.memberships where tenant_id = '${tenant}' and user_id = '00000000-0000-4000-a000-0000000000a1'`);
  }
  fixtureMembershipTenants.clear();
});

async function liveDraft(isCod = false) {
  const f = await realOperation();
  fixtureMembershipTenants.add(f.tenant);
  sql(`delete from public.provider_operations where id = '${f.op}';
    insert into public.memberships (tenant_id, user_id, role) values ('${f.tenant}', '00000000-0000-4000-a000-0000000000a1', 'tenant_admin');
    update public.shipments set submission_state = 'draft' where id = '${f.shipment}';
    update public.shipments set sender_name = 'Pengirim Uji', sender_phone = '081234567890', recipient_area = 'Wilayah Uji',
      length_cm = 30, width_cm = 20, height_cm = 20, is_cod = ${isCod} where id = '${f.shipment}';`);
  const revision = Number(sql(`select revision from public.shipments where id = '${f.shipment}'`));
  return { ...f, revision, c: await signIn("owner-a@geraiexpress.test") };
}

// Assert the real dispatcher's outbound order without making a provider request.
async function expectOfflineWeight(operationId: string, shipmentId: string, grams: number) {
  let orders = 0;
  const result = await dispatchOperation(operationId, {
    rpc: (fn, args) => machine().rpc(fn, args), environment: "sandbox", credentialKey: Buffer.alloc(32, 7).toString("base64"),
    fetchImpl: (async (url, init) => {
      if (String(url).endsWith("/address")) return Response.json(fixture("address-list-sandbox.json"));
      expect(String(url).endsWith("/order")).toBe(true);
      const order = JSON.parse(String(init?.body)).orders[0];
      expect(order.weight).toBe(grams / 1000);
      orders++;
      const reply = fixture("order-create-jt-issued.json");
      reply.data[0].destinationMark = sql(`select reference from public.shipments where id = '${shipmentId}'`);
      // Synthetic provider price must match this fixture's frozen charge (legacy is 9000,
      // version A is 27000); otherwise the existing mismatch guard correctly adds a warning.
      reply.data[0].estimatedPrice = Number(sql(`select customer_charge_idr from public.shipments where id = '${shipmentId}'`));
      return Response.json(reply);
    }) as typeof fetch,
  });
  expect(orders).toBe(1);
  expect(result).toEqual({ status: "recorded", outcome: "issued" });
}

describe("billable-weight rule boundary", () => {
  it("seeds sourced regular maxima, divisors, Lion tolerance, and cargo ranges as non-executable evidence", async () => {
    const owner = await signIn("owner-a@geraiexpress.test");
    const { data, error } = await owner.rpc("billable_weight_rules", { p_tenant: IDS.tenantA });
    expect(error).toBeNull();
    const rules = data as BillableWeightRule[];
    // 13 original versions plus the three sourced cargo min/max versions (20261103100000).
    expect(rules).toHaveLength(16);
    expect(rules.find((r) => r.courier === "JNE" && r.service_class === "regular")).toMatchObject({ divisor: 4000, max_weight_grams: 50000, source_updated_at: "2026-10-19" });
    expect(rules.find((r) => r.courier === "lion")).toMatchObject({ tolerance_grams: 310, max_weight_grams: 100000 });
    expect(rules.find((r) => r.courier === "anteraja")).toMatchObject({ max_weight_grams: 30000 });
    for (const r of rules.filter((r) => r.service_class === "regular")) expect(r.source_url).toContain("5387484");
    // The original cargo evidence rows stay unchanged; newer versions carry the verified pairs.
    const cargo = rules.filter((r) => r.service_class === "cargo" && r.cargo_minimum_range_grams !== null);
    expect(cargo).toHaveLength(4);
    for (const r of cargo) {
      expect(r.min_weight_grams).toBeNull(); expect(r.max_weight_grams).toBeNull();
      expect(r.cargo_minimum_range_grams).toHaveLength(2);
      expect(r).toMatchObject({ cargo_minimum_source_url: expect.stringContaining("5502313"), cargo_minimum_observed_at: "2026-11-02" });
    }
    expect(cargo.find((r) => r.courier === "iDexpress")?.divisor).toBe(4000);
  });

  it("refuses cross-tenant reads, direct rule writes and writes to computed columns", async () => {
    const owner = await signIn("owner-a@geraiexpress.test");
    expect((await owner.rpc("billable_weight_rules", { p_tenant: IDS.tenantB })).error?.message).toBe("not_found");
    expect((await client().rpc("billable_weight_rules", { p_tenant: IDS.tenantA })).error).not.toBeNull();
    expect((await owner.schema("private" as "public").from("billable_weight_rules").insert(newRule())).error).not.toBeNull();
    expect((await owner.from("shipments").update({ weight_snapshot: {}, provider_weight_grams: 1000 }).eq("id", IDS.shipmentA)).error).not.toBeNull();
    expect((await owner.from("shipment_quotes").update({ billable_weight_grams: 1000 }).eq("tenant_id", IDS.tenantA)).error).not.toBeNull();
    expect(sql("select relrowsecurity from pg_class where oid = 'private.billable_weight_rules'::regclass")).toBe("t");
    expect(sql("select has_table_privilege('authenticated', 'private.billable_weight_rules', 'insert,update,delete')")).toBe("f");
  });

  it("only an aal2 integration operator can append an audited rule, with required source/date and valid inputs", async () => {
    const args = { p_rule: newRule(), p_reason: "Verified provider evidence" };
    for (const c of [client(), await signIn("owner-a@geraiexpress.test"), await signIn("admin@geraiexpress.test"), await signInAal2("admin-new@geraiexpress.test"), (await demoVisitor()).c]) {
      expect((await c.rpc("platform_set_billable_weight_rule", args)).error).not.toBeNull();
    }
    const admin = await signInAal2("admin@geraiexpress.test");
    for (const invalid of [{ source_url: null }, { source_updated_at: null }, { divisor: 0 }, { tolerance_grams: 1000 }, { max_weight_grams: -1 }, { service_class: "express" }, { effective_at: null }, { source_url: "javascript:bad" }]) {
      expect((await admin.rpc("platform_set_billable_weight_rule", { ...args, p_rule: { ...args.p_rule, ...invalid } })).error).not.toBeNull();
    }
    const { data: id, error } = await admin.rpc("platform_set_billable_weight_rule", args);
    expect(error).toBeNull();
    try {
      expect(sql(`select count(*) from public.audit_events where action = 'billable_weight_rule.append' and detail->>'rule_id' = '${id}'`)).toBe("1");
      expect(sql(`select created_by is not null from private.billable_weight_rules where id = '${id}'`)).toBe("t");
    } finally { sql(`delete from private.billable_weight_rules where id = '${id}'`); }
  });

  it("keeps SQL and pure TypeScript results identical at tolerance, missing-size and maximum boundaries", () => {
    const rows = JSON.parse(sql("select jsonb_agg(r) from private.billable_weight_rules r")) as BillableWeightRule[];
    for (const courier of ["JNE", "lion", "anteraja", "SiCepat"]) {
      const rule = rows.find((r) => r.courier === courier && r.service_class === "regular")!;
      for (const [actual, l, w, h] of [[1300, 10, 10, 10], [1301, 10, 10, 10], [1310, 10, 10, 10], [1311, 10, 10, 10], [1301, null, 10, 10], [1000, 30, 20, 20], [1000, 100, 60, 60], [1, 1, 1, 1], [299, 1, 1, 1], [300, 1, 1, 1], [301, 1, 1, 1], [499, 1, 1, 1], [500, 1, 1, 1], [999, 1, 1, 1], [1000, 1, 1, 1], [1, 10, 10, 29]]) {
        const expected = billableWeight({ actualWeightGrams: actual!, lengthCm: l, widthCm: w, heightCm: h }, rule);
        const got = JSON.parse(sql(`select to_jsonb(b) from private.billable_weight(${actual}, ${l ?? "null"}, ${w}, ${h},
          (select r from private.billable_weight_rules r where id = '${rule.id}')) b`));
        expect(got).toEqual(expected);
      }
    }
  });

  it("leaves pre-computation rows NULL instead of backfilling zero or inferred weights", async () => {
    // The legacy fixture inserts the old row shape with no computed-weight fields.
    const f = await realOperation();
    expect(sql(`select count(*) from public.shipment_quotes where shipment_id = '${f.shipment}'
      and actual_weight_grams is null and volumetric_weight_grams is null and billable_weight_grams is null and weight_rule_id is null`)).not.toBe("0");
  });
});

describe("billable quote → confirmation → real dispatcher (offline)", () => {
  it.each([false, true])("dispatches frozen selected weight with no price_mismatch (COD=%s)", async (isCod) => {
    const f = await liveDraft(isCod);
    const args = { ...origin, p_tenant: f.tenant, p_shipment: f.shipment, p_expected_revision: f.revision,
      p_rows: [{ courier: "JNE", tariff: 27000, net: 21600, cod_supported: true, cod_fee: isCod ? 2600 : 0,
        billable_weight_grams: 3000, weight_rule_id: ruleId() }] };
    expect((await machine().rpc("record_live_quotes", args)).data).toBe(1);
    const { data: quotes } = await f.c.from("shipment_quotes").select("*").eq("shipment_id", f.shipment).gt("expires_at", new Date().toISOString());
    const q = quotes![0];
    expect(q).toMatchObject({ actual_weight_grams: 1000, volumetric_weight_grams: 3000, billable_weight_grams: 3000, weight_rule_id: ruleId(), customer_charge_idr: isCod ? 29600 : 27000 });
    const confirmed = await f.c.rpc("confirm_shipment", { p_shipment: f.shipment, p_quote: q.id, p_expected_revision: f.revision, p_idempotency_key: randomUUID(), p_declaration_version: 1 });
    expect(confirmed.error).toBeNull();
    const snapshot = JSON.parse(sql(`select weight_snapshot from public.shipments where id = '${f.shipment}'`));
    expect(snapshot).toMatchObject({ actual_weight_grams: 1000, billable_weight_grams: 3000, weight_rule_id: ruleId(), length_cm: 30 });
    // Even an administrative quote correction after confirmation cannot change the dispatch weight.
    sql(`update public.shipment_quotes set billable_weight_grams = 4000 where id = '${q.id}'`);
    const requests: Record<string, unknown>[] = [];
    const result = await dispatchOperation(confirmed.data.operation_id, {
      rpc: (fn, args) => machine().rpc(fn, args), environment: "sandbox", credentialKey: Buffer.alloc(32, 7).toString("base64"),
      fetchImpl: (async (url, init) => {
        if (String(url).endsWith("/address")) return Response.json(fixture("address-list-sandbox.json"));
        expect(String(url).endsWith("/order")).toBe(true);
        const body = JSON.parse(String(init?.body)); requests.push(body);
        const order = body.orders[0];
        expect(order.weight).toBe(3);
        const reply = fixture("order-create-jt-issued.json");
        reply.data[0].destinationMark = sql(`select reference from public.shipments where id = '${f.shipment}'`);
        reply.data[0].estimatedPrice = Number(order.weight) * 9000 + (isCod ? 2600 : 0);
        return Response.json(reply);
      }) as typeof fetch,
    });
    expect(requests).toHaveLength(1);
    expect(result).toEqual({ status: "recorded", outcome: "issued" });
    expect(sql(`select count(*) from public.shipment_events where shipment_id = '${f.shipment}' and kind = 'price_mismatch'`)).toBe("0");
    expect(sql(`select weight_grams from public.shipments where id = '${f.shipment}'`)).toBe("1000");
    expect((await f.c.from("shipments").update({ weight_grams: 2000 }).eq("id", f.shipment).select("id")).data).toEqual([]);
    const foreign = await signIn("owner-b@geraiexpress.test");
    expect((await foreign.from("shipment_quotes").select("*").eq("shipment_id", f.shipment)).data).toEqual([]);
  });

  it("confirms a legacy NULL-weight quote without retroactively applying volumetric rules", async () => {
    const f = await liveDraft();
    // Old-shaped quote, but with valid current revision/origin and still inside its TTL.
    sql(`update public.shipment_quotes set shipment_revision = ${f.revision},
      origin_area_id = '${origin.p_origin_area_id}', origin_pickup_address_id = '${origin.p_origin_address_id}'
      where shipment_id = '${f.shipment}'`);
    const quote = sql(`select id from public.shipment_quotes where shipment_id = '${f.shipment}'`);
    sql(`update public.shipments set submission_state = 'estimated' where id = '${f.shipment}'`);
    const confirmed = await f.c.rpc("confirm_shipment", { p_shipment: f.shipment, p_quote: quote,
      p_expected_revision: f.revision, p_idempotency_key: randomUUID(), p_declaration_version: 1 });
    expect(confirmed.error).toBeNull();
    expect(JSON.parse(sql(`select weight_snapshot from public.shipments where id = '${f.shipment}'`))).toMatchObject({
      actual_weight_grams: null, volumetric_weight_grams: null, billable_weight_grams: null, weight_rule_id: null, length_cm: 30,
    });
    await expectOfflineWeight(confirmed.data.operation_id, f.shipment, 1000);
    expect(sql(`select weight_grams from public.shipments where id = '${f.shipment}'`)).toBe("1000");
  });

  it("selects the latest effective rule for fresh estimates but preserves an older quoted rule through dispatch", async () => {
    const f = await liveDraft();
    const versionA = ruleId();
    expect((await machine().rpc("record_live_quotes", { ...origin, p_tenant: f.tenant,
      p_shipment: f.shipment, p_expected_revision: f.revision,
      p_rows: [{ courier: "JNE", tariff: 27000, net: 21600, billable_weight_grams: 3000, weight_rule_id: versionA }] })).data).toBe(1);
    const quoteA = sql(`select id from public.shipment_quotes where shipment_id = '${f.shipment}' and weight_rule_id = '${versionA}'`);
    const admin = await signInAal2("admin@geraiexpress.test");
    const appended: string[] = [];
    try {
      for (const [divisor, offset] of [[2000, -1000], [1000, 86400000]]) {
        const result = await admin.rpc("platform_set_billable_weight_rule", { p_reason: "Offline version-transition regression",
          p_rule: { ...newRule(), courier: "JNE", divisor, effective_at: new Date(Date.now() + offset).toISOString() } });
        expect(result.error).toBeNull();
        appended.push(result.data);
      }
      const { data: rules, error } = await f.c.rpc("billable_weight_rules", { p_tenant: f.tenant });
      expect(error).toBeNull();
      expect((rules as BillableWeightRule[]).some((r) => r.id === appended[1])).toBe(false);
      const fresh = await estimateBillableQuotes(async (request) => [{ courier: "JNE", tariff: request.weightGrams * 9,
        netShipping: request.weightGrams * 7, codFee: 0, discountBps: null, etaText: "1–2 hari" }],
      { originAreaId: origin.p_origin_area_id, destinationAreaId: "5fc63169f8f44b34aa4c2ee1" },
      { actualWeightGrams: 1000, lengthCm: 30, widthCm: 20, heightCm: 20 }, rules as BillableWeightRule[],
      [{ courier: "JNE", service_class: "regular" }]);
      expect(fresh.rows).toHaveLength(1);
      expect(fresh.rows[0]).toMatchObject({ billable_weight_grams: 6000, weight_rule_id: appended[0] });
      const next = await liveDraft();
      expect((await machine().rpc("record_live_quotes", { ...origin, p_tenant: next.tenant,
        p_shipment: next.shipment, p_expected_revision: next.revision,
        p_rows: fresh.rows.map((r) => ({ courier: r.courier, tariff: r.tariff, net: r.netShipping,
          billable_weight_grams: r.billable_weight_grams, weight_rule_id: r.weight_rule_id })) })).data).toBe(1);
      expect(sql(`select billable_weight_grams from public.shipment_quotes where shipment_id = '${next.shipment}'
        and weight_rule_id = '${appended[0]}'`)).toBe("6000");
      const confirmed = await f.c.rpc("confirm_shipment", { p_shipment: f.shipment, p_quote: quoteA,
        p_expected_revision: f.revision, p_idempotency_key: randomUUID(), p_declaration_version: 1 });
      expect(confirmed.error).toBeNull();
      expect(JSON.parse(sql(`select weight_snapshot from public.shipments where id = '${f.shipment}'`))).toMatchObject({
        billable_weight_grams: 3000, weight_rule_id: versionA,
      });
      await expectOfflineWeight(confirmed.data.operation_id, f.shipment, 3000);
    } finally {
      for (const id of appended) {
        sql(`delete from public.shipment_quotes where weight_rule_id = '${id}';
          delete from private.billable_weight_rules where id = '${id}'`);
      }
    }
  });

  it("rejects mismatched estimate weight and wrong courier rule without storing a false weight", async () => {
    const f = await liveDraft();
    const args = { ...origin, p_tenant: f.tenant, p_shipment: f.shipment, p_expected_revision: f.revision };
    const base = { courier: "JNE", tariff: 27000, net: 21600, billable_weight_grams: 3000, weight_rule_id: ruleId() };
    expect((await machine().rpc("record_live_quotes", { ...args, p_rows: [{ ...base, billable_weight_grams: 1000 }] })).error?.message).toBe("quote_weight_mismatch");
    expect((await machine().rpc("record_live_quotes", { ...args, p_rows: [{ ...base, weight_rule_id: ruleId("JT") }] })).error?.message).toBe("invalid_weight_rule");
    expect((await machine().rpc("record_live_quotes", { ...args, p_rows: [{ courier: "JNE", tariff: 27000, net: 21600 }] })).error?.message).toBe("quote_weight_mismatch");
  });

  it("drops only the over-limit courier and records its explicit reason", async () => {
    const f = await liveDraft();
    sql(`update public.shipments set length_cm = 100, width_cm = 60, height_cm = 40 where id = '${f.shipment}'`);
    const revision = Number(sql(`select revision from public.shipments where id = '${f.shipment}'`));
    const result = await machine().rpc("record_live_quotes", { ...origin, p_tenant: f.tenant, p_shipment: f.shipment, p_expected_revision: revision,
      p_rows: ["anteraja", "lion"].map((courier) => ({ courier, tariff: 90000, net: 72000, billable_weight_grams: 40000, weight_rule_id: ruleId(courier) })) });
    expect(result.error).toBeNull(); expect(result.data).toBe(1);
    expect(sql(`select courier from public.shipment_quotes where shipment_id = '${f.shipment}' and expires_at > now()`)).toBe("lion");
    expect(sql(`select detail from public.shipment_events where shipment_id = '${f.shipment}' and kind = 'quote_weight_excluded'`)).toBe("anteraja: max_weight_exceeded");
  });

  it("simulated tariffs use the sourced rule and freeze all three weights, with COD counted once", async () => {
    const f = await demoVisitor();
    const { data: id } = await f.c.rpc("create_shipment_draft", { p_outlet: f.outlet });
    const saved = await f.c.from("shipments").update({ sender_name: "Pengirim", sender_phone: "081234567890", recipient_name: "Penerima", recipient_phone: "081234567890",
      recipient_address: "Jl. Penerima No. 1", recipient_area: "Wilayah Uji", item_description: "Buku", weight_grams: 1000,
      length_cm: 30, width_cm: 20, height_cm: 20, is_cod: true, goods_value_idr: 50000 }).eq("id", id).select("revision").single();
    const { data, error } = await f.c.rpc("request_quotes", { p_shipment: id, p_expected_revision: saved.data!.revision });
    expect(error).toBeNull(); expect(data).toHaveLength(2);
    for (const q of data!) {
      expect(q).toMatchObject({ actual_weight_grams: 1000, volumetric_weight_grams: 2000, billable_weight_grams: 2000, weight_rule_id: ruleId("SiCepat") });
      expect(q.customer_charge_idr).toBe(q.normal_tariff_idr + q.cod_fee_idr);
    }
    expect(data!.find((q: { service: string }) => q.service === "Reguler").normal_tariff_idr).toBe(27000);
  });
});

describe("platform_billable_weight_rules (T-091)", () => {
  it("returns every version with current/scheduled flags to integration_operations and refuses everyone else", async () => {
    const admin = await signInAal2("admin@geraiexpress.test");
    const { data, error } = await admin.rpc("platform_billable_weight_rules");
    expect(error).toBeNull();
    const rows = data as { courier: string; service_class: string; is_current: boolean; scheduled: boolean; created_by?: unknown }[];
    expect(rows.length).toBeGreaterThanOrEqual(16);
    expect(rows.some((r) => "created_by" in r)).toBe(false);
    const jneCargo = rows.filter((r) => r.courier === "JNE" && r.service_class === "cargo");
    expect(jneCargo.filter((r) => r.is_current)).toHaveLength(1);
    const owner = await signIn("owner-a@geraiexpress.test");
    expect((await owner.rpc("platform_billable_weight_rules")).error).not.toBeNull();
    expect((await client().rpc("platform_billable_weight_rules")).error).not.toBeNull();
    // Seed admin-new holds platform_monitoring + audit_review only: refused.
    const limited = await signInAal2("admin-new@geraiexpress.test");
    expect((await limited.rpc("platform_billable_weight_rules")).error).not.toBeNull();
  });
});

describe("platform_set_billable_weight_rule refuses a missing reason (T-091)", () => {
  it("writes nothing without a 5–500 character reason", async () => {
    const admin = await signInAal2("admin@geraiexpress.test");
    const before = sql("select count(*) from private.billable_weight_rules");
    const { error } = await admin.rpc("platform_set_billable_weight_rule", { p_reason: "ok", p_rule: newRule() });
    expect(error?.message).toBe("reason_required");
    expect(sql("select count(*) from private.billable_weight_rules")).toBe(before);
  });
});
