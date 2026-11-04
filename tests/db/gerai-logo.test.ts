// T-096 direct Data API/RPC boundary; synthetic local data only, no provider operations.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { client, demoVisitor, machine, signIn, sql } from "./helpers";

const tenant = randomUUID(), outlet = randomUUID();
const ownerId = "00000000-0000-4000-a000-0000000000a1";
const operatorId = "00000000-0000-4000-a000-0000000000a2";
const png = Buffer.from("89504e470d0a1a0a", "hex");
const jpeg = Buffer.from("ffd8ff", "hex");
const webp = Buffer.from("RIFF0000WEBPVP8 ");
const args = (bytes: Buffer | null, mime: string | null, revision: number | null) => ({
  p_tenant: tenant, p_mime: mime, p_base64: bytes?.toString("base64") ?? null, p_expected_revision: revision,
});
const revision = () => Number(sql(`select coalesce(max(version), 0) from private.gerai_logo_versions where tenant_id = '${tenant}'`));
const versionCount = () => Number(sql(`select count(*) from private.gerai_logo_versions where tenant_id = '${tenant}'`));
const auditCount = () => Number(sql(`select count(*) from public.audit_events where action = 'tenant.logo' and target_tenant = '${tenant}'`));

beforeAll(async () => {
  for (let attempt = 0; attempt < 60; attempt++) {
    const { error } = await client().rpc("registration_open");
    if (error?.code !== "PGRST002" && error?.code !== "PGRST001") break;
    if (attempt === 59) throw new Error("PostgREST schema cache did not become ready");
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  sql(`insert into public.tenants(id, name, lifecycle, contact_whatsapp) values ('${tenant}', 'Gerai Logo Uji', 'active', '081234567890');
    insert into public.outlets(tenant_id, id, name) values ('${tenant}', '${outlet}', 'Outlet Logo Uji');
    insert into public.memberships(tenant_id, user_id, role) values ('${tenant}', '${ownerId}', 'tenant_admin'), ('${tenant}', '${operatorId}', 'operator');`);
}, 90000);
afterAll(() => { sql(`delete from public.tenants where id = '${tenant}'`); });

describe("tenant logo privileges and isolation", () => {
  it("refuses operator uploads/removals, other gerai, anonymous, machine and demo writes", async () => {
    const operator = await signIn("operator-a@geraiexpress.test");
    const outsider = await signIn("owner-b@geraiexpress.test");
    for (const c of [operator, outsider]) {
      for (const a of [args(png, "image/png", revision()), args(null, null, revision())]) expect((await c.rpc("set_tenant_logo", a)).error?.message).toBe("admin_required");
    }
    for (const c of [client(), machine()]) expect((await c.rpc("set_tenant_logo", args(png, "image/png", revision()))).error).not.toBeNull();
    expect((await outsider.rpc("tenant_logo", { p_tenant: tenant })).error?.message).toBe("not_found");
    expect((await client().rpc("tenant_logo", { p_tenant: tenant })).error?.code).toBe("42501");
    const demo = await demoVisitor();
    expect((await demo.c.rpc("set_tenant_logo", { ...args(png, "image/png", 0), p_tenant: demo.tenant })).error?.message).toBe("demo_restricted");
    expect(versionCount()).toBe(0);
    expect(auditCount()).toBe(0);
  });
  it("has RLS and no direct table privileges even for tenant admin/service role", () => {
    expect(sql("select relrowsecurity from pg_class where oid = 'private.gerai_logo_versions'::regclass")).toBe("t");
    for (const role of ["anon", "authenticated", "service_role"]) {
      for (const privilege of ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE"]) expect(sql(`select has_table_privilege('${role}', 'private.gerai_logo_versions', '${privilege}')`), `${role}/${privilege}`).toBe("f");
    }
  });
});

describe("database validates size, magic and MIME independently of the upload server", () => {
  it("rejects SVG, metadata spoofing, broken base64, unsupported RIFF and oversize without audit", async () => {
    const c = await signIn("owner-a@geraiexpress.test");
    const before = versionCount(), audits = auditCount();
    for (const a of [args(Buffer.from("<svg onload='bad()'/>"), "image/svg+xml", revision()),
      args(png, "image/jpeg", revision()), args(Buffer.from("<svg/>"), "image/png", revision()),
      args(Buffer.from("RIFF0000WEBPXXXX"), "image/webp", revision()), args(Buffer.alloc(0), "image/png", revision()),
      { ...args(png, "image/png", revision()), p_base64: "!not base64!" },
      { ...args(png, "image/png", revision()), p_base64: "A" }, args(null, "image/png", revision())]) {
      expect((await c.rpc("set_tenant_logo", a)).error?.message).toBe("logo_type_invalid");
    }
    const huge = Buffer.alloc(204801); png.copy(huge);
    expect((await c.rpc("set_tenant_logo", args(huge, "image/png", revision()))).error?.message).toBe("logo_too_large");
    expect(versionCount()).toBe(before); expect(auditCount()).toBe(audits);
    expect(() => sql(`insert into private.gerai_logo_versions(tenant_id,version,mime,bytes,created_by)
      values ('${tenant}', 999, 'image/png', decode('3c7376672f3e','hex'), '${ownerId}')`)).toThrow(/gerai_logo_valid/);
    expect(() => sql(`insert into private.gerai_logo_versions(tenant_id,version,mime,bytes,created_by)
      values ('${tenant}', 999, 'image/png', decode('89504e470d0a1a0a' || repeat('00', 204793),'hex'), '${ownerId}')`)).toThrow(/gerai_logo_valid/);
  });
  it("versions upload/replace/remove atomically with audit and stale guard; operators can read", async () => {
    const c = await signIn("owner-a@geraiexpress.test");
    const first = revision();
    const max = Buffer.alloc(204800); png.copy(max);
    for (const [bytes, mime] of [[max, "image/png"], [jpeg, "image/jpeg"], [webp, "image/webp"]] as const) {
      const seen = revision();
      const result = await c.rpc("set_tenant_logo", args(bytes, mime, seen));
      expect(result.error).toBeNull();
      expect(result.data).toEqual({ revision: seen + 1, logo: { version: seen + 1, mime, base64: bytes.toString("base64") } });
    }
    const seen = revision();
    expect((await c.rpc("set_tenant_logo", args(png, "image/png", first))).error?.message).toBe("stale_state");
    expect((await c.rpc("set_tenant_logo", args(null, null, null))).error?.message).toBe("stale_state");
    // Identical upload is a no-op, no extra audit/version.
    expect((await c.rpc("set_tenant_logo", args(webp, "image/webp", seen))).error).toBeNull();
    expect(revision()).toBe(seen);
    const operator = await signIn("operator-a@geraiexpress.test");
    expect((await operator.rpc("tenant_logo", { p_tenant: tenant })).data).toEqual({ revision: seen, logo: { version: seen, mime: "image/webp", base64: webp.toString("base64") } });
    expect((await c.rpc("set_tenant_logo", args(null, null, seen))).data).toEqual({ revision: seen + 1, logo: null });
    expect((await c.rpc("set_tenant_logo", args(null, null, seen + 1))).data).toEqual({ revision: seen + 1, logo: null });
    const events = JSON.parse(sql(`select json_agg(json_build_object('outcome',outcome,'actor',actor,'detail',detail) order by id)
      from public.audit_events where action='tenant.logo' and target_tenant='${tenant}'`));
    expect(events.map((e: { outcome: string }) => e.outcome)).toEqual(["uploaded", "replaced", "replaced", "removed"]);
    expect(events.every((e: { actor: string }) => e.actor === ownerId)).toBe(true);
    expect(JSON.stringify(events)).not.toContain(webp.toString("base64"));
    expect(() => sql(`update private.gerai_logo_versions set mime = null where tenant_id = '${tenant}'`)).toThrow(/append_only/);
    expect(() => sql(`delete from private.gerai_logo_versions where tenant_id = '${tenant}'`)).toThrow(/append_only/);
  });
  it("serializes concurrent administrators using the same revision", async () => {
    const c = await signIn("owner-a@geraiexpress.test");
    const seen = revision();
    const results = await Promise.all([c.rpc("set_tenant_logo", args(png, "image/png", seen)), c.rpc("set_tenant_logo", args(jpeg, "image/jpeg", seen))]);
    expect(results.filter((r) => !r.error)).toHaveLength(1);
    expect(results.filter((r) => r.error?.message === "stale_state")).toHaveLength(1);
    expect(revision()).toBe(seen + 1);
  });
});

it.each([false, true])("freezes logo bytes, version and gerai name on the label, including removal; reprints never resolve current branding (masked=%s)", async (masked) => {
  const c = await signIn("owner-a@geraiexpress.test");
  expect((await c.rpc("set_tenant_logo", args(png, "image/png", revision()))).error).toBeNull();
  const logoRevision = revision();
  const shipment = randomUUID();
  sql(`insert into public.shipments(tenant_id,outlet_id,id,reference,submission_state,payment_state,sender_name,sender_phone,
    recipient_name,recipient_phone,recipient_address,recipient_area,item_description,weight_grams,goods_value_idr,is_cod,is_simulated,created_by,awb)
    values ('${tenant}','${outlet}','${shipment}','LOGO-${shipment.slice(0, 8)}','issued','paid','Pengirim Uji','081234567890',
    'Penerima Uji','081234567890','Jl. Tujuan Uji 9','Kota Uji','Buku',1000,50000,false,false,'${ownerId}','JP1234567890');`);
  const create = (mask = false) => c.rpc("create_label_snapshot", { p_shipment: shipment, p_mask: mask, p_size: "10x15",
    p_sender_name: mask ? "Pengirim Masking" : null, p_sender_phone: mask ? "081399998888" : null, p_sender_city: mask ? "Kota Uji" : null });
  const first = await create(masked); expect(first.error).toBeNull();
  const before = sql(`select row_to_json(s) from public.label_snapshots s where id='${first.data}'`);
  const saved = JSON.parse(before);
  expect(saved.gerai_logo).toEqual({ version: logoRevision, mime: "image/png", base64: png.toString("base64") });
  expect(saved.gerai_logo_revision).toBe(logoRevision);
  if (masked) expect(saved).toMatchObject({ printed_sender_name: "Pengirim Masking", printed_sender_phone: "081399998888", printed_sender_city: "Kota Uji", printed_sender_address: null });
  expect((await c.rpc("set_tenant_logo", args(jpeg, "image/jpeg", revision()))).error).toBeNull();
  expect((await create(masked)).data).toBe(first.data);
  expect((await c.rpc("set_tenant_logo", args(null, null, revision()))).error).toBeNull();
  sql(`update public.tenants set name='Gerai Setelah Ganti' where id='${tenant}'`);
  expect((await create(masked)).data).toBe(first.data);
  expect((await c.rpc("record_label_print", { p_snapshot: first.data })).error).toBeNull();
  expect(sql(`select row_to_json(s) from public.label_snapshots s where id='${first.data}'`)).toBe(before);
  const next = await create(!masked); expect(next.error).toBeNull();
  const removed = JSON.parse(sql(`select row_to_json(s) from public.label_snapshots s where id='${next.data}'`));
  expect(removed.gerai_logo).toBeNull(); expect(removed.gerai_logo_revision).toBe(revision());
  expect(removed.true_tenant_name).toBe("Gerai Setelah Ganti");
  expect(removed.content_digest).not.toBe(saved.content_digest);
  const outsider = await signIn("owner-b@geraiexpress.test");
  expect((await outsider.from("label_snapshots").select("gerai_logo, true_tenant_name").eq("id", first.data)).data).toEqual([]);
  expect((await outsider.rpc("record_label_print", { p_snapshot: first.data })).error).not.toBeNull();
});
