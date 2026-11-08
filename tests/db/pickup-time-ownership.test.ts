// Audit F1: one Mengantar pickup time id must never be held by two operations of the same tenant and provider
// environment. dispatch_pickup_known_time_ids is an unlocked read, so the database enforces ownership itself:
// dispatch_pickup_record_reservation and dispatch_pickup_requeue refuse an id another operation holds
// ('time_id_held') and the losing operation stays unresolved. The race uses two separate psql connections.
// Audit F2 recovery: a reservation read-back that concluded NOT_CREATED may be requeued by a later read.
import { type ChildProcess, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { DB_CONTAINER, DB_NAME, realOperation, sql } from "./helpers";

const TIME_ID = "6b0c2a1e9d3f4a5b6c7d8e90";
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
async function until(predicate: string, label: string, ms = 8000) {
  const deadline = Date.now() + ms;
  while (sql(`select exists (${predicate})`) !== "t") {
    if (Date.now() > deadline) throw new Error(`timed out: ${label}`);
    await new Promise((r) => setTimeout(r, 30));
  }
}

// Two real create operations (two shipments) of one tenant, both claimed in the sandbox, both left 'unknown'
// with a lost reservation answer (phase 'reserving'), as after two crashed or timed-out POST /time calls.
async function twoReservingOperations() {
  const first = await realOperation();
  const outlet = sql(`select outlet_id from public.shipments where id = '${first.shipment}'`);
  tenants.push(first.tenant);
  const second = await realOperation({ tenant: first.tenant, outlet });
  for (const f of [first, second]) {
    sql(`update public.provider_operations set state = 'unknown', attempts = 1, provider_env = 'sandbox', pickup_phase = 'reserving',
      dispatched_at = now() - interval '1 hour' where id = '${f.op}'`);
  }
  return { first, second };
}
const requeue = (op: string, id: string) => `select public.dispatch_pickup_requeue('${op}', 1, '${id}')`;
const state = (op: string) => sql(`select state || '|' || coalesce(result_code, '-') || '|' || coalesce(pickup_phase, '-') || '|' || coalesce(pickup_time_id, '-')
  from public.provider_operations where id = '${op}'`);
const shipmentState = (shipment: string) => sql(`select submission_state from public.shipments where id = '${shipment}'`);

describe("pickup time id ownership (audit F1)", () => {
  it("two connections racing to adopt one time id: exactly one wins, the other stays unknown/reserving", async () => {
    const { first, second } = await twoReservingOperations();
    const holder = `gxf1-${randomUUID()}`, racer = `gxf1-${randomUUID()}`;
    // The holder adopts the id inside an open transaction and keeps it open until the racer is blocked on the
    // unique index (a lock wait); only then does it commit. State-driven, not timed.
    const held = startPsql(holder, `begin; ${requeue(first.op, TIME_ID)};
      do $gate$ declare deadline timestamptz := clock_timestamp() + interval '12 seconds'; begin loop
        perform pg_stat_clear_snapshot();
        exit when exists (select 1 from pg_stat_activity a where a.application_name = '${racer}' and a.wait_event_type = 'Lock');
        if clock_timestamp() > deadline then raise exception 'racer_not_blocked'; end if;
        perform pg_sleep(0.05);
      end loop; end $gate$;
      commit;`);
    await until(`select 1 from pg_stat_activity where application_name = '${holder}' and wait_event = 'PgSleep'`, "holder gate");
    const raced = await startPsql(racer, requeue(second.op, TIME_ID));
    const winner = await held;
    expect(winner.code, winner.output).toBe(0);
    expect(raced.code).not.toBe(0);
    expect(raced.output).toMatch(/time_id_held/);
    expect(state(first.op)).toBe(`queued|PICKUP_RESERVED|reserved|${TIME_ID}`);
    expect(shipmentState(first.shipment)).toBe("queued");
    // The loser is untouched: unresolved, no id, shipment not queued.
    expect(state(second.op)).toBe("unknown|-|reserving|-");
    expect(shipmentState(second.shipment)).toBe("queued");
  }, 40000);

  it("a later adoption of an id that is already committed is refused too (not only a concurrent one)", async () => {
    const { first, second } = await twoReservingOperations();
    sql(requeue(first.op, TIME_ID));
    const late = await startPsql(`gxf1-${randomUUID()}`, requeue(second.op, TIME_ID));
    expect(late.code).not.toBe(0);
    expect(late.output).toMatch(/time_id_held/);
    expect(state(second.op)).toBe("unknown|-|reserving|-");
    // A different id is still free for the other operation.
    sql(requeue(second.op, "6b0c2a1e9d3f4a5b6c7d8eaa"));
    expect(state(second.op)).toBe("queued|PICKUP_RESERVED|reserved|6b0c2a1e9d3f4a5b6c7d8eaa");
  });

  it("recording a reservation answer is refused for a held id and leaves the operation in flight, reserving", async () => {
    const { first, second } = await twoReservingOperations();
    sql(requeue(first.op, TIME_ID));
    sql(`update public.provider_operations set state = 'in_flight' where id = '${second.op}'`);
    const lost = await startPsql(`gxf1-${randomUUID()}`, `select public.dispatch_pickup_record_reservation('${second.op}', 1, '${TIME_ID}')`);
    expect(lost.code).not.toBe(0);
    expect(lost.output).toMatch(/time_id_held/);
    expect(state(second.op)).toBe("in_flight|-|reserving|-");
  });

  it("the scope is the tenant and the provider environment: another tenant, or the other environment, may hold the same id", async () => {
    const { first, second } = await twoReservingOperations();
    sql(requeue(first.op, TIME_ID));
    sql(`update public.provider_operations set provider_env = 'production' where id = '${second.op}'`);
    sql(requeue(second.op, TIME_ID));
    expect(state(second.op)).toBe(`queued|PICKUP_RESERVED|reserved|${TIME_ID}`);
    const other = await realOperation();
    tenants.push(other.tenant);
    sql(`update public.provider_operations set state = 'unknown', attempts = 1, provider_env = 'sandbox', pickup_phase = 'reserving',
      dispatched_at = now() - interval '1 hour' where id = '${other.op}'`);
    sql(requeue(other.op, TIME_ID));
    expect(state(other.op)).toBe(`queued|PICKUP_RESERVED|reserved|${TIME_ID}`);
  });
});

describe("a NOT_CREATED reservation read-back is recoverable without a second reservation (audit F2)", () => {
  it("requeues from failed/NOT_CREATED with the id read back; refuses closed, rejected and creating operations", async () => {
    const { first, second } = await twoReservingOperations();
    sql(`update public.provider_operations set state = 'failed', result_code = 'NOT_CREATED' where id = '${first.op}'`);
    sql(requeue(first.op, TIME_ID));
    expect(state(first.op)).toBe(`queued|PICKUP_RESERVED|reserved|${TIME_ID}`);
    expect(shipmentState(first.shipment)).toBe("queued");

    for (const [code, phase] of [["CLOSED_NOT_CREATED", "reserving"], ["PICKUP_SLOT_UNAVAILABLE", "reserving"], ["NOT_CREATED", "creating"]] as const) {
      sql(`update public.provider_operations set state = 'failed', result_code = '${code}', pickup_phase = '${phase}',
        pickup_time_id = ${phase === "creating" ? "'6b0c2a1e9d3f4a5b6c7d8ebb'" : "null"} where id = '${second.op}'`);
      const refused = await startPsql(`gxf2-${randomUUID()}`, requeue(second.op, "6b0c2a1e9d3f4a5b6c7d8ecc"));
      expect(refused.code).not.toBe(0);
      expect(refused.output).toMatch(/stale_attempt/);
    }
  });
});
