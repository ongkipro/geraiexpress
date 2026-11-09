// A clock for client hints that must stay correct while a page stays open (T-043 pickup hints: the
// courier cut-off warning and the "terlalu dekat" slots). `watchMinuteClock` calls `onTick` with the current
// time at once, at every minute boundary (a timer re-armed for the next boundary, so a tab left open crosses
// 14:59 -> 15:00 and midnight on time), and when the page becomes visible or the window regains focus (timers
// are throttled in hidden tabs). It returns the cleanup that cancels the timer and removes the listeners.
// The environment is injectable so the behaviour is testable with fake timers and no DOM.
export type MinuteClockEnvironment = {
  now: () => number;
  setTimeout: (handler: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
  visible: () => boolean;
  addListener: (event: "visibilitychange" | "focus", handler: () => void) => void;
  removeListener: (event: "visibilitychange" | "focus", handler: () => void) => void;
};

export const browserClockEnvironment = (): MinuteClockEnvironment => ({
  now: () => Date.now(),
  setTimeout: (handler, ms) => window.setTimeout(handler, ms),
  clearTimeout: (handle) => window.clearTimeout(handle as number),
  visible: () => document.visibilityState === "visible",
  addListener: (event, handler) => (event === "focus" ? window : document).addEventListener(event, handler),
  removeListener: (event, handler) => (event === "focus" ? window : document).removeEventListener(event, handler),
});

// Milliseconds from `nowMs` to the next whole minute (60 000 exactly on a boundary, so it never fires twice in one).
export const msToNextMinute = (nowMs: number) => 60_000 - (((nowMs % 60_000) + 60_000) % 60_000);

export function watchMinuteClock(onTick: (now: Date) => void, env: MinuteClockEnvironment = browserClockEnvironment()): () => void {
  let handle: unknown = null;
  const tick = () => onTick(new Date(env.now()));
  const arm = () => {
    handle = env.setTimeout(() => { tick(); arm(); }, msToNextMinute(env.now()));
  };
  const refresh = () => {
    if (!env.visible()) return;
    tick();
    env.clearTimeout(handle);
    arm();
  };
  tick();
  arm();
  env.addListener("visibilitychange", refresh);
  env.addListener("focus", refresh);
  return () => {
    env.clearTimeout(handle);
    env.removeListener("visibilitychange", refresh);
    env.removeListener("focus", refresh);
  };
}
