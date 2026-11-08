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

const { acceptInvitationAction, revokeInvitationAction } = await import("../../src/modules/members/actions");
const workspace = await import("@/lib/workspace");
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

describe("revokeInvitationAction tenant scope (P2-1)", () => {
  const invitation = "00000000-0000-4000-b000-0000000000d1";
  const revokeForm = (id: string) => { const data = new FormData(); data.set("id", id); data.set("revision", "1"); return data; };
  beforeEach(() => {
    vi.mocked(workspace.requireWorkspace).mockResolvedValue({ tenant: { id: TENANT } } as never);
  });

  it("refuses an invitation that is not in the selected gerai's list without revoking", async () => {
    rpc.mockResolvedValueOnce({ data: [{ id: "00000000-0000-4000-b000-0000000000d2" }], error: null });
    expect(await revokeInvitationAction({}, revokeForm(invitation))).toEqual({ error: "Data tidak ditemukan atau Anda tidak memiliki akses." });
    expect(rpc).toHaveBeenCalledExactlyOnceWith("tenant_invitations_list", { p_tenant: TENANT });
  });

  it("refuses a non-UUID id before any call", async () => {
    expect(await revokeInvitationAction({}, revokeForm("x"))).toEqual({ error: expect.any(String) });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("revokes a listed invitation", async () => {
    rpc.mockResolvedValueOnce({ data: [{ id: invitation }], error: null }).mockResolvedValueOnce({ data: null, error: null });
    expect(await revokeInvitationAction({}, revokeForm(invitation))).toEqual({ ok: "Undangan dicabut." });
    expect(rpc).toHaveBeenLastCalledWith("revoke_invitation", { p_id: invitation, p_expected_revision: 1 });
  });
});
