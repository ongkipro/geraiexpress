import { describe, expect, it } from "vitest";
import { logEvent, withCorrelation } from "../../src/lib/log";

// T-105 / Ops 8: one JSON line per event; inside a correlation scope every event (across awaits) carries the
// scope's server-generated id, and separate scopes get separate ids. Only the caller's bounded fields appear.
describe("structured log with a correlation id", () => {
  it("stamps every event of one scope, across awaits, and keeps scopes apart", async () => {
    const lines: string[] = [];
    const sink = (line: string) => lines.push(line);
    const run = () => withCorrelation(async () => {
      logEvent("dispatch_action", { step: "confirm", status: "recorded" }, sink);
      await new Promise((resolve) => setTimeout(resolve, 1));
      logEvent("dispatch_action", { step: "confirm", status: "recorded", outcome: "issued" }, sink);
    });
    await Promise.all([run(), run()]);
    const events = lines.map((line) => JSON.parse(line));
    const ids = [...new Set(events.map((e) => e.correlationId))];
    expect(ids).toHaveLength(2);
    for (const id of ids) {
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      expect(events.filter((e) => e.correlationId === id)).toHaveLength(2);
    }
    expect(Object.keys(events[0])).toEqual(["event", "correlationId", "step", "status"]);
  });

  it("logs no correlation id outside a scope and nothing beyond the given fields", () => {
    const lines: string[] = [];
    logEvent("cron_skipped", { task: "dispatch" }, (line) => lines.push(line));
    expect(JSON.parse(lines[0])).toEqual({ event: "cron_skipped", task: "dispatch" });
    expect(withCorrelation(() => {
      logEvent("x", {}, (line) => lines.push(line));
      return JSON.parse(lines[1]).correlationId;
    }, "fixed-id")).toBe("fixed-id");
    // The helper adds nothing from the environment: no token, URL, path or personal data unless a caller passes it.
    expect(lines.join("\n")).not.toMatch(/Bearer|https?:\/\/|@|token/i);
  });
});
