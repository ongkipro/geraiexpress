import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";

export const FIXTURE_PASSWORD: string = "geraiexpress-local-dev";

export type Audience = "site" | "app" | "owner" | "hooks";

// Origin that serves one audience (DEC-015). E2E_<AUDIENCE>_URL wins; otherwise, when the base URL is
// loopback, the `*.localhost` name of that audience on the same port (the dev server accepts them
// and Chromium resolves them to loopback); otherwise null (a preview serves every audience from one
// host, so the host-split checks do not apply).
export function audienceUrl(audience: Audience, baseURL: string): string | null {
  const configured = process.env[`E2E_${audience.toUpperCase()}_URL`];
  if (configured) return new URL(configured).origin;
  const base = new URL(baseURL);
  if (!["127.0.0.1", "localhost"].includes(base.hostname)) return null;
  return `${base.protocol}//${audience}.localhost${base.port ? `:${base.port}` : ""}`;
}

// RATE-2: SIGN_IN_ACCOUNT_LIMITER allows 10 sign-in attempts per 60 s per target email across all
// visitor addresses (withinAccountLimit in src/lib/rate-limit.ts, called even on a valid password in
// src/lib/auth-actions.ts). Track each account's fixed window in the worker process so if a burst of
// specs reaches 9 sign-ins for one fixture email inside 60 s, the next sign-in waits out the window.
const accountWindows = new Map<string, { start: number; count: number }>();

async function waitForAccountBudget(email: string) {
  const key = email.trim().toLowerCase();
  const now = Date.now();
  const current = accountWindows.get(key);
  if (current && now - current.start < 61_000) {
    if (current.count >= 9) {
      // The wait can exceed a 30 s test timeout: extend this test by the wait (it is the budget's, not the app's).
      test.setTimeout(test.info().timeout + 65_000);
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, 61_000 - (now - current.start));
      await promise;
      accountWindows.set(key, { start: Date.now(), count: 1 });
      return;
    }
    current.count++;
    return;
  }
  accountWindows.set(key, { start: now, count: 1 });
}

export async function signIn(page: Page, email: string) {
  await waitForAccountBudget(email);
  for (let attempt = 0; ; attempt++) {
    await page.goto("/masuk");
    await page.getByRole("textbox", { name: "Email" }).fill(email);
    await page.getByLabel("Kata sandi").fill(FIXTURE_PASSWORD);
    await page.getByRole("button", { name: "Masuk", exact: true }).click();
    // The client-side window above starts before the server's (it opens at the POST), so a fast burst of
    // specs can still meet the server's per-account 60 s budget. On that named refusal, wait out a full
    // window once and retry; any other outcome is the test's to judge.
    const throttled = page.getByRole("alert").filter({ hasText: "Terlalu banyak percobaan" });
    const outcome = await Promise.race([
      page.waitForURL((url) => !url.pathname.endsWith("/masuk")).then(() => "signed-in" as const),
      throttled.waitFor().then(() => "throttled" as const),
    ]);
    if (outcome === "signed-in") return;
    if (attempt > 0) throw new Error(`sign-in for ${email} still throttled after waiting a full window`);
    test.setTimeout(test.info().timeout + 65_000);
    await page.waitForTimeout(62_000);
    accountWindows.set(email.trim().toLowerCase(), { start: Date.now(), count: 1 });
  }
}

// UX-16: the gerai Dashboard is the home "/" (no query: the default period); every signed-in landing goes there.
export const atDashboard = (url: URL) => url.pathname === "/" && url.search === "";

export async function startDemo(page: Page) {
  await page.goto("/masuk");
  await page.getByRole("button", { name: "Coba demo" }).click();
  await expect(page).toHaveURL(atDashboard); // UX-16: the demo lands on the Dashboard.
}

export async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, "document must not scroll horizontally").toBeLessThanOrEqual(0);
}

// UX-16 (T-079): the session actions (Ganti gerai, Atur ulang demo, Keluar) live in the header's account
// menu from 768 px and in the menu sheet below it. Opens the right one and returns a locator factory for
// an action in it: a menu item in the account menu, a button in the sheet.
export async function openSessionActions(page: Page) {
  if ((page.viewportSize()?.width ?? 1280) < 768) {
    await page.getByRole("button", { name: "Buka menu" }).click();
    const sheet = page.getByRole("dialog", { name: "Menu" });
    await expect(sheet).toBeVisible();
    return (name: string) => sheet.getByRole("button", { name });
  }
  await page.getByRole("button", { name: "Menu akun" }).click();
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  return (name: string) => menu.getByRole("menuitem", { name });
}

export async function signOut(page: Page) {
  const action = await openSessionActions(page);
  await action("Keluar").click();
  await expect(page).toHaveURL(/\/masuk$/);
}

// UI-2 / NFR-4: every visible interactive control offers at least a 44×44px target.
export async function expectTouchTargets(page: Page) {
  const small = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("a[href], button, select, input:not([type=hidden]), [role=button]")]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        if (r.width === 0 || r.height === 0 || style.visibility === "hidden") return false;
        if (el.closest(".sr-only") || el.classList.contains("sr-only")) return false;
        // Radix Select mirrors its value into a hidden, untabbable <select> inside forms; it is not a target.
        if (el.matches('select[aria-hidden="true"][tabindex="-1"]')) return false;
        // The Switch track is 48x28; its ::after pads the pointer hit area to 44px high (ui/switch.tsx).
        if (el.matches("button[role=switch]")) return r.width < 44 || r.height < 28;
        // A radio/checkbox is exempt when its clickable label provides the target.
        if (el.matches("input[type=radio], input[type=checkbox], button[role=checkbox]")) {
          const label = el.closest("label");
          if (label) {
            const lr = label.getBoundingClientRect();
            return lr.height < 44;
          }
        }
        return r.height < 44 || r.width < 44;
      })
      .map((el) => `${el.tagName.toLowerCase()} "${(el.textContent || el.getAttribute("aria-label") || "").trim().slice(0, 40)}" ${Math.round(el.getBoundingClientRect().width)}×${Math.round(el.getBoundingClientRect().height)}`),
  );
  expect(small, "touch targets below 44px").toEqual([]);
}

// T-072 / UX-15: pick an option of a labelled select, whether it is the shared Radix Select (a combobox
// button whose options open in a listbox) or a native <select>. `option` is the visible option text
// (exact string or pattern) or `{ index }`, counted over the options as listed (a native placeholder
// option counts, a Radix placeholder is not an option).
export type OptionChoice = string | RegExp | { index: number };
export async function chooseOption(page: Page, label: string, option: OptionChoice) {
  const control = page.getByLabel(label, { exact: true });
  if (await control.evaluate((el) => el.tagName === "SELECT")) {
    if (typeof option === "object" && "index" in option) await control.selectOption({ index: option.index });
    else if (typeof option === "string") await control.selectOption({ label: option });
    else {
      const labels = await control.locator("option").allTextContents();
      const match = labels.find((text) => option.test(text));
      if (!match) throw new Error(`no option of "${label}" matches ${option}`);
      await control.selectOption({ label: match });
    }
    return;
  }
  await control.click();
  const listbox = page.getByRole("listbox");
  await expect(listbox).toBeVisible();
  const item = typeof option === "object" && "index" in option
    ? listbox.getByRole("option").nth(option.index)
    : listbox.getByRole("option", { name: option, exact: typeof option === "string" });
  await item.click();
  await expect(listbox).toHaveCount(0);
}

// The option texts of a labelled select (shared Radix Select or native), in order; a Radix list is
// opened to read it and closed again with Escape.
export async function optionTexts(page: Page, label: string): Promise<string[]> {
  const control = page.getByLabel(label, { exact: true });
  if (await control.evaluate((el) => el.tagName === "SELECT")) return (await control.locator("option").allTextContents()).map((t) => t.trim());
  await control.click();
  const listbox = page.getByRole("listbox");
  await expect(listbox).toBeVisible();
  const texts = (await listbox.getByRole("option").allTextContents()).map((t) => t.trim());
  await page.keyboard.press("Escape");
  await expect(listbox).toHaveCount(0);
  return texts;
}

// Local stack only: the signed-in user's id, read from the `sub` claim of the access cookie (an unverified read of
// the payload is enough here; the server verifies it on every request).
export async function sessionUserId(page: Page): Promise<string> {
  const access = (await page.context().cookies()).find((c) => c.name === "gx_at");
  if (!access) throw new Error("no access cookie: sign in first");
  return JSON.parse(Buffer.from(access.value.split(".")[1], "base64url").toString("utf8")).sub;
}

// Local-only superuser SQL for fixture changes the API must not allow (e.g. demoting a role).
// Always targets the local gxdb container (pnpm db:up); tests using it cannot run against a remote environment.
export function localSql(statement: string): string {
  const container = process.env.GX_DB_CONTAINER ?? "gxdb-postgres-1";
  const database = process.env.GX_DB_NAME ?? "gxdb";
  return execFileSync("docker", ["exec", container, "psql", "-U", "postgres", "-d", database, "-tA", "-v", "ON_ERROR_STOP=1", "-c", statement], { encoding: "utf8" }).trim();
}

// PR-24: platform sign-in completes the TOTP challenge with the local fixture secret. The server refuses a
// time step it already accepted for that factor (replay guard, ADR-0002 obligation 5), and consecutive specs
// sign in the same fixture administrator within one 30-second step: pick an unused current/next step
// and wait if none is left. The previous step can expire between generation and server verification.
import { FIXTURE_TOTP, freshTotpStep, totp } from "../totp";
export async function freshAdminCode(email: keyof typeof FIXTURE_TOTP): Promise<string> {
  let extended = false;
  for (;;) {
    const last = Number(localSql(`select coalesce(max(f.last_used_step), -1) from auth.mfa_factors f join auth.users u on u.id = f.user_id where u.email = '${email}'`));
    const step = freshTotpStep(last, Date.now());
    if (step !== undefined) return totp(FIXTURE_TOTP[email], step * 30_000);
    // The wait for the next step (up to 30 s) is the replay guard's, not the app's: extend the test once
    // by it, as the sign-in budget wait does (T-097: a 30 s test timed out right after this wait).
    if (!extended) { test.setTimeout(test.info().timeout + 35_000); extended = true; }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
}
export async function signInAdmin(page: Page, email: keyof typeof FIXTURE_TOTP = "admin@geraiexpress.test") {
  await signIn(page, email);
  await expect(page).toHaveURL(/\/verifikasi-2fa$/);
  await page.getByLabel("Kode 6 digit").fill(await freshAdminCode(email));
  await page.getByRole("button", { name: "Verifikasi" }).click();
  await expect(page).toHaveURL(/\/admin$/);
}

export { mailCode } from "../mail";
