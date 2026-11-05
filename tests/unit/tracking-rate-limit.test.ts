import { beforeEach, describe, expect, it } from "vitest";
import { resetLimiters } from "../../src/lib/limiter";
import { trackingWithinLimit } from "../../src/modules/tracking/rate-limit";

beforeEach(resetLimiters);
describe("public tracking visitor budgets", () => {
  it("allows 30 lookups per minute, then refuses, independently per visitor", async () => {
    for (let i = 0; i < 30; i++) expect(await trackingWithinLimit("192.0.2.1")).toBe(true);
    expect(await trackingWithinLimit("192.0.2.1")).toBe(false);
    expect(await trackingWithinLimit("192.0.2.2")).toBe(true);
  });
  it("counts invalid tokens independently and does not burn another visitor's budget", async () => {
    for (let i = 0; i < 10; i++) expect(await trackingWithinLimit("192.0.2.1", true)).toBe(true);
    expect(await trackingWithinLimit("192.0.2.1", true)).toBe(false);
    expect(await trackingWithinLimit("192.0.2.1")).toBe(true);
    expect(await trackingWithinLimit("192.0.2.2", true)).toBe(true);
  });
  it("always fails closed without a trusted visitor address, including local development", async () => {
    expect(await trackingWithinLimit(null)).toBe(false);
    expect(await trackingWithinLimit("")).toBe(false);
    expect(await trackingWithinLimit(null, true)).toBe(false);
  });
  it("groups rotating IPv6 addresses in the same /56", async () => {
    for (let i = 0; i < 30; i++) expect(await trackingWithinLimit("2001:db8:1234:5600::1")).toBe(true);
    expect(await trackingWithinLimit("2001:db8:1234:56ff::2")).toBe(false);
  });
});
