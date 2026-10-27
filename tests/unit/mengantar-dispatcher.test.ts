import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { credentialAad, sealCredential } from "../../src/lib/credential-crypto";
import { checkPayment, dispatchOperation, payUnpaidShipmentBatch, providerPhone, reconcileOperation, sweep, type Rpc } from "../../src/lib/mengantar/dispatcher";

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
    expect(r.recorded()).toEqual([{ p_operation: "op-1", p_attempt: 3, p_outcome: "issued", p_order_id: "261014LJ9GP7", p_tracking: "JO6844983511", p_batch: "26101416Q0L7LJ", p_price: 93000 }]);
  });

  it("records unpaid, provider error items, refusals and unknown outcomes truthfully", async () => {
    const unpaid = fixture("order-create-jt-unpaid.json");
    unpaid.data[0].destinationMark = REF;
    const cases: [unknown, { status?: number; body: unknown }, Record<string, unknown>][] = [
      [{}, { body: unpaid }, { p_outcome: "unpaid", p_order_id: "261014H0JAFR", p_batch: "26101416827JYE", p_price: 111600 }],
      [{}, { body: fixture("order-create-jne-item-error.json") }, { p_outcome: "failed", p_batch: "26101416ZI8BP1", p_record_id: "6acf44a4771fe2b474c055fd", p_code: "PROVIDER_ERROR_ITEM" }],
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
    const rpc: Rpc = async (fn, args) => {
      calls.push(`${fn}:${String(args.p_operation ?? "")}`);
      if (fn === "dispatch_due") return { data: [{ operation_id: "a", action: "dispatch" }, { operation_id: "b", action: "reconcile" }, { operation_id: "c", action: "payment" }], error: null };
      return { data: null, error: { message: "nothing" } };
    };
    const summary = await sweep(deps(rpc, fakeFetch({ body: {} }).impl));
    expect(summary.checked).toBe(3);
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

  async function batchClaim(overrides: Record<string, unknown> = {}) {
    const sealed = await sealCredential(SELLER_KEY, credentialAad(TENANT, 2), SEAL_KEY);
    return {
      claim_operation_id: "op-1",
      tenant_id: TENANT,
      provider_env: "sandbox",
      batch: "26101416827JYE",
      courier: "JT",
      batch_digest: "op-1:261014H0JAFR:111600",
      members: [
        { operation_id: "op-1", shipment_id: "ship-1", reference: REF, provider_order_id: "261014H0JAFR", customer_charge_idr: 111600 },
      ],
      credential: { ciphertext: sealed.ciphertext, iv: sealed.iv, key_version: sealed.keyVersion, version: 2 },
      ...overrides,
    };
  }

  it("verifies full batch membership, calls POST /order/pay-unpaid once, and records each paid member", async () => {
    const calls: { fn: string; args: Record<string, unknown> }[] = [];
    const claim = await batchClaim();
    const rpc: Rpc = async (fn, args) => {
      calls.push({ fn, args });
      if (fn === "dispatch_begin_batch_payment") return { data: claim, error: null };
      if (fn === "dispatch_record_payment") return { data: { state: "succeeded", replayed: false, price_mismatch: false }, error: null };
      return { data: { released: true }, error: null };
    };
    const f = fakeFetch(
      // 1. listOrdersByBatch (page 1)
      { body: { success: true, data: [{ ORDER_ID: "261014H0JAFR", batch: "26101416827JYE", destinationMark: REF, estimatedPrice: 111600, status: "active", isPaid: false, cnote_no: null, createdAt: "2026-10-14T09:12:10Z" }] } },
      // 2. payUnpaidBatch
      { body: { success: true, data: [{ orderId: "261014H0JAFR", cnote_no: "JO6948371799", isPaid: true }] } },
      // 3. findOrder("261014H0JAFR", "JT")
      { body: { success: true, data: [{ ORDER_ID: "261014H0JAFR", batch: "26101416827JYE", destinationMark: REF, estimatedPrice: 111600, status: "active", isPaid: true, cnote_no: "JO6948371799", createdAt: "2026-10-14T09:12:10Z" }] } },
    );

    const summary = await payUnpaidShipmentBatch("ship-1", "op-1:261014H0JAFR:111600", deps(rpc, f.impl));
    expect(summary).toEqual({ status: "recorded", outcome: "issued" });
    expect(f.urls.filter((u) => u.endsWith("/order/pay-unpaid"))).toHaveLength(1);
    expect(calls.map((c) => c.fn)).toEqual([
      "dispatch_begin_batch_payment",
      "dispatch_record_payment",
      "dispatch_release_batch_payment",
    ]);
    expect(calls[1].args).toEqual({
      p_operation: "op-1",
      p_order_id: "261014H0JAFR",
      p_paid: true,
      p_tracking: "JO6948371799",
      p_price: 111600,
    });
  });

  it("refuses to call pay-unpaid when the live Mengantar batch contains an unknown or foreign order", async () => {
    const calls: { fn: string; args: Record<string, unknown> }[] = [];
    const claim = await batchClaim();
    const rpc: Rpc = async (fn, args) => {
      calls.push({ fn, args });
      if (fn === "dispatch_begin_batch_payment") return { data: claim, error: null };
      return { data: { released: true }, error: null };
    };
    const f = fakeFetch({
      body: {
        success: true,
        data: [
          { ORDER_ID: "261014H0JAFR", batch: "26101416827JYE", destinationMark: REF, estimatedPrice: 111600, status: "active", isPaid: false, cnote_no: null, createdAt: "2026-10-14T09:12:10Z" },
          { ORDER_ID: "261014FOREIGN", batch: "26101416827JYE", destinationMark: "GX261014-FOREIGN", estimatedPrice: 50000, status: "active", isPaid: false, cnote_no: null, createdAt: "2026-10-14T09:12:11Z" },
        ],
      },
    });
    const summary = await payUnpaidShipmentBatch("ship-1", "op-1:261014H0JAFR:111600", deps(rpc, f.impl));
    expect(summary).toEqual({ status: "not_reconcilable", reason: "batch_scope_mismatch" });
    expect(f.urls.filter((u) => u.endsWith("/order/pay-unpaid"))).toHaveLength(0);
    expect(calls.at(-1)?.fn).toBe("dispatch_release_batch_payment");
  });

  it("reconciles via findOrder without resending when pay-unpaid times out or returns 504", async () => {
    const calls: { fn: string; args: Record<string, unknown> }[] = [];
    const claim = await batchClaim();
    const rpc: Rpc = async (fn, args) => {
      calls.push({ fn, args });
      if (fn === "dispatch_begin_batch_payment") return { data: claim, error: null };
      if (fn === "dispatch_record_payment") return { data: { state: "succeeded", replayed: false, price_mismatch: false }, error: null };
      return { data: { released: true }, error: null };
    };
    const f = fakeFetch(
      // 1. listOrdersByBatch
      { body: { success: true, data: [{ ORDER_ID: "261014H0JAFR", batch: "26101416827JYE", destinationMark: REF, estimatedPrice: 111600, status: "active", isPaid: false, cnote_no: null, createdAt: "2026-10-14T09:12:10Z" }] } },
      // 2. payUnpaidBatch -> 504 gateway timeout
      { status: 504, body: "gateway timeout" },
      // 3. findOrder -> payment actually succeeded at Mengantar!
      { body: { success: true, data: [{ ORDER_ID: "261014H0JAFR", batch: "26101416827JYE", destinationMark: REF, estimatedPrice: 111600, status: "active", isPaid: true, cnote_no: "JO6948371799", createdAt: "2026-10-14T09:12:10Z" }] } },
    );

    const summary = await payUnpaidShipmentBatch("ship-1", "op-1:261014H0JAFR:111600", deps(rpc, f.impl));
    expect(summary).toEqual({ status: "recorded", outcome: "issued" });
    expect(f.urls.filter((u) => u.endsWith("/order/pay-unpaid"))).toHaveLength(1);
    expect(calls.some((c) => c.fn === "dispatch_record_payment")).toBe(true);
  });
});

