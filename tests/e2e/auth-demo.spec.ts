// PR-1, PR-13, PR-21, UX-3, NFR-4: entry, scope, demo isolation and sign-out in a real browser.
import { expect, test } from "./fixtures";
import { randomInt } from "node:crypto";
import { FIXTURE_PASSWORD, expectNoHorizontalOverflow, expectTouchTargets, signIn, signOut, startDemo } from "./helpers";

const TOO_MANY = /Terlalu banyak percobaan dari jaringan ini/;

// Limiter windows are aligned to the wall clock; start a burst early in a window so it cannot
// straddle a reset.
async function freshLimitWindow() {
  const into = Date.now() % 60_000;
  if (into > 30_000) await new Promise((r) => setTimeout(r, 60_000 - into + 250));
}

test("login page offers sign-in and a discoverable demo entry", async ({ page }) => {
  await page.goto("/masuk");
  await expect(page.getByRole("heading", { name: "Masuk ke ruang kerja gerai" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Coba demo" })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("wrong password shows one generic error and keeps the email", async ({ page }) => {
  await page.goto("/masuk");
  await page.getByRole("textbox", { name: "Email" }).fill("owner-a@geraiexpress.test");
  await page.getByLabel("Kata sandi").fill("salah-sekali-123");
  await page.getByRole("button", { name: "Masuk", exact: true }).click();
  await expect(page.locator("#signin-error")).toHaveText(/Email atau kata sandi tidak cocok/);
  await expect(page.getByRole("textbox", { name: "Email" })).toHaveValue("owner-a@geraiexpress.test");
});

test("unknown email gets the same message as a wrong password", async ({ page }) => {
  await page.goto("/masuk");
  await page.getByRole("textbox", { name: "Email" }).fill("tidak-terdaftar@geraiexpress.test");
  await page.getByLabel("Kata sandi").fill("apa-saja-12345");
  await page.getByRole("button", { name: "Masuk", exact: true }).click();
  await expect(page.locator("#signin-error")).toHaveText(/Email atau kata sandi tidak cocok/);
});

test("protected pages redirect to sign-in when signed out", async ({ page }) => {
  await page.goto("/pengiriman");
  await expect(page).toHaveURL(/\/masuk$/);
});

test("tenant member sees only their own gerai and can sign out", async ({ page }) => {
  await signIn(page, "owner-a@geraiexpress.test");
  await expect(page).toHaveURL(/\/pengiriman$/);
  await expect(page.getByTestId("tenant-name").filter({ visible: true }).first()).toHaveText("Gerai Uji A");
  await expect(page.getByTestId("outlet-name").filter({ visible: true }).first()).toHaveText("Outlet Uji A");
  await expect(page.getByText("GXTEST-A1").filter({ visible: true }).first()).toBeVisible();
  await expect(page.getByText("GXTEST-B1")).toHaveCount(0);
  await expect(page.getByText("Demo · Simulasi.")).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
  await signOut(page);
});

test("signed-in user without membership gets the no-access state", async ({ page }) => {
  await signIn(page, "no-access@geraiexpress.test");
  await expect(page).toHaveURL(/\/akses$/);
  await expect(page.getByRole("heading", { name: "Belum ada gerai untuk akun ini" })).toBeVisible();
  await page.goto("/pengiriman");
  await expect(page).toHaveURL(/\/akses$/);
});

test("demo opens a labelled sample workspace with seeded examples", async ({ page }) => {
  await startDemo(page);
  await expect(page.getByText("Demo · Simulasi.")).toBeVisible();
  await expect(page.getByTestId("tenant-name").filter({ visible: true }).first()).toHaveText("Gerai Contoh Sentosa");
  await expect(page.getByRole("heading", { name: "Perlu ditindaklanjuti" })).toBeVisible();
  await expect(page.getByText("Hasil belum pasti").filter({ visible: true }).first()).toBeVisible();
  await expect(page.getByText("GXTEST-A1")).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
});

test("two demo visitors are isolated from each other", async ({ browser }) => {
  const a = await browser.newContext();
  const b = await browser.newContext();
  const pa = await a.newPage();
  const pb = await b.newPage();
  await startDemo(pa);
  await startDemo(pb);
  const refA = await pa.locator("[data-testid=shipment-ref]").filter({ visible: true }).first().textContent();
  await pb.goto(`/pengiriman?q=${encodeURIComponent(refA ?? "")}`);
  await expect(pb.getByText("Tidak ada pengiriman yang cocok dengan filter ini.")).toBeVisible();
  await a.close();
  await b.close();
});

test("mobile navigation opens as a sheet and keeps scope visible", async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 1280) >= 1024, "desktop uses the sidebar");
  await startDemo(page);
  await expect(page.getByTestId("tenant-name").filter({ visible: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Buka menu" }).click();
  await expect(page.getByRole("dialog", { name: "Menu" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Kontak" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Menu" })).toHaveCount(0);
});

test("keyboard focus is visible on the primary action", async ({ page }) => {
  await page.goto("/masuk");
  await page.getByLabel("Kata sandi").focus();
  await page.keyboard.press("Tab");
  const outline = await page.evaluate(() => getComputedStyle(document.activeElement!).outlineStyle);
  expect(await page.evaluate(() => document.activeElement?.textContent)).toBe("Masuk");
  expect(outline).not.toBe("none");
});

test("a forged tenant cookie cannot widen access", async ({ page, context }) => {
  await signIn(page, "owner-a@geraiexpress.test");
  await expect(page).toHaveURL(/\/pengiriman$/);
  const url = new URL(page.url());
  await context.addCookies([{ name: "ge_tenant", value: "00000000-0000-4000-b000-00000000000b", domain: url.hostname, path: "/" }]);
  await page.reload();
  await expect(page.getByTestId("tenant-name").filter({ visible: true }).first()).toHaveText("Gerai Uji A");
  await expect(page.getByText("GXTEST-B1")).toHaveCount(0);
});

test("a signed-in real account is not silently replaced by a demo session", async ({ page }) => {
  await signIn(page, "no-access@geraiexpress.test");
  await expect(page).toHaveURL(/\/akses$/);
  await page.goto("/masuk");
  await expect(page).toHaveURL(/\/akses$/);
});

test("demo reset restores the seeded examples", async ({ page }) => {
  await startDemo(page);
  await page.goto("/pengiriman?status=unknown");
  await expect(page.getByText("1 pengiriman · halaman 1 dari 1")).toBeVisible();
  if ((page.viewportSize()?.width ?? 1280) < 1024) await page.getByRole("button", { name: "Buka menu" }).click();
  await page.getByRole("button", { name: "Atur ulang demo" }).click();
  await expect(page.getByText("Demo sudah dikembalikan ke contoh awal.")).toBeVisible();
  await expect(page.getByText("3 pengiriman · halaman 1 dari 1")).toBeVisible();
});

test("out-of-range page offers a way back instead of an error", async ({ page }) => {
  await startDemo(page);
  await page.goto("/pengiriman?page=999");
  await expect(page.getByText("Halaman 999 tidak tersedia.")).toBeVisible();
});

test("controls meet the 44px touch target on login and queue", async ({ page }) => {
  await page.goto("/masuk");
  await expectTouchTargets(page);
  await startDemo(page);
  await expectTouchTargets(page);
});

test("a person with two gerai memberships must choose one explicitly", async ({ page }) => {
  await signIn(page, "multi@geraiexpress.test");
  await expect(page).toHaveURL(/\/pilih-gerai$/);
  await page.getByRole("button", { name: "Gerai Uji B" }).click();
  await expect(page).toHaveURL(/\/pengiriman$/);
  await expect(page.getByTestId("tenant-name").filter({ visible: true }).first()).toHaveText("Gerai Uji B");
  await expect(page.getByText("GXTEST-B1").filter({ visible: true }).first()).toBeVisible();
  await expect(page.getByText("GXTEST-A1")).toHaveCount(0);
});


test("sign-in is limited per visitor before Supabase Auth is reached (RATE-1)", async ({ page }) => {
  test.setTimeout(120_000);
  await freshLimitWindow();
  await page.goto("/masuk");
  const attempt = async (password: string) => {
    await page.getByRole("textbox", { name: "Email" }).fill("owner-a@geraiexpress.test");
    await page.getByLabel("Kata sandi").fill(password);
    await Promise.all([
      page.waitForResponse((r) => r.request().method() === "POST" && r.url().includes("/masuk")),
      page.getByRole("button", { name: "Masuk", exact: true }).click(),
    ]);
  };
  for (let i = 0; i < 10; i++) {
    await attempt(`salah-${i}-12345`);
    await expect(page.locator("#signin-error")).toHaveText(/Email atau kata sandi tidak cocok/);
  }
  // The 11th attempt in the window is refused even with the right password.
  await attempt(FIXTURE_PASSWORD);
  await expect(page.locator("#signin-error")).toHaveText(TOO_MANY);
  await expect(page).toHaveURL(/\/masuk$/);
});

test("demo entry is limited per visitor (RATE-1)", async ({ browser }) => {
  const ip = `10.250.${randomInt(256)}.${randomInt(1, 255)}`;
  test.setTimeout(120_000);
  const baseURL = test.info().project.use.baseURL;
  await freshLimitWindow();
  for (let i = 0; i < 6; i++) {
    const context = await browser.newContext({ baseURL, extraHTTPHeaders: { "cf-connecting-ip": ip } });
    const page = await context.newPage();
    await page.goto("/masuk");
    await page.getByRole("button", { name: "Coba demo" }).click();
    if (i < 5) await expect(page).toHaveURL(/\/pengiriman$/);
    else await expect(page.getByRole("alert").filter({ hasText: TOO_MANY })).toBeVisible();
    await context.close();
  }
});
