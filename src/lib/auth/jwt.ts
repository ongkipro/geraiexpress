// HS256 access tokens through Web Crypto only: this file runs in the Edge middleware, so no `node:` imports.
// All `now` options are in epoch SECONDS (the unit of iat/exp).

export type AccessClaims = {
  sub?: string;
  role: "authenticated" | "anon" | "service_role";
  aud: "authenticated";
  iat: number;
  exp: number;
  session_id?: string;
  email?: string;
  is_anonymous?: boolean;
  aal?: "aal1" | "aal2";
  amr?: { method: string; timestamp: number }[];
};

export const ACCESS_TTL_SECONDS = 600;
export const CLOCK_SKEW_SECONDS = 30;

const MIN_SECRET_BYTES = 32;
const ROLES: readonly string[] = ["authenticated", "anon", "service_role"];
const encoder = new TextEncoder();

export type VerifyFailure = "malformed" | "alg" | "signature" | "aud" | "role" | "expired" | "not_yet_valid";
export type VerifyResult = { ok: true; claims: AccessClaims } | { ok: false; reason: VerifyFailure };

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]+$/.test(text) || text.length % 4 === 1) return null;
  try {
    const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

function parseJsonObject(bytes: Uint8Array): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function secretBytes(secret: string): Uint8Array<ArrayBuffer> {
  const bytes = encoder.encode(secret);
  if (bytes.length < MIN_SECRET_BYTES) throw new Error("JWT secret must be at least 32 bytes");
  return bytes;
}

function hmacKey(secret: Uint8Array<ArrayBuffer>, usage: "sign" | "verify"): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", secret, { name: "HMAC", hash: "SHA-256" }, false, [usage]);
}

function nowSeconds(now?: number): number {
  return now ?? Math.floor(Date.now() / 1000);
}

export async function signJwt(
  secret: string,
  claims: Omit<AccessClaims, "aud" | "iat" | "exp">,
  opts: { now?: number; ttlSeconds?: number } = {},
): Promise<string> {
  const key = await hmacKey(secretBytes(secret), "sign");
  const iat = nowSeconds(opts.now);
  const payload: AccessClaims = { ...claims, aud: "authenticated", iat, exp: iat + (opts.ttlSeconds ?? ACCESS_TTL_SECONDS) };
  const header = toBase64Url(encoder.encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const body = toBase64Url(encoder.encode(JSON.stringify(payload)));
  const signingInput = `${header}.${body}`;
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(signingInput));
  return `${signingInput}.${toBase64Url(new Uint8Array(signature))}`;
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

function shapeIsValid(claims: Record<string, unknown>): boolean {
  if (!isOptionalString(claims.sub) || !isOptionalString(claims.session_id) || !isOptionalString(claims.email)) return false;
  if (claims.is_anonymous !== undefined && typeof claims.is_anonymous !== "boolean") return false;
  if (claims.aal !== undefined && claims.aal !== "aal1" && claims.aal !== "aal2") return false;
  if (claims.amr !== undefined && !Array.isArray(claims.amr)) return false;
  return true;
}

export async function verifyJwt(
  secret: string,
  token: string,
  opts: { now?: number; allowExpired?: boolean } = {},
): Promise<VerifyResult> {
  const parts = typeof token === "string" ? token.split(".") : [];
  if (parts.length !== 3) return { ok: false, reason: "malformed" };
  const [headerText, payloadText, signatureText] = parts;

  const headerBytes = fromBase64Url(headerText);
  const header = headerBytes ? parseJsonObject(headerBytes) : null;
  if (!header) return { ok: false, reason: "malformed" };
  // The algorithm is pinned before any signature work: `none`, HS384, a missing alg or another typ never reach verify.
  if (header.alg !== "HS256" || header.typ !== "JWT") return { ok: false, reason: "alg" };

  const payloadBytes = fromBase64Url(payloadText);
  const payload = payloadBytes ? parseJsonObject(payloadBytes) : null;
  const signature = fromBase64Url(signatureText);
  if (!payload || !signature) return { ok: false, reason: "malformed" };

  const key = await hmacKey(secretBytes(secret), "verify");
  const valid = await crypto.subtle.verify("HMAC", key, signature, encoder.encode(`${headerText}.${payloadText}`));
  if (!valid) return { ok: false, reason: "signature" };

  if (payload.aud !== "authenticated") return { ok: false, reason: "aud" };
  if (typeof payload.role !== "string" || !ROLES.includes(payload.role)) return { ok: false, reason: "role" };
  const { iat, exp } = payload;
  if (typeof iat !== "number" || !Number.isFinite(iat) || typeof exp !== "number" || !Number.isFinite(exp)) {
    return { ok: false, reason: "malformed" };
  }
  if (!shapeIsValid(payload)) return { ok: false, reason: "malformed" };

  const now = nowSeconds(opts.now);
  if (iat > now + CLOCK_SKEW_SECONDS) return { ok: false, reason: "not_yet_valid" };
  if (!opts.allowExpired && now > exp + CLOCK_SKEW_SECONDS) return { ok: false, reason: "expired" };
  return { ok: true, claims: payload as unknown as AccessClaims };
}

/** Long-lived token for the `anon` or `service_role` database role (no user, no session). */
export function mintStaticJwt(secret: string, role: "anon" | "service_role", ttlSeconds = 315360000, now?: number): Promise<string> {
  return signJwt(secret, { role }, { ttlSeconds, now });
}
