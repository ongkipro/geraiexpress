import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const auth = { getClaims: vi.fn(async () => ({ data: null, error: null })), getUser: vi.fn(async () => ({ data: { user: null }, error: null })) };
vi.mock("@supabase/ssr", () => ({ createServerClient: () => ({ auth }) }));

const { middleware } = await import("../../src/middleware");

describe("middleware session check", () => {
  beforeEach(() => {
    auth.getClaims.mockClear();
    auth.getUser.mockClear();
  });

  it("verifies page reads locally, without an Auth round trip", async () => {
    for (const method of ["GET", "HEAD"]) {
      const res = await middleware(new NextRequest("http://localhost/pengiriman", { method }));
      expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    }
    expect(auth.getClaims).toHaveBeenCalledTimes(2);
    expect(auth.getUser).not.toHaveBeenCalled();
  });

  it("asks Auth before a server action, so a revoked session is cleared first", async () => {
    await middleware(new NextRequest("http://localhost/admin", { method: "POST" }));
    expect(auth.getUser).toHaveBeenCalledTimes(1);
    expect(auth.getClaims).not.toHaveBeenCalled();
  });
});
