// T-085 / DATA-12 / SEC-8: local synthetic fixtures, no provider dispatch.
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { client, DB_CONTAINER, DB_NAME, machine, signIn, sql, type TestClient } from "./helpers";

const tenant = randomUUID(), outlet = randomUUID(), area = randomBytes(12).toString("hex");
const owner = "00000000-0000-4000-a000-0000000000a1", operator = "00000000-0000-4000-a000-0000000000a2";
const secret = "synthetic-db-tracking-test-secret-32-bytes";
const hash = (token: string) => createHash("sha256").update(token).digest("hex");
let admin: TestClient, staff: TestClient, outsider: TestClient;
const tokens: string[] = [];

beforeAll(async () => {
  for (let attempt = 0; attempt < 60; attempt++) {
    const { error } = await client().rpc("registration_open");
    if (error?.code !== "PGRST002" && error?.code !== "PGRST001") break;
    if (attempt === 59) throw new Error("PostgREST schema cache did not become ready");
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  sql(`insert into public.tenants(id,name,lifecycle,contact_whatsapp) values ('${tenant}','Gerai Tracking Rahasia','active','081355550000');
    insert into public.outlets(tenant_id,id,name) values ('${tenant}','${outlet}','Outlet Tracking');
    insert into public.memberships(tenant_id,user_id,role) values ('${tenant}','${owner}','tenant_admin'),('${tenant}','${operator}','operator');
    insert into public.mengantar_areas(id,province,city,district,subdistrict,postal_code,dataset_version)
      values ('${area}','Provinsi Uji','Kota Uji','Kecamatan Uji','Kelurahan Uji','40132','mengantar-2026-11-05-1');`);
  admin = await signIn("owner-a@geraiexpress.test");
  staff = await signIn("operator-a@geraiexpress.test");
  outsider = await signIn("owner-b@geraiexpress.test");
}, 90000);
afterAll(() => {
  sql(`update public.shipments set selected_quote_id=null where tenant_id='${tenant}';
    delete from public.tenants where id='${tenant}'; delete from public.mengantar_areas where id='${area}'`);
});
function shipment(state = "issued", simulated = false) {
  const id = randomUUID(), quote = randomUUID();
  sql(`insert into public.shipments(tenant_id,outlet_id,id,reference,submission_state,payment_state,sender_name,sender_phone,
    recipient_name,recipient_phone,recipient_address,recipient_area,recipient_area_id,item_description,weight_grams,goods_value_idr,
    is_cod,cod_amount_idr,is_simulated,created_by,awb,issued_at)
    values ('${tenant}','${outlet}','${id}','TRACK-${id.slice(0,8)}','${state}','paid','Pengirim Sangat Rahasia','081200000099',
    'Penerima Sangat Rahasia','081299998888','Jl. Tujuan Rahasia 9','Free-text area must not escape','${area}','Barang Rahasia',1000,987654,
    true,999999,${simulated},'${owner}','JP1234567890',now());
    insert into public.shipment_quotes(tenant_id,shipment_id,id,shipment_revision,courier,service,normal_tariff_idr,eta_days,is_simulated,expires_at)
    values ('${tenant}','${id}','${quote}',1,'JT','REG',24680,'1-2',${simulated},now()+interval '1 hour');
    update public.shipments set selected_quote_id='${quote}' where id='${id}'`);
  return id;
}
async function share(c: TestClient, id: string) {
  const prepared = await c.rpc("prepare_tracking_link", { p_shipment: id });
  expect(prepared.error).toBeNull();
  const linkId = prepared.data as string;
  const token = createHmac("sha256", secret).update(linkId).digest("base64url");
  tokens.push(token);
  expect((await c.rpc("publish_tracking_link", { p_shipment: id, p_link: linkId, p_hash: hash(token) })).error).toBeNull();
  return { token, linkId };
}
const lookup = async (token: string) => {
  const result = await client().rpc("track_shipment", { token });
  expect(result.error).toBeNull();
  return result.data;
};
const auditCount = (action: string) => Number(sql(`select count(*) from public.audit_events where action='${action}' and target_tenant='${tenant}'`));

describe("tracking privilege catalog and tenant isolation", () => {
  it("has RLS, member read and no direct write even by service_role; anon has no table privilege", () => {
    expect(sql("select relrowsecurity from pg_class where oid='public.tracking_links'::regclass")).toBe("t");
    for (const role of ["anon", "authenticated", "service_role"]) {
      for (const privilege of ["INSERT", "UPDATE", "DELETE", "TRUNCATE"]) expect(sql(`select has_table_privilege('${role}','public.tracking_links','${privilege}')`)).toBe("f");
    }
    expect(sql("select has_table_privilege('anon','public.tracking_links','SELECT')")).toBe("f");
    for (const role of ["authenticated", "service_role"]) expect(sql(`select has_function_privilege('${role}','public.track_shipment(text)','execute')`)).toBe("f");
  });
  it("refuses anon/machine mutations and outsiders; members read only their tenant", async () => {
    const id = shipment();
    const { linkId } = await share(staff, id);
    for (const c of [client(), machine()]) {
      expect((await c.rpc("prepare_tracking_link", { p_shipment: id })).error?.code).toBe("42501");
      expect((await c.rpc("publish_tracking_link", { p_shipment: id, p_link: linkId, p_hash: "a".repeat(64) })).error?.code).toBe("42501");
      expect((await c.rpc("revoke_tracking_link", { p_shipment: id, p_link: linkId })).error?.code).toBe("42501");
    }
    expect((await outsider.rpc("prepare_tracking_link", { p_shipment: id })).error?.message).toBe("not_found");
    expect((await outsider.rpc("publish_tracking_link", { p_shipment: id, p_link: linkId, p_hash: "a".repeat(64) })).error?.message).toBe("not_found");
    expect((await outsider.from("tracking_links").select("*").eq("shipment_id", id)).data).toEqual([]);
    expect((await staff.from("tracking_links").select("link_id").eq("shipment_id", id)).data).toEqual([{ link_id: linkId }]);
  });
  it("refuses non-issued and simulated sharing", async () => {
    for (const id of [shipment("queued"), shipment("issued", true)]) expect((await admin.rpc("prepare_tracking_link", { p_shipment: id })).error?.message).toBe("no_awb");
  });
});

it("idempotently creates/publishes, stores only a hash, audits, revokes admin-only and never revives the old token", async () => {
  const id = shipment();
  const creates = auditCount("tracking.create"), shares = auditCount("tracking.share"), revokes = auditCount("tracking.revoke");
  const first = await share(staff, id), repeat = await share(admin, id);
  expect(repeat).toEqual(first);
  expect(auditCount("tracking.create")).toBe(creates + 1);
  expect(auditCount("tracking.share")).toBe(shares + 1);
  const row = sql(`select row_to_json(t) from public.tracking_links t where shipment_id='${id}'`);
  expect(row).toContain(hash(first.token)); expect(row).not.toContain(first.token);
  for (const c of [staff, outsider]) expect((await c.rpc("revoke_tracking_link", { p_shipment: id, p_link: first.linkId })).error?.message).toBe("admin_required");
  expect(await lookup(first.token)).not.toBeNull();
  expect((await admin.rpc("revoke_tracking_link", { p_shipment: id, p_link: first.linkId })).error).toBeNull();
  expect(await lookup(first.token)).toBeNull();
  expect((await staff.rpc("publish_tracking_link", { p_shipment: id, p_link: first.linkId, p_hash: hash(first.token) })).error?.message).toBe("stale_state");
  expect((await admin.rpc("revoke_tracking_link", { p_shipment: id, p_link: first.linkId })).error).toBeNull();
  expect(auditCount("tracking.revoke")).toBe(revokes + 1);
  const next = await share(staff, id);
  expect(next.linkId).not.toBe(first.linkId); expect(next.token).not.toBe(first.token);
  expect(await lookup(first.token)).toBeNull(); expect(await lookup(next.token)).not.toBeNull();
  // A stale revoke/late publication cannot affect the new generation.
  expect((await admin.rpc("revoke_tracking_link", { p_shipment: id, p_link: first.linkId })).error?.message).toBe("stale_state");
  expect((await staff.rpc("publish_tracking_link", { p_shipment: id, p_link: first.linkId, p_hash: hash(first.token) })).error?.message).toBe("stale_state");
  expect(await lookup(next.token)).not.toBeNull();
  expect(sql(`select actor from public.audit_events where action='tracking.revoke' and target_tenant='${tenant}' order by id desc limit 1`)).toBe(owner);
  const audit = sql(`select json_agg(detail) from public.audit_events where action like 'tracking.%' and target_tenant='${tenant}'`);
  for (const token of tokens) { expect(audit).not.toContain(token); expect(audit).not.toContain(hash(token)); }
});

it("returns nothing for malformed, unknown, expired tokens and shipment ids/AWBs; a prepared link is not active", async () => {
  const id = shipment();
  const prepared = await admin.rpc("prepare_tracking_link", { p_shipment: id });
  const unpublished = createHmac("sha256", secret).update(prepared.data as string).digest("base64url");
  expect(await lookup(unpublished)).toBeNull();
  const { token } = await share(admin, id);
  sql(`update public.tracking_links set expires_at=now()-interval '1 second' where shipment_id='${id}'`);
  for (const input of [token, "", "bad", "U".repeat(43), id, "JP1234567890", "a".repeat(500)]) expect(await lookup(input)).toBeNull();
});

it("a direct RPC caller cannot republish a revoked token in a later generation, nor reuse another shipment's hash", async () => {
  const id = shipment(), other = shipment();
  const first = await share(staff, id);
  expect((await admin.rpc("revoke_tracking_link", { p_shipment: id, p_link: first.linkId })).error).toBeNull();
  // Review repro: prepare the new generation, then publish the OLD token's hash under it.
  const renewed = await staff.rpc("prepare_tracking_link", { p_shipment: id });
  expect(renewed.error).toBeNull();
  expect((await staff.rpc("publish_tracking_link", { p_shipment: id, p_link: renewed.data, p_hash: hash(first.token) })).error?.message).toBe("stale_state");
  expect(await lookup(first.token)).toBeNull();
  // The live hash of one shipment can never be published for another.
  const live = await share(admin, other);
  const fresh = await staff.rpc("prepare_tracking_link", { p_shipment: id });
  expect((await staff.rpc("publish_tracking_link", { p_shipment: id, p_link: fresh.data, p_hash: hash(live.token) })).error?.message).toBe("stale_state");
  // The correctly derived new-generation token still works.
  const next = createHmac("sha256", secret).update(fresh.data as string).digest("base64url");
  tokens.push(next);
  expect((await staff.rpc("publish_tracking_link", { p_shipment: id, p_link: fresh.data, p_hash: hash(next) })).error).toBeNull();
  expect(await lookup(next)).not.toBeNull();
});

// Runs one transaction as the given member (authenticated JWT claims) in its own connection.
const run = promisify(execFile);
const asMember = (user: string, body: string) => run("docker", ["exec", DB_CONTAINER, "psql", "-U", "postgres", "-d", DB_NAME,
  "-tA", "-v", "ON_ERROR_STOP=1", "-c", `begin; set local statement_timeout = '15s'; set local role authenticated;
  select set_config('request.jwt.claims', '{"sub":"${user}","role":"authenticated","is_anonymous":false}', true); ${body} commit;`])
  .then(() => "ok", (e: { stderr?: string }) => e.stderr ?? "error");

it("concurrent publication of one hash for two shipments activates at most one, and a later-retired hash never revives", async () => {
  const a = shipment(), b = shipment();
  const pa = (await staff.rpc("prepare_tracking_link", { p_shipment: a })).data as string;
  const pb = (await staff.rpc("prepare_tracking_link", { p_shipment: b })).data as string;
  const shared = createHmac("sha256", secret).update(pa).digest("base64url");
  tokens.push(shared);
  const h = hash(shared);
  // Session A publishes H and holds its transaction open; session B publishes the same H for B meanwhile.
  const first = asMember(operator, `select public.publish_tracking_link('${a}', '${pa}', '${h}'); select pg_sleep(1.5);`);
  await new Promise((resolve) => setTimeout(resolve, 400));
  const second = asMember(operator, `select public.publish_tracking_link('${b}', '${pb}', '${h}');`);
  const [r1, r2] = await Promise.all([first, second]);
  expect(r1).toBe("ok");
  expect(r2).toMatch(/stale_state/); // B waited on the reserved hash, then saw A's ownership.
  expect(sql(`select count(*) from public.tracking_links where token_hash='${h}'`)).toBe("1");
  // Revoke A and renew it: H is retired and can never be activated for B afterwards.
  expect((await admin.rpc("revoke_tracking_link", { p_shipment: a, p_link: pa })).error).toBeNull();
  await staff.rpc("prepare_tracking_link", { p_shipment: a });
  expect((await staff.rpc("publish_tracking_link", { p_shipment: b, p_link: pb, p_hash: h })).error?.message).toBe("stale_state");
  expect(await lookup(shared)).toBeNull();
});

it("a malformed token never matches, even if the empty-string hash were published", async () => {
  const id = shipment();
  const prepared = await staff.rpc("prepare_tracking_link", { p_shipment: id });
  expect((await staff.rpc("publish_tracking_link", { p_shipment: id, p_link: prepared.data, p_hash: hash("") })).error).toBeNull();
  for (const input of ["", "bad", "malformed", "%%%", "a".repeat(500)]) expect(await lookup(input)).toBeNull();
});

it("projects only allowed fields; latest label controls masking, and absent labels hide gerai/sender", async () => {
  const id = shipment();
  const { token } = await share(admin, id);
  const before = await lookup(token);
  expect(before).toMatchObject({ gerai_label: null, sender_initials: null, recipient_initials: "P. S. R.", destination_city: "Kota Uji", awb: "JP1234567890", status_label: "Status belum tersedia", timeline: [] });
  expect(Object.keys(before).sort()).toEqual(["gerai_label", "courier", "service", "awb", "status_label", "timeline", "destination_city", "sender_initials", "recipient_initials", "created_at", "issued_at"].sort());
  expect(JSON.stringify(before)).not.toMatch(/Rahasia|0812|Tujuan|Free-text|999999|987654|24680|item|amount|address|phone|name/);
  const label = (masked: boolean) => admin.rpc("create_label_snapshot", { p_shipment: id, p_mask: masked,
    p_sender_name: masked ? "Nama Cetak Tersamar" : null, p_sender_phone: masked ? "081377778888" : null,
    p_sender_city: masked ? "Kota Asal" : null });
  expect((await label(false)).error).toBeNull();
  expect(await lookup(token)).toMatchObject({ gerai_label: "Gerai Tracking Rahasia", sender_initials: "G. T. R." });
  expect((await label(true)).error).toBeNull();
  const masked = await lookup(token);
  expect(masked).toMatchObject({ gerai_label: null, sender_initials: "N. C. T." });
  expect(JSON.stringify(masked)).not.toMatch(/Gerai Tracking|Pengirim Sangat|Nama Cetak|0813|Pickup|Barang/);
  expect((await label(false)).error).toBeNull();
  expect(await lookup(token)).toMatchObject({ gerai_label: "Gerai Tracking Rahasia" });
});
