import { describe, expect, it } from "vitest";
// @ts-expect-error plain ESM script without declarations
import { unseal, resealSql } from "../../scripts/reseal-totp.mjs";
// @ts-expect-error plain ESM script without declarations
import { seal } from "../../scripts/db-seed-totp.mjs";
import { sealTotpSecret, unsealTotpSecret } from "../../src/lib/auth/totp";

const oldKey = "o".repeat(40);
const newKey = "n".repeat(40);
const userId = "00000000-0000-4000-a000-0000000000f1";
const secret = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";

describe("TOTP rotation", () => {
  it("opens application seals and emits new seals application can open", async () => {
    const original = await sealTotpSecret(oldKey, userId, secret);
    expect(unseal(oldKey, userId, original)).toBe(secret);
    const sql = resealSql([{ id: userId, user_id: userId, secret_sealed: original }], oldKey, newKey);
    const rotated = /SET secret_sealed='([^']+)'/.exec(sql)![1];
    expect(await unsealTotpSecret(newKey, userId, rotated)).toBe(secret);
    await expect(unsealTotpSecret(oldKey, userId, rotated)).rejects.toThrow();
    expect(sql).toContain("BEGIN;");
    expect(sql).toContain("LOCK TABLE auth.mfa_factors IN EXCLUSIVE MODE;");
    expect(sql).toContain("IF NOT FOUND THEN RAISE EXCEPTION");
    expect(sql).toContain("COMMIT;");
    expect(sql).not.toContain(secret);
  });

  it("fails before SQL on wrong key, wrong user, corruption or invalid rotation keys", () => {
    const original = seal(oldKey, userId, secret);
    expect(() => unseal(newKey, userId, original)).toThrow();
    expect(() => unseal(oldKey, "other-user", original)).toThrow();
    expect(() => unseal(oldKey, userId, "v2.bad.bad")).toThrow();
    expect(() => resealSql([], "short", newKey)).toThrow();
    expect(() => resealSql([], oldKey, oldKey)).toThrow();
  });
});
