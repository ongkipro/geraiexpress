import { PostgrestClient } from "@supabase/postgrest-js";

// ADR-0002 section 3.4: the app talks to PostgreSQL only through PostgREST, with a bearer JWT.
// `@supabase/postgrest-js` is a stand-alone query builder with no dependency on any Supabase service.
export type Db = PostgrestClient;

export function dataClient(baseUrl: string, bearer: string, fetchImpl?: typeof fetch): Db {
  return new PostgrestClient(baseUrl, {
    headers: { Authorization: `Bearer ${bearer}` },
    ...(fetchImpl && { fetch: fetchImpl }),
  });
}
