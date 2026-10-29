import type * as nodeCrypto from "node:crypto";
import { scryptSync, type ScryptOptions } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

const scryptCalls = vi.hoisted(() => [] as { password: string; salt: Buffer; keylen: number; options: unknown }[]);
vi.mock("node:crypto", async () => {
  const actual = await vi.importActual<typeof nodeCrypto>("node:crypto");
  return {
    ...actual,
    scrypt: (
      password: string,
      salt: Buffer,
      keylen: number,
      options: ScryptOptions,
      callback: (err: Error | null, derivedKey: Buffer) => void,
    ) => {
      scryptCalls.push({ password, salt: Buffer.from(salt), keylen, options });
      return actual.scrypt(password, salt, keylen, options, callback);
    },
  };
});

import { hashPassword, MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH, passwordProblem, verifyDummyPassword, verifyPassword } from "../../src/lib/auth/password";

// The same shape auth_set_password enforces in SQL.
const SQL_SHAPE = /^scrypt\$32768\$8\$1\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/;

describe("password hashing", () => {
  it("produces the stored format and verifies the right password only", async () => {
    const stored = await hashPassword("correct horse battery");
    expect(stored).toMatch(SQL_SHAPE);
    const [, , , , salt, hash] = stored.split("$");
    expect(Buffer.from(salt, "base64url")).toHaveLength(16);
    expect(Buffer.from(hash, "base64url")).toHaveLength(64);
    expect(await verifyPassword("correct horse battery", stored)).toBe(true);
    expect(await verifyPassword("correct horse batterz", stored)).toBe(false);
    expect(await verifyPassword("", stored)).toBe(false);
    expect(await verifyPassword("Correct horse battery", stored)).toBe(false);
  });

  it("salts every hash", async () => {
    const a = await hashPassword("same password 123");
    const b = await hashPassword("same password 123");
    expect(a).not.toBe(b);
    expect(await verifyPassword("same password 123", a)).toBe(true);
    expect(await verifyPassword("same password 123", b)).toBe(true);
  });

  it("handles unicode and the maximum length", async () => {
    const unicode = await hashPassword("pässwörd-密码-🔐-ok");
    expect(await verifyPassword("pässwörd-密码-🔐-ok", unicode)).toBe(true);
    const longest = "x".repeat(MAX_PASSWORD_LENGTH);
    expect(await verifyPassword(longest, await hashPassword(longest))).toBe(true);
  });

  it("performs the same dummy scrypt work for a >256-char password on a known hash as on an unknown one, while a 256-char password still verifies", async () => {
    const atLimit = "x".repeat(MAX_PASSWORD_LENGTH);
    const atLimitHash = await hashPassword(atLimit);
    expect(await verifyPassword(atLimit, atLimitHash)).toBe(true);

    const overlong = `${atLimit}y`;
    scryptCalls.length = 0;
    expect(await verifyPassword(overlong, atLimitHash)).toBe(false);
    expect(scryptCalls).toHaveLength(1);
    const knownWork = scryptCalls[0];

    scryptCalls.length = 0;
    expect(await verifyDummyPassword(overlong)).toBe(false);
    expect(scryptCalls).toHaveLength(1);
    expect(knownWork).toEqual(scryptCalls[0]);
  });
});

describe("verifyPassword on bad stored values", () => {
  const salt = Buffer.alloc(16, 3).toString("base64url");
  const hash = Buffer.alloc(64, 4).toString("base64url");
  const stored: [string, string][] = [
    ["empty", ""],
    ["garbage", "not-a-hash"],
    ["too few fields", `scrypt$32768$8$1$${salt}`],
    ["too many fields", `scrypt$32768$8$1$${salt}$${hash}$x`],
    ["other scheme", `argon2$32768$8$1$${salt}$${hash}`],
    ["N above the bound (2^18)", `scrypt$262144$8$1$${salt}$${hash}`],
    ["N huge", `scrypt$4294967296$8$1$${salt}$${hash}`],
    ["N below the bound (2^13)", `scrypt$8192$8$1$${salt}$${hash}`],
    ["N not a power of two", `scrypt$20000$8$1$${salt}$${hash}`],
    ["N zero", `scrypt$0$8$1$${salt}$${hash}`],
    ["N not a number", `scrypt$abc$8$1$${salt}$${hash}`],
    ["N negative", `scrypt$-32768$8$1$${salt}$${hash}`],
    ["r other than 8", `scrypt$32768$16$1$${salt}$${hash}`],
    ["p other than 1", `scrypt$32768$8$2$${salt}$${hash}`],
    ["empty salt", `scrypt$32768$8$1$$${hash}`],
    ["short salt", `scrypt$32768$8$1$${Buffer.alloc(4).toString("base64url")}$${hash}`],
    ["bad salt alphabet", `scrypt$32768$8$1$!!!!$${hash}`],
    ["empty hash", `scrypt$32768$8$1$${salt}$`],
    ["short hash", `scrypt$32768$8$1$${salt}$${Buffer.alloc(8).toString("base64url")}`],
    ["bad hash alphabet", `scrypt$32768$8$1$${salt}$@@@@`],
  ];

  for (const [name, value] of stored) {
    it(`returns false for ${name}`, async () => {
      await expect(verifyPassword("whatever password", value)).resolves.toBe(false);
    });
  }

  it("returns false for non-string stored values", async () => {
    await expect(verifyPassword("whatever password", undefined as unknown as string)).resolves.toBe(false);
    await expect(verifyPassword("whatever password", null as unknown as string)).resolves.toBe(false);
  });

  it("verifies a lower-cost hash inside the bounds (N = 2^14)", async () => {
    const lowSalt = Buffer.alloc(16, 9);
    const key = scryptSync("lower cost pass", lowSalt, 64, { N: 16384, r: 8, p: 1 });
    const lower = `scrypt$16384$8$1$${lowSalt.toString("base64url")}$${key.toString("base64url")}`;
    expect(await verifyPassword("lower cost pass", lower)).toBe(true);
    expect(await verifyPassword("lower cost pasz", lower)).toBe(false);
  });
});

describe("verifyDummyPassword", () => {
  it("always resolves false, even for odd input", async () => {
    expect(await verifyDummyPassword("anything at all")).toBe(false);
    expect(await verifyDummyPassword("")).toBe(false);
    expect(await verifyDummyPassword("x".repeat(10_000))).toBe(false);
    expect(await verifyDummyPassword(undefined as unknown as string)).toBe(false);
  });
});

describe("passwordProblem", () => {
  it("applies the length boundaries", () => {
    expect(MIN_PASSWORD_LENGTH).toBe(10);
    expect(MAX_PASSWORD_LENGTH).toBe(256);
    expect(passwordProblem("")).toBe("too_short");
    expect(passwordProblem("x".repeat(9))).toBe("too_short");
    expect(passwordProblem("x".repeat(10))).toBeNull();
    expect(passwordProblem("x".repeat(256))).toBeNull();
    expect(passwordProblem("x".repeat(257))).toBe("too_long");
  });
});
