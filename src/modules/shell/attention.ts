import "server-only";
import { cache } from "react";
import { dbServer } from "@/lib/db/server";

// The exception tier (UX-16 "Perlu tindakan"): provider outcomes and payments someone must look at.
export const ATTENTION_STATES: string[] = ["unknown", "failed", "awaiting_payment", "queued", "in_flight"];

// One bounded head count (no rows) for the shell's badge; cached per request so a page that needs
// the same number does not query twice. Null when the count could not be read: the badge hides
// rather than showing an invented zero.
export const attentionCount = cache(async (tenantId: string): Promise<number | null> => {
  const db = await dbServer();
  const { count, error } = await db.from("shipments").select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId).in("submission_state", ATTENTION_STATES);
  return error ? null : (count ?? 0);
});

// T-086 / UX-20 item 1: returning shipments and non-closed cases, for the "Kasus" nav badge. Null
// when unreadable (the badge hides). Cases open only on issued shipments, so this never double-counts
// the submission-state tier above.
export const caseAttentionCount = cache(async (tenantId: string): Promise<number | null> => {
  const db = await dbServer();
  const { data, error } = await db.rpc("case_attention", { p_tenant: tenantId, p_limit: 1 });
  const count = (data as { count?: unknown } | null)?.count;
  return error || typeof count !== "number" ? null : count;
});
