// T-115: provider operation -> shipment -> membership lock order for reconcile_shipment vs the admin closes.
// Before the fix reconcile_shipment locked shipment -> memberships -> provider_operations, while
// close_ambiguous_pickup_reservation (and close_unknown_batch_payment) lock provider_operations -> shipment ->
// memberships, so two admins on the same unknown create operation could deadlock (40P01).
// Deterministic schedule (state-driven, not timed): a holder connection locks the shipment row; reconcile and then
// the pickup close are started and the holder releases only after pg_stat_activity shows BOTH waiting on a lock.
// The operation is simulated, so the pickup close always refuses (not_closable) after reaching its locks and
// reconcile is the command that succeeds; the scenario reproduces the old lock cycle, not a contest between two
// writers. Dynamic coverage is reconcile vs close_ambiguous_pickup_reservation; the close_unknown_batch_payment
// order (operations -> shipments -> memberships) is checked by source review only. Separate psql connections are
// named and terminated after each test.
import { type ChildProcess, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { DB_CONTAINER, DB_NAME, realOperation, sql } from "./helpers";

const OWNER_A = "00000000-0000-4000-a000-0000000000a1";
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
const newName = () => `gxt115-${randomUUID()}`;
function startPsql(name: string, statement: string): Promise<Result> {
  const child = spawn("docker", ["exec", "-e", `PGAPPNAME=${name}`, DB_CONTAINER, "psql", "-U", "postgres", "-d", DB_NAME,
    "-tA", "-v", "ON_ERROR_STOP=1", "-c", statement], { stdio: ["ignore", "pipe", "pipe"] });
  sessions.push({ name, child });
  let output = "";
  child.stdout.on("data", (d) => { output += String(d); });
  child.stderr.on("data", (d) => { output += String(d); });
  return new Promise((resolve) => {
    child.on("error", (e) => { output += `spawn: ${e.message}`; });
    child.on("close", (code) => resolve({ code, output }));
  });
}
const asAdmin = (call: string) => `begin; set local statement_timeout = '20s'; set local lock_timeout = '15s'; set local role authenticated;
  select set_config('request.jwt.claims', '{"sub":"${OWNER_A}","role":"authenticated","is_anonymous":false}', true);
  ${call}; commit;`;
async function until(predicate: string, label: string, ms = 8000) {
  const deadline = Date.now() + ms;
  while (sql(`select exists (${predicate})`) !== "t") {
    if (Date.now() > deadline) throw new Error(`timed out: ${label}`);
    await new Promise((r) => setTimeout(r, 30));
  }
}
const waitingOnLock = (name: string) => until(
  `select 1 from pg_stat_activity where application_name = '${name}' and wait_event_type = 'Lock'`, `${name} waits on a lock`);

function gerai() {
  const tenant = randomUUID(), outlet = randomUUID();
  tenants.push(tenant);
  sql(`insert into public.tenants (id, name, lifecycle) values ('${tenant}', 'Gerai Uji T115', 'active');
    insert into public.outlets (tenant_id, id, name) values ('${tenant}', '${outlet}', 'Outlet Uji T115');
    insert into public.memberships (tenant_id, user_id, role) values ('${tenant}', '${OWNER_A}', 'tenant_admin');`);
  return { tenant, outlet };
}

// A simulated create operation left 'unknown' with a resting pickup reservation: both reconcile_shipment (needs
// is_simulated and a non-final state) and close_ambiguous_pickup_reservation reach their lock sequence for it.
async function contested() {
  const g = gerai();
  const f = await realOperation({ tenant: g.tenant, outlet: g.outlet, noCredential: true, simulated: true });
  sql(`update public.provider_operations set state = 'unknown', pickup_phase = 'reserving', last_checked_at = now(),
         dispatched_at = now() - interval '1 hour' where id = '${f.op}'`);
  return { ...g, ...f };
}

describe("reconcile_shipment vs admin close lock order (T-115)", () => {
  it("each command takes the provider operation lock before the shipment and memberships", () => {
    const reconcile = sql("select prosrc from pg_proc where oid = 'public.reconcile_shipment(uuid)'::regprocedure");
    const op = reconcile.search(/from public\.provider_operations[\s\S]*?for update/);
    const shipment = reconcile.indexOf("lock_member_shipment");
    const members = reconcile.indexOf("from public.memberships");
    expect(op).toBeGreaterThan(-1);
    expect(op).toBeLessThan(shipment);
    expect(shipment).toBeLessThan(members);
    const close = sql("select prosrc from pg_proc where oid = 'public.close_ambiguous_pickup_reservation(uuid,text)'::regprocedure");
    expect(close.search(/from public\.provider_operations[\s\S]*?for update/)).toBeLessThan(close.indexOf("from public.shipments where tenant_id = v_tenant and id = p_shipment for update"));
  });

  it("reconcile and close on the same unknown operation never deadlock (40P01): both finish, one wins, the other is refused cleanly", async () => {
    const f = await contested();
    // The holder takes the shipment row first; both commands then queue behind it. Old order: reconcile waited on
    // the SHIPMENT (its first lock), close took the OPERATION and then waited on the shipment; when the holder
    // released, reconcile got the shipment and waited on the operation held by close -> cycle -> 40P01.
    const holder = newName(), reconciling = newName(), closing = newName();
    const held = startPsql(holder, `begin; set local statement_timeout = '20s';
      select 1 from public.shipments where id = '${f.shipment}' for update;
      do $gate$ declare deadline timestamptz := clock_timestamp() + interval '12 seconds'; begin loop
        perform pg_stat_clear_snapshot();
        exit when (select count(*) from pg_stat_activity a where a.wait_event_type = 'Lock'
          and a.application_name in ('${reconciling}', '${closing}')) = 2;
        if clock_timestamp() > deadline then raise exception 'waiters_not_blocked'; end if;
        perform pg_sleep(0.05);
      end loop; end $gate$;
      commit;`);
    await until(`select 1 from pg_stat_activity where application_name = '${holder}' and wait_event = 'PgSleep'`, "holder gate");
    const reconciled = startPsql(reconciling, asAdmin(`select public.reconcile_shipment('${f.shipment}')`));
    await waitingOnLock(reconciling);
    const closed = startPsql(closing, asAdmin(`select public.close_ambiguous_pickup_reservation('${f.shipment}', 'Uji T-115: slot diperiksa manual')`));
    const results = await Promise.all([held, reconciled, closed]);
    const diagnostics = results.map((r, i) => `${["holder", "reconcile", "close"][i]} (${r.code}):\n${r.output}`).join("\n");
    expect(diagnostics).not.toMatch(/40P01|deadlock detected|55P03|could not obtain lock/);
    expect(results[0].code, diagnostics).toBe(0);
    // No deadlock, and exactly one command writes. With this simulated fixture that is reconcile; the pickup close
    // refuses with its own 55000 code (the assertions below also accept the reverse outcome, which this fixture
    // cannot produce).
    const wins = [results[1].code, results[2].code].filter((c) => c === 0).length;
    expect(wins, diagnostics).toBe(1);
    expect(diagnostics).toMatch(/nothing_to_reconcile|not_closable/);
    const state = sql(`select state || ':' || coalesce(result_code, '') from public.provider_operations where id = '${f.op}'`);
    expect(["succeeded:SIMULATED_RECONCILED", "failed:CLOSED_NOT_CREATED"]).toContain(state);
  }, 40000);

  it("authorization is unchanged: an operator is refused before any lock", async () => {
    const f = await contested();
    sql(`insert into public.memberships (tenant_id, user_id, role) values ('${f.tenant}', '00000000-0000-4000-a000-0000000000a2', 'operator')`);
    const name = newName();
    const r = await startPsql(name, `begin; set local role authenticated;
      select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-0000000000a2","role":"authenticated","is_anonymous":false}', true);
      select public.reconcile_shipment('${f.shipment}'); commit;`);
    expect(r.code).not.toBe(0);
    expect(r.output).toMatch(/admin_required/);
    expect(sql(`select state from public.provider_operations where id = '${f.op}'`)).toBe("unknown");
  });
  it("reconciles the LATEST create operation when older history rows exist (audit F4), whatever the plan returns first", async () => {
    const g = gerai();
    const f = await realOperation({ tenant: g.tenant, outlet: g.outlet, noCredential: true, simulated: true });
    // The original operation (physically first) is an old definite refusal; a newer unknown one belongs to the same shipment.
    sql(`update public.provider_operations set state = 'failed', result_code = 'PROVIDER_REJECTED', created_at = now() - interval '2 days',
           updated_at = now() - interval '2 days' where id = '${f.op}'`);
    const newer = randomUUID();
    sql(`insert into public.provider_operations (tenant_id, shipment_id, id, kind, idempotency_key, input_digest, state, is_simulated, actor, created_at)
      values ('${g.tenant}', '${f.shipment}', '${newer}', 'create_order', 'key-${newer}', 'digest', 'unknown', true, '${OWNER_A}', now() - interval '1 hour')`);
    const out = sql(`begin; set local role authenticated;
      select set_config('request.jwt.claims', '{"sub":"${OWNER_A}","role":"authenticated","is_anonymous":false}', true);
      select public.reconcile_shipment('${f.shipment}')::jsonb ->> 'operation_id'; commit;`);
    expect(out).toContain(newer);
    expect(sql(`select state from public.provider_operations where id = '${newer}'`)).toBe("succeeded");
    expect(sql(`select state || ':' || result_code from public.provider_operations where id = '${f.op}'`)).toBe("failed:PROVIDER_REJECTED");
  });
});
