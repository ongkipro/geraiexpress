import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const problems = vi.fn<() => string[]>(() => []);
vi.mock("@/lib/config", () => ({ config: (name: string) => process.env[name] }));
vi.mock("@/lib/startup", () => ({ runtimeConfigProblems: () => problems() }));
import { GET } from "../../src/app/healthz/route";

beforeEach(() => { problems.mockReset(); problems.mockReturnValue([]); });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("database readiness", () => {
  it.each([true, false])("accepts registration_open=%s as a healthy database", async (open) => {
    vi.stubEnv("POSTGREST_URL", "http://data.internal/");
    const request = vi.fn().mockResolvedValue(Response.json(open));
    vi.stubGlobal("fetch", request);
    const result = await GET();
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ ok: true, service: "geraiexpress" });
    expect(request).toHaveBeenCalledWith("http://data.internal/rpc/registration_open", expect.objectContaining({
      method: "POST", cache: "no-store", redirect: "error", signal: expect.any(AbortSignal),
    }));
  });

  it.each(["missing", "network", "timeout", "status", "shape", "json"])("fails closed on %s without leaking details", async (failure) => {
    vi.stubEnv("POSTGREST_URL", failure === "missing" ? "" : "http://data.internal");
    const request = vi.fn(async () => {
      if (failure === "network") throw new Error("private connection details");
      if (failure === "timeout") throw new DOMException("private timeout", "TimeoutError");
      if (failure === "status") return new Response("private SQL", { status: 503 });
      if (failure === "json") return new Response("private SQL");
      return Response.json({ ok: true });
    });
    vi.stubGlobal("fetch", request);
    const result = await GET();
    expect(result.status).toBe(503);
    expect(result.headers.get("cache-control")).toBe("no-store");
    expect(await result.json()).toEqual({ ok: false, service: "geraiexpress" });
    if (failure === "missing") expect(request).not.toHaveBeenCalled();
  });

  it("is not ready while the server configuration does not load, and names nothing (T-105)", async () => {
    vi.stubEnv("POSTGREST_URL", "http://data.internal");
    problems.mockReturnValue(["AUTH_SECRET must be set and at least 32 bytes long"]);
    const request = vi.fn().mockResolvedValue(Response.json(true));
    vi.stubGlobal("fetch", request);
    const result = await GET();
    expect(result.status).toBe(503);
    expect(await result.text()).toBe(JSON.stringify({ ok: false, service: "geraiexpress" }));
    expect(request).not.toHaveBeenCalled();
  });
});
