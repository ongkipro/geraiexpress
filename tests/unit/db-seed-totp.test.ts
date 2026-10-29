import { describe, expect, it } from "vitest";
// @ts-expect-error plain ESM script without types
import { FIXTURES, seal, seedSql } from "../../scripts/db-seed-totp.mjs";
import { FIXTURE_TOTP } from "../totp";
import { unsealTotpSecret } from "../../src/lib/auth/totp";

const AUTH_SECRET = "s".repeat(40);

describe("local TOTP fixture seeding", () => {
  it("writes secrets the application can open, bound to each user id", async () => {
    for (const f of FIXTURES as { userId: string; secret: string }[]) {
      expect(await unsealTotpSecret(AUTH_SECRET, f.userId, seal(AUTH_SECRET, f.userId, f.secret))).toBe(f.secret);
      await expect(unsealTotpSecret(AUTH_SECRET, "00000000-0000-4000-a000-000000000000", seal(AUTH_SECRET, f.userId, f.secret))).rejects.toThrow();
    }
  });

  it("uses the secrets the e2e helpers compute codes from", () => {
    const bySecret = Object.values(FIXTURE_TOTP).sort();
    expect((FIXTURES as { secret: string }[]).map((f) => f.secret).sort()).toEqual(bySecret);
  });

  it("refuses a missing or short AUTH_SECRET and never prints a plaintext secret", () => {
    expect(() => seedSql(undefined)).toThrow();
    expect(() => seedSql("short")).toThrow();
    const sql = seedSql(AUTH_SECRET);
    for (const f of FIXTURES as { secret: string }[]) expect(sql).not.toContain(f.secret);
  });
});
