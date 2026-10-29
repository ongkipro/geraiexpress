import { createHmac, randomBytes } from "node:crypto";
import { hkdf, safeEqual } from "./crypto";

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const STEP_SECONDS = 30;
const DIGITS = 6;
const SEAL_ERROR = "totp secret cannot be opened";
const encoder = new TextEncoder();

function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(text: string): Buffer | null {
  const clean = text.replace(/\s+/g, "").replace(/=+$/, "").toUpperCase();
  if (clean.length === 0) return null;
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const index = BASE32.indexOf(char);
    if (index < 0) return null;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** 160 random bits as unpadded RFC 4648 base32. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

function codeFor(key: Buffer, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac("sha1", key).update(counter).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  const binary = mac.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 10 ** DIGITS).padStart(DIGITS, "0");
}

/** The 6-digit code of one 30-second step (step = floor(unix seconds / 30)). */
export function totpCodeAt(secretBase32: string, step: number): string {
  const key = base32Decode(secretBase32);
  if (!key) throw new Error("invalid totp secret");
  return codeFor(key, step);
}

/** RFC 6238 check over steps -1, 0, +1; every candidate is compared, so timing does not reveal which step matched. */
export function verifyTotp(secretBase32: string, code: string, nowMs: number): { ok: true; step: number } | { ok: false } {
  const key = base32Decode(secretBase32);
  if (!key || typeof code !== "string" || !/^[0-9]{6}$/.test(code)) return { ok: false };
  const current = Math.floor(nowMs / 1000 / STEP_SECONDS);
  let matched: number | null = null;
  for (const step of [current - 1, current, current + 1]) {
    if (step < 0) continue;
    if (safeEqual(codeFor(key, step), code) && matched === null) matched = step;
  }
  return matched === null ? { ok: false } : { ok: true, step: matched };
}

export function otpauthUri(secretBase32: string, account: string, issuer = "GeraiExpress"): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  const query = new URLSearchParams({ secret: secretBase32, issuer, algorithm: "SHA1", digits: String(DIGITS), period: String(STEP_SECONDS) });
  return `otpauth://totp/${label}?${query.toString().replace(/\+/g, "%20")}`;
}

function aesKey(authSecret: string, usage: "encrypt" | "decrypt"): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", new Uint8Array(hkdf(authSecret, "gx:totp:v1")), "AES-GCM", false, [usage]);
}

function additionalData(userId: string): Uint8Array<ArrayBuffer> {
  return encoder.encode(`gx:totp:${userId}`);
}

/** AES-256-GCM seal: `v1.<iv b64url>.<ciphertext+tag b64url>`, bound to the user id. */
export async function sealTotpSecret(authSecret: string, userId: string, secretBase32: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await aesKey(authSecret, "encrypt");
  const sealed = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: additionalData(userId) }, key, encoder.encode(secretBase32));
  return `v1.${Buffer.from(iv).toString("base64url")}.${Buffer.from(sealed).toString("base64url")}`;
}

export async function unsealTotpSecret(authSecret: string, userId: string, sealed: string): Promise<string> {
  try {
    const parts = sealed.split(".");
    if (parts.length !== 3 || parts[0] !== "v1") throw new Error(SEAL_ERROR);
    const iv = new Uint8Array(Buffer.from(parts[1], "base64url"));
    const data = new Uint8Array(Buffer.from(parts[2], "base64url"));
    if (iv.length !== 12) throw new Error(SEAL_ERROR);
    const key = await aesKey(authSecret, "decrypt");
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv, additionalData: additionalData(userId) }, key, data);
    return new TextDecoder("utf-8", { fatal: true }).decode(plain);
  } catch {
    throw new Error(SEAL_ERROR);
  }
}
