// T-091: a datetime-local value read as WIB (UTC+7, no DST). Blank = now. Malformed = null (named refusal).
export function wibInstant(value: string, now: Date = new Date()): string | null {
  const text = value.trim();
  if (text === "") return now.toISOString();
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(text);
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  if (mi > 59) return null;
  const ms = Date.UTC(y, mo - 1, d, h - 7, mi);
  const check = new Date(ms + 7 * 3600_000);
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d || check.getUTCHours() !== h) return null;
  return new Date(ms).toISOString();
}
