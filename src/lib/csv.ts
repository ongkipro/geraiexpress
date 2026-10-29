// CSV encoder for operational exports (PR-16): RFC 4180 quoting with CRLF record separators, a UTF-8
// byte-order mark so Excel reads Indonesian text correctly, and a guard against spreadsheet formula
// injection (OWASP "CSV Injection"). Pure functions, no I/O.

export const CSV_BOM = "\uFEFF";
export const CSV_EOL = "\r\n";

// A text cell starting with one of these is read as a formula (or a DDE command) by spreadsheet
// programs: = + - @, a tab and a carriage return.
const FORMULA_START = /^[=+\-@\t\r]/;

export type CsvCell = string | number | null | undefined;

// Neutralizes one text value: a single quote before a formula-looking start makes the cell plain text.
export function neutralizeFormula(text: string): string {
  return FORMULA_START.test(text) ? `'${text}` : text;
}

// Encodes one cell. null and undefined are an empty cell (an unknown value is never written as 0).
// A number must be a finite integer and is written as plain digits (rupiah and grams are integers); it is
// not formula-guarded because digits cannot start a formula, and a negative number is refused outright.
// A string is formula-guarded, then quoted when it holds a comma, a quote, CR or LF.
export function csvCell(value: CsvCell): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) throw new RangeError("CSV numbers must be non-negative integers");
    return String(value);
  }
  const text = neutralizeFormula(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export const csvRow = (cells: readonly CsvCell[]): string => cells.map(csvCell).join(",");

// A whole document: BOM, the header row, then one CRLF-terminated record per row.
export function toCsv(header: readonly string[], rows: Iterable<readonly CsvCell[]>): string {
  let out = CSV_BOM + csvRow(header) + CSV_EOL;
  for (const row of rows) out += csvRow(row) + CSV_EOL;
  return out;
}
