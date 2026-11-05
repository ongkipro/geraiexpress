// T-110 / DR-1 / TD-3: an operation that was queued when the post-restore fence was cleared carries
// restore_check_required. Before its first create the dispatcher looks the reference up at Mengantar
// (read-only): one live order => recorded like reconciliation, several => unknown, none => the flag is
// cleared and the order is created once; a failed lookup or a refused check => released with the flag
// kept. Every branch but "none" sends NO create.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { credentialAad, sealCredential } from "../../src/lib/credential-crypto";
import { dispatchOperation, reconcileOperation, type Rpc } from "../../src/lib/mengantar/dispatcher";

const SEAL_KEY = Buffer.alloc(32, 9).toString("base64");
const SELLER_KEY = "API-UNITTESTKEY0001";
const TENANT = "00000000-0000-4000-b000-0000000000d1";
const REF = "GX261014-ABC123";
const CREATED = "2026-10-14T08:30:00Z";
const fixture = (name: string) => JSON.parse(readFileSync(new URL(`fixtures/mengantar/${name}`, import.meta.url), "utf8"));

async function claimPayload(overrides: Record<string, unknown> = {}) {
  const sealed = await sealCredential(SELLER_KEY, credentialAad(TENANT, 2), SEAL_KEY);
  return {
    operation_id: "op-1", tenant_id: TENANT, attempt: 3, provider_env: "sandbox", dispatched_at: "2026-10-14T09:00:00Z",
    reference: REF, courier: "JT", pickup_address_id: "6acf44a4771fe2b474c055ca", pickup_area_id: "5fc62f60f8f44b34aa4c0dcd",
    recipient: { area_id: "5fc63169f8f44b34aa4c2ee1", address: "Jl. Uji 1", name: "Penerima", phone: "+6281234567890" },
    weight_grams: 1000, item_description: "Dokumen", goods_value_idr: 50000,
    credential: { ciphertext: sealed.ciphertext, iv: sealed.iv, key_version: sealed.keyVersion, version: 2 },
    restore_check_required: true, created_at: CREATED,
    ...overrides,
  };
}

function harness(claim: unknown, opts: { passed?: { data?: unknown; error?: { message: string } | null } } = {}) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const rpc: Rpc = async (fn, args) => {
    calls.push({ fn, args });
    if (fn === "dispatch_claim") return { data: claim, error: null };
    if (fn === "dispatch_restore_check_passed") return { data: opts.passed?.data ?? { stale: false }, error: opts.passed?.error ?? null };
    return { data: null, error: null };
  };
  return { rpc, calls, names: () => calls.map((c) => c.fn), recorded: () => calls.filter((c) => c.fn === "dispatch_record").map((c) => c.args) };
}

// GET /address answers from the fixture, GET /order (the reference lookup) with `orders` (or throws), POST
// /order (create) with an issued order. Counts the creates.
function transport(orders: unknown[] | "throw") {
  let creates = 0;
  let lookups = 0;
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(url)).pathname;
    if (path.endsWith("/address")) return json(fixture("address-list-sandbox.json"));
    if (path.endsWith("/order") && init?.method === "POST") {
      creates += 1;
      const b = fixture("order-create-jt-issued.json");
      b.data[0].destinationMark = REF;
      return json(b);
    }
    if (path.endsWith("/order")) {
      lookups += 1;
      if (orders === "throw") throw new TypeError("fetch failed");
      return json({ success: true, data: orders });
    }
    throw new Error(`unexpected ${path}`);
  }) as typeof fetch;
  return { impl, creates: () => creates, lookups: () => lookups };
}

const deps = (rpc: Rpc, fetchImpl: typeof fetch) => ({ rpc, environment: "sandbox" as const, credentialKey: SEAL_KEY, fetchImpl });
const order = (over: Record<string, unknown> = {}) => ({ ORDER_ID: "261014LKLL3E", batch: "26101416OJ04NF", destinationMark: REF, status: "active", isPaid: false, cnote_no: null, createdAt: "2026-10-14T09:01:00Z", ...over });
const older = { ORDER_ID: "261014OLDOLD", destinationMark: "", status: "active", isPaid: true, cnote_no: "JO1", createdAt: "2026-10-14T07:00:00Z" };

describe("restore check before create (T-110)", () => {
  it("one live order with our reference: recorded as found, no create", async () => {
    const h = harness(await claimPayload());
    const t = transport([order({ isPaid: true, cnote_no: "JO6948371799", estimatedPrice: 97994 }), older]);
    expect(await dispatchOperation("op-1", deps(h.rpc, t.impl))).toMatchObject({ status: "recorded", outcome: "issued" });
    expect(t.creates()).toBe(0);
    expect(h.recorded()).toEqual([{ p_operation: "op-1", p_attempt: 3, p_outcome: "issued", p_order_id: "261014LKLL3E",
      p_tracking: "JO6948371799", p_batch: "26101416OJ04NF", p_code: "RECONCILED", p_price: 97994 }]);
    expect(h.names()).not.toContain("dispatch_restore_check_passed");

    const unpaid = harness(await claimPayload());
    const t2 = transport([order(), older]);
    expect(await dispatchOperation("op-1", deps(unpaid.rpc, t2.impl))).toMatchObject({ status: "recorded", outcome: "unpaid" });
    expect(t2.creates()).toBe(0);
  });

  it("several live orders: recorded as unknown for reconciliation, no create", async () => {
    const h = harness(await claimPayload());
    const t = transport([order(), order({ ORDER_ID: "261014SECOND", createdAt: "2026-10-14T09:00:30Z" }), older]);
    expect(await dispatchOperation("op-1", deps(h.rpc, t.impl))).toEqual({ status: "recorded", outcome: "unknown" });
    expect(t.creates()).toBe(0);
    expect(h.recorded()).toEqual([{ p_operation: "op-1", p_attempt: 3, p_outcome: "unknown", p_code: "DUPLICATE_ORDERS" }]);
  });

  it("only an error item: unknown, never a new create", async () => {
    const h = harness(await claimPayload());
    const errorRow = { batch: "26101416ZI8BP1", destinationMark: REF, status: "error", isPaid: true, cnote_no: null, createdAt: "2026-10-14T09:01:00Z" };
    const t = transport([errorRow, older]);
    await dispatchOperation("op-1", deps(h.rpc, t.impl));
    expect(t.creates()).toBe(0);
    expect(h.recorded()).toEqual([{ p_operation: "op-1", p_attempt: 3, p_outcome: "unknown", p_code: "RESTORE_CHECK_ERROR_ITEM" }]);
  });

  it("no order with our reference: the flag is cleared, then exactly one create", async () => {
    const h = harness(await claimPayload());
    const t = transport([older]);
    expect(await dispatchOperation("op-1", deps(h.rpc, t.impl))).toMatchObject({ status: "recorded", outcome: "issued" });
    expect(t.lookups()).toBeGreaterThan(0);
    expect(t.creates()).toBe(1);
    const passedAt = h.names().indexOf("dispatch_restore_check_passed");
    expect(passedAt).toBeGreaterThan(0);
    expect(h.calls[passedAt].args).toEqual({ p_operation: "op-1", p_attempt: 3 });
    expect(h.names().indexOf("dispatch_record")).toBeGreaterThan(passedAt);
  });

  it("an order created before the new attempt (between the backup and the restore) is found", async () => {
    // The old attempt's order predates this claim's dispatched_at (09:00) but not the operation itself.
    const h = harness(await claimPayload({ dispatched_at: "2026-10-14T12:00:00Z" }));
    const t = transport([order({ createdAt: "2026-10-14T08:45:00Z" }), older]);
    expect(await dispatchOperation("op-1", deps(h.rpc, t.impl))).toMatchObject({ status: "recorded", outcome: "unpaid" });
    expect(t.creates()).toBe(0);
  });

  it("a failed lookup releases the claim with the flag kept: no create", async () => {
    const h = harness(await claimPayload());
    const t = transport("throw");
    expect(await dispatchOperation("op-1", deps(h.rpc, t.impl))).toEqual({ status: "not_claimed", reason: "restore_check_pending" });
    expect(t.creates()).toBe(0);
    expect(h.names()).toEqual(["dispatch_claim", "dispatch_release"]);
    expect(h.recorded()).toEqual([]);

    // An unreadable or endless list is a failed lookup too.
    const h2 = harness(await claimPayload());
    const t2 = transport([{ ORDER_ID: "x" }]);
    expect(await dispatchOperation("op-1", deps(h2.rpc, t2.impl))).toEqual({ status: "not_claimed", reason: "restore_check_pending" });
    expect(t2.creates()).toBe(0);
  });

  it("a fence engaged again (or any refusal) at check-passed releases: no create", async () => {
    for (const [message, reason] of [["provider_fence_engaged", "provider_fence_engaged"], ["stale_attempt", "restore_check_pending"]] as const) {
      const h = harness(await claimPayload(), { passed: { error: { message } } });
      const t = transport([older]);
      expect(await dispatchOperation("op-1", deps(h.rpc, t.impl))).toEqual({ status: "not_claimed", reason });
      expect(t.creates()).toBe(0);
      expect(h.names().at(-1)).toBe("dispatch_release");
    }
  });

  it("a check that found nothing for an operation past the quote window ends as quote_stale: no create", async () => {
    const h = harness(await claimPayload(), { passed: { data: { stale: true } } });
    const t = transport([older]);
    expect(await dispatchOperation("op-1", deps(h.rpc, t.impl))).toEqual({ status: "recorded", outcome: "quote_stale" });
    expect(t.creates()).toBe(0);
  });

  it("an operation without the flag is created directly, with no lookup", async () => {
    const h = harness(await claimPayload({ restore_check_required: false }));
    const t = transport([older]);
    await dispatchOperation("op-1", deps(h.rpc, t.impl));
    expect(t.lookups()).toBe(0);
    expect(t.creates()).toBe(1);
    expect(h.names()).not.toContain("dispatch_restore_check_passed");
  });
});

describe("restore-check operations: ordering and later reconciliation (T-110 review)", () => {
  it("is checked before any local refusal: an incomplete or pickup-less operation with an order is recorded as found", async () => {
    for (const override of [{ goods_value_idr: 0 }, { pickup_address_id: "000000000000000000000000" }]) {
      const h = harness(await claimPayload(override));
      const t = transport([order(), older]);
      expect(await dispatchOperation("op-1", deps(h.rpc, t.impl))).toMatchObject({ status: "recorded", outcome: "unpaid" });
      expect(t.creates()).toBe(0);
      expect(h.recorded()).toEqual([expect.objectContaining({ p_outcome: "unpaid", p_code: "RECONCILED" })]);
    }
  });

  // The pre-restore order (08:45) predates the post-restore attempt (12:00) by hours. Page 1 holds only
  // newer unrelated orders and ends below the dispatched_at cutoff, so a scan from dispatched_at stops
  // there and would conclude "not created"; a scan from created_at reads page 2 and finds the order.
  function pagedTransport() {
    const pages: Record<string, unknown[]> = {
      "1": [
        { ORDER_ID: "261014NEWER1", destinationMark: "GX261014-OTHER1", status: "active", isPaid: true, cnote_no: "JO2", createdAt: "2026-10-14T11:59:00Z" },
        { ORDER_ID: "261014NEWER2", destinationMark: "GX261014-OTHER2", status: "active", isPaid: true, cnote_no: "JO3", createdAt: "2026-10-14T11:30:00Z" },
      ],
      "2": [order({ createdAt: "2026-10-14T08:45:00Z" }), older],
      "3": [],
    };
    const seen: string[] = [];
    const impl = (async (url: string | URL | Request) => {
      const u = new URL(String(url));
      const page = u.searchParams.get("page") ?? "1";
      seen.push(page);
      return new Response(JSON.stringify({ success: true, data: pages[page] ?? [] }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    return { impl, seen };
  }
  const unknownPayload = (over: Record<string, unknown> = {}) => claimPayload({ operation_state: "unknown", dispatched_at: "2026-10-14T12:00:00Z", ...over });
  const reconcileRpc = (payload: unknown) => {
    const calls: { fn: string; args: Record<string, unknown> }[] = [];
    const rpc: Rpc = async (fn, args) => {
      calls.push({ fn, args });
      return { data: fn === "dispatch_begin_reconcile" ? payload : null, error: null };
    };
    return { rpc, recorded: () => calls.filter((c) => c.fn === "dispatch_record").map((c) => c.args) };
  };

  it("reconciles an unknown restore-check operation from created_at: the pre-restore order is found, never not_created", async () => {
    const r = reconcileRpc(await unknownPayload());
    const t = pagedTransport();
    expect(await reconcileOperation("op-1", deps(r.rpc, t.impl))).toMatchObject({ status: "recorded", outcome: "unpaid" });
    expect(t.seen).toContain("2");
    expect(r.recorded()).toEqual([expect.objectContaining({ p_outcome: "unpaid", p_order_id: "261014LKLL3E", p_code: "RECONCILED" })]);
  });

  it("an ordinary operation still scans from dispatched_at (the same pages conclude not_created)", async () => {
    const r = reconcileRpc(await unknownPayload({ restore_check_required: false }));
    const t = pagedTransport();
    await reconcileOperation("op-1", deps(r.rpc, t.impl));
    expect(t.seen).toEqual(["1"]);
    expect(r.recorded()).toEqual([expect.objectContaining({ p_outcome: "not_created" })]);
  });

  it("a restore-check operation without a readable created_at concludes nothing", async () => {
    const r = reconcileRpc(await unknownPayload({ created_at: null }));
    const t = pagedTransport();
    expect(await reconcileOperation("op-1", deps(r.rpc, t.impl))).toEqual({ status: "inconclusive", reason: "missing_attempt" });
    expect(t.seen).toEqual([]);
    expect(r.recorded()).toEqual([]);
  });
});
