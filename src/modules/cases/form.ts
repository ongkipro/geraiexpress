// T-086: parsing of the case dialogs' form fields. Pure (relative imports only) so the unit tests can
// load it without the '@/' alias. The database re-validates every value (private.case_inputs).
import { wibInstant } from "../../lib/wib";
import { parsePaymentRupiah } from "../payments/rupiah";
import {
  CASE_TYPES, CLAIM_TYPES, OUTCOMES, REGIONS,
  type CaseOutcome, type CaseRegion, type CaseType, type ClaimType, type DecidedBy,
} from "./copy";

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type CaseField = "case_type" | "claim_type" | "description" | "evidence" | "ticket" | "region" | "anchor" | "state"
  | "outcome" | "amount" | "decided_by" | "note";

export type CaseInputs = {
  claimType: ClaimType; description: string; evidence: string[]; ticket: string | null;
  region: CaseRegion | null; anchorAt: string | null;
};

const text = (form: FormData, key: string) => String(form.get(key) ?? "").trim();

export const evidenceLines = (raw: string) => raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

// Fields shared by open and update. A blank anchor stays unknown (null), unlike a payment time.
export function parseCaseInputs(form: FormData, now: Date = new Date()): { inputs?: CaseInputs; fieldErrors: Partial<Record<CaseField, true>> } {
  const fieldErrors: Partial<Record<CaseField, true>> = {};
  const claimType = text(form, "claim_type");
  if (!(CLAIM_TYPES as readonly string[]).includes(claimType)) fieldErrors.claim_type = true;
  const description = text(form, "description");
  if (description.length < 5 || description.length > 1000) fieldErrors.description = true;
  const evidence = evidenceLines(String(form.get("evidence") ?? ""));
  if (evidence.length > 10 || evidence.some((line) => line.length > 300)) fieldErrors.evidence = true;
  const ticket = text(form, "ticket");
  if (ticket.length > 80) fieldErrors.ticket = true;
  const region = text(form, "region");
  if (region && !(REGIONS as readonly string[]).includes(region)) fieldErrors.region = true;
  const anchorRaw = text(form, "anchor");
  const anchorAt = anchorRaw ? wibInstant(anchorRaw, now) : null;
  if (anchorRaw && (!anchorAt || Date.parse(anchorAt) > now.getTime())) fieldErrors.anchor = true;
  if (Object.keys(fieldErrors).length) return { fieldErrors };
  return {
    fieldErrors,
    inputs: {
      claimType: claimType as ClaimType, description, evidence, ticket: ticket || null,
      region: (region || null) as CaseRegion | null, anchorAt,
    },
  };
}

export const isCaseType = (value: string): value is CaseType => (CASE_TYPES as readonly string[]).includes(value);

export function parseCloseInputs(form: FormData): {
  close?: { outcome: CaseOutcome; amount: number | null; decidedBy: DecidedBy | null; note: string | null };
  fieldErrors: Partial<Record<CaseField, true>>;
} {
  const fieldErrors: Partial<Record<CaseField, true>> = {};
  const outcome = text(form, "outcome");
  if (!(OUTCOMES as readonly string[]).includes(outcome)) fieldErrors.outcome = true;
  const decidedRaw = text(form, "decided_by");
  const decidedBy = decidedRaw === "courier" || decidedRaw === "mengantar" ? decidedRaw : null;
  if (decidedRaw && !decidedBy) fieldErrors.decided_by = true;
  let amount: number | null = null;
  if (outcome === "compensated") {
    amount = parsePaymentRupiah(text(form, "amount"));
    if (amount === null || amount <= 0) fieldErrors.amount = true;
    if (!decidedBy) fieldErrors.decided_by = true;
  }
  const note = text(form, "note");
  if (note.length > 500) fieldErrors.note = true;
  if (Object.keys(fieldErrors).length) return { fieldErrors };
  return { fieldErrors, close: { outcome: outcome as CaseOutcome, amount, decidedBy, note: note || null } };
}

// datetime-local value in WIB for an ISO instant ("" when unknown), to prefill the update dialog.
export function wibLocalValue(iso: string | null): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  return new Date(t + 7 * 3_600_000).toISOString().slice(0, 16);
}
