import { describe, expect, it } from "vitest";
import { buildCsp, createCspNonce } from "../../src/lib/csp";

describe("enforced nonce CSP (SEC-6, T-055)", () => {
  it("enforces the document boundaries and the nonce script policy in one policy", () => {
    expect(buildCsp("test-nonce").policy).toBe(
      "frame-ancestors 'none'; object-src 'none'; base-uri 'none'; form-action 'self'; "
      + "script-src 'self' 'nonce-test-nonce' 'strict-dynamic' https://challenges.cloudflare.com; "
      + "frame-src https://challenges.cloudflare.com",
    );
    expect(buildCsp("test-nonce").policy).not.toMatch(/unsafe-inline|unsafe-eval|\*|default-src|style-src/);
  });

  it("permits the documented Next dev eval only in development", () => {
    expect(buildCsp("nonce", true).policy).toContain("script-src 'self' 'nonce-nonce' 'strict-dynamic' https://challenges.cloudflare.com 'unsafe-eval';");
    expect(buildCsp("nonce", false).policy).not.toContain("'unsafe-eval'");
    expect(buildCsp("nonce").policy).not.toContain("'unsafe-eval'");
  });

  it("disables the unused browser capabilities", () => {
    expect(buildCsp("nonce").permissions).toBe("camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()");
  });

  it("generates fresh unpredictable 128-bit base64 nonces", () => {
    const nonces = Array.from({ length: 100 }, createCspNonce);
    expect(new Set(nonces).size).toBe(nonces.length);
    for (const nonce of nonces) {
      expect(nonce).toMatch(/^[A-Za-z0-9+/]{22}==$/);
      expect(atob(nonce)).toHaveLength(16);
    }
  });
});
