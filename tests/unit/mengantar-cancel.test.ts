import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { credentialAad, sealCredential } from "../../src/lib/credential-crypto";
import { cancelShipment, judgeReadback } from "../../src/lib/mengantar/cancel";
import { createMengantarPublicClient, MengantarError, parseBatchDelete, type ProviderOrder } from "../../src/lib/mengantar/public-api";

vi.mock("server-only", () => ({}));

// T-045 slice 2: DELETE /order with an unknown outcome and a read-back, and the DELETE /batch refund parser.
// Fixtures are documentation-derived (see fixtures/mengantar/README-delete-fixtures.md).
const fixture = (name: string) => readFileSync(new URL(`fixtures/mengantar/${name}`, import.meta.url), "utf8");
const KEY = Buffer.alloc(32, 7).toString("base64");
const KEY_SECRET = "TEST-KEY-0000000000";
const TENANT = "00000000-0000-4000-b000-00000000000a";
const SHIPMENT = "00000000-0000-4000-e000-00000000000a";
const BATCH = "6332f9dfdeff6b0cae5e6c11";

const order = (o: Partial<ProviderOrder> = {}): ProviderOrder => ({
  orderId: "ORD12345", batch: null, batchId: null, price: null, reference: null, trackingNumber: "JP1234567890",
  status: "PENDING PICKUP", statusCategory: "PENDING PICKUP", lastStatusChange: null, deleted: false, paid: true, createdAt: "2026-11-05T00:00:00Z", ...o,
});

function fakeFetch(reply: { status?: number; body: string; type?: string } | "network") {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init! });
    if (reply === "network") throw new TypeError("socket hang up");
    return new Response(reply.body, { status: reply.status ?? 200, headers: { "content-type": reply.type ?? "application/json" } });
  }) as typeof fetch;
  return { impl, calls };
}
const client = (impl: typeof fetch) => createMengantarPublicClient("sandbox", KEY_SECRET, impl);
const codeOf = async (p: Promise<unknown>) => ((await p.then(() => null, (e) => e)) as MengantarError).code;

describe("DELETE /order client (T-045)", () => {
  it("sends one DELETE with the documented body and reads deletedCount", async () => {
    const f = fakeFetch({ body: fixture("order-delete-success.json") });
    expect(await client(f.impl).deleteOrder("ORD00000001", "JT")).toEqual({ reported: "deleted" });
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0].init.method).toBe("DELETE");
    expect(new URL(f.calls[0].url).pathname).toBe(`/api/public/${KEY_SECRET}/order`);
    expect(JSON.parse(String(f.calls[0].init.body))).toEqual({ courier: "JT", orderIds: ["ORD00000001"] });
    expect(await client(fakeFetch({ body: fixture("order-delete-skipped.json") }).impl).deleteOrder("ORD00000001", "JT")).toEqual({ reported: "not_deleted" });
  });

  it("models every unreadable or transport outcome as unknown_outcome, a plain 400 as rejected and 403 as not_allowed", async () => {
    expect(await codeOf(client(fakeFetch("network").impl).deleteOrder("ORD00000001", "JT"))).toBe("unknown_outcome");
    expect(await codeOf(client(fakeFetch({ status: 502, body: "{}" }).impl).deleteOrder("ORD00000001", "JT"))).toBe("unknown_outcome");
    expect(await codeOf(client(fakeFetch({ body: "<html>", type: "text/html" }).impl).deleteOrder("ORD00000001", "JT"))).toBe("unknown_outcome");
    expect(await codeOf(client(fakeFetch({ body: '{"success":true}' }).impl).deleteOrder("ORD00000001", "JT"))).toBe("unknown_outcome");
    expect(await codeOf(client(fakeFetch({ body: '{"success":true,"deletedCount":2}' }).impl).deleteOrder("ORD00000001", "JT"))).toBe("unknown_outcome");
    expect(await codeOf(client(fakeFetch({ status: 409, body: '{"success":false}' }).impl).deleteOrder("ORD00000001", "JT"))).toBe("unknown_outcome");
    const refused = await client(fakeFetch({ status: 400, body: '{"success":false,"message":"Wait 5 minutes"}' }).impl).deleteOrder("ORD00000001", "anteraja").catch((e) => e);
    expect(refused).toMatchObject({ code: "rejected", providerMessage: "Wait 5 minutes" });
    expect(await codeOf(client(fakeFetch({ status: 403, body: "{}" }).impl).deleteOrder("ORD00000001", "JT"))).toBe("not_allowed");
  });

  it("refuses malformed input before any request", async () => {
    const f = fakeFetch({ body: "{}" });
    await expect(client(f.impl).deleteOrder("bad id", "JT")).rejects.toThrow();
    await expect(client(f.impl).deleteOrder("ORD00000001", "Ninja")).rejects.toThrow();
    expect(f.calls).toHaveLength(0);
  });
});

describe("DELETE /batch parser (T-045 c)", () => {
  it("reads the counts and, for spx, the private refund and refused orders", () => {
    expect(parseBatchDelete(JSON.parse(fixture("batch-delete-spx-refund.json")), "spx")).toEqual({
      deleted: 2, undeleted: 1, total: 3, isBatchDraft: false, ordersCount: 3, refundIdr: 25500, refusedCount: 1,
      errorMessages: ["Order cannot be cancelled after pickup"],
    });
  });

  it("keeps the refund unknown (null, not 0) for other couriers even when the body carries one", () => {
    const body = JSON.parse(fixture("batch-delete-spx-refund.json"));
    for (const courier of ["JNE", "SiCepat", "Sap", "iDexpress", "JT"]) {
      expect(parseBatchDelete(body, courier)).toMatchObject({ deleted: 2, ordersCount: null, refundIdr: null, refusedCount: null, errorMessages: [] });
    }
    expect(parseBatchDelete(JSON.parse(fixture("batch-delete-jne-no-refund.json")), "JNE")).toMatchObject({ refundIdr: null });
  });

  it("an absent refund on a reporting courier is unknown, a reported 0 stays 0, and bad money is unknown", () => {
    const base = { success: true, deletedCount: 1, unDeletedCount: 0, totalCount: 1, isBatchDraft: false };
    expect(parseBatchDelete(base, "lion")).toMatchObject({ refundIdr: null, ordersCount: null, refusedCount: null });
    expect(parseBatchDelete({ ...base, totalBalanceRefund: 0, ordersCount: 1, errorMessages: [] }, "lion")).toMatchObject({ refundIdr: 0, refusedCount: 0 });
    for (const bad of [-1, 1.5, "25500", null, Number.MAX_SAFE_INTEGER + 2]) {
      expect(parseBatchDelete({ ...base, totalBalanceRefund: bad }, "pos")!.refundIdr).toBeNull();
    }
  });

  it("reads a draft batch and refuses unreadable or inconsistent counts", () => {
    expect(parseBatchDelete(JSON.parse(fixture("batch-delete-draft.json")), "JNE")).toMatchObject({ deleted: 0, total: 0, isBatchDraft: true });
    const base = { success: true, deletedCount: 1, unDeletedCount: 0, totalCount: 1, isBatchDraft: false };
    expect(parseBatchDelete({ ...base, deletedCount: undefined }, "JNE")).toBeNull();
    expect(parseBatchDelete({ ...base, unDeletedCount: "0" }, "JNE")).toBeNull();
    expect(parseBatchDelete({ ...base, totalCount: 0 }, "JNE")).toBeNull();
    expect(parseBatchDelete({ ...base, isBatchDraft: "no" }, "JNE")).toBeNull();
  });

  it("deleteBatch sends DELETE /batch and maps an unreadable answer to unknown_outcome", async () => {
    const f = fakeFetch({ body: fixture("batch-delete-spx-refund.json") });
    const result = await client(f.impl).deleteBatch(BATCH, "spx");
    expect(result.refundIdr).toBe(25500);
    expect(f.calls[0].init.method).toBe("DELETE");
    expect(new URL(f.calls[0].url).pathname).toBe(`/api/public/${KEY_SECRET}/batch`);
    expect(JSON.parse(String(f.calls[0].init.body))).toEqual({ courier: "spx", id: BATCH });
    expect(await codeOf(client(fakeFetch({ body: '{"success":true,"deletedCount":1}' }).impl).deleteBatch(BATCH, "spx"))).toBe("unknown_outcome");
    expect(await codeOf(client(fakeFetch("network").impl).deleteBatch(BATCH, "spx"))).toBe("unknown_outcome");
  });
});

describe("cancel read-back verdict (T-045)", () => {
  it("a courier-refused order stays not-cancelled after the read-back; unreadable stays unknown", () => {
    expect(judgeReadback(order({ deleted: false }), "not_deleted")).toBe("refused");
    expect(judgeReadback(order({ deleted: false }), "rejected")).toBe("refused");
    // DELETE said deleted but the read-back disagrees: contradiction, not cancelled and not refused.
    expect(judgeReadback(order({ deleted: false }), "deleted")).toBe("unknown");
    expect(judgeReadback(order({ deleted: false }), "unknown")).toBe("unknown");
    expect(judgeReadback(order({ deleted: false }), null)).toBe("unknown");
    expect(judgeReadback(null, "deleted")).toBe("unknown");
    expect(judgeReadback(order(), "not_deleted")).toBe("refused");
    expect(judgeReadback(order({ deleted: undefined }), "not_deleted")).toBe("unknown");
  });
  it("deleted or a cancelled category proves the cancellation, whatever the DELETE said", () => {
    expect(judgeReadback(order({ deleted: true }), "unknown")).toBe("cancelled");
    expect(judgeReadback(order({ statusCategory: "CANCELED", deleted: false }), "unknown")).toBe("cancelled");
  });
  it("a delivered or returned read-back is a conflict, checked before any cancellation flag", () => {
    for (const statusCategory of ["DELIVERED", "RTS", "delivered"]) {
      for (const reported of ["deleted", "not_deleted", "rejected", "unknown", null] as const) {
        expect(judgeReadback(order({ statusCategory, deleted: false }), reported)).toBe("conflict");
        expect(judgeReadback(order({ statusCategory, deleted: true }), reported)).toBe("conflict");
      }
    }
  });
});

async function setup(action: "send" | "readback" | "done", opts: { key?: boolean } = {}) {
  const sealed = await sealCredential(KEY_SECRET, credentialAad(TENANT, 1), KEY);
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const rpc = async (fn: string, args: Record<string, unknown>) => {
    calls.push({ fn, args });
    if (fn === "cancel_begin") return { data: [{ action, order_id: "ORD12345", courier: "JT", credential_version: 1 }], error: null };
    if (fn === "machine_operation_key") return { data: opts.key === false ? [] : [{ ciphertext: sealed.ciphertext, iv: sealed.iv, key_version: sealed.keyVersion, version: 1 }], error: null };
    return { data: args.p_outcome ?? null, error: null };
  };
  return { deps: { rpc, environment: "sandbox" as const, credentialKey: KEY }, calls };
}
const recorded = (calls: { fn: string; args: Record<string, unknown> }[]) => calls.filter((c) => c.fn === "cancel_record").map((c) => c.args.p_outcome);

describe("cancelShipment (T-045, failure injection)", () => {
  it("sends one DELETE, reads back and records cancelled", async () => {
    const { deps, calls } = await setup("send");
    const del = vi.fn(async () => ({ reported: "deleted" as const }));
    const find = vi.fn(async () => order({ deleted: true }));
    expect(await cancelShipment(deps, TENANT, SHIPMENT, { deleteOrder: del, findOrder: find })).toBe("cancelled");
    expect(del).toHaveBeenCalledTimes(1);
    expect(find).toHaveBeenCalledTimes(1);
    expect(recorded(calls)).toEqual(["cancelled"]);
    // The record is requested before the DELETE only through cancel_begin (the SQL marks 'requested' there).
    expect(calls[0].fn).toBe("cancel_begin");
  });

  it("an unknown DELETE outcome (timeout) is read back and never replayed; a still-active order stays unknown", async () => {
    const { deps, calls } = await setup("send");
    const del = vi.fn(async () => { throw new MengantarError("unknown_outcome"); });
    const find = vi.fn(async () => order({ deleted: false }));
    expect(await cancelShipment(deps, TENANT, SHIPMENT, { deleteOrder: del, findOrder: find })).toBe("unknown");
    expect(del).toHaveBeenCalledTimes(1);
    expect(recorded(calls)).toEqual(["unknown"]);
  });

  it("an unknown DELETE followed by a read-back that shows it deleted is cancelled", async () => {
    const { deps } = await setup("send");
    const del = vi.fn(async () => { throw new MengantarError("unknown_outcome"); });
    expect(await cancelShipment(deps, TENANT, SHIPMENT, { deleteOrder: del, findOrder: async () => order({ deleted: true }) })).toBe("cancelled");
  });

  it("a courier-refused order stays not-cancelled: refused after the read-back", async () => {
    const { deps, calls } = await setup("send");
    const del = vi.fn(async () => ({ reported: "not_deleted" as const }));
    expect(await cancelShipment(deps, TENANT, SHIPMENT, { deleteOrder: del, findOrder: async () => order({ deleted: false }) })).toBe("refused");
    expect(recorded(calls)).toEqual(["refused"]);
    const rejected = await setup("send");
    expect(await cancelShipment(rejected.deps, TENANT, SHIPMENT, { deleteOrder: async () => { throw new MengantarError("rejected", "Tunggu 5 menit"); }, findOrder: async () => order({ deleted: false }) })).toBe("refused");
  });

  it("a failed read-back after an unknown DELETE concludes nothing", async () => {
    const { deps, calls } = await setup("send");
    const find = vi.fn(async () => { throw new MengantarError("unavailable"); });
    expect(await cancelShipment(deps, TENANT, SHIPMENT, { deleteOrder: async () => { throw new MengantarError("unknown_outcome"); }, findOrder: find })).toBe("unknown");
    expect(recorded(calls)).toEqual(["unknown"]);
  });

  it("a shipment whose DELETE was already sent is only read back: DELETE is never repeated", async () => {
    const { deps, calls } = await setup("readback");
    const del = vi.fn(async () => ({ reported: "deleted" as const }));
    expect(await cancelShipment(deps, TENANT, SHIPMENT, { deleteOrder: del, findOrder: async () => order({ deleted: true }) })).toBe("cancelled");
    expect(del).not.toHaveBeenCalled();
    // Without a DELETE answer, a still-active order is unknown (the earlier DELETE's result is not known).
    const again = await setup("readback");
    expect(await cancelShipment(again.deps, TENANT, SHIPMENT, { deleteOrder: del, findOrder: async () => order({ deleted: false }) })).toBe("unknown");
    expect(calls.some((c) => c.fn === "cancel_begin")).toBe(true);
  });

  it("without a readable seller key nothing is sent and the pending decision becomes unknown", async () => {
    const { deps, calls } = await setup("send", { key: false });
    const del = vi.fn();
    expect(await cancelShipment(deps, TENANT, SHIPMENT, { deleteOrder: del })).toBe("no_key");
    expect(del).not.toHaveBeenCalled();
    expect(recorded(calls)).toEqual(["unknown"]);
  });

  it("delivery learned only from the read-back is a conflict: never cancelled, never refused, left unresolved", async () => {
    // No ingestion happened: the local state has no delivery, only the GET shows it.
    const refused = await setup("send");
    expect(await cancelShipment(refused.deps, TENANT, SHIPMENT, { deleteOrder: async () => ({ reported: "not_deleted" }), findOrder: async () => order({ statusCategory: "DELIVERED", deleted: false }) })).toBe("conflict");
    expect(recorded(refused.calls)).toEqual(["unknown"]);
    const flagged = await setup("send");
    expect(await cancelShipment(flagged.deps, TENANT, SHIPMENT, { deleteOrder: async () => ({ reported: "deleted" }), findOrder: async () => order({ statusCategory: "DELIVERED", deleted: true }) })).toBe("conflict");
    expect(recorded(flagged.calls)).toEqual(["unknown"]);
    const again = await setup("readback");
    expect(await cancelShipment(again.deps, TENANT, SHIPMENT, { findOrder: async () => order({ statusCategory: "RTS", deleted: true }) })).toBe("conflict");
    expect(recorded(again.calls)).toEqual(["unknown"]);
  });

  it("uses the ORIGINAL operation's credential version; a replaced BYOK key makes no provider request", async () => {
    const { deps, calls } = await setup("send");
    const rpc = async (fn: string, args: Record<string, unknown>) => {
      // The sealed key of the original version is not available (BYOK replaced it): SQL answers null.
      if (fn === "machine_operation_key") { calls.push({ fn, args }); return { data: null, error: null }; }
      return deps.rpc(fn, args);
    };
    const fetchImpl = vi.fn(async () => new Response("{}"));
    const del = vi.fn();
    const find = vi.fn();
    expect(await cancelShipment({ ...deps, rpc, fetchImpl: fetchImpl as unknown as typeof fetch }, TENANT, SHIPMENT, { deleteOrder: del, findOrder: find })).toBe("no_key");
    expect(calls.find((c) => c.fn === "machine_operation_key")?.args).toEqual({ p_tenant: TENANT, p_env: "sandbox", p_version: 1 });
    expect(calls.some((c) => c.fn === "machine_seller_key")).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
    expect(find).not.toHaveBeenCalled();
    expect(recorded(calls)).toEqual(["unknown"]);
  });

  it("an already cancelled shipment sends nothing; a refused begin is not_cancellable", async () => {
    const done = await setup("done");
    const del = vi.fn();
    expect(await cancelShipment(done.deps, TENANT, SHIPMENT, { deleteOrder: del })).toBe("cancelled");
    expect(del).not.toHaveBeenCalled();
    const deps = { rpc: async () => ({ data: null, error: { message: "not_cancellable" } }), environment: "sandbox" as const, credentialKey: KEY };
    expect(await cancelShipment(deps, TENANT, SHIPMENT)).toBe("not_cancellable");
  });

  it("never leaks the seller key into a recorded argument", async () => {
    const { deps, calls } = await setup("send");
    await cancelShipment(deps, TENANT, SHIPMENT, { deleteOrder: async () => ({ reported: "deleted" }), findOrder: async () => order({ deleted: true }) });
    expect(JSON.stringify(calls)).not.toContain(KEY_SECRET);
  });
});
