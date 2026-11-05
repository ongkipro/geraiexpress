// T-109 (follow-ups of T-104/T-105/T-106): per-role timeouts, the schema version probe and the rewrap
// selection. Superuser SQL through the compose container; API calls through PostgREST.
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { DB_CONTAINER, DB_NAME, client, machine, signIn, sql } from "./helpers";

// psql reading stdin sends each statement on its own, so a setting changed by one statement governs the
// next one (a single -c string would run under the timeout armed at its start).
function psqlScript(script: string): string {
  return execFileSync("docker", ["exec", "-i", DB_CONTAINER, "psql", "-U", "postgres", "-d", DB_NAME, "-tA", "-v", "ON_ERROR_STOP=1"], {
    encoding: "utf8", input: script, stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}

const ROLE_SETTINGS: Record<string, Record<string, string>> = {
  anon: { statement_timeout: "5s", lock_timeout: "3s", idle_in_transaction_session_timeout: "15s" },
  authenticated: { statement_timeout: "15s", lock_timeout: "5s", idle_in_transaction_session_timeout: "30s" },
  authenticator: { statement_timeout: "65s" },
  service_role: { statement_timeout: "60s", lock_timeout: "10s", idle_in_transaction_session_timeout: "60s" },
};

// The role's own ALTER ROLE settings (database-independent rows), as name=value.
function roleSettings(role: string): Record<string, string> {
  const raw = sql(`select coalesce(string_agg(c, ',' order by c), '') from pg_db_role_setting s
    join pg_roles r on r.oid = s.setrole cross join unnest(s.setconfig) c where r.rolname = '${role}' and s.setdatabase = 0`);
  return Object.fromEntries(raw ? raw.split(",").map((pair) => pair.split("=") as [string, string]) : []);
}

describe("per-role timeouts (T-109)", () => {
  it("anon, authenticated and service_role carry deadlines aligned with the app; authenticator has an upper bound", () => {
    for (const [role, expected] of Object.entries(ROLE_SETTINGS)) expect(roleSettings(role), role).toEqual(expected);
    // The migration and maintenance owner is unaffected.
    expect(roleSettings("postgres")).toEqual({});
  });

  it("a statement over the authenticated timeout is cancelled with SQLSTATE 57014 before it completes", () => {
    // PostgREST applies the impersonated role's settings per request; plain SET ROLE does not, so the probe
    // applies the stored value the same way (set_config local) under the authenticated role.
    // The DO block reports the SQLSTATE of the cancellation (query_canceled can be trapped by name).
    const script = `begin;
      select set_config('statement_timeout', (select split_part(c, '=', 2) from pg_db_role_setting s join pg_roles r on r.oid = s.setrole
        cross join unnest(s.setconfig) c where r.rolname = 'authenticated' and s.setdatabase = 0 and c like 'statement_timeout=%'), true);
      set local role authenticated;
      do $probe$ begin perform pg_sleep(20); raise exception 'sqlstate:none';
        exception when query_canceled then raise exception 'sqlstate:%', sqlstate; end $probe$;
      commit;`;
    const started = Date.now();
    let message = "";
    try {
      psqlScript(script);
    } catch (error) {
      message = String((error as { stderr?: string }).stderr ?? error);
    }
    expect(message).toMatch(/sqlstate:57014/);
    expect(Date.now() - started).toBeLessThan(19000);
  }, 30000);
});

describe("schema_version (T-109)", () => {
  it("returns the newest applied migration version to the machine identity only", async () => {
    const newest = sql("select max(version) from private.schema_migrations");
    expect(newest).toMatch(/^[0-9]{14}$/);
    const answer = await machine().rpc("schema_version");
    expect(answer.error).toBeNull();
    expect(answer.data).toBe(newest);
    for (const c of [client(), await signIn("owner-a@geraiexpress.test")]) {
      const refused = await c.rpc("schema_version");
      expect(refused.data).toBeNull();
      expect(refused.error?.code).toBe("42501");
    }
  });

  it("is security definer with an empty search_path, and the ledger itself stays private", () => {
    expect(sql(`select (prosecdef and exists (select 1 from unnest(proconfig) c where c = 'search_path=""'))::text
      from pg_proc where oid = 'public.schema_version()'::regprocedure`)).toBe("true");
    for (const role of ["anon", "authenticated", "service_role"]) {
      expect(sql(`select has_table_privilege('${role}', 'private.schema_migrations', 'select')`), role).toBe("f");
    }
  });
});
