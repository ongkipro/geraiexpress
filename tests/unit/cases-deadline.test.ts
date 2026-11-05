// T-086 / DATA-15 / UX-20 item 3: the claim filing deadline per rule unit, and NULL when unknown.
// The SQL mirror (private.claim_deadline) is checked against the same cases in tests/db/cases.test.ts.
import { describe, expect, it } from "vitest";
import {
  calendarDaysBetween, claimDeadline, deadlineStatus, ruleFor, workingDaysBetween, type ClaimRule,
} from "../../src/modules/cases/deadline";

const SOURCE = "https://help.mengantar.com/id/articles/8140017-ketentuan-batas-waktu-pengajuan-klaim";
const rule = (over: Partial<ClaimRule>): ClaimRule => ({
  id: "r", courier: "SiCepat", case_type: null, region: null, window_value: 14, window_unit: "days", anchor: "last_status",
  region_note: null, source_url: SOURCE, source_updated_at: "2026-09-18", effective_at: "2026-09-18T00:00:00Z", ...over,
});
// The seed of 20261105170000_return_claim_cases.sql, as the UI reads it.
const SEED: ClaimRule[] = [
  rule({ id: "jne-java", courier: "JNE", region: "java_sumatra_bali_ntb", window_value: 45, window_unit: "working_days", anchor: null }),
  rule({ id: "jne-other", courier: "JNE", region: "other", window_value: 60, window_unit: "working_days", anchor: null }),
  rule({ id: "sicepat", courier: "SiCepat" }),
  rule({ id: "idx", courier: "iDexpress" }),
  rule({ id: "spx", courier: "spx", anchor: "rts" }),
  rule({ id: "jt", courier: "JT", window_value: 30, anchor: null }),
  rule({ id: "idx-lost", courier: "iDexpress", case_type: "lost", window_value: 72, window_unit: "hours", anchor: null }),
  rule({ id: "jt-lost", courier: "JT", case_type: "lost", window_value: 72, window_unit: "hours", anchor: null }),
];

describe("claimDeadline", () => {
  it("adds hours exactly (the 3x24 h lost-claim window)", () => {
    expect(claimDeadline("2026-11-05T03:15:00.000Z", 72, "hours")).toBe("2026-11-08T03:15:00.000Z");
  });

  it("adds calendar days exactly, weekends included", () => {
    expect(claimDeadline("2026-11-06T10:00:00.000Z", 14, "days")).toBe("2026-11-20T10:00:00.000Z");
    expect(claimDeadline("2026-12-25T00:00:00.000Z", 1, "days")).toBe("2026-12-26T00:00:00.000Z");
  });

  it("counts working days on the WIB calendar, skipping Saturday and Sunday only", () => {
    // Friday 2026-11-06 10:00 WIB (03:00Z) + 1 working day = Monday 2026-11-09 10:00 WIB.
    expect(claimDeadline("2026-11-06T03:00:00.000Z", 1, "working_days")).toBe("2026-11-09T03:00:00.000Z");
    // Monday + 5 working days = next Monday.
    expect(claimDeadline("2026-11-02T03:00:00.000Z", 5, "working_days")).toBe("2026-11-09T03:00:00.000Z");
    // A Saturday anchor counts from Monday: Saturday + 1 working day = Monday.
    expect(claimDeadline("2026-11-07T03:00:00.000Z", 1, "working_days")).toBe("2026-11-09T03:00:00.000Z");
    // The WIB day decides the weekday: Friday 23:30 UTC is already Saturday 06:30 WIB, so one working
    // day later is Monday 06:30 WIB (Sunday 23:30 UTC), not Monday in UTC.
    expect(claimDeadline("2026-11-06T23:30:00.000Z", 1, "working_days")).toBe("2026-11-08T23:30:00.000Z");
    // JNE 45 working days = 9 weeks from a Monday; public holidays are not excluded (no calendar).
    expect(claimDeadline("2026-11-02T03:00:00.000Z", 45, "working_days")).toBe("2027-01-04T03:00:00.000Z");
    expect(claimDeadline("2026-11-02T03:00:00.000Z", 60, "working_days")).toBe("2027-01-25T03:00:00.000Z");
  });

  it("is null when the anchor, value or unit is unknown, never a default", () => {
    expect(claimDeadline(null, 14, "days")).toBeNull();
    expect(claimDeadline("not-a-date", 14, "days")).toBeNull();
    expect(claimDeadline("2026-11-02T03:00:00.000Z", null, "days")).toBeNull();
    expect(claimDeadline("2026-11-02T03:00:00.000Z", 0, "days")).toBeNull();
    expect(claimDeadline("2026-11-02T03:00:00.000Z", 14, null)).toBeNull();
  });
});

describe("ruleFor", () => {
  it("picks the JNE window by region and none without a region", () => {
    expect(ruleFor(SEED, "JNE", "damaged", "java_sumatra_bali_ntb")?.window_value).toBe(45);
    expect(ruleFor(SEED, "JNE", "damaged", "other")?.window_value).toBe(60);
    expect(ruleFor(SEED, "JNE", "damaged", null)).toBeNull();
  });

  it("prefers the lost-claim 3x24 h rule for lost iDexpress and J&T cases", () => {
    expect(ruleFor(SEED, "iDexpress", "lost", null)?.id).toBe("idx-lost");
    expect(ruleFor(SEED, "JT", "lost", null)?.id).toBe("jt-lost");
    expect(ruleFor(SEED, "iDexpress", "damaged", null)?.id).toBe("idx");
    expect(ruleFor(SEED, "SiCepat", "lost", null)?.id).toBe("sicepat");
  });

  it("returns null for an unknown courier or a missing courier", () => {
    expect(ruleFor(SEED, "ninja", "lost", null)).toBeNull();
    expect(ruleFor(SEED, null, "lost", null)).toBeNull();
  });
});

describe("deadlineStatus", () => {
  const now = new Date("2026-11-15T03:00:00.000Z");
  it("names each unknown separately", () => {
    expect(deadlineStatus({ rule: null, anchorAt: null, deadlineAt: null, now }).kind).toBe("no_rule");
    expect(deadlineStatus({ rule: SEED[5], anchorAt: "2026-11-01T00:00:00Z", deadlineAt: null, now }).kind).toBe("no_anchor_event");
    expect(deadlineStatus({ rule: SEED[2], anchorAt: null, deadlineAt: null, now }).kind).toBe("no_anchor");
  });

  it("warns at 80% of the window and marks an overdue deadline", () => {
    const anchor = "2026-11-01T03:00:00.000Z", deadline = claimDeadline(anchor, 14, "days")!;
    const at = (iso: string) => deadlineStatus({ rule: SEED[2], anchorAt: anchor, deadlineAt: deadline, now: new Date(iso) });
    expect(at("2026-11-12T00:00:00.000Z")).toMatchObject({ kind: "known", warning: false, overdue: false });
    expect(at("2026-11-12T08:00:00.000Z")).toMatchObject({ kind: "known", warning: true, overdue: false });
    expect(at("2026-11-15T03:00:00.000Z")).toMatchObject({ kind: "known", warning: false, overdue: true });
  });
});

describe("age helpers", () => {
  it("counts working days and calendar days since the anchor", () => {
    expect(workingDaysBetween("2026-11-06T03:00:00.000Z", "2026-11-10T03:00:00.000Z")).toBe(2);
    expect(calendarDaysBetween("2026-11-06T03:00:00.000Z", "2026-11-10T03:00:00.000Z")).toBe(4);
    expect(workingDaysBetween("2026-11-10T03:00:00.000Z", "2026-11-06T03:00:00.000Z")).toBe(0);
  });
});
