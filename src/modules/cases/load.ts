import "server-only";
import { cache } from "react";
import { dbServer } from "@/lib/db/server";
import type { ClaimRule } from "./deadline";
import { CASE_COLUMNS, type CaseEvent, type CaseRecord } from "./types";

// T-086 reads, all through the caller's session (RLS) with an explicit tenant filter.

// The sourced claim-window rules (member RPC; private table). Null when the read failed.
export const loadClaimRules = cache(async (tenantId: string): Promise<ClaimRule[] | null> => {
  const db = await dbServer();
  const { data, error } = await db.rpc("claim_window_rules", { p_tenant: tenantId });
  return error || !Array.isArray(data) ? null : (data as ClaimRule[]);
});

export const ruleById = (rules: ClaimRule[], id: string | null) => (id ? rules.find((r) => r.id === id) ?? null : null);

export async function loadCaseEvents(tenantId: string, caseId: string): Promise<CaseEvent[] | null> {
  const db = await dbServer();
  const { data, error } = await db.from("shipment_case_events").select("id, kind, state, changed, note, actor, at")
    .eq("tenant_id", tenantId).eq("case_id", caseId).order("at").returns<CaseEvent[]>();
  return error || !data ? null : data;
}

// The shipment's cases, newest first (the non-closed one, if any, is the current case).
export async function loadShipmentCases(tenantId: string, shipmentId: string): Promise<CaseRecord[] | null> {
  const db = await dbServer();
  const { data, error } = await db.from("shipment_cases").select(CASE_COLUMNS)
    .eq("tenant_id", tenantId).eq("shipment_id", shipmentId).order("opened_at", { ascending: false }).returns<CaseRecord[]>();
  return error || !data ? null : data;
}

export type CaseAttentionRow = {
  id: string; reference: string; recipient_name: string | null; returned: boolean;
  case_id: string | null; case_type: string | null; case_state: string | null; deadline_at: string | null; since: string;
};

// UX-20 item 1: returning shipments and non-closed cases for the dashboard and the shell badge.
export const loadCaseAttention = cache(async (tenantId: string, limit: number): Promise<{ count: number; rows: CaseAttentionRow[] } | null> => {
  const db = await dbServer();
  const { data, error } = await db.rpc("case_attention", { p_tenant: tenantId, p_limit: limit });
  if (error || !data || typeof data !== "object") return null;
  const value = data as { count?: unknown; rows?: unknown };
  if (typeof value.count !== "number" || !Array.isArray(value.rows)) return null;
  return { count: value.count, rows: value.rows as CaseAttentionRow[] };
});
