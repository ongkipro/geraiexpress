// T-049 / PR-37 / DATA-8 / TEN-6 (CTX-41 items 2, 11, 12): every tenant has an immutable, unique,
// valid slug and a shipment prefix; the reference is <PREFIX>-<yymmdd>-<seq> from a per-tenant
// per-day counter taken under a row lock; slug and prefix never authorize anything.
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { DB_CONTAINER, DB_NAME, IDS, demoVisitor, signIn, signInAal2, sql, verifiedNewUser } from "./helpers";

// The blocked marketing keyword is built from fragments so the literal never appears in the repository.
const KEYWORD = ["c", "u", "a", "n"].join("");
const created: string[] = [];
const OWNER_A = "00000000-0000-4000-a000-0000000000a1";

function insertTenant(name: string, extra = ""): string {
  const id = randomUUID();
  created.push(id);
  sql(`insert into public.tenants (id, name, lifecycle${extra ? ", slug" : ""}) values ('${id}', '${name.replace(/'/g, "''")}', 'active'${extra ? `, '${extra}'` : ""})`);
  return id;
}

function slugOf(id: string): string {
  return sql(`select slug from public.tenants where id = '${id}'`);
}

function wibDay(): string {
  return sql(`select to_char(now() at time zone 'Asia/Jakarta', 'YYMMDD')`);
}

// Runs a body inside a DO block that always raises, so nothing is committed, and returns the text
// the body passed to `raise exception 'probe:%'` (one line).
function rolledBack(body: string, declarations = ""): string {
  try {
    sql(`do $probe$ declare ${declarations} begin ${body} end $probe$`);
  } catch (e) {
    const message = String((e as Error).message);
    const payload = /ERROR:\s+probe:(.*)/.exec(message)?.[1];
    if (payload === undefined) throw new Error(`probe failed: ${message.split("\n").filter((l) => /^(ERROR|CONTEXT|DETAIL|HINT):/.test(l)).join(" | ")}`);
    return payload;
  }
  throw new Error("probe did not raise");
}

// The one-time statements of the migrations, taken from the files so the tests run the shipped text.
const MIGRATION_DIR = "db/migrations";
const REDERIVE_BLOCK = /do \$backfill\$[\s\S]*?end \$backfill\$;/.exec(readFileSync(`${MIGRATION_DIR}/20261028210000_catalog_slug_lock_fixes.sql`, "utf8"))![0];
const SLUG_BACKFILL_BLOCK = /do \$\$[\s\S]*?end \$\$;/.exec(readFileSync(`${MIGRATION_DIR}/20261028120000_tenant_slug_reference.sql`, "utf8").split("-- Backfill: every existing tenant")[1])![0];
const RUN_REDERIVE = `execute $run$${REDERIVE_BLOCK}$run$;`;

const prefixOf = (id: string): string => sql(`select shipment_prefix from public.tenants where id = '${id}'`);

afterAll(() => {
  if (created.length > 0) sql(`delete from public.tenants where id in (${created.map((i) => `'${i}'`).join(",")})`);
});

describe("tenant slug rules (DATA-8)", () => {
  it("fixture tenants got a valid slug and a distinct prefix without touching their shipment references", () => {
    expect(sql(`select slug || '/' || shipment_prefix from public.tenants where id = '${IDS.tenantA}'`)).toBe("gerai-uji-a/GERA");
    // Gerai Uji B and C share the first letters of A: they take the next free candidates.
    expect(sql(`select slug || '/' || shipment_prefix from public.tenants where id = '${IDS.tenantB}'`)).toBe("gerai-uji-b/GERAI");
    expect(sql(`select slug || '/' || shipment_prefix from public.tenants where id = '00000000-0000-4000-b000-00000000000c'`)).toBe("gerai-uji-c/ERAI");
    expect(sql(`select count(*) from public.tenants where slug is null or shipment_prefix is null`)).toBe("0");
    expect(sql(`select reference from public.shipments where id = '${IDS.shipmentA}'`)).toBe("GXTEST-A1");
    expect(sql(`select reference from public.shipments where id = '${IDS.shipmentB}'`)).toBe("GXTEST-B1");
  });

  it("a malformed, reserved or keyword slug is refused by the database", () => {
    const refused = [
      "Upper-Case", "ab", "-abc", "abc-", "a".repeat(33), "has space", "snake_case",
      "www", "app", "owner", "hooks", "api", "admin", "mail", "status", "static", "assets", "staging", "preview", "demo", "support",
      `toko-${KEYWORD}-maju`, `${KEYWORD}mart`,
    ];
    for (const slug of refused) {
      expect(() => insertTenant("Gerai Ditolak", slug), slug).toThrow(/slug_invalid|check/i);
    }
    // Boundary lengths and a normal slug pass.
    expect(slugOf(insertTenant("Gerai Tiga", "abc"))).toBe("abc");
    expect(slugOf(insertTenant("Gerai Penuh", "a" + "b".repeat(30) + "c"))).toHaveLength(32);
  });

  it("a second tenant cannot take an existing slug", () => {
    const id = insertTenant("Gerai Kembar Satu", "kembar-satu");
    expect(slugOf(id)).toBe("kembar-satu");
    expect(() => insertTenant("Gerai Kembar Dua", "kembar-satu")).toThrow(/tenants_slug_key|duplicate key/);
  });

  it("an existing slug or prefix cannot change; the display name still can", () => {
    const id = insertTenant("Gerai Tetap");
    const slug = slugOf(id);
    expect(() => sql(`update public.tenants set slug = 'gerai-lain' where id = '${id}'`)).toThrow(/slug_immutable/);
    expect(() => sql(`update public.tenants set slug = null where id = '${id}'`)).toThrow(/slug_immutable/);
    expect(() => sql(`update public.tenants set shipment_prefix = 'ZZZ' where id = '${id}'`)).toThrow(/prefix_immutable/);
    expect(() => sql(`update public.tenants set slug = slug, shipment_prefix = shipment_prefix where id = '${id}'`)).not.toThrow();
    sql(`update public.tenants set name = 'Gerai Tetap Berganti Nama' where id = '${id}'`);
    expect(slugOf(id)).toBe(slug);
  });

  it("a prefix is 3 to 5 upper-case letters", () => {
    for (const bad of ["ab", "ABCDEF", "AB1", "abc"]) {
      expect(() => sql(`insert into public.tenants (name, shipment_prefix) values ('Gerai Awalan', '${bad}')`), bad).toThrow(/tenants_shipment_prefix_format/);
    }
    const ids = ["Toko Maju", "Ab", "999", "Gerai Sangat Panjang Sekali"].map((n) => insertTenant(n));
    for (const id of ids) {
      expect(sql(`select shipment_prefix ~ '^[A-Z]{3,5}$' from public.tenants where id = '${id}'`)).toBe("t");
    }
  });
});

describe("shipment prefix rules (T-049, review M1)", () => {
  it("real tenants never share a prefix, even with the same name", () => {
    const ids = Array.from({ length: 6 }, () => insertTenant("Prefiks Sama"));
    const prefixes = ids.map(prefixOf);
    expect(new Set(prefixes).size).toBe(ids.length);
    expect(prefixes.slice(0, 2)).toEqual(["PREF", "PREFI"]);
    for (const prefix of prefixes) expect(prefix).toMatch(/^[A-Z]{3,5}$/);
    expect(() => sql(`insert into public.tenants (name, slug, shipment_prefix) values ('Gerai Dobel', 'gerai-dobel', '${prefixes[0]}')`)).toThrow(/tenants_shipment_prefix_real_key|duplicate key/);
  });

  it("a name that splits the blocked keyword across words never yields a prefix containing it", () => {
    const split = insertTenant(["Cu", "An", "Jaya"].join(" "));
    expect(slugOf(split)).toBe("cu-an-jaya");
    expect(prefixOf(split)).toBe("UANJ");
    const trailing = insertTenant(["Toko", "Cu", "An"].join(" "));
    expect(prefixOf(trailing)).not.toContain(KEYWORD.toUpperCase());
    for (const prefix of [KEYWORD.toUpperCase(), `X${KEYWORD.toUpperCase()}`, `${KEYWORD.toUpperCase()}X`]) {
      expect(() => sql(`insert into public.tenants (name, slug, shipment_prefix) values ('Gerai Kunci', 'gerai-kunci', '${prefix}')`), prefix).toThrow(/tenants_shipment_prefix_safe/);
    }
  });

  it("a real tenant never gets the demo prefix; demo tenants keep it and may share it", () => {
    const demoLike = insertTenant("Demo Toko");
    expect(slugOf(demoLike)).toBe("demo-toko");
    expect(prefixOf(demoLike)).toBe("DEMOT");
    expect(() => sql(`insert into public.tenants (name, slug, shipment_prefix) values ('Gerai Palsu', 'gerai-palsu', 'DEMO')`)).toThrow(/tenants_shipment_prefix_safe/);
    const demos = [randomUUID(), randomUUID()];
    created.push(...demos);
    for (const id of demos) sql(`insert into public.tenants (id, name, lifecycle, is_demo) values ('${id}', 'Gerai Demo Dua', 'active', true)`);
    expect(demos.map(prefixOf)).toEqual(["DEMO", "DEMO"]);
  });

  it("derives a prefix from letters only and reports a clear error when the space is exhausted", () => {
    expect(prefixOf(insertTenant("Toko 12 Maju"))).toMatch(/^TOKO/);
    // Letters "aaa": the candidates are AAA, AAAA..AAAZ and AAAAA..AAAZZ (703). Occupy them all.
    const ids = sql(`with g as (select generate_series(0, 702) as i),
        cand as (select i, case when i = 0 then 'AAA' when i <= 26 then 'AAA' || chr(64 + i)
          else 'AAA' || chr(65 + (i - 27) / 26) || chr(65 + (i - 27) % 26) end as prefix from g)
      insert into public.tenants (name, lifecycle, slug, shipment_prefix)
        select 'Gerai Aaa ' || i, 'active', 'aaa-' || i, prefix from cand returning id`).split("\n").filter((line) => /^[0-9a-f-]{36}$/.test(line));
    created.push(...ids);
    expect(ids).toHaveLength(703);
    expect(() => insertTenant("Aaa", "aaa-1000")).toThrow(/prefix_unavailable/);
  });

  it("the shared slug lock never makes a demo tenant wait; a real tenant does queue behind it", async () => {
    const holder = spawn("docker", ["exec", DB_CONTAINER, "psql", "-U", "postgres", "-d", DB_NAME, "-tA", "-c",
      "select pg_advisory_lock(hashtext('gx.tenant_slug')); select pg_sleep(8)"], { stdio: "ignore" });
    const closed = new Promise((resolve) => holder.on("close", resolve));
    try {
      // Wait until the holder really owns the lock (docker exec and the connection take a moment).
      for (let i = 0; i < 40 && sql("select count(*) from pg_locks where locktype = 'advisory' and granted and objid = (hashtext('gx.tenant_slug')::bigint & 4294967295)::oid") === "0"; i++) {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      expect(sql("select count(*) from pg_locks where locktype = 'advisory' and granted and objid = (hashtext('gx.tenant_slug')::bigint & 4294967295)::oid")).not.toBe("0");
      const demo = randomUUID();
      created.push(demo);
      const started = Date.now();
      sql(`insert into public.tenants (id, name, lifecycle, is_demo) values ('${demo}', 'Gerai Demo Cepat', 'active', true)`);
      expect(Date.now() - started).toBeLessThan(3000);
      expect(slugOf(demo)).toMatch(/^demo-[0-9a-f]{8}$/);
      expect(() => sql(`set lock_timeout = '1s'; insert into public.tenants (name, lifecycle) values ('Gerai Antre', 'active')`)).toThrow(/lock timeout/i);
    } finally {
      await closed;
    }
  }, 30000);

  it("the original slug backfill (migration 20261028120000) still fills a tenant that has no slug, with a unique prefix", () => {
    const id = randomUUID();
    const result = rolledBack(`
      alter table public.tenants alter column slug drop not null, alter column shipment_prefix drop not null;
      alter table public.tenants disable trigger tenants_identity;
      insert into public.tenants (id, name, lifecycle, slug, shipment_prefix) values ('${id}', 'Zaqwsx Lama', 'active', null, null);
      alter table public.tenants enable trigger tenants_identity;
      execute $run$${SLUG_BACKFILL_BLOCK}$run$;
      raise exception 'probe:%', (select slug || '/' || shipment_prefix from public.tenants where id = '${id}');`);
    expect(result).toBe("zaqwsx-lama/ZAQW");
  });

  it("the migration's one-time re-derivation makes shared, demo-like and keyword prefixes unique and safe", () => {
    const [a, b, c, d] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    const kw = KEYWORD.toUpperCase();
    const result = rolledBack(`
      drop index public.tenants_shipment_prefix_real_key;
      alter table public.tenants drop constraint tenants_shipment_prefix_safe;
      alter table public.tenants disable trigger tenants_identity;
      insert into public.tenants (id, name, lifecycle, slug, shipment_prefix, created_at) values
        ('${a}', 'Bf Satu', 'active', 'bf-satu', 'ZZZQ', now() - interval '3 days'),
        ('${b}', 'Bf Dua', 'active', 'bf-dua', 'ZZZQ', now() - interval '2 days'),
        ('${c}', 'Bf Tiga', 'active', 'bf-tiga', 'DEMO', now() - interval '1 day'),
        ('${d}', 'Bf Empat', 'active', 'bf-empat', 'X${kw}', now());
      ${RUN_REDERIVE}
      raise exception 'probe:%', (select string_agg(slug || '=' || shipment_prefix, ',' order by slug) from public.tenants
          where slug like 'bf-%' or id in ('${IDS.tenantA}', '${IDS.tenantB}'))
        || '|dupes=' || (select count(*) from (select 1 from public.tenants where not is_demo group by shipment_prefix having count(*) > 1) x)
        || '|unsafe=' || (select count(*) from public.tenants where position(lower('${kw}') in lower(shipment_prefix)) > 0
          or (not is_demo and shipment_prefix = 'DEMO'))
        || '|trigger=' || (select tgenabled::text from pg_trigger where tgname = 'tenants_identity');`);
    expect(result).toBe("bf-dua=BFDU,bf-empat=BFEM,bf-satu=ZZZQ,bf-tiga=BFTI,gerai-uji-a=GERA,gerai-uji-b=GERAI|dupes=0|unsafe=0|trigger=O");
  });

  it("the re-derivation refuses instead of silently changing a prefix that already has references in the new shape", () => {
    const [a, b] = [randomUUID(), randomUUID()];
    const outlet = randomUUID();
    const attempt = (reference: string) => rolledBack(`
      drop index public.tenants_shipment_prefix_real_key;
      alter table public.tenants disable trigger tenants_identity;
      insert into public.tenants (id, name, lifecycle, slug, shipment_prefix, created_at) values
        ('${a}', 'Bf Satu', 'active', 'bf-satu', 'ZZZQ', now() - interval '3 days'),
        ('${b}', 'Bf Dua', 'active', 'bf-dua', 'ZZZQ', now() - interval '2 days');
      insert into public.outlets (tenant_id, id, name, pickup_address, pickup_area) values ('${b}', '${outlet}', 'Outlet Bf', 'Jl. Bf 1', 'Kec. Bf');
      insert into public.shipments (tenant_id, outlet_id, reference, created_by) values ('${b}', '${outlet}', '${reference}', '${OWNER_A}');
      begin
        ${RUN_REDERIVE}
        v := 'no_error:' || (select shipment_prefix from public.tenants where id = '${b}');
      exception when others then
        v := sqlerrm;
      end;
      raise exception 'probe:%', v;`, "v text;");
    expect(attempt("ZZZQ-261028-001")).toMatch(/^prefix_rederivation_blocked: tenant .* has issued references with prefix ZZZQ$/);
    // Old-shape references never carry a prefix and do not block; the new prefix is derived.
    expect(attempt("GX261028-ABCDEF")).toBe("no_error:BFDU");
    expect(attempt("ZZZQ-A1")).toBe("no_error:BFDU");
  });
});

describe("slug generation from the business name", () => {
  it("folds accents, lower-cases, hyphenates and suffixes collisions", () => {
    const first = insertTenant("Toko Éléganté  Jaya!!");
    expect(slugOf(first)).toBe("toko-elegante-jaya");
    expect(slugOf(insertTenant("Toko Elegante Jaya"))).toBe("toko-elegante-jaya-2");
    expect(slugOf(insertTenant("toko-elegante-jaya"))).toBe("toko-elegante-jaya-3");
  });

  it("suffixes reserved and too-short names, and keeps long names within 32 characters", () => {
    expect(slugOf(insertTenant("Admin"))).toBe("admin-2");
    expect(slugOf(insertTenant("App"))).toBe("app-2");
    expect(slugOf(insertTenant("Ab"))).toMatch(/^ab-\d+$/);
    const long = slugOf(insertTenant("Gerai Pengiriman Paket Serba Ada Nusantara Sentosa Makmur"));
    expect(long.length).toBeLessThanOrEqual(32);
    expect(long).toMatch(/^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/);
    const same = slugOf(insertTenant("Gerai Pengiriman Paket Serba Ada Nusantara Sentosa Makmur"));
    expect(same).not.toBe(long);
    expect(same.length).toBeLessThanOrEqual(32);
  });

  it("never lets the blocked keyword or an empty name stall or leak into a slug", () => {
    const withKeyword = slugOf(insertTenant(`Toko ${KEYWORD} Mart`));
    expect(withKeyword).toBe("toko-mart");
    expect(withKeyword).not.toContain(KEYWORD);
    expect(slugOf(insertTenant(`${KEYWORD}${KEYWORD}`))).toMatch(/^gerai(-\d+)?$/);
    expect(slugOf(insertTenant("!!!"))).toMatch(/^gerai(-\d+)?$/);
  });

  it("an approved application becomes a tenant with a slug derived from the business name", async () => {
    const applicant = await verifiedNewUser();
    const name = `Warung Éndah ${randomUUID().replace(/[^a-f]/g, "").slice(0, 6) || "xyz"}`;
    const saved = await applicant.c.rpc("save_application", {
      p_expected_revision: 0, p_business_name: name, p_outlet_name: "Outlet Slug", p_pickup_address: "Jl. Slug No. 1",
      p_pickup_area: "Kec. Uji, Kota Slug", p_contact_phone: "081277778888",
    });
    const { id } = saved.data![0] as { id: string };
    expect((await applicant.c.rpc("submit_application", { p_id: id, p_expected_revision: 1 })).error).toBeNull();
    const admin = await signInAal2("admin@geraiexpress.test");
    const ok = await admin.rpc("platform_review_application", { p_id: id, p_expected_revision: 2, p_decision: "approve", p_reason: "Data lengkap" });
    expect(ok.error).toBeNull();
    created.push(ok.data as string);
    expect(slugOf(ok.data as string)).toMatch(/^warung-endah-[a-f]+(-\d+)?$/);
    expect(sql(`select shipment_prefix from public.tenants where id = '${ok.data}'`)).toBe("WARU");
  });

  it("a demo tenant gets demo-<8 hex> and a DEMO prefix", async () => {
    const demo = await demoVisitor();
    expect(slugOf(demo.tenant)).toMatch(/^demo-[0-9a-f]{8}$/);
    expect(sql(`select shipment_prefix from public.tenants where id = '${demo.tenant}'`)).toBe("DEMO");
  });
});

describe("shipment reference <PREFIX>-<yymmdd>-<seq> (DATA-8, DIL-16)", () => {
  it("demo seed examples and new drafts count up from one counter, zero-padded", async () => {
    const demo = await demoVisitor();
    const day = wibDay();
    const seeded = sql(`select string_agg(reference, ',' order by reference) from public.shipments where tenant_id = '${demo.tenant}'`);
    expect(seeded).toBe(`DEMO-${day}-001,DEMO-${day}-002,DEMO-${day}-003`);
    const { data: id, error } = await demo.c.rpc("create_shipment_draft", { p_outlet: demo.outlet });
    expect(error).toBeNull();
    expect(sql(`select reference from public.shipments where id = '${id}'`)).toBe(`DEMO-${day}-004`);
  });

  it("each tenant has its own counter", async () => {
    const [a, b] = [await demoVisitor(), await demoVisitor()];
    const day = wibDay();
    const ra = await a.c.rpc("create_shipment_draft", { p_outlet: a.outlet });
    const rb = await b.c.rpc("create_shipment_draft", { p_outlet: b.outlet });
    for (const [r, t] of [[ra, a], [rb, b]] as const) {
      expect(sql(`select reference from public.shipments where id = '${r.data}'`), t.tenant).toBe(`DEMO-${day}-004`);
    }
  });

  it("many parallel drafts for one tenant on one day get distinct sequences and no error", async () => {
    const demo = await demoVisitor();
    const before = wibDay();
    const results = await Promise.all(Array.from({ length: 60 }, () => demo.c.rpc("create_shipment_draft", { p_outlet: demo.outlet })));
    const after = wibDay();
    expect(results.filter((r) => r.error).map((r) => r.error?.message)).toEqual([]);
    const refs = sql(`select string_agg(reference, ',') from public.shipments where tenant_id = '${demo.tenant}'`).split(",");
    expect(refs).toHaveLength(63);
    expect(new Set(refs).size).toBe(63);
    const seqs = refs.map((r) => {
      const m = /^DEMO-(\d{6})-(\d{3,})$/.exec(r);
      expect(m, r).not.toBeNull();
      expect([before, after]).toContain(m![1]);
      return Number(m![2]);
    });
    expect([...seqs].sort((x, y) => x - y)).toEqual(Array.from({ length: 63 }, (_, i) => i + 1));
    expect(sql(`select last_seq from private.reference_counters where tenant_id = '${demo.tenant}'`)).toBe("63");
  });

  it("parallel drafts from a real tenant's member use the tenant prefix and never collide", async () => {
    const owner = await signIn("owner-a@geraiexpress.test");
    const day = wibDay();
    const results = await Promise.all(Array.from({ length: 25 }, () => owner.rpc("create_shipment_draft", { p_outlet: IDS.outletA })));
    expect(results.filter((r) => r.error).map((r) => r.error?.message)).toEqual([]);
    const ids = results.map((r) => `'${r.data}'`).join(",");
    const refs = sql(`select string_agg(reference, ',') from public.shipments where id in (${ids})`).split(",");
    expect(new Set(refs).size).toBe(25);
    for (const r of refs) expect(r).toMatch(new RegExp(`^GERA-(${day}|\\d{6})-\\d{3,}$`));
  });

  it("the sequence widens past three digits instead of truncating", () => {
    const id = insertTenant("Gerai Seribu");
    sql(`insert into private.reference_counters (tenant_id, day, last_seq) values ('${id}', (now() at time zone 'Asia/Jakarta')::date, 998)`);
    const next = [1, 2, 3].map(() => sql(`select private.next_reference('${id}')`));
    const prefix = sql(`select shipment_prefix from public.tenants where id = '${id}'`);
    expect(next).toEqual([`${prefix}-${wibDay()}-999`, `${prefix}-${wibDay()}-1000`, `${prefix}-${wibDay()}-1001`]);
  });

  it("a new day starts the sequence again and leaves the earlier day's counter alone", () => {
    const id = insertTenant("Gerai Lintas Hari");
    const prefix = prefixOf(id);
    const today = sql(`select (now() at time zone 'Asia/Jakarta')::date::text`);
    const yesterday = sql(`select ((now() at time zone 'Asia/Jakarta')::date - 1)::text`);
    sql(`insert into private.reference_counters (tenant_id, day, last_seq) values ('${id}', '${yesterday}', 41)`);
    expect(sql(`select private.next_reference('${id}')`)).toBe(`${prefix}-${wibDay()}-001`);
    expect(sql(`select private.next_reference('${id}')`)).toBe(`${prefix}-${wibDay()}-002`);
    expect(sql(`select string_agg(day::text || '=' || last_seq, ',' order by day) from private.reference_counters where tenant_id = '${id}'`))
      .toBe(`${yesterday}=41,${today}=2`);
  });

  it("old-shape references stay valid and the per-tenant unique key stays", () => {
    const id = insertTenant("Gerai Lama");
    const outlet = randomUUID();
    sql(`insert into public.outlets (tenant_id, id, name, pickup_address, pickup_area) values ('${id}', '${outlet}', 'Outlet Lama', 'Jl. Lama 1', 'Kec. Lama')`);
    sql(`insert into public.shipments (tenant_id, outlet_id, reference, created_by) values ('${id}', '${outlet}', 'GX261014-ABCDEF', '${OWNER_A}')`);
    expect(() => sql(`insert into public.shipments (tenant_id, outlet_id, reference, created_by) values ('${id}', '${outlet}', 'GX261014-ABCDEF', '${OWNER_A}')`)).toThrow(/duplicate key/);
    expect(sql(`select reference from public.shipments where tenant_id = '${id}'`)).toBe("GX261014-ABCDEF");
  });
});

describe("slug and prefix never authorize (TEN-6)", () => {
  it("knowing another tenant's slug or reference grants nothing", async () => {
    const slugB = sql(`select slug from public.tenants where id = '${IDS.tenantB}'`);
    const prefixB = sql(`select shipment_prefix from public.tenants where id = '${IDS.tenantB}'`);
    const owner = await signIn("owner-a@geraiexpress.test");
    // Lookups by the other tenant's slug, prefix or reference return nothing.
    expect((await owner.from("tenants").select("id, slug").eq("slug", slugB)).data).toEqual([]);
    expect((await owner.from("tenants").select("id").eq("shipment_prefix", prefixB).eq("id", IDS.tenantB)).data).toEqual([]);
    expect((await owner.from("shipments").select("id").eq("reference", "GXTEST-B1")).data).toEqual([]);
    expect((await owner.from("outlets").select("id").eq("tenant_id", IDS.tenantB)).data).toEqual([]);
    // Acting on the other tenant's outlet is refused; no draft and no counter row appear for B.
    const before = sql(`select count(*) from public.shipments where tenant_id = '${IDS.tenantB}'`);
    expect((await owner.rpc("create_shipment_draft", { p_outlet: IDS.outletB })).error).not.toBeNull();
    expect(sql(`select count(*) from public.shipments where tenant_id = '${IDS.tenantB}'`)).toBe(before);
    // A member cannot rewrite their own tenant's slug or prefix through the Data API.
    const own = await owner.from("tenants").update({ slug: slugB }).eq("id", IDS.tenantA).select();
    expect(own.data ?? []).toEqual([]);
    expect(slugOf(IDS.tenantA)).toBe("gerai-uji-a");
    // The counter table is not reachable by API roles.
    expect(sql(`select has_table_privilege('authenticated', 'private.reference_counters', 'select, insert, update')`)).toBe("f");
    expect(sql(`select has_function_privilege('authenticated', 'private.next_reference(uuid)', 'execute')`)).toBe("f");
  });

  it("the slug list is a Super Admin read: tenant users are denied and demo tenants are not listed", async () => {
    const owner = await signIn("owner-a@geraiexpress.test");
    expect((await owner.rpc("platform_tenant_slugs")).error).not.toBeNull();
    const admin = await signInAal2("admin@geraiexpress.test");
    const { data, error } = await admin.rpc("platform_tenant_slugs");
    expect(error).toBeNull();
    const rows = data as { id: string; slug: string; shipment_prefix: string }[];
    expect(rows.find((r) => r.id === IDS.tenantA)).toEqual({ id: IDS.tenantA, slug: "gerai-uji-a", shipment_prefix: "GERA" });
    expect(rows.some((r) => /^demo-[0-9a-f]{8}$/.test(r.slug))).toBe(false);
  });
});
