import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

export const MIN_PASSWORD_LENGTH = 10;
export const MAX_PASSWORD_LENGTH = 256;

const COST_N = 32768;
const BLOCK_R = 8;
const PARALLEL_P = 1;
const SALT_BYTES = 16;
const KEY_BYTES = 64;
const MIN_N = 2 ** 14;
const MAX_N = 2 ** 17;
// Dummy salt for equalizing the cost of unknown users; its value carries no meaning.
const DUMMY_SALT = Buffer.alloc(SALT_BYTES, 1);

function derive(password: string, salt: Buffer, n: number, r: number, p: number, keyLength: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // scrypt needs about 128 * N * r bytes; leave headroom above the default 32 MiB limit.
    scrypt(password.normalize("NFKC"), salt, keyLength, { N: n, r, p, maxmem: 256 * n * r }, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

/** `scrypt$N$r$p$<salt b64url>$<hash b64url>` (the shape enforced by auth_set_password). */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await derive(password, salt, COST_N, BLOCK_R, PARALLEL_P, KEY_BYTES);
  return `scrypt$${COST_N}$${BLOCK_R}$${PARALLEL_P}$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

function parseStored(stored: string) {
  if (typeof stored !== "string") return null;
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return null;
  const [, nText, rText, pText, saltText, hashText] = parts;
  if (![nText, rText, pText].every((part) => /^[0-9]{1,7}$/.test(part))) return null;
  const n = Number(nText);
  const r = Number(rText);
  const p = Number(pText);
  if (n < MIN_N || n > MAX_N || (n & (n - 1)) !== 0 || r !== BLOCK_R || p !== PARALLEL_P) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(saltText) || !/^[A-Za-z0-9_-]+$/.test(hashText)) return null;
  const salt = Buffer.from(saltText, "base64url");
  const hash = Buffer.from(hashText, "base64url");
  if (salt.length < SALT_BYTES || salt.length > 64 || hash.length < 32 || hash.length > 128) return null;
  return { n, r, p, salt, hash };
}

/** Constant-time check; false (never a throw) for a wrong password or any malformed or out-of-bounds stored value. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parsed = parseStored(stored);
  // A stored hash can never belong to a password beyond the limit, so such a password is refused; but it is
  // refused AFTER the same scrypt work an unknown account costs (verifyDummyPassword), or the early return
  // would tell a known account from an unknown one by time (ADR-0002 obligation 4). Truncating instead would
  // let a longer string authenticate by its prefix.
  if (typeof password === "string" && password.length > MAX_PASSWORD_LENGTH) {
    await verifyDummyPassword(password);
    return false;
  }
  if (!parsed || typeof password !== "string") return false;
  try {
    const key = await derive(password, parsed.salt, parsed.n, parsed.r, parsed.p, parsed.hash.length);
    return timingSafeEqual(key, parsed.hash);
  } catch {
    return false;
  }
}

/** Runs one real scrypt at the production cost so an unknown account costs the same as a known one. */
export async function verifyDummyPassword(password: string): Promise<false> {
  try {
    await derive(typeof password === "string" ? password.slice(0, MAX_PASSWORD_LENGTH) : "", DUMMY_SALT, COST_N, BLOCK_R, PARALLEL_P, KEY_BYTES);
  } catch {
    // The result is always false; the work above is the point.
  }
  return false;
}

export function passwordProblem(password: string): "too_short" | "too_long" | null {
  if (password.length < MIN_PASSWORD_LENGTH) return "too_short";
  if (password.length > MAX_PASSWORD_LENGTH) return "too_long";
  return null;
}
