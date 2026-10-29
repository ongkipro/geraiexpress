import { defineConfig, devices } from "@playwright/test";

// Runs against an already started server: `next dev -p 3100` (default; it reads .env.local), or the production
// container behind the local proxy profile (`pnpm docker:up`, then E2E_BASE_URL=http://127.0.0.1:8080
// E2E_PRODUCTION_BUILD=1; see README). `pnpm db:up` must have run: it starts the gxdb stack (PostgreSQL, PostgREST,
// Mailpit), seeds it and writes .env.local / .env.container with the app's variables; emailed codes are read from
// Mailpit's API (tests/mail.ts), fixture SQL goes through the gxdb-postgres-1 container (tests/e2e/helpers.ts).
//
// Host topology (DEC-015). By default one origin serves every audience (local "all audiences"
// mode: bare 127.0.0.1 or localhost; HOST_SHARED_MODE=1 for a production build), and the existing
// specs run against it. The host-split specs (tests/e2e/hosts.spec.ts) address one origin per
// audience: E2E_SITE_URL, E2E_APP_URL, E2E_OWNER_URL and E2E_HOOKS_URL. Without them, and when the base
// URL is loopback, they derive site./app./owner./hooks.localhost on the same port against the same
// server (see audienceUrl in tests/e2e/helpers.ts). When only E2E_APP_URL is given, it is also
// the base URL for the gerai-application specs.
export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  // Default stays Playwright's 5 s. A `next dev` server on a loaded machine renders the Dashboard landing in
  // 2.4 to 4.6 s after sign-in (measured 2026-10-29), which sits on that limit: set E2E_EXPECT_TIMEOUT_MS=10000
  // for such runs. Not a retry and not a sleep: assertions still fail at the stated limit (T-059).
  expect: { timeout: Number(process.env.E2E_EXPECT_TIMEOUT_MS) || 5_000 },
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? process.env.E2E_APP_URL ?? "http://127.0.0.1:3100",
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
