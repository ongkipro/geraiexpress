// PR-16: the CSV encoder (RFC 4180 quoting, UTF-8 BOM, formula-injection guard) and the export formatting
// rules (WIB ISO dates, day bounds, download name).
import { describe, expect, it } from "vitest";
import { CSV_BOM, csvCell, csvRow, neutralizeFormula, toCsv } from "../../src/lib/csv";
import { dayBounds, exportFilename, parseDay, wibIso } from "../../src/lib/export-format";

describe("formula injection guard", () => {
  it.each(["=1+1", "+62812", "-5+2", "@SUM(A1)", "\t=1", "\r=1", "=HYPERLINK(\"http://x\",\"y\")", "=cmd|' /C calc'!A0"])(
    "prefixes a single quote to %j",
    (text) => {
      expect(neutralizeFormula(text)).toBe(`'${text}`);
      // The neutralized cell never starts with a formula character in the decoded value.
      expect(csvCell(text).replace(/^"/, "")[0]).toBe("'");
    },
  );

  it.each(["Budi", "Rp 5", "a=b", "x+y", "12-3", "e@mail", " =1", "'=1", ""])("leaves %j alone", (text) => {
    expect(neutralizeFormula(text)).toBe(text);
  });

  it("guards a formula that also needs quoting, with the quote inside the quoted field", () => {
    expect(csvCell('=A1,"x"')).toBe(`"'=A1,""x"""`);
  });
});

describe("RFC 4180 quoting", () => {
  it("quotes fields with a comma, a double quote, CR or LF and doubles inner quotes", () => {
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("line1\nline2")).toBe('"line1\nline2"');
    expect(csvCell("line1\r\nline2")).toBe('"line1\r\nline2"');
    expect(csvCell("plain text")).toBe("plain text");
  });

  it("writes null and undefined as empty cells, never as zero", () => {
    expect(csvRow(["a", null, undefined, "d"])).toBe("a,,,d");
  });

  it("writes integers as plain digits and refuses anything that is not a non-negative integer", () => {
    expect(csvRow([0, 24680, 1500])).toBe("0,24680,1500");
    expect(() => csvCell(1.5)).toThrow(RangeError);
    expect(() => csvCell(-1)).toThrow(RangeError);
    expect(() => csvCell(Number.NaN)).toThrow(RangeError);
    expect(() => csvCell(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });

  it("keeps unicode, emoji and Indonesian text intact", () => {
    expect(csvCell("Toko Kopi Ibu Sri — Jl. Sudirman № 5 ☕")).toBe("Toko Kopi Ibu Sri — Jl. Sudirman № 5 ☕");
    expect(csvCell("日本語,テスト")).toBe('"日本語,テスト"');
  });
});

describe("document", () => {
  it("starts with the UTF-8 BOM, ends records with CRLF and quotes embedded newlines", () => {
    const csv = toCsv(["Nama", "Catatan"], [["Budi", "baris 1\nbaris 2"], ["=evil()", null]]);
    expect(csv.startsWith(CSV_BOM)).toBe(true);
    expect(CSV_BOM).toBe("\uFEFF");
    expect(csv).toBe(`${CSV_BOM}Nama,Catatan\r\nBudi,"baris 1\nbaris 2"\r\n'=evil(),\r\n`);
    // The BOM encodes as EF BB BF in UTF-8, which is what Excel needs to read the file as UTF-8.
    expect([...new TextEncoder().encode(csv).slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  });

  it("an empty result is still a header row", () => {
    expect(toCsv(["A", "B"], [])).toBe(`${CSV_BOM}A,B\r\n`);
  });
});

describe("export formatting", () => {
  it("renders instants as ISO 8601 in WIB (+07:00)", () => {
    expect(wibIso("2026-10-28T07:03:11.512Z")).toBe("2026-10-28T14:03:11+07:00");
    expect(wibIso("2026-10-28T17:30:00Z")).toBe("2026-10-29T00:30:00+07:00");
    expect(wibIso(null)).toBe("");
    expect(wibIso("not a date")).toBe("");
  });

  it("accepts real calendar days only", () => {
    expect(parseDay("2026-10-28")).toBe("2026-10-28");
    expect(parseDay("2026-02-31")).toBe("");
    expect(parseDay("28-10-2026")).toBe("");
    expect(parseDay("")).toBe("");
    expect(parseDay(null)).toBe("");
  });

  it("turns inclusive WIB days into a half-open instant range", () => {
    expect(dayBounds("2026-10-28", "2026-10-28")).toEqual({ gte: "2026-10-28T00:00:00+07:00", lt: "2026-10-29T00:00:00+07:00" });
    expect(dayBounds("", "2026-12-31")).toEqual({ lt: "2027-01-01T00:00:00+07:00" });
    expect(dayBounds("2026-10-01", "")).toEqual({ gte: "2026-10-01T00:00:00+07:00" });
    expect(dayBounds("", "")).toEqual({});
  });

  it("names the download pengiriman-<slug>-<yyyymmdd>.csv with the WIB date and a header-safe slug", () => {
    expect(exportFilename("gerai-uji-a", new Date("2026-10-28T18:00:00Z"))).toBe("pengiriman-gerai-uji-a-20261029.csv");
    expect(exportFilename('a"b\r\nc/..', new Date("2026-10-28T03:00:00Z"))).toBe("pengiriman-abc-20261028.csv");
    expect(exportFilename("", new Date("2026-10-28T03:00:00Z"))).toBe("pengiriman-gerai-20261028.csv");
  });
});
