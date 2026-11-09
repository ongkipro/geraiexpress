// T-043 review fix: the pickup hints' clock. The repository has no DOM component-test setup (no jsdom or
// testing-library), so the clock is a plain function with an injectable environment and is tested here with
// fake timers; PickupFields only passes its state setter to it. The tests compose it with the cut-off warning
// the way the component does, across a cut-off minute and across midnight WIB.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { msToNextMinute, watchMinuteClock, type MinuteClockEnvironment } from "../../src/lib/minute-clock";
import { pickupCutoffWarning } from "../../src/lib/mengantar/pickup-cutoffs";
import { wibDate } from "../../src/lib/mengantar/pickup";

// WIB wall clock as an instant (2026-02-03 is the "today" of these tests).
const wib = (day: number, hh: number, mm: number, ss = 0) => new Date(Date.UTC(2026, 1, day, hh - 7, mm, ss));

function environment() {
  const listeners = new Map<string, Set<() => void>>();
  let visible = true;
  const env: MinuteClockEnvironment = {
    now: () => Date.now(),
    setTimeout: (handler, ms) => setTimeout(handler, ms),
    clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    visible: () => visible,
    addListener: (event, handler) => { (listeners.get(event) ?? listeners.set(event, new Set()).get(event)!).add(handler); },
    removeListener: (event, handler) => { listeners.get(event)?.delete(handler); },
  };
  return { env, fire: (event: string) => listeners.get(event)?.forEach((h) => h()), count: (event: string) => listeners.get(event)?.size ?? 0, setVisible: (v: boolean) => { visible = v; } };
}

// What PickupFields renders: the warning for a courier and a chosen pickup date at the clock's last tick.
function mount(courier: string, pickupDate: string, env: MinuteClockEnvironment) {
  const shown: (string | null)[] = [];
  const stop = watchMinuteClock((now) => shown.push(pickupCutoffWarning(courier, pickupDate, now)), env);
  return { shown, stop, last: () => shown[shown.length - 1] };
}

describe("msToNextMinute", () => {
  it("is the time to the next whole minute, a full minute exactly on the boundary", () => {
    expect(msToNextMinute(Date.UTC(2026, 1, 3, 7, 59, 0, 0))).toBe(60_000);
    expect(msToNextMinute(Date.UTC(2026, 1, 3, 7, 59, 30, 250))).toBe(29_750);
    expect(msToNextMinute(Date.UTC(2026, 1, 3, 7, 59, 59, 999))).toBe(1);
  });
});

describe("watchMinuteClock", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("a form left open from 14:59 WIB shows the JNE cut-off warning at 15:01 (cut-off 15.00)", () => {
    vi.setSystemTime(wib(3, 14, 59, 20));
    const { env } = environment();
    const m = mount("JNE", "2026-02-03", env);
    expect(m.last()).toBeNull(); // 14:59: still in time
    vi.advanceTimersByTime(40_000); // 15:00:00 boundary
    expect(m.last()).toContain("sebelum 15.00 WIB");
    vi.advanceTimersByTime(60_000); // 15:01
    expect(m.last()).toContain("sebelum 15.00 WIB");
    m.stop();
  });

  it("the warning for today disappears when the clock crosses midnight WIB", () => {
    vi.setSystemTime(wib(3, 23, 59, 30));
    const { env } = environment();
    const m = mount("JNE", "2026-02-03", env);
    expect(m.last()).toContain("sebelum 15.00 WIB");
    vi.advanceTimersByTime(31_000); // 00:00:01 on the 4th
    expect(wibDate(new Date())).toBe("2026-02-04");
    expect(m.last()).toBeNull();
    m.stop();
  });

  it("ticks once at the start, then only at minute boundaries", () => {
    vi.setSystemTime(wib(3, 10, 0, 10));
    const { env } = environment();
    const ticks: number[] = [];
    const stop = watchMinuteClock((now) => ticks.push(now.getTime()), env);
    expect(ticks).toHaveLength(1);
    vi.advanceTimersByTime(49_000);
    expect(ticks).toHaveLength(1);
    vi.advanceTimersByTime(1_000); // 10:01:00
    expect(ticks).toHaveLength(2);
    vi.advanceTimersByTime(120_000);
    expect(ticks).toHaveLength(4);
    stop();
  });

  it("refreshes at once when the tab becomes visible or the window regains focus, but not while hidden", () => {
    vi.setSystemTime(wib(3, 14, 59, 0));
    const { env, fire, setVisible } = environment();
    const m = mount("JNE", "2026-02-03", env);
    expect(m.last()).toBeNull();
    // A hidden tab's timers were throttled: the wall clock moved on without a tick.
    setVisible(false);
    vi.setSystemTime(wib(3, 15, 30, 0));
    fire("visibilitychange");
    expect(m.last()).toBeNull(); // hidden: no refresh
    setVisible(true);
    fire("visibilitychange");
    expect(m.last()).toContain("sebelum 15.00 WIB");
    vi.setSystemTime(wib(4, 8, 0, 0));
    fire("focus");
    expect(m.last()).toBeNull();
    m.stop();
  });

  it("cleanup cancels the timer and removes both listeners", () => {
    vi.setSystemTime(wib(3, 14, 59, 0));
    const { env, fire, count } = environment();
    const m = mount("JNE", "2026-02-03", env);
    expect(count("visibilitychange")).toBe(1);
    expect(count("focus")).toBe(1);
    m.stop();
    const seen = m.shown.length;
    expect(count("visibilitychange")).toBe(0);
    expect(count("focus")).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(5 * 60_000);
    fire("focus");
    expect(m.shown).toHaveLength(seen);
  });
});
