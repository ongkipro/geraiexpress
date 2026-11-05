// T-087 / PR-45 / DATA-11 read model: public.pilot_report per outlet and WIB day. Tenant administrators
// only; earnings = normal tariff of the selected quote minus the gerai cost from the terms at quoted_at
// (the same private.quote_gerai_cost that public.gerai_cost_for_quote uses); COD fee excluded; unknown
// stays NULL; no net cost or percentage leaves the database; record_export audits the CSV.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TestClient } from "./helpers";
import { client, demoVisitor, signIn, sql } from "./helpers";

const OWNER_A = "00000000-0000-4000-a000-0000000000a1";
const OPERATOR_A = "00000000-0000-4000-a000-0000000000a2";
const OWNER_B = "00000000-0000-4000-a000-0000000000b1";
// Provider net costs of the fixture quotes: none of them may appear as a value of any report row.
const NET_COSTS = [18400, 8642, 8000, 17000];

const X = randomUUID(); // report tenant: admin owner-a, operator operator-a
const Y = randomUUID(); // other tenant: admin owner-b only
const OUT1 = randomUUID(), OUT2 = randomUUID();
const DAY1 = "2026-01-10", DAY2 = "2026-01-11";

type Row = Record<string, unknown> & { row_level: string; outlet_id: string | null; day: string | null };

// One issued real shipment with its selected quote, net cost and optional label snapshots.
function issued(o: { outlet: string; day: string; createdMinutesBefore: number; tariff: number; net: number | null;
  codFee?: number; simulated?: boolean; masks?: boolean[]; tenant?: string; state?: string; charge?: number }) {
  const tenant = o.tenant ?? X, id = randomUUID(), quote = randomUUID();
  const issuedAt = `${o.day}T10:00:00+07:00`;
  const cod = o.codFee !== undefined;
  sql(`insert into public.shipments (tenant_id, outlet_id, id, reference, submission_state, recipient_name, recipient_phone,
      recipient_address, recipient_area_id, item_description, weight_grams, goods_value_idr, is_cod, cod_amount_idr, is_simulated,
      created_by, created_at, issued_at, submitted_at, awb, customer_charge_idr)
    values ('${tenant}', '${o.outlet}', '${id}', 'GXP-${id.slice(0, 8)}', '${o.state ?? "issued"}', 'Penerima Uji', '081234567890',
      'Jl. Uji 1', '5fc63169f8f44b34aa4c2ee1', 'Dokumen', 1000, 50000, ${cod}, ${cod ? 62000 : "null"}, ${o.simulated ? "true" : "false"},
      '${OWNER_A}', timestamptz '${issuedAt}' - interval '${o.createdMinutesBefore} minutes', '${issuedAt}', '${issuedAt}',
      'PILOT${id.slice(0, 8).toUpperCase()}', ${o.charge ?? o.tariff + (o.codFee ?? 0)});
    insert into public.shipment_quotes (tenant_id, shipment_id, id, shipment_revision, courier, service, normal_tariff_idr,
      cod_supported, cod_fee_idr, eta_days, is_simulated, quoted_at, expires_at)
    values ('${tenant}', '${id}', '${quote}', 1, 'JT', 'REG', ${o.tariff}, ${cod}, ${o.codFee ?? 0}, '1-2', ${o.simulated ? "true" : "false"},
      timestamptz '${issuedAt}' - interval '${o.createdMinutesBefore + 1} minutes', timestamptz '${issuedAt}' + interval '1 hour');
    insert into private.quote_costs (tenant_id, quote_id, net_shipping_idr) values ('${tenant}', '${quote}', ${o.net ?? "null"});
    update public.shipments set selected_quote_id = '${quote}' where id = '${id}';`);
  (o.masks ?? []).forEach((mask, i) => {
    sql(`insert into public.label_snapshots (tenant_id, shipment_id, version, size, mask_sender, printed_sender_name, printed_sender_phone,
        printed_sender_city, true_tenant_name, true_tenant_slug, awb, shipment_reference, is_cod, content_digest, created_by)
      values ('${tenant}', '${id}', ${i + 1}, '10x15', ${mask}, 'Toko Uji', '081311112222', 'Kec. Coblong', 'Gerai', 'gerai',
        'PILOT${id.slice(0, 8).toUpperCase()}', 'GXP-${id.slice(0, 8)}', ${cod}, '${"a".repeat(64)}', '${OWNER_A}')`);
  });
  return { id, quote };
}

// A counter payment recorded through the RPC as operator-a, then moved onto the report day (fixture only).
function pay(shipment: string, method: string, amount: number, day: string) {
  const payment = sql(`select set_config('request.jwt.claims', '{"sub":"${OPERATOR_A}","role":"authenticated"}', false);
    select public.record_counter_payment('${shipment}', '${method}', ${amount}, null, null);`).split("\n").pop()!;
  sql(`begin; set local session_replication_role = replica;
    update public.counter_payments set recorded_at = '${day}T11:00:00+07:00' where id = '${payment}'; commit`);
  return payment;
}

let owner: TestClient, operator: TestClient, ownerB: TestClient;
let s: Record<string, { id: string; quote: string }>;
const report = async (c: TestClient, from = DAY1, to = DAY2, tenant = X) => c.rpc("pilot_report", { p_tenant: tenant, p_from: from, p_to: to });
const rowsOf = (data: unknown) => data as Row[];
const find = (rows: Row[], level: string, outlet: string | null, day: string | null) =>
  rows.find((r) => r.row_level === level && r.outlet_id === outlet && r.day === day)!;

beforeAll(async () => {
  for (let attempt = 0; attempt < 60; attempt++) {
    const { error } = await client().rpc("registration_open");
    if (error?.code !== "PGRST002" && error?.code !== "PGRST001") break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  sql(`insert into public.tenants (id, name, lifecycle, is_demo) values ('${X}', 'Gerai Pilot X', 'active', false), ('${Y}', 'Gerai Pilot Y', 'active', false);
    insert into public.memberships (tenant_id, user_id, role) values
      ('${X}', '${OWNER_A}', 'tenant_admin'), ('${X}', '${OPERATOR_A}', 'operator'), ('${Y}', '${OWNER_B}', 'tenant_admin');
    insert into public.outlets (tenant_id, id, name) values ('${X}', '${OUT1}', 'Outlet Pilot Satu'), ('${X}', '${OUT2}', 'Outlet Pilot Dua'),
      ('${Y}', '${randomUUID()}', 'Outlet Pilot Y');
    begin; set local session_replication_role = replica;
    insert into public.gerai_discount_terms (tenant_id, version, gerai_discount_bps, effective_from, source_reference, status, created_by, created_at)
      values ('${X}', 1, 2000, '2026-01-01T00:00:00+07:00', 'Uji T-087', 'owner_stated', '${OWNER_A}', '2026-01-01T00:00:00+07:00');
    commit;`);
  s = {
    // DAY1, outlet 1 (assigned 2000 bps): a observed 2000 -> cost 18400, earnings 4600; b observed 3000 -> the
    // assigned 2000 applies, cost 9876, earnings 2469.
    a: issued({ outlet: OUT1, day: DAY1, createdMinutesBefore: 10, tariff: 23000, net: 18400, masks: [true] }),
    b: issued({ outlet: OUT1, day: DAY1, createdMinutesBefore: 20, tariff: 12345, net: 8642, masks: [true, false] }),
    // COD shipment: the COD fee 3000 is passed through and never part of the earnings.
    c: issued({ outlet: OUT1, day: DAY1, createdMinutesBefore: 60, tariff: 10000, net: 8000, codFee: 3000 }),
    // DAY2, outlet 1: observed 1500 < assigned 2000 -> capped at the quote's own 1500: cost 17000, earnings 3000.
    d: issued({ outlet: OUT1, day: DAY2, createdMinutesBefore: 30, tariff: 20000, net: 17000, masks: [false, true] }),
    // DAY1, outlet 2: net unknown -> earnings unknown (NULL), never 0.
    e: issued({ outlet: OUT2, day: DAY1, createdMinutesBefore: 5, tariff: 15000, net: null }),
    // Excluded: simulated shipment of a real gerai, a not-yet-issued shipment, an issued shipment outside the range,
    // and another tenant's shipment.
    sim: issued({ outlet: OUT1, day: DAY1, createdMinutesBefore: 1, tariff: 99000, net: 1000, simulated: true }),
    queued: issued({ outlet: OUT1, day: DAY1, createdMinutesBefore: 1, tariff: 99000, net: 1000, state: "queued" }),
    outside: issued({ outlet: OUT1, day: "2026-01-12", createdMinutesBefore: 1, tariff: 99000, net: 1000 }),
  };
  pay(s.a.id, "cash", 23000, DAY1);
  pay(s.b.id, "qris", 12345, DAY1);
  const voided = pay(s.d.id, "transfer", 20000, DAY2);
  sql(`select set_config('request.jwt.claims', '{"sub":"${OWNER_A}","role":"authenticated"}', false);
    select public.void_counter_payment('${voided}', 'Salah catat uji');`);
  pay(s.d.id, "other", 20000, DAY2);
  owner = await signIn("owner-a@geraiexpress.test");
  operator = await signIn("operator-a@geraiexpress.test");
  ownerB = await signIn("owner-b@geraiexpress.test");
});

afterAll(() => {
  sql(`begin; set local session_replication_role = replica;
    delete from public.gerai_discount_terms where tenant_id in ('${X}', '${Y}'); commit;
    update public.shipments set selected_quote_id = null where tenant_id in ('${X}', '${Y}');
    delete from public.tenants where id in ('${X}', '${Y}')`);
});

describe("pilot_report measures (T-087)", () => {
  it("counts issued real shipments per outlet and WIB day with exact medians at every level", async () => {
    const { data, error } = await report(owner);
    expect(error).toBeNull();
    const rows = rowsOf(data);
    expect(find(rows, "day", OUT1, DAY1)).toMatchObject({ shipments_issued: 3, median_draft_to_resi_minutes: 20 });
    expect(find(rows, "day", OUT1, DAY2)).toMatchObject({ shipments_issued: 1, median_draft_to_resi_minutes: 30 });
    expect(find(rows, "day", OUT2, DAY1)).toMatchObject({ shipments_issued: 1, median_draft_to_resi_minutes: 5 });
    // Outlet total over [10, 20, 60, 30]: the true median 25, not a median of daily medians.
    expect(find(rows, "outlet", OUT1, null)).toMatchObject({ shipments_issued: 4, median_draft_to_resi_minutes: 25 });
    expect(find(rows, "total", null, null)).toMatchObject({ shipments_issued: 5, median_draft_to_resi_minutes: 20 });
    // Days are WIB calendar days; no day row exists for an outlet day without activity.
    expect(rows.filter((r) => r.row_level === "day").map((r) => `${r.outlet_id === OUT1 ? 1 : 2}:${r.day}`).sort())
      .toEqual([`1:${DAY1}`, `1:${DAY2}`, `2:${DAY1}`]);
    expect(rows.at(-1)!.row_level).toBe("total");
  });

  it("reports active counter payments by method, never voided ones", async () => {
    const rows = rowsOf((await report(owner)).data);
    expect(find(rows, "day", OUT1, DAY1)).toMatchObject({ cash_count: 1, cash_idr: 23000, qris_count: 1, qris_idr: 12345, transfer_count: 0, transfer_idr: 0 });
    expect(find(rows, "day", OUT1, DAY2)).toMatchObject({ transfer_count: 0, transfer_idr: 0, other_count: 1, other_idr: 20000 });
    expect(find(rows, "total", null, null)).toMatchObject({ cash_idr: 23000, qris_idr: 12345, transfer_idr: 0, other_idr: 20000 });
  });

  it("masked-label share uses each shipment's latest snapshot over shipments that have one", async () => {
    const rows = rowsOf((await report(owner)).data);
    // a: [masked] -> masked; b: [masked, unmasked] -> not masked; c: no label.
    expect(find(rows, "day", OUT1, DAY1)).toMatchObject({ labelled_shipments: 2, masked_shipments: 1 });
    // d: [unmasked, masked] -> masked.
    expect(find(rows, "day", OUT1, DAY2)).toMatchObject({ labelled_shipments: 1, masked_shipments: 1 });
    expect(find(rows, "day", OUT2, DAY1)).toMatchObject({ labelled_shipments: 0, masked_shipments: 0 });
  });

  it("earnings equal tariff minus gerai_cost_for_quote per shipment, exclude the COD fee, and stay NULL when unknown", async () => {
    const cost = async (q: string) => (await owner.rpc("gerai_cost_for_quote", { p_tenant: X, p_quote: q })).data as number | null;
    const expected = 23000 - (await cost(s.a.quote))! + 12345 - (await cost(s.b.quote))! + 10000 - (await cost(s.c.quote))!;
    expect(await cost(s.a.quote)).toBe(18400);
    expect(await cost(s.c.quote)).toBe(8000);
    const rows = rowsOf((await report(owner)).data);
    expect(expected).toBe(4600 + 2469 + 2000);
    expect(find(rows, "day", OUT1, DAY1)).toMatchObject({ earnings_idr: expected, earnings_unknown_count: 0 });
    // The COD shipment's customer charge is 13000 (tariff + COD fee 3000); its earnings use the tariff only.
    expect(sql(`select customer_charge_idr from public.shipment_quotes where id = '${s.c.quote}'`)).toBe("13000");
    expect(find(rows, "day", OUT1, DAY2)).toMatchObject({ earnings_idr: 20000 - (await cost(s.d.quote))! });
    expect(find(rows, "outlet", OUT1, null).earnings_idr).toBe(expected + 20000 - (await cost(s.d.quote))!);
    // Unknown net cost: NULL with a count, never 0, and it makes the grand total unknown as well.
    expect(await cost(s.e.quote)).toBeNull();
    expect(find(rows, "day", OUT2, DAY1)).toMatchObject({ earnings_idr: null, earnings_unknown_count: 1 });
    expect(find(rows, "outlet", OUT2, null)).toMatchObject({ earnings_idr: null, earnings_unknown_count: 1 });
    expect(find(rows, "total", null, null)).toMatchObject({ earnings_idr: null, earnings_unknown_count: 1 });
  });

  it("returns no provider net cost or percentage", async () => {
    const { data } = await report(owner);
    const values = rowsOf(data).flatMap((r) => Object.values(r)).filter((v) => typeof v === "number");
    for (const net of NET_COSTS) expect(values).not.toContain(net);
    expect(JSON.stringify(data)).not.toMatch(/net|bps|percent|discount/i);
    expect(Object.keys(rowsOf(data)[0]).sort()).toEqual([
      "cash_count", "cash_idr", "data_at", "day", "earnings_idr", "earnings_unknown_count", "labelled_shipments", "masked_shipments",
      "median_draft_to_resi_minutes", "other_count", "other_idr", "outlet_id", "outlet_name", "qris_count", "qris_idr", "row_level",
      "shipments_issued", "transfer_count", "transfer_idr",
    ]);
  });
});

describe("pilot_report access and input (T-087)", () => {
  it("refuses operators, other tenants and anonymous callers", async () => {
    expect((await report(operator)).error).toMatchObject({ code: "42501", message: "admin_required" });
    expect((await report(ownerB)).error).toMatchObject({ code: "P0002", message: "not_found" });
    expect((await report(client())).error?.code).toBe("42501");
    // The other tenant's own report never contains X's outlets.
    const own = await report(ownerB, DAY1, DAY2, Y);
    expect(own.error).toBeNull();
    expect(JSON.stringify(own.data)).not.toContain(OUT1);
  });

  it("refuses an invalid or over-long WIB range with 22023", async () => {
    for (const [from, to] of [[DAY2, DAY1], ["2026-01-01", "2026-04-03"], [null, DAY1], [DAY1, null]] as const) {
      const { error } = await owner.rpc("pilot_report", { p_tenant: X, p_from: from, p_to: to });
      expect(error, `${from}..${to}`).toMatchObject({ code: "22023", message: "report_range_invalid" });
    }
    // 92 inclusive days is allowed.
    expect((await report(owner, "2026-01-01", "2026-04-02")).error).toBeNull();
  });

  it("a demo gerai reports only its simulated sample shipments, with earnings always NULL", async () => {
    const demo = await demoVisitor();
    const today = sql(`select (now() at time zone 'Asia/Jakarta')::date`);
    const yesterday = sql(`select (now() at time zone 'Asia/Jakarta')::date - 1`);
    const { data, error } = await demo.c.rpc("pilot_report", { p_tenant: demo.tenant, p_from: yesterday, p_to: today });
    expect(error).toBeNull();
    const total = rowsOf(data).find((r) => r.row_level === "total")!;
    const expected = sql(`select count(*) from public.shipments where tenant_id = '${demo.tenant}' and is_simulated
      and submission_state = 'issued' and issued_at >= '${yesterday}'::timestamp at time zone 'Asia/Jakarta'`);
    expect(Number(expected)).toBeGreaterThan(0);
    expect(total).toMatchObject({ shipments_issued: Number(expected), earnings_idr: null });
  });
});

describe("shared per-quote gerai cost (T-087 parity)", () => {
  it("gerai_cost_for_quote equals the original per-quote derivation for normal, capped and unknown quotes", async () => {
    for (const q of [s.a.quote, s.b.quote, s.c.quote, s.d.quote, s.e.quote]) {
      const direct = sql(`select coalesce(private.gerai_cost_idr(q.normal_tariff_idr,
          (select t.gerai_discount_bps from private.gerai_terms_at(q.tenant_id, q.quoted_at) t), c.net_shipping_idr)::text, 'NULL')
        from public.shipment_quotes q left join private.quote_costs c on c.tenant_id = q.tenant_id and c.quote_id = q.id where q.id = '${q}'`);
      const viaRpc = (await owner.rpc("gerai_cost_for_quote", { p_tenant: X, p_quote: q })).data as number | null;
      expect(viaRpc === null ? "NULL" : String(viaRpc), q).toBe(direct);
    }
    // Normal (assigned 2000 = observed 2000), assigned below observed (3000 on 12345 -> 12345-2469), capped at the
    // quote's own observed 1500 (20000 -> 17000) and unknown net cost.
    expect((await owner.rpc("gerai_cost_for_quote", { p_tenant: X, p_quote: s.a.quote })).data).toBe(18400);
    expect((await owner.rpc("gerai_cost_for_quote", { p_tenant: X, p_quote: s.b.quote })).data).toBe(9876);
    expect((await owner.rpc("gerai_cost_for_quote", { p_tenant: X, p_quote: s.d.quote })).data).toBe(17000);
    expect((await owner.rpc("gerai_cost_for_quote", { p_tenant: X, p_quote: s.e.quote })).data).toBeNull();
    expect((await operator.rpc("gerai_cost_for_quote", { p_tenant: X, p_quote: s.a.quote })).error?.message).toBe("admin_required");
    expect(sql(`select has_function_privilege('authenticated', 'private.quote_gerai_cost(uuid,uuid)', 'execute')`)).toBe("f");
  });
});

describe("record_export audits the pilot report CSV (T-087)", () => {
  it("records export.pilot_report with from/to only and keeps the shipments kind unchanged", async () => {
    const ok = await owner.rpc("record_export", { p_tenant: X, p_kind: "pilot_report", p_filters: { from: DAY1, to: DAY2 }, p_row_count: 7, p_truncated: false });
    expect(ok.error).toBeNull();
    const row = JSON.parse(sql(`select row_to_json(e) from public.audit_events e where action = 'export.pilot_report' and target_tenant = '${X}' order by id desc limit 1`));
    expect(row).toMatchObject({ actor: OWNER_A, outcome: "ok", detail: { filters: { from: DAY1, to: DAY2 }, rows: 7, truncated: false } });
    for (const filters of [{ status: "issued" }, { has_query: true }]) {
      expect((await owner.rpc("record_export", { p_tenant: X, p_kind: "pilot_report", p_filters: filters, p_row_count: 1, p_truncated: false })).error?.code).toBe("22023");
    }
    expect((await owner.rpc("record_export", { p_tenant: X, p_kind: "shipments", p_filters: { status: "issued", has_query: true }, p_row_count: 1, p_truncated: false })).error).toBeNull();
    expect((await owner.rpc("record_export", { p_tenant: X, p_kind: "contacts", p_filters: {}, p_row_count: 1, p_truncated: false })).error?.code).toBe("22023");
    expect((await operator.rpc("record_export", { p_tenant: X, p_kind: "pilot_report", p_filters: {}, p_row_count: 1, p_truncated: false })).error?.message).toBe("admin_required");
  });
});
