import "server-only";
import { anonClient } from "../../lib/auth/instance";
import { publicTracking } from "./projection";
import { trackingWithinLimit } from "./rate-limit";

export const TRACKING_PROJECTION_HEADER = "x-gx-public-tracking";

// One anonymous RPC, including malformed tokens; never dbServer (cookies) or machineClient.
// The proxy owns lookup/404 before rendering starts, preventing a streamed soft-404.
export async function readPublicTracking(token: string, ip: string | null) {
  if (!await trackingWithinLimit(ip)) return { kind: "limited" as const };
  let projection = null;
  try {
    const db = await anonClient();
    const { data, error } = await db.rpc("track_shipment", { token: token.slice(0, 256) });
    if (!error) projection = publicTracking(data);
  } catch {
    // No upstream error, token or address is logged or returned to an anonymous caller.
  }
  if (!projection) {
    if (!await trackingWithinLimit(ip, true)) return { kind: "limited" as const };
    return { kind: "missing" as const };
  }
  return { kind: "found" as const, projection };
}
