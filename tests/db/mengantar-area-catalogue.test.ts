import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { client, DB_CONTAINER, DB_NAME, IDS, signIn, sql, type TestClient } from "./helpers";

const VERSION = "mengantar-2099-01-01-4";
const ids = [1, 2, 3, 4].map((n) => `ffff1000000000000000000${n}`);
let member: TestClient;
beforeAll(async () => {
  member = await signIn("operator-a@geraiexpress.test");
  sql(`insert into public.mengantar_areas (id, province, city, district, subdistrict, postal_code, dataset_version) values
    ('${ids[0]}', 'UJI', 'UJI', 'UJI', 'ZZT100 POSTAL', '99881', '${VERSION}'),
    ('${ids[1]}', 'UJI', 'UJI', 'UJI', '99881 KELURAHAN', '', '${VERSION}'),
    ('${ids[2]}', 'UJI', 'UJI', '99881 KECAMATAN', 'ZZT100 DISTRICT', '', '${VERSION}'),
    ('${ids[3]}', 'UJI', '99881 KOTA', 'UJI', 'ZZT100 CITY', '', '${VERSION}')`);
});
afterAll(() => { sql(`delete from public.mengantar_areas where dataset_version = '${VERSION}'`); });

describe("search_mengantar_areas (T-100)", () => {
  it("ranks exact postal, kelurahan prefix, kecamatan prefix, then kota prefix", async () => {
    const { data, error } = await member.rpc("search_mengantar_areas", { p_query: " 99881 " });
    expect(error).toBeNull();
    expect((data as { id: string }[]).map((a) => a.id)).toEqual(ids);
    expect(data[0]).toEqual({ id: ids[0], province: "UJI", city: "UJI", district: "UJI", subdistrict: "ZZT100 POSTAL", postal_code: "99881" });
  });

  it("normalizes case, supports multiword search and applies a deterministic bounded limit", async () => {
    const { data, error } = await member.rpc("search_mengantar_areas", { p_query: "99881", p_limit: 2 });
    expect(error).toBeNull();
    expect((data as { id: string }[]).map((a) => a.id)).toEqual(ids.slice(0, 2));
    const multi = await member.rpc("search_mengantar_areas", { p_query: "zzt100 district 99881" });
    expect(multi.error).toBeNull();
    expect((multi.data as { id: string }[]).map((a) => a.id)).toEqual([ids[2]]);
    // Typed separators between names do not become part of a token.
    const punctuated = await member.rpc("search_mengantar_areas", { p_query: "ZZT100 district, 99881 -" });
    expect(punctuated.error).toBeNull();
    expect((punctuated.data as { id: string }[]).map((a) => a.id)).toEqual([ids[2]]);
  });

  it.each([1, 30])("accepts limit boundary %s", async (p_limit) => {
    const result = await member.rpc("search_mengantar_areas", { p_query: "99881", p_limit });
    expect(result.error).toBeNull();
    expect(result.data).toHaveLength(Math.min(4, p_limit));
  });

  it.each(["zzz", "z".repeat(60)])("accepts query length boundary %#", async (p_query) => {
    expect((await member.rpc("search_mengantar_areas", { p_query })).error).toBeNull();
  });

  it.each([0, 31, -1, null])("refuses limit %s", async (p_limit) => {
    const { error } = await member.rpc("search_mengantar_areas", { p_query: "99881", p_limit });
    expect(error?.code).toBe("22023");
  });

  it.each(["ab", "  ", "x".repeat(61), null])("refuses invalid query %#", async (p_query) => {
    const { error } = await member.rpc("search_mengantar_areas", { p_query });
    expect(error?.code).toBe("22023");
  });

  it("treats LIKE metacharacters literally", async () => {
    const result = await member.rpc("search_mengantar_areas", { p_query: "%%%" });
    expect(result.error).toBeNull();
    expect(result.data).toEqual([]);
  });

  it("refuses anon and signed-in identities without membership", async () => {
    expect((await client().rpc("search_mengantar_areas", { p_query: "99881" })).error?.code).toBe("42501");
    const noAccess = await signIn("no-access@geraiexpress.test");
    expect((await noAccess.rpc("search_mengantar_areas", { p_query: "99881" })).error?.code).toBe("42501");
    const outsider = client();
    const signed = await outsider.auth.signInAnonymously();
    const tenant = randomUUID();
    try {
      expect((await outsider.rpc("search_mengantar_areas", { p_query: "99881" })).error?.code).toBe("42501");
      sql(`insert into public.tenants (id, name, lifecycle, is_demo) values ('${tenant}', 'Catalogue demo test', 'active', true);
        insert into public.memberships (tenant_id, user_id, role) values ('${tenant}', '${signed.data.user!.id}', 'tenant_admin')`);
      expect((await outsider.rpc("search_mengantar_areas", { p_query: "99881" })).error).toBeNull();
    } finally {
      // Delete only this test's empty demo tenant and identity, never shared fixtures.
      sql(`delete from public.tenants where id = '${tenant}'; delete from auth.users where id = '${signed.data.user!.id}'`);
    }
  });

  it("rechecks inactive membership and suspended tenant lifecycle at the RPC boundary", () => {
    const user = sql("select id from auth.users where email = 'operator-a@geraiexpress.test'");
    const invoke = `set local role authenticated;
      select set_config('request.jwt.claims', '{"sub":"${user}","role":"authenticated","is_anonymous":false}', true);
      select * from public.search_mengantar_areas('99881');`;
    // A failing transaction rolls fixture changes back in the same SQL session.
    expect(() => sql(`begin; update public.memberships set status = 'revoked' where user_id = '${user}'; ${invoke} rollback;`)).toThrow(/not_a_member/);
    expect(() => sql(`begin; update public.tenants set lifecycle = 'suspended' where id = '${IDS.tenantA}'; ${invoke} rollback;`)).toThrow(/not_a_member/);
  });

  it("gives neither anon nor members direct select/insert, nor machine-role table access", async () => {
    for (const c of [client(), member]) {
      expect((await c.from("mengantar_areas").select("id")).error?.code).toBe("42501");
      expect((await c.from("mengantar_areas").insert({ id: "ffff10000000000000000009" })).error?.code).toBe("42501");
    }
    expect(sql("select has_table_privilege('service_role', 'public.mengantar_areas', 'select,insert,update,delete')")).toBe("f");
  });

  it("enforces id, name, postal and dataset checks even for owner-loaded rows", () => {
    const insert = (id: string, name: string, postal: string, version = VERSION) => sql(`insert into public.mengantar_areas
      (id, province, city, district, subdistrict, postal_code, dataset_version)
      values ('${id}', 'UJI', 'UJI', 'UJI', '${name}', '${postal}', '${version}')`);
    expect(() => insert("bad", "UJI", "12345")).toThrow(/check constraint/);
    for (const name of ["", " padded ", "x".repeat(161)]) {
      expect(() => insert("ffff10000000000000000009", name, "12345")).toThrow(/check constraint/);
    }
    expect(() => insert("ffff10000000000000000009", "UJI", "1234")).toThrow(/check constraint/);
    expect(() => insert("ffff10000000000000000009", "UJI", "12345", "bad")).toThrow(/check constraint/);
  });
});

describe("load-mengantar-areas against the isolated database (T-100)", () => {
  it("loads gzip via db-common gx_psql, reruns unchanged and updates without deleting missing ids", () => {
    const dir = mkdtempSync(join(tmpdir(), "gx-areas-"));
    const file = join(dir, "areas.json.gz");
    const loaderIds = ["ffff20000000000000000001", "ffff20000000000000000002"];
    const areas = loaderIds.map((id) => ({ id, province: "UJI", city: "UJI", district: "UJI", subdistrict: "LOADER T100", postal_code: "" }));
    const write = (rows: typeof areas) => writeFileSync(file, gzipSync(JSON.stringify({ source: "synthetic test fixture", harvested_at: "2099-01-02", count: rows.length, areas: rows })));
    const run = () => execFileSync(process.execPath, ["scripts/load-mengantar-areas.mjs", file], {
      encoding: "utf8", env: { ...process.env, DATABASE_URL: "", GX_DB_CONTAINER: DB_CONTAINER, GX_DB_NAME: DB_NAME, GX_DB_ENV_FILE: "/dev/null" },
    }).trim();
    try {
      write(areas);
      expect(run()).toBe("validated=2 changed=2 unchanged=0");
      expect(run()).toBe("validated=2 changed=0 unchanged=2");
      write([{ ...areas[0], subdistrict: "UPDATED T100" }]);
      expect(run()).toBe("validated=1 changed=1 unchanged=0");
      expect(sql(`select count(*) from public.mengantar_areas where id in ('${loaderIds.join("','")}')`)).toBe("2");
      expect(sql(`select subdistrict from public.mengantar_areas where id = '${loaderIds[0]}'`)).toBe("UPDATED T100");
    } finally {
      sql(`delete from public.mengantar_areas where id in ('${loaderIds.join("','")}')`);
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
