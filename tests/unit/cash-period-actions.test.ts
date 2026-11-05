import { beforeEach, describe, expect, it, vi } from "vitest";
import { closeCashPeriodAction, reopenCashPeriodAction } from "../../src/modules/payments/cash-period-actions";
import { CASH_UNKNOWN_RESULT } from "../../src/modules/payments/cash-periods";

const period = "00000000-0000-4000-b000-000000000001";
const workspace = { tenant: { id: "tenant-a" }, role: "operator" };
const rpc = vi.fn(), revalidate = vi.fn(), eq = vi.fn(), maybeSingle = vi.fn();
const query = { select: () => query, eq: (column: string, value: string) => { eq(column, value); return query; }, maybeSingle };
vi.mock("next/cache", () => ({ revalidatePath: (...args: unknown[]) => revalidate(...args) }));
vi.mock("@/lib/workspace", () => ({ requireWorkspace: async () => workspace }));
vi.mock("@/lib/db/server", () => ({ dbServer: async () => ({ from: () => query, rpc }) }));
const form = (values: Record<string, string> = {}) => {
  const data = new FormData();
  for (const [k, v] of Object.entries({ period_id: period, counted: "12.000", reason: "Hitung ulang uang tunai", ...values })) data.set(k, v);
  return data;
};
beforeEach(() => {
  vi.clearAllMocks(); workspace.role = "operator";
  rpc.mockResolvedValue({ error: null });
  maybeSingle.mockResolvedValue({ data: { id: period }, error: null });
});
describe("closeCashPeriodAction", () => {
  it("scopes to the selected tenant and sends counted cash only, never forged expected totals", async () => {
    expect((await closeCashPeriodAction({}, form({ expected: "99999", variance: "99999" }))).ok).toBeTruthy();
    expect(eq).toHaveBeenCalledWith("tenant_id", "tenant-a");
    expect(eq).toHaveBeenCalledWith("id", period);
    expect(rpc).toHaveBeenCalledWith("close_cash_period", { p_period: period, p_counted_idr: 12000 });
    expect(revalidate).toHaveBeenCalledWith("/kas");
  });
  it("accepts zero, rejects malformed money/unsafe integers and invalid period IDs", async () => {
    expect((await closeCashPeriodAction({}, form({ counted: "0" }))).ok).toBeTruthy();
    rpc.mockClear();
    for (const counted of ["", "-1", "1,50", "12.34", "9007199254740992"]) expect((await closeCashPeriodAction({}, form({ counted }))).fieldErrors?.counted).toBeTruthy();
    expect((await closeCashPeriodAction({}, form({ period_id: "other" }))).error).toBeTruthy();
    expect(rpc).not.toHaveBeenCalled();
  });
  it("does not mutate an out-of-workspace period", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null });
    expect((await closeCashPeriodAction({}, form())).error).toBeTruthy();
    expect(rpc).not.toHaveBeenCalled();
  });
  it("requires reload on unknown outcomes and a stale closed period, without hidden retries", async () => {
    rpc.mockResolvedValueOnce({ error: { message: "FetchError" } });
    expect(await closeCashPeriodAction({}, form())).toEqual({ error: CASH_UNKNOWN_RESULT, reconcile: true });
    rpc.mockRejectedValueOnce(new Error("lost response"));
    expect(await closeCashPeriodAction({}, form())).toEqual({ error: CASH_UNKNOWN_RESULT, reconcile: true });
    rpc.mockResolvedValueOnce({ error: { message: "period_closed" } });
    expect((await closeCashPeriodAction({}, form())).reconcile).toBe(true);
    expect(rpc).toHaveBeenCalledTimes(3);
  });
});
describe("reopenCashPeriodAction", () => {
  it("requires an admin and a 5–500 character reason", async () => {
    expect((await reopenCashPeriodAction({}, form())).error).toContain("admin");
    workspace.role = "tenant_admin";
    for (const reason of [" ", "abcd", "x".repeat(501)]) expect((await reopenCashPeriodAction({}, form({ reason }))).fieldErrors?.reason).toBeTruthy();
    expect(rpc).not.toHaveBeenCalled();
    expect((await reopenCashPeriodAction({}, form({ reason: "  Hitung ulang  " }))).ok).toBeTruthy();
    expect(rpc).toHaveBeenCalledWith("reopen_cash_period", { p_period: period, p_reason: "Hitung ulang" });
  });
  it("maps an already open outlet to a stable Bahasa refusal", async () => {
    workspace.role = "tenant_admin";
    rpc.mockResolvedValue({ error: { message: "period_open_exists" } });
    expect((await reopenCashPeriodAction({}, form())).error).toContain("Tutup periode yang sedang terbuka");
  });
});
