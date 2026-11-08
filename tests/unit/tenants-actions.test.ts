import { beforeEach, describe, expect, it, vi } from "vitest";

// T-053 / T-054: the Super Admin tenant commands validate the target and the reason before the database and
// forward exactly what the operator confirmed.
const TENANT = "00000000-0000-4000-b000-0000000000c1";
const rpc = vi.fn();
const requirePlatform = vi.fn();

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/errors", () => vi.importActual("../../src/lib/errors"));
vi.mock("@/lib/platform", () => ({ requirePlatform: (capability: string) => requirePlatform(capability) }));
vi.mock("@/lib/db/server", () => ({ dbServer: async () => ({ rpc }) }));

const { clearPartnerStopAction, setMaskingAllowedAction } = await import("../../src/modules/tenants/actions");

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

beforeEach(() => {
  vi.resetAllMocks();
  requirePlatform.mockResolvedValue({});
});

describe("clearPartnerStopAction", () => {
  it("needs the integration capability", async () => {
    rpc.mockResolvedValue({ error: null });
    await clearPartnerStopAction({}, form({ tenant_id: TENANT, reason: "sudah dicek dengan Mengantar" }));
    expect(requirePlatform).toHaveBeenCalledWith("integration_operations");
  });

  it.each([
    ["a non-UUID tenant", { tenant_id: "x", reason: "alasan cukup" }],
    ["a reason below 5 characters", { tenant_id: TENANT, reason: "  abc " }],
    ["a reason above 500 characters", { tenant_id: TENANT, reason: "a".repeat(501) }],
  ])("refuses %s without a database call", async (_, values) => {
    expect(await clearPartnerStopAction({}, form(values))).toEqual({ error: expect.any(String) });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("forwards the trimmed reason and reports success", async () => {
    rpc.mockResolvedValueOnce({ error: null });
    expect(await clearPartnerStopAction({}, form({ tenant_id: TENANT, reason: "  sudah dicek dengan Mengantar " }))).toEqual({ ok: expect.stringContaining("Pembatasan Mengantar dibuka") });
    expect(rpc).toHaveBeenCalledExactlyOnceWith("platform_clear_partner_stop", { p_tenant: TENANT, p_reason: "sudah dicek dengan Mengantar" });
  });

  it("returns the mapped refusal of the database", async () => {
    rpc.mockResolvedValueOnce({ error: { message: "not_found" } });
    expect(await clearPartnerStopAction({}, form({ tenant_id: TENANT, reason: "alasan cukup" }))).toEqual({ error: "Data tidak ditemukan atau Anda tidak memiliki akses." });
  });
});

describe("setMaskingAllowedAction", () => {
  it("needs the tenant governance capability", async () => {
    rpc.mockResolvedValue({ data: [{ masking_allowed: true }], error: null });
    await setMaskingAllowedAction({}, form({ tenant_id: TENANT, allowed: "no", reason: "kurir menolak label" }));
    expect(requirePlatform).toHaveBeenCalledWith("tenant_governance");
  });

  it.each([
    ["a non-UUID tenant", { tenant_id: "x", allowed: "no", reason: "alasan cukup" }],
    ["an unknown target", { tenant_id: TENANT, allowed: "maybe", reason: "alasan cukup" }],
    ["a short reason", { tenant_id: TENANT, allowed: "no", reason: "abc" }],
    ["a long reason", { tenant_id: TENANT, allowed: "no", reason: "a".repeat(501) }],
  ])("refuses %s without a database call", async (_, values) => {
    expect(await setMaskingAllowedAction({}, form(values))).toEqual({ error: expect.any(String) });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("forwards the confirmed target and reason", async () => {
    rpc.mockResolvedValueOnce({ data: [{ masking_allowed: true }], error: null }).mockResolvedValueOnce({ error: null });
    expect((await setMaskingAllowedAction({}, form({ tenant_id: TENANT, allowed: "no", reason: " kurir menolak label " }))).ok).toContain("dinonaktifkan");
    expect(rpc).toHaveBeenLastCalledWith("platform_set_masking_allowed", { p_tenant: TENANT, p_allowed: false, p_reason: "kurir menolak label" });
  });

  it("says when nothing changed", async () => {
    rpc.mockResolvedValueOnce({ data: [{ masking_allowed: true }], error: null }).mockResolvedValueOnce({ error: null });
    expect((await setMaskingAllowedAction({}, form({ tenant_id: TENANT, allowed: "yes", reason: "alasan cukup" }))).ok).toContain("tidak ada perubahan");
  });
});
