// T-110 / NFR-5 / RATE-1: the Partner-wide quota is durable and shared by every caller (all tenants,
// all replicas): concurrent connections cannot exceed the minute limit, the new-seller budget resets at
// WIB midnight, and a recorded Retry-After makes every caller wait.
// T-110 / DR-1 / TD-3: the post-restore provider mutation fence. A restore is simulated by changing the
// recorded cluster identity (what a new cluster, database, recreated table or new timeline produces).
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DB_CONTAINER, DB_NAME, machine, realOperation, signIn, signInAal2, sql } from "./helpers";

const execFileAsync = promisify(execFile);

type Reservation = { allowed: boolean; reason: string | null; next_eligible_at: string | null };

const partner = () => `t110-${randomUUID().slice(0, 8)}`;
let limits = "";

beforeEach(() => {
  limits = sql(`select requests_per_minute || ',' || new_sellers_per_day from private.partner_quota_limits where provider_env = 'sandbox'`);
});
afterEach(() => {
  const [minute, day] = limits.split(",");
  sql(`update private.partner_quota_limits set requests_per_minute = ${minute}, new_sellers_per_day = ${day} where provider_env = 'sandbox'`);
});

async function reserve(p: string, extra: Record<string, unknown> = {}): Promise<Reservation> {
  const { data, error } = await machine().rpc("reserve_partner_quota", { p_env: "sandbox", p_partner: p, ...extra });
  if (error) throw new Error(error.message);
  return data as Reservation;
}

describe("Partner-wide quota (T-110 item A)", () => {
  it("is machine-only: an operator session cannot reserve or record a back-off", async () => {
    const owner = await signIn("owner-a@geraiexpress.test");
    expect((await owner.rpc("reserve_partner_quota", { p_env: "sandbox", p_partner: partner() })).error).not.toBeNull();
    expect((await owner.rpc("note_partner_retry_after", { p_env: "sandbox", p_partner: partner() })).error).not.toBeNull();
  });

  it("concurrent connections never exceed the minute limit; a denial consumes nothing", async () => {
    sql(`update private.partner_quota_limits set requests_per_minute = 5 where provider_env = 'sandbox'`);
    const p = partner();
    // Separate clients => separate PostgREST requests on separate pooled connections, all at once.
    const results = await Promise.all(Array.from({ length: 16 }, () => reserve(p)));
    const allowed = results.filter((r) => r.allowed).length;
    const used = JSON.parse(sql(`select coalesce(json_agg(used), '[]') from private.partner_request_windows
      where partner_key = encode(sha256(convert_to('${p}', 'UTF8')), 'hex')`)) as number[];
    // A minute boundary may split the burst over two windows; no window exceeds the limit either way.
    expect(used.every((u) => u <= 5)).toBe(true);
    expect(used.reduce((a, b) => a + b, 0)).toBe(allowed);
    expect(allowed).toBeGreaterThanOrEqual(5);
    expect(allowed).toBeLessThanOrEqual(10);
    const denied = results.find((r) => !r.allowed);
    expect(denied).toMatchObject({ allowed: false, reason: "minute_limit" });
    expect(Date.parse(denied!.next_eligible_at!)).toBeGreaterThan(Date.now() - 60_000);
  });

  it("charges the window the caller runs in after waiting for the lock, not the one it started waiting in", async () => {
    // Review of T-110: the minute is read AFTER the advisory lock. Another connection holds the partner's lock
    // across the next minute boundary; a reservation that started waiting before the boundary must be charged
    // to the minute after it. (Reading the clock before the lock charged it to the earlier minute.)
    const p = partner();
    const key = `encode(sha256(convert_to('${p}', 'UTF8')), 'hex')`;
    const lock = `hashtextextended('partner_quota:sandbox:' || ${key}, 0)`;
    // Start ~4 s before a boundary and hold the lock until 1 s past it: the wait (~5 s at most) crosses the
    // boundary yet stays under service_role's 10 s lock_timeout (T-109), which would otherwise cancel the
    // waiting reservation (that cancellation is intended: the caller then fails closed).
    const msToNextMinute = 60_000 - (Date.now() % 60_000);
    if (msToNextMinute < 3_000 || msToNextMinute > 6_000) await new Promise((r) => setTimeout(r, (msToNextMinute + 60_000 - 4_500) % 60_000));
    const holder = execFileAsync("docker", ["exec", DB_CONTAINER, "psql", "-U", "postgres", "-d", DB_NAME, "-tA", "-v", "ON_ERROR_STOP=1", "-c",
      `begin; select pg_advisory_xact_lock(${lock}); select pg_sleep(61 - extract(second from clock_timestamp())); commit;`]);
    // Wait until the holder actually owns the lock.
    for (let i = 0; i < 50 && sql(`select count(*) from pg_locks where locktype = 'advisory' and granted and objid = (${lock} & 4294967295)::oid`) === "0"; i++) {
      await new Promise((r) => setTimeout(r, 100));
    }
    const startedMinute = Math.floor(Date.now() / 60_000) * 60_000;
    const result = await reserve(p);
    await holder;
    expect(result.allowed).toBe(true);
    const charged = Date.parse(sql(`select to_char(window_start at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') from private.partner_request_windows where partner_key = ${key}`));
    expect(charged).toBe(startedMinute + 60_000);
  }, 120_000);

  it("counts one new seller once per WIB day and resets at WIB midnight", async () => {
    sql(`update private.partner_quota_limits set new_sellers_per_day = 2, requests_per_minute = 100 where provider_env = 'sandbox'`);
    const p = partner();
    const key = `encode(sha256(convert_to('${p}', 'UTF8')), 'hex')`;
    // Yesterday (WIB) is full: it does not count against today.
    sql(`insert into private.partner_new_sellers (provider_env, partner_key, wib_day, external_ref)
      select 'sandbox', ${key}, (now() at time zone 'Asia/Jakarta')::date - 1, 'geraiexpress:tenant:old-' || g from generate_series(1, 5) g`);
    expect((await reserve(p, { p_new_seller_ref: "geraiexpress:tenant:a" })).allowed).toBe(true);
    // A retried registration (or recovery) of the same seller is not a new seller.
    expect((await reserve(p, { p_new_seller_ref: "geraiexpress:tenant:a" })).allowed).toBe(true);
    expect((await reserve(p, { p_new_seller_ref: "geraiexpress:tenant:b" })).allowed).toBe(true);
    const full = await reserve(p, { p_new_seller_ref: "geraiexpress:tenant:c" });
    expect(full).toMatchObject({ allowed: false, reason: "daily_new_seller_limit" });
    // next eligible = the next 00:00 Asia/Jakarta = 17:00 UTC.
    const next = new Date(full.next_eligible_at!);
    expect(next.getUTCHours()).toBe(17);
    expect(next.getUTCMinutes()).toBe(0);
    expect(next.getTime()).toBeGreaterThan(Date.now());
    expect(next.getTime() - Date.now()).toBeLessThanOrEqual(24 * 3600_000);
    // The already-counted seller and non-registration calls still pass.
    expect((await reserve(p, { p_new_seller_ref: "geraiexpress:tenant:a" })).allowed).toBe(true);
    expect((await reserve(p)).allowed).toBe(true);
    // Move today's rows to yesterday (the WIB day passed): the budget is available again.
    sql(`update private.partner_new_sellers set wib_day = wib_day - 1 where partner_key = ${key}
      and wib_day = (now() at time zone 'Asia/Jakarta')::date`);
    expect((await reserve(p, { p_new_seller_ref: "geraiexpress:tenant:c" })).allowed).toBe(true);
  });

  it("a recorded Retry-After makes every caller wait and is never shortened", async () => {
    const p = partner();
    const until = new Date(Date.now() + 120_000).toISOString();
    const noted = await machine().rpc("note_partner_retry_after", { p_env: "sandbox", p_partner: p, p_until: until });
    expect(noted.error).toBeNull();
    // Any caller (another tenant's dispatch, another replica) sees the same back-off.
    for (const r of await Promise.all([reserve(p), reserve(p, { p_new_seller_ref: "geraiexpress:tenant:x" })])) {
      expect(r).toMatchObject({ allowed: false, reason: "retry_after" });
      expect(Math.abs(Date.parse(r.next_eligible_at!) - Date.parse(until))).toBeLessThan(1000);
    }
    const shorter = await machine().rpc("note_partner_retry_after", { p_env: "sandbox", p_partner: p, p_until: new Date(Date.now() + 5_000).toISOString() });
    expect(Math.abs(Date.parse(shorter.data as string) - Date.parse(until))).toBeLessThan(1000);
    // Another partner is unaffected; nothing was counted for the denied calls.
    expect((await reserve(partner())).allowed).toBe(true);
    expect(sql(`select count(*) from private.partner_request_windows where partner_key = encode(sha256(convert_to('${p}', 'UTF8')), 'hex')`)).toBe("0");
  });

  it("a daily registration stop blocks only new-seller registrations until WIB midnight", async () => {
    const p = partner();
    const { data } = await machine().rpc("note_partner_retry_after", { p_env: "sandbox", p_partner: p, p_scope: "new_seller" });
    expect(new Date(data as string).getUTCHours()).toBe(17);
    expect((await reserve(p, { p_new_seller_ref: "geraiexpress:tenant:y" }))).toMatchObject({ allowed: false, reason: "retry_after" });
    expect((await reserve(p)).allowed).toBe(true);
  });

  it("refuses malformed input", async () => {
    for (const args of [{ p_env: "staging", p_partner: partner() }, { p_env: "sandbox", p_partner: "bad partner" },
      { p_env: "sandbox", p_partner: partner(), p_cost: 0 }, { p_env: "sandbox", p_partner: partner(), p_new_seller_ref: "x y" }]) {
      expect((await machine().rpc("reserve_partner_quota", args)).error).not.toBeNull();
    }
  });
});

// ============================================================ B. provider mutation fence

const FENCE = "private.provider_mutation_fence";
const simulateRestore = () => sql(`update ${FENCE} set cluster_identity = 'restored-from-backup:0:0:1', engaged = false`);
const queuedReal = () => Number(sql(`select count(*) from public.provider_operations where state = 'queued' and not is_simulated and kind = 'create_order'`));

async function clearFence(reason = "Rekonsiliasi pascapemulihan selesai") {
  const admin = await signInAal2("admin@geraiexpress.test");
  return admin.rpc("platform_clear_provider_fence", { p_reason: reason, p_expected_queued: queuedReal() });
}

describe("post-restore provider mutation fence (T-110 item B)", () => {
  let saved = "";
  beforeEach(() => { saved = sql(`select cluster_identity from ${FENCE}`); });
  afterEach(() => {
    sql(`update ${FENCE} set engaged = false, cluster_identity = private.provider_cluster_identity()`);
    // Queued fixtures from this suite must not carry the marker into other suites.
    sql(`update public.provider_operations set restore_check_required = false where restore_check_required and state = 'queued'`);
    expect(saved).not.toBe("");
  });

  it("is open on a fresh cluster: the stored identity is the live one", () => {
    expect(sql(`select private.provider_fence_engaged()`)).toBe("f");
    expect(sql(`select cluster_identity = private.provider_cluster_identity() from ${FENCE}`)).toBe("t");
    expect(sql(`select split_part(private.provider_cluster_identity(), ':', 3) = '${FENCE}'::regclass::oid::text`)).toBe("t");
  });

  it("a changed cluster identity refuses dispatch, batch payment, rotation and mutating Partner calls; reconciliation still runs", async () => {
    const queued = await realOperation();
    const stale = await realOperation();
    const m = machine();
    // An operation already in flight before the restore point: reconciled, not refused.
    expect((await m.rpc("dispatch_claim", { p_operation: stale.op, p_env: "sandbox" })).error).toBeNull();
    sql(`update public.provider_operations set dispatched_at = now() - interval '10 minutes' where id = '${stale.op}'`);
    simulateRestore();
    expect(sql(`select private.provider_fence_engaged()`)).toBe("t");

    expect((await m.rpc("dispatch_claim", { p_operation: queued.op, p_env: "sandbox" })).error?.message).toBe("provider_fence_engaged");
    expect(sql(`select state from public.provider_operations where id = '${queued.op}'`)).toBe("queued");
    for (const [fn, args] of [
      ["dispatch_pickup_begin_reservation", { p_operation: stale.op, p_attempt: 1 }],
      ["dispatch_pickup_begin_create", { p_operation: stale.op, p_attempt: 1 }],
      ["dispatch_mark_batch_payment_sent", { p_attempt: randomUUID(), p_batch_object_id: "6acf44c1771fe2b474c05676" }],
      ["fence_partner_key_rotation", { p_tenant: queued.tenant, p_actor: randomUUID(), p_seller_id: "seller", p_expected_version: 1, p_env: "sandbox" }],
      ["reserve_partner_quota", { p_env: "sandbox", p_partner: partner(), p_mutating: true }],
      ["dispatch_restore_check_passed", { p_operation: stale.op, p_attempt: 1 }],
    ] as const) {
      expect((await m.rpc(fn, args)).error?.message, fn).toBe("provider_fence_engaged");
    }
    const owner = await signIn("owner-a@geraiexpress.test");
    expect((await owner.rpc("authorize_batch_payment", { p_shipment: queued.shipment, p_batch_digest: "x" })).error?.message).toBe("provider_fence_engaged");
    // Read-only Partner calls (sellers/list) are not mutations.
    expect((await m.rpc("reserve_partner_quota", { p_env: "sandbox", p_partner: partner(), p_mutating: false })).error).toBeNull();
    // Reconciliation of the in-flight operation still runs, and its outcome can be recorded.
    const begin = await m.rpc("dispatch_begin_reconcile", { p_operation: stale.op, p_env: "sandbox" });
    expect(begin.error).toBeNull();
    expect((await m.rpc("dispatch_record", { p_operation: stale.op, p_attempt: 1, p_outcome: "issued", p_order_id: "261014LJ9GP7",
      p_tracking: "JO6844983511", p_batch: "26101416Q0L7LJ", p_code: "RECONCILED" })).error).toBeNull();
  });

  it("an explicit engagement (data-only restore) refuses the same way; only a platform clear reopens it", async () => {
    const f = await realOperation();
    sql(`select private.engage_provider_fence('Pemulihan data dari cadangan uji')`);
    expect(sql(`select engaged || '|' || reason from ${FENCE}`)).toBe("true|Pemulihan data dari cadangan uji");
    expect((await machine().rpc("dispatch_claim", { p_operation: f.op, p_env: "sandbox" })).error?.message).toBe("provider_fence_engaged");
    // No API role can engage, read the table or clear without the platform capability at aal2.
    const owner = await signIn("owner-a@geraiexpress.test");
    expect((await owner.rpc("platform_clear_provider_fence", { p_reason: "coba buka", p_expected_queued: queuedReal() })).error?.message).toBe("platform_access_required");
    const aal1 = await signIn("admin@geraiexpress.test");
    expect((await aal1.rpc("platform_clear_provider_fence", { p_reason: "coba buka", p_expected_queued: queuedReal() })).error?.message).toBe("platform_access_required");
    expect((await machine().rpc("platform_clear_provider_fence", { p_reason: "coba buka", p_expected_queued: queuedReal() })).error).not.toBeNull();
    expect(sql(`select has_function_privilege('service_role', 'private.engage_provider_fence(text)', 'execute')
      or has_function_privilege('authenticated', 'private.engage_provider_fence(text)', 'execute')
      or has_table_privilege('service_role', '${FENCE}', 'select,update')`)).toBe("f");
    expect(sql(`select private.provider_fence_engaged()`)).toBe("t");
  });

  it("clearing needs a reason and the reviewed queued count, marks every real queued create and is audited", async () => {
    const real = await realOperation();
    const simulated = await realOperation({ simulated: true });
    simulateRestore();
    const admin = await signInAal2("admin@geraiexpress.test");
    const state = await admin.rpc("platform_provider_fence");
    expect(state.error).toBeNull();
    expect(state.data).toMatchObject({ engaged: true, identity_changed: true, queued_real_operations: queuedReal() });
    expect((await admin.rpc("platform_clear_provider_fence", { p_reason: "ok", p_expected_queued: queuedReal() })).error?.message).toBe("reason_required");
    expect((await admin.rpc("platform_clear_provider_fence", { p_reason: "Rekonsiliasi selesai", p_expected_queued: queuedReal() + 1 })).error?.message).toBe("stale_state");
    const expected = queuedReal();
    const cleared = await clearFence();
    expect(cleared.error).toBeNull();
    expect(cleared.data).toBe(expected);
    expect(sql(`select private.provider_fence_engaged()`)).toBe("f");
    expect(sql(`select restore_check_required from public.provider_operations where id = '${real.op}'`)).toBe("t");
    expect(sql(`select restore_check_required from public.provider_operations where id = '${simulated.op}'`)).toBe("f");
    expect(sql(`select outcome || '|' || (detail->>'restore_checks_marked') from public.audit_events
      where action = 'provider_fence.cleared' order by id desc limit 1`)).toBe(`cleared|${expected}`);
    // Not engaged any more: a second clear is refused.
    expect((await clearFence()).error?.message).toBe("provider_fence_not_engaged");
    // A simulated operation can never carry the marker.
    expect(() => sql(`update public.provider_operations set restore_check_required = true where id = '${simulated.op}'`)).toThrow();
  });

  it("restore_check_required lifecycle: the claim returns it; only the check-passed RPC clears it", async () => {
    const f = await realOperation();
    simulateRestore();
    expect((await clearFence()).error).toBeNull();
    const m = machine();
    const claim = await m.rpc("dispatch_claim", { p_operation: f.op, p_env: "sandbox" });
    expect(claim.error).toBeNull();
    expect(claim.data).toMatchObject({ restore_check_required: true });
    expect(typeof (claim.data as { created_at?: unknown }).created_at).toBe("string");
    // A release (lookup failed) keeps the marker for the next claim.
    expect((await m.rpc("dispatch_release", { p_operation: f.op, p_attempt: 1 })).error).toBeNull();
    expect(sql(`select state || '|' || restore_check_required from public.provider_operations where id = '${f.op}'`)).toBe("queued|true");
    const again = await m.rpc("dispatch_claim", { p_operation: f.op, p_env: "sandbox" });
    expect(again.data).toMatchObject({ restore_check_required: true, attempt: 2 });
    expect((await m.rpc("dispatch_restore_check_passed", { p_operation: f.op, p_attempt: 1 })).error?.message).toBe("stale_attempt");
    const passed = await m.rpc("dispatch_restore_check_passed", { p_operation: f.op, p_attempt: 2 });
    expect(passed.error).toBeNull();
    expect(passed.data).toEqual({ stale: false });
    expect(sql(`select state || '|' || restore_check_required from public.provider_operations where id = '${f.op}'`)).toBe("in_flight|false");
    // Only the machine identity may call it.
    const owner = await signIn("owner-a@geraiexpress.test");
    expect((await owner.rpc("dispatch_restore_check_passed", { p_operation: f.op, p_attempt: 2 })).error).not.toBeNull();
  });

  it("an operation recorded unknown by the check keeps the flag; reconciliation's payload carries it and created_at", async () => {
    const f = await realOperation();
    simulateRestore();
    expect((await clearFence()).error).toBeNull();
    const m = machine();
    expect((await m.rpc("dispatch_claim", { p_operation: f.op, p_env: "sandbox" })).error).toBeNull();
    expect((await m.rpc("dispatch_record", { p_operation: f.op, p_attempt: 1, p_outcome: "unknown", p_code: "DUPLICATE_ORDERS" })).error).toBeNull();
    expect(sql(`select state || '|' || restore_check_required from public.provider_operations where id = '${f.op}'`)).toBe("unknown|true");
    const begin = await m.rpc("dispatch_begin_reconcile", { p_operation: f.op, p_env: "sandbox" });
    expect(begin.error).toBeNull();
    const created = sql(`select to_json(created_at)#>>'{}' from public.provider_operations where id = '${f.op}'`);
    expect(begin.data).toMatchObject({ restore_check_required: true });
    expect(Date.parse((begin.data as { created_at: string }).created_at)).toBe(Date.parse(created));
    // An ordinary operation's payload says false.
    const plain = await realOperation();
    const claim = await m.rpc("dispatch_claim", { p_operation: plain.op, p_env: "sandbox" });
    expect(claim.data).toMatchObject({ restore_check_required: false });
  });

  it("operator exit: a stuck restore check becomes unknown (flag kept) only for integration_operations at aal2", async () => {
    const f = await realOperation();
    simulateRestore();
    expect((await clearFence()).error).toBeNull();
    const args = { p_operation: f.op, p_env: "sandbox", p_reason: "Cek Mengantar gagal terus, periksa manual" };
    expect((await (await signIn("owner-a@geraiexpress.test")).rpc("platform_mark_restore_check_unknown", args)).error?.message).toBe("platform_access_required");
    expect((await (await signIn("admin@geraiexpress.test")).rpc("platform_mark_restore_check_unknown", args)).error?.message).toBe("platform_access_required");
    const admin = await signInAal2("admin@geraiexpress.test");
    expect((await admin.rpc("platform_mark_restore_check_unknown", { ...args, p_reason: "x" })).error?.message).toBe("reason_required");
    const marked = await admin.rpc("platform_mark_restore_check_unknown", args);
    expect(marked.error).toBeNull();
    expect(marked.data).toBe(sql(`select reference from public.shipments where id = '${f.shipment}'`));
    expect(sql(`select state || '|' || result_code || '|' || restore_check_required || '|' || provider_env from public.provider_operations where id = '${f.op}'`))
      .toBe("unknown|RESTORE_CHECK_MANUAL|true|sandbox");
    expect(sql(`select submission_state from public.shipments where id = '${f.shipment}'`)).toBe("unknown");
    expect(sql(`select count(*) from public.audit_events where action = 'provider_fence.restore_check_manual' and detail->>'operation' = '${f.op}'`)).toBe("1");
    // Only a queued, flagged operation: a second call is refused.
    expect((await admin.rpc("platform_mark_restore_check_unknown", args)).error?.message).toBe("not_restore_check");
    const begin = await machine().rpc("dispatch_begin_reconcile", { p_operation: f.op, p_env: "sandbox" });
    expect(begin.data).toMatchObject({ restore_check_required: true });
  });

  it("a restore-check operation older than the quote window is checked first, then failed as stale (reopenable)", async () => {
    const f = await realOperation();
    sql(`update public.provider_operations set created_at = now() - interval '7 hours' where id = '${f.op}'`);
    simulateRestore();
    expect((await clearFence()).error).toBeNull();
    const m = machine();
    const claim = await m.rpc("dispatch_claim", { p_operation: f.op, p_env: "sandbox" });
    // Not failed as QUOTE_STALE before the lookup: the order may exist at Mengantar.
    expect(claim.data).toMatchObject({ restore_check_required: true });
    const passed = await m.rpc("dispatch_restore_check_passed", { p_operation: f.op, p_attempt: 1 });
    expect(passed.data).toEqual({ stale: true });
    expect(sql(`select state || '|' || result_code || '|' || restore_check_required from public.provider_operations where id = '${f.op}'`)).toBe("failed|QUOTE_STALE|false");
  });
});
