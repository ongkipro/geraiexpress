import { describe, expect, it } from "vitest";
import { verifyTotp } from "../../src/lib/auth/totp";
import { freshTotpStep, totp } from "../totp";

// Public RFC 6238 SHA-1 vector; not an application credential.
const SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
const PERIOD = 30_000;
const BEFORE = 1_800_000_000_000 - 28;
const AFTER = 1_800_000_000_000 + 29;
const CURRENT = Math.floor(BEFORE / PERIOD);

describe("fresh admin TOTP selection", () => {
  it("survives rollover between generation and server verification", () => {
    const selected = freshTotpStep(CURRENT - 2, BEFORE);
    expect(selected).toBe(CURRENT);
    expect(verifyTotp(SECRET, totp(SECRET, (CURRENT - 1) * PERIOD), AFTER)).toEqual({ ok: false });
    expect(verifyTotp(SECRET, totp(SECRET, selected! * PERIOD), AFTER)).toEqual({ ok: true, step: CURRENT });
  });

  it("uses the next unused step on either side of rollover", () => {
    const selected = freshTotpStep(CURRENT, BEFORE);
    expect(selected).toBe(CURRENT + 1);
    for (const at of [BEFORE, AFTER]) {
      expect(verifyTotp(SECRET, totp(SECRET, selected! * PERIOD), at)).toEqual({ ok: true, step: CURRENT + 1 });
    }
  });

  it("waits when current and next are exhausted without resetting replay state", () => {
    const first = freshTotpStep(CURRENT - 1, BEFORE);
    expect(first).toBe(CURRENT);
    const second = freshTotpStep(first!, BEFORE);
    expect(second).toBe(CURRENT + 1);
    expect(freshTotpStep(second!, BEFORE)).toBeUndefined();
    expect(freshTotpStep(CURRENT + 2, BEFORE)).toBeUndefined();
    expect(freshTotpStep(second!, AFTER)).toBe(CURRENT + 2);
  });
});
