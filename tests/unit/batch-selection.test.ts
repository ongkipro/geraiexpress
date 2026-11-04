import { describe, expect, it } from "vitest";
import type { LabelFacts, LabelSnapshot } from "../../src/lib/label-content";
import { advanceLatestSnapshots, batchExclusion, batchPreviewContent, batchSender, parseBatchIds, printSequentially } from "../../src/modules/labels/batch-selection";

const id = "00000000-0000-4000-8000-000000000001";
// A shipment made before T-094 (no sender address) and one with its own sender address.
const row = { id, reference: "GX1", submission_state: "issued", awb: "ABC123", is_simulated: false, sender_name: "Budi", sender_phone: "081234567890", sender_address: null, sender_area: null };
const rowWithAddress = { ...row, sender_address: "Jl. Kenanga No. 3", sender_area: "Kec. Coblong, Bandung" };

const facts: LabelFacts = {
  reference: "GX1", awb: "ABC123", courier: "JT", service: "REG", weightGrams: 1000, isCod: false, codAmountIdr: null, itemDescription: null,
  recipient: { name: "Sari", phone: "081200000003", address: "Jl. A", area: "Kota B", postalCode: "40132" },
  geraiName: "Gerai Baru", geraiWhatsapp: "081300000000", pickupAddress: "Jl. Pickup", pickupArea: "Kota P",
};
const stored: LabelSnapshot = {
  id: "s1", version: 1, size: "10x15", mask_sender: false, printed_sender_name: "Gerai Lama", printed_sender_phone: "081399999999",
  printed_sender_address: "Jl. Pickup", printed_sender_city: "Kota P", awb: "ABC123", shipment_reference: "GX1", courier: "JT", service: "REG",
  weight_grams: 1000, is_cod: false, cod_amount_idr: null, item_description: null, recipient_name: "Sari", recipient_phone: "081200000003",
  recipient_address: "Jl. A", recipient_area: "Kota B", recipient_postal_code: "40132", created_at: "2026-10-29T00:00:00Z",
};

describe("batch label selection", () => {
  it("rejects invalid or oversized selections and deduplicates in order", () => {
    expect(parseBatchIds(`${id},${id}`)).toEqual([id]);
    expect(parseBatchIds(`${id},bad`)).toBeNull();
    expect(parseBatchIds(Array(51).fill(id).join(","))).toBeNull();
  });
  it("never throws on non-string search params (repeated ids, missing, object)", () => {
    expect(parseBatchIds(["a", "b"])).toBeNull();
    expect(parseBatchIds([id, id])).toBeNull();
    expect(parseBatchIds(undefined)).toBeNull();
    expect(parseBatchIds({})).toBeNull();
    expect(parseBatchIds("")).toBeNull();
  });
  it("excludes non-issued, missing AWB and simulated records with a reason", () => {
    expect(batchExclusion(row, false, "")).toBeNull();
    expect(batchExclusion({ ...row, submission_state: "draft" }, false, "")).toContain("belum terbit");
    expect(batchExclusion({ ...row, awb: null }, false, "")).toContain("resi");
    expect(batchExclusion({ ...row, is_simulated: true }, false, "")).toContain("simulasi");
  });
  it("prints each shipment's own sender; the shared area only fills a shipment without one", () => {
    expect(batchSender(rowWithAddress, "Bogor")).toEqual({ name: "Budi", phone: "081234567890", address: "Jl. Kenanga No. 3", city: "Kec. Coblong, Bandung" });
    expect(batchExclusion(rowWithAddress, true, "")).toBeNull();
  });
  it("uses the shared city and validates stored sender fields for masking", () => {
    expect(batchSender(row, "Bandung")).toEqual({ name: "Budi", phone: "081234567890", address: "", city: "Bandung" });
    expect(batchExclusion(row, true, "")).toContain("kota");
    expect(batchExclusion({ ...row, sender_name: null }, true, "Bandung")).toContain("nama");
    expect(batchExclusion(row, true, "Bandung")).toBeNull();
  });
});

describe("batch preview matches what create_label_snapshot will print", () => {
  const unmasked = { mask: false, size: "10x15" as const, sender: batchSender(row, "") };
  it("shows the reused stored snapshot, not current gerai facts, when the choice matches", () => {
    expect(batchPreviewContent(facts, stored, unmasked).sender.name).toBe("Gerai Lama");
  });
  it("builds from current facts when nothing is stored or the size, mask or sender differ", () => {
    expect(batchPreviewContent(facts, null, unmasked).sender.name).toBe("Gerai Baru");
    expect(batchPreviewContent(facts, stored, { ...unmasked, size: "10x10" }).sender.name).toBe("Gerai Baru");
    const masked = { mask: true, size: "10x15" as const, sender: batchSender(row, "Bandung") };
    expect(batchPreviewContent(facts, stored, masked).sender.name).toBe("Budi");
    const storedMasked = { ...stored, mask_sender: true, printed_sender_name: "Budi", printed_sender_phone: "081234567890", printed_sender_city: "Bandung", printed_sender_address: null };
    expect(batchPreviewContent(facts, storedMasked, masked).sender.city).toBe("Bandung");
    expect(batchPreviewContent(facts, storedMasked, { ...masked, sender: batchSender(row, "Bogor") }).sender.city).toBe("Bogor");
  });
  it("updates the latest snapshot on print so a 10x15 -> 10x10 -> 10x15 round-trip does not revert to the page-load identity", () => {
    let latest = new Map<string, LabelSnapshot | null>([[row.id, stored]]);
    expect(batchPreviewContent(facts, latest.get(row.id) ?? null, unmasked).sender.name).toBe("Gerai Lama");
    const printed10x10: LabelSnapshot = { ...stored, id: "s2", version: 2, size: "10x10", printed_sender_name: "Gerai Baru" };
    latest = advanceLatestSnapshots(latest, [row.id], [printed10x10]);
    expect(batchPreviewContent(facts, latest.get(row.id) ?? null, { ...unmasked, size: "10x10" }).sender.name).toBe("Gerai Baru");
    // Switching back to 10x15 now compares against v2 (10x10), which does not match 10x15, so the preview builds from current facts ("Gerai Baru").
    expect(batchPreviewContent(facts, latest.get(row.id) ?? null, unmasked).sender.name).toBe("Gerai Baru");
  });
});

describe("sequential batch printing", () => {
  it("stops at the first failure, keeps what was recorded before it and names the failing reference", async () => {
    const attempted: string[] = [];
    const rows = ["GX1", "GX2", "GX3"].map((reference, i) => ({ ...row, id: `${id.slice(0, -1)}${i}`, reference }));
    const result = await printSequentially(rows, async (r) => {
      attempted.push(r.reference);
      return r.reference === "GX2" ? { ok: false, error: "gagal" } : { ok: true, snapshot: { ...stored, shipment_reference: r.reference } };
    });
    expect(attempted).toEqual(["GX1", "GX2"]);
    expect(result.snapshots.map((s) => s.shipment_reference)).toEqual(["GX1"]);
    expect(result.error).toBe("GX2: gagal");
  });
  it("returns every snapshot in selection order when all succeed", async () => {
    const result = await printSequentially([row, { ...row, reference: "GX9" }], async (r) => ({ ok: true, snapshot: { ...stored, shipment_reference: r.reference } }));
    expect(result).toEqual({ snapshots: [expect.objectContaining({ shipment_reference: "GX1" }), expect.objectContaining({ shipment_reference: "GX9" })] });
  });
});
