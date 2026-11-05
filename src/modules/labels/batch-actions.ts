"use server";

import { dbServer } from "@/lib/db/server";
import { SNAPSHOT_COLUMNS, isLabelSize, type LabelSnapshot } from "../../lib/label-content";
import { requireWorkspace } from "@/lib/workspace";
import { BATCH_LIMIT, batchExclusion, batchSender, parseBatchIds, printSequentially, type BatchCandidate } from "./batch-selection";
import { LABEL_UNKNOWN_RESULT, MASKING_ACK_REQUIRED, labelPrintError } from "./messages";

// `acknowledged`: one PR-46 acknowledgement for the whole batch (the screen lists every courier without
// recorded masking acceptance); record_label_print enforces it per masked label and records it.
export async function printBatchLabelsAction(input: { ids: string[]; mask: boolean; size: string; city: string; acknowledged: boolean }): Promise<{ snapshots: LabelSnapshot[]; error?: string; reconcile?: boolean }> {
  const ws = await requireWorkspace();
  if (!input || typeof input !== "object" || Array.isArray(input)
    || !Array.isArray(input.ids) || input.ids.length > BATCH_LIMIT
    || !input.ids.every((id) => typeof id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))
    || !isLabelSize(input.size) || typeof input.city !== "string" || input.city.length > 100 || typeof input.mask !== "boolean"
    || typeof input.acknowledged !== "boolean") {
    return { snapshots: [], error: "Pilihan label tidak valid." };
  }
  const ids = parseBatchIds(input.ids.join(","));
  if (!ids) return { snapshots: [], error: "Pilihan label tidak valid." };
  const db = await dbServer();
  const [{ data: rows, error }, { data: tenant }] = await Promise.all([
    db.from("shipments").select("id, reference, submission_state, awb, is_simulated, sender_name, sender_phone, sender_address, sender_area, quote:shipment_quotes!shipments_tenant_id_selected_quote_id_fkey(courier)").eq("tenant_id", ws.tenant.id).in("id", ids),
    db.from("tenants").select("contact_whatsapp, masking_allowed").eq("id", ws.tenant.id).maybeSingle(),
  ]);
  if (error || !tenant) return { snapshots: [], error: "Daftar label belum bisa dimuat." };
  if (input.mask && !tenant.masking_allowed) return { snapshots: [], error: "Masking tidak diizinkan untuk gerai ini." };
  if (!input.mask && !tenant.contact_whatsapp) return { snapshots: [], error: "Isi WhatsApp gerai di Pengaturan sebelum mencetak." };
  const byId = new Map((rows ?? []).map((row) => [row.id, row as unknown as BatchCandidate & { quote?: { courier: string } | null }]));
  const candidates = ids.flatMap((id) => { const row = byId.get(id); return row && !batchExclusion(row, input.mask, input.city) ? [row] : []; });
  if (!candidates.length) return { snapshots: [], error: "Tidak ada label yang dapat dicetak." };
  if (candidates.length !== ids.length) return { snapshots: [], error: "Pilihan pengiriman berubah atau tidak tersedia. Muat ulang dan periksa kembali sebelum mencetak." };
  // PR-46: without the batch acknowledgement, refuse before the first print when any selected courier is
  // not verified, so a masked batch never stops halfway on the gate. The database still enforces it.
  if (input.mask && !input.acknowledged) {
    const couriers = [...new Set(candidates.map((row) => row.quote?.courier ?? null))];
    for (const courier of couriers) {
      const state = courier ? await db.rpc("masking_acceptance_for", { p_courier: courier }) : null;
      if (!state || state.error || (state.data as { state?: string } | null)?.state !== "verified") {
        return { snapshots: [], error: MASKING_ACK_REQUIRED };
      }
    }
  }
  return printSequentially(candidates, async (row) => {
    const sender = batchSender(row, input.city);
    const created = await db.rpc("create_label_snapshot", { p_shipment: row.id, p_mask: input.mask, p_size: input.size, p_sender_name: input.mask ? sender.name : null, p_sender_phone: input.mask ? sender.phone : null, p_sender_city: input.mask ? sender.city : null, p_sender_address: input.mask ? sender.address : null });
    if (created.error || typeof created.data !== "string") {
      const message = labelPrintError(created.error);
      return { ok: false, error: message, reconcile: message === LABEL_UNKNOWN_RESULT };
    }
    const printed = await db.rpc("record_label_print", { p_snapshot: created.data, p_acknowledged: input.acknowledged });
    if (printed.error) {
      const message = labelPrintError(printed.error);
      return { ok: false, error: message, reconcile: message === LABEL_UNKNOWN_RESULT };
    }
    const { data: snapshot } = await db.from("label_snapshots").select(SNAPSHOT_COLUMNS).eq("tenant_id", ws.tenant.id).eq("id", created.data).maybeSingle();
    if (!snapshot) return { ok: false, error: LABEL_UNKNOWN_RESULT, reconcile: true };
    return { ok: true, snapshot: snapshot as unknown as LabelSnapshot };
  });
}
