import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { limiterFor, resetLimiters } from "../../src/lib/limiter";
import { visitorKey } from "../../src/lib/visitor-key";
import { REFRESH_RETRY_AFTER_SECONDS, accountKey, withinAccountLimit, withinAccountVisitorLimit, withinLimit } from "../../src/lib/rate-limit";

let requestHeaders = new Headers();
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: async () => requestHeaders }));
// Reuse production modules across the project's virtual @ aliases; substitute only request I/O.
vi.mock("@/lib/visitor-key", () => vi.importActual("../../src/lib/visitor-key"));
vi.mock("@/lib/auth-errors", () => vi.importActual("../../src/lib/auth-errors"));
vi.mock("@/lib/auth/store", () => vi.importActual("../../src/lib/auth/store"));
vi.mock("@/lib/client-address", () => vi.importActual("../../src/lib/client-address"));
vi.mock("@/lib/limiter", () => vi.importActual("../../src/lib/limiter"));

beforeEach(() => {
  resetLimiters();
  requestHeaders = new Headers({ host: "app.geraiexpress.com", "x-real-ip": "203.0.113.7" });
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("TRUSTED_PROXY", "1");
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("account and visitor budgets (RATE-2)", () => {
  it("uses only a normalized SHA-256 email digest, never the email", async () => {
    const key = await accountKey("  User@Example.test  ");
    expect(key).toBe(`acct:${createHash("sha256").update("user@example.test").digest("hex")}`);
    expect(key).toMatch(/^acct:[a-f0-9]{64}$/);
    expect(key).toBe(await accountKey("user@example.test"));
    expect(key).not.toBe(await accountKey("other@example.test"));
  });

  it.each(["SIGN_IN_ACCOUNT_LIMITER", "OTP_ACCOUNT_LIMITER"] as const)("%s refuses the eleventh attempt across different visitors", async (action) => {
    const spy = vi.spyOn(limiterFor(action), "limit");
    for (let i = 0; i < 11; i++) {
      requestHeaders.set("x-real-ip", `203.0.113.${i + 1}`);
      expect(await withinAccountLimit(action, i % 2 ? " User@Example.test " : "user@example.test")).toBe(i < 10);
    }
    expect(await withinAccountLimit(action, "another@example.test")).toBe(true);
    expect(spy.mock.calls[0][0].key).toMatch(/^acct:[a-f0-9]{64}$/);
  });

  it("keys MFA on the verified user, independently of the visitor and other users", async () => {
    const spy = vi.spyOn(limiterFor("MFA_ACCOUNT_LIMITER"), "limit");
    for (let i = 0; i < 11; i++) {
      requestHeaders.set("x-real-ip", `198.51.100.${i + 1}`);
      expect(await withinAccountLimit("MFA_ACCOUNT_LIMITER", "verified-user")).toBe(i < 10);
    }
    expect(await withinAccountLimit("MFA_ACCOUNT_LIMITER", "other-user")).toBe(true);
    expect(spy.mock.calls[0][0]).toEqual({ key: "mfa:verified-user" });
  });

  it("shares a visitor budget across /64s of a /56, not across /56s", async () => {
    for (let i = 0; i < 10; i++) expect(await withinLimit("SIGN_IN_LIMITER", `2001:db8:abcd:12${(i * 16).toString(16).padStart(2, "0").slice(0, 2)}::1`)).toBe(true);
    expect(await withinLimit("SIGN_IN_LIMITER", "2001:db8:abcd:12ff::2")).toBe(false);
    expect(await withinLimit("SIGN_IN_LIMITER", "2001:db8:abcd:1300::1")).toBe(true);
  });

  it("applies the documented per-visitor limits and gives each action its own window", async () => {
    for (let i = 0; i < 3; i++) expect(await withinLimit("OTP_LIMITER", "203.0.113.20")).toBe(true);
    expect(await withinLimit("OTP_LIMITER", "203.0.113.20")).toBe(false);
    for (let i = 0; i < 5; i++) expect(await withinLimit("DEMO_LIMITER", "203.0.113.20")).toBe(true);
    expect(await withinLimit("DEMO_LIMITER", "203.0.113.20")).toBe(false);
    for (let i = 0; i < 10; i++) expect(await withinLimit("SIGN_IN_LIMITER", "203.0.113.20")).toBe(true);
    expect(await withinLimit("SIGN_IN_LIMITER", "203.0.113.20")).toBe(false);
    for (let i = 0; i < 10; i++) expect(await withinLimit("MFA_LIMITER", "203.0.113.20")).toBe(true);
    expect(await withinLimit("MFA_LIMITER", "203.0.113.20")).toBe(false);
    // Another visitor is untouched.
    expect(await withinLimit("OTP_LIMITER", "203.0.113.21")).toBe(true);
  });

  it("reads the visitor from the trusted proxy header and fails closed in production without one", async () => {
    expect(await withinLimit("SIGN_IN_LIMITER")).toBe(true);
    // No TRUSTED_PROXY: the address is unknown even though a header is present.
    vi.stubEnv("TRUSTED_PROXY", "");
    expect(await withinLimit("SIGN_IN_LIMITER")).toBe(false);
    vi.stubEnv("TRUSTED_PROXY", "1");
    requestHeaders.delete("x-real-ip");
    expect(await withinLimit("SIGN_IN_LIMITER")).toBe(false);
    expect(await withinLimit("SIGN_IN_LIMITER", null)).toBe(false);
    // A spoofable header is never the visitor.
    requestHeaders.set("x-forwarded-for", "192.0.2.50");
    requestHeaders.set("cf-connecting-ip", "192.0.2.51");
    expect(await withinLimit("SIGN_IN_LIMITER")).toBe(false);
  });

  it("fails closed for an empty target in production, retaining local-dev behavior", async () => {
    expect(await withinAccountLimit("OTP_ACCOUNT_LIMITER", "  ")).toBe(false);
    vi.stubEnv("NODE_ENV", "development");
    expect(await withinAccountLimit("MFA_ACCOUNT_LIMITER", "  ")).toBe(true);
    expect(await withinLimit("SIGN_IN_LIMITER", null)).toBe(true);
  });
});

describe("account + visitor budget (M1)", () => {
  it.each(["SIGN_IN_ACCOUNT_LIMITER", "OTP_ACCOUNT_LIMITER"] as const)("%s pair ceiling is lower than account ceiling", async (action) => {
    const spy = vi.spyOn(limiterFor(action === "SIGN_IN_ACCOUNT_LIMITER" ? "SIGN_IN_ACCOUNT_VISITOR_LIMITER" : "OTP_ACCOUNT_VISITOR_LIMITER"), "limit");
    for (let i = 0; i < 5; i++) expect(await withinAccountVisitorLimit(action, "User@Example.test", "203.0.113.1")).toBe(true);
    expect(await withinAccountVisitorLimit(action, "user@example.test", "203.0.113.1")).toBe(false);
    expect(await withinAccountVisitorLimit(action, "user@example.test", "203.0.113.2")).toBe(true);
    expect(await withinAccountVisitorLimit(action, "other@example.test", "203.0.113.1")).toBe(true);
    expect(spy.mock.calls[0][0].key).toBe(`${await accountKey("user@example.test")}|203.0.113.1`);
    for (let i = 0; i < 10; i++) expect(await withinAccountLimit(action, "user@example.test")).toBe(true);
    expect(await withinAccountLimit(action, "user@example.test")).toBe(false);
  });

  it("fails closed in production without a visitor address or an email", async () => {
    expect(await withinAccountVisitorLimit("SIGN_IN_ACCOUNT_LIMITER", "user@example.test", null)).toBe(false);
    expect(await withinAccountVisitorLimit("SIGN_IN_ACCOUNT_LIMITER", "  ", "203.0.113.1")).toBe(false);
  });

  it("treats a throwing limiter as refusal, without retrying", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const spy = vi.spyOn(limiterFor("SIGN_IN_LIMITER"), "limit").mockRejectedValue(new Error("down"));
    expect(await withinLimit("SIGN_IN_LIMITER")).toBe(false);
    expect(spy).toHaveBeenCalledOnce();
  });
});

// The proxy (src/proxy.ts) spends this budget once per actual refresh and answers a refusal with
// 503 + Retry-After; the limiter itself only decides and logs.
describe("session refresh budget", () => {
  it("answers a retry window of one minute", () => {
    expect(REFRESH_RETRY_AFTER_SECONDS).toBe(60);
  });

  it("allows ten refreshes per visitor and window, then refuses and logs the bounded throttle event", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (let i = 0; i < 10; i++) expect(await withinLimit("REFRESH_LIMITER", "203.0.113.7")).toBe(true);
    expect(warn).not.toHaveBeenCalled();
    expect(await withinLimit("REFRESH_LIMITER", "203.0.113.7")).toBe(false);
    expect(warn).toHaveBeenCalledExactlyOnceWith(JSON.stringify({ event: "auth_rate_limited", route: "/refresh", status: 503 }));
    // Another visitor is untouched.
    expect(await withinLimit("REFRESH_LIMITER", "203.0.113.8")).toBe(true);
  });

  it("shares the budget across a visitor's /56 while preserving another visitor", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    for (let i = 0; i < 10; i++) expect(await withinLimit("REFRESH_LIMITER", visitorKey("2001:db8:abcd:1200::1")!)).toBe(true);
    expect(await withinLimit("REFRESH_LIMITER", "2001:db8:abcd:12ff::2")).toBe(false);
    expect(await withinLimit("REFRESH_LIMITER", "2001:db8:abcd:1300::1")).toBe(true);
  });

  it("refuses a refresh without a visitor address in production, and logs it too", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await withinLimit("REFRESH_LIMITER", null)).toBe(false);
    expect(warn).toHaveBeenCalledOnce();
  });

  it("logs no throttle event for the other budgets (their callers log their own route)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (let i = 0; i < 11; i++) await withinLimit("SIGN_IN_LIMITER", "203.0.113.30");
    expect(warn).not.toHaveBeenCalled();
  });
});
