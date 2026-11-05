import { beforeEach, describe, expect, it, vi } from "vitest";

// T-105 / F-4: accepting an invitation stores the gerai selector cookie only when the RPC answers a UUID.
const rpc = vi.fn();
const set = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`); } }));
vi.mock("next/headers", () => ({ cookies: async () => ({ set }) }));
vi.mock("@/lib/errors", () => vi.importActual("../../src/lib/errors"));
vi.mock("@/lib/db/server", () => ({ dbServer: async () => ({ rpc }) }));
vi.mock("@/lib/workspace", () => ({ TENANT_COOKIE: "ge_tenant", requireWorkspace: vi.fn() }));

const { acceptInvitationAction } = await import("../../src/modules/members/actions");
const TENANT = "00000000-0000-4000-b000-0000000000c1";
const form = () => { const data = new FormData(); data.set("id", "00000000-0000-4000-b000-0000000000d1"); return data; };

beforeEach(() => vi.resetAllMocks());

describe("acceptInvitationAction (T-105 F-4)", () => {
  it.each([null, "null", "", 42, {}, "not-a-uuid"])("sets no cookie for the answer %j", async (data) => {
    rpc.mockResolvedValueOnce({ data, error: null });
    expect(await acceptInvitationAction({}, form())).toEqual({ error: expect.any(String) });
    expect(set).not.toHaveBeenCalled();
  });

  it("stores a UUID answer and opens the workspace", async () => {
    rpc.mockResolvedValueOnce({ data: TENANT, error: null });
    await expect(acceptInvitationAction({}, form())).rejects.toThrow("redirect:/");
    expect(set).toHaveBeenCalledExactlyOnceWith("ge_tenant", TENANT, expect.objectContaining({ httpOnly: true }));
  });
});
