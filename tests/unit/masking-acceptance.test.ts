// T-084 / PR-46: acceptance-state wording, the batch's de-duplicated courier list, the history label, and
// the invoice view forwarding the acknowledgement to record_label_print (no default on the new signature).
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  acceptanceHistoryLabel, acceptanceNotice, acceptanceShortLabel, isAcceptanceState, pendingAcceptance,
} from "../../src/modules/labels/masking-acceptance-state";

const rpc = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/workspace", () => ({ requireWorkspace: async () => ({ tenant: { id: "t" } }) }));
vi.mock("@/lib/db/server", () => ({ dbServer: async () => ({ rpc }) }));
vi.mock("@/lib/errors", () => ({ friendlyError: () => "Terjadi kesalahan. Coba lagi." }));

describe("masking acceptance state helpers", () => {
  it("uses the UX-9 'Belum terverifikasi untuk <kurir>' wording, also for a missing courier", () => {
    expect(acceptanceShortLabel({ courier: "JT", state: "unverified" })).toBe("Belum terverifikasi untuk J&T Express");
    expect(acceptanceShortLabel({ courier: "Sap", state: "refused" })).toBe("Ditolak kurir untuk SAP Express");
    expect(acceptanceNotice({ courier: null, state: "unverified" })).toMatch(/^Belum terverifikasi untuk kurir yang belum diketahui:/);
  });

  it("lists each not-verified courier once for the batch acknowledgement", () => {
    expect(pendingAcceptance([
      { courier: "JT", state: "unverified" }, { courier: "JNE", state: "verified" },
      { courier: "JT", state: "unverified" }, { courier: null, state: "unverified" }, { courier: "Sap", state: "refused" },
    ])).toEqual([{ courier: "JT", state: "unverified" }, { courier: null, state: "unverified" }, { courier: "Sap", state: "refused" }]);
  });

  it("labels history fields and validates states", () => {
    expect(acceptanceHistoryLabel(null, null)).toBeNull();
    expect(acceptanceHistoryLabel("verified", false)).toBe("Kurir terverifikasi");
    expect(acceptanceHistoryLabel("unverified", true)).toBe("Belum terverifikasi, dikonfirmasi operator");
    expect(acceptanceHistoryLabel("refused", true)).toBe("Ditolak kurir, dikonfirmasi operator");
    expect(["unverified", "verified", "refused"].every(isAcceptanceState)).toBe(true);
    expect(isAcceptanceState("accepted")).toBe(false);
  });
});

describe("recordLabelPrintAction (Resi + invoice view)", () => {
  beforeEach(() => { vi.resetAllMocks(); rpc.mockResolvedValue({ data: 1, error: null }); });
  const snapshot = "00000000-0000-4000-b000-000000000004";

  it("forwards the acknowledgement and maps the refusal in Bahasa", async () => {
    const { recordLabelPrintAction } = await import("../../src/modules/invoices/actions");
    expect(await recordLabelPrintAction(snapshot, true)).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("record_label_print", { p_snapshot: snapshot, p_acknowledged: true });
    rpc.mockResolvedValueOnce({ data: null, error: { message: "masking_acknowledgement_required", code: "55000" } });
    const refused = await recordLabelPrintAction(snapshot, false);
    expect(refused).toEqual({ ok: false, error: expect.stringMatching(/belum terverifikasi/) });
  });

  it("refuses a non-boolean acknowledgement before any RPC", async () => {
    const { recordLabelPrintAction } = await import("../../src/modules/invoices/actions");
    expect((await recordLabelPrintAction(snapshot, "yes" as unknown as boolean)).ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
});
