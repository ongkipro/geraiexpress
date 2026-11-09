// T-043: the effective pickup lead time the application uses (the setting, read through
// public.pickup_lead_minutes()); any failure falls back to the documented default.
import { describe, expect, it } from "vitest";
import { PICKUP_LEAD_MINUTES } from "../../src/lib/mengantar/pickup";
import { pickupLeadMinutes } from "../../src/lib/mengantar/pickup-lead";

const answer = (data: unknown, error: unknown = null) => () => Promise.resolve({ data, error });

describe("pickupLeadMinutes", () => {
  it("returns the setting when the database answers a positive whole number", async () => {
    for (const minutes of [1, 90, 120, 180, 525600]) expect(await pickupLeadMinutes(answer(minutes))).toBe(minutes);
  });

  it("falls back to the default on an error result", async () => {
    expect(await pickupLeadMinutes(answer(180, { message: "permission denied" }))).toBe(PICKUP_LEAD_MINUTES);
  });

  it("falls back to the default when the call throws or rejects", async () => {
    expect(await pickupLeadMinutes(() => { throw new Error("network"); })).toBe(PICKUP_LEAD_MINUTES);
    expect(await pickupLeadMinutes(() => Promise.reject(new Error("timeout")))).toBe(PICKUP_LEAD_MINUTES);
  });

  it.each([NaN, 0, -5, 1.5, Infinity, "180", null, undefined, true, [], {}])("falls back to the default for the answer %j", async (value) => {
    expect(await pickupLeadMinutes(answer(value))).toBe(PICKUP_LEAD_MINUTES);
  });
});
