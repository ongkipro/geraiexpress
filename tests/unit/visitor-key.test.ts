import { describe, expect, it } from "vitest";
import { allowUnlimited, visitorKey } from "../../src/lib/visitor-key";

describe("visitorKey (RATE-1)", () => {
  it("keys IPv4 per address", () => {
    expect(visitorKey("203.0.113.7")).toBe("203.0.113.7");
    expect(visitorKey("::ffff:203.0.113.7")).toBe("203.0.113.7");
  });

  it("keys every address and /64 of one IPv6 /56 the same, whatever the notation", () => {
    const key = "2001:db8:abcd:1200::/56";
    expect(visitorKey("2001:db8:abcd:1200::1")).toBe(key);
    expect(visitorKey("2001:0DB8:abcd:12ff:ffff:1:2:3")).toBe(key);
    expect(visitorKey("2001:db8:abcd:1234:1::")).toBe(key);
    expect(visitorKey("2001:db8:abcd:1300::1")).not.toBe(key);
    expect(visitorKey("2001:db8:abce:1200::1")).not.toBe(key);
    expect(visitorKey("2001:db8::1")).toBe("2001:db8:0:0::/56");
    expect(visitorKey("::1")).toBe("0:0:0:0::/56");
  });

  it("has no key without an address", () => {
    expect(visitorKey(null)).toBeNull();
    expect(visitorKey("  ")).toBeNull();
  });

  it("fails closed in the deployed Worker", () => {
    expect(allowUnlimited("production")).toBe(false);
    expect(allowUnlimited("development")).toBe(true);
  });
});
