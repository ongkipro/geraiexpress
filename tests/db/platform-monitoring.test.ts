// T-092 / DEC-024: read-only platform monitoring. Aggregates only; platform_monitoring or tenant_governance;
// every other caller is refused, and no response carries a customer name, phone or address.
import { describe, expect, it } from "vitest";
import { IDS, client, signIn, signInAal2, sql } from "./helpers";

const CUSTOMER_KEYS = /recipient|sender_name|sender_phone|phone|address|email/i;

describe("platform monitoring RPCs (T-092)", () => {
  it("overview counts real gerai and shipments, and is refused to members, anonymous and integration-only admins", async () => {
    const admin = await signInAal2("admin@geraiexpress.test");
    const { data, error } = await admin.rpc("platform_overview");
    expect(error).toBeNull();
    expect(data.tenants.total).toBe(Number(sql("select count(*) from public.tenants where not is_demo")));
    expect(Object.keys(data.attention).sort()).toEqual(["awaiting_payment", "failed", "in_flight", "queued", "unknown"]);
    expect(JSON.stringify(data)).not.toMatch(CUSTOMER_KEYS);
    // Seed admin-new holds platform_monitoring + audit_review only: allowed.
    const monitor = await signInAal2("admin-new@geraiexpress.test");
    expect((await monitor.rpc("platform_overview")).error).toBeNull();
    expect((await (await signIn("owner-a@geraiexpress.test")).rpc("platform_overview")).error?.message).toBe("platform_access_required");
    expect((await client().rpc("platform_overview")).error).not.toBeNull();
    const ADMIN2 = "00000000-0000-4000-a000-0000000000f2";
    const before = sql(`select capabilities::text from public.platform_grants where user_id = '${ADMIN2}' and revoked_at is null`);
    sql(`update public.platform_grants set capabilities = array['integration_operations'] where user_id = '${ADMIN2}' and revoked_at is null`);
    try {
      const integrationOnly = await signInAal2("admin-2@geraiexpress.test");
      expect((await integrationOnly.rpc("platform_overview")).error?.message).toBe("platform_access_required");
      expect((await integrationOnly.rpc("platform_tenant_summary", { p_tenant: IDS.tenantA })).error?.message).toBe("platform_access_required");
    } finally {
      sql(`update public.platform_grants set capabilities = '${before}'::text[] where user_id = '${ADMIN2}' and revoked_at is null`);
    }
  });

  it("directory searches by name (wildcards are literal), filters, pages, and excludes demo gerai", async () => {
    const admin = await signInAal2("admin-new@geraiexpress.test");
    const all = await admin.rpc("platform_tenant_directory", { p_query: null, p_lifecycle: null, p_limit: 100, p_offset: 0 });
    expect(all.error).toBeNull();
    expect(all.data.total).toBe(Number(sql("select count(*) from public.tenants where not is_demo")));
    const nameA = sql(`select name from public.tenants where id = '${IDS.tenantA}'`);
    // A distinctive substring: other suites create many tenants named "Gerai …" in the shared test DB.
    const found = await admin.rpc("platform_tenant_directory", { p_query: nameA.slice(-6), p_lifecycle: "active", p_limit: 100, p_offset: 0 });
    expect(found.data.rows.map((r: { id: string }) => r.id)).toContain(IDS.tenantA);
    const wildcard = await admin.rpc("platform_tenant_directory", { p_query: "%", p_lifecycle: null, p_limit: 100, p_offset: 0 });
    expect(wildcard.data.total).toBe(Number(sql("select count(*) from public.tenants where not is_demo and (name like '%\\%%' or slug like '%\\%%')")));
    const page1 = await admin.rpc("platform_tenant_directory", { p_query: null, p_lifecycle: null, p_limit: 1, p_offset: 0 });
    const page2 = await admin.rpc("platform_tenant_directory", { p_query: null, p_lifecycle: null, p_limit: 1, p_offset: 1 });
    if (all.data.total > 1) expect(page1.data.rows[0].id).not.toBe(page2.data.rows[0].id);
    for (const bad of [{ p_limit: 0 }, { p_limit: 101 }, { p_offset: -1 }, { p_lifecycle: "x" }, { p_query: "x".repeat(81) }]) {
      const res = await admin.rpc("platform_tenant_directory", { p_query: null, p_lifecycle: null, p_limit: 10, p_offset: 0, ...bad });
      expect(res.error?.message, JSON.stringify(bad)).toBe("invalid_input");
    }
    expect(JSON.stringify(all.data.rows)).not.toMatch(CUSTOMER_KEYS);
    const demo = sql("select id from public.tenants where is_demo limit 1");
    if (demo) expect(all.data.rows.some((r: { id: string }) => r.id === demo)).toBe(false);
  });

  it("per-gerai summary aggregates one gerai without customer fields and refuses demo or unknown ids", async () => {
    const admin = await signInAal2("admin@geraiexpress.test");
    const { data, error } = await admin.rpc("platform_tenant_summary", { p_tenant: IDS.tenantA });
    expect(error).toBeNull();
    expect(data).toMatchObject({ id: IDS.tenantA });
    expect(data.activity.last_30_days).toBe(Number(sql(`select count(*) from public.shipments where tenant_id = '${IDS.tenantA}'
      and not is_simulated and created_at >= now() - interval '30 days'`)));
    expect(Array.isArray(data.outlets)).toBe(true);
    expect(JSON.stringify(data)).not.toMatch(CUSTOMER_KEYS);
    expect((await admin.rpc("platform_tenant_summary", { p_tenant: "00000000-0000-4000-b000-999999999999" })).error?.message).toBe("not_found");
    const demo = sql("select id from public.tenants where is_demo limit 1");
    if (demo) expect((await admin.rpc("platform_tenant_summary", { p_tenant: demo })).error?.message).toBe("not_found");
    expect((await (await signIn("owner-a@geraiexpress.test")).rpc("platform_tenant_summary", { p_tenant: IDS.tenantA })).error?.message).toBe("platform_access_required");
  });
});

describe("platform monitoring repairs (T-092 review)", () => {
  it("counts only shipments created today (WIB) as created, and issued-today separately", async () => {
    const { realOperation } = await import("./helpers");
    const f = await realOperation();
    const today = "(date_trunc('day', now() at time zone 'Asia/Jakarta')) at time zone 'Asia/Jakarta'";
    const admin = await signInAal2("admin@geraiexpress.test");
    const base = (await admin.rpc("platform_overview")).data.shipments_today;
    // Created one second before WIB midnight, issued one second after: issued today, not created today.
    sql(`update public.shipments set created_at = ${today} - interval '1 second', issued_at = ${today} + interval '1 second',
      submission_state = 'issued' where id = '${f.shipment}'`);
    const after = (await admin.rpc("platform_overview")).data.shipments_today;
    expect(after.issued).toBe(base.issued + 1);
    expect(after.created).toBe(base.created - 1);
    // Created exactly at WIB midnight counts as today.
    sql(`update public.shipments set created_at = ${today} where id = '${f.shipment}'`);
    expect((await admin.rpc("platform_overview")).data.shipments_today.created).toBe(base.created);
  });

  it("the directory attention filter returns exactly the gerai with that condition", async () => {
    const { realOperation } = await import("./helpers");
    const f = await realOperation();
    sql(`update public.shipments set submission_state = 'unknown' where id = '${f.shipment}'`);
    const admin = await signInAal2("admin-new@geraiexpress.test");
    const args = { p_query: null, p_lifecycle: null, p_limit: 100, p_offset: 0 };
    const unknown = await admin.rpc("platform_tenant_directory", { ...args, p_attention: "unknown" });
    expect(unknown.error).toBeNull();
    expect(unknown.data.total).toBe(Number(sql(`select count(distinct s.tenant_id) from public.shipments s join public.tenants t on t.id = s.tenant_id
      where not t.is_demo and not s.is_simulated and s.submission_state = 'unknown'`)));
    expect(unknown.data.rows.map((r: { id: string }) => r.id)).toContain(f.tenant);
    const failed = await admin.rpc("platform_tenant_directory", { ...args, p_attention: "failed" });
    expect(failed.data.rows.map((r: { id: string }) => r.id)).not.toContain(f.tenant);
    expect((await admin.rpc("platform_tenant_directory", { ...args, p_attention: "x" })).error?.message).toBe("invalid_input");
  });
});

describe("platform_pending_applications (T-092 re-review)", () => {
  it("lists submitted applications without contact fields for monitoring, and refuses members", async () => {
    const admin = await signInAal2("admin-new@geraiexpress.test");
    const { data, error } = await admin.rpc("platform_pending_applications");
    expect(error).toBeNull();
    expect(data).toHaveLength(Number(sql("select count(*) from public.tenant_applications where status = 'submitted'")));
    for (const row of data as Record<string, unknown>[]) {
      expect(Object.keys(row).sort()).toEqual(["business_name", "id", "outlet_name", "pickup_area", "revision", "submitted_at"]);
    }
    expect((await (await signIn("owner-a@geraiexpress.test")).rpc("platform_pending_applications")).error?.message).toBe("platform_access_required");
  });
});
