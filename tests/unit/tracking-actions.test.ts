import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const { rpc, from, revalidatePath, requireWorkspace, trackingTokenSecret } = vi.hoisted(() => ({
  rpc: vi.fn(), from: vi.fn(), revalidatePath: vi.fn(), requireWorkspace: vi.fn(), trackingTokenSecret: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath }));
// This suite deliberately mocks every @/ import: Vitest does not have a source alias.
vi.mock("@/lib/config", () => ({ trackingTokenSecret }));
vi.mock("@/lib/db/server", () => ({ dbServer: async () => ({ rpc, from }) }));
vi.mock("@/lib/workspace", () => ({ requireWorkspace }));
vi.mock("@/lib/format", () => ({ courierName: () => "J&T Express" }));
vi.mock("@/lib/hosts", async () => await import("../../src/lib/hosts"));
import { shareTrackingAction, revokeTrackingAction } from "../../src/modules/tracking/actions";

afterEach(() => vi.unstubAllEnvs());

const id = "11111111-1111-4111-8111-111111111111", generation = "22222222-2222-4222-8222-222222222222";
const secret = "synthetic-action-tracking-secret-32-bytes";
const ws = { tenant: { id: "tenant-a", name: "Gerai Uji" }, role: "tenant_admin", isDemo: false };
let shipment: Record<string, unknown>;
const filters: unknown[][] = [];

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv("SITE_ORIGIN", "https://staging.geraiexpress.com");
  vi.stubEnv("NODE_ENV", "production");
  rpc.mockReset().mockImplementation(async (fn: string) => ({ data: fn === "prepare_tracking_link" ? generation : null, error: null }));
  requireWorkspace.mockReset().mockResolvedValue(ws);
  trackingTokenSecret.mockReset().mockReturnValue(secret);
  revalidatePath.mockReset(); filters.length = 0;
  shipment = { id, awb: "JP1234567890", sender_phone: "081234567890", selected_quote_id: "quote-a", submission_state: "issued", is_simulated: false };
  from.mockReset().mockImplementation((table: string) => {
    const query = { select: () => query, eq: (...args: unknown[]) => { filters.push([table, ...args]); return query; },
      maybeSingle: async () => ({ data: table === "shipments" ? shipment : { courier: "JT", service: "REG" }, error: null }) };
    return query;
  });
});

it("shares deterministically with configured SITE_ORIGIN and only publishes the SHA-256 hash", async () => {
  const first = await shareTrackingAction(id), repeat = await shareTrackingAction(id);
  expect(first).toEqual(repeat);
  if ("error" in first) throw new Error(first.error);
  expect(first.link).toMatch(/^https:\/\/staging\.geraiexpress\.com\/lacak\/[A-Za-z0-9_-]{43}$/);
  expect(first.link).not.toContain(id); expect(first.link).not.toContain("JP1234567890");
  expect(first.whatsapp).toMatch(/^https:\/\/wa\.me\/6281234567890\?text=/);
  expect(decodeURIComponent(first.whatsapp!)).toContain(first.message);
  expect(first.message).toContain("Gerai Uji"); expect(first.message).toContain("J&T Express REG");
  const publication = rpc.mock.calls.find(([fn]) => fn === "publish_tracking_link")!;
  expect(publication[1]).toMatchObject({ p_shipment: id, p_link: generation, p_hash: expect.stringMatching(/^[a-f0-9]{64}$/) });
  expect(JSON.stringify(rpc.mock.calls)).not.toContain(first.link.split("/").at(-1));
  expect(JSON.stringify(first)).not.toContain(secret);
  expect(filters).toContainEqual(["shipments", "tenant_id", "tenant-a"]);
  expect(revalidatePath).toHaveBeenCalledWith(`/pengiriman/${id}`);
});
it("returns copyable message with no WhatsApp URL for a missing phone", async () => {
  shipment.sender_phone = null;
  const result = await shareTrackingAction(id);
  expect(result).toMatchObject({ whatsapp: null, message: expect.stringContaining("JP1234567890") });
});
it("refuses draft/simulated/misconfigured shares before publication", async () => {
  shipment.submission_state = "queued";
  expect(await shareTrackingAction(id)).toHaveProperty("error"); expect(rpc).not.toHaveBeenCalled();
  shipment.submission_state = "issued"; shipment.is_simulated = true;
  expect(await shareTrackingAction(id)).toHaveProperty("error"); expect(rpc).not.toHaveBeenCalled();
  shipment.is_simulated = false;
  trackingTokenSecret.mockImplementation(() => { throw new Error("private config detail"); });
  expect(await shareTrackingAction(id)).toHaveProperty("error"); expect(rpc).not.toHaveBeenCalled();
});
it("does not return a URL when publication lost a race to revocation", async () => {
  rpc.mockImplementation(async (fn: string) => fn === "prepare_tracking_link" ? { data: generation, error: null } : { data: null, error: { message: "stale_state" } });
  expect(await shareTrackingAction(id)).toHaveProperty("error");
});
it("requires a current workspace administrator and names the exact generation when revoking", async () => {
  requireWorkspace.mockResolvedValue({ ...ws, role: "operator" });
  expect(await revokeTrackingAction(id, generation)).toHaveProperty("error"); expect(rpc).not.toHaveBeenCalled();
  requireWorkspace.mockResolvedValue(ws);
  expect(await revokeTrackingAction(id, generation)).toEqual({});
  expect(rpc).toHaveBeenCalledWith("revoke_tracking_link", { p_shipment: id, p_link: generation });
});
