import { describe, expect, it } from "vitest";
import { DEFAULT_PARTNER_ID, resolvePartnerId } from "../../src/lib/mengantar/partner-onboarding";

// P1-3: the Partner ID the runtime signs with is the stored one, else PARTNER_ID, else the default.
describe("resolvePartnerId", () => {
  it("prefers the stored Super Admin value, then PARTNER_ID, then the default", () => {
    expect(resolvePartnerId(" gx-stored ", "from-env")).toBe("gx-stored");
    expect(resolvePartnerId(null, undefined)).toBe(DEFAULT_PARTNER_ID);
    expect(resolvePartnerId("   ", "  ")).toBe(DEFAULT_PARTNER_ID);
    expect(resolvePartnerId(null, "from-env")).toBe("from-env");
    expect(resolvePartnerId(undefined, "from-env")).toBe("from-env");
  });
});
