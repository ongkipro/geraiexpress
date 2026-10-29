import { randomInt } from "node:crypto";
import { hkdf, hmacSha256Hex } from "./crypto";

/** Six decimal digits, zero padded, from a CSPRNG. */
export function generateOtpCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

/** HMAC-SHA256 hex of the code, bound to purpose and (normalized) email; the key is derived from AUTH_SECRET. */
export function hashOtp(authSecret: string, email: string, purpose: "login", code: string): string {
  const key = hkdf(authSecret, "gx:otp:v1");
  return hmacSha256Hex(key, `${purpose}\u0000${email.trim().toLowerCase()}\u0000${code}`);
}
