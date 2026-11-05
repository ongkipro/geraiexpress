import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { DB_CONTAINER, DB_NAME, IDS, client, machine, realOperation, signIn, sql } from "./helpers";

const outlets: string[] = [];
async function shipment(outlet?: string) {
  const f = await realOperation({ tenant: IDS.tenantA, outlet, noCredential: true });
  const id = sql(`select outlet_id from public.shipments where id = '${f.shipment}'`);
  if (!outlet) outlets.push(id);
  sql(`update public.shipments set submission_state = 'issued', customer_charge_idr = 12000 where id = '${f.shipment}'`);
  return { shipment: f.shipment, outlet: id };
}
const paymentArgs = (id: string, method = "cash") => ({ p_shipment: id, p_method: method, p_amount_idr: 12000, p_received_idr: method === "cash" ? 20000 : null, p_difference_reason: null });
async function paid(outlet?: string, method = "cash", email = "operator-a@geraiexpress.test") {
  const f = await shipment(outlet);
  const member = await signIn(email);
  const result = await member.rpc("record_counter_payment", paymentArgs(f.shipment, method));
  expect(result.error).toBeNull();
  return { ...f, payment: result.data as string, period: sql(`select period_id from public.counter_payments where id = '${result.data}'`) };
}
afterAll(() => {
  if (!outlets.length) return;
  const ids = outlets.map((id) => `'${id}'`).join(",");
  sql(`update public.shipments set selected_quote_id = null where outlet_id in (${ids});
    delete from public.shipments where outlet_id in (${ids}); delete from public.outlets where id in (${ids})`);
});

describe("cash period close/reopen (T-083)", () => {
  it("counts only active cash, spans midnight, freezes variance and routes the next payment to a fresh period", async () => {
    const first = await paid();
    sql(`update public.cash_periods set opened_at = now() - interval '2 days' where id = '${first.period}'`);
    const cash = await paid(first.outlet, "cash", "owner-a@geraiexpress.test");
    const qris = await paid(first.outlet, "qris");
    const transfer = await paid(first.outlet, "transfer");
    const other = await paid(first.outlet, "other");
    const voided = await paid(first.outlet);
    expect([cash.period, qris.period, transfer.period, other.period, voided.period]).toEqual(Array(5).fill(first.period));
    const admin = await signIn("owner-a@geraiexpress.test");
    expect((await admin.rpc("void_counter_payment", { p_payment: voided.payment, p_reason: "Salah catat pembayaran" })).error).toBeNull();
    const operator = await signIn("operator-a@geraiexpress.test");
    expect((await operator.rpc("close_cash_period", { p_period: first.period, p_counted_idr: 23500 })).error).toBeNull();
    expect(sql(`select expected_cash_idr || '|' || counted_cash_idr || '|' || variance_idr || '|' || (closed_by is not null)::text
      from public.cash_periods where id = '${first.period}'`)).toBe("24000|23500|-500|true");
    expect((await admin.rpc("void_counter_payment", { p_payment: first.payment, p_reason: "Periode sudah ditutup" })).error).toMatchObject({ message: "period_closed", code: "55000" });
    expect((await operator.rpc("close_cash_period", { p_period: first.period, p_counted_idr: 24000 })).error?.message).toBe("period_closed");
    const next = await paid(first.outlet);
    expect(next.period).not.toBe(first.period);
    expect(sql(`select count(*) from public.counter_payments where period_id = '${first.period}'`)).toBe("6");
    // No caller may force a new payment into the old period through table writes.
    expect((await operator.from("counter_payments").insert({ tenant_id: IDS.tenantA, period_id: first.period })).error?.code).toBe("42501");
    expect((await admin.rpc("reopen_cash_period", { p_period: first.period, p_reason: "Perbaikan hitung kas" })).error).toMatchObject({ message: "period_open_exists", code: "55000" });
  });

  it("reopen is admin-only, requires a reason, audits and retains the earlier close; reclose appends history", async () => {
    const f = await paid();
    const admin = await signIn("owner-a@geraiexpress.test"), operator = await signIn("operator-a@geraiexpress.test");
    expect((await operator.rpc("close_cash_period", { p_period: f.period, p_counted_idr: 12500 })).error).toBeNull();
    expect((await operator.rpc("reopen_cash_period", { p_period: f.period, p_reason: "Hitung ulang" })).error?.message).toBe("admin_required");
    for (const reason of [null, " ", "abcd", "x".repeat(501)]) {
      expect((await admin.rpc("reopen_cash_period", { p_period: f.period, p_reason: reason })).error?.message).toBe("reason_required");
    }
    expect((await admin.rpc("reopen_cash_period", { p_period: f.period, p_reason: "Hitung ulang uang tunai" })).error).toBeNull();
    expect(sql(`select closed_at is null and closed_by is null and counted_cash_idr is null and expected_cash_idr is null and variance_idr is null
      from public.cash_periods where id = '${f.period}'`)).toBe("t");
    expect(sql(`select counted_cash_idr || '|' || expected_cash_idr || '|' || variance_idr from public.cash_period_events where period_id = '${f.period}' and kind = 'close'`)).toBe("12500|12000|500");
    expect(sql(`select count(*) from public.cash_period_events where period_id = '${f.period}'`)).toBe("2");
    expect(sql(`select reason from public.audit_events where action = 'cash_period.reopen' and detail->>'period' = '${f.period}'`)).toBe("Hitung ulang uang tunai");
    expect((await admin.rpc("close_cash_period", { p_period: f.period, p_counted_idr: 12000 })).error).toBeNull();
    expect(sql(`select count(*) from public.cash_period_events where period_id = '${f.period}'`)).toBe("3");
    expect(() => sql(`update public.cash_period_events set reason = 'Changed reason' where period_id = '${f.period}'`)).toThrow(/append_only/);
    expect(() => sql(`delete from public.cash_period_events where period_id = '${f.period}'`)).toThrow(/append_only/);
    expect(() => sql("truncate public.cash_period_events")).toThrow(/append_only/);
  });

  it("two concurrent closes commit exactly one event; rejects invalid counted values", async () => {
    const f = await paid(), member = await signIn("operator-a@geraiexpress.test");
    for (const count of [null, -1]) expect((await member.rpc("close_cash_period", { p_period: f.period, p_counted_idr: count })).error?.message).toBe("counted_cash_invalid");
    const results = await Promise.all([0, 12000].map((count) => member.rpc("close_cash_period", { p_period: f.period, p_counted_idr: count })));
    expect(results.filter((r) => !r.error)).toHaveLength(1);
    expect(results.find((r) => r.error)?.error).toMatchObject({ message: "period_closed", code: "55000" });
    expect(sql(`select count(*) from public.cash_period_events where period_id = '${f.period}'`)).toBe("1");
  });

  it("cross-tenant reads/writes and anonymous/machine commands are denied; events have no direct writes", async () => {
    const f = await paid(), other = await signIn("owner-b@geraiexpress.test"), admin = await signIn("owner-a@geraiexpress.test");
    expect((await admin.rpc("close_cash_period", { p_period: f.period, p_counted_idr: 12000 })).error).toBeNull();
    for (const [name, args] of [
      ["close_cash_period", { p_period: f.period, p_counted_idr: 0 }],
      ["reopen_cash_period", { p_period: f.period, p_reason: "Hitung ulang" }],
    ] as const) {
      expect((await other.rpc(name, args)).error?.code).toBe("P0002");
      for (const c of [client(), machine()]) expect((await c.rpc(name, args)).error?.code).toBe("42501");
    }
    expect((await other.from("cash_periods").select("id").eq("id", f.period)).data).toEqual([]);
    expect((await other.from("cash_period_events").select("id").eq("period_id", f.period)).data).toEqual([]);
    expect((await admin.from("cash_period_events").select("id").eq("period_id", f.period)).data).toHaveLength(1);
    expect(() => sql(`insert into public.cash_period_events(tenant_id, period_id, kind, reason, actor)
      select '${IDS.tenantB}', '${f.period}', 'reopen', 'Cross tenant event', actor from public.cash_period_events
      where period_id = '${f.period}' limit 1`)).toThrow(/foreign key/);
    for (const c of [client(), machine()]) {
      expect((await c.from("cash_period_events").select("id")).error?.code).toBe("42501");
      expect((await c.from("cash_period_events").insert({ tenant_id: IDS.tenantA, period_id: f.period, kind: "reopen" })).error?.code).toBe("42501");
    }
    expect((await admin.from("cash_period_events").insert({ tenant_id: IDS.tenantA, period_id: f.period, kind: "reopen" })).error?.code).toBe("42501");
    expect((await admin.from("cash_period_events").update({ reason: "Forged reason" }).eq("period_id", f.period)).error?.code).toBe("42501");
    expect((await admin.from("cash_period_events").delete().eq("period_id", f.period)).error?.code).toBe("42501");
  });

  it("a payment waiting on a concurrently closing period opens a fresh period, without a stale insert", async () => {
    const f = await paid(), next = await shipment(f.outlet), member = await signIn("operator-a@geraiexpress.test");
    const name = `cash-close-${randomUUID()}`;
    const ownerId = sql("select id from auth.users where email = 'owner-a@geraiexpress.test'");
    const statement = `set application_name = '${name}'; begin; set local statement_timeout = '12s';
      select set_config('request.jwt.claims', '{"sub":"${ownerId}","role":"authenticated"}', true);
      select id from public.cash_periods where id = '${f.period}' for update;
      do $gate$ declare deadline timestamptz := clock_timestamp() + interval '8 seconds'; begin loop
        perform pg_stat_clear_snapshot();
        exit when exists (select 1 from pg_stat_activity a where a.wait_event_type = 'Lock'
          and pg_backend_pid() = any(pg_blocking_pids(a.pid)) and a.query like '%record_counter_payment%');
        if clock_timestamp() > deadline then raise exception 'payment_did_not_wait'; end if;
        perform pg_sleep(0.05);
      end loop; end $gate$;
      select public.close_cash_period('${f.period}', 12000); commit;`;
    const child = spawn("docker", ["exec", DB_CONTAINER, "psql", "-U", "postgres", "-d", DB_NAME, "-v", "ON_ERROR_STOP=1", "-tA", "-c", statement], { stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (data) => { output += String(data); });
    child.stderr.on("data", (data) => { output += String(data); });
    const done = new Promise<number | null>((resolve, reject) => { child.on("error", reject); child.on("close", resolve); });
    try {
      const deadline = Date.now() + 8000;
      while (sql(`select exists (select 1 from pg_stat_activity where application_name = '${name}' and wait_event = 'PgSleep')`) !== "t") {
        if (Date.now() > deadline) throw new Error(`period holder not ready: ${output}`);
        await new Promise((resolve) => setTimeout(resolve, 30));
      }
      const recording = await member.rpc("record_counter_payment", paymentArgs(next.shipment));
      expect(await done, output).toBe(0);
      expect(recording.error).toBeNull();
      expect(sql(`select period_id from public.counter_payments where shipment_id = '${next.shipment}'`)).not.toBe(f.period);
      expect(sql(`select count(*) from public.counter_payments where period_id = '${f.period}'`)).toBe("1");
    } finally {
      sql(`select pg_terminate_backend(pid) from pg_stat_activity where application_name = '${name}'`);
      child.kill();
      await done;
    }
  }, 20000);
});
