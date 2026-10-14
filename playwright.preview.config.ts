import { defineConfig, devices } from "@playwright/test";

// T-018: smoke checks against the deployed preview (synthetic demo data only). Run with
// `pnpm smoke:preview`. No fixtures, SQL or fake visitor IPs: this is the real Cloudflare edge.
export default defineConfig({
  testDir: "tests/preview",
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: process.env.PREVIEW_URL ?? "https://geraiexpress-preview.ongki.workers.dev",
    locale: "id-ID",
    timezoneId: "Asia/Jakarta",
  },
  projects: [
    { name: "mobile-390", use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 }, hasTouch: true } },
    { name: "desktop-1280", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 900 } } },
  ],
});
