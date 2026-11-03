import { describe, expect, it } from "vitest";
import { wibInstant } from "../../src/lib/wib";

describe("wibInstant (T-091 effective time)", () => {
  it("reads a datetime-local value as WIB", () => {
    expect(wibInstant("2026-11-04T09:30")).toBe("2026-11-04T02:30:00.000Z");
    expect(wibInstant("2026-11-04T03:00")).toBe("2026-11-03T20:00:00.000Z");
  });
  it("uses now for a blank value", () => {
    const now = new Date("2026-11-03T10:00:00Z");
    expect(wibInstant("  ", now)).toBe("2026-11-03T10:00:00.000Z");
  });
  it("refuses malformed or impossible values instead of throwing", () => {
    for (const bad of ["invalid", "2026-11-04", "2026-13-01T10:00", "2026-02-30T10:00", "2026-11-04T25:00", "2026-11-04T10:60", "2026-11-04T09:30:00Z"]) {
      expect(wibInstant(bad), bad).toBeNull();
    }
  });
});
