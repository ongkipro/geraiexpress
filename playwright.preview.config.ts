import { defineConfig, devices } from "@playwright/test";

// T-018: smoke checks against a deployed environment serving the synthetic demo (the container behind the
// proxy, DEC-020). Run with `PREVIEW_URL=https://<host> pnpm smoke:preview`; there is no default, so a run
// never targets an address nobody named. No fixtures, SQL or fake visitor IPs: this is the real edge.
const baseURL = process.env.PREVIEW_URL;
if (!baseURL) throw new Error("Set PREVIEW_URL to the deployed origin to smoke-test.");
export default defineConfig({
  testDir: "tests/preview",
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL,
    locale: "id-ID",
    timezoneId: "Asia/Jakarta",
  },
  projects: [
    { name: "mobile-390", use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 }, hasTouch: true } },
    { name: "desktop-1280", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 900 } } },
  ],
});
