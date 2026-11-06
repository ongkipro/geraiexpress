import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { sealCredential, webhookSecretAad, credentialAad, openCredential } from "../../src/lib/credential-crypto";
import { signWebhook, verifyWebhook, WEBHOOK_MAX_BYTES } from "../../src/lib/mengantar/webhook";
import { handleMengantarWebhook, type WebhookDeps } from "../../src/lib/mengantar/webhook-ingest";

// T-045 / ADR-0003. Fixture secret is synthetic; the HMAC is recomputed independently with node:crypto.
const SECRET = "whsec-synthetic-fixture-value-0001";
const NOW = 1_793_900_000_000;
const KEY = Buffer.alloc(32, 7).toString("base64");
const TENANT = "00000000-0000-4000-b000-00000000000a";
const ENDPOINT = "A".repeat(43);
const body = (o: Record<string, unknown> = {}) =>
  Buffer.from(JSON.stringify({ cnote_no: "JP1234567890", order_id: "ORD12345", courier: "jnt", status_category: "ON DELIVERY", ...o }));
const sign = (raw: Buffer, ts = String(NOW), secret = SECRET) => createHmac("sha256", secret).update(`${ts}.`).update(raw).digest("hex");

describe("verifyWebhook (signature over the raw bytes, then window, environment, body)", () => {
  const base = (raw = body(), over: Partial<Parameters<typeof verifyWebhook>[0]> = {}) => verifyWebhook({
    secret: SECRET, rawBody: raw, timestamp: String(NOW), signature: sign(raw), environmentHeader: "sandbox",
    expectedEnvironment: "sandbox", now: NOW, ...over,
  });

  it("matches an independently computed HMAC-SHA256 over `${ts}.${body}` and parses the delivery", () => {
    const raw = body();
    expect(signWebhook(SECRET, String(NOW), raw)).toBe(sign(raw));
    expect(base(raw)).toEqual({ ok: true, delivery: { orderId: "ORD12345", awb: "JP1234567890", courier: "jnt", status: "ON DELIVERY", providerTs: new Date(NOW) } });
  });

  it("refuses a wrong secret, a tampered body, a re-serialized body and a malformed signature", () => {
    const raw = body();
    expect(base(raw, { secret: "other" })).toEqual({ ok: false, reason: "signature" });
    expect(base(body({ status_category: "DELIVERED" }), { signature: sign(raw) })).toEqual({ ok: false, reason: "signature" });
    const reserialized = Buffer.from(JSON.stringify(JSON.parse(raw.toString())) + " ");
    expect(base(reserialized, { signature: sign(raw) })).toEqual({ ok: false, reason: "signature" });
    for (const signature of [null, "", "zz", sign(raw).slice(0, 63), `${sign(raw)}00`]) {
      expect(base(raw, { signature }), String(signature)).toEqual({ ok: false, reason: "signature" });
    }
  });

  it("enforces the millisecond replay window (5 minutes) after the signature", () => {
    const raw = body();
    const old = String(NOW - 5 * 60_000 - 1);
    expect(base(raw, { timestamp: old, signature: sign(raw, old) })).toEqual({ ok: false, reason: "timestamp" });
    const future = String(NOW + 5 * 60_000 + 1);
    expect(base(raw, { timestamp: future, signature: sign(raw, future) })).toEqual({ ok: false, reason: "timestamp" });
    // Seconds instead of milliseconds is not a valid timestamp shape.
    const seconds = String(Math.floor(NOW / 1000));
    expect(base(raw, { timestamp: seconds, signature: sign(raw, seconds) })).toEqual({ ok: false, reason: "signature" });
  });

  it("never lets a sandbox delivery reach production, nor production reach sandbox", () => {
    expect(base(body(), { expectedEnvironment: "production" })).toEqual({ ok: false, reason: "environment" });
    expect(base(body(), { environmentHeader: null })).toEqual({ ok: false, reason: "environment" });
    expect(base(body(), { environmentHeader: null, expectedEnvironment: "production" }).ok).toBe(true);
  });

  it("refuses a body without a valid order id or status, and drops unreadable optional fields", () => {
    for (const bad of [{ order_id: "x" }, { order_id: null }, { status_category: "" }, { status_category: "A".repeat(61) }, { status_category: "OK\nX" }]) {
      const raw = body(bad);
      expect(base(raw, { signature: sign(raw) }), JSON.stringify(bad)).toEqual({ ok: false, reason: "malformed" });
    }
    const raw = Buffer.from("[1]");
    expect(base(raw, { signature: sign(raw) })).toEqual({ ok: false, reason: "malformed" });
    const odd = body({ cnote_no: "a b", courier: "<x>" });
    const ok = base(odd, { signature: sign(odd) });
    expect(ok.ok && ok.delivery.awb === null && ok.delivery.courier === null).toBe(true);
  });
});

describe("the webhook handler (endpoint -> sealed secret -> ingestion)", () => {
  async function setup(over: { row?: unknown; ingest?: { data?: unknown; error?: { message: string } | null }; env?: "sandbox" | "production" } = {}) {
    const env = over.env ?? "sandbox";
    const sealed = await sealCredential(SECRET, webhookSecretAad(TENANT, env, 1), KEY);
    const row = over.row === undefined ? { tenant_id: TENANT, provider_env: env, ciphertext: sealed.ciphertext, iv: sealed.iv, key_version: sealed.keyVersion, secret_version: 1 } : over.row;
    const calls: { fn: string; args: Record<string, unknown> }[] = [];
    const logs: Record<string, unknown>[] = [];
    const deps: WebhookDeps = {
      credentialKey: KEY, now: () => NOW, log: (e) => logs.push(e),
      rpc: async (fn, args) => {
        calls.push({ fn, args });
        if (fn === "machine_webhook_secret") return { data: row ? [row] : [], error: null };
        if (fn === "ingest_provider_status") return { data: over.ingest?.data ?? "applied", error: over.ingest?.error ?? null };
        return { data: null, error: null };
      },
    };
    return { deps, calls, logs };
  }
  const req = (raw: Buffer, headers: Record<string, string> = {}, method = "POST") => new Request("https://hooks.geraiexpress.com/api/webhooks/mengantar/x", {
    method, body: method === "POST" ? new Uint8Array(raw) : undefined,
    headers: { "content-type": "application/json", "x-timestamp": String(NOW), "x-signature": sign(raw), "x-environment": "sandbox", ...headers },
  });

  it("ingests an authenticated delivery and answers 204 with no body", async () => {
    const { deps, calls, logs } = await setup();
    const res = await handleMengantarWebhook(req(body()), ENDPOINT, deps);
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
    const ingest = calls.find((c) => c.fn === "ingest_provider_status")!;
    expect(ingest.args).toEqual({ p_tenant: TENANT, p_env: "sandbox", p_source: "webhook", p_provider_ts: new Date(NOW).toISOString(), p_order_id: "ORD12345", p_awb: "JP1234567890", p_status: "ON DELIVERY" });
    // Logs carry the tenant and a result only: never the order id, AWB, body or secret.
    expect(JSON.stringify(logs)).not.toMatch(/ORD12345|JP1234567890|whsec|ON DELIVERY/);
  });

  it("answers 204 for an authenticated delivery of an order we do not know (no oracle)", async () => {
    const { deps } = await setup({ ingest: { data: "unmatched" } });
    expect((await handleMengantarWebhook(req(body()), ENDPOINT, deps)).status).toBe(204);
  });

  it("a forged signature is 401, records the mismatch and never ingests", async () => {
    const { deps, calls, logs } = await setup();
    const res = await handleMengantarWebhook(req(body(), { "x-signature": sign(body(), String(NOW), "wrong") }), ENDPOINT, deps);
    expect(res.status).toBe(401);
    expect(calls.map((c) => c.fn)).toEqual(["machine_webhook_secret", "machine_webhook_mismatch"]);
    expect(logs).toEqual([{ event: "webhook_secret_mismatch", tenantId: TENANT }]);
  });

  it("refuses before reading the secret: wrong method, content type, endpoint shape, oversize body", async () => {
    const { deps, calls } = await setup();
    expect((await handleMengantarWebhook(req(body(), {}, "GET"), ENDPOINT, deps)).status).toBe(405);
    expect((await handleMengantarWebhook(req(body(), { "content-type": "text/plain" }), ENDPOINT, deps)).status).toBe(415);
    expect((await handleMengantarWebhook(req(body()), "short", deps)).status).toBe(404);
    const big = Buffer.alloc(WEBHOOK_MAX_BYTES + 1, 32);
    expect((await handleMengantarWebhook(req(big), ENDPOINT, deps)).status).toBe(413);
    expect(calls).toEqual([]);
  });

  it("an unknown endpoint or one without a stored secret is 404; a replayed or cross-environment delivery is 400", async () => {
    const none = await setup({ row: null });
    expect((await handleMengantarWebhook(req(body()), ENDPOINT, none.deps)).status).toBe(404);
    const { deps, calls } = await setup();
    const old = String(NOW - 10 * 60_000);
    expect((await handleMengantarWebhook(req(body(), { "x-timestamp": old, "x-signature": sign(body(), old) }), ENDPOINT, deps)).status).toBe(400);
    const prod = await setup({ env: "production" });
    expect((await handleMengantarWebhook(req(body()), ENDPOINT, prod.deps)).status).toBe(400);
    expect(calls.some((c) => c.fn === "ingest_provider_status")).toBe(false);
  });

  it("a secret sealed for another tenant, environment or version (or a seller key) cannot be opened", async () => {
    const asSellerKey = await sealCredential(SECRET, credentialAad(TENANT, 1), KEY);
    await expect(openCredential(asSellerKey, webhookSecretAad(TENANT, "sandbox", 1), KEY)).rejects.toThrow();
    const { deps } = await setup({ row: { tenant_id: TENANT, provider_env: "sandbox", ciphertext: asSellerKey.ciphertext, iv: asSellerKey.iv, key_version: asSellerKey.keyVersion, secret_version: 1 } });
    expect((await handleMengantarWebhook(req(body()), ENDPOINT, deps)).status).toBe(503);
  });

  it("an ingestion failure is 503 (the provider retries; the pull covers it)", async () => {
    const { deps } = await setup({ ingest: { error: { message: "boom" } } });
    expect((await handleMengantarWebhook(req(body()), ENDPOINT, deps)).status).toBe(503);
    expect((await handleMengantarWebhook(req(body()), ENDPOINT, null)).status).toBe(503);
  });
});

vi.mock("server-only", () => ({}));
