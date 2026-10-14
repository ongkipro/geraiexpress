// TD-3 / DEC-010: the account dispatcher's database contract. Provider results are written only
// by the machine identity; one real operation in flight per seller; attempts fence late writers;
// an unknown outcome is reconciled, and "not created" needs the attempt to be old enough.
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { client, demoVisitor, machine, realOperation, signIn, sql, type Fixture } from "./helpers";

const shipment = (id: string) => sql(`select submission_state || '|' || payment_state || '|' || coalesce(awb, '-') from public.shipments where id = '${id}'`);
const operation = (id: string) => sql(`select state || '|' || attempts || '|' || coalesce(result_code, '-') || '|' || coalesce(provider_order_id, '-') from public.provider_operations where id = '${id}'`);
const backdate = (op: string, minutes: number) => sql(`update public.provider_operations set dispatched_at = now() - interval '${minutes} minutes' where id = '${op}'`);

async function claimed(f?: Fixture) {
  const fx = f ?? (await realOperation());
  const { data, error } = await machine().rpc("dispatch_claim", { p_operation: fx.op, p_env: "sandbox" });
  expect(error).toBeNull();
  return { ...fx, payload: data as Record<string, unknown> };
}

describe("machine-only commands (DEC-010)", () => {
  it("no user, demo visitor or anonymous caller can claim, reconcile or record", async () => {
    const f = await realOperation();
    const callers = [client(), await signIn("owner-a@geraiexpress.test"), await signIn("operator-a@geraiexpress.test"), (await demoVisitor()).c];
    for (const c of callers) {
      expect((await c.rpc("dispatch_claim", { p_operation: f.op, p_env: "sandbox" })).error).not.toBeNull();
      expect((await c.rpc("dispatch_begin_reconcile", { p_operation: f.op })).error).not.toBeNull();
      expect((await c.rpc("dispatch_record", { p_operation: f.op, p_attempt: 1, p_outcome: "issued", p_order_id: "261014AAAAAA", p_tracking: "JO000001", p_batch: "26101416AAAAAA" })).error).not.toBeNull();
    }
    expect(operation(f.op)).toBe("queued|0|-|-");
  });
});

describe("claim", () => {
  it("moves a queued operation in flight and returns the request inputs with the sealed key", async () => {
    const { op, shipment: s, tenant, payload } = await claimed();
    expect(operation(op)).toBe("in_flight|1|-|-");
    expect(shipment(s)).toBe("in_flight|not_applicable|-");
    expect(payload).toMatchObject({
      operation_id: op, tenant_id: tenant, attempt: 1, provider_env: "sandbox", courier: "JT",
      pickup_address_id: "6acf44a4771fe2b474c055ca", weight_grams: 1000, goods_value_idr: 50000, item_description: "Dokumen",
      recipient: { area_id: "5fc63169f8f44b34aa4c2ee1", address: "Jl. Uji 1", name: "Penerima Uji", phone: "081234567890" },
      credential: { version: 1, key_version: "v1" },
    });
    expect(String(payload.reference)).toMatch(/^GX261014-/);
    expect((await machine().rpc("dispatch_claim", { p_operation: op, p_env: "sandbox" })).error?.message).toBe("not_queued");
  });

  it("allows one real operation in flight per seller; other sellers are not blocked", async () => {
    const first = await claimed();
    const second = await realOperation({ tenant: first.tenant });
    expect((await machine().rpc("dispatch_claim", { p_operation: second.op, p_env: "sandbox" })).error?.message).toBe("account_busy");
    expect(operation(second.op)).toBe("queued|0|-|-");
    await claimed(); // a different tenant
    await machine().rpc("dispatch_record", { p_operation: first.op, p_attempt: 1, p_outcome: "rejected", p_code: "DROP_OFF_UNSUPPORTED" });
    expect((await machine().rpc("dispatch_claim", { p_operation: second.op, p_env: "sandbox" })).error).toBeNull();
  });

  it("refuses simulated operations, demo or inactive tenants and unknown environments", async () => {
    const sim = await realOperation({ simulated: true });
    expect((await machine().rpc("dispatch_claim", { p_operation: sim.op, p_env: "sandbox" })).error?.message).toBe("not_found");
    const demo = await realOperation({ demo: true });
    expect((await machine().rpc("dispatch_claim", { p_operation: demo.op, p_env: "sandbox" })).error?.message).toBe("tenant_not_active");
    const suspended = await realOperation();
    sql(`update public.tenants set lifecycle = 'suspended' where id = '${suspended.tenant}'`);
    expect((await machine().rpc("dispatch_claim", { p_operation: suspended.op, p_env: "sandbox" })).error?.message).toBe("tenant_not_active");
    const f = await realOperation();
    expect((await machine().rpc("dispatch_claim", { p_operation: f.op, p_env: "staging" })).error?.message).toBe("invalid_environment");
    expect((await machine().rpc("dispatch_claim", { p_operation: randomUUID(), p_env: "sandbox" })).error?.message).toBe("not_found");
  });
});

describe("claim guards added in review", () => {
  it("leaves the operation queued when the seller has no key or the shipment is not ready", async () => {
    const f = await realOperation({ noCredential: true });
    expect((await machine().rpc("dispatch_claim", { p_operation: f.op, p_env: "sandbox" })).error?.message).toBe("credential_missing");
    expect(operation(f.op)).toBe("queued|0|-|-");
    const g = await realOperation();
    sql(`update public.shipments set submission_state = 'estimated' where id = '${g.shipment}'`);
    expect((await machine().rpc("dispatch_claim", { p_operation: g.op, p_env: "sandbox" })).error?.message).toBe("shipment_not_ready");
    const h = await realOperation();
    sql(`update public.shipment_quotes set shipment_revision = 2 where shipment_id = '${h.shipment}'`);
    expect((await machine().rpc("dispatch_claim", { p_operation: h.op, p_env: "sandbox" })).error?.message).toBe("shipment_not_ready");
  });

  it("a recently unknown operation keeps the seller busy; an older one does not", async () => {
    const first = await claimed();
    await machine().rpc("dispatch_record", { p_operation: first.op, p_attempt: 1, p_outcome: "unknown" });
    const second = await realOperation({ tenant: first.tenant });
    expect((await machine().rpc("dispatch_claim", { p_operation: second.op, p_env: "sandbox" })).error?.message).toBe("account_busy");
    backdate(first.op, 6);
    expect((await machine().rpc("dispatch_claim", { p_operation: second.op, p_env: "sandbox" })).error).toBeNull();
  });

  it("a released operation is queued again and its old attempt is fenced", async () => {
    const { op, shipment: s } = await claimed();
    expect((await machine().rpc("dispatch_release", { p_operation: op, p_attempt: 2 })).error?.message).toBe("stale_attempt");
    expect((await machine().rpc("dispatch_release", { p_operation: op, p_attempt: 1 })).error).toBeNull();
    expect(operation(op)).toBe("queued|1|RELEASED|-");
    expect(shipment(s)).toBe("queued|not_applicable|-");
    const again = await machine().rpc("dispatch_claim", { p_operation: op, p_env: "sandbox" });
    expect((again.data as { attempt: number }).attempt).toBe(2);
    expect((await machine().rpc("dispatch_record", { p_operation: op, p_attempt: 1, p_outcome: "rejected" })).error?.message).toBe("stale_attempt");
    for (const c of [client(), await signIn("owner-a@geraiexpress.test")]) {
      expect((await c.rpc("dispatch_release", { p_operation: op, p_attempt: 2 })).error).not.toBeNull();
    }
  });
});

describe("record", () => {
  it("records an issued order once, fenced by the attempt", async () => {
    const { op, shipment: s } = await claimed();
    const issued = { p_operation: op, p_outcome: "issued", p_order_id: "261014LJ9GP7", p_tracking: "JO6844983511", p_batch: "26101416Q0L7LJ" };
    expect((await machine().rpc("dispatch_record", { ...issued, p_attempt: 2 })).error?.message).toBe("stale_attempt");
    expect((await machine().rpc("dispatch_record", { ...issued, p_attempt: 1, p_tracking: null })).error?.message).toBe("missing_identity");
    expect((await machine().rpc("dispatch_record", { ...issued, p_attempt: 1 })).data).toEqual({ state: "succeeded", replayed: false });
    expect(operation(op)).toBe("succeeded|1|ISSUED|261014LJ9GP7");
    expect(shipment(s)).toBe("issued|paid|JO6844983511");
    expect((await machine().rpc("dispatch_record", { ...issued, p_attempt: 1 })).data).toEqual({ state: "succeeded", replayed: true });
    expect((await machine().rpc("dispatch_record", { p_operation: op, p_attempt: 1, p_outcome: "rejected" })).error?.message).toBe("already_recorded");
    expect(sql(`select string_agg(kind, ',' order by id) from public.shipment_events where shipment_id = '${s}'`)).toBe("dispatched,issued");
  });

  it("records an unpaid order and later its resi for the same provider order only", async () => {
    const { op, shipment: s } = await claimed();
    expect((await machine().rpc("dispatch_record", { p_operation: op, p_attempt: 1, p_outcome: "unpaid", p_order_id: "261014H0JAFR", p_batch: "26101416827JYE" })).error).toBeNull();
    expect(shipment(s)).toBe("awaiting_payment|unpaid|-");
    expect((await machine().rpc("dispatch_record", { p_operation: op, p_attempt: 1, p_outcome: "issued", p_order_id: "261014ZZZZZZ", p_tracking: "JO1111111111", p_batch: "26101416827JYE" })).error?.message).toBe("already_recorded");
    expect((await machine().rpc("dispatch_record", { p_operation: op, p_attempt: 1, p_outcome: "issued", p_order_id: "261014H0JAFR", p_tracking: "JO2222222222", p_batch: "26101416827JYE" })).error).toBeNull();
    expect(shipment(s)).toBe("issued|paid|JO2222222222");
    expect(operation(op)).toBe("succeeded|1|ISSUED|261014H0JAFR");
  });

  it("a refusal or provider error item fails the shipment without a resi", async () => {
    const a = await claimed();
    await machine().rpc("dispatch_record", { p_operation: a.op, p_attempt: 1, p_outcome: "failed", p_batch: "26101416ZI8BP1", p_record_id: "6acf44a4771fe2b474c055fd" });
    expect(operation(a.op)).toBe("failed|1|FAILED|-");
    expect(sql(`select provider_batch || '|' || provider_record_id from public.provider_operations where id = '${a.op}'`)).toBe("26101416ZI8BP1|6acf44a4771fe2b474c055fd");
    expect(shipment(a.shipment)).toBe("failed|not_applicable|-");
    const b = await claimed();
    expect((await machine().rpc("dispatch_record", { p_operation: b.op, p_attempt: 1, p_outcome: "rejected", p_code: "bad code!" })).error?.message).toBe("invalid_code");
    expect((await machine().rpc("dispatch_record", { p_operation: b.op, p_attempt: 1, p_outcome: "not_created" })).error?.message).toBe("invalid_outcome");
  });
});

describe("unknown outcome and reconciliation (TD-3 step 5)", () => {
  it("a fresh in-flight operation is not reconciled; a stale one becomes unknown", async () => {
    const { op, shipment: s } = await claimed();
    expect((await machine().rpc("dispatch_begin_reconcile", { p_operation: op })).error?.message).toBe("nothing_to_reconcile");
    backdate(op, 3);
    const { data, error } = await machine().rpc("dispatch_begin_reconcile", { p_operation: op });
    expect(error).toBeNull();
    expect((data as Record<string, unknown>).courier).toBe("JT");
    expect(operation(op)).toBe("unknown|1|STALE_IN_FLIGHT|-");
    expect(shipment(s)).toBe("unknown|not_applicable|-");
  });

  it("'not created' needs the attempt to be old enough; a found order is recorded from unknown", async () => {
    const a = await claimed();
    await machine().rpc("dispatch_record", { p_operation: a.op, p_attempt: 1, p_outcome: "unknown", p_code: "TIMEOUT" });
    expect(operation(a.op)).toBe("unknown|1|TIMEOUT|-");
    expect((await machine().rpc("dispatch_record", { p_operation: a.op, p_attempt: 1, p_outcome: "not_created" })).error?.message).toBe("too_early");
    backdate(a.op, 6);
    expect((await machine().rpc("dispatch_record", { p_operation: a.op, p_attempt: 1, p_outcome: "not_created" })).error).toBeNull();
    expect(shipment(a.shipment)).toBe("failed|not_applicable|-");

    const b = await claimed();
    await machine().rpc("dispatch_record", { p_operation: b.op, p_attempt: 1, p_outcome: "unknown" });
    // Reconciliation (or the late original answer) found the order: truthful, recorded.
    expect((await machine().rpc("dispatch_record", { p_operation: b.op, p_attempt: 9, p_outcome: "issued", p_order_id: "2610142JG95B", p_tracking: "JO6948371799", p_batch: "26101416AAAAAA" })).error).toBeNull();
    expect(shipment(b.shipment)).toBe("issued|paid|JO6948371799");
  });

  it("a 'not created' conclusion is corrected when the order turns up after all", async () => {
    const { op, shipment: s } = await claimed();
    await machine().rpc("dispatch_record", { p_operation: op, p_attempt: 1, p_outcome: "unknown" });
    backdate(op, 6);
    await machine().rpc("dispatch_record", { p_operation: op, p_attempt: 1, p_outcome: "not_created" });
    expect(shipment(s)).toBe("failed|not_applicable|-");
    // It can be checked again, and a found order is recorded with an explicit correction event.
    expect((await machine().rpc("dispatch_begin_reconcile", { p_operation: op })).error).toBeNull();
    expect((await machine().rpc("dispatch_record", { p_operation: op, p_attempt: 1, p_outcome: "not_created" })).data).toEqual({ state: "failed", replayed: true });
    expect((await machine().rpc("dispatch_record", { p_operation: op, p_attempt: 1, p_outcome: "issued", p_order_id: "261014LATE01", p_tracking: "JO7777777777", p_batch: "26101416LATE01" })).error).toBeNull();
    expect(operation(op)).toBe("succeeded|1|CORRECTED|261014LATE01");
    expect(shipment(s)).toBe("issued|paid|JO7777777777");
    expect(sql(`select kind from public.shipment_events where shipment_id = '${s}' order by id desc limit 1`)).toBe("outcome_corrected");
    // A provider refusal (rejected) is final.
    const r = await claimed();
    await machine().rpc("dispatch_record", { p_operation: r.op, p_attempt: 1, p_outcome: "rejected", p_code: "PROVIDER_REJECTED" });
    expect((await machine().rpc("dispatch_record", { p_operation: r.op, p_attempt: 1, p_outcome: "issued", p_order_id: "261014LATE02", p_tracking: "JO8888888888", p_batch: "26101416LATE02" })).error?.message).toBe("already_recorded");
    expect((await machine().rpc("dispatch_begin_reconcile", { p_operation: r.op })).error?.message).toBe("nothing_to_reconcile");
  });

  it("after a key rotation, reconciliation gets no key instead of searching the new account", async () => {
    const { op, tenant, payload } = await claimed();
    expect((payload.credential as { version: number }).version).toBe(1);
    await machine().rpc("dispatch_record", { p_operation: op, p_attempt: 1, p_outcome: "unknown" });
    sql(`update private.seller_credentials set superseded_at = now(), ciphertext = null, iv = null where tenant_id = '${tenant}';
      insert into private.seller_credentials (tenant_id, mode, ciphertext, iv, key_version, hint, version)
      values ('${tenant}', 'byok', 'bmV3LWNpcGhlcnRleHQtMTIzNDU2', 'aXYtMTIzNDU2Nzg=', 'v1', 'NEW', 2)`);
    const { data } = await machine().rpc("dispatch_begin_reconcile", { p_operation: op });
    expect((data as { credential: unknown }).credential).toBeNull();
  });

  it("queued or finished operations cannot be reconciled or recorded out of order", async () => {
    const f = await realOperation();
    expect((await machine().rpc("dispatch_begin_reconcile", { p_operation: f.op })).error?.message).toBe("nothing_to_reconcile");
    expect((await machine().rpc("dispatch_record", { p_operation: f.op, p_attempt: 0, p_outcome: "issued", p_order_id: "261014AAAAAA", p_tracking: "JO00000001", p_batch: "26101416AAAAAA" })).error?.message).toBe("not_dispatched");
  });
});

describe("recipient area id is draft content (PR-7)", () => {
  it("members set it on a draft (revision bumps) and it is fixed after submission", async () => {
    const owner = await signIn("owner-a@geraiexpress.test");
    const { data: draft } = await owner.rpc("create_shipment_draft", { p_outlet: "00000000-0000-4000-c000-00000000000a" });
    const id = draft as string;
    const before = Number(sql(`select revision from public.shipments where id = '${id}'`));
    expect((await owner.from("shipments").update({ recipient_area_id: "5fc63169f8f44b34aa4c2ee1" }).eq("id", id)).error).toBeNull();
    expect(Number(sql(`select revision from public.shipments where id = '${id}'`))).toBe(before + 1);
    expect((await owner.from("shipments").update({ recipient_area_id: "not-an-area" }).eq("id", id)).error).not.toBeNull();
    sql(`update public.shipments set submission_state = 'issued' where id = '${id}'`);
    await owner.from("shipments").update({ recipient_area_id: "5fc62f60f8f44b34aa4c0dcd" }).eq("id", id);
    expect(sql(`select recipient_area_id from public.shipments where id = '${id}'`)).toBe("5fc63169f8f44b34aa4c2ee1");
  });
});
