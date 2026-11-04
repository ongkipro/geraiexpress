// T-093 / DEC-024 (a): Super Admin customer-data review. Only `customer_data_review` may read; every
// read needs a reason and writes one audit row (the phone is stored masked plus a SHA-256, never in
// clear). The cross-gerai profile counts one normalized phone across gerai and cabang; demo gerai and
// simulated shipments are not counted.
import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { IDS, client, signIn, signInAal2, sql } from "./helpers";

const ADMIN = "00000000-0000-4000-a000-0000000000f1";
const OWNER_A = "00000000-0000-4000-a000-0000000000a1";
// A number used nowhere else: two gerai (A twice, as recipient and sender; B once), one simulated row.
const PHONE = `0819${String(Date.now()).slice(-8)}`;
const ids = { a1: randomUUID(), a2: randomUUID(), b1: randomUUID(), sim: randomUUID(), demo: randomUUID() };
// A guaranteed demo gerai holding the same phone: it must never count and is refused per gerai.
const DEMO = { tenant: randomUUID(), outlet: randomUUID() };
// A gerai with 25 real shipments for pagination (page size 20 in the app, any size here).
const PAGED = { tenant: randomUUID(), outlet: randomUUID(), ids: Array.from({ length: 25 }, () => randomUUID()) };
let before = "";

function shipment(id: string, tenant: string, outlet: string, sender: string, recipient: string, simulated = false) {
  return `insert into public.shipments (id, tenant_id, outlet_id, reference, created_by, is_simulated,
      sender_name, sender_phone, recipient_name, recipient_phone, recipient_address, recipient_area, item_description, weight_grams)
    values ('${id}', '${tenant}', '${outlet}', 'T093-${id.slice(0, 8)}', '${OWNER_A}', ${simulated},
      'Pengirim T093', '${sender}', 'Penerima T093', '${recipient}', 'Jl. Uji T093 No. 9', 'Kota Uji', 'Buku', 500);`;
}

const audits = (action: string) => Number(sql(`select count(*) from public.audit_events where action = '${action}' and actor = '${ADMIN}'`));

beforeAll(() => {
  before = sql(`select capabilities::text from public.platform_grants where user_id = '${ADMIN}' and revoked_at is null`);
  sql(`update public.platform_grants set capabilities = array_append(capabilities, 'customer_data_review') where user_id = '${ADMIN}' and revoked_at is null;
    ${shipment(ids.a1, IDS.tenantA, IDS.outletA, "081200000001", `+62${PHONE.slice(1)}`)}
    ${shipment(ids.a2, IDS.tenantA, IDS.outletA, PHONE, "081200000002")}
    ${shipment(ids.b1, IDS.tenantB, IDS.outletB, "081200000003", PHONE)}
    ${shipment(ids.sim, IDS.tenantB, IDS.outletB, "081200000004", PHONE, true)}
    insert into public.tenants (id, name, lifecycle, is_demo) values ('${DEMO.tenant}', 'Gerai Demo T093', 'active', true),
      ('${PAGED.tenant}', 'Gerai Halaman T093', 'active', false);
    insert into public.outlets (tenant_id, id, name) values ('${DEMO.tenant}', '${DEMO.outlet}', 'Outlet Demo T093'),
      ('${PAGED.tenant}', '${PAGED.outlet}', 'Outlet Halaman T093');
    ${shipment(ids.demo, DEMO.tenant, DEMO.outlet, "081200000005", PHONE)}
    ${PAGED.ids.map((id) => shipment(id, PAGED.tenant, PAGED.outlet, "081200000006", "081200000007")).join("\n")}`);
});

afterAll(() => {
  sql(`update public.platform_grants set capabilities = '${before}'::text[] where user_id = '${ADMIN}' and revoked_at is null;
    delete from public.shipments where id in ('${[...Object.values(ids), ...PAGED.ids].join("','")}');
    delete from public.outlets where tenant_id in ('${DEMO.tenant}', '${PAGED.tenant}');
    delete from public.tenants where id in ('${DEMO.tenant}', '${PAGED.tenant}');`);
});

describe("customer-data review (T-093)", () => {
  it("no seeded grant holds the capability, and every caller without it is refused at the RPC", async () => {
    expect(sql(`select count(*) from public.platform_grants where 'customer_data_review' = any (capabilities) and user_id <> '${ADMIN}'`)).toBe("0");
    const monitor = await signInAal2("admin-new@geraiexpress.test"); // platform_monitoring + audit_review
    const governor = await signInAal2("admin-2@geraiexpress.test"); // every capability except this one
    const member = await signIn("owner-a@geraiexpress.test");
    const args = { p_phone: PHONE, p_reason: "Uji penolakan" };
    const page = { p_tenant: IDS.tenantA, p_reason: "Uji penolakan", p_limit: 10, p_offset: 0 };
    const lookups = Number(sql(`select count(*) from public.audit_events where action like 'customer_data.%'`));
    for (const c of [monitor, governor, member, client()]) {
      const l = await c.rpc("platform_customer_lookup", args);
      const t = await c.rpc("platform_tenant_customers", page);
      expect(l.error).not.toBeNull();
      expect(t.error).not.toBeNull();
      // A refusal carries no data at all.
      expect(l.data).toBeNull();
      expect(t.data).toBeNull();
    }
    // Refused calls leave no audit row (nothing was read).
    expect(Number(sql(`select count(*) from public.audit_events where action like 'customer_data.%'`))).toBe(lookups);
    expect((await governor.rpc("platform_customer_lookup", args)).error?.message).toBe("platform_access_required");
    expect((await member.rpc("platform_tenant_customers", page)).error?.message).toBe("platform_access_required");
    // The grant check runs before input validation: a refused caller learns nothing about the phone.
    expect((await governor.rpc("platform_customer_lookup", { p_phone: "x", p_reason: "" })).error?.message).toBe("platform_access_required");
  });

  it("aggregates one normalized phone across gerai and cabang, excluding simulated rows, and audits the read", async () => {
    const admin = await signInAal2("admin@geraiexpress.test");
    const n = audits("customer_data.lookup");
    const { data, error } = await admin.rpc("platform_customer_lookup", { p_phone: `(+62) ${PHONE.slice(1, 4)}-${PHONE.slice(4)}`, p_reason: "Uji profil pelanggan" });
    expect(error).toBeNull();
    expect(data).toMatchObject({ phone: PHONE, shipments: 3, as_recipient: 2, as_sender: 1, gerai_count: 2 });
    const a = data.gerai.find((g: { tenant_id: string }) => g.tenant_id === IDS.tenantA);
    expect(a).toMatchObject({ shipments: 2, as_recipient: 1, as_sender: 1, outlet_name: "Outlet Uji A" });
    expect(data.gerai.find((g: { tenant_id: string }) => g.tenant_id === IDS.tenantB)).toMatchObject({ shipments: 1, outlet_name: "Outlet Uji B" });
    expect(audits("customer_data.lookup")).toBe(n + 1);
    const row = JSON.parse(sql(`select row_to_json(e) from public.audit_events e where action = 'customer_data.lookup' and actor = '${ADMIN}' order by id desc limit 1`));
    expect(row).toMatchObject({ reason: "Uji profil pelanggan", outcome: "found" });
    expect(row.detail).toMatchObject({ shipments: 3, gerai_count: 2, phone_hint: `${PHONE.slice(0, 4)}•••••${PHONE.slice(-3)}` });
    // The exact SHA-256 of the normalized key, not just a digest-shaped value.
    expect(row.detail.phone_sha256).toBe(createHash("sha256").update(PHONE).digest("hex"));
    // The demo gerai holding the same phone contributed nothing.
    expect(data.gerai.some((g: { tenant_id: string }) => g.tenant_id === DEMO.tenant)).toBe(false);
    // The local and +62 forms are one customer: same totals, same audited digest.
    const local = await admin.rpc("platform_customer_lookup", { p_phone: PHONE, p_reason: "Uji bentuk lokal" });
    expect(local.data).toMatchObject({ shipments: 3, gerai_count: 2 });
    expect(sql(`select detail->>'phone_sha256' from public.audit_events where action = 'customer_data.lookup' and actor = '${ADMIN}' order by id desc limit 1`))
      .toBe(row.detail.phone_sha256);
    // The audit row never carries the number in clear.
    expect(JSON.stringify(row)).not.toContain(PHONE);
  });

  it("an unknown phone is audited as none; a missing reason or a malformed phone is refused without an audit row", async () => {
    const admin = await signInAal2("admin@geraiexpress.test");
    const n = audits("customer_data.lookup");
    const none = await admin.rpc("platform_customer_lookup", { p_phone: "089900000000", p_reason: "Uji tidak ada" });
    expect(none.error).toBeNull();
    expect(none.data).toMatchObject({ shipments: 0, gerai_count: 0, gerai: [] });
    expect(sql(`select outcome from public.audit_events where action = 'customer_data.lookup' and actor = '${ADMIN}' order by id desc limit 1`)).toBe("none");
    // Without a valid reason nothing is read: refused, no data, no audit row (empty, blank, too short, too long).
    for (const reason of [null, "", "     ", "ok", "x".repeat(501)]) {
      const r = await admin.rpc("platform_customer_lookup", { p_phone: PHONE, p_reason: reason });
      expect(r.error?.message, JSON.stringify(reason)).toBe("reason_required");
      expect(r.data).toBeNull();
    }
    expect((await admin.rpc("platform_customer_lookup", { p_phone: "12ab", p_reason: "Uji format" })).error?.message).toBe("invalid_input");
    expect(audits("customer_data.lookup")).toBe(n + 1);
  });

  it("lists one gerai's shipment customer details page by page, audited per page, and refuses demo/unknown gerai", async () => {
    const admin = await signInAal2("admin@geraiexpress.test");
    const n = audits("customer_data.tenant_view");
    const { data, error } = await admin.rpc("platform_tenant_customers", { p_tenant: IDS.tenantB, p_reason: "Uji data gerai", p_limit: 50, p_offset: 0 });
    expect(error).toBeNull();
    expect(data.total).toBe(Number(sql(`select count(*) from public.shipments where tenant_id = '${IDS.tenantB}' and not is_simulated`)));
    const ours = data.rows.find((r: { id: string }) => r.id === ids.b1);
    expect(ours).toMatchObject({ recipient_name: "Penerima T093", recipient_phone: PHONE, outlet_name: "Outlet Uji B" });
    expect(data.rows.some((r: { id: string }) => r.id === ids.sim)).toBe(false);
    expect(data.rows.every((r: Record<string, unknown>) => !("customer_charge_idr" in r) && !("pickup_snapshot" in r))).toBe(true);
    // Cross-tenant: tenant B's page never carries tenant A's rows.
    expect(data.rows.some((r: { id: string }) => r.id === ids.a1 || r.id === ids.a2)).toBe(false);
    expect(audits("customer_data.tenant_view")).toBe(n + 1);
    expect(sql(`select target_tenant from public.audit_events where action = 'customer_data.tenant_view' and actor = '${ADMIN}' order by id desc limit 1`)).toBe(IDS.tenantB);
    for (const bad of [{ p_limit: 0 }, { p_limit: 51 }, { p_offset: -1 }]) {
      const res = await admin.rpc("platform_tenant_customers", { p_tenant: IDS.tenantB, p_reason: "Uji batas", p_limit: 10, p_offset: 0, ...bad });
      expect(res.error?.message, JSON.stringify(bad)).toBe("invalid_input");
    }
    for (const reason of [null, "", "     ", "ok", "x".repeat(501)]) {
      const r = await admin.rpc("platform_tenant_customers", { p_tenant: IDS.tenantB, p_reason: reason, p_limit: 10, p_offset: 0 });
      expect(r.error?.message, JSON.stringify(reason)).toBe("reason_required");
      expect(r.data).toBeNull();
    }
    expect((await admin.rpc("platform_tenant_customers", { p_tenant: randomUUID(), p_reason: "Uji tidak ada", p_limit: 10, p_offset: 0 })).error?.message).toBe("not_found");
    expect((await admin.rpc("platform_tenant_customers", { p_tenant: DEMO.tenant, p_reason: "Uji demo", p_limit: 10, p_offset: 0 })).error?.message).toBe("not_found");
    // The tenant RPC also checks the capability before validating its input.
    const governor = await signInAal2("admin-2@geraiexpress.test");
    expect((await governor.rpc("platform_tenant_customers", { p_tenant: IDS.tenantB, p_reason: "", p_limit: 0, p_offset: -1 })).error?.message).toBe("platform_access_required");
    for (const bad of [{ p_limit: null }, { p_offset: null }]) {
      const res = await admin.rpc("platform_tenant_customers", { p_tenant: IDS.tenantB, p_reason: "Uji batas null", p_limit: 10, p_offset: 0, ...bad });
      expect(res.error?.message, JSON.stringify(bad)).toBe("invalid_input");
    }
    expect(audits("customer_data.tenant_view")).toBe(n + 1);
  });

  it("pages through one gerai without gaps or duplicates, one audited read per page with its offset", async () => {
    const admin = await signInAal2("admin@geraiexpress.test");
    const n = audits("customer_data.tenant_view");
    const page = (offset: number) => admin.rpc("platform_tenant_customers", { p_tenant: PAGED.tenant, p_reason: "Uji halaman", p_limit: 20, p_offset: offset });
    const first = await page(0), second = await page(20), beyond = await page(40);
    expect(first.data).toMatchObject({ total: 25 });
    expect(first.data.rows).toHaveLength(20);
    expect(second.data.rows).toHaveLength(5);
    expect(beyond.data.rows).toEqual([]);
    const seen = [...first.data.rows, ...second.data.rows].map((r: { id: string }) => r.id);
    expect(new Set(seen).size).toBe(25);
    expect([...seen].sort()).toEqual([...PAGED.ids].sort());
    expect(audits("customer_data.tenant_view")).toBe(n + 3);
    const details = JSON.parse(sql(`select json_agg(json_build_object('reason', reason, 'offset', (detail->>'offset')::int, 'rows', (detail->>'rows')::int) order by id)
      from (select * from public.audit_events where action = 'customer_data.tenant_view' and actor = '${ADMIN}' order by id desc limit 3) e`));
    expect(details).toEqual([{ reason: "Uji halaman", offset: 0, rows: 20 }, { reason: "Uji halaman", offset: 20, rows: 5 }, { reason: "Uji halaman", offset: 40, rows: 0 }]);
  });

  it("the capability can be granted only through the governed grant RPC and is validated by the table", async () => {
    expect(() => sql(`update public.platform_grants set capabilities = array['customer_data'] where user_id = '${ADMIN}'`)).toThrow();
    // The grant RPC accepts the new capability (access_governance, reason, audit).
    const admin = await signInAal2("admin@geraiexpress.test");
    const current = JSON.parse(sql(`select to_json(capabilities) from public.platform_grants where user_id = '${ADMIN}'`)) as string[];
    const res = await admin.rpc("platform_set_grant", { p_email: "admin@geraiexpress.test", p_capabilities: current, p_reason: "Uji kemampuan data pelanggan" });
    expect(res.error).toBeNull();
    expect(sql(`select 'customer_data_review' = any (capabilities) from public.platform_grants where user_id = '${ADMIN}'`)).toBe("t");
  });
});
