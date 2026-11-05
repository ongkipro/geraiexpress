// T-104 (migration 20261105180000_db_hardening): shipment -> membership lock order for tracking
// revocation, the membership recheck after private.lock_member_shipment's lock wait, and the
// pilot-report range indexes. Each test owns a fresh gerai (owner-a admin, operator-a operator), so
// deactivating its operator never touches the seeded tenants. Separate psql connections are named
// (application_name) and terminated after each test, even after a failed assertion.
import { type ChildProcess, spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { DB_CONTAINER, DB_NAME, realOperation, signIn, sql } from "./helpers";

const OWNER_A = "00000000-0000-4000-a000-0000000000a1";
const OPERATOR_A = "00000000-0000-4000-a000-0000000000a2";
const tenants: string[] = [];
const sessions: { name: string; child: ChildProcess }[] = [];

afterEach(() => {
  if (sessions.length) {
    sql(`select pg_terminate_backend(pid) from pg_stat_activity where application_name in (${sessions.map((s) => `'${s.name}'`).join(",")})`);
    for (const s of sessions.splice(0)) s.child.kill();
  }
});
afterAll(() => {
  if (!tenants.length) return;
  const ids = tenants.map((id) => `'${id}'`).join(",");
  sql(`update public.shipments set selected_quote_id = null where tenant_id in (${ids}); delete from public.tenants where id in (${ids})`);
});

type Result = { code: number | null; output: string };
const newName = () => `gxt104-${randomUUID()}`;
function startPsql(name: string, statement: string): Promise<Result> {
  const child = spawn("docker", ["exec", "-e", `PGAPPNAME=${name}`, DB_CONTAINER, "psql", "-U", "postgres", "-d", DB_NAME,
    "-tA", "-v", "ON_ERROR_STOP=1", "-c", statement], { stdio: ["ignore", "pipe", "pipe"] });
  sessions.push({ name, child });
  let output = "";
  child.stdout.on("data", (data) => { output += String(data); });
  child.stderr.on("data", (data) => { output += String(data); });
  return new Promise((resolve) => {
    child.on("error", (error) => { output += `spawn: ${error.message}`; });
    child.on("close", (code) => resolve({ code, output }));
  });
}
// One transaction as a member (authenticated role and JWT claims) in its own connection.
const asMember = (user: string, call: string) => `begin; set local statement_timeout = '15s'; set local role authenticated;
  select set_config('request.jwt.claims', '{"sub":"${user}","role":"authenticated","is_anonymous":false}', true);
  ${call}; commit;`;
async function until(predicate: string, label: string) {
  const deadline = Date.now() + 8000;
  while (sql(`select exists (${predicate})`) !== "t") {
    if (Date.now() > deadline) throw new Error(`timed out: ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
}
const waitingOnLock = (name: string) => until(
  `select 1 from pg_stat_activity where application_name = '${name}' and wait_event_type = 'Lock'`, `${name} waits on a lock`);
const sleeping = (name: string) => until(
  `select 1 from pg_stat_activity where application_name = '${name}' and wait_event = 'PgSleep'`, `${name} reached its gate`);

function gerai() {
  const tenant = randomUUID(), outlet = randomUUID();
  tenants.push(tenant);
  sql(`insert into public.tenants (id, name, lifecycle) values ('${tenant}', 'Gerai Uji T104', 'active');
    insert into public.outlets (tenant_id, id, name) values ('${tenant}', '${outlet}', 'Outlet Uji T104');
    insert into public.memberships (tenant_id, user_id, role) values ('${tenant}', '${OWNER_A}', 'tenant_admin'), ('${tenant}', '${OPERATOR_A}', 'operator');`);
  return { tenant, outlet };
}
async function issuedShipment(g: { tenant: string; outlet: string }) {
  const f = await realOperation({ tenant: g.tenant, outlet: g.outlet, noCredential: true });
  sql(`update public.shipments set submission_state = 'issued', customer_charge_idr = 12000, awb = 'JP${f.shipment.slice(0, 8)}',
    issued_at = now() where id = '${f.shipment}'`);
  return f.shipment;
}

describe("shipment -> membership lock order (T-104 finding 1)", () => {
  it("revoke_tracking_link and void_counter_payment on one shipment both finish without a deadlock (40P01)", async () => {
    const g = gerai();
    const shipment = await issuedShipment(g);
    const operator = await signIn("operator-a@geraiexpress.test");
    const prepared = await operator.rpc("prepare_tracking_link", { p_shipment: shipment });
    expect(prepared.error).toBeNull();
    const link = prepared.data as string;
    expect((await operator.rpc("publish_tracking_link", { p_shipment: shipment, p_link: link, p_hash: randomBytes(32).toString("hex") })).error).toBeNull();
    const paid = await operator.rpc("record_counter_payment", {
      p_shipment: shipment, p_method: "cash", p_amount_idr: 12000, p_received_idr: 20000, p_difference_reason: null });
    expect(paid.error).toBeNull();
    const payment = paid.data as string;

    // The holder locks the shipment. The void queues first, then the revocation. The old revocation
    // locked the memberships before waiting for the shipment: once the void got the shipment it waited
    // for those memberships and PostgreSQL aborted one side with 40P01. While both wait, the holder
    // proves (NOWAIT) that neither holds a membership lock.
    const holder = newName(), voiding = newName(), revoking = newName();
    const held = startPsql(holder, `begin; set local statement_timeout = '15s';
      select 1 from public.shipments where id = '${shipment}' for update;
      do $gate$ declare deadline timestamptz := clock_timestamp() + interval '10 seconds'; begin loop
        perform pg_stat_clear_snapshot();
        exit when (select count(*) from pg_stat_activity a where a.wait_event_type = 'Lock'
          and a.application_name in ('${voiding}', '${revoking}')) = 2;
        if clock_timestamp() > deadline then raise exception 'waiters_not_blocked'; end if;
        perform pg_sleep(0.05);
      end loop; end $gate$;
      select 1 from public.memberships where tenant_id = '${g.tenant}' for share nowait;
      commit;`);
    await sleeping(holder);
    const voided = startPsql(voiding, asMember(OWNER_A, `select public.void_counter_payment('${payment}', 'Salah catat pembayaran')`));
    await waitingOnLock(voiding);
    const revoked = startPsql(revoking, asMember(OWNER_A, `select public.revoke_tracking_link('${shipment}', '${link}')`));
    const results = await Promise.all([held, voided, revoked]);
    const diagnostics = results.map((r, i) => `${["holder", "void", "revoke"][i]} (${r.code}):\n${r.output}`).join("\n");
    expect(diagnostics).not.toMatch(/40P01|deadlock detected|55P03|could not obtain lock/);
    expect(results.map((r) => r.code), diagnostics).toEqual([0, 0, 0]);
    expect(sql(`select voided_at is not null from public.counter_payments where id = '${payment}'`)).toBe("t");
    expect(sql(`select revoked_at is not null from public.tracking_links where shipment_id = '${shipment}'`)).toBe("t");
    // Refusals keep their codes: an operator is refused before any lock.
    expect((await operator.rpc("revoke_tracking_link", { p_shipment: shipment, p_link: link })).error).toMatchObject({ message: "admin_required", code: "42501" });
  }, 30000);

  it("revoke_tracking_link locks the shipment before the memberships, after a cheap admin check", () => {
    const body = sql("select prosrc from pg_proc where oid = 'public.revoke_tracking_link(uuid,uuid)'::regprocedure");
    expect(body.indexOf("member_role")).toBeGreaterThan(-1);
    expect(body.indexOf("member_role")).toBeLessThan(body.indexOf("for update"));
    expect(body.indexOf("for update")).toBeLessThan(body.indexOf("require_tenant_admin_locked"));
    const reconcile = sql("select prosrc from pg_proc where oid = 'public.reconcile_shipment(uuid)'::regprocedure");
    expect(reconcile.indexOf("lock_member_shipment")).toBeLessThan(reconcile.indexOf("from public.memberships"));
  });
});

describe("membership is rechecked after the shipment lock wait (T-104 finding 2)", () => {
  const scenarios = [
    {
      name: "record_counter_payment",
      call: (shipment: string) => `select public.record_counter_payment('${shipment}', 'cash', 12000, 20000, null)`,
      written: (shipment: string) => sql(`select (select count(*) from public.counter_payments where shipment_id = '${shipment}')
        + (select count(*) from public.shipment_events where shipment_id = '${shipment}' and kind = 'counter_payment')
        + (select count(*) from public.audit_events where action = 'counter_payment.record' and detail ->> 'shipment' = '${shipment}')`),
    },
    {
      name: "open_shipment_case",
      call: (shipment: string) => `select public.open_shipment_case('${shipment}', 'damaged', 'full_value', 'Kardus penyok, isi pecah',
        array['foto-1.jpg'], null, null, null)`,
      written: (shipment: string) => sql(`select (select count(*) from public.shipment_cases where shipment_id = '${shipment}')
        + (select count(*) from public.shipment_case_events e join public.shipment_cases c on c.tenant_id = e.tenant_id and c.id = e.case_id
            where c.shipment_id = '${shipment}')
        + (select count(*) from public.shipment_events where shipment_id = '${shipment}' and kind = 'case_opened')
        + (select count(*) from public.audit_events where action = 'shipment_case.open' and detail ->> 'shipment' = '${shipment}')`),
    },
  ];

  for (const scenario of scenarios) {
    it(`${scenario.name} by an operator deactivated while it waited is refused with P0002 and writes nothing`, async () => {
      const g = gerai();
      const shipment = await issuedShipment(g);
      const admin = await signIn("owner-a@geraiexpress.test");
      const holder = newName(), member = newName();
      // The holder keeps the shipment until the operator's membership is revoked (committed).
      const held = startPsql(holder, `begin; set local statement_timeout = '15s';
        select 1 from public.shipments where id = '${shipment}' for update;
        do $gate$ declare deadline timestamptz := clock_timestamp() + interval '10 seconds'; begin loop
          exit when exists (select 1 from public.memberships where tenant_id = '${g.tenant}' and user_id = '${OPERATOR_A}' and status = 'revoked');
          if clock_timestamp() > deadline then raise exception 'membership_not_revoked'; end if;
          perform pg_sleep(0.05);
        end loop; end $gate$;
        commit;`);
      await sleeping(holder);
      const waiting = startPsql(member, asMember(OPERATOR_A, scenario.call(shipment)));
      await waitingOnLock(member);
      const revision = Number(sql(`select revision from public.memberships where tenant_id = '${g.tenant}' and user_id = '${OPERATOR_A}'`));
      expect((await admin.rpc("deactivate_member", { p_tenant: g.tenant, p_user: OPERATOR_A, p_expected_revision: revision })).error).toBeNull();
      const [h, w] = await Promise.all([held, waiting]);
      expect(h.code, h.output).toBe(0);
      expect(w.code, w.output).not.toBe(0);
      expect(w.output).toMatch(/not_found/);
      expect(scenario.written(shipment)).toBe("0");
    }, 30000);
  }

  it("lock_member_shipment rechecks require_member after its FOR UPDATE and refuses a vanished row", () => {
    const body = sql("select prosrc from pg_proc where oid = 'private.lock_member_shipment(uuid)'::regprocedure");
    const lock = body.indexOf("for update");
    expect(body.indexOf("require_member")).toBeLessThan(lock);
    expect(body.indexOf("require_member", lock)).toBeGreaterThan(lock);
    expect(body.indexOf("if not found", lock)).toBeGreaterThan(lock);
  });
});

describe("pilot report range indexes (T-104 finding 4)", () => {
  it("indexes issued shipments and active payments by tenant and time, and the scope CTE is not materialized", () => {
    const index = (name: string) => sql(`select indexdef from pg_indexes where schemaname = 'public' and indexname = '${name}'`);
    expect(index("shipments_issued_at_idx")).toMatch(/ON public\.shipments USING btree \(tenant_id, issued_at\) WHERE \(issued_at IS NOT NULL\)/);
    expect(index("counter_payments_active_recorded_idx")).toMatch(/ON public\.counter_payments USING btree \(tenant_id, recorded_at\) WHERE \(voided_at IS NULL\)/);
    expect(sql("select prosrc ~* 'scoped as not materialized' from pg_proc where oid = 'public.pilot_report(uuid,date,date)'::regprocedure")).toBe("t");
  });
});
