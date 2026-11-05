// Integration of T-094 (masked sender street), T-096 (frozen logo) and T-082 (receipts) on one
// shipment: both documents share label_print_events but keep separate kinds, and later tenant or
// logo edits rewrite neither frozen identity. Synthetic local data only; no provider operation.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { signIn, sql } from "./helpers";

const tenant = randomUUID(), outlet = randomUUID(), shipment = randomUUID();
const ownerId = "00000000-0000-4000-a000-0000000000a1";
const png = Buffer.from("89504e470d0a1a0a", "hex").toString("base64");
const logoRevision = () => Number(sql(`select coalesce(max(version), 0) from private.gerai_logo_versions where tenant_id = '${tenant}'`));

beforeAll(() => {
  sql(`insert into public.tenants(id, name, lifecycle, contact_whatsapp) values ('${tenant}', 'Gerai Gabungan', 'active', '081234567890');
    insert into public.outlets(tenant_id, id, name) values ('${tenant}', '${outlet}', 'Outlet Gabungan');
    insert into public.memberships(tenant_id, user_id, role) values ('${tenant}', '${ownerId}', 'tenant_admin');
    insert into public.shipments(tenant_id, outlet_id, id, reference, submission_state, payment_state, sender_name, sender_phone,
      sender_address, sender_area, recipient_name, recipient_phone, recipient_address, recipient_area, item_description,
      weight_grams, goods_value_idr, is_cod, is_simulated, created_by, awb, customer_charge_idr)
    values ('${tenant}', '${outlet}', '${shipment}', 'GAB-${shipment.slice(0, 8)}', 'issued', 'paid', 'Pengirim Gabungan', '081311112222',
      'Jl. Pengirim Gabungan 5', 'Kota Pengirim', 'Penerima Gabungan', '081233334444', 'Jl. Tujuan 9', 'Kota Tujuan', 'Buku',
      1000, 50000, false, false, '${ownerId}', 'JP5555555555', 15000);`);
});
afterAll(() => { sql(`delete from public.tenants where id = '${tenant}'`); });

it("a masked label with sender street and frozen logo and a receipt coexist on one shipment without rewriting each other", async () => {
  const owner = await signIn("owner-a@geraiexpress.test");
  expect((await owner.rpc("set_tenant_logo", { p_tenant: tenant, p_mime: "image/png", p_base64: png, p_expected_revision: logoRevision() })).error).toBeNull();

  const label = await owner.rpc("create_label_snapshot", { p_shipment: shipment, p_mask: true, p_size: "10x15",
    p_sender_name: "Pengirim Gabungan", p_sender_phone: "081311112222", p_sender_city: "Kota Pengirim", p_sender_address: "Jl. Pengirim Gabungan 5" });
  expect(label.error).toBeNull();
  expect((await owner.rpc("record_label_print", { p_snapshot: label.data, p_acknowledged: true })).error).toBeNull();
  const snapshotBefore = sql(`select row_to_json(s) from public.label_snapshots s where id = '${label.data}'`);
  expect(JSON.parse(snapshotBefore)).toMatchObject({ mask_sender: true, printed_sender_address: "Jl. Pengirim Gabungan 5",
    true_tenant_name: "Gerai Gabungan", gerai_logo: { mime: "image/png", base64: png } });

  const payment = await owner.rpc("record_counter_payment", { p_shipment: shipment, p_method: "cash", p_amount_idr: 15000,
    p_received_idr: 20000, p_difference_reason: null });
  expect(payment.error).toBeNull();
  const receipt = await owner.rpc("record_receipt_print", { p_shipment: shipment, p_payment: payment.data, p_width: "80" });
  expect(receipt.error).toBeNull();

  // The label-history reader's filter returns only the label event; the receipt keeps its own kind.
  expect(sql(`select string_agg(kind || ':' || size, ',' order by id) from public.label_print_events where shipment_id = '${shipment}'`))
    .toBe("label:10x15,receipt:80");
  expect(sql(`select count(*) from public.label_print_events where shipment_id = '${shipment}' and kind = 'label' and snapshot_id = '${label.data}'`)).toBe("1");

  // Later edits: new name and WhatsApp, logo removed. Neither printed identity changes.
  sql(`update public.tenants set name = 'Gerai Ganti Nama', contact_whatsapp = '081299990000' where id = '${tenant}'`);
  expect((await owner.rpc("set_tenant_logo", { p_tenant: tenant, p_mime: null, p_base64: null, p_expected_revision: logoRevision() })).error).toBeNull();
  expect(sql(`select row_to_json(s) from public.label_snapshots s where id = '${label.data}'`)).toBe(snapshotBefore);
  expect(sql(`select receipt_gerai_name || '|' || receipt_gerai_whatsapp from public.counter_payments where id = '${payment.data}'`))
    .toBe("Gerai Gabungan|081234567890");
  // A reprint of the unchanged masked label reuses the same snapshot.
  const reprint = await owner.rpc("create_label_snapshot", { p_shipment: shipment, p_mask: true, p_size: "10x15",
    p_sender_name: "Pengirim Gabungan", p_sender_phone: "081311112222", p_sender_city: "Kota Pengirim", p_sender_address: "Jl. Pengirim Gabungan 5" });
  expect(reprint.data).toBe(label.data);
});
