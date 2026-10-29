import { describe, expect, it } from "vitest";
import { buildCsp, createCspNonce } from "../../src/lib/csp";

describe("CSP report-only rollout (SEC-6)", () => {
  it("enforces document boundaries but never a script policy", () => {
    const policy = buildCsp("test-nonce");
    expect(policy.enforced).toBe("frame-ancestors 'none'; object-src 'none'; base-uri 'none'; form-action 'self'");
    expect(policy.enforced).not.toContain("script-src");
    expect(policy.reportOnly).toContain("script-src 'self' 'nonce-test-nonce' 'strict-dynamic' https://challenges.cloudflare.com");
    expect(policy.reportOnly).toContain("frame-src https://challenges.cloudflare.com");
    expect(policy.reportOnly).not.toMatch(/unsafe-inline|unsafe-eval|\*/);
  });

  it("permits the documented Next dev eval only in the report-only development policy", () => {
    expect(buildCsp("nonce", true).reportOnly).toContain("'unsafe-eval'");
    expect(buildCsp("nonce", true).enforced).not.toContain("'unsafe-eval'");
    expect(buildCsp("nonce", false).reportOnly).not.toContain("'unsafe-eval'");
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
