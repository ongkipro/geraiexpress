import "server-only";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { headers } from "next/headers";
import { allowUnlimited, visitorKey } from "@/lib/visitor-key";

// RATE-1: per-visitor limits for public Auth entry points. Supabase Auth limits by the caller's
// IP, which for server-side calls is the Worker's shared egress address, and forwarding the real
// IP (Sb-Forwarded-For) needs a secret key this app deliberately does not hold. So the Worker
// limits each visitor (CF-Connecting-IP, set by Cloudflare) before calling Auth, and the project's
// Auth limits are sized for aggregate traffic. Limits live in wrangler.jsonc.
type Limiter = { limit(options: { key: string }): Promise<{ success: boolean }> };
export type LimitedAction = "SIGN_IN_LIMITER" | "DEMO_LIMITER";

export async function withinLimit(action: LimitedAction): Promise<boolean> {
  const key = visitorKey((await headers()).get("cf-connecting-ip"));
  let limiter: Limiter | undefined;
  try {
    limiter = (getCloudflareContext().env as unknown as Record<string, Limiter | undefined>)[action];
  } catch {
    limiter = undefined;
  }
  if (!limiter || !key) return allowUnlimited(process.env.NODE_ENV);
  return (await limiter.limit({ key })).success;
}
