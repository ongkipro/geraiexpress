import { readdirSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const problems = vi.fn<() => string[]>(() => []);
vi.mock("@/lib/config", () => ({ config: (name: string) => process.env[name] }));
vi.mock("@/lib/startup", () => ({ runtimeConfigProblems: () => problems() }));
import { GET } from "../../src/app/healthz/route";
import { EXPECTED_SCHEMA_VERSION, schemaReady } from "../../src/lib/schema-version";

const JWT_SECRET = "unit-test-jwt-secret-0123456789abcdef0123456789abcdef";
const OLDER = "20261001000000";
const NEWER = "20991231235959";

// One fake PostgREST: registration_open answers `open`, schema_version answers `version`.
function upstream(open: unknown, version: unknown = EXPECTED_SCHEMA_VERSION) {
  return vi.fn(async (input: string) => Response.json(input.endsWith("/rpc/schema_version") ? version : open));
}

beforeEach(() => {
  problems.mockReset();
  problems.mockReturnValue([]);
  vi.stubEnv("AUTH_JWT_SECRET", JWT_SECRET);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("database readiness", () => {
  it.each([true, false])("accepts registration_open=%s as a healthy database", async (open) => {
    vi.stubEnv("POSTGREST_URL", "http://data.internal/");
    const request = upstream(open);
    vi.stubGlobal("fetch", request);
    const result = await GET();
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ ok: true, service: "geraiexpress" });
    expect(request).toHaveBeenCalledWith("http://data.internal/rpc/registration_open", expect.objectContaining({
      method: "POST", cache: "no-store", redirect: "error", signal: expect.any(AbortSignal),
    }));
    // The schema probe is machine-only: it carries a service_role bearer, the anonymous probe none.
    const schemaCall = request.mock.calls.find(([url]) => url === "http://data.internal/rpc/schema_version") as unknown as [string, RequestInit];
    expect((schemaCall[1].headers as Record<string, string>).Authorization).toMatch(/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/);
    const anonCall = request.mock.calls.find(([url]) => url.endsWith("/rpc/registration_open")) as unknown as [string, RequestInit];
    expect((anonCall[1].headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it.each(["missing", "secret", "network", "timeout", "status", "shape", "json"])("fails closed on %s without leaking details", async (failure) => {
    vi.stubEnv("POSTGREST_URL", failure === "missing" ? "" : "http://data.internal");
    if (failure === "secret") vi.stubEnv("AUTH_JWT_SECRET", "");
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
    if (failure === "missing" || failure === "secret") expect(request).not.toHaveBeenCalled();
  });

  it("is not ready while the server configuration does not load, and names nothing (T-105)", async () => {
    vi.stubEnv("POSTGREST_URL", "http://data.internal");
    problems.mockReturnValue(["AUTH_SECRET must be set and at least 32 bytes long"]);
    const request = upstream(true);
    vi.stubGlobal("fetch", request);
    const result = await GET();
    expect(result.status).toBe(503);
    expect(await result.text()).toBe(JSON.stringify({ ok: false, service: "geraiexpress" }));
    expect(request).not.toHaveBeenCalled();
  });
});

describe("schema readiness (T-109)", () => {
  it("answers 503 schema_behind when the database is older than the image expects", async () => {
    vi.stubEnv("POSTGREST_URL", "http://data.internal");
    vi.stubGlobal("fetch", upstream(true, OLDER));
    const result = await GET();
    expect(result.status).toBe(503);
    expect(await result.json()).toEqual({ ok: false, service: "geraiexpress", reason: "schema_behind" });
  });

  it("answers 503 schema_behind when the database predates schema_version itself (PGRST202)", async () => {
    vi.stubEnv("POSTGREST_URL", "http://data.internal");
    vi.stubGlobal("fetch", vi.fn(async (input: string) => input.endsWith("/rpc/schema_version")
      ? Response.json({ code: "PGRST202", message: "Could not find the function" }, { status: 404 })
      : Response.json(true)));
    const result = await GET();
    expect(result.status).toBe(503);
    expect(await result.json()).toEqual({ ok: false, service: "geraiexpress", reason: "schema_behind" });
  });

  it("names no reason when schema_version fails for another cause", async () => {
    vi.stubEnv("POSTGREST_URL", "http://data.internal");
    vi.stubGlobal("fetch", vi.fn(async (input: string) => input.endsWith("/rpc/schema_version")
      ? Response.json({ code: "PGRST301", message: "JWT invalid" }, { status: 401 })
      : Response.json(true)));
    const result = await GET();
    expect(result.status).toBe(503);
    expect(await result.json()).toEqual({ ok: false, service: "geraiexpress" });
  });

  it("is ready when the database is newer than the image (forward-compatible)", async () => {
    vi.stubEnv("POSTGREST_URL", "http://data.internal");
    vi.stubGlobal("fetch", upstream(false, NEWER));
    const result = await GET();
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ ok: true, service: "geraiexpress" });
  });

  it.each([null, "", "2026", 20261105190000, { version: EXPECTED_SCHEMA_VERSION }])("fails closed without a reason on a malformed version %j", async (version) => {
    vi.stubEnv("POSTGREST_URL", "http://data.internal");
    vi.stubGlobal("fetch", upstream(true, version));
    const result = await GET();
    expect(result.status).toBe(503);
    expect(await result.json()).toEqual({ ok: false, service: "geraiexpress" });
  });

  it("EXPECTED_SCHEMA_VERSION is the newest migration file in db/migrations", () => {
    const newest = readdirSync("db/migrations").filter((f) => /^[0-9]{14}_.*\.sql$/.test(f)).sort().at(-1)!;
    expect(EXPECTED_SCHEMA_VERSION).toBe(newest.slice(0, 14));
  });

  it("schemaReady compares 14-digit versions only", () => {
    expect(schemaReady(EXPECTED_SCHEMA_VERSION)).toBe(true);
    expect(schemaReady(NEWER)).toBe(true);
    expect(schemaReady(OLDER)).toBe(false);
    for (const bad of [null, undefined, "", "abc", "2026110519000", 20261105190000]) expect(schemaReady(bad)).toBe(false);
  });
});
