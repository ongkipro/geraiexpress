// Wave B review fixes (migration 20261028210000): B1 the claim locks the authorizing admin's
// membership before the tenant row (no 40P01 against tenant-admin commands), B2 an attempt the
// Worker moved to "unknown" keeps the seller busy for two minutes, B3 the provider's paid count is
// compared with the orders that were unpaid at the claim.
import { type ChildProcess, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it as test } from "vitest";
import type { TestClient, TestIo } from "./helpers";
import { credentialAad, sealCredential } from "../../src/lib/credential-crypto";
import { DB_CONTAINER, DB_NAME, machine, realOperation, signIn } from "./helpers";

// Each test owns a durable container-side gate. A shared lock spans every admitted psql
// process (including startup); closing writes a tombstone, kills owned process groups and
// obtains the exclusive lock before deleting fixtures. A delayed docker exec can therefore
// never connect after successful teardown. Keep the tombstone until the container is destroyed.
const SESSION_BOUNDS = "-c statement_timeout=60s -c lock_timeout=60s -c idle_in_transaction_session_timeout=60s";
const ADMITTED_SQL = `
  dir=$1; op=$2; shift 2
  [ ! -e "$dir/closed" ] || exit 125
  timeout --signal=KILL 60s "$@" &
  pid=$!
  printf '%s' "$pid" > "$dir/$op.pid"
  wait "$pid"
  status=$?
  rm -f "$dir/$op.pid"
  exit "$status"
`;
const GATED_SQL = `
  # Older compose containers must be recreated; never orphan killed clients into postmaster PID 1.
  read -r pid1 < /proc/1/comm && [ -n "$pid1" ] && [ "$pid1" != postgres ] || {
    echo 'PostgreSQL test cleanup requires init: recreate the test container with init: true or docker run --init.' >&2
    exit 126
  }
  dir=$1; op=$2; shift 2
  mkdir -p "$dir" || exit
  exec flock -s "$dir/gate" sh -c ${shellQuote(ADMITTED_SQL)} gxt-admitted "$dir" "$op" "$@"
`;
function shellQuote(value: string): string { return "'" + value.replace(/'/g, "'\\''") + "'"; }

type SqlResult = { code: number | null; output: string; stdout: string; stderr: string };
type Session = { name: string; child: ChildProcess; done: Promise<SqlResult>; closed: Promise<SqlResult> };

function untilDeadline<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  let onAbort: () => void;
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
  });
  return Promise.race([pending, aborted]).finally(() => signal.removeEventListener("abort", onAbort));
}

// Only the host CLI is killed by AbortSignal. The gate and process-group records, not host
// closure, establish container ownership. In particular, never remove a session on 'close'.
function docker(args: string[], signal: AbortSignal): Omit<Session, "name"> {
  signal.throwIfAborted();
  const child = spawn("docker", args, { signal, killSignal: "SIGKILL", stdio: ["ignore", "pipe", "pipe"] });
  let output = "", stdout = "", stderr = "";
  child.stdout?.on("data", (v) => { output += v; stdout += v; });
  child.stderr?.on("data", (v) => { output += v; stderr += v; });
  const closed = new Promise<SqlResult>((resolve) => {
    child.on("error", (e) => { output += `spawn: ${e.message}`; stderr += `spawn: ${e.message}`; });
    child.on("close", (code) => resolve({ code, output, stdout, stderr }));
  });
  const done = untilDeadline(closed, signal).catch((error: unknown) => ({
    code: null, output: `${output}\n${String(error)}`, stdout, stderr: `${stderr}\n${String(error)}`,
  }));
  return { child, done, closed };
}

class TestOwner {
  private readonly id = `gxt-${randomUUID()}`;
  private readonly dir = `/tmp/${this.id}`;
  private readonly controller = new AbortController();
  readonly signal: AbortSignal;
  readonly tenants = new Set<string>();
  private readonly sessions = new Set<Session>();
  readonly io: TestIo;

  constructor(signal: AbortSignal) {
    this.signal = AbortSignal.any([signal, this.controller.signal]);
    this.io = { sql: (statement) => this.sql(statement), signal: this.signal };
  }

  machine() { this.signal.throwIfAborted(); return machine(this.signal); }
  signIn(email: string) { return signIn(email, this.io); }

  startPsql(statement: string): Session {
    this.signal.throwIfAborted();
    const name = `gxt-${randomUUID()}`;
    const session = { name, ...docker([
      "exec", "-e", `PGAPPNAME=${name}`, "-e", `PGOPTIONS=${SESSION_BOUNDS}`,
      "-e", `GX_TEST_SQL_OWNER=${this.id}`, DB_CONTAINER,
      "sh", "-c", GATED_SQL, "gxt-gate", this.dir, name,
      "psql", "-U", "postgres", "-d", DB_NAME, "-tA", "-v", "ON_ERROR_STOP=1", "-c", statement,
    ], AbortSignal.any([this.signal, AbortSignal.timeout(60000)])) };
    this.sessions.add(session);
    return session;
  }

  async sql(statement: string): Promise<string> {
    const result = await this.startPsql(statement).done;
    this.signal.throwIfAborted();
    if (result.code !== 0) throw new Error(`psql (${result.code}): ${result.output}`);
    return result.stdout.trim();
  }

  async cleanup(tenant: string): Promise<void> {
    // afterEach owns cancellation cleanup. A late callback must not start an independent delete.
    if (this.signal.aborted) return;
    await this.sql(tenantDelete(tenant));
    this.tenants.delete(tenant);
  }

  async dispose(): Promise<void> {
    this.controller.abort(); // also closes the normal-success path to late callback work
    const names = [...this.sessions].map((s) => `'${s.name}'`).join(", ") || "NULL";
    const terminate = `select pg_terminate_backend(pid) from pg_stat_activity where application_name in (${names})`;
    const cleanupSql = `${terminate}; ${[...this.tenants].map(tenantDelete).join("; ")}`;
    // This independent budget fits inside the existing default hook budget. Failure to acquire
    // the exclusive gate or finish SQL is a teardown failure, never evidence of a clean owner.
    const close = `
      dir=$1; shift
      mkdir -p "$dir" || exit
      : > "$dir/closed" || exit
      psql -U postgres -d ${shellQuote(DB_NAME)} -tA -v ON_ERROR_STOP=1 -c ${shellQuote(terminate)} || exit
      while :; do
        for record in "$dir"/*.pid; do
          [ -f "$record" ] || continue
          pid=$(cat "$record" 2>/dev/null) || continue
          case "$pid" in ''|*[!0-9]*) continue;; esac
          if [ -r "/proc/$pid/environ" ] && tr '\\000' '\\n' < "/proc/$pid/environ" | grep -Fxq ${shellQuote(`GX_TEST_SQL_OWNER=${this.id}`)}; then
            kill -KILL "-$pid" 2>/dev/null || true
          fi
        done
        flock -xn "$dir/gate" true && break
        sleep 0.05
      done
      exec psql -U postgres -d ${shellQuote(DB_NAME)} -tA -v ON_ERROR_STOP=1 -c ${shellQuote(cleanupSql)}
    `;
    const deadline = AbortSignal.timeout(8000);
    const closing = docker([
      "exec", "-e", `PGAPPNAME=${this.id}-cleanup`,
      "-e", "PGOPTIONS=-c statement_timeout=6s -c lock_timeout=6s -c idle_in_transaction_session_timeout=6s",
      DB_CONTAINER, "timeout", "--signal=KILL", "7s", "sh", "-c", close, "gxt-close", this.dir,
    ], deadline);
    // Prove host closure too, without waiting beyond the same independent cleanup deadline.
    const [result] = await untilDeadline(Promise.all([
      closing.closed, ...[...this.sessions].map((s) => s.closed),
    ]), deadline);
    if (result.code !== 0) throw new Error(`owner cleanup (${result.code}): ${result.output}`);
    this.sessions.clear();
    this.tenants.clear();
  }
}

function tenantDelete(tenant: string): string {
  return `update public.shipments set selected_quote_id = null where tenant_id = '${tenant}';
    delete from public.shipments where tenant_id = '${tenant}';
    delete from public.tenants where id = '${tenant}';`;
}

const owners = new Map<object, TestOwner>();
const it = test.extend<{ owner: TestOwner }>({
  owner: async ({ task, signal }, use) => {
    const owner = new TestOwner(signal);
    owners.set(task, owner); // fixture ownership is registered before setup starts
    await use(owner);
  },
});
afterEach(async ({ task }) => {
  const owner = owners.get(task);
  await owner?.dispose();
  owners.delete(task);
});

const SEAL_KEY = Buffer.alloc(32, 9).toString("base64");
const SELLER_KEY = "API-UNITTESTKEY0002";
const OBJECT_ID = "6acf476a6b00a9b494ff04b9";
const OWNER_A_ID = "00000000-0000-4000-a000-0000000000a1";

type Member = { shipment: string; op: string; order: string };
type Batch = { tenant: string; code: string; members: Member[]; digest: string };

// A tenant of its own (owner-a is its admin) with an unpaid batch of real orders at Mengantar.
async function batchFixture(life: TestOwner, count = 2): Promise<Batch> {
  life.signal.throwIfAborted();
  const tenant = randomUUID();
  life.tenants.add(tenant); // before any row exists: afterEach removes it even if this fixture fails halfway
  const outlet = randomUUID();
  const suffix = randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase();
  const code = `2610T0FX${suffix}`;
  const sealed = await sealCredential(SELLER_KEY, credentialAad(tenant, 1), SEAL_KEY);
  life.signal.throwIfAborted();
  const members: Member[] = Array.from({ length: count }, (_, i) => ({ shipment: randomUUID(), op: randomUUID(), order: `T0FX${suffix}${i}` }));
  const rows = members.map((m, i) => {
    const quote = randomUUID();
    const charge = 18000 + i * 9000;
    return `
      insert into public.shipments (id, tenant_id, outlet_id, reference, submission_state, payment_state, is_simulated,
        sender_name, sender_phone, recipient_name, recipient_phone, recipient_address, recipient_area, recipient_area_id,
        recipient_postal_code, weight_grams, item_description, goods_value_idr, customer_charge_idr, pickup_snapshot, submitted_at, created_by)
      values ('${m.shipment}', '${tenant}', '${outlet}', 'GX261028-${suffix.slice(0, 5)}${i}', 'awaiting_payment', 'unpaid', false,
        'Pengirim', '081234567890', 'Penerima', '081298765432', 'Jl. Tujuan No. 1', 'KEBAYORAN BARU', '5fc63169f8f44b34aa4c2ee1',
        '12110', 1000, 'Buku', 50000, ${charge}, '{"outlet":"Utama"}'::jsonb, now(), '${OWNER_A_ID}');
      insert into public.shipment_quotes (id, tenant_id, shipment_id, shipment_revision, courier, service, normal_tariff_idr, eta_days, is_simulated, expires_at)
      values ('${quote}', '${tenant}', '${m.shipment}', 1, 'JT', 'REG', ${charge}, '1-2', false, now() + interval '1 hour');
      update public.shipments set selected_quote_id = '${quote}' where id = '${m.shipment}';
      insert into public.provider_operations (id, tenant_id, shipment_id, kind, idempotency_key, input_digest, state, is_simulated, attempts,
        provider_env, credential_version, dispatched_at, provider_order_id, provider_batch, provider_batch_id, result_code, provider_price_idr, actor)
      values ('${m.op}', '${tenant}', '${m.shipment}', 'create_order', 'k-${m.op}', 'd-${m.op}', 'succeeded', false, 1,
        'sandbox', 1, now() - interval '10 minutes', '${m.order}', '${code}', '${OBJECT_ID}', 'UNPAID', ${charge}, '${OWNER_A_ID}');`;
  });
  await life.sql(`
    insert into public.tenants (id, name, lifecycle, is_demo) values ('${tenant}', 'Gerai Batch Fix', 'active', false);
    insert into private.seller_credentials (tenant_id, mode, ciphertext, iv, key_version, hint, version)
      values ('${tenant}', 'byok', '${sealed.ciphertext}', '${sealed.iv}', '${sealed.keyVersion}', 'Y02', 1);
    insert into public.outlets (tenant_id, id, name, mengantar_pickup_address_id, mengantar_area_id)
      values ('${tenant}', '${outlet}', 'Outlet B', '6acf44a4771fe2b474c055ca', '5fc62f60f8f44b34aa4c0dcd');
    insert into public.memberships (tenant_id, user_id, role) values ('${tenant}', '${OWNER_A_ID}', 'tenant_admin');
    ${rows.join("\n")}`);
  const f: Batch = { tenant, code, members, digest: "" };
  f.digest = await review(life, f);
  return f;
}

async function review(life: TestOwner, f: Batch): Promise<string> {
  const owner = await life.signIn("owner-a@geraiexpress.test");
  const res = await owner.rpc("review_unpaid_batch", { p_shipment: f.members[0].shipment });
  expect(res.error).toBeNull();
  return res.data.batch_digest;
}

const authorize = (c: TestClient, f: Batch) =>
  c.rpc("authorize_batch_payment", { p_shipment: f.members[0].shipment, p_batch_digest: f.digest });
const claim = (life: TestOwner, f: Batch) =>
  life.machine().rpc("dispatch_begin_batch_payment", { p_shipment: f.members[0].shipment, p_batch_digest: f.digest, p_env: "sandbox" });
const cleanup = (life: TestOwner, f: Batch) => life.cleanup(f.tenant);
const auditOutcomes = (life: TestOwner, f: Batch) => life.sql(`select coalesce(string_agg(outcome, ',' order by id), '') from public.audit_events where target_tenant = '${f.tenant}' and action = 'shipment.batch_pay'`);

describe("claim lock order against tenant-admin commands (B1, DIL-14)", () => {
  it("a tenant-admin command that holds the memberships and then wants the tenant row never deadlocks with a claim", async ({ owner: life }) => {
    // Two sessions in the order every tenant-admin command uses (memberships FOR UPDATE, then the
    // tenant row FOR UPDATE), the second one started while the claim runs. The inverted claim took the
    // tenant row first and waited for the membership: PostgreSQL then aborted one side with 40P01.
    const f = await batchFixture(life);
    try {
      const owner = await life.signIn("owner-a@geraiexpress.test");
      expect((await authorize(owner, f)).error).toBeNull();
      const admin = life.startPsql(
        `select 1 from public.memberships where tenant_id = '${f.tenant}' for update;
         select pg_sleep(4);
         select 1 from public.tenants where id = '${f.tenant}' for update;`);
      await new Promise((resolve) => setTimeout(resolve, 1200));
      const res = await claim(life, f);
      const exited = await admin.done;
      expect(exited.code).toBe(0);
      expect(exited.stderr).toBe("");
      expect(res.error).toBeNull();
      expect(res.data).toMatchObject({ mode: "pay" });
    } finally {
      await cleanup(life, f);
    }
  }, 60000);

  it("a claim racing set_tenant_contact_whatsapp never deadlocks (40P01)", async ({ owner: life }) => {
    const f = await batchFixture(life);
    try {
      const owner = await life.signIn("owner-a@geraiexpress.test");
      const unexpected: string[] = [];
      let claimed = 0;
      for (let round = 0; round < 25; round++) {
        expect((await authorize(owner, f)).error).toBeNull();
        const racers = [
          claim(life, f),
          ...Array.from({ length: 8 }, (_, i) =>
            owner.rpc("set_tenant_contact_whatsapp", { p_tenant: f.tenant, p_value: `08123456${String(round * 8 + i).padStart(4, "0")}` })),
        ];
        const [got, ...commands] = await Promise.all(racers);
        for (const r of commands) if (r.error) unexpected.push(`whatsapp ${r.error.code}:${r.error.message}`);
        // A retryable busy answer is allowed; a deadlock or any other error is not.
        if (got.error && got.error.code !== "55P03") unexpected.push(`claim ${got.error.code}:${got.error.message}`);
        if (got.data?.attempt_id) {
          claimed++;
          await life.machine().rpc("dispatch_release_batch_payment", { p_attempt: got.data.attempt_id });
        }
      }
      expect(unexpected).toEqual([]);
      expect(claimed).toBeGreaterThan(0);
    } finally {
      await cleanup(life, f);
    }
  }, 120000);
});

describe("an unknown payment keeps the seller busy (B2)", () => {
  it("dispatch_claim is refused after sent -> unknown within two minutes, and freed after", async ({ owner: life }) => {
    const f = await batchFixture(life);
    try {
      const owner = await life.signIn("owner-a@geraiexpress.test");
      const m = life.machine();
      const other = await realOperation({ tenant: f.tenant }, life.io);
      expect((await authorize(owner, f)).error).toBeNull();
      const attempt: string = (await claim(life, f)).data.attempt_id;
      expect((await m.rpc("dispatch_mark_batch_payment_sent", { p_attempt: attempt, p_batch_object_id: OBJECT_ID })).data).toMatchObject({ state: "sent" });
      expect((await m.rpc("dispatch_finish_batch_payment", { p_attempt: attempt, p_outcome: "unknown" })).data).toMatchObject({ state: "unknown" });

      // The state is unknown now, the request left seconds ago: still on the wire.
      expect(await life.sql(`select state from private.batch_payment_attempts where id = '${attempt}'`)).toBe("unknown");
      expect(await life.sql(`select private.payment_busy('${f.tenant}')`)).toBe("t");
      expect((await m.rpc("dispatch_claim", { p_operation: other.op, p_env: "sandbox" })).error?.message).toBe("account_busy");

      // Two minutes after the request the seller is free again (the attempt itself keeps blocking
      // a second payment of the same batch).
      await life.sql(`update private.batch_payment_attempts set sent_at = now() - interval '3 minutes' where id = '${attempt}'`);
      expect(await life.sql(`select private.payment_busy('${f.tenant}')`)).toBe("f");
      expect((await m.rpc("dispatch_claim", { p_operation: other.op, p_env: "sandbox" })).error).toBeNull();
    } finally {
      await cleanup(life, f);
    }
  });
});

describe("the provider's paid count is checked at finish (B3)", () => {
  

  // Claimed with one member already paid (one unpaid order), sent, and every member paid in the
  // database without the per-order settle, so only dispatch_finish decides.
  async function sentAttempt(life: TestOwner) {
    const f = await batchFixture(life, 2);
    await life.sql(`update public.shipments set payment_state = 'paid', submission_state = 'issued', awb = 'JOFXPAID0001' where id = '${f.members[1].shipment}'`);
    f.digest = await review(life, f);
    const owner = await life.signIn("owner-a@geraiexpress.test");
    expect((await authorize(owner, f)).error).toBeNull();
    const attempt: string = (await claim(life, f)).data.attempt_id;
    expect((await life.machine().rpc("dispatch_mark_batch_payment_sent", { p_attempt: attempt, p_batch_object_id: OBJECT_ID })).error).toBeNull();
    return { f, attempt };
  }
  const payRemaining = (life: TestOwner, f: Batch) =>
    life.sql(`update public.shipments set payment_state = 'paid', submission_state = 'issued', awb = 'JOFXPAID0000' where id = '${f.members[0].shipment}'`);
  const events = (life: TestOwner, f: Batch) => life.sql(`select count(*) from public.shipment_events where tenant_id = '${f.tenant}' and kind = 'payment_count_mismatch'`);
  const mismatches = (life: TestOwner, f: Batch) => life.sql(`select count(*) from public.audit_events where target_tenant = '${f.tenant}' and action = 'shipment.batch_pay' and outcome = 'count_mismatch'`);

  it("exactly one finish overload exists and an old-style call still works", async ({ owner: life }) => {
    expect(await life.sql("select count(*) from pg_proc where proname = 'dispatch_finish_batch_payment' and pronamespace = 'public'::regnamespace")).toBe("1");
    const { f, attempt } = await sentAttempt(life);
    try {
      await payRemaining(life, f);
      const res = await life.machine().rpc("dispatch_finish_batch_payment", { p_attempt: attempt, p_outcome: "paid" });
      expect(res.error).toBeNull();
      expect(res.data).toMatchObject({ state: "paid", replayed: false, count_mismatch: false });
      expect(await mismatches(life, f)).toBe("0");
    } finally {
      await cleanup(life, f);
    }
  });

  it("the claim records how many orders were unpaid", async ({ owner: life }) => {
    const { f, attempt } = await sentAttempt(life);
    try {
      expect(await life.sql(`select unpaid_count from private.batch_payment_attempts where id = '${attempt}'`)).toBe("1");
    } finally {
      await cleanup(life, f);
    }
  });

  it("a matching count writes no mismatch", async ({ owner: life }) => {
    const { f, attempt } = await sentAttempt(life);
    try {
      await payRemaining(life, f);
      const res = await life.machine().rpc("dispatch_finish_batch_payment", { p_attempt: attempt, p_outcome: "paid", p_paid_count: 1 });
      expect(res.data).toMatchObject({ state: "paid", count_mismatch: false });
      expect(await mismatches(life, f)).toBe("0");
      expect(await events(life, f)).toBe("0");
    } finally {
      await cleanup(life, f);
    }
  });

  it("a different count writes a count_mismatch audit row and a shipment event, and the outcome still stands", async ({ owner: life }) => {
    const { f, attempt } = await sentAttempt(life);
    try {
      await payRemaining(life, f);
      const res = await life.machine().rpc("dispatch_finish_batch_payment", { p_attempt: attempt, p_outcome: "paid", p_paid_count: 2 });
      expect(res.error).toBeNull();
      expect(res.data).toMatchObject({ state: "paid", replayed: false, count_mismatch: true });
      expect(await auditOutcomes(life, f)).toContain("count_mismatch");
      expect(await mismatches(life, f)).toBe("1");
      expect(await life.sql(`select detail->>'unpaid_count' || '/' || (detail->>'provider_paid_count') from public.audit_events
        where target_tenant = '${f.tenant}' and outcome = 'count_mismatch'`)).toBe("1/2");
      expect(await events(life, f)).toBe("1");
      // A replay of the finished attempt writes nothing more.
      await life.machine().rpc("dispatch_finish_batch_payment", { p_attempt: attempt, p_outcome: "paid", p_paid_count: 2 });
      expect(await mismatches(life, f)).toBe("1");
      expect(await events(life, f)).toBe("1");
    } finally {
      await cleanup(life, f);
    }
  });

  it("rejects a negative count and ignores the count for a definite refusal", async ({ owner: life }) => {
    const { f, attempt } = await sentAttempt(life);
    try {
      const m = life.machine();
      expect((await m.rpc("dispatch_finish_batch_payment", { p_attempt: attempt, p_outcome: "paid", p_paid_count: -1 })).error?.message).toBe("invalid_count");
      expect((await m.rpc("dispatch_finish_batch_payment", { p_attempt: attempt, p_outcome: "rejected", p_paid_count: 0 })).data).toMatchObject({ state: "rejected", count_mismatch: false });
      expect(await mismatches(life, f)).toBe("0");
    } finally {
      await cleanup(life, f);
    }
  });
});


const psql = (life: TestOwner, statement: string) => life.startPsql(statement).done;
const asOwner = `set local request.jwt.claims = '{"sub":"${OWNER_A_ID}","role":"authenticated","aal":"aal1"}';`;

it("T-054 authorization takes the batch's operation locks first: it waits for a holder of the lowest member", async ({ owner: life }) => {
  // compute_unpaid_batch(.., false), the former authorization, read the batch without locks and
  // finished while another session held it, so its order against the claim was never fixed.
  const f = await batchFixture(life, 3);
  try {
    const holder = psql(life, `begin; select id from public.provider_operations where tenant_id = '${f.tenant}' and provider_batch = '${f.code}'
        order by id limit 1 for update;
      select pg_sleep(1.5); select 'released:' || extract(epoch from clock_timestamp()); commit;`);
    await new Promise((r) => setTimeout(r, 400));
    const authorizing = psql(life, `begin; set local statement_timeout = '8s'; ${asOwner}
      select public.authorize_batch_payment('${f.members[0].shipment}', '${f.digest}');
      select 'authorized:' || extract(epoch from clock_timestamp()); commit;`);
    const [held, auth] = await Promise.all([holder, authorizing]);
    expect(held.code, held.output).toBe(0);
    expect(auth.code, auth.output).toBe(0);
    const at = (out: string, tag: string) => Number(out.split("\n").find((l) => l.startsWith(tag))?.slice(tag.length));
    expect(at(auth.output, "authorized:")).toBeGreaterThanOrEqual(at(held.output, "released:"));
  } finally { await cleanup(life, f); }
}, 15000);

it("T-054 concurrent authorization and machine claim of one batch never deadlock (5 rounds)", async ({ owner: life }) => {
  for (let round = 0; round < 5; round++) {
    const f = await batchFixture(life, 3);
    try {
      expect((await authorize(await life.signIn("owner-a@geraiexpress.test"), f)).error).toBeNull();
      const claiming = psql(life, `begin; set local statement_timeout = '8s';
        select (public.dispatch_begin_batch_payment(null, '${f.members[0].shipment}', '${f.digest}', 'sandbox'))->>'mode';
        select pg_sleep(0.5); commit;`);
      const authorizing = psql(life, `begin; set local statement_timeout = '8s'; ${asOwner}
        select public.authorize_batch_payment('${f.members[0].shipment}', '${f.digest}'); commit;`);
      for (const result of await Promise.all([claiming, authorizing])) {
        expect(result.output).not.toMatch(/40P01|deadlock detected/);
        expect(result.code, result.output).toBe(0);
      }
    } finally { await cleanup(life, f); }
  }
}, 60000);

describe("admin close of an unknown batch payment (T-056)", () => {
  it("closes only an unknown (or long-sent) attempt with a reason and per-order reads, frees the batch, refuses others; a replay is a no-op", async ({ owner: life }) => {
    const f = await batchFixture(life);
    try {
      const owner = await life.signIn("owner-a@geraiexpress.test");
      let attempt = randomUUID();
      const close = (c: TestClient = owner, reason = "Dicek di aplikasi Mengantar: belum terbayar", id = attempt) =>
        c.rpc("close_unknown_batch_payment", { p_shipment: f.members[0].shipment, p_attempt: id, p_reason: reason });
      expect((await close()).error?.message).toBe("not_closable");

      expect((await authorize(owner, f)).error).toBeNull();
      attempt = (await claim(life, f)).data.attempt_id;
      expect((await owner.rpc("review_unpaid_batch", { p_shipment: f.members[0].shipment })).data)
        .toMatchObject({ payment_attempt_id: attempt, payment_attempt_state: "claimed", payment_attempt_sent_at: null });
      // A live claim is the dispatcher's to release.
      expect((await close()).error?.message).toBe("not_closable");
      expect((await life.machine().rpc("dispatch_mark_batch_payment_sent", { p_attempt: attempt, p_batch_object_id: OBJECT_ID })).error).toBeNull();
      // The page hides the close command until the 30-minute window from sent_at has passed.
      const sentAt = ((await owner.rpc("review_unpaid_batch", { p_shipment: f.members[0].shipment })).data as { payment_attempt_sent_at: string | null }).payment_attempt_sent_at;
      expect(sentAt).not.toBeNull();
      expect(Math.abs(Date.parse(sentAt!) - Date.parse(await life.sql(`select to_json(sent_at)#>>'{}' from private.batch_payment_attempts where id = '${attempt}'`)))).toBe(0);
      // A fresh 'sent' may still be answered.
      expect((await close()).error?.message).toBe("not_closable");
      expect((await life.machine().rpc("dispatch_finish_batch_payment", { p_attempt: attempt, p_outcome: "unknown" })).error).toBeNull();
      const state = () => life.sql(`select state from private.batch_payment_attempts where id = '${attempt}'`);
      expect(await state()).toBe("unknown");

      // Operators, other tenants' admins and a missing reason are refused; nothing changes.
      const operatorId = await life.sql(`select id from auth.users where email = 'operator-a@geraiexpress.test'`);
      await life.sql(`insert into public.memberships (tenant_id, user_id, role) values ('${f.tenant}', '${operatorId}', 'operator') on conflict do nothing`);
      expect((await close(await life.signIn("operator-a@geraiexpress.test"))).error?.message).toBe("admin_required");
      expect((await close(await life.signIn("owner-b@geraiexpress.test"))).error).not.toBeNull();
      expect((await close(owner, "")).error?.message).toBe("reason_required");
      // An old form naming another attempt never closes this one.
      expect((await close(owner, undefined, randomUUID())).error?.message).toBe("stale_attempt");
      expect(await state()).toBe("unknown");
      // While unknown the batch cannot be authorized again.
      expect((await authorize(owner, f)).data).toMatchObject({ authorized: false, reason: "payment_unresolved" });
      // A timeout turns 'sent' into 'unknown' at once, while the request may still land at Mengantar:
      // a fresh unknown waits 30 minutes from the send like a fresh 'sent' (third review M1).
      expect((await close()).error?.message).toBe("not_closable");
      expect(await state()).toBe("unknown");
      await life.sql(`update private.batch_payment_attempts set sent_at = now() - interval '29 minutes' where id = '${attempt}'`);
      expect((await close()).error?.message).toBe("not_closable");
      await life.sql(`update private.batch_payment_attempts set sent_at = now() - interval '31 minutes' where id = '${attempt}'`);

      const closed = await close();
      expect(closed.error).toBeNull();
      expect(closed.data).toMatchObject({ closed: true, attempt_id: attempt, previous: "unknown" });
      expect((closed.data as { members: unknown[] }).members).toHaveLength(2);
      expect(await life.sql(`select state || '|' || close_reason || '|' || (closed_by = '${OWNER_A_ID}')::text from private.batch_payment_attempts where id = '${attempt}'`))
        .toBe("closed|Dicek di aplikasi Mengantar: belum terbayar|true");
      expect(await life.sql(`select count(*) || '|' || max(detail->>'previous') || '|' || max(jsonb_array_length(detail->'members'))
        from public.audit_events where target_tenant = '${f.tenant}' and action = 'shipment.batch_pay' and outcome = 'closed_by_admin'`)).toBe("1|unknown|2");
      // A replay changes nothing; the batch can be authorized again (no provider request was made).
      expect((await close()).data).toMatchObject({ closed: false, reason: "already_closed" });
      expect((await authorize(owner, f)).data).toMatchObject({ authorized: true });
    } finally { await cleanup(life, f); }
  });
});

describe("environment-bound batch claim (T-057 second review)", () => {
  it("a claim from the other environment is refused and leaves no attempt, no consumed authorization and no audit", async ({ owner: life }) => {
    const f = await batchFixture(life);
    try {
      const owner = await life.signIn("owner-a@geraiexpress.test");
      expect((await authorize(owner, f)).error).toBeNull();
      const audits = () => life.sql(`select count(*) from public.audit_events where target_tenant = '${f.tenant}' and action = 'shipment.batch_pay'`);
      const before = await audits();
      const crossed = await life.machine().rpc("dispatch_begin_batch_payment", { p_shipment: f.members[0].shipment, p_batch_digest: f.digest, p_env: "production" });
      expect([crossed.data, crossed.error?.message]).toEqual([null, "provider_env_mismatch"]);
      expect(await life.sql(`select count(*) from private.batch_payment_attempts where tenant_id = '${f.tenant}'`)).toBe("0");
      expect(await life.sql(`select count(*) from private.batch_payment_authorizations where tenant_id = '${f.tenant}' and consumed_at is not null`)).toBe("0");
      expect(await audits()).toBe(before);
      expect((await life.machine().rpc("dispatch_begin_batch_payment", { p_shipment: f.members[0].shipment, p_batch_digest: f.digest })).error?.message).toBe("invalid_environment");
      expect((await claim(life, f)).data).toMatchObject({ mode: "pay", provider_env: "sandbox" });
    } finally { await cleanup(life, f); }
  });
});
