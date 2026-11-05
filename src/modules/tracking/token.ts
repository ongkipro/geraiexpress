import "server-only";
import { createHash, createHmac } from "node:crypto";

// linkId is an opaque, persisted sharing generation, not an AWB or a shipment reference.
// Changing it after revocation prevents a re-share from reviving the old URL.
export function trackingToken(linkId: string, secret: string): string {
  if (Buffer.byteLength(secret) < 32) throw new Error("TRACKING_TOKEN_SECRET must contain at least 32 bytes");
  return createHmac("sha256", secret).update(linkId).digest("base64url");
}

export function trackingTokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
