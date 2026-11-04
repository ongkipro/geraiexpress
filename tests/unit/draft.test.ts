import { describe, expect, it } from "vitest";
import { liveRecipientErrors, missingForQuote, normalizePhone, parseDraft } from "../../src/modules/shipments/draft";

const form = (entries: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
};

describe("sender address (T-094)", () => {
  const base = { sender_name: "Budi", sender_phone: "081234567890" };
  it("is optional and stored as null when empty", () => {
    const { update, errors } = parseDraft(form(base));
    expect(errors).toEqual({});
    expect(update).toMatchObject({ sender_address: null, sender_area: null, sender_postal_code: null });
  });
  it("collapses whitespace and keeps the printed limits: street 5-120, area 3-40, postal 5 digits", () => {
    const ok = parseDraft(form({ ...base, sender_address: "  Jl. Kenanga\n  No. 3 ", sender_area: "Kec. Coblong", sender_postal_code: "40132" }));
    expect(ok.errors).toEqual({});
    expect(ok.update).toMatchObject({ sender_address: "Jl. Kenanga No. 3", sender_area: "Kec. Coblong", sender_postal_code: "40132" });
    const bad = parseDraft(form({ ...base, sender_address: "x".repeat(121), sender_area: "AB", sender_postal_code: "4013" }));
    expect(Object.keys(bad.errors).sort()).toEqual(["sender_address", "sender_area", "sender_postal_code"]);
    expect(parseDraft(form({ ...base, sender_address: "Jl" })).errors.sender_address).toContain("5–120");
  });
  it("is not required for a quote (missingForQuote is unchanged)", () => {
    const { update } = parseDraft(form({ ...base, recipient_name: "Sari", recipient_phone: "081299998888", recipient_address: "Jl. Mawar No. 1",
      recipient_area: "Kota Bandung", item_description: "Buku", weight_grams: "1500" }));
    expect(missingForQuote(update)).toEqual([]);
  });
});

describe("draft parsing", () => {
  it("normalizes Indonesian phone formats", () => {
    expect(normalizePhone("+62 812-3456-7890")).toBe("081234567890");
    expect(normalizePhone("0812 3456 7890")).toBe("081234567890");
  });

  it("accepts a complete draft and converts numbers exactly", () => {
    const { update, errors } = parseDraft(form({
      sender_name: "Budi", sender_phone: "081234567890", recipient_name: "Sari", recipient_phone: "+6281299998888",
      recipient_address: "Jl. Mawar No. 1", recipient_area: "Kota Bandung", recipient_postal_code: "40111",
      item_description: "Buku", weight_grams: "1500", goods_value_idr: "1.250.000",
    }));
    expect(errors).toEqual({});
    expect(update.weight_grams).toBe(1500);
    expect(update.goods_value_idr).toBe(1250000);
    expect(update.recipient_phone).toBe("081299998888");
    expect(missingForQuote(update)).toEqual([]);
  });

  it("keeps blanks as unknown (null), not zero", () => {
    const { update } = parseDraft(form({ weight_grams: "", goods_value_idr: "" }));
    expect(update.weight_grams).toBeNull();
    expect(update.goods_value_idr).toBeNull();
  });

  it("reports field errors for invalid values and missing quote fields", () => {
    const { errors, update } = parseDraft(form({
      sender_phone: "12", weight_grams: "0", recipient_postal_code: "4011", length_cm: "1.5",
    }));
    expect(Object.keys(errors).sort()).toEqual(["length_cm", "recipient_postal_code", "sender_phone", "weight_grams"]);
    expect(missingForQuote(update)).toContain("recipient_name");
  });

  it("enforces 100/101 name and 300/301 address boundaries only for live quote/confirmation", () => {
    const exact = { recipient_name: "N".repeat(100), recipient_address: "A".repeat(300), recipient_phone: "+62 812-3456-7890" };
    expect(parseDraft(form(exact), true).errors).toEqual({});
    const over = { ...exact, recipient_name: "N".repeat(101), recipient_address: "A".repeat(301) };
    const live = parseDraft(form(over), true);
    expect(live.errors).toEqual({
      recipient_name: "Nama penerima untuk Mengantar maksimal 100 karakter.",
      recipient_address: "Alamat penerima untuk Mengantar maksimal 300 karakter.",
    });
    expect(liveRecipientErrors(parseDraft(form(over)).update)).toEqual(live.errors);
    expect(parseDraft(form(over)).errors).toEqual({}); // partial draft/demo contract is unchanged
  });

  it.each(["12345678", "081234567", "1234567890", "+441234567890"])(
    "rejects the draft-accepted phone %s before live quote or confirmation",
    (phone) => {
      const input = form({ recipient_phone: phone });
      expect(parseDraft(input).errors).toEqual({});
      expect(parseDraft(input, true).errors.recipient_phone).toContain("awalan 0, 62, atau +62");
      expect(liveRecipientErrors(parseDraft(input).update).recipient_phone).toBeDefined();
    },
  );

  it.each(["081234567890", "6281234567890", "+6281234567890", "+62 812-3456-7890"])(
    "accepts provider-normalizable phone %s",
    (phone) => expect(parseDraft(form({ recipient_phone: phone }), true).errors).toEqual({}),
  );
});

// T-043: the handover choice. The clock is passed in, so the lead-time rule is exact.
describe("handover choice (pickup)", () => {
  const NOW = new Date("2026-02-02T03:00:00Z"); // 10:00 WIB
  const pickup = (over: Record<string, string> = {}) =>
    form({ handover: "pickup", pickup_date: "2026-02-03", pickup_slot_hour: "13", pickup_volume: "volumeMotor", ...over });

  it("defaults to drop-off with no pickup data, and clears stale pickup values", () => {
    const { update, values, errors } = parseDraft(form({}), false, NOW);
    expect(errors).toEqual({});
    expect(update).toMatchObject({ handover: "dropoff", pickup_date: null, pickup_slot_hour: null, pickup_volume: null, pickup_note: null });
    // Switching back to drop-off after choosing a slot drops the slot (the database requires it).
    const back = parseDraft(form({ handover: "dropoff", pickup_date: "2026-02-03", pickup_slot_hour: "13", pickup_note: "x" }), false, NOW);
    expect(back.update).toMatchObject({ handover: "dropoff", pickup_date: null, pickup_slot_hour: null, pickup_note: null });
    expect(back.values).toMatchObject({ pickup_date: "", pickup_slot_hour: "", pickup_note: "" });
    expect(values.handover).toBe("dropoff");
    // An unknown handover value is drop-off, never pickup.
    expect(parseDraft(form({ handover: "courier" }), false, NOW).update.handover).toBe("dropoff");
  });

  it("accepts a pickup slot with its date, hour, volume and note", () => {
    const { update, errors } = parseDraft(pickup({ pickup_note: "Titip di satpam" }), false, NOW);
    expect(errors).toEqual({});
    expect(update).toMatchObject({ handover: "pickup", pickup_date: "2026-02-03", pickup_slot_hour: 13, pickup_volume: "volumeMotor", pickup_note: "Titip di satpam" });
  });

  it("defaults the volume class when the form sends none", () => {
    const { update, errors } = parseDraft(pickup({ pickup_volume: "" }), false, NOW);
    expect(errors).toEqual({});
    expect(update.pickup_volume).toBe("volumeMotor");
  });

  it("refuses a pickup in the past or inside the 90-minute lead time with Bahasa field errors", () => {
    expect(parseDraft(pickup({ pickup_date: "2026-02-01" }), false, NOW).errors.pickup_slot_hour).toContain("90 menit");
    // 10:00 now -> 11:30 is the earliest start, so the 11:00 hour is too soon and 12:00 is fine.
    expect(parseDraft(pickup({ pickup_date: "2026-02-02", pickup_slot_hour: "11" }), false, NOW).errors.pickup_slot_hour).toContain("90 menit");
    expect(parseDraft(pickup({ pickup_date: "2026-02-02", pickup_slot_hour: "12" }), false, NOW).errors).toEqual({});
  });

  it("refuses missing or impossible slots, hours outside 9-18, far dates and a long note", () => {
    expect(parseDraft(pickup({ pickup_date: "" }), false, NOW).errors.pickup_date).toBe("Pilih tanggal jemput.");
    expect(parseDraft(pickup({ pickup_slot_hour: "" }), false, NOW).errors.pickup_slot_hour).toBe("Pilih jam jemput.");
    expect(parseDraft(pickup({ pickup_slot_hour: "8" }), false, NOW).errors.pickup_slot_hour).toContain("09.00 dan 18.00");
    expect(parseDraft(pickup({ pickup_slot_hour: "19" }), false, NOW).errors.pickup_slot_hour).toContain("09.00 dan 18.00");
    expect(parseDraft(pickup({ pickup_slot_hour: "13.5" }), false, NOW).errors.pickup_slot_hour).toBe("Pilih jam jemput.");
    expect(parseDraft(pickup({ pickup_date: "2026-02-30" }), false, NOW).errors.pickup_date).toBe("Pilih tanggal jemput.");
    expect(parseDraft(pickup({ pickup_date: "2026-04-01" }), false, NOW).errors.pickup_date).toContain("maksimal");
    expect(parseDraft(pickup({ pickup_volume: "volumeBus" }), false, NOW).errors.pickup_volume).toBeDefined();
    expect(parseDraft(pickup({ pickup_note: "x".repeat(201) }), false, NOW).errors.pickup_note).toBeDefined();
  });

  it("never changes what quoting needs: pickup does not add a required field", () => {
    const { update } = parseDraft(pickup(), false, NOW);
    expect(missingForQuote(update)).toEqual(missingForQuote(parseDraft(form({}), false, NOW).update));
  });
});
