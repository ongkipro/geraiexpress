import { test as base, type BrowserContext, type Page } from "@playwright/test";
import { randomInt } from "node:crypto";

export { expect } from "@playwright/test";

// RATE-1: the Worker limits Auth entry points per CF-Connecting-IP. Off Cloudflare (wrangler dev,
// next dev) a client-supplied value passes through, so each test acts as its own random visitor.
// The header goes only to the app under test: real Cloudflare endpoints (Turnstile, T-016) reject
// a client-supplied CF-Connecting-IP.
export async function actAsVisitor(target: Page | BrowserContext, baseURL: string, ip: string) {
  const origin = new URL(baseURL).origin;
  await target.route((url) => url.origin === origin, (route) =>
    route.continue({ headers: { ...route.request().headers(), "cf-connecting-ip": ip } }));
}

export const randomVisitorIp = () => `10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}`;

export const test = base.extend({
  page: async ({ page, baseURL }, use) => {
    await actAsVisitor(page, baseURL!, randomVisitorIp());
    await use(page);
  },
});
