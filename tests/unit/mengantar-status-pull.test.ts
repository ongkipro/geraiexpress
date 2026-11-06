import { describe, expect, it, vi } from "vitest";
import { credentialAad, sealCredential } from "../../src/lib/credential-crypto";
import type { ProviderOrder } from "../../src/lib/mengantar/public-api";
import { pullStatuses, STATUS_PULL_MAX, STATUS_PULL_PAGE } from "../../src/lib/mengantar/status-pull";

vi.mock("server-only", () => ({}));

// T-045 / ADR-0003 §2.6: the status pull feeds GET /order results through the same SQL ingestion (source 'pull').
const KEY = Buffer.alloc(32, 7).toString("base64");
const T1 = "00000000-0000-4000-b000-00000000000a";
const T2 = "00000000-0000-4000-b000-00000000000b";
const NOW = new Date("2026-11-06T05:00:00Z");
const order = (o: Partial<ProviderOrder> = {}): ProviderOrder => ({
  orderId: "ORD12345", batch: null, batchId: null, price: null, reference: null, trackingNumber: "JP1234567890",
  status: "ON DELIVERY", statusCategory: "DELIVERED", lastStatusChange: "2026-11-06T04:00:00Z", paid: true, createdAt: "2026-11-05T00:00:00Z", ...o,
});

async function setup(candidates: { tenant_id: string; shipment_id: string; order_id: string }[], keys: Record<string, boolean> = { [T1]: true, [T2]: true }) {
  const sealed: Record<string, unknown> = {};
  for (const [t, has] of Object.entries(keys)) {
    if (has) { const s = await sealCredential(`seller-key-${t}`, credentialAad(t, 1), KEY); sealed[t] = { ciphertext: s.ciphertext, iv: s.iv, key_version: s.keyVersion, version: 1 }; }
  }
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const pulled = new Map<string, number>();
  let clock = 0; let runStart = 0;
  const rpc = async (fn: string, args: Record<string, unknown>) => {
    calls.push({ fn, args });
    if (fn === "machine_status_pull_candidates") {
      // Least recently pulled first: never-pulled (in id order), then by pull order.
      const order = [...candidates].sort((a, b) => (pulled.get(a.shipment_id) ?? -1) - (pulled.get(b.shipment_id) ?? -1) || a.shipment_id.localeCompare(b.shipment_id));
      const rest = order.filter((c) => !pulled.has(c.shipment_id) || pulled.get(c.shipment_id)! < runStart).slice(0, args.p_limit as number);
      return { data: rest.map((c) => ({ ...c, courier: "jne", credential_version: 1 })), error: null };
    }
    if (fn === "mark_status_pulled") { for (const id of args.p_shipments as string[]) pulled.set(id, ++clock); return { data: null, error: null }; }
    if (fn === "machine_seller_key") return { data: sealed[args.p_tenant as string] ? [sealed[args.p_tenant as string]] : [], error: null };
    if (fn === "ingest_provider_status") return { data: "applied", error: null };
    return { data: null, error: null };
  };
  // A new run sees shipments pulled in earlier runs as eligible again (the stale window has passed).
  const newRun = () => { runStart = clock + 1; };
  return { deps: { rpc, environment: "sandbox" as const, credentialKey: KEY }, calls, newRun, pulled };
}
const id = (n: number) => `00000000-0000-4000-c000-${String(n).padStart(12, "0")}`;

describe("status pull (T-045)", () => {
  it("reads each order with its own tenant's key (one key read per tenant) and ingests the category with the provider time", async () => {
    const { deps, calls } = await setup([{ tenant_id: T1, shipment_id: id(1), order_id: "ORD00001" }, { tenant_id: T1, shipment_id: id(2), order_id: "ORD00002" }, { tenant_id: T2, shipment_id: id(3), order_id: "ORD00003" }]);
    const seen: { key: string; orderId: string }[] = [];
    const summary = await pullStatuses(deps, { now: () => NOW, findOrder: async (key, orderId) => { seen.push({ key, orderId }); return order({ orderId }); } });
    expect(summary).toEqual({ checked: 3, applied: 3, unchanged: 0, skipped: 0, failed: 0 });
    expect(seen).toEqual([{ key: `seller-key-${T1}`, orderId: "ORD00001" }, { key: `seller-key-${T1}`, orderId: "ORD00002" }, { key: `seller-key-${T2}`, orderId: "ORD00003" }]);
    expect(calls.filter((c) => c.fn === "machine_seller_key")).toHaveLength(2);
    expect(calls.find((c) => c.fn === "ingest_provider_status")!.args).toEqual({ p_tenant: T1, p_env: "sandbox", p_source: "pull",
      p_provider_ts: "2026-11-06T04:00:00.000Z", p_order_id: "ORD00001", p_awb: "JP1234567890", p_status: "DELIVERED", p_ts_trusted: true });
  });

  it("skips a tenant without a readable key, an order not found, and a row without statusCategory (never guesses from `status`)", async () => {
    const { deps, calls } = await setup([{ tenant_id: T1, shipment_id: id(1), order_id: "ORD00001" }, { tenant_id: T2, shipment_id: id(2), order_id: "ORD00002" }, { tenant_id: T1, shipment_id: id(3), order_id: "ORD00003" }], { [T1]: true, [T2]: false });
    const summary = await pullStatuses(deps, { now: () => NOW, findOrder: async (_k, orderId) => orderId === "ORD00001" ? null : order({ statusCategory: null }) });
    expect(summary).toEqual({ checked: 3, applied: 0, unchanged: 0, skipped: 3, failed: 0 });
    expect(calls.some((c) => c.fn === "ingest_provider_status")).toBe(false);
  });

  it("counts a provider read failure without stopping the run; a future or unreadable provider time is sent as untrusted", async () => {
    const { deps, calls } = await setup([{ tenant_id: T1, shipment_id: id(1), order_id: "ORD00001" }, { tenant_id: T1, shipment_id: id(2), order_id: "ORD00002" }]);
    const summary = await pullStatuses(deps, { now: () => NOW, findOrder: async (_k, orderId) => {
      if (orderId === "ORD00001") throw new Error("timeout");
      return order({ lastStatusChange: "2099-01-01T00:00:00Z" });
    } });
    expect(summary).toEqual({ checked: 2, applied: 1, unchanged: 0, skipped: 0, failed: 1 });
    const sent = calls.find((c) => c.fn === "ingest_provider_status")!.args;
    // Review P1: a future time is never accepted; it becomes the pull time and is flagged, so SQL refuses a final.
    expect(sent).toMatchObject({ p_provider_ts: NOW.toISOString(), p_ts_trusted: false });
  });

  it("stops at the per-run maximum, and the next run reaches the tail even when every order stays unchanged (review P1)", async () => {
    const many = Array.from({ length: STATUS_PULL_MAX + 30 }, (_, i) => ({ tenant_id: T1, shipment_id: id(i + 1), order_id: `ORD${String(i + 1).padStart(5, "0")}` }));
    const { deps, calls, newRun, pulled } = await setup(many);
    const seen = new Set<string>();
    const unchanged = async (_k: string, orderId: string) => { seen.add(orderId); return order({ statusCategory: "ON DELIVERY" }); };
    expect((await pullStatuses(deps, { now: () => NOW, findOrder: unchanged })).checked).toBe(STATUS_PULL_MAX);
    expect(calls.find((c) => c.fn === "machine_status_pull_candidates")!.args).toEqual({ p_env: "sandbox", p_stale: "2 hours", p_limit: STATUS_PULL_PAGE });
    expect(seen.size).toBe(STATUS_PULL_MAX);
    newRun();
    await pullStatuses(deps, { now: () => NOW, findOrder: unchanged });
    expect(seen.size).toBe(STATUS_PULL_MAX + 30);
    expect(pulled.size).toBe(STATUS_PULL_MAX + 30);
  });

  it("marks failing orders pulled too, so a provider error cannot pin the head of the queue", async () => {
    const { deps, pulled } = await setup([{ tenant_id: T1, shipment_id: id(1), order_id: "ORD00001" }, { tenant_id: T1, shipment_id: id(2), order_id: "ORD00002" }]);
    const summary = await pullStatuses(deps, { now: () => NOW, findOrder: async () => { throw new Error("down"); } });
    expect(summary).toMatchObject({ checked: 2, failed: 2 });
    expect(pulled.size).toBe(2);
  });
});
