import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ workspace: vi.fn(), rpc: vi.fn(), tenant: vi.fn(), search: vi.fn() }));
vi.mock("@/lib/workspace", () => ({ loadWorkspace: mocks.workspace }));
vi.mock("@/lib/db/server", () => ({ dbServer: async () => ({ rpc: mocks.rpc }) }));
vi.mock("@/lib/mengantar/tenant", () => ({ tenantMengantar: mocks.tenant, mengantarFailure: () => "mengantar_unavailable" }));
import { GET } from "../../src/app/api/mengantar/area/route";
import { resetLimiters } from "../../src/lib/limiter";

const area = { id: "5fc63169f8f44b34aa4c2ee1", province: "JAWA BARAT", city: "DEPOK", district: "TAPOS", subdistrict: "SUKATANI", postal_code: "16454" };
const ready = (isDemo = false) => mocks.workspace.mockResolvedValue({ kind: "ready", workspace: { isDemo, tenant: { id: "tenant-verified" } } });
const get = (q = "Sukatani") => GET(new Request(`http://app.test/api/mengantar/area?q=${encodeURIComponent(q)}`));

beforeEach(() => {
  vi.resetAllMocks();
  resetLimiters();
  ready();
  mocks.rpc.mockResolvedValue({ data: [], error: null });
  mocks.tenant.mockResolvedValue({ ok: true, client: { searchAreas: mocks.search } });
  mocks.search.mockResolvedValue([]);
});

describe("GET /api/mengantar/area catalogue-first", () => {
  it.each([false, true])("serves the catalogue to a ready workspace, demo=%s, without opening a seller key", async (demo) => {
    ready(demo);
    mocks.rpc.mockResolvedValue({ data: [area], error: null });
    const result = await get(" Sukatani ");
    expect(result.status).toBe(200);
    expect(result.headers.get("Cache-Control")).toBe("private, no-store");
    const { postal_code, ...rest } = area;
    expect(await result.json()).toEqual({ areas: [{ ...rest, zip: postal_code }], source: "catalogue" });
    expect(mocks.rpc).toHaveBeenCalledWith("search_mengantar_areas", { p_query: "Sukatani", p_limit: 30 });
    expect(mocks.tenant).not.toHaveBeenCalled();
  });

  it("uses live search only after an empty catalogue, with the verified tenant and a bounded result", async () => {
    mocks.search.mockResolvedValue(Array.from({ length: 40 }, () => ({ id: "provider-id" })));
    const result = await get();
    expect(mocks.tenant).toHaveBeenCalledWith("tenant-verified");
    expect(mocks.search).toHaveBeenCalledWith("Sukatani");
    expect(mocks.rpc.mock.invocationCallOrder[0]).toBeLessThan(mocks.tenant.mock.invocationCallOrder[0]);
    expect(await result.json()).toEqual({ source: "mengantar", areas: Array.from({ length: 30 }, () => ({ id: "provider-id" })) });
  });

  it("limits live fallback per tenant with no-store and Retry-After, without another provider call", async () => {
    for (let i = 0; i < 30; i++) expect((await get(`miss-${i}`)).status).toBe(200);
    const result = await get("another-miss");
    expect(result.status).toBe(429);
    expect(result.headers.get("Retry-After")).toBe("60");
    expect(result.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await result.json()).toEqual({ error: "rate_limited" });
    expect(mocks.search).toHaveBeenCalledTimes(30);
    mocks.workspace.mockResolvedValue({ kind: "ready", workspace: { isDemo: false, tenant: { id: "another-tenant" } } });
    expect((await get()).status).toBe(200);
    expect(mocks.search).toHaveBeenCalledTimes(31);
  });

  it("never spends or enforces the live budget for catalogue hits", async () => {
    mocks.rpc.mockResolvedValue({ data: [area], error: null });
    for (let i = 0; i < 31; i++) expect((await get()).status).toBe(200);
    expect(mocks.tenant).not.toHaveBeenCalled();
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    for (let i = 0; i < 30; i++) expect((await get()).status).toBe(200);
    expect((await get()).status).toBe(429);
    mocks.rpc.mockResolvedValue({ data: [area], error: null });
    expect((await get()).status).toBe(200); // Catalogue still works after live exhaustion.
    expect(mocks.search).toHaveBeenCalledTimes(30);
  });

  it("never falls back for a demo miss", async () => {
    ready(true);
    expect(await (await get()).json()).toEqual({ areas: [], source: "catalogue" });
    expect(mocks.tenant).not.toHaveBeenCalled();
  });

  it("fails closed on a catalogue failure instead of hiding it with a provider call", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "private database details" } });
    const result = await get();
    expect(result.status).toBe(503);
    expect(await result.json()).toEqual({ error: "mengantar_unavailable" });
    expect(mocks.tenant).not.toHaveBeenCalled();
  });

  it.each(["not_configured", "no_key", "key_unreadable"])("preserves disconnected error %s without live search", async (reason) => {
    mocks.tenant.mockResolvedValue({ ok: false, reason });
    const result = await get();
    expect(result.status).toBe(503);
    expect(await result.json()).toEqual({ error: `mengantar_${reason}` });
    expect(mocks.search).not.toHaveBeenCalled();
  });

  it("preserves live provider error semantics", async () => {
    mocks.search.mockRejectedValue(new Error("private provider details"));
    const result = await get();
    expect(result.status).toBe(502);
    expect(await result.json()).toEqual({ error: "mengantar_unavailable" });
  });

  it.each(["anonymous", "choose", "no-access"])("refuses workspace state %s before DB/provider access", async (kind) => {
    mocks.workspace.mockResolvedValue({ kind });
    expect((await get()).status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.tenant).not.toHaveBeenCalled();
  });

  it.each(["ab", "x".repeat(61)])("keeps invalid query responses empty without DB/provider calls", async (q) => {
    expect(await (await get(q)).json()).toEqual({ areas: [] });
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.tenant).not.toHaveBeenCalled();
  });
});
