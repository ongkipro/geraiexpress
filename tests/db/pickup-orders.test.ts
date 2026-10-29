// T-043 / PR-5 / TD-12 / UX-10: per-shipment handover, frozen at confirmation, and the durable
// reservation phases of a pickup operation. No provider is called: these are the database contract
// the Worker's reservation steps rely on (write-ahead before POST /time and POST /order, never a
// second reservation or create, requeue only from a provable "create never began").
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { client, demoVisitor, machine, realOperation, signIn, signInAal2, sql } from "./helpers";
import { PICKUP_LEAD_MINUTES, pickupSlotError } from "../../src/lib/mengantar/pickup";

const A = { address: "6acf44a4771fe2b474c055ca", area: "5fc62f60f8f44b34aa4c0dcd" };
const rows = [{ courier: "JT", tariff: 9000, net: 6300, eta: "1-2 hari" }];
const TIME_ID = "6b0c2a1e9d3f4a5b6c7d8e90";
const wibToday = () => sql(`select (now() at time zone 'Asia/Jakarta')::date::text`);
const wibDay = (offset: number) => sql(`select ((now() at time zone 'Asia/Jakarta')::date + ${offset})::text`);

// A confirmable draft of a fresh active tenant (same shape as the T-034 fixture), with a signed-in admin.
async function draft() {
  const f = await realOperation();
  const owner = await signIn("owner-a@geraiexpress.test");
  const user = (await owner.auth.getUser()).data.user!.id;
  const outlet = sql(`select outlet_id from public.shipments where id = '${f.shipment}'`);
  sql(`insert into public.memberships (tenant_id, user_id, role) values ('${f.tenant}', '${user}', 'tenant_admin');
    delete from public.provider_operations where id = '${f.op}';
    update public.shipments set submission_state = 'draft', selected_quote_id = null, pickup_snapshot = null where id = '${f.shipment}';
    update public.shipments set sender_name = 'Pengirim', sender_phone = '081234567890', recipient_area = 'Wilayah Tujuan' where id = '${f.shipment}';
    update public.outlets set pickup_address = 'Jl. Pickup A No. 1', pickup_area = 'Wilayah A' where id = '${outlet}'`);
  const revision = () => Number(sql(`select revision from public.shipments where id = '${f.shipment}'`));
  const setHandover = (patch: Record<string, unknown>) =>
    owner.from("shipments").update(patch).eq("id", f.shipment).select("revision, submission_state, selected_quote_id");
  const slot = (over: Record<string, unknown> = {}) =>
    setHandover({ handover: "pickup", pickup_date: wibDay(1), pickup_slot_hour: 12, pickup_volume: "volumeMotor", pickup_note: "Titip di satpam", ...over });
  const quote = () => machine().rpc("record_live_quotes", {
    p_tenant: f.tenant, p_shipment: f.shipment, p_expected_revision: revision(), p_rows: rows,
    p_origin_area_id: A.area, p_origin_address_id: A.address,
  });
  const quoteId = () => sql(`select id from public.shipment_quotes where shipment_id = '${f.shipment}' and expires_at > now() order by quoted_at desc limit 1`);
  const confirm = () => owner.rpc("confirm_shipment", {
    p_shipment: f.shipment, p_quote: quoteId(), p_expected_revision: revision(), p_idempotency_key: randomUUID(),
  });
  const cleanup = () => sql(`update public.shipments set selected_quote_id = null where tenant_id = '${f.tenant}';
    delete from public.shipments where tenant_id = '${f.tenant}'; delete from public.tenants where id = '${f.tenant}'`);
  return { ...f, owner, outlet, revision, setHandover, slot, quote, quoteId, confirm, cleanup };
}

const snapshot = (shipment: string) => JSON.parse(sql(`select pickup_snapshot::text from public.shipments where id = '${shipment}'`));
const op = (id: string) => sql(`select state || '|' || attempts || '|' || coalesce(result_code, '-') || '|' || coalesce(pickup_phase, '-') || '|' || coalesce(pickup_time_id, '-') from public.provider_operations where id = '${id}'`);
const shipmentState = (id: string) => sql(`select submission_state from public.shipments where id = '${id}'`);
const claim = (id: string) => machine().rpc("dispatch_claim", { p_operation: id, p_env: "sandbox" });
const call = (fn: string, id: string, attempt: number, extra: Record<string, unknown> = {}) =>
  machine().rpc(fn, { p_operation: id, p_attempt: attempt, ...extra });

// A confirmed pickup operation, claimed (in flight, attempt 1).
async function inFlightPickup() {
  const f = await draft();
  expect((await f.slot()).error).toBeNull();
  expect((await f.quote()).error).toBeNull();
  const confirmed = await f.confirm();
  expect(confirmed.error).toBeNull();
  const opId = confirmed.data.operation_id as string;
  const claimed = await claim(opId);
  expect(claimed.error).toBeNull();
  return { ...f, opId, payload: claimed.data as Record<string, unknown> };
}

describe("handover columns and constraints (T-043 PR-5)", () => {
  it("defaults to drop-off with no pickup data", async () => {
    const f = await draft();
    try {
      expect(sql(`select handover || '|' || coalesce(pickup_date::text, '-') || '|' || coalesce(pickup_slot_hour::text, '-') from public.shipments where id = '${f.shipment}'`)).toBe("dropoff|-|-");
    } finally { f.cleanup(); }
  });

  it("the table refuses a pickup without date, hour or volume and a drop-off that carries pickup data", async () => {
    const f = await draft();
    try {
      // Triggers off for the session so the CHECK constraint itself is what answers (the guard trigger
      // would otherwise reject an incomplete pickup first).
      const set = (assign: string) => () => sql(`set session_replication_role = replica; update public.shipments set ${assign} where id = '${f.shipment}'`);
      const day = wibDay(2);
      expect(set(`handover = 'pickup'`)).toThrow(/shipments_handover_shape/);
      expect(set(`handover = 'pickup', pickup_date = '${day}', pickup_volume = 'volumeMotor'`)).toThrow(/shipments_handover_shape/);
      expect(set(`handover = 'pickup', pickup_slot_hour = 12, pickup_volume = 'volumeMotor'`)).toThrow(/shipments_handover_shape/);
      expect(set(`handover = 'pickup', pickup_date = '${day}', pickup_slot_hour = 12`)).toThrow(/shipments_handover_shape/);
      expect(set(`pickup_date = '${day}'`)).toThrow(/shipments_handover_shape/);
      expect(set(`pickup_note = 'catatan'`)).toThrow(/shipments_handover_shape/);
      // Hours outside the documented 9:00-18:00, unknown volume classes, an over-long note.
      for (const hour of [8, 19, 0]) {
        expect(set(`handover = 'pickup', pickup_date = '${day}', pickup_slot_hour = ${hour}, pickup_volume = 'volumeMotor'`)).toThrow(/pickup_slot_hour_check/);
      }
      expect(set(`handover = 'pickup', pickup_date = '${day}', pickup_slot_hour = 12, pickup_volume = 'volumeBus'`)).toThrow(/pickup_volume_check/);
      expect(set(`handover = 'pickup', pickup_date = '${day}', pickup_slot_hour = 12, pickup_volume = 'volumeMotor', pickup_note = '${"x".repeat(201)}'`)).toThrow(/pickup_note_check/);
      expect(set(`handover = 'courier'`)).toThrow(/handover_check/);
      // Both documented boundary hours are accepted.
      for (const hour of [9, 18]) {
        set(`handover = 'pickup', pickup_date = '${day}', pickup_slot_hour = ${hour}, pickup_volume = 'volumeMotor'`)();
      }
      expect(sql(`select pickup_slot_hour from public.shipments where id = '${f.shipment}'`)).toBe("18");
    } finally { f.cleanup(); }
  });

  it("a member saves the choice as draft content: it bumps the revision and drops the quote", async () => {
    const f = await draft();
    try {
      expect((await f.quote()).error).toBeNull();
      expect(shipmentState(f.shipment)).toBe("estimated");
      const before = f.revision();
      const saved = await f.slot();
      expect(saved.error).toBeNull();
      expect(saved.data).toEqual([{ revision: before + 1, submission_state: "draft", selected_quote_id: null }]);
      // Saving the same choice again changes nothing.
      expect((await f.slot()).data).toEqual([{ revision: before + 1, submission_state: "draft", selected_quote_id: null }]);
      expect((await f.slot({ pickup_slot_hour: 14 })).data?.[0].revision).toBe(before + 2);
      // Going back to drop-off needs the pickup data cleared in the same write.
      expect((await f.setHandover({ handover: "dropoff" })).error).toMatchObject({ code: "23514" });
      expect((await f.setHandover({ handover: "dropoff", pickup_date: null, pickup_slot_hour: null, pickup_volume: null, pickup_note: null })).error).toBeNull();
    } finally { f.cleanup(); }
  });

  it("refuses a pickup in the past with a stable code; the database clock agrees with the application rule", async () => {
    const f = await draft();
    try {
      const past = await f.slot({ pickup_date: wibDay(-1) });
      expect(past.error).toMatchObject({ code: "22023", message: "pickup_time_invalid" });
      // The same decision as the unit rule, for several dates and hours around now.
      const nowMs = Number(sql(`select floor(extract(epoch from now()) * 1000)::bigint`));
      for (const day of [wibDay(-1), wibToday(), wibDay(1)]) {
        for (const hour of [9, 12, 15, 18]) {
          const db = sql(`select private.pickup_slot_ok('${day}', ${hour})`) === "t";
          const app = pickupSlotError(day, hour, new Date(nowMs)) !== "too_soon";
          expect({ day, hour, db }).toEqual({ day, hour, db: app });
        }
      }
      expect(sql(`select private.pickup_slot_ok('${wibDay(1)}', 8)`)).toBe("f");
      expect(sql(`select private.pickup_slot_ok(null, 12)`)).toBe("f");
      expect(PICKUP_LEAD_MINUTES).toBe(90);
    } finally { f.cleanup(); }
  });

  it("is not exposed to other roles: a stranger or visitor cannot set a handover on someone's draft", async () => {
    const f = await draft();
    try {
      const visitor = await demoVisitor();
      for (const c of [client(), visitor.c, await signIn("owner-b@geraiexpress.test")]) {
        const { data } = await c.from("shipments").update({ handover: "pickup", pickup_date: wibDay(1), pickup_slot_hour: 12, pickup_volume: "volumeMotor" }).eq("id", f.shipment).select("id");
        expect(data ?? []).toEqual([]);
      }
      expect(sql(`select handover from public.shipments where id = '${f.shipment}'`)).toBe("dropoff");
    } finally { f.cleanup(); }
  });
});

describe("confirmation freezes the handover (T-034 identity pattern)", () => {
  it("copies the chosen handover into pickup_snapshot and dispatch_payload reads it", async () => {
    const f = await inFlightPickup();
    try {
      const frozen = snapshot(f.shipment);
      expect(frozen).toMatchObject({
        handover: "pickup", pickup_date: wibDay(1), pickup_slot_hour: 12, pickup_volume: "volumeMotor", pickup_note: "Titip di satpam",
        mengantar_pickup_address_id: A.address, mengantar_area_id: A.area, outlet: "Outlet D",
      });
      expect(f.payload).toMatchObject({
        handover: "pickup", pickup_date: wibDay(1), pickup_slot_hour: 12, pickup_volume: "volumeMotor",
        pickup_phase: null, pickup_time_id: null, operation_state: "in_flight", pickup_address_id: A.address,
      });
      // The frozen draft cannot be edited any more: a member's write matches no row (RLS), a direct write is refused.
      expect((await f.slot({ pickup_slot_hour: 16 })).data ?? []).toEqual([]);
      expect(sql(`select pickup_slot_hour from public.shipments where id = '${f.shipment}'`)).toBe("12");
      expect(() => sql(`update public.shipments set pickup_slot_hour = 16 where id = '${f.shipment}'`)).toThrow(/shipment_locked/);
      expect(snapshot(f.shipment)).toEqual(frozen);
    } finally { f.cleanup(); }
  });

  it("a drop-off shipment is frozen as drop-off and dispatches without pickup data", async () => {
    const f = await draft();
    try {
      expect((await f.quote()).error).toBeNull();
      const confirmed = await f.confirm();
      expect(confirmed.error).toBeNull();
      expect(snapshot(f.shipment)).toMatchObject({ handover: "dropoff" });
      expect(snapshot(f.shipment)).not.toHaveProperty("pickup_date");
      const claimed = await claim(confirmed.data.operation_id);
      expect(claimed.data).toMatchObject({ handover: "dropoff", pickup_date: null, pickup_slot_hour: null, pickup_volume: null, pickup_phase: null });
      expect((await call("dispatch_pickup_begin_reservation", confirmed.data.operation_id, 1)).error?.message).toBe("not_pickup");
    } finally { f.cleanup(); }
  });

  it("a snapshot frozen before pickup existed (no handover key) dispatches as drop-off", async () => {
    const f = await realOperation();
    const claimed = await claim(f.op);
    expect(claimed.data).toMatchObject({ handover: "dropoff", pickup_date: null });
  });

  it("confirmation refuses a slot that fell inside the lead time after it was saved", async () => {
    const f = await draft();
    try {
      expect((await f.slot()).error).toBeNull();
      expect((await f.quote()).error).toBeNull();
      // Move the saved slot into the past without a revision change (triggers off for this session).
      sql(`set session_replication_role = replica; update public.shipments set pickup_date = '${wibDay(-1)}' where id = '${f.shipment}'`);
      const refused = await f.confirm();
      expect(refused.error).toMatchObject({ code: "22023", message: "pickup_time_invalid" });
      expect(sql(`select count(*) from public.provider_operations where shipment_id = '${f.shipment}'`)).toBe("0");
    } finally { f.cleanup(); }
  });

  it("confirming a pickup shipment twice with the same key replays the one operation", async () => {
    const f = await draft();
    try {
      expect((await f.slot()).error).toBeNull();
      expect((await f.quote()).error).toBeNull();
      const key = randomUUID();
      const args = { p_shipment: f.shipment, p_quote: f.quoteId(), p_expected_revision: f.revision(), p_idempotency_key: key };
      const first = await f.owner.rpc("confirm_shipment", args);
      expect(first.error).toBeNull();
      const replay = await f.owner.rpc("confirm_shipment", args);
      expect(replay.data).toMatchObject({ operation_id: first.data.operation_id, replayed: true });
      expect(sql(`select count(*) from public.provider_operations where shipment_id = '${f.shipment}'`)).toBe("1");
    } finally { f.cleanup(); }
  });
});

describe("reservation phases (TD-12): write-ahead, never a second reservation or create", () => {
  it("only the machine identity can drive the reservation commands", async () => {
    const f = await inFlightPickup();
    try {
      const callers = [client(), f.owner, await signIn("operator-a@geraiexpress.test"), (await demoVisitor()).c];
      for (const c of callers) {
        for (const [fn, extra] of [
          ["dispatch_pickup_begin_reservation", {}], ["dispatch_pickup_record_reservation", { p_time_id: TIME_ID }],
          ["dispatch_pickup_begin_create", {}], ["dispatch_pickup_requeue", { p_time_id: TIME_ID }],
        ] as const) {
          expect((await c.rpc(fn, { p_operation: f.opId, p_attempt: 1, ...extra })).error, fn).not.toBeNull();
        }
      }
      expect(op(f.opId)).toBe("in_flight|1|-|-|-");
    } finally { f.cleanup(); }
  });

  it("reserves once: the write-ahead is fenced to the attempt and cannot be taken twice", async () => {
    const f = await inFlightPickup();
    try {
      expect((await call("dispatch_pickup_begin_reservation", f.opId, 2)).error).toMatchObject({ code: "55000", message: "stale_attempt" });
      expect((await call("dispatch_pickup_begin_reservation", f.opId, 1)).error).toBeNull();
      expect(op(f.opId)).toBe("in_flight|1|-|reserving|-");
      expect((await call("dispatch_pickup_begin_reservation", f.opId, 1)).error).toMatchObject({ code: "55000", message: "reservation_already_started" });
      // A started reservation can never be given back to the queue (a release would allow a second POST /time).
      expect((await call("dispatch_release", f.opId, 1)).error).toMatchObject({ code: "55000", message: "provider_call_started" });
      expect(op(f.opId)).toBe("in_flight|1|-|reserving|-");
      expect(sql(`select count(*) from public.shipment_events where shipment_id = '${f.shipment}' and kind = 'pickup_reserving'`)).toBe("1");
      // The order cannot begin before a reservation is recorded.
      expect((await call("dispatch_pickup_begin_create", f.opId, 1)).error).toMatchObject({ code: "55000", message: "reservation_required" });
    } finally { f.cleanup(); }
  });

  it("stores the reservation answer once and validates the time id", async () => {
    const f = await inFlightPickup();
    try {
      expect((await call("dispatch_pickup_record_reservation", f.opId, 1, { p_time_id: TIME_ID })).error).toMatchObject({ code: "55000", message: "reservation_not_started" });
      expect((await call("dispatch_pickup_begin_reservation", f.opId, 1)).error).toBeNull();
      for (const bad of ["", "x", "has space 123", "a".repeat(65), "bad/slash1"]) {
        expect((await call("dispatch_pickup_record_reservation", f.opId, 1, { p_time_id: bad })).error?.message, bad).toBe("invalid_time_id");
      }
      expect((await call("dispatch_pickup_record_reservation", f.opId, 2, { p_time_id: TIME_ID })).error?.message).toBe("stale_attempt");
      expect((await call("dispatch_pickup_record_reservation", f.opId, 1, { p_time_id: TIME_ID })).error).toBeNull();
      expect(op(f.opId)).toBe(`in_flight|1|-|reserved|${TIME_ID}`);
      // Repeating the same answer is a no-op; a different id is refused.
      expect((await call("dispatch_pickup_record_reservation", f.opId, 1, { p_time_id: TIME_ID })).error).toBeNull();
      expect((await call("dispatch_pickup_record_reservation", f.opId, 1, { p_time_id: "6b0c2a1e9d3f4a5b6c7d8e91" })).error?.message).toBe("reservation_not_started");
      expect(sql(`select count(*) from public.shipment_events where shipment_id = '${f.shipment}' and kind = 'pickup_reserved'`)).toBe("1");
      // A second reservation cannot begin.
      expect((await call("dispatch_pickup_begin_reservation", f.opId, 1)).error?.message).toBe("reservation_already_started");
    } finally { f.cleanup(); }
  });

  it("the order write-ahead is allowed once, only from a recorded reservation, and blocks a release", async () => {
    const f = await inFlightPickup();
    try {
      await call("dispatch_pickup_begin_reservation", f.opId, 1);
      await call("dispatch_pickup_record_reservation", f.opId, 1, { p_time_id: TIME_ID });
      expect((await call("dispatch_pickup_begin_create", f.opId, 2)).error?.message).toBe("stale_attempt");
      expect((await call("dispatch_pickup_begin_create", f.opId, 1)).error).toBeNull();
      expect(op(f.opId)).toBe(`in_flight|1|-|creating|${TIME_ID}`);
      expect((await call("dispatch_pickup_begin_create", f.opId, 1)).error).toMatchObject({ code: "55000", message: "create_already_started" });
      expect((await call("dispatch_release", f.opId, 1)).error?.message).toBe("provider_call_started");
      expect((await call("dispatch_pickup_begin_reservation", f.opId, 1)).error?.message).toBe("reservation_already_started");
      // The create answer is recorded as usual.
      const issued = await call("dispatch_record", f.opId, 1, { p_outcome: "issued", p_order_id: "261014LJ9GP7", p_tracking: "JO6844983511", p_batch: "26101416Q0L7LJ" });
      expect(issued.error).toBeNull();
      expect(op(f.opId)).toBe(`succeeded|1|ISSUED|creating|${TIME_ID}`);
      expect(shipmentState(f.shipment)).toBe("issued");
    } finally { f.cleanup(); }
  });

  it("a recorded reservation whose order write-ahead failed may be released and keeps its time id", async () => {
    const f = await inFlightPickup();
    try {
      await call("dispatch_pickup_begin_reservation", f.opId, 1);
      await call("dispatch_pickup_record_reservation", f.opId, 1, { p_time_id: TIME_ID });
      expect((await call("dispatch_release", f.opId, 1)).error).toBeNull();
      expect(op(f.opId)).toBe(`queued|1|RELEASED|reserved|${TIME_ID}`);
      // The slot was reserved in sandbox: the other environment's runtime never sends it (third review L1).
      const crossed = await machine().rpc("dispatch_claim", { p_operation: f.opId, p_env: "production" });
      expect([crossed.data, crossed.error?.message]).toEqual([null, "provider_env_mismatch"]);
      expect(op(f.opId)).toBe(`queued|1|RELEASED|reserved|${TIME_ID}`);
      const again = await claim(f.opId);
      expect(again.error).toBeNull();
      expect(again.data).toMatchObject({ attempt: 2, pickup_phase: "reserved", pickup_time_id: TIME_ID });
      expect((await call("dispatch_pickup_begin_reservation", f.opId, 2)).error?.message).toBe("reservation_already_started");
      expect((await call("dispatch_pickup_begin_create", f.opId, 2)).error).toBeNull();
    } finally { f.cleanup(); }
  });

  it("a lost reservation answer ends in reconciliation, then requeues with the id read back, never a second reservation", async () => {
    const f = await inFlightPickup();
    try {
      await call("dispatch_pickup_begin_reservation", f.opId, 1);
      const unknown = await call("dispatch_record", f.opId, 1, { p_outcome: "unknown", p_code: "PICKUP_RESERVATION_UNKNOWN" });
      expect(unknown.error).toBeNull();
      expect(op(f.opId)).toBe("unknown|1|PICKUP_RESERVATION_UNKNOWN|reserving|-");
      expect(shipmentState(f.shipment)).toBe("unknown");
      // Reconciliation sees the phase and the state; nothing can claim it again.
      const begin = await machine().rpc("dispatch_begin_reconcile", { p_operation: f.opId, p_env: "sandbox" });
      expect(begin.data).toMatchObject({ operation_state: "unknown", pickup_phase: "reserving", pickup_time_id: null, handover: "pickup" });
      expect((await claim(f.opId)).error?.message).toBe("not_queued");
      // Requeue needs the id read back from GET /time, the right attempt, and a well-formed id.
      expect((await call("dispatch_pickup_requeue", f.opId, 1)).error?.message).toBe("invalid_time_id");
      expect((await call("dispatch_pickup_requeue", f.opId, 1, { p_time_id: "bad id" })).error?.message).toBe("invalid_time_id");
      expect((await call("dispatch_pickup_requeue", f.opId, 5, { p_time_id: TIME_ID })).error?.message).toBe("stale_attempt");
      expect(op(f.opId)).toBe("unknown|1|PICKUP_RESERVATION_UNKNOWN|reserving|-");
      expect((await call("dispatch_pickup_requeue", f.opId, 1, { p_time_id: TIME_ID })).error).toBeNull();
      expect(op(f.opId)).toBe(`queued|1|PICKUP_RESERVED|reserved|${TIME_ID}`);
      expect(shipmentState(f.shipment)).toBe("queued");
      // The next claim sends the order for the first time and carries the id; no reservation again.
      const next = await claim(f.opId);
      expect(next.data).toMatchObject({ attempt: 2, pickup_phase: "reserved", pickup_time_id: TIME_ID, operation_state: "in_flight" });
      expect((await call("dispatch_pickup_begin_reservation", f.opId, 2)).error?.message).toBe("reservation_already_started");
      expect((await call("dispatch_pickup_begin_create", f.opId, 2)).error).toBeNull();
    } finally { f.cleanup(); }
  });

  it("a stored reservation without an order (crash) requeues without needing an id", async () => {
    const f = await inFlightPickup();
    try {
      await call("dispatch_pickup_begin_reservation", f.opId, 1);
      await call("dispatch_pickup_record_reservation", f.opId, 1, { p_time_id: TIME_ID });
      sql(`update public.provider_operations set dispatched_at = now() - interval '3 minutes' where id = '${f.opId}'`);
      const begin = await machine().rpc("dispatch_begin_reconcile", { p_operation: f.opId, p_env: "sandbox" });
      expect(begin.data).toMatchObject({ operation_state: "unknown", pickup_phase: "reserved", pickup_time_id: TIME_ID });
      expect((await call("dispatch_pickup_requeue", f.opId, 1)).error).toBeNull();
      expect(op(f.opId)).toBe(`queued|1|PICKUP_RESERVED|reserved|${TIME_ID}`);
    } finally { f.cleanup(); }
  });

  it("a lost create answer is reconciled by the order, never requeued: the order may exist", async () => {
    const f = await inFlightPickup();
    try {
      await call("dispatch_pickup_begin_reservation", f.opId, 1);
      await call("dispatch_pickup_record_reservation", f.opId, 1, { p_time_id: TIME_ID });
      await call("dispatch_pickup_begin_create", f.opId, 1);
      await call("dispatch_record", f.opId, 1, { p_outcome: "unknown", p_code: "UNKNOWN_OUTCOME" });
      expect(op(f.opId)).toBe(`unknown|1|UNKNOWN_OUTCOME|creating|${TIME_ID}`);
      expect((await call("dispatch_pickup_requeue", f.opId, 1)).error).toMatchObject({ code: "55000", message: "stale_attempt" });
      expect((await call("dispatch_pickup_requeue", f.opId, 1, { p_time_id: TIME_ID })).error?.message).toBe("stale_attempt");
      expect(op(f.opId)).toBe(`unknown|1|UNKNOWN_OUTCOME|creating|${TIME_ID}`);
      // The ordinary reconciliation outcomes still apply.
      sql(`update public.provider_operations set dispatched_at = now() - interval '10 minutes' where id = '${f.opId}'`);
      const found = await call("dispatch_record", f.opId, 1, { p_outcome: "issued", p_order_id: "261014LJ9GP7", p_tracking: "JO6844983511", p_batch: "26101416Q0L7LJ", p_code: "RECONCILED" });
      expect(found.error).toBeNull();
      expect(shipmentState(f.shipment)).toBe("issued");
    } finally { f.cleanup(); }
  });

  it("only an unknown operation can be requeued: not an in-flight, queued, failed or finished one", async () => {
    const f = await inFlightPickup();
    try {
      await call("dispatch_pickup_begin_reservation", f.opId, 1);
      expect((await call("dispatch_pickup_requeue", f.opId, 1, { p_time_id: TIME_ID })).error?.message).toBe("stale_attempt"); // in flight
      await call("dispatch_record", f.opId, 1, { p_outcome: "rejected", p_code: "PICKUP_SLOT_UNAVAILABLE", p_detail: "Slot penuh" });
      expect(op(f.opId)).toBe("failed|1|PICKUP_SLOT_UNAVAILABLE|reserving|-");
      expect((await call("dispatch_pickup_requeue", f.opId, 1, { p_time_id: TIME_ID })).error?.message).toBe("stale_attempt"); // failed
    } finally { f.cleanup(); }
  });

  it("lists the time ids of the tenant's OTHER operations for the read-back, never its own (machine only)", async () => {
    const f = await inFlightPickup();
    try {
      await call("dispatch_pickup_begin_reservation", f.opId, 1);
      await call("dispatch_pickup_record_reservation", f.opId, 1, { p_time_id: TIME_ID });
      await call("dispatch_pickup_begin_create", f.opId, 1);
      expect((await call("dispatch_record", f.opId, 1, { p_outcome: "rejected", p_code: "PROVIDER_REJECTED" })).error).toBeNull();
      expect((await f.owner.rpc("reopen_shipment", { p_shipment: f.shipment })).error).toBeNull();
      expect((await f.quote()).error).toBeNull();
      const second = await f.confirm();
      expect(second.error).toBeNull();
      const known = (id: string) => machine().rpc("dispatch_pickup_known_time_ids", { p_operation: id });
      // The closed first operation's id is known to the second one; the first sees nothing of its own.
      expect((await known(second.data.operation_id)).data).toEqual([TIME_ID]);
      expect((await known(f.opId)).data).toEqual([]);
      expect((await known(randomUUID())).error).toMatchObject({ message: "not_found" });
      // Signed-in users cannot read it.
      expect((await f.owner.rpc("dispatch_pickup_known_time_ids", { p_operation: second.data.operation_id })).error).not.toBeNull();
    } finally { f.cleanup(); }
  });

  it("a refused slot is a definite refusal: the draft reopens and confirms again as a new operation", async () => {
    const f = await inFlightPickup();
    try {
      expect(sql(`select private.definitely_not_created('failed', 'PICKUP_SLOT_UNAVAILABLE'), private.definitely_not_created('failed', 'PICKUP_TIME_INVALID')`)).toBe("t|t");
      // Reconciliation conclusions and unknown reservations still block a second operation.
      expect(sql(`select private.definitely_not_created('failed', 'NOT_CREATED'), private.definitely_not_created('unknown', 'PICKUP_RESERVATION_UNKNOWN')`)).toBe("f|f");
      await call("dispatch_pickup_begin_reservation", f.opId, 1);
      expect((await call("dispatch_record", f.opId, 1, { p_outcome: "rejected", p_code: "PICKUP_SLOT_UNAVAILABLE", p_detail: "Slot penuh" })).error).toBeNull();
      expect(shipmentState(f.shipment)).toBe("failed");
      expect((await f.owner.rpc("reopen_shipment", { p_shipment: f.shipment })).error).toBeNull();
      expect(shipmentState(f.shipment)).toBe("draft");
      // The handover choice survives the reopening (it is draft content); the frozen snapshot is gone.
      expect(sql(`select handover || '|' || pickup_slot_hour || '|' || coalesce(pickup_snapshot::text, '-') from public.shipments where id = '${f.shipment}'`)).toBe("pickup|12|-");
      expect((await f.quote()).error).toBeNull();
      const second = await f.confirm();
      expect(second.error).toBeNull();
      expect(second.data.operation_id).not.toBe(f.opId);
      expect(op(second.data.operation_id)).toBe("queued|0|-|-|-");
    } finally { f.cleanup(); }
  });
});

describe("platform audit default view (invoice snapshot rows)", () => {
  it("the unfiltered list omits invoice.snapshot rows like label.snapshot; filtering by the action returns them", async () => {
    const reason = `uji audit faktur ${randomUUID()}`;
    sql(`insert into public.audit_events (action, outcome, reason, detail) values ('invoice.snapshot', 'issued', '${reason}', '{}'::jsonb),
      ('export.shipments', 'ok', '${reason}', '{}'::jsonb)`);
    const admin = await signInAal2("admin@geraiexpress.test");
    const all = (await admin.rpc("platform_audit", { p_action: null, p_limit: 500 })).data as { action: string; reason: string | null }[];
    expect(all.some((r) => r.action === "invoice.snapshot")).toBe(false);
    expect(all.some((r) => r.action === "export.shipments" && r.reason === reason)).toBe(true);
    const only = (await admin.rpc("platform_audit", { p_action: "invoice.snapshot", p_limit: 500 })).data as { reason: string | null }[];
    expect(only.some((r) => r.reason === reason)).toBe(true);
  });
});

describe("admin close of an ambiguous pickup reservation (T-056)", () => {
  it("closes only a rested, read-back reservation with no order, to a reopenable state, audited; refuses others; a replay is a no-op", async () => {
    const f = await inFlightPickup();
    try {
      await call("dispatch_pickup_begin_reservation", f.opId, 1);
      expect((await call("dispatch_record", f.opId, 1, { p_outcome: "unknown", p_code: "PICKUP_RESERVATION_UNKNOWN" })).error).toBeNull();
      const owner = await signIn("owner-a@geraiexpress.test");
      const close = (c = owner, reason = "Diperiksa di aplikasi Mengantar: tidak ada slot") =>
        c.rpc("close_ambiguous_pickup_reservation", { p_shipment: f.shipment, p_reason: reason });

      // Too fresh and never read back: refused, nothing changes.
      expect((await close()).error?.message).toBe("not_closable");
      sql(`update public.provider_operations set dispatched_at = now() - interval '31 minutes' where id = '${f.opId}'`);
      expect((await close()).error?.message).toBe("not_closable");
      expect((await machine().rpc("dispatch_begin_reconcile", { p_operation: f.opId, p_env: "sandbox" })).error).toBeNull();
      expect(op(f.opId)).toBe("unknown|1|PICKUP_RESERVATION_UNKNOWN|reserving|-");

      // Operators and other tenants' admins are refused; a reason is required.
      const operatorId = sql(`select id from auth.users where email = 'operator-a@geraiexpress.test'`);
      sql(`insert into public.memberships (tenant_id, user_id, role) values ('${f.tenant}', '${operatorId}', 'operator') on conflict do nothing`);
      expect((await close(await signIn("operator-a@geraiexpress.test"))).error?.message).toBe("admin_required");
      expect((await close(await signIn("owner-b@geraiexpress.test"))).error).not.toBeNull();
      expect((await close(owner, " ")).error?.message).toBe("reason_required");
      expect(op(f.opId)).toBe("unknown|1|PICKUP_RESERVATION_UNKNOWN|reserving|-");

      const closed = await close();
      expect(closed.error).toBeNull();
      expect(closed.data).toMatchObject({ closed: true, previous: "PICKUP_RESERVATION_UNKNOWN" });
      expect(op(f.opId)).toBe("failed|1|CLOSED_NOT_CREATED|reserving|-");
      expect(shipmentState(f.shipment)).toBe("failed");
      expect((await close()).data).toMatchObject({ closed: false, reason: "already_closed" });
      expect(sql(`select count(*) || '|' || max(reason) || '|' || max(detail->>'previous') from public.audit_events
        where target_tenant = '${f.tenant}' and action = 'shipment.close_reservation'`)).toBe("1|Diperiksa di aplikasi Mengantar: tidak ada slot|PICKUP_RESERVATION_UNKNOWN");
      // The definite "not created" lets the counter reopen the draft.
      expect((await owner.rpc("reopen_shipment", { p_shipment: f.shipment })).error).toBeNull();
    } finally { f.cleanup(); }
  });

  it("refuses a reservation whose order was started (phase creating): an order may exist", async () => {
    const f = await inFlightPickup();
    try {
      await call("dispatch_pickup_begin_reservation", f.opId, 1);
      expect((await call("dispatch_pickup_record_reservation", f.opId, 1, { p_time_id: TIME_ID })).error).toBeNull();
      expect((await call("dispatch_pickup_begin_create", f.opId, 1)).error).toBeNull();
      expect((await call("dispatch_record", f.opId, 1, { p_outcome: "unknown", p_code: "UNKNOWN_OUTCOME" })).error).toBeNull();
      sql(`update public.provider_operations set dispatched_at = now() - interval '31 minutes', last_checked_at = now() where id = '${f.opId}'`);
      const owner = await signIn("owner-a@geraiexpress.test");
      expect((await owner.rpc("close_ambiguous_pickup_reservation", { p_shipment: f.shipment, p_reason: "Diperiksa di Mengantar" })).error?.message).toBe("not_closable");
      expect(op(f.opId)).toBe(`unknown|1|UNKNOWN_OUTCOME|creating|${TIME_ID}`);
    } finally { f.cleanup(); }
  });
});
