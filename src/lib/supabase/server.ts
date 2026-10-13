import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

// Request-scoped Supabase client carrying the signed-in user's session (TEN-1). Only the
// publishable key is used: every read/write is subject to RLS and RPC membership checks.
export async function supabaseServer() {
  const store = await cookies();
  return createServerClient(env("SUPABASE_URL"), env("SUPABASE_PUBLISHABLE_KEY"), {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch {
          // Server Components cannot set cookies; middleware refreshes the session instead.
        }
      },
    },
  });
}

export function env(name: "SUPABASE_URL" | "SUPABASE_PUBLISHABLE_KEY"): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing server environment variable ${name}`);
  return value;
}
