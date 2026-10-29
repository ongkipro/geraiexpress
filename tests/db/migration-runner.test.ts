import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { sql } from "./helpers";

// Only the disposable harness opts in: these probes create/drop their own empty database.
describe.skipIf(process.env.GX_AUDIT_ISOLATED !== "1")("migration runner integrity", () => {
  it("serializes runners, detects missing/changed history, and rolls back a failed file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gx-migration-test-"));
    const database = `gx_runner_${process.pid}`;
    const foundation = join(dir, "foundation"), migrations = join(dir, "migrations");
    mkdirSync(foundation); mkdirSync(migrations);
    const first = join(foundation, "20261001000000_probe.sql");
    const firstSql = "create table public.probe (id integer primary key);";
    writeFileSync(first, firstSql);
    sql(`create database ${database}`);
    const run = () => new Promise<{ code: number | null; output: string }>((resolve) => {
      const child = spawn("bash", ["scripts/db-migrate.sh"], { env: {
        ...process.env, GX_DB_NAME: database, GX_DB_ENV_FILE: "/dev/null",
        DB_FOUNDATION_DIR: foundation, DB_MIGRATIONS_DIR: migrations,
      } });
      let output = "";
      child.stdout.on("data", (data) => { output += data; });
      child.stderr.on("data", (data) => { output += data; });
      child.on("close", (code) => resolve({ code, output }));
    });
    try {
      expect((await run()).code).toBe(0);
      writeFileSync(join(migrations, "20261002000000_slow.sql"), "select pg_sleep(1); insert into public.probe values (1);");
      const both = await Promise.all([run(), run()]);
      expect(both.map((r) => r.code), both.map((r) => r.output).join("\n")).toEqual([0, 0]);
      expect(both.filter((r) => r.output.includes("Applied 20261002000000_slow.sql"))).toHaveLength(1);
      unlinkSync(first);
      const missing = await run();
      expect(missing.code).not.toBe(0);
      expect(missing.output).toContain("Applied migration missing from checkout");
      writeFileSync(first, `${firstSql}\n-- changed`);
      const changed = await run();
      expect(changed.code).not.toBe(0);
      expect(changed.output).toContain("Checksum or filename mismatch");
      writeFileSync(first, firstSql);
      const bad = join(migrations, "20261003000000_failure.sql");
      writeFileSync(bad, "create table public.rollback_probe(id int); select 1/0;");
      expect((await run()).code).not.toBe(0);
      // A subsequent valid version with the same CREATE proves the failed table/ledger
      // transaction rolled back; this is an unapplied migration, so fixing it is allowed.
      writeFileSync(bad, "create table public.rollback_probe(id int);");
      expect((await run()).code).toBe(0);
      expect((await run()).output).toContain("Migrations: 0 applied");
      expect(readFileSync(first, "utf8")).toBe(firstSql);
    } finally {
      sql(`drop database ${database}`);
      rmSync(dir, { recursive: true, force: true });
    }
  }, 40000);
});
