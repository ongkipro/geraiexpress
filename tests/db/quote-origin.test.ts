import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { machine, realOperation, signIn, sql } from "./helpers";

const A = { address: "6acf44a4771fe2b474c055ca", area: "5fc62f60f8f44b34aa4c0dcd" };
const B = { address: "7bcf44a4771fe2b474c055cb", area: "6ed62f60f8f44b34aa4c0dce" };
const rows = [{ courier: "JT", tariff: 9000, net: 6300, eta: "1-2 hari" }];

async function draft() {
  const f = await realOperation();
  const owner = await signIn("owner-a@geraiexpress.test");
  const user = (await owner.auth.getUser()).data.user!.id;
  const outlet = sql(`select outlet_id from public.shipments where id = '${f.shipment}'`);
  sql(`insert into public.memberships (tenant_id, user_id, role) values ('${f.tenant}', '${user}', 'tenant_admin');
    delete from public.provider_operations where id = '${f.op}';
    update public.shipments set submission_state = 'draft', selected_quote_id = null, pickup_snapshot = null where id = '${f.shipment}';
    update public.shipments set sender_name = 'Pengirim', sender_phone = '081234567890', recipient_area = 'Wilayah Tujuan' where id = '${f.shipment}';
    update public.outlets set pickup_address = 'Jl. Pickup A No. 1', pickup_area = 'Wilayah A' where id = '${outlet}'`);
  const revision = () => Number(sql(`select revision from public.shipments where id = '${f.shipment}'`));
  const quote = async (origin = A) => {
    const result = await machine().rpc("record_live_quotes", {
      p_tenant: f.tenant, p_shipment: f.shipment, p_expected_revision: revision(), p_rows: rows,
      p_origin_area_id: origin.area, p_origin_address_id: origin.address,
    });
    return result;
  };
  const quoteId = () => sql(`select id from public.shipment_quotes where shipment_id = '${f.shipment}' and expires_at > now() order by quoted_at desc limit 1`);
  const confirm = (id = quoteId()) => owner.rpc("confirm_shipment", {
    p_shipment: f.shipment, p_quote: id, p_expected_revision: revision(), p_idempotency_key: randomUUID(),
  });
  const change = (origin = B) => owner.rpc("set_outlet_mengantar_pickup", {
    p_outlet: outlet, p_address_id: origin.address, p_area_id: origin.area,
    p_address: "Jl. Pickup B No. 2", p_area: "Wilayah B",
  });
  const cleanup = () => sql(`update public.shipments set selected_quote_id = null where tenant_id = '${f.tenant}';
    delete from public.shipments where tenant_id = '${f.tenant}'; delete from public.tenants where id = '${f.tenant}'`);
  return { ...f, owner, outlet, revision, quote, quoteId, confirm, change, cleanup };
}

describe("quote origin and confirmed pickup identity (T-034 / PR-4 / PR-5)", () => {
  it("expires a quote priced at A when pickup changes to B; it cannot be selected, confirmed or dispatched", async () => {
    const f = await draft();
    try {
      expect((await f.quote()).error).toBeNull();
      const q = f.quoteId();
      expect(sql(`select origin_area_id || '|' || origin_pickup_address_id from public.shipment_quotes where id = '${q}'`)).toBe(`${A.area}|${A.address}`);
      expect((await f.change()).error).toBeNull();
      expect((await f.owner.from("shipment_quotes").select("id").eq("shipment_id", f.shipment).gt("expires_at", new Date().toISOString())).data).toEqual([]);
      expect((await f.confirm(q)).error).toMatchObject({ code: "55000", message: "quote_expired" });
      expect(sql(`select count(*) from public.provider_operations where shipment_id = '${f.shipment}'`)).toBe("0");
      expect((await machine().rpc("dispatch_claim", { p_operation: f.op, p_env: "sandbox" })).error?.message).toBe("not_found");
      expect((await f.quote(B)).error).toBeNull();
      expect((await f.confirm()).error).toBeNull();
    } finally { f.cleanup(); }
  });

  it("invalidates unconfirmed quotes when the pickup address text changes under the same provider ids", async () => {
    const f = await draft();
    try {
      expect((await f.quote()).error).toBeNull();
      const q = f.quoteId();
      expect((await f.change(A)).error).toBeNull();
      expect((await f.confirm(q)).error?.message).toBe("quote_expired");
    } finally { f.cleanup(); }
  });

  it("dispatch_payload reads frozen A ids after confirmation and a queued outlet switch to B", async () => {
    const f = await draft();
    try {
      expect((await f.quote()).error).toBeNull();
      const confirmed = await f.confirm();
      expect(confirmed.error).toBeNull();
      const frozen = JSON.parse(sql(`select pickup_snapshot::text from public.shipments where id = '${f.shipment}'`));
      expect(frozen).toMatchObject({ address: "Jl. Pickup A No. 1", mengantar_pickup_address_id: A.address, mengantar_area_id: A.area });
      expect((await f.change()).error).toBeNull();
      expect(sql(`select mengantar_pickup_address_id from public.outlets where id = '${f.outlet}'`)).toBe(B.address);
      const claim = await machine().rpc("dispatch_claim", { p_operation: confirmed.data.operation_id, p_env: "sandbox" });
      expect(claim.error).toBeNull();
      expect(claim.data).toMatchObject({ pickup_address_id: A.address, pickup_area_id: A.area });
      expect(JSON.parse(sql(`select pickup_snapshot::text from public.shipments where id = '${f.shipment}'`))).toEqual(frozen);
    } finally { f.cleanup(); }
  });

  it("rejects an estimate returned after origin changed, including another pickup in the same area and NULL origin", async () => {
    const f = await draft();
    try {
      expect((await f.change()).error).toBeNull();
      expect((await f.quote(A)).error).toMatchObject({ code: "55000", message: "stale_quote" });
      expect((await f.change({ ...B, area: A.area })).error).toBeNull();
      expect((await f.quote(A)).error?.message).toBe("stale_quote");
      expect((await machine().rpc("record_live_quotes", {
        p_tenant: f.tenant, p_shipment: f.shipment, p_expected_revision: f.revision(), p_rows: rows,
        p_origin_area_id: null, p_origin_address_id: null,
      })).error?.message).toBe("stale_quote");
      expect(sql(`select count(*) from public.shipment_quotes where shipment_id = '${f.shipment}' and expires_at > now()`)).toBe("0");
    } finally { f.cleanup(); }
  });

  it("rechecks stored quote origin at confirmation independently of expiry invalidation", async () => {
    const f = await draft();
    try {
      expect((await f.quote()).error).toBeNull();
      sql(`update public.outlets set mengantar_area_id = '${B.area}' where id = '${f.outlet}'`);
      expect((await f.confirm()).error?.message).toBe("stale_quote");
      expect(sql(`select count(*) from public.provider_operations where shipment_id = '${f.shipment}'`)).toBe("0");
    } finally { f.cleanup(); }
  });
});

describe("live recipient validation at both database boundaries (T-034 / BIZ-06)", () => {
  it("accepts the exact 100-character name / 300-character address and normalized Indonesian phone", async () => {
    const f = await draft();
    try {
      expect((await f.owner.from("shipments").update({ recipient_name: "N".repeat(100), recipient_address: "A".repeat(300), recipient_phone: "+6281234567890" }).eq("id", f.shipment)).error).toBeNull();
      expect((await f.quote()).error).toBeNull();
      expect((await f.confirm()).error).toBeNull();
    } finally { f.cleanup(); }
  });

  it.each([
    ["recipient_name", "N".repeat(101), "live_recipient_name_invalid"],
    ["recipient_address", "A".repeat(301), "live_recipient_address_invalid"],
    ["recipient_phone", "1234567890", "live_recipient_phone_invalid"],
    ["recipient_phone", "081234567", "live_recipient_phone_invalid"],
    ["recipient_phone", "+441234567890", "live_recipient_phone_invalid"],
  ])("refuses invalid %s before either quote or confirmation", async (field, value, code) => {
    const f = await draft();
    try {
      expect((await f.owner.from("shipments").update({ [field]: value }).eq("id", f.shipment)).error).toBeNull();
      expect((await f.quote()).error?.message).toBe(code);
      // Simulate an already persisted quote from a previous application version. Confirmation
      // must independently validate, rather than trusting that every quote writer was correct.
      const q = randomUUID();
      sql(`insert into public.shipment_quotes (id, tenant_id, shipment_id, shipment_revision, courier, service,
        normal_tariff_idr, eta_days, is_simulated, expires_at, origin_area_id, origin_pickup_address_id)
        values ('${q}', '${f.tenant}', '${f.shipment}', ${f.revision()}, 'JT', 'Reguler', 9000, '1-2', false,
          now() + interval '30 minutes', '${A.area}', '${A.address}');
        update public.shipments set submission_state = 'estimated' where id = '${f.shipment}'`);
      expect((await f.confirm(q)).error?.message).toBe(code);
      expect(sql(`select count(*) from public.provider_operations where shipment_id = '${f.shipment}'`)).toBe("0");
    } finally { f.cleanup(); }
  });
});
