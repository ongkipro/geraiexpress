// T-047 / PR-16 / PR-6 / PR-22 / DATA-10 / TEN-1: immutable invoice snapshots and the audit of CSV exports.
// An invoice is one append-only charge document per real issued shipment, numbered <PREFIX>-INV-<yymmdd>-<seq>
// per tenant and WIB day, carrying only the sender-facing shipping charge; the export audit command is for
// tenant administrators. Nothing here reaches Mengantar.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { IDS, client, demoVisitor, signIn, sql, containsAmount } from "./helpers";

const OWNER_A = "00000000-0000-4000-a000-0000000000a1";
const NET_COST_SENTINEL = 13579;
const CHARGE_SENTINEL = 24680;

const shipments: string[] = [];

// A freshly reset stack answers 503 (PGRST002) until PostgREST has rebuilt its schema cache. A real wait
// on the real service: there is no event to await (same readiness loop as tests/db/masked-label.test.ts).
beforeAll(async () => {
  for (let attempt = 0; attempt < 60; attempt++) {
    const { error } = await client().rpc("registration_open");
    if (error?.code !== "PGRST002" && error?.code !== "PGRST001") break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  sql(`update public.tenants set contact_whatsapp = '081355550000' where id in ('${IDS.tenantA}', '${IDS.tenantB}')`);
}, 90000);

afterAll(() => {
  // Cascade removal of a purged shipment is the one allowed removal of invoice snapshots.
  if (shipments.length > 0) {
    const ids = shipments.map((i) => `'${i}'`).join(",");
    sql(`update public.shipments set selected_quote_id = null where id in (${ids}); delete from public.shipments where id in (${ids})`);
  }
  sql(`update public.tenants set contact_whatsapp = null, contact_whatsapp_revision = 0 where id in ('${IDS.tenantA}', '${IDS.tenantB}')`);
});

// A real (non-simulated) issued shipment built with superuser SQL; no provider_operations row, so nothing
// for the dispatch sweep to pick up. Synthetic data only.
function realShipment(opts: { tenant?: string; outlet?: string; state?: string; awb?: string | null; simulated?: boolean; cod?: number; charge?: number | null } = {}) {
  const tenant = opts.tenant ?? IDS.tenantA, outlet = opts.outlet ?? IDS.outletA;
  const id = randomUUID(), quote = randomUUID();
  const awb = opts.awb === undefined ? "JP1234567890" : opts.awb;
  const charge = opts.charge === undefined ? CHARGE_SENTINEL : opts.charge;
  shipments.push(id);
  sql(`
    insert into public.shipments (tenant_id, outlet_id, id, reference, submission_state, payment_state, sender_name, sender_phone,
      recipient_name, recipient_phone, recipient_address, recipient_area, recipient_postal_code, item_description, weight_grams,
      goods_value_idr, is_cod, cod_amount_idr, is_simulated, created_by, submitted_at, issued_at, awb, customer_charge_idr, pickup_snapshot)
    values ('${tenant}', '${outlet}', '${id}', 'GXINV-${id.slice(0, 8).toUpperCase()}', '${opts.state ?? "issued"}', 'paid', 'Pengirim Asli', '081200000099',
      'Penerima Uji', '081234567890', 'Jl. Tujuan Uji No. 9', 'Kec. Tujuan, Kota Uji', '40132', 'Buku', 1500,
      50000, ${opts.cod ? "true" : "false"}, ${opts.cod ?? "null"}, ${opts.simulated ? "true" : "false"}, '${OWNER_A}', now(), now(),
      ${awb === null ? "null" : `'${awb}'`}, ${charge === null ? "null" : charge},
      jsonb_build_object('outlet', 'Pickup Mengantar Rahasia', 'address', 'Jl. Pickup Nyata No. 5', 'area', 'Kec. Pickup, Kota Nyata'));
    insert into public.shipment_quotes (tenant_id, shipment_id, id, shipment_revision, courier, service, normal_tariff_idr,
      eta_days, is_simulated, expires_at)
      values ('${tenant}', '${id}', '${quote}', 1, 'JT', 'REG', ${CHARGE_SENTINEL}, '1-2', false, now() + interval '1 hour');
    insert into private.quote_costs (tenant_id, quote_id, net_shipping_idr) values ('${tenant}', '${quote}', ${NET_COST_SENTINEL});
    update public.shipments set selected_quote_id = '${quote}' where id = '${id}';`);
  return id;
}

const snapshotRow = (id: string) => JSON.parse(sql(`select row_to_json(s) from public.invoice_snapshots s where id = '${id}'`)) as Record<string, unknown>;
const count = (table: string, where: string) => Number(sql(`select count(*) from public.${table} where ${where}`));
const seqOf = (number: unknown) => Number(String(number).split("-").at(-1));
const wibDay = () => sql(`select to_char(now() at time zone 'Asia/Jakarta', 'YYMMDD')`);

describe("create_invoice_snapshot (PR-16, DATA-10)", () => {
  it("numbers invoices <PREFIX>-INV-<yymmdd>-<seq> per tenant, and the snapshot freezes the gerai and charge", async () => {
    const owner = await signIn("owner-a@geraiexpress.test");
    const prefix = sql(`select shipment_prefix from public.tenants where id = '${IDS.tenantA}'`);
    const first = realShipment({ cod: 150000 });
    const second = realShipment();
    const a = await owner.rpc("create_invoice_snapshot", { p_shipment: first });
    const b = await owner.rpc("create_invoice_snapshot", { p_shipment: second });
    expect(a.error).toBeNull();
    expect(b.error).toBeNull();
    const rowA = snapshotRow(a.data as string), rowB = snapshotRow(b.data as string);
    expect(rowA.invoice_number).toMatch(new RegExp(`^${prefix}-INV-${wibDay()}-[0-9]{3,}$`));
    expect(seqOf(rowB.invoice_number)).toBe(seqOf(rowA.invoice_number) + 1);
    expect(rowA).toMatchObject({
      tenant_id: IDS.tenantA, shipment_id: first, gerai_name: "Gerai Uji A", gerai_whatsapp: "081355550000",
      gerai_address: "Jl. Pickup Nyata No. 5, Kec. Pickup, Kota Nyata", sender_name: "Pengirim Asli",
      recipient_name: "Penerima Uji", recipient_area: "Kec. Tujuan, Kota Uji", item_description: "Buku", weight_grams: 1500,
      courier: "JT", service: "REG", shipping_charge_idr: CHARGE_SENTINEL, is_cod: true, cod_amount_idr: 150000,
      awb: "JP1234567890", created_by: OWNER_A,
    });
    expect(rowA.content_digest).toMatch(/^[0-9a-f]{64}$/);
    expect(rowB).toMatchObject({ is_cod: false, cod_amount_idr: null });
    // The audit row carries the number and ids but no party data.
    const audit = sql(`select detail::text from public.audit_events where action = 'invoice.snapshot' and detail ->> 'snapshot' = '${a.data}'`);
    expect(audit).toContain(String(rowA.invoice_number));
    expect(audit).not.toContain("Penerima Uji");
  });

  it("the stored invoice carries no net cost, discount or platform remainder", async () => {
    const owner = await signIn("owner-a@geraiexpress.test");
    const id = realShipment();
    const snap = (await owner.rpc("create_invoice_snapshot", { p_shipment: id })).data as string;
    const row = snapshotRow(snap);
    expect(Object.keys(row).filter((k) => /net|cost|discount|diskon|margin|remainder|percent/.test(k))).toEqual([]);
    expect(containsAmount(row, NET_COST_SENTINEL)).toBe(false);
    const readBack = await owner.from("invoice_snapshots").select("*").eq("id", snap).single();
    expect(containsAmount(readBack.data, NET_COST_SENTINEL)).toBe(false);
  });

  it("is idempotent: a repeated call returns the same snapshot and consumes no number", async () => {
    const owner = await signIn("owner-a@geraiexpress.test");
    const id = realShipment();
    const first = (await owner.rpc("create_invoice_snapshot", { p_shipment: id })).data as string;
    const again = (await owner.rpc("create_invoice_snapshot", { p_shipment: id })).data as string;
    expect(again).toBe(first);
    expect(count("invoice_snapshots", `shipment_id = '${id}'`)).toBe(1);
    const next = (await owner.rpc("create_invoice_snapshot", { p_shipment: realShipment() })).data as string;
    expect(seqOf(snapshotRow(next).invoice_number)).toBe(seqOf(snapshotRow(first).invoice_number) + 1);
    // Later changes to the shipment or the tenant never rewrite the stored invoice.
    sql(`update public.tenants set contact_whatsapp = '081399990000' where id = '${IDS.tenantA}'`);
    expect(((await owner.rpc("create_invoice_snapshot", { p_shipment: id })).data as string)).toBe(first);
    expect(snapshotRow(first).gerai_whatsapp).toBe("081355550000");
    sql(`update public.tenants set contact_whatsapp = '081355550000' where id = '${IDS.tenantA}'`);
  });

  it("concurrent calls: the same shipment yields one snapshot, different shipments yield distinct numbers", async () => {
    const owner = await signIn("owner-a@geraiexpress.test");
    const same = realShipment();
    const sameResults = await Promise.all(Array.from({ length: 6 }, () => owner.rpc("create_invoice_snapshot", { p_shipment: same })));
    expect(sameResults.map((r) => r.error)).toEqual(Array(6).fill(null));
    expect(new Set(sameResults.map((r) => r.data)).size).toBe(1);
    expect(count("invoice_snapshots", `shipment_id = '${same}'`)).toBe(1);

    const many = Array.from({ length: 8 }, () => realShipment());
    const results = await Promise.all(many.map((id) => owner.rpc("create_invoice_snapshot", { p_shipment: id })));
    expect(results.map((r) => r.error)).toEqual(Array(8).fill(null));
    const numbers = results.map((r) => String(snapshotRow(r.data as string).invoice_number));
    expect(new Set(numbers).size).toBe(8);
  });

  it("an operator, being a member, may issue the invoice", async () => {
    const operator = await signIn("operator-a@geraiexpress.test");
    const r = await operator.rpc("create_invoice_snapshot", { p_shipment: realShipment() });
    expect(r.error).toBeNull();
    expect(snapshotRow(r.data as string).created_by).toBe("00000000-0000-4000-a000-0000000000a2");
  });

  it("refuses simulated, unissued, no-AWB, unknown-charge and no-WhatsApp shipments without creating anything", async () => {
    const owner = await signIn("owner-a@geraiexpress.test");
    const refusals: [string, string, string][] = [
      [realShipment({ simulated: true }), "simulated_shipment", "simulated"],
      [realShipment({ state: "queued" }), "no_awb", "not issued"],
      [realShipment({ awb: null }), "no_awb", "no AWB"],
      [realShipment({ awb: "x" }), "no_awb", "malformed AWB"],
      [realShipment({ charge: null }), "charge_unknown", "unknown charge is never zero"],
    ];
    for (const [id, code, why] of refusals) {
      const r = await owner.rpc("create_invoice_snapshot", { p_shipment: id });
      expect(r.error?.message, why).toBe(code);
      expect(r.error?.code, why).toBe("55000");
      expect(count("invoice_snapshots", `shipment_id = '${id}'`), why).toBe(0);
    }
    const ok = realShipment();
    sql(`update public.tenants set contact_whatsapp = null where id = '${IDS.tenantA}'`);
    const missing = await owner.rpc("create_invoice_snapshot", { p_shipment: ok });
    sql(`update public.tenants set contact_whatsapp = '081355550000' where id = '${IDS.tenantA}'`);
    expect(missing.error?.message).toBe("whatsapp_missing");
    expect(count("invoice_snapshots", `shipment_id = '${ok}'`)).toBe(0);
    // A refused issuance rolls its number back: the next invoice continues the sequence without a gap.
    const before = Number(sql(`select coalesce(max(last_seq), 0) from private.invoice_counters where tenant_id = '${IDS.tenantA}'`));
    const next = await owner.rpc("create_invoice_snapshot", { p_shipment: ok });
    expect(seqOf(snapshotRow(next.data as string).invoice_number)).toBe(before + 1);
  });
});

describe("invoice snapshots cannot be rewritten (DATA-10)", () => {
  it("API roles have no write path, and not even superuser can update, delete or truncate", async () => {
    const owner = await signIn("owner-a@geraiexpress.test");
    const id = realShipment();
    const snap = (await owner.rpc("create_invoice_snapshot", { p_shipment: id })).data as string;
    const forged = { tenant_id: IDS.tenantA, shipment_id: id, invoice_number: "ZZZ-INV-010101-001", gerai_name: "x", gerai_whatsapp: "081355550000", shipping_charge_idr: 1, is_cod: false, awb: "JP1234567890", shipment_reference: "x", content_digest: "0".repeat(64), created_by: OWNER_A };
    for (const c of [owner, await signIn("operator-a@geraiexpress.test"), client()]) {
      expect((await c.from("invoice_snapshots").insert(forged)).error?.code, "insert").toBe("42501");
      expect((await c.from("invoice_snapshots").update({ shipping_charge_idr: 1 }).eq("tenant_id", IDS.tenantA)).error?.code, "update").toBe("42501");
      expect((await c.from("invoice_snapshots").delete().eq("tenant_id", IDS.tenantA)).error?.code, "delete").toBe("42501");
    }
    expect(() => sql(`update public.invoice_snapshots set shipping_charge_idr = 1 where id = '${snap}'`)).toThrow(/invoice_is_append_only/);
    expect(() => sql(`delete from public.invoice_snapshots where id = '${snap}'`)).toThrow(/invoice_is_append_only/);
    expect(() => sql(`truncate public.invoice_snapshots cascade`)).toThrow(/invoice_is_append_only/);
    expect(snapshotRow(snap).shipping_charge_idr).toBe(CHARGE_SENTINEL);
  });

  it("an invoice cannot be attached to another tenant's shipment, and the number is unique per tenant", async () => {
    const owner = await signIn("owner-a@geraiexpress.test");
    const id = realShipment();
    const snap = (await owner.rpc("create_invoice_snapshot", { p_shipment: id })).data as string;
    const row = snapshotRow(snap);
    expect(() => sql(`insert into public.invoice_snapshots (tenant_id, shipment_id, invoice_number, gerai_name, gerai_whatsapp,
      shipping_charge_idr, is_cod, awb, shipment_reference, content_digest, created_by)
      values ('${IDS.tenantB}', '${id}', 'ZZZ-INV-010101-001', 'x', '081355550000', 1, false, 'JP1234567890', 'x', '${"0".repeat(64)}', '${OWNER_A}')`)).toThrow(/foreign key/);
    expect(() => sql(`insert into public.invoice_snapshots (tenant_id, shipment_id, invoice_number, gerai_name, gerai_whatsapp,
      shipping_charge_idr, is_cod, awb, shipment_reference, content_digest, created_by)
      values ('${IDS.tenantA}', '${realShipment()}', '${row.invoice_number}', 'x', '081355550000', 1, false, 'JP1234567890', 'x', '${"0".repeat(64)}', '${OWNER_A}')`)).toThrow(/duplicate key/);
  });

  it("purging a shipment removes its invoice by cascade, the only allowed removal", async () => {
    const owner = await signIn("owner-a@geraiexpress.test");
    const id = realShipment();
    const snap = (await owner.rpc("create_invoice_snapshot", { p_shipment: id })).data as string;
    sql(`update public.shipments set selected_quote_id = null where id = '${id}'; delete from public.shipments where id = '${id}'`);
    expect(count("invoice_snapshots", `id = '${snap}'`)).toBe(0);
  });
});

describe("tenant isolation of invoices (TEN-1)", () => {
  it("another tenant's admin and anon cannot create or read, and each tenant numbers on its own counter", async () => {
    const owner = await signIn("owner-a@geraiexpress.test");
    const id = realShipment();
    const snap = (await owner.rpc("create_invoice_snapshot", { p_shipment: id })).data as string;
    const otherAdmin = await signIn("owner-b@geraiexpress.test");
    expect((await otherAdmin.rpc("create_invoice_snapshot", { p_shipment: id })).error?.message).toBe("not_found");
    expect((await otherAdmin.rpc("create_invoice_snapshot", { p_shipment: randomUUID() })).error?.message).toBe("not_found");
    expect((await otherAdmin.from("invoice_snapshots").select("id").eq("shipment_id", id)).data).toEqual([]);
    expect((await otherAdmin.from("invoice_snapshots").select("id").eq("id", snap)).data).toEqual([]);
    const anon = client();
    expect((await anon.rpc("create_invoice_snapshot", { p_shipment: id })).error?.code).toBe("42501");
    expect((await anon.from("invoice_snapshots").select("tenant_id")).error?.code).toBe("42501");

    const own = realShipment({ tenant: IDS.tenantB, outlet: IDS.outletB });
    expect((await owner.rpc("create_invoice_snapshot", { p_shipment: own })).error?.message).toBe("not_found");
    const bSnap = await otherAdmin.rpc("create_invoice_snapshot", { p_shipment: own });
    expect(bSnap.error).toBeNull();
    const bRow = snapshotRow(bSnap.data as string);
    const bPrefix = sql(`select shipment_prefix from public.tenants where id = '${IDS.tenantB}'`);
    expect(bRow).toMatchObject({ tenant_id: IDS.tenantB, gerai_name: "Gerai Uji B" });
    expect(String(bRow.invoice_number).startsWith(`${bPrefix}-INV-`)).toBe(true);
    expect((await owner.from("invoice_snapshots").select("id").eq("shipment_id", own)).data).toEqual([]);
  });

  it("a demo tenant's shipments are simulated and never get an invoice", async () => {
    const demo = await demoVisitor();
    const { data: ship } = await demo.c.from("shipments").select("id").eq("tenant_id", demo.tenant).eq("is_simulated", true).limit(1).single();
    expect((await demo.c.rpc("create_invoice_snapshot", { p_shipment: ship!.id })).error?.message).toBe("simulated_shipment");
  });
});

describe("record_export audits a CSV export (PR-16)", () => {
  const filters = { status: "issued", from: "2026-10-01", to: "2026-10-28", has_query: true };

  it("a tenant administrator records who, the filters and the row count", async () => {
    const owner = await signIn("owner-a@geraiexpress.test");
    const r = await owner.rpc("record_export", { p_tenant: IDS.tenantA, p_kind: "shipments", p_filters: filters, p_row_count: 42, p_truncated: false });
    expect(r.error).toBeNull();
    const row = JSON.parse(sql(`select row_to_json(e) from public.audit_events e where action = 'export.shipments' and target_tenant = '${IDS.tenantA}' order by id desc limit 1`));
    expect(row).toMatchObject({ actor: OWNER_A, outcome: "ok", detail: { filters, rows: 42, truncated: false } });
    const cut = await owner.rpc("record_export", { p_tenant: IDS.tenantA, p_kind: "shipments", p_filters: {}, p_row_count: 10000, p_truncated: true });
    expect(cut.error).toBeNull();
    expect(sql(`select outcome from public.audit_events where action = 'export.shipments' order by id desc limit 1`)).toBe("truncated");
  });

  it("operators, outsiders and anon are refused, and nothing is audited", async () => {
    const before = count("audit_events", `action = 'export.shipments'`);
    const args = { p_tenant: IDS.tenantA, p_kind: "shipments", p_filters: {}, p_row_count: 1, p_truncated: false };
    const operator = await signIn("operator-a@geraiexpress.test");
    expect((await operator.rpc("record_export", args)).error).toMatchObject({ code: "42501", message: "admin_required" });
    expect((await (await signIn("owner-b@geraiexpress.test")).rpc("record_export", args)).error?.message).toBe("not_found");
    expect((await client().rpc("record_export", args)).error?.code).toBe("42501");
    const demo = await demoVisitor();
    expect((await demo.c.rpc("record_export", { ...args, p_tenant: demo.tenant })).error?.message).toBe("demo_restricted");
    expect(count("audit_events", `action = 'export.shipments'`)).toBe(before);
  });

  it("refuses malformed input: other kinds, counts outside 0..10000, free-text filter keys", async () => {
    const owner = await signIn("owner-a@geraiexpress.test");
    const base = { p_tenant: IDS.tenantA, p_kind: "shipments", p_filters: {}, p_row_count: 1, p_truncated: false };
    for (const bad of [
      { p_kind: "contacts" }, { p_row_count: -1 }, { p_row_count: 10001 }, { p_filters: { q: "Budi" } }, { p_filters: [] },
    ]) {
      expect((await owner.rpc("record_export", { ...base, ...bad })).error?.code, JSON.stringify(bad)).toBe("22023");
    }
  });

  it("the exact export read (shipments with the chosen quote and label snapshots embedded) is tenant-scoped by RLS", async () => {
    const owner = await signIn("owner-a@geraiexpress.test");
    const own = realShipment();
    const other = realShipment({ tenant: IDS.tenantB, outlet: IDS.outletB });
    const select = "reference, created_at, submission_state, payment_state, awb, customer_charge_idr, is_cod, cod_amount_idr, "
      + "quote:shipment_quotes!shipments_tenant_id_selected_quote_id_fkey(courier, service), labels:label_snapshots(version, mask_sender)";
    const { data, error } = await owner.from("shipments").select(select).in("id", [own, other]);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data![0]).toMatchObject({ quote: { courier: "JT", service: "REG" }, labels: [], customer_charge_idr: CHARGE_SENTINEL });
    expect(containsAmount(data, NET_COST_SENTINEL)).toBe(false);
  });
});
