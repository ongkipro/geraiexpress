import { test as base, type BrowserContext, type Page } from "@playwright/test";
import { randomInt } from "node:crypto";

export { expect } from "@playwright/test";

// RATE-1: the app limits Auth entry points per client address, read only from `X-Real-IP` and only while
// TRUSTED_PROXY=1 (src/lib/client-address.ts). Against `next dev` (TRUSTED_PROXY=1 from `pnpm dev:env`,
// no proxy in front) a client-supplied X-Real-IP passes through; against the container the LOCAL proxy
// profile (infra/proxy/Caddyfile.local) trusts ONLY the pinned local gateway's X-Forwarded-For and writes it into
// X-Real-IP, so each test acts as its own TEST-NET visitor. The production proxy never trusts either header
// from a client. Both headers go only to the app under test: real third-party endpoints (Turnstile,
// T-016) must not receive them.
export async function actAsVisitor(target: Page | BrowserContext, baseURL: string, ip: string) {
  await stubTurnstile(target);
  const origin = new URL(baseURL).origin;
  await target.route((url) => url.origin === origin, (route) =>
    route.continue({ headers: { ...route.request().headers(), "x-real-ip": ip, "x-forwarded-for": ip } }));
}

// All three RFC 5737 documentation ranges; cycle without reusing an address within a project run.
const testNetworks = ["192.0.2", "198.51.100", "203.0.113"];
let nextVisitor = randomInt(testNetworks.length * 254);
export const randomVisitorIp = () => {
  const n = nextVisitor++ % (testNetworks.length * 254);
  return `${testNetworks[Math.floor(n / 254)]}.${n % 254 + 1}`;
};

// T-059 (2026-11-04): the server under test runs with AUTH_CAPTCHA_DISABLED=true, but the browser still
// waited for a token from the live Cloudflare Turnstile script; when it was late the submit stayed
// aria-disabled and the test timed out (three recorded flakes). Serve a local stand-in that renders
// nothing and hands back a dummy token at once, so e2e never depends on that network. Production and
// the server-side verification path are unchanged.
// Like the real widget: render issues a token, reset (after each completed attempt) issues a fresh one
// to the same widget, remove forgets it.
const TURNSTILE_STUB = `(() => {
  const widgets = new Map(); let next = 0;
  const issue = (id) => setTimeout(() => { const o = widgets.get(id); if (o && o.callback) o.callback("e2e-local-turnstile-token-" + id); }, 0);
  window.turnstile = {
    render: (el, o) => { const id = "e2e-" + (++next); widgets.set(id, o); issue(id); return id; },
    reset: (id) => issue(id),
    remove: (id) => { widgets.delete(id); },
  };
})();`;
export async function stubTurnstile(target: Page | BrowserContext) {
  await target.route(/^https:\/\/challenges\.cloudflare\.com\/turnstile\/v0\/api\.js/, (route) =>
    route.fulfill({ status: 200, contentType: "application/javascript", body: TURNSTILE_STUB }));
}

export const test = base.extend({
  page: async ({ page, baseURL }, use) => {
    await actAsVisitor(page, baseURL!, randomVisitorIp());
    await use(page);
  },
});
