"use server";

// T-086 / UX-20: Server Actions for return and claim cases. The database computes the deadline from
// the stored rule inputs; the action passes only what the operator typed. A lost response after
// dispatch is reported as unknown and never replayed automatically.
import { revalidatePath } from "next/cache";
import { dbServer } from "@/lib/db/server";
import { requireWorkspace } from "@/lib/workspace";
import { CASE_COPY, caseError } from "./copy";
import { UUID, isCaseType, parseCaseInputs, parseCloseInputs, type CaseField } from "./form";

export type CaseActionState = { ok?: string; error?: string; reconcile?: boolean; fieldErrors?: Partial<Record<CaseField, true>> };

function refresh(shipmentId?: string) {
  revalidatePath("/kasus", "layout");
  revalidatePath("/pengiriman", "layout");
  revalidatePath("/");
  if (shipmentId) revalidatePath(`/pengiriman/${shipmentId}`);
}

async function run(call: () => PromiseLike<{ error: { message?: string | null } | null }>, ok: string, shipmentId?: string): Promise<CaseActionState> {
  try {
    const { error } = await call();
    refresh(shipmentId);
    if (error) {
      const message = caseError(error);
      return { error: message, reconcile: message === CASE_COPY.unknownResult || ["case_closed", "case_changed", "case_open_exists"].includes(error.message ?? "") };
    }
    return { ok };
  } catch {
    return { error: CASE_COPY.unknownResult, reconcile: true };
  }
}

export async function openCaseAction(_: CaseActionState, form: FormData): Promise<CaseActionState> {
  const ws = await requireWorkspace();
  const shipmentId = String(form.get("shipment_id") ?? "");
  if (!UUID.test(shipmentId)) return { error: caseError({ message: "not_found" }) };
  const caseType = String(form.get("case_type") ?? "");
  const parsed = parseCaseInputs(form);
  const fieldErrors = { ...parsed.fieldErrors, ...(isCaseType(caseType) ? {} : { case_type: true as const }) };
  if (!parsed.inputs || Object.keys(fieldErrors).length) return { error: CASE_COPY.checkFields, fieldErrors };
  const db = await dbServer();
  const scoped = await db.from("shipments").select("id").eq("tenant_id", ws.tenant.id).eq("id", shipmentId).maybeSingle();
  if (scoped.error) return { error: CASE_COPY.unknownResult, reconcile: true };
  if (!scoped.data) return { error: caseError({ message: "not_found" }) };
  const i = parsed.inputs;
  return run(() => db.rpc("open_shipment_case", {
    p_shipment: shipmentId, p_case_type: caseType, p_claim_type: i.claimType, p_description: i.description,
    p_evidence_refs: i.evidence, p_provider_ticket: i.ticket, p_region: i.region, p_anchor_at: i.anchorAt,
  }), CASE_COPY.saved, shipmentId);
}

async function scopedCase(tenantId: string, caseId: string) {
  const db = await dbServer();
  const scoped = await db.from("shipment_cases").select("id, shipment_id").eq("tenant_id", tenantId).eq("id", caseId).maybeSingle();
  return { db, scoped };
}

export async function updateCaseAction(_: CaseActionState, form: FormData): Promise<CaseActionState> {
  const ws = await requireWorkspace();
  const caseId = String(form.get("case_id") ?? "");
  if (!UUID.test(caseId)) return { error: caseError({ message: "not_found" }) };
  const revision = Number(form.get("revision"));
  const state = String(form.get("state") ?? "");
  const parsed = parseCaseInputs(form);
  const fieldErrors = { ...parsed.fieldErrors, ...(state === "open" || state === "submitted" ? {} : { state: true as const }) };
  if (!parsed.inputs || !Number.isSafeInteger(revision) || Object.keys(fieldErrors).length) return { error: CASE_COPY.checkFields, fieldErrors };
  const { db, scoped } = await scopedCase(ws.tenant.id, caseId);
  if (scoped.error) return { error: CASE_COPY.unknownResult, reconcile: true };
  if (!scoped.data) return { error: caseError({ message: "not_found" }) };
  const i = parsed.inputs;
  return run(() => db.rpc("update_shipment_case", {
    p_case: caseId, p_expected_revision: revision, p_state: state, p_claim_type: i.claimType, p_description: i.description,
    p_evidence_refs: i.evidence, p_provider_ticket: i.ticket, p_region: i.region, p_anchor_at: i.anchorAt,
  }), CASE_COPY.updated, (scoped.data as { shipment_id: string }).shipment_id);
}

export async function closeCaseAction(_: CaseActionState, form: FormData): Promise<CaseActionState> {
  const ws = await requireWorkspace();
  if (ws.role !== "tenant_admin") return { error: caseError({ message: "admin_required" }) };
  const caseId = String(form.get("case_id") ?? "");
  if (!UUID.test(caseId)) return { error: caseError({ message: "not_found" }) };
  const parsed = parseCloseInputs(form);
  if (!parsed.close) return { error: CASE_COPY.checkFields, fieldErrors: parsed.fieldErrors };
  const { db, scoped } = await scopedCase(ws.tenant.id, caseId);
  if (scoped.error) return { error: CASE_COPY.unknownResult, reconcile: true };
  if (!scoped.data) return { error: caseError({ message: "not_found" }) };
  const c = parsed.close;
  return run(() => db.rpc("close_shipment_case", {
    p_case: caseId, p_outcome: c.outcome, p_decided_amount_idr: c.amount, p_decided_by_party: c.decidedBy, p_note: c.note,
  }), CASE_COPY.closed, (scoped.data as { shipment_id: string }).shipment_id);
}
