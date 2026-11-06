// T-045 / ADR-0003: Mengantar status webhook verification, pure and side-effect free.
// Contract (operations-contract note §4.2-4.3, Observed): POST, JSON body {cnote_no, order_id, courier,
// status_category}; header x-timestamp = milliseconds since epoch; x-signature = hex HMAC-SHA256 of
// `${x-timestamp}.${raw body}` keyed by the seller's Webhook Secret; x-environment: sandbox on sandbox only.
import { createHmac, timingSafeEqual } from "node:crypto";

export const WEBHOOK_MAX_BYTES = 4096;
export const WEBHOOK_REPLAY_WINDOW_MS = 5 * 60_000;

export type WebhookDelivery = { orderId: string; awb: string | null; courier: string | null; status: string; providerTs: Date };
export type WebhookCheck =
  | { ok: true; delivery: WebhookDelivery }
  | { ok: false; reason: "signature" | "timestamp" | "environment" | "malformed" };

const ORDER_ID = /^[A-Z0-9]{6,20}$/;
const AWB = /^[A-Za-z0-9-]{6,40}$/;
const COURIER = /^[a-z0-9_-]{2,20}$/i;

export function signWebhook(secret: string, timestamp: string, rawBody: Buffer): string {
  return createHmac("sha256", secret).update(`${timestamp}.`).update(rawBody).digest("hex");
}

// Verifies one delivery. The signature is checked over the RAW bytes before anything is parsed; the
// comparison is constant-time on equal-length buffers (a length mismatch fails without comparing).
export function verifyWebhook(input: {
  secret: string; rawBody: Buffer; timestamp: string | null; signature: string | null;
  environmentHeader: string | null; expectedEnvironment: "sandbox" | "production"; now: number;
}): WebhookCheck {
  const { secret, rawBody, timestamp, signature } = input;
  if (!timestamp || !/^\d{12,14}$/.test(timestamp) || !signature || !/^[0-9a-f]{64}$/i.test(signature)) {
    return { ok: false, reason: "signature" };
  }
  const expected = Buffer.from(signWebhook(secret, timestamp, rawBody), "hex");
  const given = Buffer.from(signature.toLowerCase(), "hex");
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return { ok: false, reason: "signature" };

  const ts = Number(timestamp);
  if (!Number.isSafeInteger(ts) || Math.abs(input.now - ts) > WEBHOOK_REPLAY_WINDOW_MS) return { ok: false, reason: "timestamp" };

  // A sandbox delivery never moves a production shipment, and production never carries the header.
  const sandbox = input.environmentHeader?.trim().toLowerCase() === "sandbox";
  if (sandbox !== (input.expectedEnvironment === "sandbox")) return { ok: false, reason: "environment" };

  let body: unknown;
  try { body = JSON.parse(rawBody.toString("utf8")); } catch { return { ok: false, reason: "malformed" }; }
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, reason: "malformed" };
  const b = body as Record<string, unknown>;
  const orderId = typeof b.order_id === "string" ? b.order_id.trim() : "";
  const status = typeof b.status_category === "string" ? b.status_category.trim() : "";
  if (!ORDER_ID.test(orderId) || !status || status.length > 60 || /[\u0000-\u001f]/.test(status)) return { ok: false, reason: "malformed" };
  const awb = typeof b.cnote_no === "string" && AWB.test(b.cnote_no.trim()) ? b.cnote_no.trim() : null;
  const courier = typeof b.courier === "string" && COURIER.test(b.courier.trim()) ? b.courier.trim().toLowerCase() : null;
  return { ok: true, delivery: { orderId, awb, courier, status: status.toUpperCase(), providerTs: new Date(ts) } };
}

export const ENDPOINT_ID = /^[A-Za-z0-9_-]{43}$/;
