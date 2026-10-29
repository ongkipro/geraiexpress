import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createPartnerClient, PartnerError, partnerSignature } from "../../src/lib/mengantar/partner-api";

const SECRET: string = "offline-fixture-only-secret";
const NOW = 1758790800_000;

type Reply = { status: number; body?: unknown; type?: string; headers?: Record<string, string> };

function fakeFetch(reply: Reply) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init! });
    const text = typeof reply.body === "string" ? reply.body : JSON.stringify(reply.body ?? {});
    return new Response(text, { status: reply.status, headers: { "content-type": reply.type ?? "application/json", ...reply.headers } });
  }) as typeof fetch;
  return { impl, calls };
}

const client = (reply: Reply) => {
  const f = fakeFetch(reply);
  return { api: createPartnerClient("sandbox", "partner-x", SECRET, f.impl, () => NOW), calls: f.calls };
};

async function failure(promise: Promise<unknown>) {
  const error = await promise.then(() => null, (e) => e);
  expect(error).toBeInstanceOf(PartnerError);
  for (const exposed of [error.message, error.stack, JSON.stringify(error)]) expect(String(exposed)).not.toContain(SECRET);
  return error as PartnerError;
}

const seller = { name: "Gerai Uji", email: "owner@example.com", phone: "081234567890", externalUserId: "geraiexpress:tenant:1" };

describe("Partner request signing (Partner research §3)", () => {
  it("matches the published offline vector and binds every signed part", async () => {
    const body = JSON.stringify({ sellerId: "fixture-seller" });
    const path = "/api/partner/v1/sellers/api-key";
    expect(await partnerSignature(path, body, "1758790800", "offline-fixture-only"))
      .toBe("6ad3b743496bb5ed0c03b7696d8b4f8504ec04ef29b48f33637195c7ba794a5a");
    const base = await partnerSignature(path, body, "1758790800", "offline-fixture-only");
    expect(await partnerSignature(`${path}/regenerate`, body, "1758790800", "offline-fixture-only")).not.toBe(base);
    expect(await partnerSignature(path, '{ "sellerId": "fixture-seller" }', "1758790800", "offline-fixture-only")).not.toBe(base);
    expect(await partnerSignature(path, body, "1758790800000", "offline-fixture-only")).not.toBe(base);
  });

  it("sends the exact signed body with the three headers and never the secret", async () => {
    const { api, calls } = client({ status: 201, body: { success: true, alreadyRegistered: false, data: { sellerId: "66ab1234567890abcdef1234", email: seller.email, apiKey: "API-3F9K2QX7ZB1MTDLE" } } });
    await api.registerSeller(seller);
    const { url, init } = calls[0];
    expect(url).toBe("https://sandbox.mengantar.com/api/partner/v1/sellers");
    expect(init.method).toBe("POST");
    expect(init.redirect).toBe("manual");
    const headers = init.headers as Record<string, string>;
    expect(headers["partner-id"]).toBe("partner-x");
    expect(headers.timestamp).toBe("1758790800");
    expect(headers.signature).toBe(await partnerSignature("/api/partner/v1/sellers", String(init.body), "1758790800", SECRET));
    expect(JSON.parse(String(init.body))).toEqual(seller);
    expect(JSON.stringify(init)).not.toContain(SECRET);
  });
});

describe("register seller", () => {
  const ok = (status: number, alreadyRegistered: boolean, apiKey: string | null) =>
    ({ status, body: { success: true, alreadyRegistered, data: { sellerId: "66ab1234567890abcdef1234", email: seller.email, apiKey } } });

  it("returns a new seller, a repeat, and a disabled key distinctly", async () => {
    expect(await client(ok(201, false, "API-3F9K2QX7ZB1MTDLE")).api.registerSeller(seller))
      .toEqual({ alreadyRegistered: false, sellerId: "66ab1234567890abcdef1234", apiKey: "API-3F9K2QX7ZB1MTDLE" });
    expect(await client(ok(200, true, "API-3F9K2QX7ZB1MTDLE")).api.registerSeller(seller)).toMatchObject({ alreadyRegistered: true });
    expect(await client(ok(200, true, null)).api.registerSeller(seller)).toMatchObject({ alreadyRegistered: true, apiKey: null });
  });

  it("refuses inconsistent success answers instead of trusting them", async () => {
    expect((await failure(client(ok(200, false, "API-3F9K2QX7ZB1MTDLE")).api.registerSeller(seller))).code).toBe("malformed");
    expect((await failure(client(ok(201, false, "../evil key")).api.registerSeller(seller))).code).toBe("malformed");
    expect((await failure(client({ status: 201, body: { success: true, data: {} } }).api.registerSeller(seller))).code).toBe("malformed");
    // A brand-new seller always has a key; null is only valid on a repeat with a disabled key.
    const nullNew = await failure(client(ok(201, false, null)).api.registerSeller(seller));
    expect([nullNew.code, nullNew.sellerId]).toEqual(["malformed", "66ab1234567890abcdef1234"]);
    // alreadyRegistered must be stated, not inferred from its absence.
    expect((await failure(client({ status: 201, body: { success: true, data: { sellerId: "66ab1234567890abcdef1234", apiKey: "API-3F9K2QX7ZB1MTDLE" } } }).api.registerSeller(seller))).code).toBe("malformed");
  });

  it("maps provider errors with their recovery facts", async () => {
    const provisioning = await failure(client({ status: 503, body: { success: false, code: "KEY_PROVISIONING_FAILED", message: "x", data: { sellerId: "66ab1234567890abcdef1234" } } }).api.registerSeller(seller));
    expect([provisioning.code, provisioning.status, provisioning.sellerId]).toEqual(["KEY_PROVISIONING_FAILED", 503, "66ab1234567890abcdef1234"]);
    expect((await failure(client({ status: 409, body: { success: false, code: "EMAIL_ALREADY_REGISTERED", message: "x" } }).api.registerSeller(seller))).code).toBe("EMAIL_ALREADY_REGISTERED");
    const limited = await failure(client({ status: 429, body: { success: false, code: "RATE_LIMITED" }, headers: { "retry-after": "17" } }).api.registerSeller(seller));
    expect([limited.code, limited.retryAfterSeconds]).toEqual(["RATE_LIMITED", 17]);
    const unknownWait = await failure(client({ status: 429, body: { success: false, code: "RATE_LIMITED" } }).api.registerSeller(seller));
    expect(unknownWait.retryAfterSeconds).toBeNull();
    const blankWait = await failure(client({ status: 429, body: { success: false, code: "RATE_LIMITED" }, headers: { "retry-after": " " } }).api.registerSeller(seller));
    expect(blankWait.retryAfterSeconds).toBeNull();
    expect((await failure(client({ status: 400, body: { success: false, code: "SOMETHING_NEW" } }).api.registerSeller(seller))).code).toBe("unknown");
  });

  it("treats transport problems as local failures", async () => {
    expect((await failure(client({ status: 302, body: "", headers: { location: "https://elsewhere.example" } }).api.registerSeller(seller))).code).toBe("unavailable");
    expect((await failure(client({ status: 502, body: "<html>", type: "text/html" }).api.registerSeller(seller))).code).toBe("unavailable");
    expect((await failure(client({ status: 200, body: "<html>", type: "text/html" }).api.registerSeller(seller))).code).toBe("malformed");
    expect((await failure(client({ status: 200, body: { success: true, pad: "x".repeat(300 * 1024) } }).api.registerSeller(seller))).code).toBe("malformed");
    expect((await failure(client({ status: 200, body: { success: true }, headers: { "content-length": String(10 * 1024 * 1024) } }).api.registerSeller(seller))).code).toBe("malformed");
    const throwing = (async () => { throw new TypeError(`fetch failed ${SECRET}`); }) as typeof fetch;
    expect((await failure(createPartnerClient("sandbox", "partner-x", SECRET, throwing).registerSeller(seller))).code).toBe("unavailable");
  });
});

describe("list sellers and seller keys", () => {
  it("returns binding facts only, never names, emails or phones", async () => {
    const { api, calls } = client({ status: 200, body: { success: true, data: { sellers: [
      { sellerId: "66ab1234567890abcdef1234", externalUserId: "geraiexpress:tenant:1", name: "N", email: "e@example.com", phone: "0812", active: true },
      { sellerId: "66ab1234567890abcdef1235", externalUserId: "geraiexpress:tenant:2", active: false },
    ], page: 1, size: 50, total: 2, totalPages: 1 } } });
    const result = await api.listSellers({ externalUserId: "geraiexpress:tenant:1" });
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ externalUserId: "geraiexpress:tenant:1" });
    expect(result).toEqual({ total: 2, sellers: [
      { sellerId: "66ab1234567890abcdef1234", externalUserId: "geraiexpress:tenant:1", active: true },
      { sellerId: "66ab1234567890abcdef1235", externalUserId: "geraiexpress:tenant:2", active: false },
    ] });
  });

  it("fails the whole page on a bad entry or count, and checks pagination locally", async () => {
    const page = (sellers: unknown[], total: unknown = sellers.length) => ({ status: 200, body: { success: true, data: { sellers, total } } });
    const good = { sellerId: "66ab1234567890abcdef1234", externalUserId: "geraiexpress:tenant:1", active: true };
    for (const bad of [{ ...good, sellerId: "../x" }, { ...good, externalUserId: 7 }, { ...good, active: "yes" }, null]) {
      expect((await failure(client(page([good, bad])).api.listSellers())).code).toBe("malformed");
    }
    expect((await failure(client(page([good], -1)).api.listSellers())).code).toBe("malformed");
    expect((await failure(client(page([good], 1.5)).api.listSellers())).code).toBe("malformed");
    const { api, calls } = client(page([good]));
    await expect(api.listSellers({ size: 201 })).rejects.toThrow("Invalid pagination");
    await expect(api.listSellers({ page: 0 })).rejects.toThrow("Invalid pagination");
    expect(calls).toEqual([]);
  });

  it("accepts a key only for the seller that was asked for", async () => {
    const reply = (sellerId: string) => ({ status: 200, body: { success: true, data: { sellerId, apiKey: "API-3F9K2QX7ZB1MTDLE" } } });
    expect(await client(reply("66ab1234567890abcdef1234")).api.getSellerApiKey("66ab1234567890abcdef1234")).toBe("API-3F9K2QX7ZB1MTDLE");
    expect((await failure(client(reply("66ab1234567890abcdef9999")).api.getSellerApiKey("66ab1234567890abcdef1234"))).code).toBe("malformed");
    expect((await failure(client({ status: 403, body: { success: false, code: "API_KEY_DISABLED" } }).api.getSellerApiKey("66ab1234567890abcdef1234"))).code).toBe("API_KEY_DISABLED");
    await expect(client(reply("x")).api.getSellerApiKey("../x")).rejects.toThrow("Invalid sellerId");
  });

  it("only knows the sandbox until a production origin is provided", () => {
    expect(() => createPartnerClient("production" as "sandbox", "partner-x", SECRET)).toThrow();
  });
});

// T-039 / PR-19: regenerate retires the old key immediately; bodies come from the Partner documentation.
const fixture = (name: string) => JSON.parse(readFileSync(new URL(`fixtures/mengantar/${name}`, import.meta.url), "utf8"));
const REGEN_SELLER = "66ab1234567890abcdef1234";

describe("regenerate seller key (T-039)", () => {
  it("signs the regenerate path, sends only the seller id and returns the key without the callback secret", async () => {
    const { api, calls } = client({ status: 200, body: fixture("partner-regenerate-success.json") });
    const key = await api.regenerateSellerKey(REGEN_SELLER);
    expect(key).toBe("API-NEWKEY8F2QX7ZB1MT");
    expect(typeof key).toBe("string");
    const { url, init } = calls[0];
    expect(url).toBe("https://sandbox.mengantar.com/api/partner/v1/sellers/api-key/regenerate");
    expect(init.redirect).toBe("manual");
    expect(JSON.parse(String(init.body))).toEqual({ sellerId: REGEN_SELLER });
    const headers = init.headers as Record<string, string>;
    expect(headers.signature).toBe(await partnerSignature("/api/partner/v1/sellers/api-key/regenerate", String(init.body), "1758790800", SECRET));
    expect(headers.signature).not.toBe(await partnerSignature("/api/partner/v1/sellers/api-key", String(init.body), "1758790800", SECRET));
    // The secret is neither returned nor kept anywhere the caller can reach.
    expect(JSON.stringify(key)).not.toContain("CALLBACK-SECRET");
    expect(await client({ status: 200, body: fixture("partner-regenerate-success-no-webhook.json") }).api.regenerateSellerKey(REGEN_SELLER)).toBe("API-NEWKEY8F2QX7ZB1MT");
  });

  it("accepts a key only for the seller asked for and treats a bad shape as malformed", async () => {
    const reply = (data: unknown) => ({ status: 200, body: { success: true, data } });
    expect((await failure(client(reply({ sellerId: "66ab1234567890abcdef9999", apiKey: "API-NEWKEY8F2QX7ZB1MT" })).api.regenerateSellerKey(REGEN_SELLER))).code).toBe("malformed");
    expect((await failure(client(reply({ sellerId: REGEN_SELLER, apiKey: "../evil key" })).api.regenerateSellerKey(REGEN_SELLER))).code).toBe("malformed");
    expect((await failure(client(reply({ sellerId: REGEN_SELLER })).api.regenerateSellerKey(REGEN_SELLER))).code).toBe("malformed");
    await expect(client(reply({})).api.regenerateSellerKey("../x")).rejects.toThrow("Invalid sellerId");
  });

  it("maps the documented refusals and transport failures", async () => {
    const stop = await failure(client({ status: 403, body: fixture("partner-error-seller-deactivated.json") }).api.regenerateSellerKey(REGEN_SELLER));
    expect([stop.code, stop.status]).toEqual(["SELLER_DEACTIVATED", 403]);
    expect((await failure(client({ status: 403, body: fixture("partner-error-api-key-disabled.json") }).api.regenerateSellerKey(REGEN_SELLER))).code).toBe("API_KEY_DISABLED");
    expect((await failure(client({ status: 404, body: fixture("partner-error-seller-not-found.json") }).api.regenerateSellerKey(REGEN_SELLER))).code).toBe("SELLER_NOT_FOUND");
    const limited = await failure(client({ status: 429, body: fixture("partner-error-rate-limited.json"), headers: { "retry-after": "23" } }).api.regenerateSellerKey(REGEN_SELLER));
    expect([limited.code, limited.status, limited.retryAfterSeconds]).toEqual(["RATE_LIMITED", 429, 23]);
    expect((await failure(client({ status: 502, body: "<html>", type: "text/html" }).api.regenerateSellerKey(REGEN_SELLER))).code).toBe("unavailable");
    const throwing = (async () => { throw new TypeError("fetch failed"); }) as typeof fetch;
    expect((await failure(createPartnerClient("sandbox", "partner-x", SECRET, throwing).regenerateSellerKey(REGEN_SELLER))).code).toBe("unavailable");
  });
});
