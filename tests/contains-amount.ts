// True when `amount` appears anywhere in `value` as a number, or inside a string as a digit run not
// adjacent to other digits ("13579", "Rp13579", "13579.00", '{"net":13579}'). Timestamps and UUIDs are
// skipped: their digits can contain a sentinel by chance (".13579+00:00" microseconds, trailing zeros
// trimmed) without being an amount.
const TIMESTAMP = /^\d{4}-\d\d-\d\d[T ]\d\d:\d\d:\d\d(\.\d+)?([+-]\d\d(:\d\d)?|Z)?$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function containsAmount(value: unknown, amount: number): boolean {
  const inString = new RegExp(`(?<![0-9])${amount}(?![0-9])`);
  const walk = (v: unknown): boolean =>
    typeof v === "number" ? v === amount
      : typeof v === "string" ? !TIMESTAMP.test(v) && !UUID.test(v) && inString.test(v)
      : Array.isArray(v) ? v.some(walk)
      : v !== null && typeof v === "object" ? Object.values(v).some(walk)
      : false;
  return walk(value);
}
