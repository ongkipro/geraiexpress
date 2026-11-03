import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { credentialAad, sealCredential } from "../../src/lib/credential-crypto";
import { checkPayment, dispatchOperation, payUnpaidShipmentBatch, reconcileOperation, sweep, type Rpc } from "../../src/lib/mengantar/dispatcher";
import { providerPhone } from "../../src/lib/mengantar/public-api";

const SEAL_KEY = Buffer.alloc(32, 9).toString("base64");
const SELLER_KEY = "API-UNITTESTKEY0001";
const TENANT = "00000000-0000-4000-b000-0000000000d1";
const REF = "GX261014-ABC123";
const fixture = (name: string) => JSON.parse(readFileSync(new URL(`fixtures/mengantar/${name}`, import.meta.url), "utf8"));

async function payload(overrides: Record<string, unknown> = {}) {
  const sealed = await sealCredential(SELLER_KEY, credentialAad(TENANT, 2), SEAL_KEY);
  return {
    operation_id: "op-1", tenant_id: TENANT, attempt: 3, provider_env: "sandbox", dispatched_at: "2026-10-14T09:00:00Z",
    reference: REF, courier: "JT", pickup_address_id: "6acf44a4771fe2b474c055ca",
    pickup_area_id: "5fc62f60f8f44b34aa4c0dcd",
    recipient: { area_id: "5fc63169f8f44b34aa4c2ee1", address: "Jl. Uji 1", name: "Penerima", phone: "+6281234567890" },
    weight_grams: 1000, item_description: "Dokumen", goods_value_idr: 50000,
    credential: { ciphertext: sealed.ciphertext, iv: sealed.iv, key_version: sealed.keyVersion, version: 2 },
    ...overrides,
  };
}

function fakeRpc(first: { data?: unknown; error?: { message: string } | null }, recordError: string | null = null) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const rpc: Rpc = async (fn, args) => {
    calls.push({ fn, args });
    if (fn === "dispatch_record") return { data: null, error: recordError ? { message: recordError } : null };
    return { data: first.data ?? null, error: first.error ?? null };
  };
  return { rpc, calls, recorded: () => calls.filter((c) => c.fn === "dispatch_record").map((c) => c.args) };
}

// The seller's pickup list (GET /address) answers from the sandbox fixture unless overridden;
// every other request gets the given replies in order. `urls` lists only the non-pickup calls.
function fakeFetch(...bodies: { status?: number; body: unknown }[]) {
  const urls: string[] = [];
  let pickups: { status?: number; body: unknown } = { body: fixture("address-list-sandbox.json") };
  const reply = (b: { status?: number; body: unknown }) =>
    new Response(typeof b.body === "string" ? b.body : JSON.stringify(b.body), { status: b.status ?? 200, headers: { "content-type": "application/json" } });
  const impl = (async (url: string | URL | Request) => {
    if (new URL(String(url)).pathname.endsWith("/address")) return reply(pickups);
    urls.push(String(url));
    return reply(bodies[Math.min(urls.length - 1, bodies.length - 1)]);
  }) as typeof fetch;
  return { impl, urls, setPickups: (b: { status?: number; body: unknown }) => { pickups = b; } };
}

const deps = (rpc: Rpc, fetchImpl: typeof fetch) => ({ rpc, environment: "sandbox" as const, credentialKey: SEAL_KEY, fetchImpl });
const issuedBody = () => { const b = fixture("order-create-jt-issued.json"); b.data[0].destinationMark = REF; return b; };

describe("dispatchOperation (TD-3)", () => {
  it("claims, opens the sealed key, sends one order and records the issued resi", async () => {
    const r = fakeRpc({ data: await payload() });
    const f = fakeFetch({ body: issuedBody() });
    expect(await dispatchOperation("op-1", deps(r.rpc, f.impl))).toEqual({ status: "recorded", outcome: "issued" });
    expect(r.calls[0]).toEqual({ fn: "dispatch_claim", args: { p_operation: "op-1", p_env: "sandbox" } });
    expect(f.urls).toEqual([`https://sandbox.mengantar.com/api/public/${SELLER_KEY}/order`]);
    expect(r.recorded()).toEqual([{ p_operation: "op-1", p_attempt: 3, p_outcome: "issued", p_order_id: "261014LJ9GP7", p_tracking: "JO6844983511", p_batch: "26101416Q0L7LJ", p_price: 93000, p_batch_id: "6acf44c1771fe2b474c05676" }]);
  });

  it("records unpaid, provider error items, refusals and unknown outcomes truthfully", async () => {
    const unpaid = fixture("order-create-jt-unpaid.json");
    unpaid.data[0].destinationMark = REF;
    const cases: [unknown, { status?: number; body: unknown }, Record<string, unknown>][] = [
      [{}, { body: unpaid }, { p_outcome: "unpaid", p_order_id: "261014H0JAFR", p_batch: "26101416827JYE", p_price: 111600, p_batch_id: "6acf476a6b00a9b494ff04b8" }],
      [{}, { body: fixture("order-create-jne-item-error.json") }, { p_outcome: "failed", p_batch: "26101416ZI8BP1", p_record_id: "6acf44a4771fe2b474c055fd", p_code: "PROVIDER_ERROR_ITEM", p_batch_id: "6acf44a4771fe2b474c055dc" }],
      [{}, { status: 400, body: { success: false, message: "Ekspedisi tidak mendukung Drop Off" } }, { p_outcome: "rejected", p_code: "PROVIDER_REJECTED", p_detail: "Ekspedisi tidak mendukung Drop Off" }],
      [{}, { status: 403, body: { success: false, message: "Not allowed" } }, { p_outcome: "rejected", p_code: "NOT_ALLOWED" }],
      [{}, { status: 504, body: "gateway" }, { p_outcome: "unknown", p_code: "UNKNOWN_OUTCOME" }],
      [{}, { status: 409, body: { success: false } }, { p_outcome: "unknown", p_code: "UNKNOWN_OUTCOME" }],
    ];
    for (const [, reply, expected] of cases) {
      const r = fakeRpc({ data: await payload() });
      const f = fakeFetch(reply);
      await dispatchOperation("op-1", deps(r.rpc, f.impl));
      expect(f.urls).toHaveLength(1); // never resent
      expect(r.recorded()).toEqual([{ p_operation: "op-1", p_attempt: 3, ...expected }]);
    }
  });

  it("gives the operation back, sending nothing, when the key cannot be opened", async () => {
    for (const override of [{ credential: null }, { tenant_id: "00000000-0000-4000-b000-0000000000d2" } /* AAD mismatch */]) {
      const r = fakeRpc({ data: await payload(override) });
      const f = fakeFetch({ body: issuedBody() });
      expect(await dispatchOperation("op-1", deps(r.rpc, f.impl))).toEqual({ status: "not_claimed", reason: "credential_unavailable" });
      expect(f.urls).toEqual([]);
      expect(r.recorded()).toEqual([]);
      expect(r.calls.at(-1)).toEqual({ fn: "dispatch_release", args: { p_operation: "op-1", p_attempt: 3 } });
    }
    const wrongDeploy = fakeRpc({ data: await payload() });
    const f = fakeFetch({ body: issuedBody() });
    expect(await dispatchOperation("op-1", { ...deps(wrongDeploy.rpc, f.impl), credentialKey: Buffer.alloc(32, 1).toString("base64") }))
      .toEqual({ status: "not_claimed", reason: "credential_unavailable" });
    expect(f.urls).toEqual([]);
  });

  it("sends nothing when the shipment is incomplete", async () => {
    for (const [override, code] of [
      [{ goods_value_idr: 0 }, "INPUT_INCOMPLETE"],
      [{ recipient: { area_id: null, address: "Jl. Uji 1", name: "P", phone: "081234567890" } }, "INPUT_INCOMPLETE"],
      [{ recipient: { area_id: "5fc63169f8f44b34aa4c2ee1", address: "Jl. Uji 1", name: "P", phone: "12345" } }, "INPUT_INCOMPLETE"],
      [{ courier: "Ninja" }, "INPUT_INVALID"],
    ] as const) {
      const r = fakeRpc({ data: await payload(override) });
      const f = fakeFetch({ body: issuedBody() });
      await dispatchOperation("op-1", deps(r.rpc, f.impl));
      expect(f.urls).toEqual([]);
      expect(r.recorded()).toEqual([{ p_operation: "op-1", p_attempt: 3, p_outcome: "rejected", p_code: code }]);
    }
  });

  it("sends nothing for an operation that waited too long (the database failed it as stale)", async () => {
    const r = fakeRpc({ data: { stale: true } });
    const f = fakeFetch({ body: issuedBody() });
    expect(await dispatchOperation("op-1", deps(r.rpc, f.impl))).toEqual({ status: "recorded", outcome: "quote_stale" });
    expect(f.urls).toEqual([]);
    expect(r.recorded()).toEqual([]);
  });

  it("passes the database's price flags through: mismatch, unreadable, matching", async () => {
    const run = async (price_mismatch: boolean | null) => {
      const rpc: Rpc = async (fn) => {
        if (fn === "dispatch_claim") return { data: await payload(), error: null };
        if (fn === "dispatch_record") return { data: { state: "succeeded", replayed: false, price_mismatch }, error: null };
        return { data: null, error: null };
      };
      return dispatchOperation("op-1", deps(rpc, fakeFetch({ body: issuedBody() }).impl));
    };
    expect(await run(true)).toEqual({ status: "recorded", outcome: "issued", priceMismatch: true });
    expect(await run(null)).toEqual({ status: "recorded", outcome: "issued", priceUnknown: true });
    expect(await run(false)).toEqual({ status: "recorded", outcome: "issued" });
  });

  it("does nothing when the claim is refused, and reports a lost record without resending", async () => {
    const busy = fakeRpc({ error: { message: "account_busy" } });
    const f = fakeFetch({ body: issuedBody() });
    expect(await dispatchOperation("op-1", deps(busy.rpc, f.impl))).toEqual({ status: "not_claimed", reason: "account_busy" });
    expect(f.urls).toEqual([]);
    const lost = fakeRpc({ data: await payload() }, "connection reset");
    const g = fakeFetch({ body: issuedBody() });
    expect(await dispatchOperation("op-1", deps(lost.rpc, g.impl))).toEqual({ status: "record_failed", outcome: "issued", reason: "connection reset" });
    expect(g.urls).toHaveLength(1);
  });

  it("re-checks the outlet pickup at Mengantar before sending", async () => {
    const gone = fakeRpc({ data: await payload() });
    const f = fakeFetch({ body: issuedBody() });
    f.setPickups({ body: { success: true, data: [] } });
    await dispatchOperation("op-1", deps(gone.rpc, f.impl));
    expect(f.urls).toEqual([]); // no order sent
    expect(gone.recorded()).toEqual([{ p_operation: "op-1", p_attempt: 3, p_outcome: "rejected", p_code: "PICKUP_NOT_FOUND" }]);
    // The pickup check itself failing sent nothing either: the operation goes back to the queue.
    const down = fakeRpc({ data: await payload() });
    const g = fakeFetch({ body: issuedBody() });
    g.setPickups({ status: 502, body: "bad gateway" });
    expect(await dispatchOperation("op-1", deps(down.rpc, g.impl))).toEqual({ status: "not_claimed", reason: "mengantar_unavailable" });
    expect(g.urls).toEqual([]);
    expect(down.calls.at(-1)?.fn).toBe("dispatch_release");
  });

  it("does not substitute another pickup, or send when the frozen pickup moved to another area", async () => {
    for (const change of [
      { _id: "7bcf44a4771fe2b474c055cb" },
      { PICKUP_AUTOFILL: "6ed62f60f8f44b34aa4c0dce" },
    ]) {
      const r = fakeRpc({ data: await payload() });
      const f = fakeFetch({ body: issuedBody() });
      const addresses = fixture("address-list-sandbox.json");
      Object.assign(addresses.data[0], change);
      f.setPickups({ body: addresses });
      expect(await dispatchOperation("op-1", deps(r.rpc, f.impl))).toEqual({ status: "recorded", outcome: "rejected" });
      expect(f.urls).toEqual([]);
      expect(r.recorded()).toEqual([{ p_operation: "op-1", p_attempt: 3, p_outcome: "rejected", p_code: "PICKUP_NOT_FOUND" }]);
    }
  });

  it("formats Indonesian mobile numbers for Mengantar", () => {
    expect(providerPhone("+6281234567890")).toBe("081234567890");
    expect(providerPhone("6281234567890")).toBe("081234567890");
    expect(providerPhone("081234567890")).toBe("081234567890");
    expect(providerPhone("12345678")).toBeNull();
    expect(providerPhone(null)).toBeNull();
  });
});

describe("reconcileOperation (TD-3 step 5)", () => {
  const order = (over: Record<string, unknown> = {}) => ({ ORDER_ID: "261014LKLL3E", batch: "26101416OJ04NF", destinationMark: REF, status: "active", isPaid: false, cnote_no: null, createdAt: "2026-10-14T09:01:00Z", ...over });
  const older = { ORDER_ID: "261014OLDOLD", destinationMark: "", status: "active", isPaid: true, cnote_no: "JO1", createdAt: "2026-10-14T08:00:00Z" };

  async function run(rows: unknown[], payloadOverride: Record<string, unknown> = {}, recordError: string | null = null) {
    const r = fakeRpc({ data: await payload(payloadOverride) }, recordError);
    const f = fakeFetch({ body: { success: true, data: rows } });
    const summary = await reconcileOperation("op-1", deps(r.rpc, f.impl));
    return { summary, recorded: r.recorded(), urls: f.urls };
  }

  it("records the order found by reference: unpaid, or issued with its resi", async () => {
    let res = await run([order(), older]);
    expect(res.recorded).toEqual([{ p_operation: "op-1", p_attempt: 3, p_outcome: "unpaid", p_order_id: "261014LKLL3E", p_batch: "26101416OJ04NF", p_code: "RECONCILED", p_price: null }]);
    expect(res.urls.every((u) => !u.includes("/order?") || u.includes("courier=JT"))).toBe(true);
    res = await run([order({ isPaid: true, cnote_no: "JO6948371799", estimatedPrice: 97994 }), older]);
    expect(res.recorded[0]).toMatchObject({ p_outcome: "issued", p_tracking: "JO6948371799", p_order_id: "261014LKLL3E", p_price: 97994 });
  });

  it("concludes 'not created' only after a complete scan, and 'failed' for an error item", async () => {
    expect((await run([older])).recorded).toEqual([{ p_operation: "op-1", p_attempt: 3, p_outcome: "not_created", p_code: "NOT_CREATED" }]);
    expect((await run([older], {}, "too_early")).summary).toEqual({ status: "inconclusive", reason: "too_early" });
    const errorRow = { ORDER_ID: undefined, batch: "26101416ZI8BP1", destinationMark: REF, status: "error", isPaid: true, cnote_no: null, createdAt: "2026-10-14T09:01:00Z" };
    expect((await run([errorRow, older])).recorded[0]).toMatchObject({ p_outcome: "failed", p_code: "PROVIDER_ERROR_ITEM" });
  });

  it("stays inconclusive on duplicates, unreadable lists, other environments and partial rows", async () => {
    const dup = await run([order(), order({ ORDER_ID: "261014SECOND", createdAt: "2026-10-14T09:00:30Z" }), older]);
    expect(dup.summary).toEqual({ status: "inconclusive", reason: "duplicate_orders" });
    expect(dup.recorded).toEqual([{ p_operation: "op-1", p_attempt: 3, p_outcome: "unknown", p_code: "DUPLICATE_ORDERS" }]);
    expect((await run([{ ORDER_ID: "x" }])).summary).toEqual({ status: "inconclusive", reason: "lookup_failed" });
    const prod = await run([order()], { provider_env: "production" });
    expect([prod.summary, prod.urls, prod.recorded]).toEqual([{ status: "inconclusive", reason: "wrong_environment" }, [], []]);
    expect((await run([order({ isPaid: true, cnote_no: null }), older])).summary).toEqual({ status: "inconclusive", reason: "incomplete_order" });
    expect((await run([order({ isPaid: false, cnote_no: "JO6948371799" }), older])).summary).toEqual({ status: "inconclusive", reason: "incomplete_order" });
    expect((await run([order({ batch: undefined }), older])).recorded).toEqual([]);
  });

  it("does nothing when the operation is not reconcilable", async () => {
    const r = fakeRpc({ error: { message: "nothing_to_reconcile" } });
    const f = fakeFetch({ body: { success: true, data: [] } });
    expect(await reconcileOperation("op-1", deps(r.rpc, f.impl))).toEqual({ status: "not_reconcilable", reason: "nothing_to_reconcile" });
    expect(f.urls).toEqual([]);
  });

  it("sends its environment and reads the database's environment refusal as wrong_environment (T-057)", async () => {
    const f = fakeFetch({ body: { success: true, data: [] } });
    for (const run of [reconcileOperation, checkPayment]) {
      const calls: Record<string, unknown>[] = [];
      const rpc: Rpc = async (_fn, args) => { calls.push(args); return { data: null, error: { message: "provider_env_mismatch" } }; };
      expect(await run("op-1", deps(rpc, f.impl))).toEqual({ status: "inconclusive", reason: "wrong_environment" });
      expect(calls).toEqual([{ p_operation: "op-1", p_env: "sandbox" }]);
    }
    expect(f.urls).toEqual([]);
  });
});

describe("checkPayment and sweep (T-024)", () => {
  const unpaidPayload = async (over: Record<string, unknown> = {}) => ({ ...(await payload()), provider_order_id: "261014H0JAFR", provider_batch: "26101416827JYE", ...over });
  const found = (over: Record<string, unknown>) => ({ success: true, data: [{ ORDER_ID: "261014H0JAFR", batch: "26101416827JYE", destinationMark: REF, status: "active", isPaid: false, cnote_no: null, createdAt: "2026-10-14T09:12:10Z", ...over }] });

  it("records the resi once the seller has paid, and nothing while still unpaid", async () => {
    const paid = fakeRpc({ data: await unpaidPayload() });
    const f = fakeFetch({ body: found({ isPaid: true, cnote_no: "JO6948371799" }) });
    expect(await checkPayment("op-1", deps(paid.rpc, f.impl))).toEqual({ status: "recorded", outcome: "issued" });
    expect(new URL(f.urls[0]).searchParams.get("order_id")).toBe("261014H0JAFR");
    expect(paid.recorded()).toEqual([{ p_operation: "op-1", p_attempt: 3, p_outcome: "issued", p_order_id: "261014H0JAFR", p_tracking: "JO6948371799", p_batch: "26101416827JYE", p_price: null }]);
    const still = fakeRpc({ data: await unpaidPayload() });
    expect(await checkPayment("op-1", deps(still.rpc, fakeFetch({ body: found({}) }).impl))).toEqual({ status: "inconclusive", reason: "still_unpaid" });
    expect(still.recorded()).toEqual([]);
    const other = fakeRpc({ data: await unpaidPayload({ provider_env: "production" }) });
    expect(await checkPayment("op-1", deps(other.rpc, fakeFetch({ body: found({ isPaid: true, cnote_no: "JO1234567" }) }).impl))).toEqual({ status: "inconclusive", reason: "wrong_environment" });
  });

  it("runs each due item with the matching step and survives one failing", async () => {
    const calls: string[] = [];
    let dueArgs: Record<string, unknown> = {};
    const rpc: Rpc = async (fn, args) => {
      calls.push(`${fn}:${String(args.p_operation ?? "")}`);
      if (fn === "dispatch_due") dueArgs = args;
      if (fn === "dispatch_due") return { data: [{ operation_id: "a", action: "dispatch" }, { operation_id: "b", action: "reconcile" }, { operation_id: "c", action: "payment" }], error: null };
      return { data: null, error: { message: "nothing" } };
    };
    const summary = await sweep(deps(rpc, fakeFetch({ body: {} }).impl));
    expect(summary.checked).toBe(3);
    // The sweep reads only its own environment's work (T-057).
    expect(dueArgs).toMatchObject({ p_env: "sandbox" });
    expect(calls).toEqual(["dispatch_due:", "dispatch_claim:a", "dispatch_begin_reconcile:b", "dispatch_begin_payment_check:c", "dispatch_stuck_counts:"]);
    const broken: Rpc = async () => ({ data: null, error: { message: "down" } });
    expect(await sweep(deps(broken, fakeFetch({ body: {} }).impl))).toEqual({ checked: 0, failed: true, results: [] });
  });
});

describe("COD dispatch and payUnpaidShipmentBatch (T-025 / T-026)", () => {
  it("dispatches a COD shipment using COD amount instead of goodsValue and refuses incomplete COD payloads", async () => {
    const codIssued = fixture("order-create-jt-cod-issued.json");
    codIssued.data[0].destinationMark = REF;
    const bodies: unknown[] = [];
    const f = fakeFetch({ body: codIssued });
    const wrappedFetch = (async (url: string | URL | Request, init?: RequestInit) => {
      if (init?.body) bodies.push(JSON.parse(String(init.body)));
      return f.impl(url, init);
    }) as typeof fetch;

    const r = fakeRpc({ data: await payload({ is_cod: true, cod_amount_idr: 150000 }) });
    expect(await dispatchOperation("op-1", deps(r.rpc, wrappedFetch))).toEqual({ status: "recorded", outcome: "issued" });
    expect(bodies).toHaveLength(1);
    const sentOrder = (bodies[0] as { orders: Record<string, unknown>[] }).orders[0];
    expect(sentOrder.COD).toBe(150000);
    expect(sentOrder).not.toHaveProperty("goodsValue");

    const badCod = fakeRpc({ data: await payload({ is_cod: true, cod_amount_idr: null }) });
    const g = fakeFetch({ body: codIssued });
    await dispatchOperation("op-1", deps(badCod.rpc, g.impl));
    expect(g.urls).toEqual([]);
    expect(badCod.recorded()).toEqual([{ p_operation: "op-1", p_attempt: 3, p_outcome: "rejected", p_code: "INPUT_INCOMPLETE" }]);
  });

  const CODE = "26101416827JYE";
  const OBJECT_ID = "6acf476a6b00a9b494ff04b8";
  const ORDER = "261014H0JAFR";

  async function batchClaim(overrides: Record<string, unknown> = {}) {
    const sealed = await sealCredential(SELLER_KEY, credentialAad(TENANT, 2), SEAL_KEY);
    return {
      mode: "pay",
      attempt_id: "att-1",
      claim_operation_id: "op-1",
      tenant_id: TENANT,
      provider_env: "sandbox",
      batch: CODE,
      batch_id: OBJECT_ID,
      courier: "JT",
      batch_digest: "digest-1",
      members: [
        { operation_id: "op-1", shipment_id: "ship-1", reference: REF, provider_order_id: ORDER, customer_charge_idr: 111600 },
      ],
      credential: { ciphertext: sealed.ciphertext, iv: sealed.iv, key_version: sealed.keyVersion, version: 2 },
      ...overrides,
    };
  }

  // Scripted machine RPC: every call is recorded; `over` replaces the answer of one function.
  function payRpc(claim: unknown, over: Record<string, { data?: unknown; error?: { message: string } }> = {}) {
    const calls: { fn: string; args: Record<string, unknown> }[] = [];
    const rpc: Rpc = async (fn, args) => {
      calls.push({ fn, args });
      const o = over[fn];
      if (o) return { data: o.data ?? null, error: o.error ?? null };
      if (fn === "dispatch_begin_batch_payment") return { data: claim, error: null };
      if (fn === "dispatch_record_payment") return { data: { state: "succeeded", replayed: false, price_mismatch: false }, error: null };
      return { data: { state: "ok" }, error: null };
    };
    return { rpc, calls, names: () => calls.map((c) => c.fn), call: (fn: string) => calls.filter((c) => c.fn === fn) };
  }

  const jsonReply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  // A fake Mengantar for one unpaid batch whose code and object id differ. Like the documented
  // endpoint it accepts POST /order/pay-unpaid only with the object id (a code-valued body is refused).
  function fakeMengantar(onPay?: (state: { paid: boolean }) => Response, rows?: (row: Record<string, unknown>) => unknown[]) {
    const state = { paid: false };
    const posts: Record<string, unknown>[] = [];
    const gets: URL[] = [];
    const row = () => ({
      ORDER_ID: ORDER, batch: CODE, batch_id: OBJECT_ID, destinationMark: REF, estimatedPrice: 111600, status: "active",
      isPaid: state.paid, cnote_no: state.paid ? "JO6948371799" : null, createdAt: "2026-10-14T09:12:10Z",
    });
    const impl = (async (url: string | URL | Request, init?: RequestInit) => {
      const u = new URL(String(url));
      if (init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        posts.push(body);
        if (body.batch_id !== OBJECT_ID) return jsonReply({ success: false, message: "Batch tidak ditemukan" }, 400);
        if (onPay) return onPay(state);
        state.paid = true;
        return jsonReply(fixture("pay-unpaid-jt-success.json"));
      }
      gets.push(u);
      return jsonReply({ success: true, data: rows ? rows(row()) : [row()] });
    }) as typeof fetch;
    return { impl, state, posts, gets };
  }

  it("lists the batch by its code, pays with the object id, and records each paid member", async () => {
    const r = payRpc(await batchClaim());
    const m = fakeMengantar();
    expect(await payUnpaidShipmentBatch("ship-1", "digest-1", deps(r.rpc, m.impl))).toEqual({ status: "recorded", outcome: "issued" });
    // GET /order filters on the code; POST /order/pay-unpaid carries the object id (never the code).
    expect(m.gets[0].searchParams.get("batch")).toBe(CODE);
    expect(m.posts).toEqual([{ batch_id: OBJECT_ID, courier: "JT" }]);
    expect(r.names()).toEqual(["dispatch_begin_batch_payment", "dispatch_mark_batch_payment_sent", "dispatch_record_payment", "dispatch_finish_batch_payment"]);
    expect(r.call("dispatch_begin_batch_payment")[0].args).toEqual({ p_shipment: "ship-1", p_batch_digest: "digest-1", p_env: "sandbox" });
    // The write-ahead mark names the attempt and the id the request carries, before the POST.
    expect(r.call("dispatch_mark_batch_payment_sent")[0].args).toEqual({ p_attempt: "att-1", p_batch_object_id: OBJECT_ID });
    expect(r.call("dispatch_record_payment")[0].args).toEqual({ p_operation: "op-1", p_order_id: ORDER, p_paid: true, p_tracking: "JO6948371799", p_price: 111600 });
    expect(r.call("dispatch_finish_batch_payment")[0].args).toEqual({ p_attempt: "att-1", p_outcome: "paid", p_paid_count: 1 });
  });

  it("never sends the batch code as the payment id: a fake provider would refuse it", async () => {
    // A claim whose stored object id is missing takes the id from the provider's own rows; it can
    // never become the code. A stored id that disagrees with the provider is a scope mismatch.
    const fromProvider = payRpc(await batchClaim({ batch_id: null }));
    const m = fakeMengantar();
    expect((await payUnpaidShipmentBatch("ship-1", "digest-1", deps(fromProvider.rpc, m.impl))).status).toBe("recorded");
    expect(m.posts).toEqual([{ batch_id: OBJECT_ID, courier: "JT" }]);
    expect(fromProvider.call("dispatch_mark_batch_payment_sent")[0].args).toMatchObject({ p_batch_object_id: OBJECT_ID });

    const wrong = payRpc(await batchClaim({ batch_id: "6acf476a6b00a9b494ff0000" }));
    const m2 = fakeMengantar();
    expect(await payUnpaidShipmentBatch("ship-1", "digest-1", deps(wrong.rpc, m2.impl))).toEqual({ status: "not_reconcilable", reason: "batch_scope_mismatch" });
    expect(m2.posts).toEqual([]);
    expect(wrong.names()).toEqual(["dispatch_begin_batch_payment", "dispatch_release_batch_payment"]);

    // No object id anywhere (stored or read): nothing is guessed, nothing is sent.
    const none = payRpc(await batchClaim({ batch_id: null }));
    const m3 = fakeMengantar(undefined, (row) => [{ ...row, batch_id: undefined }]);
    expect(await payUnpaidShipmentBatch("ship-1", "digest-1", deps(none.rpc, m3.impl))).toEqual({ status: "not_reconcilable", reason: "batch_id_unavailable" });
    expect(m3.posts).toEqual([]);
    expect(none.call("dispatch_release_batch_payment")[0].args).toEqual({ p_attempt: "att-1" });
  });

  it("refuses to call pay-unpaid when the live Mengantar batch contains an unknown or foreign order", async () => {
    const r = payRpc(await batchClaim());
    const m = fakeMengantar(undefined, (row) => [row, { ...row, ORDER_ID: "261014FOREIGN", destinationMark: "GX261014-FOREIGN" }]);
    expect(await payUnpaidShipmentBatch("ship-1", "digest-1", deps(r.rpc, m.impl))).toEqual({ status: "not_reconcilable", reason: "batch_scope_mismatch" });
    expect(m.posts).toEqual([]);
    expect(r.call("dispatch_release_batch_payment")[0].args).toEqual({ p_attempt: "att-1" });
  });

  it("does not send when the attempt cannot be written ahead of the request", async () => {
    const r = payRpc(await batchClaim(), { dispatch_mark_batch_payment_sent: { error: { message: "stale_attempt" } } });
    const m = fakeMengantar();
    expect(await payUnpaidShipmentBatch("ship-1", "digest-1", deps(r.rpc, m.impl))).toEqual({ status: "inconclusive", reason: "attempt_not_recorded" });
    expect(m.posts).toEqual([]);
    expect(r.names().at(-1)).toBe("dispatch_release_batch_payment");
  });

  it("leaves the attempt unknown, without resending, when the answer is lost and the member still reads unpaid", async () => {
    for (const lost of [() => new Response("gateway timeout", { status: 504 }), () => { throw new TypeError("network down"); }]) {
      const r = payRpc(await batchClaim());
      const m = fakeMengantar(lost);
      expect(await payUnpaidShipmentBatch("ship-1", "digest-1", deps(r.rpc, m.impl))).toEqual({ status: "inconclusive", reason: "payment_unconfirmed" });
      expect(m.posts).toHaveLength(1);
      expect(r.call("dispatch_finish_batch_payment")[0].args).toEqual({ p_attempt: "att-1", p_outcome: "unknown" });
      // Never released: a sent attempt only ever reconciles.
      expect(r.call("dispatch_release_batch_payment")).toEqual([]);
      expect(r.call("dispatch_record_payment")[0].args).toMatchObject({ p_paid: false });
    }
  });

  it("reconciles a lost answer by per-order reads without resending when the payment did apply", async () => {
    const r = payRpc(await batchClaim());
    const m = fakeMengantar((state) => { state.paid = true; return new Response("gateway timeout", { status: 504 }); });
    expect(await payUnpaidShipmentBatch("ship-1", "digest-1", deps(r.rpc, m.impl))).toEqual({ status: "recorded", outcome: "issued" });
    expect(m.posts).toHaveLength(1);
    expect(r.call("dispatch_finish_batch_payment")[0].args).toEqual({ p_attempt: "att-1", p_outcome: "paid" });
  });

  it("checks the documented paid count against the batch: a mismatch is never success", async () => {
    // Mengantar says 2 orders were paid for a batch with 1 unpaid order; the member still reads unpaid.
    const r = payRpc(await batchClaim());
    const m = fakeMengantar(() => jsonReply({ success: true, data: 2, cnote_no: ["JO1", "JO2"] }));
    expect(await payUnpaidShipmentBatch("ship-1", "digest-1", deps(r.rpc, m.impl))).toEqual({ status: "inconclusive", reason: "payment_count_mismatch" });
    // The provider's own count travels with the outcome so the database can audit the difference.
    expect(r.call("dispatch_finish_batch_payment")[0].args).toEqual({ p_attempt: "att-1", p_outcome: "unknown", p_paid_count: 2 });
    // A count that disagrees with its own tracking list is the same.
    const r2 = payRpc(await batchClaim());
    const m2 = fakeMengantar(() => jsonReply({ success: true, data: 1, cnote_no: [] }));
    expect(await payUnpaidShipmentBatch("ship-1", "digest-1", deps(r2.rpc, m2.impl))).toEqual({ status: "inconclusive", reason: "payment_count_mismatch" });
    // A response without a readable count (the pre-documentation shapes) is an unknown outcome.
    const r3 = payRpc(await batchClaim());
    const m3 = fakeMengantar(() => jsonReply({ success: true, data: [{ cnote_no: "JO1" }] }));
    expect(await payUnpaidShipmentBatch("ship-1", "digest-1", deps(r3.rpc, m3.impl))).toEqual({ status: "inconclusive", reason: "payment_unconfirmed" });
    expect(r3.call("dispatch_finish_batch_payment")[0].args).toEqual({ p_attempt: "att-1", p_outcome: "unknown" });
    // Miscounted but read paid: resolved by the authoritative reads.
    const r4 = payRpc(await batchClaim());
    const m4 = fakeMengantar((state) => { state.paid = true; return jsonReply({ success: true, data: 5, cnote_no: ["JO6948371799"] }); });
    expect(await payUnpaidShipmentBatch("ship-1", "digest-1", deps(r4.rpc, m4.impl))).toEqual({ status: "recorded", outcome: "issued" });
  });

  it("ends the attempt as rejected on a definite refusal and surfaces the provider text", async () => {
    const r = payRpc(await batchClaim());
    const m = fakeMengantar(() => jsonReply({ success: false, message: "Saldo tidak mencukupi" }, 400));
    expect(await payUnpaidShipmentBatch("ship-1", "digest-1", deps(r.rpc, m.impl))).toEqual({ status: "not_reconcilable", reason: "mengantar_refused", detail: "Saldo tidak mencukupi" });
    expect(r.call("dispatch_finish_batch_payment")[0].args).toEqual({ p_attempt: "att-1", p_outcome: "rejected" });
    expect(m.posts).toHaveLength(1);
  });

  // Review-B-Security finding 3: a 400/403 on pay-unpaid is not proof that nothing was paid. The
  // per-order reads decide; "rejected" (final, payable again) needs every read clean and nothing paid.
  it("does not end the attempt as rejected when the refusal came after an order became paid", async () => {
    const REF2 = "GX261014-DEF456";
    const ORDER2 = "261014H0JAFS";
    const second = { paid: false };
    const claim = await batchClaim();
    claim.members.push({ operation_id: "op-2", shipment_id: "ship-2", reference: REF2, provider_order_id: ORDER2, customer_charge_idr: 111600 });
    const twoRows = (row: Record<string, unknown>) => [row, { ...row, ORDER_ID: ORDER2, destinationMark: REF2, isPaid: second.paid, cnote_no: second.paid ? "JO6948371800" : null }];

    // One of two orders got paid, then Mengantar answered 400: the attempt is "unknown", never "rejected".
    const r = payRpc(claim);
    const m = fakeMengantar((state) => { state.paid = true; return jsonReply({ success: false, message: "Batch sedang diproses" }, 400); }, twoRows);
    expect(await payUnpaidShipmentBatch("ship-1", "digest-1", deps(r.rpc, m.impl))).toEqual({ status: "inconclusive", reason: "payment_unconfirmed" });
    expect(m.posts).toHaveLength(1);
    expect(r.call("dispatch_finish_batch_payment").map((c) => c.args)).toEqual([{ p_attempt: "att-1", p_outcome: "unknown" }]);
    expect(r.call("dispatch_release_batch_payment")).toEqual([]);
    expect(r.call("dispatch_record_payment").map((c) => c.args.p_paid)).toEqual([true, false]);

    // Every order paid despite the 403/400: the attempt is "paid", the shipments get their resi.
    const r2 = payRpc(await batchClaim());
    const m2 = fakeMengantar((state) => { state.paid = true; return jsonReply({ success: false, message: "Not allowed" }, 403); });
    expect(await payUnpaidShipmentBatch("ship-1", "digest-1", deps(r2.rpc, m2.impl))).toEqual({ status: "recorded", outcome: "issued" });
    expect(r2.call("dispatch_finish_batch_payment").map((c) => c.args)).toEqual([{ p_attempt: "att-1", p_outcome: "paid" }]);

    // A read that fails after the refusal leaves it unknown: an unreadable order is not "unpaid".
    let broken = false;
    const r3 = payRpc(await batchClaim());
    const m3 = fakeMengantar(() => { broken = true; return jsonReply({ success: false, message: "Saldo tidak mencukupi" }, 400); }, (row) => {
      if (broken) throw new TypeError("network down");
      return [row];
    });
    expect(await payUnpaidShipmentBatch("ship-1", "digest-1", deps(r3.rpc, m3.impl))).toEqual({ status: "inconclusive", reason: "payment_unconfirmed" });
    expect(r3.call("dispatch_finish_batch_payment").map((c) => c.args)).toEqual([{ p_attempt: "att-1", p_outcome: "unknown" }]);

    // A member that cannot be recorded is not a clean read either.
    const r4 = payRpc(await batchClaim(), { dispatch_record_payment: { error: { message: "stale" } } });
    const m4 = fakeMengantar(() => jsonReply({ success: false, message: "x" }, 400));
    expect(await payUnpaidShipmentBatch("ship-1", "digest-1", deps(r4.rpc, m4.impl))).toEqual({ status: "inconclusive", reason: "payment_unconfirmed" });
    expect(r4.call("dispatch_finish_batch_payment").map((c) => c.args)).toEqual([{ p_attempt: "att-1", p_outcome: "unknown" }]);
  });

  it("sends nothing when Mengantar already shows every member paid, and frees the claim", async () => {
    const r = payRpc(await batchClaim());
    const m = fakeMengantar();
    m.state.paid = true;
    expect(await payUnpaidShipmentBatch("ship-1", "digest-1", deps(r.rpc, m.impl))).toEqual({ status: "recorded", outcome: "issued" });
    expect(m.posts).toEqual([]);
    expect(r.call("dispatch_mark_batch_payment_sent")).toEqual([]);
    expect(r.names().at(-1)).toBe("dispatch_release_batch_payment");
  });

  it("an unresolved earlier attempt is only reconciled: no list, no mark, no POST", async () => {
    const claim = await batchClaim({ mode: "reconcile" });
    // Still unpaid: the attempt keeps blocking (no finish call, no release).
    const r = payRpc(claim);
    const m = fakeMengantar();
    expect(await payUnpaidShipmentBatch("ship-1", "digest-1", deps(r.rpc, m.impl))).toEqual({ status: "inconclusive", reason: "payment_unresolved" });
    expect(m.posts).toEqual([]);
    expect(r.names()).toEqual(["dispatch_begin_batch_payment", "dispatch_record_payment"]);
    // The original paid result appears: the attempt is reconciled by the reads.
    const r2 = payRpc(claim);
    const m2 = fakeMengantar();
    m2.state.paid = true;
    expect(await payUnpaidShipmentBatch("ship-1", "digest-1", deps(r2.rpc, m2.impl))).toEqual({ status: "recorded", outcome: "issued" });
    expect(m2.posts).toEqual([]);
    expect(r2.call("dispatch_finish_batch_payment")[0].args).toEqual({ p_attempt: "att-1", p_outcome: "paid" });
    // The database refusing to call it paid keeps it unresolved.
    const r3 = payRpc(claim, { dispatch_finish_batch_payment: { error: { message: "members_not_paid" } } });
    const m3 = fakeMengantar();
    m3.state.paid = true;
    expect(await payUnpaidShipmentBatch("ship-1", "digest-1", deps(r3.rpc, m3.impl))).toEqual({ status: "inconclusive", reason: "payment_unresolved" });
  });

  it("a claim refused by the database (no authorization, busy, wrong digest) sends nothing", async () => {
    for (const message of ["authorization_required", "account_busy", "batch_digest_mismatch"]) {
      const r = payRpc(null, { dispatch_begin_batch_payment: { error: { message } } });
      const m = fakeMengantar();
      expect(await payUnpaidShipmentBatch("ship-1", "digest-1", deps(r.rpc, m.impl))).toEqual({ status: "not_reconcilable", reason: message });
      expect(m.gets).toEqual([]);
      expect(m.posts).toEqual([]);
      expect(r.names()).toEqual(["dispatch_begin_batch_payment"]);
    }
  });
});


describe("non-COD cargo through the dispatcher (T-080)", () => {
  const cargoIssued = () => { const b = issuedBody(); b.data[0].cargo = true; return b; };

  it("sends the frozen cargo mode as orders[].cargo on the base courier and records the issued resi", async () => {
    const r = fakeRpc({ data: await payload({ courier: "JNE", cargo: true, billable_weight_grams: 12000 }) });
    let body: { courier: string; orders: Record<string, unknown>[] } | null = null;
    const impl = (async (url: string | URL | Request, init?: RequestInit) => {
      if (new URL(String(url)).pathname.endsWith("/address")) return Response.json(fixture("address-list-sandbox.json"));
      body = JSON.parse(String(init?.body));
      return Response.json(cargoIssued());
    }) as typeof fetch;
    expect(await dispatchOperation("op-1", deps(r.rpc, impl))).toEqual({ status: "recorded", outcome: "issued" });
    expect(body!.courier).toBe("JNE");
    expect(body!.orders[0]).toMatchObject({ cargo: true, weight: 12, goodsValue: 50000 });
    expect(r.recorded()[0]).toMatchObject({ p_outcome: "issued" });
  });

  it("records UNKNOWN, never issued, when a cargo create answer lacks the cargo echo", async () => {
    const r = fakeRpc({ data: await payload({ courier: "JNE", cargo: true }) });
    const f = fakeFetch({ body: issuedBody() });
    expect(await dispatchOperation("op-1", deps(r.rpc, f.impl))).toEqual({ status: "recorded", outcome: "unknown" });
    expect(f.urls).toHaveLength(1);
  });

  it("refuses a cargo COD payload locally, sending nothing", async () => {
    const r = fakeRpc({ data: await payload({ courier: "JNE", cargo: true, is_cod: true, cod_amount_idr: 80000 }) });
    const f = fakeFetch({ body: cargoIssued() });
    expect(await dispatchOperation("op-1", deps(r.rpc, f.impl))).toMatchObject({ status: "recorded", outcome: "rejected" });
    expect(f.urls).toEqual([]);
  });

  it("legacy payloads without the field stay regular", async () => {
    const r = fakeRpc({ data: await payload() });
    let order: Record<string, unknown> | null = null;
    const impl = (async (url: string | URL | Request, init?: RequestInit) => {
      if (new URL(String(url)).pathname.endsWith("/address")) return Response.json(fixture("address-list-sandbox.json"));
      order = JSON.parse(String(init?.body)).orders[0];
      return Response.json(issuedBody());
    }) as typeof fetch;
    await dispatchOperation("op-1", deps(r.rpc, impl));
    expect(order).not.toHaveProperty("cargo");
  });

  it("does not settle a cargo operation with a found order of the other service, or the reverse", async () => {
    const found = (cargo: unknown) => ({ ORDER_ID: "261014LKLL3E", batch: "26101416OJ04NF", destinationMark: REF, status: "active",
      isPaid: true, cnote_no: "JO6948371799", createdAt: "2026-10-14T09:01:00Z", ...(cargo === undefined ? {} : { cargo }) });
    const run = async (payloadCargo: boolean | undefined, rowCargo: unknown) => {
      const r = fakeRpc({ data: await payload({ courier: "JNE", ...(payloadCargo === undefined ? {} : { cargo: payloadCargo }) }) });
      // An older row ends the newest-first scan (the attempt window is complete).
      const older = { ORDER_ID: "261014OLDOLD", destinationMark: "", status: "active", isPaid: true, cnote_no: "JO1", createdAt: "2026-10-14T08:00:00Z" };
      const f = fakeFetch({ body: { success: true, data: [found(rowCargo), older] } });
      return { summary: await reconcileOperation("op-1", deps(r.rpc, f.impl)), recorded: r.recorded() };
    };
    for (const [p, row] of [[true, false], [false, true], [undefined, true]] as const) {
      const res = await run(p, row);
      expect(res.summary, `${p}/${row}`).toEqual({ status: "inconclusive", reason: "service_mismatch" });
      expect(res.recorded).toEqual([]);
    }
    expect((await run(true, true)).recorded[0]).toMatchObject({ p_outcome: "issued" });
    // Mode absent on the read: unknown, not a contradiction; the reference and courier still match.
    expect((await run(true, undefined)).recorded[0]).toMatchObject({ p_outcome: "issued" });
  });
});
