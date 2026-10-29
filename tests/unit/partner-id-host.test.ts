import { beforeEach, expect, it, vi } from "vitest";
import { setPartnerIdAction } from "../../src/modules/credentials/actions";

const scope = vi.fn();
const rpc = vi.fn();
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/hosts", () => ({ requestScope: () => scope() }));
vi.mock("@/lib/db/server", () => ({ dbServer: async () => ({ rpc }) }));
vi.mock("@/lib/errors", () => ({ friendlyError: () => "Refused" }));
vi.mock("@/lib/credential-crypto", () => ({}));
vi.mock("@/lib/mengantar/partner-onboarding", () => ({}));
vi.mock("@/lib/config", () => ({}));
vi.mock("@/lib/workspace", () => ({}));
vi.mock("../../src/modules/credentials/partner-deps", () => ({}));
beforeEach(() => { rpc.mockReset().mockResolvedValue({ error: null }); });
it.each(["tenant", "marketing", "hooks", null])("Partner ID refuses %s before database authorization", async (host) => {
  scope.mockResolvedValue(host);
  expect(await setPartnerIdAction({}, new FormData())).toEqual({ error: "Tidak ditemukan." });
  expect(rpc).not.toHaveBeenCalled();
});
it.each(["platform", "shared"])("Partner ID reaches database authorization on %s", async (host) => {
  scope.mockResolvedValue(host);
  await setPartnerIdAction({}, new FormData());
  expect(rpc).toHaveBeenCalledWith("platform_set_partner_id", expect.any(Object));
});
