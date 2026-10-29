// Security review L1: a registration during an in-flight key regeneration is refused by the
// database's begin_partner_seller_onboarding (rotation_unknown) before any provider request, and
// the refusal reaches the user as the existing Bahasa message of that code.
import { describe, expect, it, vi } from "vitest";
import { friendlyError } from "../../src/lib/errors";
import { onboardPartnerSeller, partnerConsentDocuments } from "../../src/lib/mengantar/partner-onboarding";

const TENANT = "00000000-0000-4000-b000-00000000000a";

describe("onboarding during a key regeneration (L1)", () => {
  it("stops at the begin refusal: no provider call, no machine write, a Bahasa message", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { message: "rotation_unknown", code: "55000" } }));
    const machineRpc = vi.fn(async (_fn: string, _args: Record<string, unknown>) => ({ data: null, error: null }));
    const fetchImpl = vi.fn();
    const result = await onboardPartnerSeller(
      { tenantId: TENANT, ownerName: "Budi Santoso", ownerEmail: "budi@gerai-asli.id", ownerPhone: "081234567890", agreed: true },
      {
        rpc, machineRpc, fetchImpl: fetchImpl as unknown as typeof fetch, environment: "sandbox", partnerSecret: "partner-secret-0123456789",
        credentialKey: Buffer.alloc(32, 3).toString("base64"),
        consentDocuments: partnerConsentDocuments({
          termsVersion: "terms-1", privacyVersion: "privacy-1",
          termsUrl: "https://provider.test/terms", privacyUrl: "https://provider.test/privacy",
        }),
      },
    );
    expect(result).toMatchObject({ ok: false, state: "rejected", errorCode: "rotation_unknown" });
    expect(rpc).toHaveBeenCalledTimes(1);
    // Only the server's consent-version sync (T-057); no tenant write.
    expect(machineRpc.mock.calls.map((c) => c[0])).toEqual(["sync_partner_consent_versions"]);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(friendlyError({ message: result.ok ? "" : result.errorCode })).toMatch(/pembuatan ulang kunci belum pasti/i);
  });
});
