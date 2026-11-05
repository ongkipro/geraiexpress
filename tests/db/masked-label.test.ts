// T-044 / PR-34 / PR-6 / DATA-10 / TD-13 / DEC-017 / DEC-018 item 3: the masked local label.
// The tenant-level gerai WhatsApp is initialized at approval and changed only by an audited tenant
// administrator command; masking is a per-shipment choice the platform can disable per tenant; every
// label is an immutable snapshot with an append-only print history; nothing here reaches Mengantar.
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { IDS, client, demoVisitor, signIn, signInAal2, sql, verifiedNewUser } from "./helpers";

const OWNER_A = "00000000-0000-4000-a000-0000000000a1";
const OPERATOR_A = "00000000-0000-4000-a000-0000000000a2";
const NET_COST_SENTINEL = 13579;
const CHARGE_SENTINEL = 24680;

const shipments: string[] = [];
const tenants: string[] = [];
const q = (s: string) => s.replace(/'/g, "''");

// A freshly reset stack answers 503 (PGRST002) until PostgREST has rebuilt its schema cache. A real wait
// on the real service: there is no event to await (same readiness loop as tests/db/privileges.test.ts).
beforeAll(async () => {
  for (let attempt = 0; attempt < 60; attempt++) {
    const { error } = await client().rpc("registration_open");
    if (error?.code !== "PGRST002" && error?.code !== "PGRST001") return;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("PostgREST schema cache did not become ready");
}, 90000);

afterAll(() => {
  // Cascade removal of a purged shipment or tenant is the one allowed removal of snapshots/events.
  if (shipments.length > 0) {
    const ids = shipments.map((i) => `'${i}'`).join(",");
    sql(`update public.shipments set selected_quote_id = null where id in (${ids}); delete from public.shipments where id in (${ids})`);
  }
  if (tenants.length > 0) sql(`delete from public.tenants where id in (${tenants.map((i) => `'${i}'`).join(",")})`);
  sql(`update public.tenants set contact_whatsapp = null, contact_whatsapp_revision = 0, masking_allowed = true where id in ('${IDS.tenantA}', '${IDS.tenantB}')`);
});

// A real (non-simulated) issued shipment built with superuser SQL; no provider_operations row, so
// nothing for the dispatch sweep to pick up. Synthetic data only.
function realShipment(opts: { tenant?: string; outlet?: string; state?: string; awb?: string | null; simulated?: boolean; cod?: number } = {}) {
  const tenant = opts.tenant ?? IDS.tenantA, outlet = opts.outlet ?? IDS.outletA;
  const id = randomUUID(), quote = randomUUID();
  const awb = opts.awb === undefined ? "JP1234567890" : opts.awb;
  shipments.push(id);
  sql(`
    insert into public.shipments (tenant_id, outlet_id, id, reference, submission_state, payment_state, sender_name, sender_phone,
      recipient_name, recipient_phone, recipient_address, recipient_area, recipient_postal_code, item_description, weight_grams,
      goods_value_idr, is_cod, cod_amount_idr, is_simulated, created_by, submitted_at, issued_at, awb, customer_charge_idr, pickup_snapshot)
    values ('${tenant}', '${outlet}', '${id}', 'GXLBL-${id.slice(0, 8).toUpperCase()}', '${opts.state ?? "issued"}', 'paid', 'Pengirim Asli', '081200000099',
      'Penerima Uji', '081234567890', 'Jl. Tujuan Uji No. 9', 'Kec. Tujuan, Kota Uji', '40132', 'Buku', 1500,
      50000, ${opts.cod ? "true" : "false"}, ${opts.cod ?? "null"}, ${opts.simulated ? "true" : "false"}, '${OWNER_A}', now(), now(),
      ${awb === null ? "null" : `'${awb}'`}, ${CHARGE_SENTINEL},
      jsonb_build_object('outlet', 'Pickup Mengantar Rahasia', 'address', 'Jl. Pickup Nyata No. 5', 'area', 'Kec. Pickup, Kota Nyata'));
    insert into public.shipment_quotes (tenant_id, shipment_id, id, shipment_revision, courier, service, normal_tariff_idr,
      eta_days, is_simulated, expires_at)
      values ('${tenant}', '${id}', '${quote}', 1, 'JT', 'REG', ${CHARGE_SENTINEL}, '1-2', false, now() + interval '1 hour');
    insert into private.quote_costs (tenant_id, quote_id, net_shipping_idr) values ('${tenant}', '${quote}', ${NET_COST_SENTINEL});
    update public.shipments set selected_quote_id = '${quote}' where id = '${id}';`);
  return id;
}

const snapshotRow = (id: string) => JSON.parse(sql(`select row_to_json(s) from public.label_snapshots s where id = '${id}'`)) as Record<string, unknown>;
const count = (table: string, where: string) => Number(sql(`select count(*) from public.${table} where ${where}`));

describe("tenant WhatsApp normalization and constraint (PR-34)", () => {
  it("canonicalizes +62, 62 and separators and refuses anything that is not ^0[2-9][0-9]{7,11}$", () => {
    const cases: [string | null, string | null][] = [
      ["081234567890", "081234567890"],
      ["+6281234567890", "081234567890"],
      ["6281234567890", "081234567890"],
      ["0812-3456-7890", "081234567890"],
      ["+62 812 3456 7890", "081234567890"],
      ["(021) 555-1234", "0215551234"],
      ["0112345678", null],
      ["12345", null],
      ["+14155550123", null],
      ["08123456", null],
      ["0812345678901234", null],
      ["abc", null],
      ["", null],
      [null, null],
    ];
    for (const [input, expected] of cases) {
      const got = sql(`select coalesce(private.normalize_whatsapp(${input === null ? "null" : `'${q(input)}'`}), '<null>')`);
      expect(got, String(input)).toBe(expected ?? "<null>");
    }
  });

  it("the column accepts only canonical values even for superuser writes", () => {
    expect(() => sql(`update public.tenants set contact_whatsapp = '+6281234567890' where id = '${IDS.tenantA}'`)).toThrow(/tenants_contact_whatsapp_format/);
    expect(() => sql(`update public.tenants set contact_whatsapp = '0112345678' where id = '${IDS.tenantA}'`)).toThrow(/tenants_contact_whatsapp_format/);
    sql(`update public.tenants set contact_whatsapp = '081234567890' where id = '${IDS.tenantA}'`);
    sql(`update public.tenants set contact_whatsapp = null where id = '${IDS.tenantA}'`);
  });
});

describe("approval initializes contact_whatsapp (PR-30, PR-34)", () => {
  async function approve(phone: string) {
    const applicant = await verifiedNewUser("wa");
    const saved = await applicant.c.rpc("save_application", {
      p_expected_revision: 0, p_business_name: `Toko WA ${Date.now()}`, p_outlet_name: "Outlet WA",
      p_pickup_address: "Jl. Pendaftaran No. 7", p_pickup_area: "Kec. Uji, Kota Daftar", p_contact_phone: phone,
    });
    expect(saved.error).toBeNull();
    const { id } = saved.data![0] as { id: string };
    expect((await applicant.c.rpc("submit_application", { p_id: id, p_expected_revision: 1 })).error).toBeNull();
    const admin = await signInAal2("admin@geraiexpress.test");
    const ok = await admin.rpc("platform_review_application", { p_id: id, p_expected_revision: 2, p_decision: "approve", p_reason: "Data lengkap" });
    expect(ok.error).toBeNull();
    tenants.push(ok.data as string);
    return ok.data as string;
  }

  it("copies the application phone, normalized, and keeps the rest of the approval intact", async () => {
    const plus = await approve("+6281355557777");
    expect(sql(`select contact_whatsapp from public.tenants where id = '${plus}'`)).toBe("081355557777");
    expect(sql(`select lifecycle || '/' || masking_allowed || '/' || contact_whatsapp_revision from public.tenants where id = '${plus}'`)).toBe("active/true/0");
    expect(sql(`select slug is not null and shipment_prefix is not null from public.tenants where id = '${plus}'`)).toBe("t");
    expect(count("outlets", `tenant_id = '${plus}'`)).toBe(1);
    expect(count("memberships", `tenant_id = '${plus}' and role = 'tenant_admin'`)).toBe(1);

    const local = await approve("081355558888");
    expect(sql(`select contact_whatsapp from public.tenants where id = '${local}'`)).toBe("081355558888");
    const bare62 = await approve("6281355559999");
    expect(sql(`select contact_whatsapp from public.tenants where id = '${bare62}'`)).toBe("081355559999");
  });

  it("leaves the field empty when the application phone does not validate", async () => {
    const foreign = await approve("+14155550123");
    expect(sql(`select coalesce(contact_whatsapp, '<null>') from public.tenants where id = '${foreign}'`)).toBe("<null>");
    expect(count("tenants", `id = '${foreign}' and lifecycle = 'active'`)).toBe(1);
    const short = await approve("08123456");
    expect(sql(`select coalesce(contact_whatsapp, '<null>') from public.tenants where id = '${short}'`)).toBe("<null>");
  });

  it("the migration backfill takes the latest approved application only where it validates", () => {
    const migration = readFileSync("db/migrations/20261028150000_masked_label.sql", "utf8");
    const backfill = /update public\.tenants t set contact_whatsapp = n\.value[\s\S]*?;\n/.exec(migration)?.[0];
    expect(backfill).toBeDefined();
    const [latest, invalid, kept] = [randomUUID(), randomUUID(), randomUUID()];
    tenants.push(latest, invalid, kept);
    sql(`insert into public.tenants (id, name, lifecycle) values ('${latest}', 'Gerai Backfill Satu', 'active'), ('${invalid}', 'Gerai Backfill Dua', 'active');
      insert into public.tenants (id, name, lifecycle, contact_whatsapp) values ('${kept}', 'Gerai Backfill Tiga', 'active', '081200001111');
      insert into public.tenant_applications (applicant, status, tenant_id, contact_phone, reviewed_at) values
        ('${OWNER_A}', 'approved', '${latest}', '+6281200000001', now() - interval '2 days'),
        ('${OWNER_A}', 'approved', '${latest}', '+6281200000002', now() - interval '1 day'),
        ('${OWNER_A}', 'approved', '${invalid}', '+14155550123', now()),
        ('${OWNER_A}', 'approved', '${kept}', '081299990000', now());
      ${backfill}`);
    expect(sql(`select contact_whatsapp from public.tenants where id = '${latest}'`)).toBe("081200000002");
    expect(sql(`select coalesce(contact_whatsapp, '<null>') from public.tenants where id = '${invalid}'`)).toBe("<null>");
    expect(sql(`select contact_whatsapp from public.tenants where id = '${kept}'`)).toBe("081200001111");
    sql(`delete from public.tenant_applications where tenant_id in ('${latest}', '${invalid}', '${kept}')`);
  });
});

describe("only a tenant administrator changes the gerai WhatsApp, with audit (PR-34)", () => {
  it("an operator, another tenant's admin, anon and a direct column write are all refused", async () => {
    const operator = await signIn("operator-a@geraiexpress.test");
    const otherAdmin = await signIn("owner-b@geraiexpress.test");
    const owner = await signIn("owner-a@geraiexpress.test");
    const args = { p_tenant: IDS.tenantA, p_value: "081234567890" };
    expect((await operator.rpc("set_tenant_contact_whatsapp", args)).error?.message).toBe("admin_required");
    expect((await otherAdmin.rpc("set_tenant_contact_whatsapp", args)).error?.message).toBe("admin_required");
    expect((await client().rpc("set_tenant_contact_whatsapp", args)).error?.code).toBe("42501");
    for (const c of [operator, owner, otherAdmin]) {
      for (const patch of [{ contact_whatsapp: "081234567890" }, { masking_allowed: false }, { contact_whatsapp_revision: 9 }]) {
        const res = await c.from("tenants").update(patch).eq("id", IDS.tenantA);
        expect(res.error?.code, JSON.stringify(patch)).toBe("42501");
      }
    }
    expect(sql(`select coalesce(contact_whatsapp, '<null>') || '/' || masking_allowed from public.tenants where id = '${IDS.tenantA}'`)).toBe("<null>/true");
  });

  it("a valid value is saved normalized with an audit row that holds no full number; invalid and stale are refused", async () => {
    const owner = await signIn("owner-a@geraiexpress.test");
    for (const bad of ["", "  ", "0812", "+14155550123", "0112345678", "abc"]) {
      expect((await owner.rpc("set_tenant_contact_whatsapp", { p_tenant: IDS.tenantA, p_value: bad })).error?.message, bad).toBe("invalid_whatsapp");
    }
    const first = await owner.rpc("set_tenant_contact_whatsapp", { p_tenant: IDS.tenantA, p_value: "+62 812-3456-7890", p_expected_revision: 0 });
    expect(first.error).toBeNull();
    expect(first.data).toBe("081234567890");
    expect(sql(`select contact_whatsapp || '/' || contact_whatsapp_revision from public.tenants where id = '${IDS.tenantA}'`)).toBe("081234567890/1");
    // A stale revision (another administrator saved first) is refused and changes nothing.
    expect((await owner.rpc("set_tenant_contact_whatsapp", { p_tenant: IDS.tenantA, p_value: "081355550000", p_expected_revision: 0 })).error?.message).toBe("stale_state");
    expect(sql(`select contact_whatsapp from public.tenants where id = '${IDS.tenantA}'`)).toBe("081234567890");
    const second = await owner.rpc("set_tenant_contact_whatsapp", { p_tenant: IDS.tenantA, p_value: "081355550000", p_expected_revision: 1 });
    expect(second.data).toBe("081355550000");
    // Saving the value already stored is not a change: no revision bump and no extra audit row.
    expect((await owner.rpc("set_tenant_contact_whatsapp", { p_tenant: IDS.tenantA, p_value: "6281355550000" })).data).toBe("081355550000");
    expect(sql(`select contact_whatsapp_revision from public.tenants where id = '${IDS.tenantA}'`)).toBe("2");
    const audit = JSON.parse(sql(`select coalesce(json_agg(json_build_object('outcome', outcome, 'actor', actor, 'detail', detail) order by id), '[]'::json)
      from public.audit_events where action = 'tenant.contact_whatsapp' and target_tenant = '${IDS.tenantA}'`)) as { outcome: string; actor: string; detail: unknown }[];
    expect(audit.map((a) => a.outcome)).toEqual(["set", "changed"]);
    expect(audit.every((a) => a.actor === OWNER_A)).toBe(true);
    expect(JSON.stringify(audit)).not.toContain("081234567890");
    expect(JSON.stringify(audit)).not.toContain("081355550000");
  });

  it("an operator can read the stored number (the label prompt and settings need it) but not change it", async () => {
    const operator = await signIn("operator-a@geraiexpress.test");
    const { data } = await operator.from("tenants").select("contact_whatsapp, masking_allowed").eq("id", IDS.tenantA);
    expect(data).toEqual([{ contact_whatsapp: "081355550000", masking_allowed: true }]);
  });

  it("a demo tenant's administrator is restricted", async () => {
    const demo = await demoVisitor();
    expect((await demo.c.rpc("set_tenant_contact_whatsapp", { p_tenant: demo.tenant, p_value: "081234567890" })).error?.message).toBe("demo_restricted");
  });
});

describe("the platform alone controls masking_allowed (DEC-018 item 3)", () => {
  it("tenant users and aal1 sessions are refused; an aal2 governor needs a reason and the change is audited", async () => {
    for (const email of ["owner-a@geraiexpress.test", "operator-a@geraiexpress.test", "admin@geraiexpress.test"]) {
      const c = await signIn(email);
      expect((await c.rpc("platform_set_masking_allowed", { p_tenant: IDS.tenantA, p_allowed: false, p_reason: "Pemberitahuan kurir" })).error?.message, email).toBe("platform_access_required");
    }
    expect(sql(`select masking_allowed from public.tenants where id = '${IDS.tenantA}'`)).toBe("t");
    const admin = await signInAal2("admin@geraiexpress.test");
    expect((await admin.rpc("platform_set_masking_allowed", { p_tenant: IDS.tenantA, p_allowed: false, p_reason: "" })).error?.message).toBe("reason_required");
    expect((await admin.rpc("platform_set_masking_allowed", { p_tenant: randomUUID(), p_allowed: false, p_reason: "Pemberitahuan kurir" })).error?.message).toBe("not_found");
    const demo = await demoVisitor();
    expect((await admin.rpc("platform_set_masking_allowed", { p_tenant: demo.tenant, p_allowed: false, p_reason: "Pemberitahuan kurir" })).error?.message).toBe("not_found");
    expect((await admin.rpc("platform_set_masking_allowed", { p_tenant: IDS.tenantA, p_allowed: false, p_reason: "Pemberitahuan kurir" })).data).toBe(false);
    expect(sql(`select masking_allowed from public.tenants where id = '${IDS.tenantA}'`)).toBe("f");
    expect((await admin.rpc("platform_set_masking_allowed", { p_tenant: IDS.tenantA, p_allowed: true, p_reason: "Sudah diperiksa" })).data).toBe(true);
    expect(sql(`select string_agg(outcome, ',' order by id) from public.audit_events where action = 'tenant.masking' and target_tenant = '${IDS.tenantA}'`)).toBe("disabled,allowed");
  });
});

describe("create_label_snapshot (TD-13, DATA-10)", () => {
  it("is unavailable for simulated demo shipments, which keep the sample label", async () => {
    const demo = await demoVisitor();
    const { data: issued } = await demo.c.from("shipments").select("id").eq("submission_state", "issued").limit(1);
    const id = issued![0].id as string;
    expect((await demo.c.rpc("create_label_snapshot", { p_shipment: id, p_mask: false })).error?.message).toBe("simulated_shipment");
    // The sample label path is untouched: request_label still serves the watermarked sample.
    const sample = await demo.c.rpc("request_label", { p_shipment: id });
    expect(sample.error).toBeNull();
    expect(sample.data).toMatchObject({ state: "completed", is_simulated: true });
    expect(count("label_snapshots", `shipment_id = '${id}'`)).toBe(0);
  });

  it("refuses a real shipment without an authoritative AWB and invalid choices; real shipments still get no provider sample", async () => {
    const owner = await signIn("owner-a@geraiexpress.test");
    for (const bad of [realShipment({ state: "unknown", awb: null }), realShipment({ state: "awaiting_payment", awb: null }), realShipment({ awb: null }), realShipment({ awb: "AB" })]) {
      expect((await owner.rpc("create_label_snapshot", { p_shipment: bad, p_mask: false })).error?.message).toBe("no_awb");
    }
    const ok = realShipment();
    sql(`update public.tenants set contact_whatsapp = '081355550000' where id = '${IDS.tenantA}'`);
    expect((await owner.rpc("create_label_snapshot", { p_shipment: ok, p_mask: false, p_size: "10x20" })).error?.message).toBe("invalid_input");
    expect((await owner.rpc("create_label_snapshot", { p_shipment: ok, p_mask: null })).error?.message).toBe("invalid_input");
    expect((await owner.rpc("request_label", { p_shipment: ok })).error?.message).toBe("provider_label_required");
    expect(count("label_snapshots", `shipment_id = '${ok}'`)).toBe(0);
  });

  it("an empty gerai WhatsApp blocks the unmasked label but not the masked one", async () => {
    const operator = await signIn("operator-a@geraiexpress.test");
    const id = realShipment();
    sql(`update public.tenants set contact_whatsapp = null where id = '${IDS.tenantA}'`);
    expect((await operator.rpc("create_label_snapshot", { p_shipment: id, p_mask: false })).error?.message).toBe("whatsapp_missing");
    expect(count("label_snapshots", `shipment_id = '${id}'`)).toBe(0);
    const masked = await operator.rpc("create_label_snapshot", { p_shipment: id, p_mask: true, p_sender_name: "Toko Pelanggan", p_sender_phone: "081311112222", p_sender_city: "Bandung" });
    expect(masked.error).toBeNull();
    sql(`update public.tenants set contact_whatsapp = '081355550000' where id = '${IDS.tenantA}'`);
  });

  it("masking off prints the gerai identity, stores the true identity, never the net cost or the pickup name as sender; operators may print", async () => {
    const operator = await signIn("operator-a@geraiexpress.test");
    const id = realShipment({ cod: 125000 });
    const made = await operator.rpc("create_label_snapshot", { p_shipment: id, p_mask: false });
    expect(made.error).toBeNull();
    const row = snapshotRow(made.data as string);
    expect(row).toMatchObject({
      tenant_id: IDS.tenantA, shipment_id: id, version: 1, size: "10x15", template_version: 1, mask_sender: false,
      printed_sender_name: "Gerai Uji A", printed_sender_phone: "081355550000",
      printed_sender_address: "Jl. Pickup Nyata No. 5", printed_sender_city: "Kec. Pickup, Kota Nyata",
      true_tenant_name: "Gerai Uji A", true_tenant_slug: "gerai-uji-a",
      true_pickup_name: "Pickup Mengantar Rahasia", true_pickup_address: "Jl. Pickup Nyata No. 5", true_pickup_area: "Kec. Pickup, Kota Nyata",
      awb: "JP1234567890", courier: "JT", service: "REG", weight_grams: 1500, is_cod: true, cod_amount_idr: 125000,
      recipient_name: "Penerima Uji", recipient_phone: "081234567890", created_by: OPERATOR_A,
    });
    expect(String(row.content_digest)).toMatch(/^[0-9a-f]{64}$/);
    // The pickup identity is stored for returns and audit but is not the printed sender.
    for (const printed of ["printed_sender_name", "printed_sender_phone", "printed_sender_address", "printed_sender_city"]) {
      expect(String(row[printed])).not.toContain("Rahasia");
    }
    // No cost, discount or price column exists, and no sentinel amount leaks into any value.
    const columns = sql(`select string_agg(column_name, ',') from information_schema.columns where table_schema = 'public' and table_name = 'label_snapshots'`);
    expect(columns).not.toMatch(/cost|net_|discount|charge|tariff|price|fee/);
    expect(JSON.stringify(row)).not.toContain(String(NET_COST_SENTINEL));
    expect(JSON.stringify(row)).not.toContain(String(CHARGE_SENTINEL));
  });

  it("a reprint is a print event on the same snapshot; the history is append-only and records the actor and size", async () => {
    const operator = await signIn("operator-a@geraiexpress.test");
    const owner = await signIn("owner-a@geraiexpress.test");
    const id = realShipment();
    const first = (await operator.rpc("create_label_snapshot", { p_shipment: id, p_mask: false })).data as string;
    const again = (await owner.rpc("create_label_snapshot", { p_shipment: id, p_mask: false })).data as string;
    expect(again).toBe(first);
    expect((await operator.rpc("record_label_print", { p_snapshot: first })).error).toBeNull();
    expect((await owner.rpc("record_label_print", { p_snapshot: first })).error).toBeNull();
    expect(count("label_snapshots", `shipment_id = '${id}'`)).toBe(1);
    const events = JSON.parse(sql(`select json_agg(json_build_object('snapshot', snapshot_id, 'size', size, 'actor', actor, 'shipment', shipment_id) order by id)
      from public.label_print_events where shipment_id = '${id}'`)) as { snapshot: string; size: string; actor: string; shipment: string }[];
    expect(events).toEqual([
      { snapshot: first, size: "10x15", actor: OPERATOR_A, shipment: id },
      { snapshot: first, size: "10x15", actor: OWNER_A, shipment: id },
    ]);
    // Members read the history through RLS.
    expect((await operator.from("label_print_events").select("id").eq("shipment_id", id)).data).toHaveLength(2);
  });

  it("masking on requires all three sender fields; a change of switch or fields adds a version within the locked format and leaves the earlier one untouched", async () => {
    const owner = await signIn("owner-a@geraiexpress.test");
    const id = realShipment();
    const off = (await owner.rpc("create_label_snapshot", { p_shipment: id, p_mask: false })).data as string;
    const before = sql(`select row_to_json(s) from public.label_snapshots s where id = '${off}'`);
    const fields = { p_sender_name: "Toko Pelanggan", p_sender_phone: "0813 1111-2222", p_sender_city: "Bandung" };
    for (const missing of ["p_sender_name", "p_sender_phone", "p_sender_city"] as const) {
      for (const empty of [undefined, "", "   "]) {
        const res = await owner.rpc("create_label_snapshot", { p_shipment: id, p_mask: true, ...fields, [missing]: empty });
        expect(res.error?.message, `${missing}=${JSON.stringify(empty)}`).toBe("sender_fields_required");
      }
    }
    for (const bad of [{ p_sender_name: "A" }, { p_sender_name: "x".repeat(61) }, { p_sender_city: "B" }, { p_sender_city: "y".repeat(41) },
      { p_sender_phone: "12345" }, { p_sender_phone: "abc12345678" }, { p_sender_name: "Nama\u0007Bel" }]) {
      expect((await owner.rpc("create_label_snapshot", { p_shipment: id, p_mask: true, ...fields, ...bad })).error?.message, JSON.stringify(bad)).toBe("invalid_input");
    }
    expect(count("label_snapshots", `shipment_id = '${id}'`)).toBe(1);

    const on = (await owner.rpc("create_label_snapshot", { p_shipment: id, p_mask: true, ...fields })).data as string;
    expect(on).not.toBe(off);
    expect(snapshotRow(on)).toMatchObject({
      version: 2, mask_sender: true, printed_sender_name: "Toko Pelanggan", printed_sender_phone: "081311112222",
      printed_sender_address: null, printed_sender_city: "Bandung",
      true_tenant_name: "Gerai Uji A", true_tenant_slug: "gerai-uji-a", true_pickup_name: "Pickup Mengantar Rahasia",
      true_pickup_address: "Jl. Pickup Nyata No. 5", true_pickup_area: "Kec. Pickup, Kota Nyata",
    });
    // The same masked choice is a reprint; a different city makes a version in the same format.
    expect((await owner.rpc("create_label_snapshot", { p_shipment: id, p_mask: true, ...fields, p_sender_phone: "081311112222" })).data).toBe(on);
    const otherCity = (await owner.rpc("create_label_snapshot", { p_shipment: id, p_mask: true, ...fields, p_sender_city: "Cimahi" })).data as string;
    expect(snapshotRow(otherCity)).toMatchObject({ version: 3, printed_sender_city: "Cimahi" });
    const smaller = await owner.rpc("create_label_snapshot", { p_shipment: id, p_mask: true, ...fields, p_sender_city: "Cimahi", p_size: "10x10" });
    expect(smaller.error).toMatchObject({ message: "label_format_locked", code: "55000" });
    expect((await owner.rpc("create_label_snapshot", { p_shipment: id, p_mask: true, ...fields, p_sender_city: "Cimahi" })).data).toBe(otherCity);
    expect(sql(`select row_to_json(s) from public.label_snapshots s where id = '${off}'`)).toBe(before);
    expect(count("label_snapshots", `shipment_id = '${id}'`)).toBe(3);
    // The masked snapshot audit names the outcome and carries no sender or recipient data.
    const audit = sql(`select string_agg(outcome, ',' order by id) from public.audit_events where action = 'label.snapshot' and detail ->> 'shipment' = '${id}'`);
    expect(audit).toBe("gerai_identity,masked,masked");
    expect(sql(`select detail::text from public.audit_events where action = 'label.snapshot' and detail ->> 'snapshot' = '${on}'`)).not.toMatch(/Toko Pelanggan|0813|Bandung|Penerima/);
  });

  it.each(["10x15", "10x10"])("first %s locks the format and same-size reprints reuse it", async (size) => {
    const owner = await signIn("owner-a@geraiexpress.test");
    const id = realShipment();
    const args = { p_shipment: id, p_mask: false, p_size: size };
    const first = await owner.rpc("create_label_snapshot", args);
    expect(first.error).toBeNull();
    expect((await owner.rpc("create_label_snapshot", args)).data).toBe(first.data);
    const refused = await owner.rpc("create_label_snapshot", { ...args, p_size: size === "10x15" ? "10x10" : "10x15" });
    expect(refused.error).toMatchObject({ message: "label_format_locked", code: "55000" });
    expect(count("label_snapshots", `shipment_id = '${id}'`)).toBe(1);
  });

  it("concurrent different-size first prints serialize: exactly one wins, the other is definitively refused", async () => {
    const owner = await signIn("owner-a@geraiexpress.test");
    const operator = await signIn("operator-a@geraiexpress.test");
    const id = realShipment();
    const results = await Promise.all([
      owner.rpc("create_label_snapshot", { p_shipment: id, p_mask: false, p_size: "10x15" }),
      operator.rpc("create_label_snapshot", { p_shipment: id, p_mask: false, p_size: "10x10" }),
    ]);
    expect(results.filter((result) => !result.error)).toHaveLength(1);
    expect(results.find((result) => result.error)?.error).toMatchObject({ message: "label_format_locked", code: "55000" });
    expect(count("label_snapshots", `shipment_id = '${id}'`)).toBe(1);
    const winner = snapshotRow(results.find((result) => !result.error)!.data as string);
    expect((await owner.rpc("create_label_snapshot", { p_shipment: id, p_mask: false, p_size: winner.size })).data).toBe(winner.id);
  });

  it("a tenant with masking disabled gets no masked snapshot, even by a direct RPC call, and its masked snapshot is not reprinted", async () => {
    const owner = await signIn("owner-a@geraiexpress.test");
    const id = realShipment();
    const fields = { p_sender_name: "Toko Pelanggan", p_sender_phone: "081311112222", p_sender_city: "Bandung" };
    const masked = (await owner.rpc("create_label_snapshot", { p_shipment: id, p_mask: true, ...fields })).data as string;
    const admin = await signInAal2("admin@geraiexpress.test");
    expect((await admin.rpc("platform_set_masking_allowed", { p_tenant: IDS.tenantA, p_allowed: false, p_reason: "Pemberitahuan kurir" })).error).toBeNull();
    try {
      const other = realShipment();
      expect((await owner.rpc("create_label_snapshot", { p_shipment: other, p_mask: true, ...fields })).error?.message).toBe("masking_disabled");
      expect((await owner.rpc("create_label_snapshot", { p_shipment: id, p_mask: true, ...fields, p_sender_city: "Cimahi" })).error?.message).toBe("masking_disabled");
      expect((await owner.rpc("record_label_print", { p_snapshot: masked })).error?.message).toBe("masking_disabled");
      expect(count("label_snapshots", `shipment_id = '${other}'`)).toBe(0);
      // The gerai-identity label stays available.
      const off = await owner.rpc("create_label_snapshot", { p_shipment: other, p_mask: false });
      expect(off.error).toBeNull();
      expect((await owner.rpc("record_label_print", { p_snapshot: off.data as string })).error).toBeNull();
    } finally {
      await admin.rpc("platform_set_masking_allowed", { p_tenant: IDS.tenantA, p_allowed: true, p_reason: "Pulihkan uji" });
    }
    expect((await owner.rpc("record_label_print", { p_snapshot: masked })).error).toBeNull();
  });

  it("snapshots hold their content after the tenant, outlet or WhatsApp is edited", async () => {
    const owner = await signIn("owner-a@geraiexpress.test");
    const id = realShipment();
    const snap = (await owner.rpc("create_label_snapshot", { p_shipment: id, p_mask: false })).data as string;
    const before = sql(`select row_to_json(s) from public.label_snapshots s where id = '${snap}'`);
    sql(`update public.outlets set name = 'Outlet Diganti', pickup_address = 'Jl. Diganti 1' where id = '${IDS.outletA}';
      update public.tenants set name = 'Gerai Diganti', contact_whatsapp = '081399990000' where id = '${IDS.tenantA}'`);
    try {
      expect(sql(`select row_to_json(s) from public.label_snapshots s where id = '${snap}'`)).toBe(before);
      // Reprinting with the same choice reproduces the stored snapshot instead of making a new one.
      expect((await owner.rpc("create_label_snapshot", { p_shipment: id, p_mask: false })).data).toBe(snap);
    } finally {
      sql(`update public.outlets set name = 'Outlet Uji A', pickup_address = 'Jl. Uji A No. 1' where id = '${IDS.outletA}';
        update public.tenants set name = 'Gerai Uji A', contact_whatsapp = '081355550000' where id = '${IDS.tenantA}'`);
    }
  });
});

describe("snapshots and history cannot be rewritten (DATA-10)", () => {
  it("API roles have no write path, and not even superuser can update, delete or truncate", async () => {
    const owner = await signIn("owner-a@geraiexpress.test");
    const id = realShipment();
    const snap = (await owner.rpc("create_label_snapshot", { p_shipment: id, p_mask: false })).data as string;
    const event = (await owner.rpc("record_label_print", { p_snapshot: snap })).data as number;
    const forged: Record<string, Record<string, unknown>> = {
      label_snapshots: { tenant_id: IDS.tenantA, shipment_id: id, version: 9, size: "10x15", mask_sender: false },
      label_print_events: { tenant_id: IDS.tenantA, shipment_id: id, snapshot_id: snap, size: "10x15", actor: OWNER_A },
    };
    for (const table of ["label_snapshots", "label_print_events"]) {
      for (const c of [owner, await signIn("operator-a@geraiexpress.test"), client()]) {
        expect((await c.from(table).insert(forged[table])).error?.code, `${table} insert`).toBe("42501");
        expect((await c.from(table).update({ size: "10x10" }).eq("tenant_id", IDS.tenantA)).error?.code, `${table} update`).toBe("42501");
        expect((await c.from(table).delete().eq("tenant_id", IDS.tenantA)).error?.code, `${table} delete`).toBe("42501");
      }
    }
    expect(() => sql(`update public.label_snapshots set printed_sender_name = 'Dipalsukan' where id = '${snap}'`)).toThrow(/label_history_is_append_only/);
    expect(() => sql(`delete from public.label_snapshots where id = '${snap}'`)).toThrow(/label_history_is_append_only/);
    expect(() => sql(`update public.label_print_events set size = '10x10' where id = ${event}`)).toThrow(/label_history_is_append_only/);
    expect(() => sql(`delete from public.label_print_events where id = ${event}`)).toThrow(/label_history_is_append_only/);
    expect(() => sql(`truncate public.label_snapshots cascade`)).toThrow(/label_history_is_append_only/);
    expect(() => sql(`truncate public.label_print_events`)).toThrow(/label_history_is_append_only/);
    expect(count("label_snapshots", `id = '${snap}'`)).toBe(1);
    expect(count("label_print_events", `id = ${event}`)).toBe(1);
  });

  it("an event cannot point at another tenant's snapshot (composite foreign keys)", async () => {
    const owner = await signIn("owner-a@geraiexpress.test");
    const id = realShipment();
    const snap = (await owner.rpc("create_label_snapshot", { p_shipment: id, p_mask: false })).data as string;
    expect(() => sql(`insert into public.label_print_events (tenant_id, shipment_id, snapshot_id, size, actor)
      values ('${IDS.tenantB}', '${id}', '${snap}', '10x15', '${OWNER_A}')`)).toThrow(/foreign key/);
  });

  it("purging a shipment removes its snapshots and history by cascade, the only allowed removal", async () => {
    const owner = await signIn("owner-a@geraiexpress.test");
    const id = realShipment();
    const snap = (await owner.rpc("create_label_snapshot", { p_shipment: id, p_mask: false })).data as string;
    await owner.rpc("record_label_print", { p_snapshot: snap });
    sql(`update public.shipments set selected_quote_id = null where id = '${id}'; delete from public.shipments where id = '${id}'`);
    expect(count("label_snapshots", `id = '${snap}'`)).toBe(0);
    expect(count("label_print_events", `snapshot_id = '${snap}'`)).toBe(0);
  });
});

describe("tenant isolation of labels (TEN-1)", () => {
  it("another tenant's member, a multi-tenant operator outside it, and anon cannot create, print or read", async () => {
    const owner = await signIn("owner-a@geraiexpress.test");
    const id = realShipment();
    const snap = (await owner.rpc("create_label_snapshot", { p_shipment: id, p_mask: false })).data as string;
    const otherAdmin = await signIn("owner-b@geraiexpress.test");
    expect((await otherAdmin.rpc("create_label_snapshot", { p_shipment: id, p_mask: false })).error?.message).toBe("not_found");
    expect((await otherAdmin.rpc("record_label_print", { p_snapshot: snap })).error?.message).toBe("not_found");
    expect((await otherAdmin.rpc("record_label_print", { p_snapshot: randomUUID() })).error?.message).toBe("not_found");
    for (const table of ["label_snapshots", "label_print_events"]) {
      expect((await otherAdmin.from(table).select("tenant_id").eq("shipment_id", id)).data).toEqual([]);
      expect((await client().from(table).select("tenant_id")).error?.code).toBe("42501");
    }
    const anon = client();
    expect((await anon.rpc("create_label_snapshot", { p_shipment: id, p_mask: false })).error?.code).toBe("42501");
    expect((await anon.rpc("record_label_print", { p_snapshot: snap })).error?.code).toBe("42501");
    // A suspended-membership or non-member sees nothing; tenant B's own real shipment is isolated from A.
    sql(`update public.tenants set contact_whatsapp = '081366660000' where id = '${IDS.tenantB}'`);
    const own = realShipment({ tenant: IDS.tenantB, outlet: IDS.outletB });
    expect((await owner.rpc("create_label_snapshot", { p_shipment: own, p_mask: false })).error?.message).toBe("not_found");
    const bSnap = await otherAdmin.rpc("create_label_snapshot", { p_shipment: own, p_mask: false });
    expect(bSnap.error).toBeNull();
    expect(snapshotRow(bSnap.data as string)).toMatchObject({ tenant_id: IDS.tenantB, printed_sender_name: "Gerai Uji B", printed_sender_phone: "081366660000" });
    expect((await owner.from("label_snapshots").select("id").eq("shipment_id", own)).data).toEqual([]);
    expect((await owner.rpc("record_label_print", { p_snapshot: bSnap.data as string })).error?.message).toBe("not_found");
  });
});
