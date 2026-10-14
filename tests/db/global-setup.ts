import { execFileSync } from "node:child_process";

// Reads the local Supabase stack's public URL and publishable (anon) key. User-facing assertions
// use only the anon key: the same Data API/RPC surface a browser can reach (TEN-1, NFR-1). The
// local secret key is exposed only for the machine-identity dispatcher tests (DEC-010).
export default function setup() {
  if (process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY && process.env.SUPABASE_SECRET_KEY) return;
  const out = execFileSync("pnpm", ["exec", "supabase", "status", "-o", "json"], { encoding: "utf8" });
  const status = JSON.parse(out.slice(out.indexOf("{")));
  process.env.SUPABASE_URL = status.API_URL;
  process.env.SUPABASE_ANON_KEY = status.PUBLISHABLE_KEY ?? status.ANON_KEY;
  process.env.SUPABASE_SECRET_KEY = status.SECRET_KEY ?? status.SERVICE_ROLE_KEY;
}
