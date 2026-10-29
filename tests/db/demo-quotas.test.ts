import { describe, expect, it } from "vitest";
import { client, demoVisitor, machine, sql } from "./helpers";

// T-051 (DIL-07, DIL-15, DIL-19): caps for demo tenants, race-safe start_demo, bounded cleanup and
// the database-side schedule. Cap values live in private.enforce_demo_quota().
const CAPS = { shipments: 100, contacts: 100, addresses: 300, quotes: 300 };

// psql prints the command tag ("INSERT 0 1") after RETURNING rows: keep only uuid lines.
const uuids = (out: string) => out.split("\n").filter((l) => /^[0-9a-f-]{36}$/.test(l));

const count = (table: string, tenant: string) => Number(sql(`select count(*) from public.${table} where tenant_id = '${tenant}'`));

function expectDemoLimit(error: { message: string; code?: string } | null) {
  expect(error?.message).toBe("demo_limit");
  expect(error?.code).toBe("55000");
}

describe("demo tenant quotas (DIL-07)", () => {
  it("refuses the draft after the shipment cap through create_shipment_draft", async () => {
    const v = await demoVisitor();
    const have = count("shipments", v.tenant);
    const user = (await v.c.auth.getUser()).data.user!.id;
    sql(`insert into public.shipments (tenant_id, outlet_id, reference, created_by, is_simulated)
      select '${v.tenant}', '${v.outlet}', 'CAP-' || g, '${user}', true from generate_series(1, ${CAPS.shipments - have}) g`);
    expect(count("shipments", v.tenant)).toBe(CAPS.shipments);

    const over = await v.c.rpc("create_shipment_draft", { p_outlet: v.outlet });
    expectDemoLimit(over.error);
    expect(count("shipments", v.tenant)).toBe(CAPS.shipments);

    // Another demo tenant has its own budget.
    const other = await demoVisitor();
    expect((await other.c.rpc("create_shipment_draft", { p_outlet: other.outlet })).error).toBeNull();
  });

  it("refuses contacts and contact addresses through the Data API once the cap is reached", async () => {
    const v = await demoVisitor();
    const contactRows = (n: number, tag: string) =>
      Array.from({ length: n }, (_, i) => ({ tenant_id: v.tenant, name: `Kontak ${tag}${i}`, phone: "081200000099", is_recipient: true }));

    const fill = CAPS.contacts - count("contacts", v.tenant);
    expect((await v.c.from("contacts").insert(contactRows(fill, "isi"))).error).toBeNull();
    expect(count("contacts", v.tenant)).toBe(CAPS.contacts);
    expectDemoLimit((await v.c.from("contacts").insert(contactRows(1, "lebih"))).error);
    expect(count("contacts", v.tenant)).toBe(CAPS.contacts);

    const { data: first } = await v.c.from("contacts").select("id").eq("tenant_id", v.tenant).limit(1).single();
    const addressRows = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ tenant_id: v.tenant, contact_id: first!.id, label: "Uji", address_line: `Jl. Uji No. ${i}`, area: "Kec. Uji, Kota Uji" }));
    const addrFill = CAPS.addresses - count("contact_addresses", v.tenant);
    expect((await v.c.from("contact_addresses").insert(addressRows(addrFill))).error).toBeNull();
    expectDemoLimit((await v.c.from("contact_addresses").insert(addressRows(1))).error);
    expect(count("contact_addresses", v.tenant)).toBe(CAPS.addresses);
  });

  it("refuses request_quotes once the quote cap is reached and keeps the draft unchanged", async () => {
    const v = await demoVisitor();
    const { data: draft } = await v.c.from("shipments").select("id, revision")
      .eq("tenant_id", v.tenant).eq("submission_state", "draft").limit(1).single();
    const { error: upd } = await v.c.from("shipments").update({
      sender_name: "Budi", sender_phone: "081200000001", recipient_name: "Sari", recipient_phone: "081200000003",
      recipient_address: "Jl. Uji 1", recipient_area: "Kec. Uji", weight_grams: 1000, item_description: "Buku",
    }).eq("id", draft!.id);
    expect(upd).toBeNull();
    const { data: fresh } = await v.c.from("shipments").select("revision").eq("id", draft!.id).single();

    const have = count("shipment_quotes", v.tenant);
    sql(`insert into public.shipment_quotes (tenant_id, shipment_id, shipment_revision, courier, service,
        normal_tariff_idr, eta_days, is_simulated, expires_at)
      select '${v.tenant}', '${draft!.id}', 0, 'Kurir Simulasi', 'Reguler', 10000, '2 hari', true, now() - interval '1 day'
      from generate_series(1, ${CAPS.quotes - have})`);
    expect(count("shipment_quotes", v.tenant)).toBe(CAPS.quotes);

    const over = await v.c.rpc("request_quotes", { p_shipment: draft!.id, p_expected_revision: fresh!.revision });
    expectDemoLimit(over.error);
    expect(count("shipment_quotes", v.tenant)).toBe(CAPS.quotes);
    expect(sql(`select submission_state from public.shipments where id = '${draft!.id}'`)).toBe("draft");
  });

  it("does not limit a real tenant", () => {
    const [tenant] = uuids(sql(`insert into public.tenants (name, lifecycle, is_demo) values ('Gerai Uji Kuota Nyata', 'active', false) returning id`));
    const [outlet] = uuids(sql(`insert into public.outlets (tenant_id, name, pickup_address, pickup_area)
      values ('${tenant}', 'Outlet Uji', 'Jl. Uji 1', 'Kec. Uji') returning id`));
    try {
      const author = sql(`select id from auth.users order by created_at limit 1`);
      sql(`insert into public.shipments (tenant_id, outlet_id, reference, created_by, is_simulated)
        select '${tenant}', '${outlet}', 'REAL-' || g, '${author}', false from generate_series(1, ${CAPS.shipments + 10}) g`);
      sql(`insert into public.contacts (tenant_id, name, phone, is_recipient)
        select '${tenant}', 'Kontak ' || g, '08120' || lpad(g::text, 6, '0'), true from generate_series(1, ${CAPS.contacts + 10}) g`);
      const contact = sql(`select id from public.contacts where tenant_id = '${tenant}' limit 1`);
      sql(`insert into public.contact_addresses (tenant_id, contact_id, label, address_line, area)
        select '${tenant}', '${contact}', 'Uji', 'Jl. Uji ' || g, 'Kec. Uji' from generate_series(1, ${CAPS.addresses + 10}) g`);
      const shipment = sql(`select id from public.shipments where tenant_id = '${tenant}' limit 1`);
      sql(`insert into public.shipment_quotes (tenant_id, shipment_id, shipment_revision, courier, service,
          normal_tariff_idr, eta_days, is_simulated, expires_at)
        select '${tenant}', '${shipment}', 0, 'Kurir', 'Reguler', 10000, '2 hari', false, now() from generate_series(1, ${CAPS.quotes + 10})`);
      expect(count("shipments", tenant)).toBe(CAPS.shipments + 10);
      expect(count("contacts", tenant)).toBe(CAPS.contacts + 10);
      expect(count("contact_addresses", tenant)).toBe(CAPS.addresses + 10);
      expect(count("shipment_quotes", tenant)).toBe(CAPS.quotes + 10);
    } finally {
      sql(`delete from public.shipments where tenant_id = '${tenant}'; delete from public.tenants where id = '${tenant}'`);
    }
  });
});

describe("start_demo concurrency (DIL-15)", () => {
  it("returns one tenant for parallel calls of the same anonymous user", async () => {
    for (let round = 0; round < 3; round++) {
      const c = client();
      const { data: auth, error } = await c.auth.signInAnonymously();
      expect(error).toBeNull();
      const user = auth.user!.id;
      const results = await Promise.all([1, 2, 3, 4].map(() => c.rpc("start_demo")));
      for (const r of results) expect(r.error).toBeNull();
      expect(new Set(results.map((r) => r.data)).size).toBe(1);
      expect(sql(`select count(*) from public.memberships where user_id = '${user}'`)).toBe("1");
    }
  });
});

describe("bounded demo cleanup (DIL-19)", () => {
  it("removes at most p_batch expired demo tenants per call and reports has_more", async () => {
    const ids = uuids(sql(`insert into public.tenants (name, lifecycle, is_demo, created_at)
      select 'Demo Kedaluwarsa ' || g, 'active', true, now() - interval '40 hours' from generate_series(1, 5) g returning id`));
    expect(ids).toHaveLength(5);
    const remaining = () => Number(sql(`select count(*) from public.tenants where id in ('${ids.join("','")}')`));

    let runs = 0;
    let first: { deleted_tenants: number; has_more: boolean } | null = null;
    while (remaining() > 0 && runs < 20) {
      const res = await machine().rpc("cleanup_expired_demos", { p_max_age_hours: 24, p_batch: 2 });
      expect(res.error).toBeNull();
      const summary = res.data as { deleted_tenants: number; deleted_users: number; has_more: boolean };
      expect(summary.deleted_tenants).toBeLessThanOrEqual(2);
      first ??= summary;
      runs++;
    }
    expect(remaining()).toBe(0);
    expect(runs).toBeGreaterThanOrEqual(3);
    expect(first).toMatchObject({ deleted_tenants: 2, has_more: true });
  });

  it("keeps the one-argument call working with the default batch and validates the batch size", async () => {
    expect((await machine().rpc("cleanup_expired_demos", { p_max_age_hours: 24 })).error).toBeNull();
    expect((await machine().rpc("cleanup_expired_demos")).error).toBeNull();
    for (const p_batch of [0, 5001]) {
      expect((await machine().rpc("cleanup_expired_demos", { p_max_age_hours: 24, p_batch })).error?.message).toBe("invalid_input");
    }
    expect((await client().rpc("cleanup_expired_demos", { p_max_age_hours: 24 })).error).not.toBeNull();
  });

  it("schedules the hourly job inside the database when pg_cron is available", () => {
    const available = sql(`select count(*) from pg_available_extensions where name = 'pg_cron'`) === "1";
    if (!available) {
      // Stack without pg_cron: the migration must not have created the extension or a job.
      expect(sql(`select count(*) from pg_extension where extname = 'pg_cron'`)).toBe("0");
      return;
    }
    expect(sql(`select count(*) from pg_extension where extname = 'pg_cron'`)).toBe("1");
    expect(sql(`select schedule || '|' || command from cron.job where jobname = 'demo-cleanup'`))
      .toBe("0 * * * *|select public.cleanup_expired_demos(24, 200)");
    // Re-scheduling under the same name updates the job instead of adding a second one.
    sql(`select cron.schedule('demo-cleanup', '0 * * * *', 'select public.cleanup_expired_demos(24, 200)')`);
    expect(sql(`select count(*) from cron.job where jobname = 'demo-cleanup'`)).toBe("1");
  });
});
