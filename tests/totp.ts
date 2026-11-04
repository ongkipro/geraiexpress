import { createHmac } from "node:crypto";

// RFC 6238 TOTP (SHA-1, 6 digits, 30 s) for local fixture secrets only.
export const FIXTURE_TOTP = {
  "admin@geraiexpress.test": "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP",
  "admin-2@geraiexpress.test": "KRSXG5DTMVZXIZLSKRSXG5DTMVZXIZLS",
} as const;

// Never select the previous step: it can expire during browser submission at rollover.
export function freshTotpStep(lastUsed: number, at = Date.now()): number | undefined {
  const current = Math.floor(at / 30_000);
  return [current, current + 1].find((step) => step > lastUsed);
}

export function totp(secret: string, at = Date.now()): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const ch of secret.replace(/=+$/, "").toUpperCase()) bits += alphabet.indexOf(ch).toString(2).padStart(5, "0");
  const key = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
  const h = createHmac("sha1", key).update(counter).digest();
  const o = h[h.length - 1] & 0xf;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}
