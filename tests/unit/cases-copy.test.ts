// T-086 / UX-20 item 6: the case screens never promise compensation. Every fixed text (copy module,
// error messages, and the literal strings in the case components and /kasus pages) is checked against
// the forbidden promise words, and no fixed text carries a rupiah amount: an amount appears only as
// the recorded decision of a closed case (decided_amount_idr), never in copy.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CASE_COPY, CASE_ERROR_TEXTS, CASE_STATE_LABEL, CASE_TYPE_LABEL, CLAIM_TYPE_LABEL, DECIDED_BY_LABEL,
  FORBIDDEN_PROMISE_WORDS, OUTCOME_LABEL, REGION_LABEL, RUPIAH_AMOUNT,
} from "../../src/modules/cases/copy";

const texts = (value: unknown): string[] => typeof value === "string" ? [value]
  : Array.isArray(value) ? value.flatMap(texts)
  : value && typeof value === "object" ? Object.values(value).flatMap(texts) : [];

const COPY = [CASE_COPY, CASE_ERROR_TEXTS, CASE_STATE_LABEL, CASE_TYPE_LABEL, CLAIM_TYPE_LABEL, DECIDED_BY_LABEL, OUTCOME_LABEL, REGION_LABEL].flatMap(texts);

// Component and page sources whose JSX/string literals reach staff. copy.ts itself is checked through
// its values above (its source necessarily contains the forbidden list).
const SOURCES = [
  ...readdirSync("src/modules/cases").filter((f) => f.endsWith(".tsx") || f === "actions.ts").map((f) => join("src/modules/cases", f)),
  "src/app/(workspace)/kasus/page.tsx",
  "src/app/(workspace)/kasus/[id]/page.tsx",
  "src/modules/dashboard/case-attention.tsx",
];
const sourceText = (file: string) => readFileSync(file, "utf8").replace(/^\s*\/\/.*$/gm, "");

describe("case copy (UX-20 item 6)", () => {
  it("states that the compensation decision belongs to the courier or Mengantar", () => {
    expect(CASE_COPY.decisionNote).toBe("Keputusan ganti rugi ada pada kurir atau Mengantar.");
    for (const file of ["src/modules/cases/case-panel.tsx", "src/modules/cases/case-dialog.tsx", "src/modules/cases/close-case-dialog.tsx"]) {
      expect(sourceText(file), file).toContain("CASE_COPY.decisionNote");
    }
  });

  it("contains no promise word in any case text, button or message", () => {
    expect(COPY.length).toBeGreaterThan(60);
    for (const text of COPY) for (const word of FORBIDDEN_PROMISE_WORDS) expect(text, `${word} in "${text}"`).not.toMatch(word);
    for (const file of SOURCES) for (const word of FORBIDDEN_PROMISE_WORDS) expect(sourceText(file), `${word} in ${file}`).not.toMatch(word);
  });

  it("the forbidden list catches the UX-20 examples (control)", () => {
    for (const sample of ["Ongkir dijamin kembali", "Barang pasti diganti", "Garansi 100% uang kembali"]) {
      expect(FORBIDDEN_PROMISE_WORDS.some((word) => word.test(sample)), sample).toBe(true);
    }
    expect(RUPIAH_AMOUNT.test("Ganti rugi Rp 50.000")).toBe(true);
  });

  it("shows no amount before an outcome: no rupiah figure in fixed copy or case sources", () => {
    for (const text of COPY) expect(text, text).not.toMatch(RUPIAH_AMOUNT);
    for (const file of SOURCES) expect(sourceText(file), file).not.toMatch(RUPIAH_AMOUNT);
    // The decided amount is rendered only inside the closed-case outcome block.
    const panel = sourceText("src/modules/cases/case-panel.tsx");
    const amountAt = panel.indexOf("decided_amount_idr");
    expect(amountAt).toBeGreaterThan(panel.indexOf("{closed ? ("));
    expect(amountAt).toBeGreaterThan(panel.indexOf('record.outcome === "compensated"'));
  });

  it("names the 14-day processing ceiling as Mengantar information, and lists the exclusions", () => {
    expect(CASE_COPY.processingInfo).toMatch(/paling lama 14 hari/);
    expect(CASE_COPY.processingInfo).toMatch(/bukan janji GeraiExpress/);
    expect(CASE_COPY.exclusions).toEqual([
      "Kerusakan yang dilaporkan lebih dari 3 hari setelah paket diterima",
      "Tanpa video unboxing",
      "Cairan lebih dari 100 ml",
      "Tanaman hidup",
    ]);
    expect(CASE_COPY.workingDaysNote).toMatch(/hari libur nasional belum diperhitungkan/);
  });

  it("offers the UX-20 case types and outcomes in Bahasa Indonesia", () => {
    expect(Object.values(CASE_TYPE_LABEL)).toEqual(["Hilang", "Rusak", "Terlambat", "Retur", "Lainnya"]);
    expect(Object.values(OUTCOME_LABEL)).toEqual(["Diganti", "Ditolak", "Retur diterima", "Lainnya"]);
    expect(CASE_COPY.deadlineUnknown).toBe("Tenggat tidak diketahui");
  });
});
