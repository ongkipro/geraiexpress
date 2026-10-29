import { describe, expect, it } from "vitest";
import {
  DEFAULT_PERIOD, NO_COURIER, ROW_BOUND, parsePeriod, periodHref, periodWindow, sharesOf, signed, summarize, wibDay, type PeriodRow,
} from "../../src/modules/dashboard/aggregate";

// 2026-10-29 10:00 WIB (03:00 UTC): today is 2026-10-29, yesterday 2026-10-28.
const NOW = new Date("2026-10-29T03:00:00Z");
const row = (created_at: string, submission_state = "draft", extra: Partial<PeriodRow> = {}): PeriodRow => ({
  created_at, submission_state, customer_charge_idr: null, is_cod: false, courier: null, ...extra,
});
const newestFirst = (rows: PeriodRow[]) => [...rows].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));

describe("WIB calendar days (UX-16)", () => {
  it("puts 00:00 WIB on the new day and 23:59:59 WIB on the previous one", () => {
    expect(wibDay("2026-10-28T17:00:00Z")).toBe("2026-10-29"); // 00:00:00 WIB
    expect(wibDay("2026-10-28T16:59:59.999Z")).toBe("2026-10-28"); // 23:59:59.999 WIB
    expect(wibDay("2026-12-31T17:00:00Z")).toBe("2027-01-01");
  });

  it("builds 7, 14 and 30 day windows that end today and start at 00:00 WIB", () => {
    for (const days of [7, 14, 30] as const) {
      const w = periodWindow(NOW, days);
      expect(w.days).toHaveLength(days);
      expect(w.days.at(-1)).toBe("2026-10-29");
      expect(w.today).toBe("2026-10-29");
      expect(w.yesterday).toBe("2026-10-28");
      expect(w.lt).toBe("2026-10-30T00:00:00+07:00");
      expect(new Set(w.days).size).toBe(days);
    }
    expect(periodWindow(NOW, 7).gte).toBe("2026-10-23T00:00:00+07:00");
    expect(periodWindow(NOW, 14).gte).toBe("2026-10-16T00:00:00+07:00");
    expect(periodWindow(NOW, 30).gte).toBe("2026-09-30T00:00:00+07:00");
  });

  it("reads the period from ?hari= and falls back to 14 days", () => {
    expect(parsePeriod("7")).toBe(7);
    expect(parsePeriod("30")).toBe(30);
    for (const raw of [undefined, "", "13", "abc", "7.0x", ["7", "30"]]) expect(parsePeriod(raw)).toBe(DEFAULT_PERIOD);
    expect(DEFAULT_PERIOD).toBe(14);
    // The Dashboard lives at "/": the default period is the bare path, the others keep the choice in the URL.
    expect(periodHref(14)).toBe("/");
    expect(periodHref(7)).toBe("/?hari=7");
    expect(periodHref(30)).toBe("/?hari=30");
  });
});

describe("summarize", () => {
  it("counts rows on both sides of WIB midnight into the right day", () => {
    const rows = newestFirst([
      row("2026-10-28T17:00:00Z", "issued"), // 00:00 WIB today
      row("2026-10-28T16:59:59Z", "issued"), // 23:59:59 WIB yesterday
      row("2026-10-28T16:59:58Z"), // yesterday
    ]);
    const s = summarize(rows, { now: NOW, periodDays: 7, sample: false });
    expect(s.today).toEqual({ created: 1, issued: 1 });
    expect(s.yesterday).toEqual({ created: 2, issued: 1 });
    expect(s.daily.at(-1)).toEqual({ day: "2026-10-29", issued: 1, other: 0, total: 1 });
    expect(s.daily.at(-2)).toEqual({ day: "2026-10-28", issued: 1, other: 1, total: 2 });
  });

  it("gives the signed change against yesterday, including a zero baseline", () => {
    const rows = newestFirst([row("2026-10-29T01:00:00Z"), row("2026-10-29T02:00:00Z"), row("2026-10-29T02:30:00Z", "issued")]);
    const s = summarize(rows, { now: NOW, periodDays: 14, sample: false });
    expect(s.yesterday).toEqual({ created: 0, issued: 0 });
    expect(s.delta).toEqual({ created: 3, issued: 1 });
    expect(signed(s.delta.created)).toBe("+3");

    const fewer = summarize(newestFirst([row("2026-10-28T03:00:00Z"), row("2026-10-28T04:00:00Z")]), { now: NOW, periodDays: 14, sample: false });
    expect(fewer.delta.created).toBe(-2);
    expect(signed(fewer.delta.created)).toBe("−2");
    expect(signed(0)).toBe("0");
    expect(signed(1500)).toBe("+1.500");
  });

  it("keeps every day of the window (zero bars) and leaves out rows outside it", () => {
    const inside = row("2026-10-16T00:00:00Z"); // 07:00 WIB on the first day of 14
    const before = row("2026-10-15T16:59:59Z"); // 23:59:59 WIB the day before the window
    const future = row("2026-10-29T17:00:00Z"); // 00:00 WIB tomorrow
    const s = summarize(newestFirst([inside, before, future]), { now: NOW, periodDays: 14, sample: false });
    expect(s.daily).toHaveLength(14);
    expect(s.daily[0]).toEqual({ day: "2026-10-16", issued: 0, other: 1, total: 1 });
    expect(s.total).toBe(1);
    expect(s.daily.reduce((a, d) => a + d.total, 0)).toBe(s.total);

    const empty = summarize([], { now: NOW, periodDays: 30, sample: false });
    expect(empty.daily).toHaveLength(30);
    expect(empty.daily.every((d) => d.total === 0)).toBe(true);
    expect(empty.total).toBe(0);
    expect(empty.peak).toBeNull();
    expect(empty.statuses).toEqual([]);
    expect(empty.couriers).toEqual([]);
  });

  it("splits status and courier shares that sum to the shown total and to 100%", () => {
    const states = ["issued", "issued", "issued", "failed", "awaiting_payment", "draft", "unknown"];
    const couriers = ["JT", "JT", "JNE", null, "SiCepat", "JT", null];
    const rows = newestFirst(states.map((state, i) => row(`2026-10-2${i}T05:00:00Z`, state, { courier: couriers[i] })));
    const s = summarize(rows, { now: NOW, periodDays: 14, sample: false });
    expect(s.total).toBe(7);
    expect(s.statuses.reduce((a, x) => a + x.count, 0)).toBe(s.total);
    expect(s.statuses.reduce((a, x) => a + x.share, 0)).toBe(100);
    expect(s.statuses[0]).toMatchObject({ state: "issued", count: 3 });
    expect(s.couriers.reduce((a, x) => a + x.count, 0)).toBe(s.total);
    expect(s.couriers.reduce((a, x) => a + x.share, 0)).toBe(100);
    expect(s.couriers[0]).toMatchObject({ code: "JT", name: "J&T Express", count: 3 });
    // "No courier yet" closes the ranking whatever its size.
    expect(s.couriers.at(-1)).toMatchObject({ code: null, name: NO_COURIER, count: 2 });
    expect(s.issued).toBe(3);
    expect(s.daily.reduce((a, d) => a + d.issued, 0)).toBe(s.issued);
  });

  it("sums only the customer charge of issued shipments and counts COD", () => {
    const rows = newestFirst([
      row("2026-10-29T01:00:00Z", "issued", { customer_charge_idr: 18000, is_cod: true }),
      row("2026-10-29T01:30:00Z", "issued", { customer_charge_idr: 22000 }),
      row("2026-10-29T02:00:00Z", "estimated", { customer_charge_idr: 99000, is_cod: true }),
    ]);
    const s = summarize(rows, { now: NOW, periodDays: 7, sample: false });
    expect(s.chargeIdr).toBe(40000);
    expect(s.codIssued).toBe(1);
  });

  it("marks the bound when more than 5,000 rows arrive and counts only the newest 5,000", () => {
    const at = Date.parse("2026-10-29T02:00:00Z");
    const rows = Array.from({ length: ROW_BOUND + 1 }, (_, i) => row(new Date(at - i * 60_000).toISOString()));
    const s = summarize(rows, { now: NOW, periodDays: 30, sample: false });
    expect(s.limited).toBe(true);
    expect(s.total).toBe(ROW_BOUND);
    const exact = summarize(rows.slice(0, ROW_BOUND), { now: NOW, periodDays: 30, sample: false });
    expect(exact.limited).toBe(false);
    expect(exact.total).toBe(ROW_BOUND);
  });

  it("carries the demo flag so every figure can be labelled contoh", () => {
    expect(summarize([], { now: NOW, periodDays: 7, sample: true }).sample).toBe(true);
    expect(summarize([], { now: NOW, periodDays: 7, sample: false }).sample).toBe(false);
  });
});

describe("sharesOf", () => {
  it("rounds by largest remainder to exactly 100", () => {
    expect(sharesOf([1, 1, 1])).toEqual([34, 33, 33]);
    expect(sharesOf([2, 1])).toEqual([67, 33]);
    expect(sharesOf([1, 0])).toEqual([100, 0]);
    expect(sharesOf([0, 0])).toEqual([0, 0]);
    expect(sharesOf([3, 3, 3, 1]).reduce((a, b) => a + b, 0)).toBe(100);
  });
});
