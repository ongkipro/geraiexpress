import { limiterFor } from "../../lib/limiter";
import { visitorKey } from "../../lib/visitor-key";

// Unlike auth's local-development opt-out, public tracking always refuses a missing IP.
// The caller uses clientAddress, never arbitrary X-Forwarded-For or a token as the budget key.
export async function trackingWithinLimit(ip: string | null, invalid = false): Promise<boolean> {
  const key = visitorKey(ip);
  if (!key) return false;
  try {
    return (await limiterFor(invalid ? "TRACKING_INVALID_LIMITER" : "TRACKING_LIMITER").limit({ key })).success;
  } catch {
    return false;
  }
}
