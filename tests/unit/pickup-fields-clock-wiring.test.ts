import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The repo has no component-test setup (no jsdom), so the effect that installs the minute clock cannot be mounted
// here. This pins the one line that matters: the effect must RETURN the watcher's cleanup. A type-correct typo such
// as `useEffect(() => { watchMinuteClock(setNow); }, [])` would leak the timer and the listeners after unmount and
// typecheck cleanly, and the tests of watchMinuteClock itself (which call its returned function directly) would not
// notice.
describe("PickupFields installs the minute clock with its cleanup", () => {
  const source = readFileSync("src/modules/shipments/pickup-fields.tsx", "utf8");

  it("returns the watcher's cleanup from the effect and starts it once", () => {
    expect(source).toMatch(/useEffect\(\s*\(\)\s*=>\s*watchMinuteClock\(setNow\)\s*,\s*\[\]\s*\)/);
    expect(source.match(/watchMinuteClock\(/g)?.length).toBe(1);
  });

  it("does not render the clock on the server: the first state is null", () => {
    expect(source).toMatch(/useState<Date \| null>\(null\)/);
  });
});
