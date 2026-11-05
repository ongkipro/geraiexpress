// T-084 / PR-46 / DATA-10 amendment / UX-9 acceptance gate: per-courier masking acceptance written only by
// the integration_operations platform capability, the acknowledgement required for a masked print of a
// courier that is not verified, the print-history fields, and the member-scoped return-route provinces.
// Synthetic couriers and areas only; nothing here reaches Mengantar.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { IDS, client, signIn, signInAal2, sql } from "./helpers";

const OWNER_A = "00000000-0000-4000-a000-0000000000a1";
const COURIER_VERIFIED = "ZzUjiTerima";
const COURIER_REFUSED = "ZzUjiTolak";
const COURIER_UNRECORDED = "ZzUjiKosong";
const AREA_VERSION = "mengantar-2099-02-02-3";
const AREA = { java: "fff0840000000000000000a1", java2: "fff0840000000000000000a2", outside: "fff0840000000000000000a3" };
const MASK = { p_mask: true, p_sender_name: "Toko Pelanggan", p_sender_phone: "081311112222", p_sender_city: "Bandung" };

const shipments: string[] = [];

beforeAll(async () => {
  for (let attempt = 0; attempt < 60; attempt++) {
    const { error } = await client().rpc("registration_open");
    if (error?.code !== "PGRST002" && error?.code !== "PGRST001") break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  sql(`update public.tenants set contact_whatsapp = '081355550000', masking_allowed = true where id in ('${IDS.tenantA}', '${IDS.tenantB}');
    insert into public.mengantar_areas (id, province, city, district, subdistrict, postal_code, dataset_version) values
      ('${AREA.java}', 'JAWA BARAT', 'UJI', 'UJI', 'T084 JAWA', '', '${AREA_VERSION}'),
      ('${AREA.java2}', 'DKI JAKARTA', 'UJI', 'UJI', 'T084 JAKARTA', '', '${AREA_VERSION}'),
      ('${AREA.outside}', 'SUMATERA UTARA', 'UJI', 'UJI', 'T084 MEDAN', '', '${AREA_VERSION}')`);
}, 90000);

afterAll(() => {
  if (shipments.length > 0) {
    const ids = shipments.map((i) => `'${i}'`).join(",");
    sql(`update public.shipments set selected_quote_id = null where id in (${ids}); delete from public.shipments where id in (${ids})`);
  }
  sql(`delete from private.masking_acceptance where courier like 'ZzUji%';
    delete from public.mengantar_areas where dataset_version = '${AREA_VERSION}';
    update public.tenants set contact_whatsapp = null, masking_allowed = true where id in ('${IDS.tenantA}', '${IDS.tenantB}')`);
});

// A real issued shipment with a selected quote for `courier` (SQL fixture, no provider operation row).
function realShipment(opts: { courier?: string | null; tenant?: string; outlet?: string; origin?: string | null; destination?: string | null } = {}) {
  const tenant = opts.tenant ?? IDS.tenantA, outlet = opts.outlet ?? IDS.outletA;
  const id = randomUUID(), quote = randomUUID();
  shipments.push(id);
  const lit = (v: string | null | undefined) => (v ? `'${v}'` : "null");
  sql(`
    insert into public.shipments (tenant_id, outlet_id, id, reference, submission_state, payment_state, sender_name, sender_phone,
      recipient_name, recipient_phone, recipient_address, recipient_area, recipient_area_id, recipient_postal_code, item_description,
      weight_grams, goods_value_idr, is_cod, is_simulated, created_by, submitted_at, issued_at, awb, customer_charge_idr, pickup_snapshot)
    values ('${tenant}', '${outlet}', '${id}', 'GXACC-${id.slice(0, 8).toUpperCase()}', 'issued', 'paid', 'Pengirim Asli', '081200000099',
      'Penerima Uji', '081234567890', 'Jl. Tujuan Uji No. 9', 'Kec. Tujuan, Kota Uji', ${lit(opts.destination)}, '40132', 'Buku',
      1500, 50000, false, false, '${OWNER_A}', now(), now(), 'JP1234567890', 24680,
      jsonb_build_object('outlet', 'Pickup Uji', 'address', 'Jl. Pickup Nyata No. 5', 'area', 'Kec. Pickup, Kota Nyata'));
    insert into public.shipment_quotes (tenant_id, shipment_id, id, shipment_revision, courier, service, normal_tariff_idr,
      eta_days, is_simulated, expires_at, origin_area_id)
      values ('${tenant}', '${id}', '${quote}', 1, '${opts.courier === null ? "JT" : opts.courier ?? COURIER_UNRECORDED}', 'REG', 24680, '1-2', false,
        now() + interval '1 hour', ${lit(opts.origin)});
    update public.shipments set selected_quote_id = ${opts.courier === null ? "null" : `'${quote}'`} where id = '${id}';`);
  return id;
}

const eventFields = (event: number) => sql(`select coalesce(acceptance_state, 'NULL') || '|' || coalesce(acknowledged::text, 'NULL')
  from public.label_print_events where id = ${event}`);

describe("masking acceptance record (PR-46)", () => {
  it("a missing row reads as unverified; members read one courier through masking_acceptance_for; outsiders and anon cannot", async () => {
    const operator = await signIn("operator-a@geraiexpress.test");
    const { data, error } = await operator.rpc("masking_acceptance_for", { p_courier: COURIER_UNRECORDED });
    expect(error).toBeNull();
    expect(data).toEqual({ courier: COURIER_UNRECORDED, state: "unverified", evidence_ref: null, recorded_at: null });
    expect((await client().rpc("masking_acceptance_for", { p_courier: COURIER_UNRECORDED })).error?.code).toBe("42501");
    const noAccess = await signIn("no-access@geraiexpress.test");
    expect((await noAccess.rpc("masking_acceptance_for", { p_courier: COURIER_UNRECORDED })).error?.code).toBe("42501");
    // The table itself has no API grant.
    expect(sql("select has_table_privilege('authenticated', 'private.masking_acceptance', 'select,insert,update,delete')")).toBe("f");
  });

  it("only integration_operations at aal2 changes state, with a reason, evidence for a verdict, a stale guard (55000) and an audit row", async () => {
    const owner = await signIn("owner-a@geraiexpress.test");
    const args = { p_courier: COURIER_VERIFIED, p_state: "verified", p_evidence_ref: "Uji scan T-048 #1", p_expected_recorded_at: null, p_reason: "Uji scan kurir" };
    expect((await owner.rpc("platform_set_masking_acceptance", args)).error?.code).toBe("42501");
    // A platform user without aal2, and one at aal2 without integration_operations, are refused.
    expect((await (await signIn("admin@geraiexpress.test")).rpc("platform_set_masking_acceptance", args)).error?.code).toBe("42501");
    expect((await (await signInAal2("admin-new@geraiexpress.test")).rpc("platform_set_masking_acceptance", args)).error?.code).toBe("42501");
    expect(sql(`select count(*) from private.masking_acceptance where courier = '${COURIER_VERIFIED}'`)).toBe("0");

    const admin = await signInAal2("admin@geraiexpress.test");
    expect((await admin.rpc("platform_set_masking_acceptance", { ...args, p_reason: "x" })).error?.message).toBe("reason_required");
    expect((await admin.rpc("platform_set_masking_acceptance", { ...args, p_evidence_ref: "" })).error).toMatchObject({ message: "evidence_required", code: "22023" });
    expect((await admin.rpc("platform_set_masking_acceptance", { ...args, p_state: "maybe" })).error?.code).toBe("22023");
    const set = await admin.rpc("platform_set_masking_acceptance", args);
    expect(set.error).toBeNull();
    expect(set.data).toBe("verified");
    // The same view (expected NULL) is now stale.
    const stale = await admin.rpc("platform_set_masking_acceptance", { ...args, p_state: "refused" });
    expect(stale.error).toMatchObject({ message: "stale_state", code: "55000" });
    const audit = JSON.parse(sql(`select row_to_json(a) from (select reason, outcome, detail from public.audit_events
      where action = 'masking_acceptance.set' and detail ->> 'courier' = '${COURIER_VERIFIED}' order by id desc limit 1) a`));
    expect(audit).toEqual({ reason: "Uji scan kurir", outcome: "verified",
      detail: { courier: COURIER_VERIFIED, from: "unverified", to: "verified", evidence_ref: "Uji scan T-048 #1" } });
    const read = await admin.rpc("platform_masking_acceptance");
    expect(read.error).toBeNull();
    expect((read.data as { courier: string; state: string; recorded_by_email: string }[]).find((r) => r.courier === COURIER_VERIFIED))
      .toMatchObject({ state: "verified", recorded_by_email: "admin@geraiexpress.test" });
    expect((await owner.rpc("platform_masking_acceptance")).error?.code).toBe("42501");

    // Unverified needs no evidence; the next change passes the recorded_at the admin read (round trip).
    expect((await admin.rpc("platform_set_masking_acceptance", { p_courier: COURIER_REFUSED, p_state: "unverified",
      p_evidence_ref: null, p_expected_recorded_at: null, p_reason: "Catat kurir uji" })).error).toBeNull();
    const seen = ((await admin.rpc("platform_masking_acceptance")).data as { courier: string; recorded_at: string }[])
      .find((r) => r.courier === COURIER_REFUSED)!.recorded_at;
    const refused = await admin.rpc("platform_set_masking_acceptance", { p_courier: COURIER_REFUSED, p_state: "refused",
      p_evidence_ref: "Kurir menolak label lokal", p_expected_recorded_at: seen, p_reason: "Hasil uji scan" });
    expect(refused.error).toBeNull();
    const member = await signIn("operator-a@geraiexpress.test");
    expect(((await member.rpc("masking_acceptance_for", { p_courier: COURIER_VERIFIED })).data as { state: string; recorded_at: string }))
      .toMatchObject({ state: "verified", evidence_ref: "Uji scan T-048 #1" });
  });
});

describe("record_label_print acknowledgement (PR-46)", () => {
  // Self-contained states (superuser SQL), independent of the capability test above.
  beforeAll(() => {
    sql(`insert into private.masking_acceptance (courier, state, evidence_ref, recorded_by) values
        ('${COURIER_VERIFIED}', 'verified', 'Uji scan fixture', '00000000-0000-4000-a000-0000000000f1'),
        ('${COURIER_REFUSED}', 'refused', 'Penolakan fixture', '00000000-0000-4000-a000-0000000000f1')
      on conflict (courier) do update set state = excluded.state, evidence_ref = excluded.evidence_ref;
      delete from private.masking_acceptance where courier = '${COURIER_UNRECORDED}'`);
  });

  it("a masked label of an unverified, refused or courier-less shipment needs p_acknowledged = true and records it", async () => {
    const operator = await signIn("operator-a@geraiexpress.test");
    for (const courier of [COURIER_UNRECORDED, COURIER_REFUSED, null] as const) {
      const id = realShipment({ courier });
      const snap = await operator.rpc("create_label_snapshot", { p_shipment: id, ...MASK });
      expect(snap.error).toBeNull();
      const refused = await operator.rpc("record_label_print", { p_snapshot: snap.data, p_acknowledged: false });
      expect(refused.error).toMatchObject({ message: "masking_acknowledgement_required", code: "55000" });
      expect(sql(`select count(*) from public.label_print_events where shipment_id = '${id}'`)).toBe("0");
      const printed = await operator.rpc("record_label_print", { p_snapshot: snap.data, p_acknowledged: true });
      expect(printed.error).toBeNull();
      expect(eventFields(printed.data as number)).toBe(`${courier === COURIER_REFUSED ? "refused" : "unverified"}|true`);
    }
  });

  it("a verified courier prints masked without acknowledgement; unmasked labels and receipts leave both fields NULL", async () => {
    const owner = await signIn("owner-a@geraiexpress.test");
    const id = realShipment({ courier: COURIER_VERIFIED });
    const masked = await owner.rpc("create_label_snapshot", { p_shipment: id, ...MASK });
    const printed = await owner.rpc("record_label_print", { p_snapshot: masked.data, p_acknowledged: false });
    expect(printed.error).toBeNull();
    expect(eventFields(printed.data as number)).toBe("verified|false");

    const plain = realShipment({ courier: COURIER_UNRECORDED });
    const off = await owner.rpc("create_label_snapshot", { p_shipment: plain, p_mask: false });
    const offPrint = await owner.rpc("record_label_print", { p_snapshot: off.data, p_acknowledged: false });
    expect(offPrint.error).toBeNull();
    expect(eventFields(offPrint.data as number)).toBe("NULL|NULL");
    // An acknowledgement sent for an unmasked label is not stored either.
    expect(eventFields((await owner.rpc("record_label_print", { p_snapshot: off.data, p_acknowledged: true })).data as number)).toBe("NULL|NULL");
    expect((await owner.rpc("record_label_print", { p_snapshot: off.data, p_acknowledged: null })).error?.code).toBe("22023");
    expect(sql(`select count(*) from public.label_print_events where kind = 'receipt' and (acceptance_state is not null or acknowledged is not null)`)).toBe("0");
  });

  it("the old one-argument signature is gone, and the history fields cannot be forged or rewritten", async () => {
    const owner = await signIn("owner-a@geraiexpress.test");
    const id = realShipment();
    const snap = await owner.rpc("create_label_snapshot", { p_shipment: id, ...MASK });
    expect((await owner.rpc("record_label_print", { p_snapshot: snap.data })).error).not.toBeNull();
    expect(sql("select count(*) from pg_proc where proname = 'record_label_print'")).toBe("1");
    const event = (await owner.rpc("record_label_print", { p_snapshot: snap.data, p_acknowledged: true })).data as number;
    expect(() => sql(`update public.label_print_events set acknowledged = false where id = ${event}`)).toThrow(/label_history_is_append_only/);
    // An unacknowledged non-verified state, or acceptance fields on a receipt, violate the constraint.
    expect(() => sql(`insert into public.label_print_events (tenant_id, shipment_id, snapshot_id, size, actor, acceptance_state, acknowledged)
      values ('${IDS.tenantA}', '${id}', '${snap.data}', '10x15', '${OWNER_A}', 'unverified', false)`)).toThrow(/label_print_events_acceptance/);
    expect((await owner.from("label_print_events").insert({ tenant_id: IDS.tenantA, shipment_id: id, snapshot_id: snap.data,
      size: "10x15", actor: OWNER_A, acceptance_state: "verified", acknowledged: false })).error?.code).toBe("42501");
  });

  it("another tenant cannot print a gerai's masked label even with the acknowledgement", async () => {
    const owner = await signIn("owner-a@geraiexpress.test");
    const id = realShipment();
    const snap = await owner.rpc("create_label_snapshot", { p_shipment: id, ...MASK });
    const otherAdmin = await signIn("owner-b@geraiexpress.test");
    expect((await otherAdmin.rpc("record_label_print", { p_snapshot: snap.data, p_acknowledged: true })).error?.message).toBe("not_found");
    expect((await client().rpc("record_label_print", { p_snapshot: snap.data, p_acknowledged: true })).error?.code).toBe("42501");
    expect(sql(`select count(*) from public.label_print_events where shipment_id = '${id}'`)).toBe("0");
  });
});

describe("label_return_routes (help 14715369)", () => {
  it("returns origin and destination provinces from the catalogue, NULL when unknown, only for the caller's shipments", async () => {
    const operator = await signIn("operator-a@geraiexpress.test");
    const javaToJava = realShipment({ origin: AREA.java, destination: AREA.java2 });
    const javaToOutside = realShipment({ origin: AREA.java, destination: AREA.outside });
    const unknown = realShipment({ origin: null, destination: "fff0849999999999999999ff" });
    const foreign = realShipment({ tenant: IDS.tenantB, outlet: IDS.outletB, origin: AREA.java, destination: AREA.java2 });
    const { data, error } = await operator.rpc("label_return_routes", { p_shipments: [javaToJava, javaToOutside, unknown, foreign, randomUUID()] });
    expect(error).toBeNull();
    const byId = new Map((data as { shipment_id: string; origin_province: string | null; destination_province: string | null }[]).map((r) => [r.shipment_id, r]));
    expect(byId.size).toBe(3);
    expect(byId.get(javaToJava)).toMatchObject({ origin_province: "JAWA BARAT", destination_province: "DKI JAKARTA" });
    expect(byId.get(javaToOutside)).toMatchObject({ origin_province: "JAWA BARAT", destination_province: "SUMATERA UTARA" });
    expect(byId.get(unknown)).toMatchObject({ origin_province: null, destination_province: null });
    expect(byId.has(foreign)).toBe(false);
    expect((await operator.rpc("label_return_routes", { p_shipments: Array.from({ length: 51 }, () => randomUUID()) })).error?.code).toBe("22023");
    expect((await client().rpc("label_return_routes", { p_shipments: [javaToJava] })).error?.code).toBe("42501");
    const ownerB = await signIn("owner-b@geraiexpress.test");
    expect((await ownerB.rpc("label_return_routes", { p_shipments: [javaToJava] })).data).toEqual([]);
  });
});
