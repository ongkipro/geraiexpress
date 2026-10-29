import type { Db } from "../../src/lib/db/client";
import { describe, expect, it } from "vitest";
import { EXPORT_ROW_CAP, fetchExportRows, keysetClause, parseShipmentFilters } from "../../src/modules/exports/shipments-export";

type Row = { id: string; created_at: string; reference: string; submission_state: string; payment_state: string; awb: null; recipient_name: string; recipient_phone: null; recipient_area: null; weight_grams: null; goods_value_idr: null; customer_charge_idr: null; is_cod: false; cod_amount_idr: null; quote: null; labels: null };

const row = (n: number): Row => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  // Two rows share every created_at second so the id tie-break matters.
  created_at: new Date(Date.UTC(2026, 9, 1) + Math.floor(n / 2) * 1000).toISOString().replace("Z", "000+00:00"),
  reference: `GX-${n}`, submission_state: "draft", payment_state: "not_applicable", awb: null, recipient_name: "R", recipient_phone: null,
  recipient_area: null, weight_grams: null, goods_value_idr: null, customer_charge_idr: null, is_cod: false, cod_amount_idr: null, quote: null, labels: null,
});
const newestFirst = (a: Row, b: Row) => (a.created_at === b.created_at ? (a.id < b.id ? 1 : -1) : a.created_at < b.created_at ? 1 : -1);

// A minimal PostgREST stand-in: it honours order, limit and the keyset clause, and lets the test add a
// row after the first page was served (a draft created while the export runs).
function fakeClient(table: Row[], afterFirstPage: () => void) {
  let served = 0;
  const calls: { limit: number; keyset: string | null }[] = [];
  const client = {
    from: () => {
      let limit = Infinity;
      let keyset: string | null = null;
      const q = {
        select: () => q, eq: () => q, gte: () => q, lt: () => q, order: () => q,
        limit: (n: number) => { limit = n; return q; },
        or: (clause: string) => { keyset = clause; return q; },
        returns: async () => {
          let rows = [...table].sort(newestFirst);
          if (keyset) {
            const m = /^created_at\.lt\."([^"]+)",and\(created_at\.eq\."[^"]+",id\.lt\."([^"]+)"\)$/.exec(keyset)!;
            rows = rows.filter((r) => r.created_at < m[1] || (r.created_at === m[1] && r.id < m[2]));
          }
          calls.push({ limit, keyset });
          const page = rows.slice(0, limit);
          if (++served === 1) afterFirstPage();
          return { data: page, error: null };
        },
      };
      return q;
    },
  };
  return { client: client as unknown as Db, calls };
}

describe("fetchExportRows keyset paging", () => {
  it("builds a quoted (created_at, id) keyset clause", () => {
    expect(keysetClause({ created_at: "2026-10-01T00:00:00.000000+00:00", id: "abc" }))
      .toBe('created_at.lt."2026-10-01T00:00:00.000000+00:00",and(created_at.eq."2026-10-01T00:00:00.000000+00:00",id.lt."abc")');
  });

  it("a row created while the export runs neither repeats nor drops a row", async () => {
    const table = Array.from({ length: 2500 }, (_, i) => row(i));
    const { client, calls } = fakeClient(table, () => table.push(row(9999))); // newest of all
    const result = await fetchExportRows(client, "t", parseShipmentFilters({}));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const refs = result.rows.map((r) => r[0] as string);
    expect(refs).toHaveLength(2500); // the late draft is after the snapshot the first page defined
    expect(new Set(refs).size).toBe(2500); // no duplicates
    expect(refs).not.toContain("GX-9999");
    expect(calls.map((c) => c.limit)).toEqual([1000, 1000, 1000]);
    expect(calls[0].keyset).toBeNull();
    expect(calls[1].keyset).not.toBeNull();
  });

  it("reads one row past the cap to report truncation and stops there", async () => {
    const table = Array.from({ length: EXPORT_ROW_CAP + 5 }, (_, i) => row(i));
    const { client, calls } = fakeClient(table, () => {});
    const result = await fetchExportRows(client, "t", parseShipmentFilters({}));
    expect(result).toMatchObject({ ok: true, truncated: true });
    if (result.ok) expect(result.rows).toHaveLength(EXPORT_ROW_CAP);
    expect(calls.reduce((n, c) => n + c.limit, 0)).toBe(EXPORT_ROW_CAP + 1);
  });
});
