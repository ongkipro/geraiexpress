// T-041 / PR-23 / DATA-9 / BILL-3 (DEC-012, DEC-016, DEC-018): versioned per-tenant gerai discount
// terms. The database refuses a gerai discount above the provider-observed discount, keeps terms
// append-only, derives the observed discount and the platform remainder (never typed), computes the
// gerai cost with integer arithmetic rounded down, and shows tenants nothing but their own terms.
import { randomUUID } from "node:crypto";
import type { TestClient } from "./helpers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { client, signIn, signInAal2, sql } from "./helpers";
import { formatPercentBps, parsePercentToBps } from "../../src/modules/pricing/percent";

const OWNER_A = "00000000-0000-4000-a000-0000000000a1";
const OPERATOR_A = "00000000-0000-4000-a000-0000000000a2";
const OWNER_B = "00000000-0000-4000-a000-0000000000b1";
const ADMIN = "00000000-0000-4000-a000-0000000000f1";

// Fresh tenants so the shared fixtures stay untouched: X (admin owner-a, operator operator-a) and
// Y (admin owner-b). Everything is removed in afterAll.
const X = randomUUID();
const Y = randomUUID();
const Z = randomUUID(); // batch and ceiling cases
const V = randomUUID(); // rupiah rounding cases
const quotes: string[] = [];
const shipments: Record<string, string> = {};

const today = () => sql(`select (now() at time zone 'Asia/Jakarta')::date`);
const plusDays = (n: number) => sql(`select ((now() at time zone 'Asia/Jakarta')::date + ${n})`);

function shipmentFor(tenant: string) {
  const outlet = randomUUID();
  const shipment = randomUUID();
  sql(`insert into public.outlets (tenant_id, id, name) values ('${tenant}', '${outlet}', 'Outlet Diskon');
    insert into public.shipments (tenant_id, outlet_id, id, reference, submission_state, recipient_name, recipient_phone,
      recipient_address, recipient_area_id, item_description, weight_grams, goods_value_idr, is_simulated, created_by)
      values ('${tenant}', '${outlet}', '${shipment}', 'GXD-${randomUUID().slice(0, 8)}', 'estimated', 'Penerima Uji', '081234567890',
      'Jl. Uji 1', '5fc63169f8f44b34aa4c2ee1', 'Dokumen', 1000, 50000, false, '${OWNER_A}')`);
  shipments[tenant] = shipment;
}

// A quote the provider answered: `net` null means the net cost is unknown.
function addQuote(tenant: string, o: { tariff: number; net: number | null; simulated?: boolean; minutesAgo?: number; courier?: string }) {
  const id = randomUUID();
  sql(`insert into public.shipment_quotes (tenant_id, shipment_id, id, shipment_revision, courier, service, normal_tariff_idr,
      eta_days, is_simulated, quoted_at, expires_at)
      values ('${tenant}', '${shipments[tenant]}', '${id}', 1, '${o.courier ?? "JT"}', 'Reguler', ${o.tariff}, '1-2',
      ${o.simulated ? "true" : "false"}, now() - interval '${o.minutesAgo ?? 0} minutes', now() + interval '1 hour');
    insert into private.quote_costs (tenant_id, quote_id, net_shipping_idr) values ('${tenant}', '${id}', ${o.net ?? "null"})`);
  quotes.push(id);
  return id;
}

// One estimate: every courier row of a batch shares one quoted_at (a single statement = one now()).
// An explicit `id` lets a test control the UUID order of the rows.
type BatchRow = { courier: string; tariff: number; net: number | null; id?: string };
function addBatch(tenant: string, minutesAgo: number, rows: BatchRow[]) {
  const withId = rows.map((r) => ({ ...r, id: r.id ?? randomUUID() }));
  sql(`insert into public.shipment_quotes (tenant_id, shipment_id, id, shipment_revision, courier, service, normal_tariff_idr,
      eta_days, is_simulated, quoted_at, expires_at) values ${withId
        .map((r) => `('${tenant}', '${shipments[tenant]}', '${r.id}', 1, '${r.courier}', 'Reguler', ${r.tariff}, '1-2', false, now() - interval '${minutesAgo} minutes', now() + interval '1 hour')`)
        .join(",")};
    insert into private.quote_costs (tenant_id, quote_id, net_shipping_idr) values ${withId
      .map((r) => `('${tenant}', '${r.id}', ${r.net ?? "null"})`)
      .join(",")}`);
  for (const r of withId) quotes.push(r.id);
  return withId.map((r) => r.id);
}

// Moves every existing version of a tenant one day into the past (created and effective), so quotes
// that were answered a few minutes ago fall under it. Terms are append-only for every API role; the
// fixture edit runs with user triggers off for one transaction, like the cleanup.
function ageTerms(tenant: string) {
  sql(`begin; set local session_replication_role = replica;
    update public.gerai_discount_terms set created_at = created_at - interval '1 day', effective_from = effective_from - interval '1 day' where tenant_id = '${tenant}';
    commit`);
}

function makeTenant(id: string, name: string) {
  sql(`insert into public.tenants (id, name, lifecycle, is_demo) values ('${id}', '${name}', 'active', false);
    insert into public.memberships (tenant_id, user_id, role) values ('${id}', '${OWNER_A}', 'tenant_admin')`);
  shipmentFor(id);
}

type SetArgs = Partial<{ tenant: string | null; expected: number; bps: number; effective: string; status: string; source: string; verification: string | null; reason: string }>;
const set = (c: TestClient, a: SetArgs) =>
  c.rpc("platform_set_gerai_discount", {
    p_tenant: a.tenant === undefined ? X : a.tenant,
    p_expected_version: a.expected ?? 0,
    p_bps: a.bps ?? 1500,
    p_effective: a.effective ?? today(),
    p_status: a.status ?? "owner_stated",
    p_source: a.source ?? "Pernyataan pemilik 2026-10-28",
    p_verification: a.verification ?? null,
    p_reason: a.reason ?? "Uji penetapan diskon",
  });

const maxVersion = (tenant: string | null) =>
  Number(sql(`select coalesce(max(version), 0) from public.gerai_discount_terms where tenant_id ${tenant ? `= '${tenant}'` : "is null"}`));

let admin: TestClient;
let ownerA: TestClient; // admin of X
let operatorA: TestClient; // operator of X
let ownerB: TestClient; // admin of Y only

beforeAll(async () => {
  // A freshly reset stack answers PGRST002 until PostgREST has rebuilt its schema cache.
  for (let attempt = 0; attempt < 60; attempt++) {
    const { error } = await client().rpc("registration_open");
    if (error?.code !== "PGRST002" && error?.code !== "PGRST001") break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  sql(`insert into public.tenants (id, name, lifecycle, is_demo) values ('${X}', 'Gerai Diskon X', 'active', false), ('${Y}', 'Gerai Diskon Y', 'active', false);
    insert into public.memberships (tenant_id, user_id, role) values
      ('${X}', '${OWNER_A}', 'tenant_admin'), ('${X}', '${OPERATOR_A}', 'operator'), ('${Y}', '${OWNER_B}', 'tenant_admin')`);
  shipmentFor(X);
  shipmentFor(Y);
  makeTenant(Z, "Gerai Diskon Z");
  makeTenant(V, "Gerai Diskon V");
  admin = await signInAal2("admin@geraiexpress.test");
  ownerA = await signIn("owner-a@geraiexpress.test");
  operatorA = await signIn("operator-a@geraiexpress.test");
  ownerB = await signIn("owner-b@geraiexpress.test");
});

afterAll(() => {
  // The table is append-only for everyone; cleanup deletes its rows with user triggers off for one
  // transaction (no DDL, so PostgREST's schema cache is not reloaded under the next test file).
  sql(`begin; set local session_replication_role = replica;
    delete from public.gerai_discount_terms where tenant_id in ('${X}', '${Y}', '${Z}', '${V}') or tenant_id is null;
    commit; delete from public.tenants where id in ('${X}', '${Y}', '${Z}', '${V}')`);
});

describe("derivation and rounding (DATA-9 vectors)", () => {
  it("rounds the discount amount down with integer arithmetic", () => {
    expect(sql("select private.gerai_discount_idr(23000, 2000)")).toBe("4600");
    expect(sql("select private.gerai_discount_idr(12345, 2250)")).toBe("2777");
    expect(sql("select private.gerai_discount_idr(12345, 3000)")).toBe("3703");
    expect(sql("select private.gerai_cost_idr(23000, 2000, 18400)")).toBe("18400");
    expect(sql("select private.gerai_cost_idr(12345, 2250, 8642)")).toBe("9568"); // provider gives 3000 here, the gerai 2250
    // variance amounts and basis points from the third vector
    expect(3703 - 2777).toBe(926);
    expect(3000 - 2250).toBe(750);
  });

  it("an unknown input yields NULL, never 0; an assigned value above a quote's own observed value is capped, never a subsidy", () => {
    expect(sql("select private.gerai_cost_idr(23000, 2000, null) is null")).toBe("t");
    expect(sql("select private.gerai_cost_idr(23000, null, 18400) is null")).toBe("t");
    expect(sql("select private.gerai_cost_idr(null, 2000, 18400) is null")).toBe("t");
    expect(sql("select private.gerai_cost_idr(23000, 2000, 24000) is null")).toBe("t"); // net above tariff is inconsistent, not a discount
    expect(sql("select private.gerai_discount_idr(23000, null) is null")).toBe("t");
    // assigned 3000 on a quote that observed 2000: the effective discount is 2000
    expect(sql("select private.gerai_cost_idr(23000, 3000, 18400)")).toBe("18400");
    // a real zero discount is a value, not unknown
    expect(sql("select private.gerai_discount_idr(23000, 0)")).toBe("0");
    expect(sql("select private.gerai_cost_idr(23000, 0, 23000)")).toBe("23000");
    // the rupiah amount never exceeds the provider's own: 2251 bps on 20000 would give 4502 > 4501
    expect(sql("select private.observed_discount_bps(20000, 15499)")).toBe("2251");
    expect(sql("select private.gerai_cost_idr(20000, 2251, 15499)")).toBe("15499");
  });

  it("derives the observed discount per quote as ceil((tariff - net) * 10000 / tariff), else NULL", () => {
    expect(sql("select private.observed_discount_bps(23000, 18400)")).toBe("2000");
    // 2777 / 12345 = 22.4949...%: a provider percent of exactly 22.5% observed as net 9568 rounds up to 2250
    expect(sql("select private.observed_discount_bps(12345, 9568)")).toBe("2250");
    expect(sql("select private.observed_discount_bps(10000, 7000)")).toBe("3000");
    expect(sql("select private.observed_discount_bps(7000, 6500)")).toBe("715"); // 714.28...
    expect(sql("select private.observed_discount_bps(23000, 23000)")).toBe("0");
    expect(sql("select private.observed_discount_bps(23000, null) is null")).toBe("t");
    expect(sql("select private.observed_discount_bps(null, 100) is null")).toBe("t");
    expect(sql("select private.observed_discount_bps(0, 0) is null")).toBe("t");
    expect(sql("select private.observed_discount_bps(1000, 1200) is null")).toBe("t");
  });
});

describe("percent text and basis points (UX-12)", () => {
  it("parses up to two decimals with integer arithmetic and formats back without drift", () => {
    expect(parsePercentToBps("20")).toBe(2000);
    expect(parsePercentToBps("22,5")).toBe(2250);
    expect(parsePercentToBps("22.50")).toBe(2250);
    expect(parsePercentToBps(" 0,07 ")).toBe(7);
    expect(parsePercentToBps("100")).toBe(10000);
    for (const bad of ["", "abc", "100,01", "101", "1,234", "-1", "1e2", "20%", "0,"]) expect(parsePercentToBps(bad), bad).toBeNull();
    expect(formatPercentBps(2250)).toBe("22,50%");
    expect(formatPercentBps(7)).toBe("0,07%");
    expect(formatPercentBps(null)).toBe("tidak diketahui");
  });
});

describe("platform access boundary", () => {
  it("tenant users, signed-out, aal1 and capability-less platform sessions cannot read or write terms", async () => {
    // The monitoring-only administrator holds an aal2 session (minted; real TOTP is T-065) but no governance capability.
    const monitoring = await signInAal2("admin-new@geraiexpress.test");
    const callers: Record<string, TestClient> = {
      owner: ownerA, operator: operatorA, anon: client(), aal1: await signIn("admin@geraiexpress.test"), monitoringOnly: monitoring,
    };
    for (const [who, c] of Object.entries(callers)) {
      expect((await c.rpc("platform_discount_overview")).error?.code ?? "denied", who).not.toBeNull();
      expect((await c.rpc("platform_discount_overview")).data, who).toBeNull();
      expect((await c.rpc("platform_discount_history", { p_tenant: X })).data, who).toBeNull();
      expect((await c.rpc("platform_discount_observations", { p_tenant: X })).data, who).toBeNull();
      expect((await set(c, {})).error, who).not.toBeNull();
    }
    expect((await callers.aal1.rpc("platform_discount_overview")).error?.message).toBe("platform_access_required");
    expect((await callers.monitoringOnly.rpc("platform_discount_overview")).error?.message).toBe("platform_access_required");
    expect((await set(callers.monitoringOnly, {})).error?.message).toBe("platform_access_required");
    expect(maxVersion(X)).toBe(0);
  });

  it("no API role can touch the table directly", async () => {
    for (const c of [ownerA, admin, client()]) {
      expect((await c.from("gerai_discount_terms").select("id")).error).not.toBeNull();
      expect((await c.from("gerai_discount_terms").insert({ tenant_id: X, version: 1, gerai_discount_bps: 1, effective_from: new Date().toISOString(), source_reference: "x y z", status: "owner_stated", created_by: ADMIN })).error).not.toBeNull();
    }
    expect(maxVersion(X)).toBe(0);
  });
});

describe("no observation: allowed but unverified", () => {
  it("accepts terms with no observed discount (simulated quotes are not observations) and reads them as unverified", async () => {
    addQuote(Y, { tariff: 20000, net: 10000, simulated: true }); // synthetic: ignored
    const { data: version, error } = await set(admin, { tenant: Y, bps: 2500, source: "Pernyataan pemilik 2026-10-28" });
    expect(error).toBeNull();
    expect(version).toBe(1);
    const row = ((await admin.rpc("platform_discount_overview")).data as Record<string, unknown>[]).find((r) => r.tenant_id === Y)!;
    expect(row).toMatchObject({ version: 1, gerai_discount_bps: 2500, status: "owner_stated", unverified: true, observed_bps: null, remainder_bps: null });
    const hist = (await admin.rpc("platform_discount_history", { p_tenant: Y })).data as Record<string, unknown>[];
    expect(hist).toHaveLength(1);
    expect(hist[0]).toMatchObject({ unverified: true, is_current: true });
    expect(sql(`select observed_bps_at_creation is null from public.gerai_discount_terms where tenant_id = '${Y}'`)).toBe("t");
  });

  it("refuses status provider_observed while nothing has been observed", async () => {
    const { error } = await set(admin, { tenant: Y, expected: 1, bps: 100, status: "provider_observed" });
    expect(error?.message).toBe("observation_required");
    expect(maxVersion(Y)).toBe(1);
  });
});

describe("above-observed refusal (PR-23, DEC-016)", () => {
  it("derives the observed discount from the latest real quote and refuses anything above it in the database", async () => {
    addQuote(X, { tariff: 23000, net: 18400, minutesAgo: 5 }); // observed 2000 bps
    const obs = ((await admin.rpc("platform_discount_observations", { p_tenant: X })).data as { courier: string; observed_bps: number }[]);
    expect(obs).toEqual([expect.objectContaining({ courier: "JT", observed_bps: 2000 })]);

    const above = await set(admin, { bps: 2001 });
    expect(above.error?.message).toBe("discount_above_observed");
    expect(above.error?.details).toContain("observed_bps=2000");
    expect(maxVersion(X)).toBe(0);

    // The rule lives in the table, not only in the RPC: a direct superuser insert is refused too.
    expect(() => sql(`insert into public.gerai_discount_terms (tenant_id, version, gerai_discount_bps, effective_from, source_reference, status, created_by)
      values ('${X}', 1, 2001, now(), 'langsung ke tabel', 'owner_stated', '${ADMIN}')`)).toThrow(/discount_above_observed/);
    expect(maxVersion(X)).toBe(0);

    const ok = await set(admin, { bps: 2000, source: "Pernyataan pemilik 2026-10-28" });
    expect(ok.error).toBeNull();
    expect(ok.data).toBe(1);
    expect(sql(`select observed_bps_at_creation from public.gerai_discount_terms where tenant_id = '${X}' and version = 1`)).toBe("2000");
  });

  it("a newer observation moves the ceiling; a lower new observation blocks the next raise", async () => {
    addQuote(X, { tariff: 12345, net: 9000, minutesAgo: 1 }); // observed 2710 bps (latest batch)
    expect(((await admin.rpc("platform_discount_overview")).data as Record<string, unknown>[]).find((r) => r.tenant_id === X)).toMatchObject({ observed_bps: 2710, gerai_discount_bps: 2000, remainder_bps: 710, remainder_is_estimate: true });
    const raise = await set(admin, { expected: 1, bps: 2250, reason: "Naikkan ke 22,5 persen" });
    expect(raise.error).toBeNull();
    expect(raise.data).toBe(2);
    expect((await set(admin, { expected: 2, bps: 2711 })).error?.message).toBe("discount_above_observed");
  });
});

describe("gerai cost for a quote (DATA-9 vectors through the RPC)", () => {
  it("returns tariff minus the rounded-down discount, only to the tenant administrator", async () => {
    // The quotes were answered minutes ago; versions 1 and 2 are moved a day back so they were in force then.
    ageTerms(X);
    const q2 = quotes[quotes.length - 1];
    const q1 = quotes[quotes.length - 2];
    // Version 2 (2250 bps) is current. 12345 -> discount 2777, cost 9568; that quote observed 2710 >= 2250.
    const cost = await ownerA.rpc("gerai_cost_for_quote", { p_tenant: X, p_quote: q2 });
    expect(cost.error).toBeNull();
    expect(cost.data).toBe(9568);
    // Tariff 23000 at 2250 bps would be 5175, but that quote only observed 2000 (< 2250): capped at its own 2000.
    expect((await ownerA.rpc("gerai_cost_for_quote", { p_tenant: X, p_quote: q1 })).data).toBe(18400);
    // Nothing but the amount comes back: a scalar, no net cost, no observed discount.
    expect(typeof cost.data).toBe("number");
  });

  it("does not reprice an old quote when a new version is assigned; a later quote uses the new version", async () => {
    const q2 = quotes[quotes.length - 1];
    expect((await set(admin, { expected: 2, bps: 2000, reason: "Turunkan ke 20 persen" })).error).toBeNull();
    // q2 was answered under version 2 (2250 bps): still 9568, not 12345 - 2469 = 9876.
    expect((await ownerA.rpc("gerai_cost_for_quote", { p_tenant: X, p_quote: q2 })).data).toBe(9568);
    // A quote answered after version 3 (2000 bps) uses it.
    const fresh = addQuote(X, { tariff: 12345, net: 9000 });
    expect((await ownerA.rpc("gerai_cost_for_quote", { p_tenant: X, p_quote: fresh })).data).toBe(9876);
    expect(sql(`select private.gerai_discount_idr(23000, 2000)`)).toBe("4600");
  });

  it("is unknown when the net cost is unknown, never 0", async () => {
    const unknownNet = addQuote(X, { tariff: 15000, net: null, minutesAgo: 30 });
    const res = await ownerA.rpc("gerai_cost_for_quote", { p_tenant: X, p_quote: unknownNet });
    expect(res.error).toBeNull();
    expect(res.data).toBeNull();
  });

  it("refuses operators and other tenants' administrators, and a foreign quote", async () => {
    const q = quotes[quotes.length - 4];
    expect((await operatorA.rpc("gerai_cost_for_quote", { p_tenant: X, p_quote: q })).error?.message).toBe("admin_required");
    expect((await ownerB.rpc("gerai_cost_for_quote", { p_tenant: X, p_quote: q })).error?.message).toBe("admin_required");
    expect((await client().rpc("gerai_cost_for_quote", { p_tenant: X, p_quote: q })).error).not.toBeNull();
    const own = await ownerA.rpc("gerai_cost_for_quote", { p_tenant: X, p_quote: quotes[0] }); // a Y quote
    expect(own.error?.message).toBe("not_found");
  });
});

describe("tenant view (TEN-4)", () => {
  it("a tenant administrator reads only its own current discount, status and effective date", async () => {
    const own = await ownerA.rpc("tenant_gerai_discount", { p_tenant: X });
    expect(own.error).toBeNull();
    const rows = own.data as Record<string, unknown>[];
    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0]).sort()).toEqual(["effective_from", "gerai_discount_bps", "status"]);
    expect(rows[0].gerai_discount_bps).toBe(2000);
    expect(JSON.stringify(rows)).not.toMatch(/observed|remainder|unverified|source/);
  });

  it("an operator and another tenant's administrator read nothing", async () => {
    expect((await operatorA.rpc("tenant_gerai_discount", { p_tenant: X })).error?.message).toBe("admin_required");
    expect((await ownerB.rpc("tenant_gerai_discount", { p_tenant: X })).error?.message).toBe("admin_required");
    expect((await client().rpc("tenant_gerai_discount", { p_tenant: X })).error).not.toBeNull();
    // Tenant Y's own administrator sees Y's terms, not X's.
    const y = (await ownerB.rpc("tenant_gerai_discount", { p_tenant: Y })).data as { gerai_discount_bps: number }[];
    expect(y.map((r) => r.gerai_discount_bps)).toEqual([2500]);
  });

  it("a tenant without assigned terms gets no row (unknown, not zero)", async () => {
    sql(`insert into public.tenants (id, name, lifecycle) values ('${randomUUID()}', 'tmp', 'provisioning')`);
    const rows = (await ownerA.rpc("tenant_gerai_discount", { p_tenant: "00000000-0000-4000-b000-00000000000a" })).data as unknown[];
    expect(rows).toEqual([]);
    sql(`delete from public.tenants where name = 'tmp'`);
  });
});

describe("versions, verification and validation", () => {
  it("is append-only: update, delete and truncate are refused, and versions never rewrite", () => {
    expect(() => sql(`update public.gerai_discount_terms set gerai_discount_bps = 1 where tenant_id = '${X}'`)).toThrow(/terms_are_append_only/);
    expect(() => sql(`delete from public.gerai_discount_terms where tenant_id = '${X}'`)).toThrow(/terms_are_append_only/);
    expect(() => sql(`truncate public.gerai_discount_terms`)).toThrow(/terms_are_append_only/);
    expect(maxVersion(X)).toBe(3);
    expect(sql(`select string_agg(gerai_discount_bps::text, ',' order by version) from public.gerai_discount_terms where tenant_id = '${X}'`)).toBe("2000,2250,2000");
  });

  it("has no column or argument for the platform remainder", () => {
    expect(sql(`select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'gerai_discount_terms' and (column_name ilike '%remainder%' or column_name ilike '%platform%')`)).toBe("0");
    expect(sql(`select count(*) from pg_proc where proname = 'platform_set_gerai_discount' and pg_get_function_arguments(oid) ilike '%remainder%'`)).toBe("0");
  });

  it("provider_verified needs the typed written confirmation reference, and only it", async () => {
    const v = maxVersion(X);
    expect((await set(admin, { expected: v, status: "provider_verified", verification: null })).error?.message).toBe("verification_reference_required");
    expect((await set(admin, { expected: v, status: "provider_verified", verification: "  " })).error?.message).toBe("verification_reference_required");
    expect((await set(admin, { expected: v, status: "owner_stated", verification: "Surel Mengantar 2026-11-02" })).error?.message).toBe("verification_reference_unexpected");
    expect(() => sql(`insert into public.gerai_discount_terms (tenant_id, version, gerai_discount_bps, effective_from, source_reference, status, created_by)
      values ('${X}', 1, 100, now(), 'tanpa konfirmasi', 'provider_verified', '${ADMIN}')`)).toThrow(/gerai_terms_verified_needs_reference/);
    expect(maxVersion(X)).toBe(v);
    const ok = await set(admin, { expected: v, bps: 1500, status: "provider_verified", verification: "Surel Mengantar 2026-11-02 no. 7781", reason: "Konfirmasi tertulis diterima" });
    expect(ok.error).toBeNull();
    const own = (await ownerA.rpc("tenant_gerai_discount", { p_tenant: X })).data as { status: string }[];
    expect(own[0].status).toBe("provider_verified");
  });

  it("rejects stale versions, past or distant dates, bad values and a missing reason or source", async () => {
    const v = maxVersion(X);
    expect((await set(admin, { expected: v - 1, bps: 100 })).error?.message).toBe("stale_state");
    expect((await set(admin, { expected: v, bps: 100, effective: plusDays(-1) })).error?.message).toBe("invalid_effective_date");
    expect((await set(admin, { expected: v, bps: 100, effective: plusDays(400) })).error?.message).toBe("invalid_effective_date");
    expect((await set(admin, { expected: v, bps: 10001 })).error?.message).toBe("invalid_input");
    expect((await set(admin, { expected: v, bps: -1 })).error?.message).toBe("invalid_input");
    expect((await set(admin, { expected: v, status: "approved" })).error?.message).toBe("invalid_input");
    expect((await set(admin, { expected: v, source: "  " })).error?.message).toBe("source_reference_required");
    expect((await set(admin, { expected: v, reason: "" })).error?.message).toBe("reason_required");
    expect((await set(admin, { tenant: randomUUID(), bps: 100 })).error?.message).toBe("not_found");
    expect(maxVersion(X)).toBe(v);
    // 0 bps is a legitimate value.
    expect((await set(admin, { expected: v, bps: 0, reason: "Tanpa diskon sementara" })).error).toBeNull();
    expect((await ownerA.rpc("tenant_gerai_discount", { p_tenant: X })).data).toEqual([expect.objectContaining({ gerai_discount_bps: 0 })]);
  });

  it("a future-dated version stays pending and the effective date never moves backwards", async () => {
    const v = maxVersion(X);
    expect((await set(admin, { expected: v, bps: 1000, effective: plusDays(10), reason: "Berlaku sepuluh hari lagi" })).error).toBeNull();
    const row = ((await admin.rpc("platform_discount_overview")).data as Record<string, unknown>[]).find((r) => r.tenant_id === X)!;
    expect(row).toMatchObject({ version: v, gerai_discount_bps: 0, has_pending: true });
    // The tenant still sees the version in force, not the pending one.
    expect((await ownerA.rpc("tenant_gerai_discount", { p_tenant: X })).data).toEqual([expect.objectContaining({ gerai_discount_bps: 0 })]);
    expect((await set(admin, { expected: v + 1, bps: 500, effective: today() })).error?.message).toBe("effective_before_previous");
    const hist = (await admin.rpc("platform_discount_history", { p_tenant: X })).data as { version: number; is_current: boolean }[];
    expect(hist.map((h) => h.version)).toEqual(Array.from({ length: v + 1 }, (_, i) => v + 1 - i));
    expect(hist.filter((h) => h.is_current).map((h) => h.version)).toEqual([v]);
  });
});

describe("platform default template", () => {
  it("is a prefill row only: owner-stated, never applied to a tenant or a quote", async () => {
    const before = maxVersion(null);
    expect((await set(admin, { tenant: null, expected: before, bps: 1800, status: "provider_verified", verification: "x y z" })).error).not.toBeNull();
    const ok = await set(admin, { tenant: null, expected: before, bps: 1800, source: "Templat default, pernyataan pemilik" });
    expect(ok.error).toBeNull();
    expect(ok.data).toBe(before + 1);
    const hist = (await admin.rpc("platform_discount_history", { p_tenant: null })).data as Record<string, unknown>[];
    expect(hist[0]).toMatchObject({ gerai_discount_bps: 1800, status: "owner_stated", unverified: null, is_current: true });
    // A tenant with no terms of its own gets nothing from the template.
    const fresh = randomUUID();
    sql(`insert into public.tenants (id, name, lifecycle) values ('${fresh}', 'Gerai Tanpa Terms', 'active')`);
    try {
      const row = ((await admin.rpc("platform_discount_overview")).data as Record<string, unknown>[]).find((r) => r.tenant_id === fresh)!;
      expect(row).toMatchObject({ version: null, gerai_discount_bps: null, status: null });
    } finally {
      sql(`delete from public.tenants where id = '${fresh}'`);
    }
  });
});

describe("audit and overview read model", () => {
  it("every assignment writes one audit row with actor, tenant, reason, old and new values", () => {
    const rows = JSON.parse(sql(`select coalesce(json_agg(r order by id), '[]') from (
      select id, actor, target_tenant, reason, outcome, detail from public.audit_events
      where action = 'discount.terms' and target_tenant = '${X}') r`)) as { actor: string; reason: string; outcome: string; detail: Record<string, unknown> }[];
    expect(rows.length).toBe(maxVersion(X));
    expect(rows[0]).toMatchObject({ actor: ADMIN, outcome: "owner_stated", detail: { old_version: null, new_version: 1, old_bps: null, new_bps: 2000, new_status: "owner_stated", observed_bps: 2000 } });
    expect(rows[1].detail).toMatchObject({ old_version: 1, new_version: 2, old_bps: 2000, new_bps: 2250 });
    expect(rows[1].reason).toBe("Naikkan ke 22,5 persen");
    // Refused attempts leave no audit row beyond the accepted versions.
    expect(sql(`select count(*) from public.audit_events where action = 'discount.terms' and target_tenant = '${X}' and reason = 'Uji penetapan diskon' and outcome <> 'owner_stated'`)).toBe("0");
    expect(Number(sql(`select count(*) from public.audit_events where action = 'discount.template'`))).toBeGreaterThan(0);
  });

  it("shows the remainder as observed minus assigned in the read model, NULL when unknown", async () => {
    const rows = (await admin.rpc("platform_discount_overview")).data as Record<string, number | string | null>[];
    const x = rows.find((r) => r.tenant_id === X)!;
    expect(x.observed_bps).toBe(2710);
    expect(x.remainder_bps).toBe(2710 - Number(x.gerai_discount_bps));
    const y = rows.find((r) => r.tenant_id === Y)!;
    expect(y.remainder_bps).toBeNull();
    expect(rows.some((r) => r.tenant_name === "Gerai Contoh")).toBe(false);
  });
});

describe("latest estimate batch and assignment ceiling (B-H1)", () => {
  // Two UUID pairs (primary key is tenant + id): batch 1 has SAP highest, batch 2 has SAP lowest.
  const [lo, hi] = [randomUUID(), randomUUID()].sort();
  const [lo2, hi2] = [randomUUID(), randomUUID()].sort();
  let batch1: string[];
  let batch2: string[];

  it("lists the observed value per courier of the batch and refuses above its maximum; provider_observed must equal the maximum", async () => {
    // One estimate, one quoted_at, two couriers that genuinely differ: JT 30.00%, SAP 7.15% (7.1428...).
    // SAP has the highest UUID: a "last row by quote id" rule would have taken the 715 value.
    batch1 = addBatch(Z, 10, [{ courier: "JT", tariff: 10000, net: 7000, id: lo }, { courier: "SAP", tariff: 7000, net: 6500, id: hi }]);
    const obs = (await admin.rpc("platform_discount_observations", { p_tenant: Z })).data as { courier: string; observed_bps: number }[];
    expect(obs.map((o) => [o.courier, o.observed_bps])).toEqual([["JT", 3000], ["SAP", 715]]);

    const above = await set(admin, { tenant: Z, bps: 3001 });
    expect(above.error?.message).toBe("discount_above_observed");
    expect(above.error?.details).toContain("observed_bps=3000");

    // provider_observed needs an exact match with the maximum (tolerance 0 bps), not just an observation.
    const mismatch = await set(admin, { tenant: Z, bps: 2999, status: "provider_observed" });
    expect(mismatch.error?.message).toBe("provider_observed_mismatch");
    expect(mismatch.error?.details).toContain("observed_bps=3000");
    expect(maxVersion(Z)).toBe(0);
    const ok = await set(admin, { tenant: Z, bps: 3000, status: "provider_observed", source: "Estimasi Mengantar" });
    expect(ok.error).toBeNull();
    expect(ok.data).toBe(1);
    expect(sql(`select observed_bps_at_creation from public.gerai_discount_terms where tenant_id = '${Z}' and version = 1`)).toBe("3000");

    const row = ((await admin.rpc("platform_discount_overview")).data as Record<string, unknown>[]).find((r) => r.tenant_id === Z)!;
    expect(row).toMatchObject({
      observed_bps: 3000, gerai_discount_bps: 3000, remainder_bps: 0, remainder_is_estimate: true,
      observed_by_courier: [{ courier: "JT", observed_bps: 3000 }, { courier: "SAP", observed_bps: 715 }],
    });
  });

  it("is stable when the same batch is inserted with the UUID order reversed", async () => {
    ageTerms(Z); // version 1 was in force when the following quotes were answered
    batch2 = addBatch(Z, 5, [{ courier: "JT", tariff: 10000, net: 7000, id: hi2 }, { courier: "SAP", tariff: 7000, net: 6500, id: lo2 }]);
    const obs = (await admin.rpc("platform_discount_observations", { p_tenant: Z })).data as { courier: string; observed_bps: number }[];
    expect(obs.map((o) => [o.courier, o.observed_bps])).toEqual([["JT", 3000], ["SAP", 715]]);
    expect((await set(admin, { tenant: Z, expected: 1, bps: 3001 })).error?.message).toBe("discount_above_observed");
    const row = ((await admin.rpc("platform_discount_overview")).data as Record<string, unknown>[]).find((r) => r.tenant_id === Z)!;
    expect(row.observed_bps).toBe(3000);
  });

  it("caps each quote at its own observed value: SAP at 7.15% gets no subsidy, JT gets the assigned 30%", async () => {
    const jt = await ownerA.rpc("gerai_cost_for_quote", { p_tenant: Z, p_quote: batch2[0] });
    const sap = await ownerA.rpc("gerai_cost_for_quote", { p_tenant: Z, p_quote: batch2[1] });
    expect(jt.data).toBe(7000); // 10000 - 3000
    expect(sap.data).toBe(6500); // 7000 - floor(7000 * 715 / 10000) = 7000 - 500: never below the provider's own net
  });

  it("only the newest batch counts: an older courier does not leak, and a batch with no known net is skipped", async () => {
    addBatch(Z, 1, [{ courier: "JT", tariff: 10000, net: 8000 }]); // 20.00%
    const obs = (await admin.rpc("platform_discount_observations", { p_tenant: Z })).data as { courier: string; observed_bps: number }[];
    expect(obs.map((o) => [o.courier, o.observed_bps])).toEqual([["JT", 2000]]);
    const row = ((await admin.rpc("platform_discount_overview")).data as Record<string, unknown>[]).find((r) => r.tenant_id === Z)!;
    expect(row).toMatchObject({ observed_bps: 2000, gerai_discount_bps: 3000, remainder_bps: -1000, observed_by_courier: [{ courier: "JT", observed_bps: 2000 }] });
    expect((await set(admin, { tenant: Z, expected: 1, bps: 2001 })).error?.message).toBe("discount_above_observed");
    // The newest quote write answered without a net cost: unknown, so the previous observation stands (never 0).
    addBatch(Z, 0, [{ courier: "JT", tariff: 10000, net: null }]);
    expect((await set(admin, { tenant: Z, expected: 1, bps: 2001 })).error?.message).toBe("discount_above_observed");
    const after = ((await admin.rpc("platform_discount_overview")).data as Record<string, unknown>[]).find((r) => r.tenant_id === Z)!;
    expect(after.observed_bps).toBe(2000);
  });

  it("a new version does not reprice quotes answered before it", async () => {
    expect((await set(admin, { tenant: Z, expected: 1, bps: 2000, reason: "Turunkan ke 20 persen" })).error).toBeNull();
    // Version 1 (3000) still prices the earlier quotes.
    expect((await ownerA.rpc("gerai_cost_for_quote", { p_tenant: Z, p_quote: batch2[0] })).data).toBe(7000);
    expect((await ownerA.rpc("gerai_cost_for_quote", { p_tenant: Z, p_quote: batch1[0] })).data).toBe(7000);
    // A quote answered after version 2 (2000) uses it: 10000 - 2000, not 7000.
    const [later] = addBatch(Z, 0, [{ courier: "JT", tariff: 10000, net: 7000 }]);
    expect((await ownerA.rpc("gerai_cost_for_quote", { p_tenant: Z, p_quote: later })).data).toBe(8000);
  });

  it("a quote answered before any version existed has no assigned terms: unknown, not the full tariff", async () => {
    const [early] = addBatch(V, 20, [{ courier: "JT", tariff: 12345, net: 9568 }]);
    expect((await ownerA.rpc("gerai_cost_for_quote", { p_tenant: V, p_quote: early })).data).toBeNull();
  });

  it("a provider percent of exactly 22.5% is assignable: the observed side rounds up, so 9568 reads as 2250 (floor would be 2249)", async () => {
    // Net 9568 on tariff 12345 is a 2777 rupiah discount: 22.4949...%, what a provider 22.5% looks like after rounding the net.
    const obs = (await admin.rpc("platform_discount_observations", { p_tenant: V })).data as { observed_bps: number }[];
    expect(obs.map((o) => o.observed_bps)).toEqual([2250]);
    expect((await set(admin, { tenant: V, bps: 2251 })).error?.message).toBe("discount_above_observed");
    const ok = await set(admin, { tenant: V, bps: 2250, status: "provider_observed", source: "Estimasi Mengantar 22,5 persen" });
    expect(ok.error).toBeNull();
    ageTerms(V);
    const [quote] = addBatch(V, 0, [{ courier: "JT", tariff: 12345, net: 9568 }]);
    // 12345 - floor(12345 * 2250 / 10000) = 12345 - 2777: exactly the provider's net, no subsidy.
    expect((await ownerA.rpc("gerai_cost_for_quote", { p_tenant: V, p_quote: quote })).data).toBe(9568);
  });
});

describe("platform audit default view (label snapshot rows)", () => {
  it("the unfiltered list omits label.snapshot rows; filtering by that action still returns them", async () => {
    sql(`insert into public.audit_events (action, target_tenant, outcome, reason, detail)
      values ('label.snapshot', '${Z}', 'masked', 'uji tampilan audit', '{}'::jsonb)`);
    const all = (await admin.rpc("platform_audit", { p_action: null, p_limit: 500 })).data as { action: string; reason: string | null }[];
    expect(all.some((r) => r.action === "label.snapshot")).toBe(false);
    expect(all.some((r) => r.action === "discount.terms")).toBe(true);
    const only = (await admin.rpc("platform_audit", { p_action: "label.snapshot", p_limit: 500 })).data as { action: string; reason: string | null }[];
    expect(only.some((r) => r.reason === "uji tampilan audit")).toBe(true);
  });
});
