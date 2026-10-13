import { defineConfig, devices } from "@playwright/test";

// Runs against an already started server (next dev on 3100 or the Worker preview); set
// E2E_BASE_URL to target another one. The local Supabase stack must be running and seeded.
export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:3100",
    trace: "retain-on-failure",
    locale: "id-ID",
    timezoneId: "Asia/Jakarta",
  },
  projects: [
    { name: "mobile-390", use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 }, hasTouch: true } },
    { name: "tablet-768", use: { ...devices["Desktop Chrome"], viewport: { width: 768, height: 1024 } } },
    { name: "desktop-1280", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 900 } } },
  ],
});
