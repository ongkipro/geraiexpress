import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { AUTH_BUSY, TOO_MANY_AUTH_ATTEMPTS, authThrottleMessage, authUnavailable } from "../../src/lib/auth-errors";
import { AuthUnavailableError } from "../../src/lib/auth/store";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/store", () => vi.importActual("../../src/lib/auth/store"));

let warn: MockInstance;
let error: MockInstance;
beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  error = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("throttle message (SEC-5 / RATE-2)", () => {
  it.each([
    ["/masuk", 429], ["/daftar", 429], ["/verifikasi-2fa", 429], ["/refresh", 503],
  ] as const)("answers the Bahasa message and logs only the bounded route and status for %s", (route, status) => {
    expect(authThrottleMessage(route, status)).toBe(TOO_MANY_AUTH_ATTEMPTS);
    expect(warn).toHaveBeenCalledExactlyOnceWith(JSON.stringify({ event: "auth_rate_limited", route, status }));
  });

  it("defaults to status 429", () => {
    authThrottleMessage("/masuk");
    expect(JSON.parse(String(warn.mock.calls[0][0]))).toEqual({ event: "auth_rate_limited", route: "/masuk", status: 429 });
  });
});

describe("store outage (ADR-0002 section 4, obligation 10)", () => {
  it("recognizes the auth store failure, logs its operation name only, and answers true", () => {
    const failure = new AuthUnavailableError("auth_create_session");
    expect(authUnavailable(failure, "/masuk")).toBe(true);
    expect(error).toHaveBeenCalledExactlyOnceWith(JSON.stringify({ event: "auth_unavailable", route: "/masuk", operation: "auth_create_session" }));
    expect(AUTH_BUSY).toMatch(/^Layanan masuk sedang sibuk/);
  });

  it("leaves every other error alone, for the caller to rethrow", () => {
    expect(authUnavailable(new Error("boom sensitive-email@example.test"), "/masuk")).toBe(false);
    expect(authUnavailable("auth_create_session", "/daftar")).toBe(false);
    expect(authUnavailable(null, "/daftar")).toBe(false);
    expect(error).not.toHaveBeenCalled();
  });
});
