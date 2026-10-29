import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as LimiterModule from "../../src/lib/limiter";
import { ACCOUNT_MAX_KEYS, DEFAULT_MAX_KEYS, LIMITS, createFixedWindowLimiter, limiterFor, resetLimiters } from "../../src/lib/limiter";

beforeEach(() => { vi.spyOn(console, "warn").mockImplementation(() => {}); });
afterEach(() => { resetLimiters(); vi.restoreAllMocks(); });

// T-062: the in-process fixed-window limiter that replaced the Workers Rate Limiting bindings.
function clock(start = 1000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => { t += ms; } };
}

describe("fixed-window limiter", () => {
  it("allows `limit` attempts per key inside a window and refuses the rest, without extending the window", async () => {
    const c = clock();
    const l = createFixedWindowLimiter({ limit: 3, periodMs: 60_000, now: c.now });
    const results: boolean[] = [];
    for (let i = 0; i < 5; i++) results.push((await l.limit({ key: "a" })).success);
    expect(results).toEqual([true, true, true, false, false]);
    // Refused attempts late in the window do not push its end out.
    c.advance(59_000);
    expect((await l.limit({ key: "a" })).success).toBe(false);
    c.advance(1_000);
    expect((await l.limit({ key: "a" })).success).toBe(true);
  });

  it("keeps keys independent and starts a fresh window exactly after the period", async () => {
    const c = clock();
    const l = createFixedWindowLimiter({ limit: 1, periodMs: 60_000, now: c.now });
    expect((await l.limit({ key: "a" })).success).toBe(true);
    expect((await l.limit({ key: "b" })).success).toBe(true);
    expect((await l.limit({ key: "a" })).success).toBe(false);
    c.advance(59_999);
    expect((await l.limit({ key: "a" })).success).toBe(false);
    c.advance(1);
    expect((await l.limit({ key: "a" })).success).toBe(true);
    expect((await l.limit({ key: "a" })).success).toBe(false);
  });

  it("evicts expired windows when the table is full and admits the new key", async () => {
    const c = clock();
    const l = createFixedWindowLimiter({ limit: 1, periodMs: 1000, maxKeys: 3, now: c.now });
    for (const key of ["a", "b", "c"]) await l.limit({ key });
    expect(l.size()).toBe(3);
    c.advance(1000);
    expect((await l.limit({ key: "d" })).success).toBe(true);
    expect(l.size()).toBe(1);
  });

  it("refuses new keys only if every live window is exhausted, preserving every exhausted budget", async () => {
    const c = clock();
    const l = createFixedWindowLimiter({ limit: 2, periodMs: 60_000, maxKeys: 2, now: c.now });
    for (const key of ["victim", "other"]) {
      await l.limit({ key });
      await l.limit({ key });
    }
    for (let i = 0; i < 20; i++) expect((await l.limit({ key: `junk-${i}` })).success).toBe(false);
    expect(l.size()).toBe(2);
    expect((await l.limit({ key: "victim" })).success).toBe(false);
    c.advance(60_000);
    expect((await l.limit({ key: "junk-new" })).success).toBe(true);
  });

  it("evicts the oldest non-exhausted live window, never a spent window, under a fresh-key flood", async () => {
    const c = clock();
    const l = createFixedWindowLimiter({ limit: 2, periodMs: 60_000, maxKeys: 3, now: c.now });
    await l.limit({ key: "spent" });
    await l.limit({ key: "spent" });
    await l.limit({ key: "oldest-available" });
    await l.limit({ key: "newer-available" });
    expect((await l.limit({ key: "fresh" })).success).toBe(true);
    // The newer window was not evicted: one attempt remains, not two.
    expect((await l.limit({ key: "newer-available" })).success).toBe(true);
    expect((await l.limit({ key: "newer-available" })).success).toBe(false);
    for (let i = 0; i < 100; i++) expect((await l.limit({ key: `pair-${i}` })).success).toBe(true);
    expect((await l.limit({ key: "spent" })).success).toBe(false);
    expect(l.size()).toBe(3);
  });

  it("admits a new visitor/account after 10k pairs from 1k visitors, retaining an exhausted account", async () => {
    const l = createFixedWindowLimiter({ limit: 10, periodMs: 60_000, maxKeys: 10_000, now: () => 0 });
    for (let i = 0; i < 10; i++) await l.limit({ key: "exhausted-account" });
    for (let visitor = 0; visitor < 1000; visitor++) {
      for (let account = 0; account < 10; account++) {
        expect((await l.limit({ key: `acct:${account}|visitor:${visitor}` })).success).toBe(true);
      }
    }
    expect((await l.limit({ key: "fresh-account|fresh-visitor" })).success).toBe(true);
    expect((await l.limit({ key: "exhausted-account" })).success).toBe(false);
    expect(l.size()).toBe(10_000);
    // The production account tables have headroom beyond the visitor-table ceiling.
    expect(ACCOUNT_MAX_KEYS).toBe(100_000);
    for (let i = 0; i < 10_001; i++) {
      expect((await limiterFor("SIGN_IN_ACCOUNT_LIMITER").limit({ key: `pair-${i}` })).success).toBe(true);
    }
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it("logs saturation at most once a minute per table, never any key material", async () => {
    const c = clock();
    const l = createFixedWindowLimiter({ limit: 2, periodMs: 120_000, maxKeys: 1, name: "OTP_ACCOUNT_LIMITER", now: c.now });
    await l.limit({ key: "private-email-pair" });
    for (let i = 0; i < 5; i++) await l.limit({ key: `secret-key-${i}` });
    expect(console.warn).toHaveBeenCalledTimes(1);
    c.advance(59_999);
    await l.limit({ key: "still-saturated" });
    expect(console.warn).toHaveBeenCalledTimes(1);
    c.advance(1);
    await l.limit({ key: "new-minute" });
    expect(console.warn).toHaveBeenCalledTimes(2);
    expect(console.warn).toHaveBeenLastCalledWith(JSON.stringify({
      event: "rate_limiter_saturated", limiter: "OTP_ACCOUNT_LIMITER", maxKeys: 1, action: "evicted_unspent",
    }));
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toMatch(/private-email-pair|secret-key|new-minute/);
  });

  it("keeps memory bounded: the table never exceeds maxKeys across many distinct keys", async () => {
    const c = clock();
    const l = createFixedWindowLimiter({ limit: 1, periodMs: 100, maxKeys: 50, now: c.now });
    for (let i = 0; i < 5000; i++) {
      await l.limit({ key: `k${i}` });
      expect(l.size()).toBeLessThanOrEqual(50);
      if (i % 10 === 9) c.advance(100);
    }
  });

  it("restarting an expired key moves it to the back, so eviction order stays by window start", async () => {
    const c = clock();
    const l = createFixedWindowLimiter({ limit: 1, periodMs: 100, maxKeys: 2, now: c.now });
    await l.limit({ key: "a" });
    c.advance(60);
    await l.limit({ key: "b" });
    c.advance(60); // a expired, b live
    await l.limit({ key: "a" }); // restarted: now behind b
    c.advance(60); // b expired (start 60, now 180), a live (start 120)
    expect((await l.limit({ key: "c" })).success).toBe(true); // evicts expired b from the front, not live a
    expect((await l.limit({ key: "a" })).success).toBe(false);
  });

  it("has a documented default key cap", () => {
    expect(DEFAULT_MAX_KEYS).toBe(10_000);
  });
});

describe("named limiters", () => {
  it("carry the limits of the former wrangler.jsonc bindings", () => {
    expect(LIMITS).toEqual({
      SIGN_IN_LIMITER: { limit: 10, periodSeconds: 60 },
      DEMO_LIMITER: { limit: 5, periodSeconds: 60 },
      MFA_LIMITER: { limit: 10, periodSeconds: 60 },
      OTP_LIMITER: { limit: 3, periodSeconds: 60 },
      SIGN_IN_ACCOUNT_LIMITER: { limit: 10, periodSeconds: 60 },
      OTP_ACCOUNT_LIMITER: { limit: 10, periodSeconds: 60 },
      SIGN_IN_ACCOUNT_VISITOR_LIMITER: { limit: 5, periodSeconds: 60 },
      OTP_ACCOUNT_VISITOR_LIMITER: { limit: 5, periodSeconds: 60 },
      MFA_ACCOUNT_LIMITER: { limit: 10, periodSeconds: 60 },
      REFRESH_LIMITER: { limit: 10, periodSeconds: 60 },
    });
  });

  it("is one shared table per name on globalThis, surviving module re-evaluation, with separate names isolated", async () => {
    const a = limiterFor("OTP_LIMITER");
    expect(limiterFor("OTP_LIMITER")).toBe(a);
    for (let i = 0; i < 3; i++) await a.limit({ key: "k" });
    expect((await limiterFor("OTP_LIMITER").limit({ key: "k" })).success).toBe(false);
    expect((await limiterFor("DEMO_LIMITER").limit({ key: "k" })).success).toBe(true);
    // A re-evaluated copy of the module (hot reload, another bundle in the same process) sees the same table.
    // The query suffix makes the module loader evaluate the file a second time (a runtime-chosen specifier).
    const specifier = "../../src/lib/limiter?again";
    const again: typeof LimiterModule = await import(/* @vite-ignore */ specifier);
    expect((await again.limiterFor("OTP_LIMITER").limit({ key: "k" })).success).toBe(false);
  });
});
