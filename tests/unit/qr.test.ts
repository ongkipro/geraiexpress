import { describe, expect, it, vi } from "vitest";
import { qrModuleCount, qrSvgDataUri } from "../../src/lib/qr";
import { otpauthUri } from "../../src/lib/auth/totp";

// IAM-7: the authenticator QR is drawn on the server; nothing leaves the process.
const URI = "otpauth://totp/GeraiExpress:admin%40geraiexpress.test?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP&issuer=GeraiExpress&algorithm=SHA1&digits=6&period=30";

function svgOf(uri: string): string {
  expect(uri.startsWith("data:image/svg+xml;base64,")).toBe(true);
  return Buffer.from(uri.slice("data:image/svg+xml;base64,".length), "base64").toString("utf8");
}

describe("authenticator QR code", () => {
  it("has the module count of a version 8 symbol for a 147-byte otpauth URI (error correction M)", () => {
    expect(URI.length).toBe(147);
    expect(qrModuleCount(URI)).toBe(49);
  });

  it("grows with the payload: a short URI needs a smaller symbol", () => {
    expect(qrModuleCount("otpauth://totp/a?secret=ABCDEFGHIJKLMNOP")).toBeLessThan(49);
  });

  it("is an inline SVG with a 4-module quiet zone, a white background and one dark path", () => {
    const svg = svgOf(qrSvgDataUri(URI));
    expect(svg).toContain('viewBox="0 0 57 57"');
    expect(svg).toContain('<rect width="57" height="57" fill="#fff"/>');
    // The top-left finder pattern starts the first row with seven dark modules after the quiet zone.
    expect(svg).toContain('<path d="M4 4h7v1h-7z');
    expect(svg).toContain('fill="#000"');
    expect(svg.match(/<path /g)).toHaveLength(1);
  });

  it("is deterministic, and the secret never appears in the image text", () => {
    expect(qrSvgDataUri(URI)).toBe(qrSvgDataUri(URI));
    expect(svgOf(qrSvgDataUri(URI))).not.toContain("JBSWY3DPEHPK3PXP");
  });

  it("makes no external reference and no network call", () => {
    const network = vi.fn();
    vi.stubGlobal("fetch", network);
    const svg = svgOf(qrSvgDataUri(otpauthUri("JBSWY3DPEHPK3PXP", "admin@geraiexpress.test")));
    vi.unstubAllGlobals();
    expect(network).not.toHaveBeenCalled();
    // Only the SVG namespace URI; no href, no script, no image or font loading.
    expect(svg.replace('xmlns="http://www.w3.org/2000/svg"', "")).not.toMatch(/https?:|href|<script|<image|<use|url\(/i);
  });
});
