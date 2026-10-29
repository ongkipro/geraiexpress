import { createHmac, randomUUID } from "node:crypto";

// Local HS256 access tokens for the database suite (ADR-0002 section 3.1). Test-only: the real
// signer is the T-065 auth module. The signing key is AUTH_JWT_SECRET from infra/dev/.env, the same
// value PostgREST validates with.
export type Claims = {
  sub?: string;
  role: "anon" | "authenticated" | "service_role";
  email?: string;
  is_anonymous?: boolean;
  aal?: "aal1" | "aal2";
  amr?: { method: string; timestamp: number }[];
  session_id?: string;
};

export function mintJwt(claims: Claims, ttlSeconds = 600, now = Math.floor(Date.now() / 1000)): string {
  const secret = process.env.AUTH_JWT_SECRET;
  if (!secret || secret.length < 32) throw new Error("AUTH_JWT_SECRET missing or shorter than 32 bytes: run `pnpm db:up` first");
  const payload = {
    aud: "authenticated",
    iat: now,
    exp: now + ttlSeconds,
    session_id: randomUUID(),
    email: "",
    is_anonymous: false,
    aal: "aal1",
    amr: [],
    ...claims,
  };
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const data = `${encode({ alg: "HS256", typ: "JWT" })}.${encode(payload)}`;
  return `${data}.${createHmac("sha256", secret).update(data).digest("base64url")}`;
}
