import { afterEach, describe, expect, it, vi } from "vitest";
import { DB_TIMEOUT_MS, dataClient, deadlineFetch } from "../../src/lib/db/client";

// T-105 / Ops 2: every PostgREST request has an application-owned deadline. A transport that never answers
// (and ignores its abort signal) still ends, as an ordinary error result, without a retry.
afterEach(() => vi.useRealTimers());

const never = () => vi.fn<typeof fetch>(() => new Promise<Response>(() => {}));

describe("database request deadline", () => {
  it("ends a never-resolving fetch as an AbortError at the deadline", async () => {
    const transport = never();
    const pending = deadlineFetch(20, transport)("http://data.test/rpc/x", { method: "POST" });
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(transport.mock.calls[0][1]?.signal?.aborted).toBe(true);
  });

  it("keeps the caller's own abort reason and composes both signals", async () => {
    const transport = vi.fn<typeof fetch>((_input, init) => new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
    }));
    const caller = new AbortController();
    const pending = deadlineFetch(60_000, transport)("http://data.test/", { signal: caller.signal });
    caller.abort(new DOMException("caller", "TimeoutError"));
    await expect(pending).rejects.toMatchObject({ name: "TimeoutError", message: "caller" });
  });

  it("returns a never-answering mutation as an error result once, never replayed (unknown outcome for the caller)", async () => {
    vi.useFakeTimers();
    const transport = never();
    const result = dataClient("http://data.test", "token", transport as unknown as typeof fetch).rpc("confirm_shipment", { p: 1 });
    const settled = Promise.resolve(result);
    await vi.advanceTimersByTimeAsync(DB_TIMEOUT_MS);
    const { data, error } = await settled;
    expect(data).toBeNull();
    expect(error?.message).toMatch(/^AbortError/);
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("does not retry a timed-out read either", async () => {
    vi.useFakeTimers();
    const transport = never();
    const settled = Promise.resolve(dataClient("http://data.test", "token", transport as unknown as typeof fetch).from("shipments").select("id"));
    await vi.advanceTimersByTimeAsync(DB_TIMEOUT_MS * 5);
    expect((await settled).error).not.toBeNull();
    expect(transport).toHaveBeenCalledTimes(1);
  });
});
