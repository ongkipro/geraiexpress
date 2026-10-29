// Local fixtures only: seals the two Super Admin fixture TOTP secrets with this stack's AUTH_SECRET and
// prints the SQL that stores them (piped into psql by gx_seed in scripts/db-common.sh). The seal format is the
// application's (src/lib/auth/totp.ts sealTotpSecret: HKDF "gx:totp:v1" key, AES-256-GCM, additional data
// `gx:totp:<user id>`); tests/unit/db-seed-totp.test.ts proves the application can open what this writes.
// The secrets are the ones tests/totp.ts uses to compute codes; they protect nothing outside a local database.
import { createCipheriv, hkdfSync, randomBytes } from "node:crypto";

export const FIXTURES = [
  { userId: "00000000-0000-4000-a000-0000000000f1", secret: "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP" },
  { userId: "00000000-0000-4000-a000-0000000000f2", secret: "KRSXG5DTMVZXIZLSKRSXG5DTMVZXIZLS" },
];

export function seal(authSecret, userId, secret) {
  const key = Buffer.from(hkdfSync("sha256", Buffer.from(authSecret, "utf8"), Buffer.alloc(0), Buffer.from("gx:totp:v1", "utf8"), 32));
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(`gx:totp:${userId}`, "utf8"));
  const body = Buffer.concat([cipher.update(secret, "utf8"), cipher.final(), cipher.getAuthTag()]);
  return `v1.${iv.toString("base64url")}.${body.toString("base64url")}`;
}

export function seedSql(authSecret) {
  if (!authSecret || Buffer.byteLength(authSecret) < 32) throw new Error("AUTH_SECRET missing or shorter than 32 bytes: run `pnpm dev:env` first");
  return FIXTURES.map((f) => `update auth.mfa_factors set secret_sealed = '${seal(authSecret, f.userId, f.secret)}' where user_id = '${f.userId}';`).join("\n") + "\n";
}

if (import.meta.url === `file://${process.argv[1]}`) process.stdout.write(seedSql(process.env.AUTH_SECRET));
