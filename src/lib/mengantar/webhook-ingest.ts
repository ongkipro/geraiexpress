// T-045 / ADR-0003: the webhook request handler, injectable for tests. Order of checks:
// method/content type -> endpoint id shape -> bounded body (4 KiB) -> stored secret for the endpoint ->
// HMAC over the raw bytes (constant-time) -> replay window -> environment -> body -> SQL ingestion.
// Responses carry no detail. Only the tenant id and a stable reason are ever logged; never the body,
// headers, secret, order id or AWB.
import { openCredential, webhookSecretAad } from "../credential-crypto";
import { ENDPOINT_ID, verifyWebhook, WEBHOOK_MAX_BYTES } from "./webhook";

type RpcResult = PromiseLike<{ data: unknown; error: { message: string } | null }>;
export type WebhookDeps = {
  rpc: (fn: string, args: Record<string, unknown>) => RpcResult;
  credentialKey: string;
  now: () => number;
  log: (event: Record<string, unknown>) => void;
};

type SecretRow = { tenant_id: string; provider_env: "sandbox" | "production"; ciphertext: string; iv: string; key_version: string; secret_version: number };

const empty = (status: number) => new Response(null, { status, headers: { "Cache-Control": "no-store" } });

// Reads at most `limit` bytes; null when the body is larger (the rest is not read).
async function boundedBody(request: Request, limit: number): Promise<Buffer | null> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) return null;
  if (!request.body) return Buffer.alloc(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) { await reader.cancel(); return null; }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

export async function handleMengantarWebhook(request: Request, endpointId: string, deps: WebhookDeps | null): Promise<Response> {
  if (request.method !== "POST") return empty(405);
  if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) return empty(415);
  if (!ENDPOINT_ID.test(endpointId)) return empty(404);
  if (!deps) return empty(503);
  const raw = await boundedBody(request, WEBHOOK_MAX_BYTES);
  if (!raw) return empty(413);

  const found = await deps.rpc("machine_webhook_secret", { p_endpoint: endpointId });
  if (found.error) return empty(503);
  const row = (Array.isArray(found.data) ? found.data[0] : found.data) as SecretRow | undefined;
  // Unknown endpoint or no secret stored yet: indistinguishable from each other.
  if (!row) return empty(404);

  let secret: string;
  try {
    secret = await openCredential(row, webhookSecretAad(row.tenant_id, row.provider_env, row.secret_version), deps.credentialKey);
  } catch {
    deps.log({ event: "webhook_secret_unreadable", tenantId: row.tenant_id });
    return empty(503);
  }

  const check = verifyWebhook({
    secret, rawBody: raw, timestamp: request.headers.get("x-timestamp"), signature: request.headers.get("x-signature"),
    environmentHeader: request.headers.get("x-environment"), expectedEnvironment: row.provider_env, now: deps.now(),
  });
  if (!check.ok) {
    if (check.reason === "signature") {
      // Expected after a seller-side API key regeneration (it replaces the Webhook Secret): visible to the admin,
      // and the status pull keeps the shipments current meanwhile.
      await deps.rpc("machine_webhook_mismatch", { p_endpoint: endpointId });
      deps.log({ event: "webhook_secret_mismatch", tenantId: row.tenant_id });
      return empty(401);
    }
    deps.log({ event: "webhook_refused", tenantId: row.tenant_id, reason: check.reason });
    return empty(400);
  }

  const { delivery } = check;
  const applied = await deps.rpc("ingest_provider_status", {
    p_tenant: row.tenant_id, p_env: row.provider_env, p_source: "webhook", p_provider_ts: delivery.providerTs.toISOString(),
    p_order_id: delivery.orderId, p_awb: delivery.awb, p_status: delivery.status,
  });
  if (applied.error) {
    deps.log({ event: "webhook_ingest_failed", tenantId: row.tenant_id });
    // 5xx: the provider retries (1 s, 5 s, 15 s); the pull covers it if all attempts fail.
    return empty(503);
  }
  deps.log({ event: "webhook_ingested", tenantId: row.tenant_id, result: String(applied.data) });
  // An authenticated delivery is acknowledged whatever the result (unmatched included): no oracle, no retry storm.
  return empty(204);
}
