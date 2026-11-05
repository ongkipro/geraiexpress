import { afterEach, describe, expect, it, vi } from "vitest";

// T-105 / Ops 3: startup validation reuses the auth, PostgREST and tracking validators; problems name the
// variables, never a value; production refuses to start, other environments log and continue.
vi.mock("server-only", () => ({}));
vi.mock("@/lib/config", () => vi.importActual("../../src/lib/config"));
vi.mock("@/lib/db/client", () => vi.importActual("../../src/lib/db/client"));

// getAuth() caches a valid instance per process, so every check starts from fresh modules (doMock
// re-registers the factories, which resetModules alone keeps).
function fresh() {
  vi.resetModules();
  vi.doMock("@/lib/auth/instance", () => vi.importActual("../../src/lib/auth/instance"));
  vi.doMock("./lib/startup", () => vi.importActual("../../src/lib/startup"));
}
const runtimeConfigProblems = async () => { fresh(); return (await import("../../src/lib/startup")).runtimeConfigProblems(); };
const register = async () => { fresh(); return (await import("../../src/instrumentation")).register(); };

const VALID = {
  POSTGREST_URL: "http://postgrest:3000",
  AUTH_JWT_SECRET: "startup-test-jwt-secret-0123456789abcdef",
  AUTH_SECRET: "startup-test-auth-secret-0123456789abcdef",
  TURNSTILE_SECRET_KEY: "startup-test-turnstile-secret",
  TRACKING_TOKEN_SECRET: "startup-test-tracking-secret-0123456789",
};
const stub = (env: Record<string, string>) => { for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v); };

afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("runtime configuration validation", () => {
  it("accepts a complete configuration, with or without the explicit CAPTCHA opt-out", async () => {
    stub(VALID);
    expect(await runtimeConfigProblems()).toEqual([]);
    stub({ TURNSTILE_SECRET_KEY: "", AUTH_CAPTCHA_DISABLED: "true" });
    expect(await runtimeConfigProblems()).toEqual([]);
  });

  it.each([
    ["POSTGREST_URL", { POSTGREST_URL: "" }],
    ["AUTH_SECRET", { AUTH_SECRET: "short-but-secret-value" }],
    ["AUTH_JWT_SECRET", { AUTH_JWT_SECRET: "" }],
    ["TURNSTILE_SECRET_KEY", { TURNSTILE_SECRET_KEY: "" }],
    ["TRACKING_TOKEN_SECRET", { TRACKING_TOKEN_SECRET: "short-but-secret-value" }],
  ])("names %s and never a value", async (name, broken) => {
    stub({ ...VALID, ...broken });
    const problems = await runtimeConfigProblems();
    expect(problems.join(" ")).toContain(name);
    for (const value of [...Object.values(VALID), "short-but-secret-value"]) expect(problems.join(" ")).not.toContain(value);
  });

  it("names equal auth secrets", async () => {
    stub({ ...VALID, AUTH_SECRET: VALID.AUTH_JWT_SECRET });
    expect(await runtimeConfigProblems()).toEqual(["AUTH_JWT_SECRET and AUTH_SECRET must be different values"]);
  });
});

describe("instrumentation register()", () => {
  it("refuses a production start with the variable names only", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    stub({ ...VALID, NEXT_RUNTIME: "nodejs", NODE_ENV: "production", AUTH_SECRET: "" });
    await expect(register()).rejects.toThrow(/^Invalid server configuration: .*AUTH_JWT_SECRET and AUTH_SECRET must be set/);
    expect(JSON.parse(String(error.mock.calls[0][0]))).toMatchObject({ event: "startup_config_invalid" });
    expect(String(error.mock.calls[0][0])).not.toContain(VALID.AUTH_JWT_SECRET);
  });

  it("starts a valid production server, and only logs outside production", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    stub({ ...VALID, NEXT_RUNTIME: "nodejs", NODE_ENV: "production" });
    await expect(register()).resolves.toBeUndefined();
    expect(error).not.toHaveBeenCalled();
    stub({ NODE_ENV: "development", POSTGREST_URL: "" });
    await expect(register()).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledTimes(1);
  });

  it("does nothing on the edge runtime", async () => {
    stub({ NEXT_RUNTIME: "edge", NODE_ENV: "production", POSTGREST_URL: "" });
    await expect(register()).resolves.toBeUndefined();
  });
});
