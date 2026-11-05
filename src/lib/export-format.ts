// Formatting rules of the operational CSV export (PR-16) as pure functions: dates are ISO 8601 in the
// Western Indonesia Time offset (+07:00), the day filters are WIB calendar days, and the download name
// carries the tenant slug and the WIB date.

const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;

// "2026-10-28T07:03:11.512Z" -> "2026-10-28T14:03:11+07:00". Unparseable or missing input is empty.
export function wibIso(iso: string | null | undefined): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  return `${new Date(t + WIB_OFFSET_MS).toISOString().slice(0, 19)}+07:00`;
}

// A WIB calendar day typed as yyyy-mm-dd; anything else (including 2026-02-31) is not a filter.
export function parseDay(value: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((value ?? "").trim());
  if (!m) return "";
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const probe = new Date(Date.UTC(y, mo - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === mo - 1 && probe.getUTCDate() === d ? m[0] : "";
}

// Inclusive WIB days to the half-open instant range the database filters on: from 00:00 of `from` up to
// (excluding) 00:00 of the day after `to`.
export function dayBounds(from: string, to: string): { gte?: string; lt?: string } {
  const out: { gte?: string; lt?: string } = {};
  if (from) out.gte = `${from}T00:00:00+07:00`;
  if (to) {
    const [y, m, d] = to.split("-").map(Number);
    out.lt = `${new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10)}T00:00:00+07:00`;
  }
  return out;
}

// <kind>-<slug>-<yyyymmdd>.csv with the WIB date of the export (kind "pengiriman" for the shipment list,
// "laporan-pilot" for the T-087 pilot report). The slug is already a restricted identifier; it is
// filtered again here so no header-unsafe character can reach Content-Disposition.
export type ExportKind = "pengiriman" | "laporan-pilot";
export function exportFilename(slug: string, now: Date, kind: ExportKind = "pengiriman"): string {
  const safe = slug.toLowerCase().replace(/[^a-z0-9-]/g, "") || "gerai";
  const day = new Date(now.getTime() + WIB_OFFSET_MS).toISOString().slice(0, 10).replaceAll("-", "");
  return `${kind}-${safe}-${day}.csv`;
}

// T-105: the CSV routes audit an export on GET, so a cross-site navigation by a signed-in admin (SameSite=Lax
// sends the cookie) must not trigger one. Only a same-origin request or a direct one (typed URL, bookmark:
// "none") passes. A missing header passes too: every supported browser sends Sec-Fetch-Site on navigations,
// so a request without it is not a browser carried across sites. Checked before any database call.
export function exportFetchAllowed(headers: Headers): boolean {
  const site = headers.get("sec-fetch-site");
  return site === null || site === "same-origin" || site === "none";
}
