import { beforeEach, expect, it, vi } from "vitest";
import { readGeraiLogo } from "../../src/lib/gerai-logo-server";
const rpc = vi.fn();
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/server", () => ({ dbServer: async () => ({ rpc }) }));
beforeEach(() => { rpc.mockReset(); });

it("reads only the selected tenant using the user's RPC and distinguishes no logo from a failed read", async () => {
  rpc.mockResolvedValue({ data: { revision: 0, logo: null }, error: null });
  expect(await readGeraiLogo("selected-tenant")).toEqual({ revision: 0, logo: null });
  expect(rpc).toHaveBeenCalledWith("tenant_logo", { p_tenant: "selected-tenant" });
  for (const response of [{ data: null, error: { message: "not_found" } }, { data: {}, error: null },
    { data: { revision: 1, logo: { version: 1, mime: "image/png", base64: "broken" } }, error: null }]) {
    rpc.mockResolvedValue(response);
    expect(await readGeraiLogo("selected-tenant")).toBeNull();
  }
  rpc.mockRejectedValue(new Error("unavailable"));
  expect(await readGeraiLogo("selected-tenant")).toBeNull();
});
