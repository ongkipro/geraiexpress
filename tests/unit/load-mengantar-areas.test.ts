import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
// @ts-expect-error plain ESM owner-run script without types
import { validateAreaRow, validateDataset, upsertSql } from "../../scripts/load-mengantar-areas.mjs";

const row = { id: "aaaaaaaaaaaaaaaaaaaaaaaa", province: "JAWA BARAT", city: "DEPOK", district: "TAPOS", subdistrict: "SUKATANI", postal_code: "16454" };
const dataset = { source: "read-only fixture", harvested_at: "2026-10-30", count: 1, areas: [row] };

describe("load-mengantar-areas validation", () => {
  it("accepts provider ids, empty postal codes and bounded Unicode names", () => {
    expect(validateAreaRow(row)).toEqual(row);
    expect(validateAreaRow({ ...row, postal_code: "", subdistrict: "é".repeat(160) })).toBeTruthy();
    expect(validateDataset(dataset)).toBe("mengantar-2026-10-30-1");
  });

  it.each([
    null, [], { ...row, id: "bad" }, { ...row, id: [row.id] }, { ...row, id: "A".repeat(24) }, { ...row, id: `${row.id}\n` },
    ...["province", "city", "district", "subdistrict"].flatMap((key) => [
      { ...row, [key]: "" }, { ...row, [key]: "x".repeat(161) }, { ...row, [key]: " leading" },
      { ...row, [key]: "trailing " }, { ...row, [key]: "nul\0byte" }, { ...row, [key]: null },
    ]),
    ...[12345, "1234", "123456", "12a45", "12345\n", null].map((postal_code) => ({ ...row, postal_code })),
  ])("refuses malformed row %# before SQL generation", (bad) => {
    expect(() => validateAreaRow(bad)).toThrow();
  });

  it("refuses mismatched counts, duplicate ids and malformed metadata", () => {
    for (const bad of [null, { ...dataset, count: 2 }, { ...dataset, harvested_at: "bad" },
      { ...dataset, count: 2, areas: [row, row] }, { ...dataset, source: "" }]) {
      expect(() => validateDataset(bad)).toThrow();
    }
  });

  it("quotes SQL strings, updates only changed values and never deletes", () => {
    const sql = upsertSql([{ ...row, subdistrict: "O'Brien\\Utara" }], "mengantar-2026-10-30-1");
    expect(sql).toContain("O''Brien\\\\Utara");
    expect(sql).toContain("on conflict (id) do update");
    expect(sql).toContain("is distinct from");
    expect(sql).not.toMatch(/\bdelete\b/i);
  });

  it("validates every committed harvest row and preserves verified fixture ids", () => {
    const data = JSON.parse(gunzipSync(readFileSync("data/mengantar/areas-2026-10-30.json.gz")).toString("utf8"));
    expect(validateDataset(data)).toBe("mengantar-2026-10-30-79391");
    expect(data.areas.find((a: { id: string }) => a.id === "5fc62f60f8f44b34aa4c0dcd")).toMatchObject({ subdistrict: "MELAWAI" });
    expect(data.areas.find((a: { id: string }) => a.id === "5fc63169f8f44b34aa4c2ee1")).toMatchObject({ subdistrict: "SUKATANI", district: "TAPOS" });
  });
});
