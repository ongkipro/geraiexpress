import { PostgrestClient } from "@supabase/postgrest-js";

// ADR-0002 section 3.4: the app talks to PostgreSQL only through PostgREST, with a bearer JWT.
// `@supabase/postgrest-js` is a stand-alone query builder with no dependency on any Supabase service.
export type Db = PostgrestClient;

// T-105: every PostgREST request has an application-owned deadline (headers and body), composed with any
// caller signal. Interactive requests get DB_TIMEOUT_MS; the scheduled machine clients, already bounded by
// the 270 s cron deadline, get SCHEDULED_DB_TIMEOUT_MS so a long cleanup batch is not cut short. This bounds
// the HTTP wait only: PostgreSQL may still finish the statement (a per-role statement_timeout is SQL work).
export const DB_TIMEOUT_MS = 15_000;
export const SCHEDULED_DB_TIMEOUT_MS = 60_000;

// An expired deadline rejects as AbortError, which postgrest-js never retries (a TimeoutError on a GET
// would be). The caller sees an ordinary error result: a mutation whose answer did not arrive is an
// unknown outcome there, never replayed here.
// The race also bounds a transport that ignores its signal.
export function deadlineFetch(timeoutMs: number, fetchImpl?: typeof fetch): typeof fetch {
  return async (input, init) => {
    const deadline = AbortSignal.timeout(timeoutMs);
    const signal = init?.signal ? AbortSignal.any([init.signal, deadline]) : deadline;
    const expired = new Promise<never>((_, reject) => {
      deadline.addEventListener("abort", () => reject(new DOMException("Database request deadline exceeded", "AbortError")), { once: true });
    });
    expired.catch(() => {});
    try {
      return await Promise.race([(fetchImpl ?? fetch)(input, { ...init, signal }), expired]);
    } catch (error) {
      if (deadline.aborted && !init?.signal?.aborted) throw new DOMException("Database request deadline exceeded", "AbortError");
      throw error;
    }
  };
}

export function dataClient(baseUrl: string, bearer: string, fetchImpl?: typeof fetch, timeoutMs = DB_TIMEOUT_MS): Db {
  return new PostgrestClient(baseUrl, {
    headers: { Authorization: `Bearer ${bearer}` },
    fetch: deadlineFetch(timeoutMs, fetchImpl),
  });
}
