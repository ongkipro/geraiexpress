import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const auth = { getClaims: vi.fn(async () => ({ data: null, error: null })), getUser: vi.fn(async () => ({ data: { user: null }, error: null })) };
vi.mock("@supabase/ssr", () => ({ createServerClient: () => ({ auth }) }));

const { middleware } = await import("../../src/middleware");

describe("middleware session check and security headers", () => {
  beforeEach(() => {
    auth.getClaims.mockClear();
    auth.getUser.mockClear();
  });

  it("verifies page reads locally, without an Auth round trip, and sets defensive headers", async () => {
    for (const method of ["GET", "HEAD"]) {
      const res = await middleware(new NextRequest("http://localhost/pengiriman", { method }));
      expect(res.headers.get("Cache-Control")).toBe("private, no-store");
      expect(res.headers.get("X-Frame-Options")).toBe("DENY");
      expect(res.headers.get("Content-Security-Policy")).toBe("frame-ancestors 'none'");
      expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
      expect(res.headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
      expect(res.headers.get("Strict-Transport-Security")).toBeNull();
    }
    expect(auth.getClaims).toHaveBeenCalledTimes(2);
    expect(auth.getUser).not.toHaveBeenCalled();
  });

  it("asks Auth before a server action and sets HSTS on HTTPS requests", async () => {
    const res = await middleware(new NextRequest("https://geraiexpress.com/admin", { method: "POST" }));
    expect(auth.getUser).toHaveBeenCalledTimes(1);
    expect(auth.getClaims).not.toHaveBeenCalled();
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
    expect(res.headers.get("Content-Security-Policy")).toBe("frame-ancestors 'none'");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(res.headers.get("Strict-Transport-Security")).toBe("max-age=31536000; includeSubDomains");
  });
});
