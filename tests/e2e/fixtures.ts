import { test as base } from "@playwright/test";
import { randomInt } from "node:crypto";

export { expect } from "@playwright/test";

// RATE-1: the Worker limits Auth entry points per CF-Connecting-IP. Off Cloudflare (wrangler dev,
// next dev) a client-supplied value passes through, so each test acts as its own random private-range visitor;
// tests that exercise the limit pin their own address.
export const test = base.extend({
  page: async ({ page }, use) => {
    await page.setExtraHTTPHeaders({ "cf-connecting-ip": `10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}` });
    await use(page);
  },
});
