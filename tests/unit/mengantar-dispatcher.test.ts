import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { credentialAad, sealCredential } from "../../src/lib/credential-crypto";
import { dispatchOperation, providerPhone, reconcileOperation, type Rpc } from "../../src/lib/mengantar/dispatcher";

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

function fakeFetch(...bodies: { status?: number; body: unknown }[]) {
  const urls: string[] = [];
  const impl = (async (url: string | URL | Request) => {
    urls.push(String(url));
    const b = bodies[Math.min(urls.length - 1, bodies.length - 1)];
    return new Response(typeof b.body === "string" ? b.body : JSON.stringify(b.body), { status: b.status ?? 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { impl, urls };
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
    expect(r.recorded()).toEqual([{ p_operation: "op-1", p_attempt: 3, p_outcome: "issued", p_order_id: "261014LJ9GP7", p_tracking: "JO6844983511", p_batch: "26101416Q0L7LJ" }]);
  });

  it("records unpaid, provider error items, refusals and unknown outcomes truthfully", async () => {
    const unpaid = fixture("order-create-jt-unpaid.json");
    unpaid.data[0].destinationMark = REF;
    const cases: [unknown, { status?: number; body: unknown }, Record<string, unknown>][] = [
      [{}, { body: unpaid }, { p_outcome: "unpaid", p_order_id: "261014H0JAFR", p_batch: "26101416827JYE" }],
      [{}, { body: fixture("order-create-jne-item-error.json") }, { p_outcome: "failed", p_batch: "26101416ZI8BP1", p_record_id: "6acf44a4771fe2b474c055fd", p_code: "PROVIDER_ERROR_ITEM" }],
      [{}, { status: 400, body: { success: false, message: "Ekspedisi tidak mendukung Drop Off" } }, { p_outcome: "rejected", p_code: "PROVIDER_REJECTED" }],
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

  it("does nothing when the claim is refused, and reports a lost record without resending", async () => {
    const busy = fakeRpc({ error: { message: "account_busy" } });
    const f = fakeFetch({ body: issuedBody() });
    expect(await dispatchOperation("op-1", deps(busy.rpc, f.impl))).toEqual({ status: "not_claimed", reason: "account_busy" });
    expect(f.urls).toEqual([]);
    const lost = fakeRpc({ data: await payload() }, "connection reset");
    const g = fakeFetch({ body: issuedBody() });
    expect(await dispatchOperation("op-1", deps(lost.rpc, g.impl))).toEqual({ status: "record_failed", outcome: "issued" });
    expect(g.urls).toHaveLength(1);
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
    expect(res.recorded).toEqual([{ p_operation: "op-1", p_attempt: 3, p_outcome: "unpaid", p_order_id: "261014LKLL3E", p_batch: "26101416OJ04NF", p_code: "RECONCILED" }]);
    expect(res.urls.every((u) => !u.includes("/order?") || u.includes("courier=JT"))).toBe(true);
    res = await run([order({ isPaid: true, cnote_no: "JO6948371799" }), older]);
    expect(res.recorded[0]).toMatchObject({ p_outcome: "issued", p_tracking: "JO6948371799", p_order_id: "261014LKLL3E" });
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
