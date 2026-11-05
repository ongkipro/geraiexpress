// T-062 / RATE-1 / RATE-2 / DEC-020: in-process fixed-window rate limiter, replacing the Workers
// Rate Limiting bindings with the same contract: `limit({ key })` resolves `{ success }`.
//
// Semantics: per key, a window starts at the first attempt and lasts `periodMs`; attempts inside it
// count (refused attempts count too and do not extend the window), the first `limit` succeed. A new
// window starts at the first attempt after the old one expired.
//
// Bounded memory: windows stay in start order; expired windows are evicted first. At capacity we evict
// the oldest LIVE window that has not exhausted its budget, never an exhausted window. Only a table full
// of exhausted windows refuses a new key. A second insertion-ordered Set indexes the non-exhausted
// windows, so a flood of fresh keys does not require scanning a full table on every request.
// Saturation emits `rate_limiter_saturated` at most once a minute per table, with no key material.
// Account tables allow 100 000 keys (account-wide + account/visitor pairs); visitor tables allow 10 000.
//
// lazy: state lives in this process only. That is correct for ONE app instance. A second
// instance (or a rolling restart that overlaps two) multiplies every budget by the instance count and
// a restart forgets all windows; a shared store (for example Redis) is required before running two
// instances. `src/proxy.ts` (the former middleware, T-066) and the Server Actions both run in the
// Node.js runtime and share the `globalThis` registry below, so `REFRESH_LIMITER` and the action
// limiters keep one process-wide table per limiter (documented in ARCHITECTURE.md).
export type Limiter = { limit(options: { key: string }): Promise<{ success: boolean }> };

export type FixedWindowOptions = {
  limit: number;
  periodMs: number;
  maxKeys?: number;
  name?: LimiterName;
  // Monotonic milliseconds; injectable for tests.
  now?: () => number;
};

export const DEFAULT_MAX_KEYS = 10_000;
export const ACCOUNT_MAX_KEYS = 100_000;

export function createFixedWindowLimiter({ limit, periodMs, maxKeys = DEFAULT_MAX_KEYS, name, now = () => performance.now() }: FixedWindowOptions) {
  const windows = new Map<string, { start: number; count: number }>();
  const available = new Set<string>();
  let lastSaturation = -Infinity;
  return {
    async limit({ key }: { key: string }): Promise<{ success: boolean }> {
      const t = now();
      const current = windows.get(key);
      if (current && t - current.start < periodMs) {
        // Saturate the count as well: refused attempts do not need an unbounded counter.
        if (current.count >= limit) return { success: false };
        current.count++;
        if (current.count >= limit) available.delete(key);
        return { success: true };
      }
      if (current) {
        windows.delete(key);
        available.delete(key);
      }
      if (windows.size >= maxKeys) {
        for (const [oldKey, w] of windows) {
          if (t - w.start < periodMs) break;
          windows.delete(oldKey);
          available.delete(oldKey);
        }
        if (windows.size >= maxKeys) {
          const oldestAvailable = available.values().next();
          if (t - lastSaturation >= 60_000) {
            console.warn(JSON.stringify({
              event: "rate_limiter_saturated", limiter: name ?? "custom", maxKeys,
              action: oldestAvailable.done ? "refused" : "evicted_unspent",
            }));
            lastSaturation = t;
          }
          if (oldestAvailable.done) return { success: false };
          windows.delete(oldestAvailable.value);
          available.delete(oldestAvailable.value);
        }
      }
      windows.set(key, { start: t, count: 1 });
      if (limit > 1) available.add(key);
      return { success: limit >= 1 };
    },
    // Test and diagnostics hook: the number of live or not-yet-evicted windows.
    size: () => windows.size,
  };
}

// Auth keeps the names and limits of the former `ratelimits` bindings in wrangler.jsonc.
// MENGANTAR_AREA_LIMITER bounds live area-search fallback per verified tenant (catalogue hits are free).
// Visitor limits are per client network (IPv4 address or IPv6 /56, see visitor-key.ts); the *_ACCOUNT_*
// limits are per target account (email SHA-256, or the verified MFA user id), and REFRESH_LIMITER is per
// visitor, spent only when Auth must actually refresh a session.
export const LIMITS = {
  SIGN_IN_LIMITER: { limit: 10, periodSeconds: 60 },
  DEMO_LIMITER: { limit: 5, periodSeconds: 60 },
  MFA_LIMITER: { limit: 10, periodSeconds: 60 },
  OTP_LIMITER: { limit: 3, periodSeconds: 60 },
  SIGN_IN_ACCOUNT_LIMITER: { limit: 10, periodSeconds: 60 },
  OTP_ACCOUNT_LIMITER: { limit: 10, periodSeconds: 60 },
  SIGN_IN_ACCOUNT_VISITOR_LIMITER: { limit: 5, periodSeconds: 60 },
  OTP_ACCOUNT_VISITOR_LIMITER: { limit: 5, periodSeconds: 60 },
  MFA_ACCOUNT_LIMITER: { limit: 10, periodSeconds: 60 },
  REFRESH_LIMITER: { limit: 10, periodSeconds: 60 },
  MENGANTAR_AREA_LIMITER: { limit: 30, periodSeconds: 60 },
} as const;

export type LimiterName = keyof typeof LIMITS;

// Registry on globalThis: survives module re-evaluation (hot reload, separate bundles of the same Node
// process) and is shared by every route handler and Server Action of the runtime.
const REGISTRY = Symbol.for("geraiexpress.limiters");
type Registry = Map<LimiterName, Limiter>;
// The compiler cannot know about a Symbol.for slot on globalThis; the slot is created here and only here.
const holder = globalThis as typeof globalThis & { [REGISTRY]?: Registry };
const registry = (): Registry => (holder[REGISTRY] ??= new Map());
export function limiterFor(name: LimiterName): Limiter {
  const known = registry().get(name);
  if (known) return known;
  const { limit, periodSeconds } = LIMITS[name];
  const maxKeys = name.includes("_ACCOUNT_") ? ACCOUNT_MAX_KEYS : DEFAULT_MAX_KEYS;
  const created = createFixedWindowLimiter({ limit, periodMs: periodSeconds * 1000, maxKeys, name });
  registry().set(name, created);
  return created;
}

// Tests only: forget every window.
export function resetLimiters(): void {
  registry().clear();
}
