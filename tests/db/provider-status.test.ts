import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { machine, realOperation, signIn, sql } from "./helpers";

// T-045 / ADR-0003: idempotent, order-safe provider status ingestion, scoped to the endpoint's tenant.
async function issued(opts: { env?: "sandbox" | "production"; simulated?: boolean } = {}) {
  const f = await realOperation({ simulated: opts.simulated });
  const orderId = `ORD${randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}`;
  const awb = `JP${randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}`;
  sql(`update public.provider_operations set state = 'succeeded', provider_env = '${opts.env ?? "sandbox"}', provider_order_id = '${orderId}'
       where id = '${f.op}';
       update public.shipments set submission_state = 'issued', awb = '${awb}', issued_at = now() - interval '3 hours' where id = '${f.shipment}';`);
  return { ...f, orderId, awb };
}
const ingest = (p: Record<string, unknown>) => machine().rpc("ingest_provider_status", { p_env: "sandbox", p_source: "webhook", p_awb: null, ...p });
const state = (shipment: string) => JSON.parse(sql(`select json_build_object('kind', provider_status_kind, 'at', provider_status_at, 'delivered', delivered_at, 'returned', returned_at) from public.shipments where id = '${shipment}'`));
const events = (shipment: string) => Number(sql(`select count(*) from public.shipment_events where shipment_id = '${shipment}' and provider_ts is not null`));
const ts = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString();

describe("provider status ingestion (T-045)", () => {
  it("applies a status, maps it to a fixed kind and dedupes a repeated delivery", async () => {
    const f = await issued();
    const args = { p_tenant: f.tenant, p_provider_ts: ts(10), p_order_id: f.orderId, p_awb: f.awb, p_status: "ON DELIVERY" };
    expect((await ingest(args)).data).toBe("applied");
    expect(state(f.shipment).kind).toBe("in_transit");
    expect((await ingest(args)).data).toBe("duplicate");
    expect((await ingest({ ...args, p_source: "pull" })).data).toBe("duplicate");
    expect(events(f.shipment)).toBe(1);
  });

  it("never regresses: an older status is kept as history but does not change the shipment", async () => {
    const f = await issued();
    await ingest({ p_tenant: f.tenant, p_provider_ts: ts(5), p_order_id: f.orderId, p_status: "ON DELIVERY" });
    expect((await ingest({ p_tenant: f.tenant, p_provider_ts: ts(20), p_order_id: f.orderId, p_status: "PICKED UP" })).data).toBe("stale");
    expect(state(f.shipment).kind).toBe("in_transit");
    expect(events(f.shipment)).toBe(2);
  });

  it("a final status sets its timestamp once and later updates cannot move it", async () => {
    const f = await issued();
    const at = ts(30);
    expect((await ingest({ p_tenant: f.tenant, p_provider_ts: at, p_order_id: f.orderId, p_status: "DELIVERED" })).data).toBe("applied");
    expect(new Date(state(f.shipment).delivered).toISOString()).toBe(at);
    expect((await ingest({ p_tenant: f.tenant, p_provider_ts: ts(1), p_order_id: f.orderId, p_status: "ON DELIVERY" })).data).toBe("final");
    expect(state(f.shipment).kind).toBe("delivered");
    const r = await issued();
    await ingest({ p_tenant: r.tenant, p_provider_ts: ts(2), p_order_id: r.orderId, p_status: "RTS" });
    expect(state(r.shipment)).toMatchObject({ kind: "returned", delivered: null });
  });

  it("maps CANCELED and CANCELLED alike, and stores an unrecognized value (e.g. LOST) verbatim as the non-final unknown kind", async () => {
    const a = await issued();
    await ingest({ p_tenant: a.tenant, p_provider_ts: ts(3), p_order_id: a.orderId, p_status: "CANCELED" });
    expect(state(a.shipment).kind).toBe("cancelled");
    const b = await issued();
    await ingest({ p_tenant: b.tenant, p_provider_ts: ts(3), p_order_id: b.orderId, p_status: "lost" });
    expect(state(b.shipment).kind).toBe("unknown");
    expect(sql(`select provider_status from public.shipment_events where shipment_id = '${b.shipment}' and provider_ts is not null`)).toBe("LOST");
    expect((await ingest({ p_tenant: b.tenant, p_provider_ts: ts(1), p_order_id: b.orderId, p_status: "DELIVERED" })).data).toBe("applied");
  });

  it("resolves only inside the given tenant and environment, never a simulated shipment, and checks the AWB", async () => {
    const f = await issued();
    const other = await issued();
    expect((await ingest({ p_tenant: other.tenant, p_provider_ts: ts(1), p_order_id: f.orderId, p_status: "DELIVERED" })).data).toBe("unmatched");
    expect((await ingest({ p_tenant: f.tenant, p_env: "production", p_provider_ts: ts(1), p_order_id: f.orderId, p_status: "DELIVERED" })).data).toBe("unmatched");
    expect((await ingest({ p_tenant: f.tenant, p_provider_ts: ts(1), p_order_id: f.orderId, p_awb: "JPWRONG00001", p_status: "DELIVERED" })).data).toBe("unmatched");
    const sim = await issued({ simulated: true });
    expect((await ingest({ p_tenant: sim.tenant, p_provider_ts: ts(1), p_order_id: sim.orderId, p_status: "DELIVERED" })).data).toBe("unmatched");
    expect(state(f.shipment).kind).toBeNull();
    expect(events(f.shipment) + events(sim.shipment)).toBe(0);
  });

  it("an untrusted pull time is history only: it never moves the state, the watermark or a final (review P1, round 2)", async () => {
    const f = await issued();
    // Trusted ON DELIVERY at provider time T-120 min.
    expect((await ingest({ p_tenant: f.tenant, p_provider_ts: ts(120), p_order_id: f.orderId, p_status: "ON DELIVERY" })).data).toBe("applied");
    const watermark = state(f.shipment).at;
    // Untrusted PENDING PICKUP observed "now" (local time): kept as history, nothing else changes.
    expect((await ingest({ p_tenant: f.tenant, p_source: "pull", p_ts_trusted: false, p_provider_ts: ts(0), p_order_id: f.orderId, p_status: "PENDING PICKUP" })).data).toBe("history_only");
    expect(state(f.shipment)).toMatchObject({ kind: "in_transit", at: watermark });
    // Untrusted DELIVERED never sets a final.
    expect((await ingest({ p_tenant: f.tenant, p_source: "pull", p_ts_trusted: false, p_provider_ts: ts(0), p_order_id: f.orderId, p_status: "DELIVERED" })).data).toBe("history_only");
    expect(state(f.shipment)).toMatchObject({ kind: "in_transit", delivered: null });
    // A later trusted DELIVERED with provider time T-60 min (after the trusted watermark, before local "now") still applies.
    expect((await ingest({ p_tenant: f.tenant, p_provider_ts: ts(60), p_order_id: f.orderId, p_status: "DELIVERED" })).data).toBe("applied");
    expect(state(f.shipment).kind).toBe("delivered");
    expect(events(f.shipment)).toBe(4);
    // A webhook always carries the provider's own time; it may not claim to be untrusted.
    expect((await ingest({ p_tenant: f.tenant, p_ts_trusted: false, p_provider_ts: ts(0), p_order_id: f.orderId, p_status: "DELIVERED" })).error?.message).toBe("invalid_input");
  });

  it("the public tracking timeline keeps the latest 50 events, oldest first, so a long history never hides the page (review P1)", async () => {
    const f = await issued();
    sql(`insert into public.shipment_events (tenant_id, shipment_id, kind, provider_status, provider_ts, source)
      select '${f.tenant}', '${f.shipment}', 'provider_status', case when g = 60 then 'DELIVERED' else 'ON DELIVERY' end,
             now() - make_interval(mins => 120 - g), 'pull' from generate_series(1, 60) g`);
    const token = randomUUID().replace(/-/g, "").repeat(2).slice(0, 43);
    const ownerId = sql(`select id from auth.users where email = 'owner-a@geraiexpress.test'`);
    sql(`insert into public.tracking_links (tenant_id, shipment_id, token_hash, created_by, shared_at)
      values ('${f.tenant}', '${f.shipment}', encode(extensions.digest(convert_to('${token}', 'utf8'), 'sha256'), 'hex'), '${ownerId}', now())`);
    const timeline = JSON.parse(sql(`select public.track_shipment('${token}')->'timeline'`)) as { kind: string; at: string }[];
    expect(timeline).toHaveLength(50);
    expect(timeline.at(-1)!.kind).toBe("delivered");
    expect(Date.parse(timeline[0].at)).toBeLessThan(Date.parse(timeline[49].at));
  });

  it("refuses malformed input and a timestamp from the future", async () => {
    const f = await issued();
    for (const bad of [{ p_order_id: "x" }, { p_status: "" }, { p_status: "A".repeat(61) }, { p_source: "guess" }, { p_provider_ts: new Date(Date.now() + 3600_000).toISOString() }, { p_awb: "bad awb" }]) {
      const { error } = await ingest({ p_tenant: f.tenant, p_provider_ts: ts(1), p_order_id: f.orderId, p_status: "DELIVERED", ...bad });
      expect(error?.message, JSON.stringify(bad)).toBe("invalid_input");
    }
  });

  it("is machine-only; an operator session can read neither the endpoint secret nor ingest", async () => {
    const owner = await signIn("owner-a@geraiexpress.test");
    const f = await issued();
    expect((await owner.rpc("ingest_provider_status", { p_tenant: f.tenant, p_env: "sandbox", p_source: "webhook", p_provider_ts: ts(1), p_order_id: f.orderId, p_awb: null, p_status: "DELIVERED" })).error).not.toBeNull();
    expect((await owner.rpc("machine_webhook_secret", { p_endpoint: "A".repeat(43) })).error).not.toBeNull();
    expect((await owner.rpc("machine_status_pull_candidates", { p_env: "sandbox", p_stale: "2 hours", p_limit: 10 })).error).not.toBeNull();
    expect((await owner.rpc("mark_status_pulled", { p_env: "sandbox", p_shipments: [] })).error).not.toBeNull();
    expect((await owner.rpc("rewrap_webhook_secret", { p_tenant: f.tenant, p_env: "sandbox", p_secret_version: 1, p_expected_key_version: "v1",
      p_ciphertext: "c".repeat(40), p_iv: "i".repeat(16), p_new_key_version: "v2" })).error).not.toBeNull();
  });
});

describe("webhook endpoint and secret (T-045)", () => {
  const TENANT_A = "00000000-0000-4000-b000-00000000000a";

  it("creates one endpoint per tenant and environment, stores a sealed secret write-only, and exposes only a hint", async () => {
    const owner = await signIn("owner-a@geraiexpress.test");
    sql(`delete from private.webhook_endpoints where tenant_id = '${TENANT_A}'`);
    const first = await owner.rpc("webhook_endpoint_status", { p_tenant: TENANT_A, p_env: "sandbox" });
    expect(first.error).toBeNull();
    const row = first.data[0];
    expect(row).toMatchObject({ secret_configured: false, secret_version: 0, hint: null });
    expect(row.endpoint_id).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect((await owner.rpc("webhook_endpoint_status", { p_tenant: TENANT_A, p_env: "sandbox" })).data[0].endpoint_id).toBe(row.endpoint_id);
    expect((await owner.rpc("webhook_endpoint_status", { p_tenant: TENANT_A, p_env: "production" })).data[0].endpoint_id).not.toBe(row.endpoint_id);

    const store = (expected: number) => owner.rpc("store_webhook_secret", { p_tenant: TENANT_A, p_env: "sandbox", p_expected_version: expected,
      p_ciphertext: "c".repeat(40), p_iv: "i".repeat(16), p_key_version: "v1", p_hint: "ab12" });
    expect((await store(0)).data).toBe(1);
    expect((await store(0)).error?.message).toBe("stale_state");
    const after = (await owner.rpc("webhook_endpoint_status", { p_tenant: TENANT_A, p_env: "sandbox" })).data[0];
    expect(after).toMatchObject({ secret_configured: true, secret_version: 1, hint: "ab12" });
    expect(JSON.stringify(after)).not.toContain("c".repeat(40));
    // The machine reads the sealed row by endpoint id; an unknown id answers nothing.
    expect((await machine().rpc("machine_webhook_secret", { p_endpoint: row.endpoint_id })).data[0]).toMatchObject({ tenant_id: TENANT_A, provider_env: "sandbox", secret_version: 1 });
    expect((await machine().rpc("machine_webhook_secret", { p_endpoint: "B".repeat(43) })).data).toEqual([]);
    expect(sql(`select count(*) from public.audit_events where action = 'webhook_secret.store' and target_tenant = '${TENANT_A}'`)).not.toBe("0");
  });

  it("rewrap is fenced by the expected key version and never downgrades (review P1)", async () => {
    const owner = await signIn("owner-a@geraiexpress.test");
    sql(`delete from private.webhook_endpoints where tenant_id = '${TENANT_A}'`);
    await owner.rpc("webhook_endpoint_status", { p_tenant: TENANT_A, p_env: "sandbox" });
    await owner.rpc("store_webhook_secret", { p_tenant: TENANT_A, p_env: "sandbox", p_expected_version: 0,
      p_ciphertext: "c".repeat(40), p_iv: "i".repeat(16), p_key_version: "v1", p_hint: "ab12" });
    const list = await machine().rpc("machine_webhook_rewrap_candidates", { p_env: "sandbox", p_current_version: "v2", p_after: null, p_limit: 100 });
    expect((list.data ?? []).map((r: { tenant_id: string }) => r.tenant_id)).toContain(TENANT_A);
    const write = (expected: string, next: string) => machine().rpc("rewrap_webhook_secret", { p_tenant: TENANT_A, p_env: "sandbox", p_secret_version: 1,
      p_expected_key_version: expected, p_ciphertext: "d".repeat(40), p_iv: "j".repeat(16), p_new_key_version: next });
    expect((await write("v1", "v1")).error?.message).toBe("invalid_input");
    expect((await write("v1", "v2")).data).toBe(true);
    expect((await write("v1", "v2")).data).toBe(false);
    expect(sql(`select key_version || ':' || secret_version from private.webhook_endpoints where tenant_id = '${TENANT_A}' and provider_env = 'sandbox'`)).toBe("v2:1");
    const after = await machine().rpc("machine_webhook_rewrap_candidates", { p_env: "sandbox", p_current_version: "v2", p_after: null, p_limit: 100 });
    expect((after.data ?? []).map((r: { tenant_id: string }) => r.tenant_id)).not.toContain(TENANT_A);
  });

  it("refuses an operator and a member of another gerai", async () => {
    const operator = await signIn("operator-a@geraiexpress.test");
    expect((await operator.rpc("webhook_endpoint_status", { p_tenant: TENANT_A, p_env: "sandbox" })).error).not.toBeNull();
    const ownerB = await signIn("owner-b@geraiexpress.test");
    expect((await ownerB.rpc("webhook_endpoint_status", { p_tenant: TENANT_A, p_env: "sandbox" })).error).not.toBeNull();
    expect((await ownerB.rpc("store_webhook_secret", { p_tenant: TENANT_A, p_env: "sandbox", p_expected_version: 0,
      p_ciphertext: "c".repeat(40), p_iv: "i".repeat(16), p_key_version: "v1", p_hint: "ab12" })).error).not.toBeNull();
  });
});

describe("status pull candidates (T-045)", () => {
  it("lists issued, non-final, stale real shipments of the environment only", async () => {
    const stale = await issued();
    const fresh = await issued();
    sql(`update public.shipments set provider_status_kind = 'in_transit', provider_status_at = now() where id = '${fresh.shipment}'`);
    const done = await issued();
    sql(`update public.shipments set provider_status_kind = 'delivered', provider_status_at = now() - interval '5 hours' where id = '${done.shipment}'`);
    const prod = await issued({ env: "production" });
    // Leave only our own fixtures eligible-first: everything else counts as just pulled.
    sql(`update public.shipments set status_pulled_at = now() where id not in ('${stale.shipment}', '${fresh.shipment}', '${done.shipment}', '${prod.shipment}')`);
    const page: { data: { shipment_id: string }[] | null; error: unknown } = await machine().rpc("machine_status_pull_candidates",
      { p_env: "sandbox", p_stale: "2 hours", p_limit: 200 });
    expect(page.error).toBeNull();
    const ids = (page.data ?? []).map((r) => r.shipment_id);
    expect(ids).toContain(stale.shipment);
    expect(ids).not.toContain(fresh.shipment);
    expect(ids).not.toContain(done.shipment);
    expect(ids).not.toContain(prod.shipment);
    expect((await machine().rpc("machine_status_pull_candidates", { p_env: "sandbox", p_stale: "1 minute", p_limit: 10 })).error?.message).toBe("invalid_input");
    // Once pulled it leaves the list until the stale window passes again (fair rotation, review P1).
    expect((await machine().rpc("mark_status_pulled", { p_env: "sandbox", p_shipments: [stale.shipment] })).error).toBeNull();
    const again = await machine().rpc("machine_status_pull_candidates", { p_env: "sandbox", p_stale: "2 hours", p_limit: 200 });
    expect((again.data ?? []).map((r: { shipment_id: string }) => r.shipment_id)).not.toContain(stale.shipment);
    // A production marking call cannot touch a sandbox shipment.
    sql(`update public.shipments set status_pulled_at = null where id = '${stale.shipment}'`);
    await machine().rpc("mark_status_pulled", { p_env: "production", p_shipments: [stale.shipment] });
    expect(sql(`select status_pulled_at is null from public.shipments where id = '${stale.shipment}'`)).toBe("t");
  });
});
