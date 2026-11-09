// T-043: the effective pickup lead time, read from the same setting the database enforces
// (private.settings 'pickup_min_lead_minutes' through public.pickup_lead_minutes(), migration 20261109210000).
// Server-side only. The caller passes a function that performs the RPC with ITS OWN client (the member's
// session for a save or a confirmation, the machine client for the Worker), so no new privilege is used.
// Any failure (error result, thrown error, a value that is not a positive whole number) falls back to the
// documented default: the database re-checks every confirmation and reservation under lock, so a fallback can
// never accept a slot the database refuses.
import { PICKUP_LEAD_MINUTES } from "./pickup";

type ReadResult = PromiseLike<{ data: unknown; error: unknown }>;

export async function pickupLeadMinutes(read: () => ReadResult): Promise<number> {
  try {
    const { data, error } = await read();
    if (error) return PICKUP_LEAD_MINUTES;
    return typeof data === "number" && Number.isInteger(data) && data > 0 ? data : PICKUP_LEAD_MINUTES;
  } catch {
    return PICKUP_LEAD_MINUTES;
  }
}
