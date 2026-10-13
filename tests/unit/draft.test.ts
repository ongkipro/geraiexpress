import { describe, expect, it } from "vitest";
import { missingForQuote, normalizePhone, parseDraft } from "../../src/modules/shipments/draft";

const form = (entries: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
};

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
});
