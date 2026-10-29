import { describe, expect, it } from "vitest";
import { contactSearch } from "../../src/modules/shipments/contact-search";

describe("contactSearch (intake contact filter)", () => {
  it("keeps apostrophes, quotes and colons so O'Brien matches", () => {
    expect(contactSearch("O'Brien")).toEqual({ text: "O'Brien", filter: "name.ilike.%O'Brien%,phone.ilike.%O'Brien%" });
    expect(contactSearch(`Toko "Sinar": Jaya`).text).toBe(`Toko "Sinar": Jaya`);
  });

  it("removes only what breaks the PostgREST filter grammar or acts as a wildcard", () => {
    const hostile = contactSearch("a,b(c)d%e_f*g\\h\u0000i\nj");
    expect(hostile.text).toBe("a b c d e f g h i j");
    expect(hostile.filter).toBe("name.ilike.%a b c d e f g h i j%,phone.ilike.%a b c d e f g h i j%");
    // Nothing left to filter by.
    expect(contactSearch(" ,()%_*\\ ")).toEqual({ text: "", filter: null });
    expect(contactSearch("")).toEqual({ text: "", filter: null });
  });

  it("is bounded to 60 characters", () => {
    expect(contactSearch("x".repeat(200)).text).toHaveLength(60);
  });

  it("normalizes typed phone numbers: +62, 62, dashes and spaces find the stored 0-form (and the 62-form)", () => {
    for (const typed of ["+62 812-3456-7890", "62 812 3456 7890", "0812-3456-7890", "(0812) 3456 7890", "081234567890"]) {
      const { filter } = contactSearch(typed);
      expect(filter, typed).toContain("phone.ilike.%081234567890%");
      expect(filter, typed).toContain("phone.ilike.%6281234567890%");
    }
  });

  it("does not treat a short number or a name as a phone", () => {
    expect(contactSearch("62").filter).toBe("name.ilike.%62%,phone.ilike.%62%");
    expect(contactSearch("Budi 081").filter).toBe("name.ilike.%Budi 081%,phone.ilike.%Budi 081%");
    expect(contactSearch("8123").filter).toBe("name.ilike.%8123%,phone.ilike.%8123%");
  });
});
