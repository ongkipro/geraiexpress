// T-043: the effective pickup lead time, read from the same setting the database enforces
// (private.settings 'pickup_min_lead_minutes' through public.pickup_lead_minutes(), migration 20261109210000).
// Server-side only. The caller passes a function that performs the RPC with ITS OWN client (the member's
// session for a save or a confirmation, the machine client for the Worker), so no new privilege is used.
// Any failure (error result, thrown error, a value that is not a positive whole number) falls back to the
// documented default (120). The database enforces the setting on a draft save and on a confirmation
// (private.pickup_slot_ok under lock). The Worker's re-check before a provider call is TypeScript only, so if the
// setting is raised above 120 and this read fails at that moment, the Worker uses 120 and may let a slot through that
// the stricter setting would have refused. The read uses the same client as the dispatch itself, so a failure here
// usually fails the dispatch too; the residual risk is a slot that is still valid at the provider (documented
// minimum 90 minutes), not a double order.
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
