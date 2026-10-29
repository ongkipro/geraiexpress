import { describe, expect, it, vi } from "vitest";
import { verifyTurnstile } from "../../src/lib/auth/turnstile";

const URL_SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function fetchReturning(response: () => Response | Promise<Response>) {
  return vi.fn<typeof fetch>(async () => response());
}

describe("verifyTurnstile", () => {
  it("is true only for 200 with success:true and posts the form", async () => {
    const fetchImpl = fetchReturning(() => json({ success: true }));
    await expect(verifyTurnstile({ secret: "sekrit", token: "tok-123", remoteIp: "203.0.113.9", fetchImpl })).resolves.toBe(true);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toBe(URL_SITEVERIFY);
    expect(init?.method).toBe("POST");
    const form = new URLSearchParams(String(init?.body));
    expect(form.get("secret")).toBe("sekrit");
    expect(form.get("response")).toBe("tok-123");
    expect(form.get("remoteip")).toBe("203.0.113.9");
  });

  it("omits remoteip when none is given", async () => {
    const fetchImpl = fetchReturning(() => json({ success: true }));
    await verifyTurnstile({ secret: "sekrit", token: "tok", fetchImpl });
    expect(new URLSearchParams(String(fetchImpl.mock.calls[0][1]?.body)).has("remoteip")).toBe(false);
  });

  it("is false for failure bodies, even with HTTP 200", async () => {
    for (const body of [{ success: false, "error-codes": ["invalid-input-response"] }, {}, { success: "true" }, { success: 1 }, { success: null }, [], "ok", null, 7]) {
      await expect(verifyTurnstile({ secret: "s", token: "t", fetchImpl: fetchReturning(() => json(body)) })).resolves.toBe(false);
    }
  });

  it("is false for non-200 statuses even when the body says success", async () => {
    for (const status of [201, 204, 400, 403, 429, 500, 503]) {
      const fetchImpl = fetchReturning(() => json({ success: true }, status));
      await expect(verifyTurnstile({ secret: "s", token: "t", fetchImpl })).resolves.toBe(false);
    }
  });

  it("is false on a network error without throwing", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      throw new TypeError("fetch failed");
    });
    await expect(verifyTurnstile({ secret: "s", token: "t", fetchImpl })).resolves.toBe(false);
  });

  it("is false when the body is not JSON", async () => {
    await expect(verifyTurnstile({ secret: "s", token: "t", fetchImpl: fetchReturning(() => new Response("<html>nope</html>", { status: 200 })) })).resolves.toBe(false);
    await expect(verifyTurnstile({ secret: "s", token: "t", fetchImpl: fetchReturning(() => new Response("", { status: 200 })) })).resolves.toBe(false);
  });

  it("is false on timeout, aborts the request and does not wait for a fetch that ignores the signal", async () => {
    let signal: AbortSignal | null | undefined;
    const hanging = vi.fn<typeof fetch>((_url, init) => {
      signal = init?.signal;
      return new Promise<Response>(() => {});
    });
    const started = Date.now();
    await expect(verifyTurnstile({ secret: "s", token: "t", fetchImpl: hanging, timeoutMs: 30 })).resolves.toBe(false);
    expect(Date.now() - started).toBeLessThan(2000);
    expect(signal?.aborted).toBe(true);
  });

  it("is false when the body read hangs past the timeout", async () => {
    const stuckBody = new Response(new ReadableStream({ start() {} }), { status: 200 });
    await expect(verifyTurnstile({ secret: "s", token: "t", fetchImpl: fetchReturning(() => stuckBody), timeoutMs: 30 })).resolves.toBe(false);
  });

  it("never calls fetch for a missing, empty or oversized token", async () => {
    const fetchImpl = fetchReturning(() => json({ success: true }));
    await expect(verifyTurnstile({ secret: "s", token: undefined, fetchImpl })).resolves.toBe(false);
    await expect(verifyTurnstile({ secret: "s", token: "", fetchImpl })).resolves.toBe(false);
    await expect(verifyTurnstile({ secret: "s", token: "x".repeat(2049), fetchImpl })).resolves.toBe(false);
    await expect(verifyTurnstile({ secret: "s", token: 5 as unknown as string, fetchImpl })).resolves.toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("accepts a token of exactly 2048 characters", async () => {
    const fetchImpl = fetchReturning(() => json({ success: true }));
    await expect(verifyTurnstile({ secret: "s", token: "x".repeat(2048), fetchImpl })).resolves.toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
