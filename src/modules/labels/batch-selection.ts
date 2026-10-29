import {
  buildLabelContent, contentFromSnapshot, sameChoice, senderErrors,
  type LabelChoice, type LabelContent, type LabelFacts, type LabelSnapshot, type SenderInput,
} from "../../lib/label-content";

export const BATCH_LIMIT = 50;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Search params may arrive as a string, an array (?ids=a&ids=b) or nothing: anything but one
// comma-separated string of at most 50 UUIDs is not a batch (the page answers not-found).
export function parseBatchIds(raw: unknown): string[] | null {
  if (typeof raw !== "string" || !raw) return null;
  const parts = raw.split(",");
  if (parts.length > BATCH_LIMIT || parts.some((id) => !UUID.test(id))) return null;
  return [...new Set(parts.map((id) => id.toLowerCase()))];
}

export type BatchCandidate = {
  id: string; reference: string; submission_state: string; awb: string | null; is_simulated: boolean;
  sender_name: string | null; sender_phone: string | null;
};

// Shipments store no sender city. Masked batches use a single operator-entered city, never the
// recipient's area or the outlet pickup area. Name and phone always come from the shipment.
export function batchSender(row: BatchCandidate, city: string): SenderInput {
  return { name: row.sender_name ?? "", phone: row.sender_phone ?? "", city };
}

export function batchExclusion(row: BatchCandidate, mask: boolean, city: string): string | null {
  if (row.is_simulated) return "Pengiriman simulasi tidak dapat dicetak massal.";
  if (row.submission_state !== "issued") return "Resi belum terbit.";
  if (!row.awb || !/^[A-Za-z0-9-]{6,40}$/.test(row.awb)) return "Nomor resi tidak tersedia atau tidak valid.";
  if (mask) {
    const errors = Object.values(senderErrors(batchSender(row, city)));
    if (errors.length) return errors.join(" ");
  }
  return null;
}

// What the preview shows before printing: the stored snapshot when create_label_snapshot would reuse
// it (it then prints exactly that, even if the gerai name or WhatsApp changed since), otherwise the
// label built from the current facts, as the single label page does.
export function batchPreviewContent(facts: LabelFacts, latest: LabelSnapshot | null, choice: LabelChoice): LabelContent {
  return latest && sameChoice(latest, choice) ? contentFromSnapshot(latest) : buildLabelContent(facts, choice);
}

// After a print, each returned snapshot becomes the shipment's latest stored snapshot, so a later
// preview (for example after switching 10x15 -> 10x10 -> 10x15) compares against the same row
// create_label_snapshot compares against instead of falling back to the page-load snapshot.
export function advanceLatestSnapshots(previous: ReadonlyMap<string, LabelSnapshot | null>, printedIds: string[], snapshots: LabelSnapshot[]): Map<string, LabelSnapshot | null> {
  const next = new Map(previous);
  snapshots.forEach((snapshot, i) => { if (printedIds[i]) next.set(printedIds[i], snapshot); });
  return next;
}

export type BatchStep = { ok: true; snapshot: LabelSnapshot } | { ok: false; error: string };

// Prints in order and stops at the first failure: the snapshots recorded before it are returned with
// the failing reference, so the operator is told how many print requests already exist.
export async function printSequentially(rows: BatchCandidate[], step: (row: BatchCandidate) => Promise<BatchStep>): Promise<{ snapshots: LabelSnapshot[]; error?: string }> {
  const snapshots: LabelSnapshot[] = [];
  for (const row of rows) {
    const result = await step(row);
    if (!result.ok) return { snapshots, error: `${row.reference}: ${result.error}` };
    snapshots.push(result.snapshot);
  }
  return { snapshots };
}
