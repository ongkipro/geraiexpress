// T-086: row shapes the case pages read (the query builder is untyped; these name what is used).
import type { CaseOutcome, CaseRegion, CaseState, CaseType, ClaimType, DecidedBy } from "./copy";

export const CASE_COLUMNS = "id, shipment_id, revision, case_type, claim_type, state, description, evidence_refs, provider_ticket, region, anchor_at, anchor_entered_by, anchor_entered_at, rule_id, deadline_at, opened_by, opened_at, updated_at, outcome, decided_amount_idr, decided_by_party, closed_by, closed_at";

export type CaseRecord = {
  id: string;
  shipment_id: string;
  revision: number;
  case_type: CaseType;
  claim_type: ClaimType;
  state: CaseState;
  description: string;
  evidence_refs: string[];
  provider_ticket: string | null;
  region: CaseRegion | null;
  anchor_at: string | null;
  anchor_entered_by: string | null;
  anchor_entered_at: string | null;
  rule_id: string | null;
  deadline_at: string | null;
  opened_by: string;
  opened_at: string;
  updated_at: string;
  outcome: CaseOutcome | null;
  decided_amount_idr: number | null;
  decided_by_party: DecidedBy | null;
  closed_by: string | null;
  closed_at: string | null;
};

export type CaseEvent = { id: string; kind: "opened" | "updated" | "closed"; state: CaseState; changed: string[]; note: string | null; actor: string; at: string };
