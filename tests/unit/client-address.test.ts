import { describe, expect, it } from "vitest";
import { CLIENT_ADDRESS_HEADER, clientAddress, isIpAddress, proxyTrusted } from "../../src/lib/client-address";

// T-062 / RATE-1: the client address comes only from the header the trusted reverse proxy overwrites.
const trusted = { TRUSTED_PROXY: "1" };
const h = (init: Record<string, string>) => new Headers(init);

describe("clientAddress", () => {
  it("reads X-Real-IP only while TRUSTED_PROXY is exactly 1", () => {
    expect(CLIENT_ADDRESS_HEADER).toBe("x-real-ip");
    expect(clientAddress(h({ "x-real-ip": "203.0.113.7" }), trusted)).toBe("203.0.113.7");
    expect(clientAddress(h({ "x-real-ip": "203.0.113.7" }), { TRUSTED_PROXY: " 1 " })).toBe("203.0.113.7");
    for (const value of [undefined, "", "0", "true", "yes", "2", "on"]) {
      expect(proxyTrusted({ TRUSTED_PROXY: value })).toBe(false);
      expect(clientAddress(h({ "x-real-ip": "203.0.113.7" }), { TRUSTED_PROXY: value }), String(value)).toBeNull();
    }
  });

  it("never lets a client-supplied header win: only X-Real-IP is read, whatever else is sent", () => {
    const spoof = h({
      "x-forwarded-for": "192.0.2.1, 192.0.2.2", "cf-connecting-ip": "192.0.2.3", "true-client-ip": "192.0.2.4",
      "x-client-ip": "192.0.2.5", forwarded: "for=192.0.2.6", "sb-forwarded-for": "192.0.2.7",
    });
    expect(clientAddress(spoof, trusted)).toBeNull();
    spoof.set("x-real-ip", "203.0.113.7");
    expect(clientAddress(spoof, trusted)).toBe("203.0.113.7");
  });

  it("models a proxy that REPLACES the header: a forged value the client sent is gone before the app reads it", () => {
    // What infra/proxy does (`header_up X-Real-IP {remote_host}`): set, not append.
    const clientSent = h({ "x-real-ip": "6.6.6.6" });
    clientSent.set("x-real-ip", "203.0.113.7");
    expect(clientAddress(clientSent, trusted)).toBe("203.0.113.7");
  });

  it("takes the LAST value when a hop appended to an existing list", () => {
    expect(clientAddress(h({ "x-real-ip": "6.6.6.6, 203.0.113.7" }), trusted)).toBe("203.0.113.7");
    expect(clientAddress(h({ "x-real-ip": "6.6.6.6,203.0.113.7 " }), trusted)).toBe("203.0.113.7");
    // Two header lines are joined by the Headers API the same way.
    const two = new Headers();
    two.append("x-real-ip", "6.6.6.6");
    two.append("x-real-ip", "203.0.113.7");
    expect(clientAddress(two, trusted)).toBe("203.0.113.7");
    // A forged tail does not produce an address either.
    expect(clientAddress(h({ "x-real-ip": "203.0.113.7, not-an-ip" }), trusted)).toBeNull();
  });

  it("does not mistake a trusted local/LAN client for a broken IPv6-to-IPv4 proxy hop", () => {
    for (const ip of ["10.0.0.1", "172.30.62.1", "192.168.1.10"]) {
      expect(clientAddress(h({ "x-real-ip": ip }), { NODE_ENV: "production", ...trusted })).toBe(ip);
      expect(clientAddress(h({ "x-real-ip": ip }), { NODE_ENV: "production" })).toBeNull();
    }
  });

  it("treats anything that is not a plain IPv4 or IPv6 address as unknown", () => {
    for (const value of ["", "unknown", "203.0.113", "203.0.113.256", "203.0.113.7:443", "[2001:db8::1]", "2001:db8::zz", "1.2.3.4/32", "203.0.113.7 evil", "::ffff:1.2.3.4.5", "<script>"]) {
      expect(clientAddress(h({ "x-real-ip": value }), trusted), value).toBeNull();
    }
    expect(clientAddress(new Headers(), trusted)).toBeNull();
    for (const value of ["203.0.113.7", "2001:db8::1", "::1", "2001:db8:abcd:12ff::7", "::ffff:203.0.113.7"]) {
      expect(isIpAddress(value), value).toBe(true);
      expect(clientAddress(h({ "x-real-ip": value }), trusted), value).toBe(value);
    }
  });
});
