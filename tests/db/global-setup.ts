import { execFileSync } from "node:child_process";

// Reads the local Supabase stack's public URL and publishable (anon) key. Only the anon key is used:
// every assertion goes through the same Data API/RPC surface a browser can reach (TEN-1, NFR-1).
export default function setup() {
  if (process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY) return;
  const out = execFileSync("pnpm", ["exec", "supabase", "status", "-o", "json"], { encoding: "utf8" });
  const status = JSON.parse(out.slice(out.indexOf("{")));
  process.env.SUPABASE_URL = status.API_URL;
  process.env.SUPABASE_ANON_KEY = status.PUBLISHABLE_KEY ?? status.ANON_KEY;
}
