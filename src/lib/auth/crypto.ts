import { createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";

/** SHA-256 digest as lowercase hex. */
export function sha256Hex(input: string | Uint8Array): string {
  return createHash("sha256").update(input).digest("hex");
}

/** Random bytes as base64url text (no padding). */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** HMAC-SHA256 digest as lowercase hex. */
export function hmacSha256Hex(key: Uint8Array, data: string): string {
  return createHmac("sha256", key).update(data).digest("hex");
}

/** HKDF-SHA256 with an empty salt; `info` separates the purposes of one secret. */
export function hkdf(secret: string, info: string, length = 32): Buffer {
  return Buffer.from(hkdfSync("sha256", Buffer.from(secret, "utf8"), Buffer.alloc(0), Buffer.from(info, "utf8"), length));
}

/** Constant-time string equality; false when the byte lengths differ. */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/** Returns the secret when it is set and at least 32 UTF-8 bytes; the error names the variable, never the value. */
export function assertSecret(name: string, value: string | undefined): string {
  if (value === undefined || Buffer.byteLength(value, "utf8") < 32) {
    throw new Error(`${name} must be set and at least 32 bytes long`);
  }
  return value;
}
