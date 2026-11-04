// T-094 / PR-34 / DEC-017. The shipment carries an optional sender address (street, area, postal code)
// with tidy limits; it is draft content (revision, lock after submit), it never reaches the provider
// payload (the pickup stays the outlet's, PR-3), and a masked label may print it within the limits.
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { IDS, machine, realOperation, signIn, sql } from "./helpers";

const OWNER_A = "00000000-0000-4000-a000-0000000000a1";
const shipments: string[] = [];
const tenants: string[] = [];

afterAll(() => {
  if (shipments.length) {
    const ids = shipments.map((i) => `'${i}'`).join(",");
    sql(`update public.shipments set selected_quote_id = null where id in (${ids}); delete from public.shipments where id in (${ids})`);
  }
  if (tenants.length) {
    const ids = tenants.map((i) => `'${i}'`).join(",");
    sql(`update public.shipments set selected_quote_id = null where tenant_id in (${ids});
      delete from public.shipments where tenant_id in (${ids}); delete from public.tenants where id in (${ids})`);
  }
  sql(`update public.tenants set masking_allowed = true where id = '${IDS.tenantA}'`);
});

function draft(): string {
  const id = randomUUID();
  shipments.push(id);
  sql(`insert into public.shipments (tenant_id, outlet_id, id, reference, created_by, sender_name, sender_phone, item_description, weight_grams)
    values ('${IDS.tenantA}', '${IDS.outletA}', '${id}', 'GX094-${id.slice(0, 8).toUpperCase()}', '${OWNER_A}', 'Pengirim', '081200000001', 'Buku', 500)`);
  return id;
}

// An issued real shipment with a stored sender address (synthetic data, no provider operation).
function issued(sender: { address: string | null; area: string | null }): string {
  const id = randomUUID(), quote = randomUUID();
  shipments.push(id);
  const lit = (v: string | null) => (v === null ? "null" : `'${v.replace(/'/g, "''")}'`);
  sql(`insert into public.shipments (tenant_id, outlet_id, id, reference, submission_state, payment_state, sender_name, sender_phone,
      sender_address, sender_area, recipient_name, recipient_phone, recipient_address, recipient_area, item_description, weight_grams,
      is_simulated, created_by, submitted_at, issued_at, awb, pickup_snapshot)
    values ('${IDS.tenantA}', '${IDS.outletA}', '${id}', 'GX094I-${id.slice(0, 8).toUpperCase()}', 'issued', 'paid', 'Toko Pelanggan', '081311112222',
      ${lit(sender.address)}, ${lit(sender.area)}, 'Penerima Uji', '081234567890', 'Jl. Tujuan No. 9', 'Kota Uji', 'Buku', 1500,
      false, '${OWNER_A}', now(), now(), 'JP0940000001',
      jsonb_build_object('outlet', 'Pickup Rahasia', 'address', 'Jl. Pickup Nyata No. 5', 'area', 'Kec. Pickup'));
    insert into public.shipment_quotes (tenant_id, shipment_id, id, shipment_revision, courier, service, normal_tariff_idr, eta_days, is_simulated, expires_at)
      values ('${IDS.tenantA}', '${id}', '${quote}', 1, 'JT', 'REG', 12000, '1-2', false, now() + interval '1 hour');
    update public.shipments set selected_quote_id = '${quote}' where id = '${id}';`);
  return id;
}

const row = (id: string) => JSON.parse(sql(`select row_to_json(s) from public.label_snapshots s where id = '${id}'`)) as Record<string, unknown>;

describe("sender address on the shipment (T-094)", () => {
  it("a member saves it through the column grant; it is draft content that bumps the revision", async () => {
    const id = draft();
    const owner = await signIn("owner-a@geraiexpress.test");
    const before = Number(sql(`select revision from public.shipments where id = '${id}'`));
    const { error } = await owner.from("shipments")
      .update({ sender_address: "Jl. Kenanga No. 3", sender_area: "Kec. Coblong, Bandung", sender_postal_code: "40132" })
      .eq("id", id);
    expect(error).toBeNull();
    expect(sql(`select sender_address || '|' || sender_area || '|' || sender_postal_code || '|' || revision from public.shipments where id = '${id}'`))
      .toBe(`Jl. Kenanga No. 3|Kec. Coblong, Bandung|40132|${before + 1}`);
  });

  it("refuses out-of-limit values (street 5-120, area 3-40, postal 5 digits); null stays allowed", () => {
    const id = draft();
    for (const bad of [`sender_address = 'Jl'`, `sender_address = '${"x".repeat(121)}'`, `sender_area = 'AB'`,
      `sender_area = '${"y".repeat(41)}'`, `sender_postal_code = '4013'`, `sender_postal_code = 'abcde'`]) {
      expect(() => sql(`update public.shipments set ${bad} where id = '${id}'`), bad).toThrow(/check constraint/);
    }
    expect(() => sql(`update public.shipments set sender_address = null, sender_area = null, sender_postal_code = null where id = '${id}'`)).not.toThrow();
  });

  it("is locked after submission like the rest of the draft", () => {
    const id = issued({ address: "Jl. Kenanga No. 3", area: "Kec. Coblong" });
    expect(() => sql(`update public.shipments set sender_address = 'Jl. Lain No. 1' where id = '${id}'`)).toThrow(/shipment_locked/);
  });

  it("never reaches the provider payload: dispatch_payload carries no sender field", async () => {
    const f = await realOperation();
    tenants.push(f.tenant);
    // The fixture's shipment is already queued (locked by guard_shipment, which is itself asserted above):
    // the sender values are set with the guard switched off for this one superuser fixture write only.
    sql(`alter table public.shipments disable trigger user;
      update public.shipments set sender_name = 'Pengirim Rahasia', sender_phone = '081277778888',
        sender_address = 'Jl. Rahasia Pengirim No. 1', sender_area = 'Kec. Rahasia' where id = '${f.shipment}';
      alter table public.shipments enable trigger user;`);
    expect(sql(`select sender_address from public.shipments where id = '${f.shipment}'`)).toBe("Jl. Rahasia Pengirim No. 1");
    const { data, error } = await machine().rpc("dispatch_claim", { p_operation: f.op, p_env: "sandbox" });
    expect(error).toBeNull();
    const payload = JSON.stringify(data);
    for (const secret of ["Pengirim Rahasia", "081277778888", "Jl. Rahasia Pengirim No. 1", "Kec. Rahasia", "sender"]) {
      expect(payload, secret).not.toContain(secret);
    }
  });
});

describe("masked label prints the sender address (T-094, owner 2026-11-04)", () => {
  const fields = { p_sender_name: "Toko Pelanggan", p_sender_phone: "081311112222", p_sender_city: "Kec. Coblong" };

  it("prints the given street, collapsed to tidy single spaces, and a reprint of the same sender reuses the snapshot", async () => {
    const id = issued({ address: "Jl. Kenanga No. 3", area: "Kec. Coblong" });
    const owner = await signIn("owner-a@geraiexpress.test");
    const first = await owner.rpc("create_label_snapshot", { p_shipment: id, p_mask: true, ...fields, p_sender_address: "  Jl. Kenanga\n   No. 3\t" });
    expect(first.error).toBeNull();
    expect(row(first.data as string)).toMatchObject({
      mask_sender: true, printed_sender_name: "Toko Pelanggan", printed_sender_address: "Jl. Kenanga No. 3", printed_sender_city: "Kec. Coblong",
      true_pickup_address: "Jl. Pickup Nyata No. 5",
    });
    const again = await owner.rpc("create_label_snapshot", { p_shipment: id, p_mask: true, ...fields, p_sender_address: "Jl. Kenanga No. 3" });
    expect(again.data).toBe(first.data);
    // A different street (or none) is a new version; the earlier one stays untouched.
    const none = await owner.rpc("create_label_snapshot", { p_shipment: id, p_mask: true, ...fields });
    expect(none.data).not.toBe(first.data);
    expect(row(none.data as string)).toMatchObject({ version: 2, printed_sender_address: null });
    expect(row(first.data as string)).toMatchObject({ version: 1, printed_sender_address: "Jl. Kenanga No. 3" });
  });

  it("refuses out-of-limit or control-character streets with invalid_input, and writes nothing", async () => {
    const id = issued({ address: null, area: null });
    const owner = await signIn("owner-a@geraiexpress.test");
    for (const bad of ["Jl", "x".repeat(121), "Jl. Bel\u0007 No. 3"]) {
      const res = await owner.rpc("create_label_snapshot", { p_shipment: id, p_mask: true, ...fields, p_sender_address: bad });
      expect(res.error?.message, JSON.stringify(bad)).toBe("invalid_input");
    }
    // Collapsing happens before counting: 200 spaces inside a short street are fine.
    expect((await owner.rpc("create_label_snapshot", { p_shipment: id, p_mask: true, ...fields,
      p_sender_address: `Jl.${" ".repeat(200)}No. 3` })).error).toBeNull();
    expect(Number(sql(`select count(*) from public.label_snapshots where shipment_id = '${id}'`))).toBe(1);
  });

  it("the table check holds the masked limits even for superuser writes; the unmasked gerai identity is unchanged", async () => {
    const id = issued({ address: null, area: null });
    const owner = await signIn("owner-a@geraiexpress.test");
    sql(`update public.tenants set contact_whatsapp = '081355550000' where id = '${IDS.tenantA}'`);
    const off = await owner.rpc("create_label_snapshot", { p_shipment: id, p_mask: false });
    expect(off.error).toBeNull();
    // Unmasked: the gerai name, WhatsApp and the pickup address and area, as before (DEC-017).
    expect(row(off.data as string)).toMatchObject({ mask_sender: false, printed_sender_address: "Jl. Pickup Nyata No. 5", printed_sender_city: "Kec. Pickup" });
    expect(() => sql(`update public.label_snapshots set printed_sender_address = '${"z".repeat(121)}' where id = '${off.data}'`)).toThrow();
    const cols = `tenant_id, shipment_id, version, size, mask_sender, printed_sender_name, printed_sender_phone, printed_sender_address,
      printed_sender_city, true_tenant_name, true_tenant_slug, awb, shipment_reference, is_cod, content_digest, created_by`;
    const values = (address: string) => `'${IDS.tenantA}', '${id}', 9, '10x15', true, 'Toko', '081311112222', '${address}', 'Kec. Coblong',
      'Gerai', 'gerai', 'JP0940000001', 'X', false, '${"a".repeat(64)}', '${OWNER_A}'`;
    expect(() => sql(`insert into public.label_snapshots (${cols}) values (${values("z".repeat(121))})`)).toThrow(/label_snapshots_masked_sender_tidy/);
    expect(() => sql(`insert into public.label_snapshots (${cols}) values (${values("Jl")})`)).toThrow(/label_snapshots_masked_sender_tidy/);
  });
});
