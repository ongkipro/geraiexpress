// PR-24 / PR-15 / PR-28 / IAM-7 / DEC-008: the Super Admin workspace in a real browser.
import { actAsVisitor, expect, randomVisitorIp, test } from "./fixtures";
import { totp } from "../totp";
import { chooseOption, expectNoHorizontalOverflow, expectTouchTargets, localSql, signIn, signInAdmin } from "./helpers";

test("an administrator passes the TOTP challenge and sees the tenant directory without demo tenants", async ({ page }) => {
  await signInAdmin(page);
  await expect(page.getByRole("heading", { name: "Gerai", exact: true })).toBeVisible();
  const tenants = page.getByTestId("platform-tenant");
  await expect(tenants.filter({ hasText: "Gerai Uji A" })).toBeVisible();
  await expect(tenants.filter({ hasText: "Gerai Contoh" })).toHaveCount(0);
  // PR-37: the immutable slug is shown read-only next to the gerai.
  await expect(tenants.filter({ hasText: "Gerai Uji A" }).getByTestId("platform-tenant-slug")).toContainText("Slug: gerai-uji-a");
  await expect(tenants.filter({ hasText: "Gerai Uji A" }).getByRole("textbox")).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
  await expectTouchTargets(page);
});

test("a wrong code keeps the session at aal1 and the workspace closed", async ({ page }) => {
  await signIn(page, "admin@geraiexpress.test");
  await page.getByLabel("Kode 6 digit").fill("000000");
  await page.getByRole("button", { name: "Verifikasi" }).click();
  await expect(page.getByRole("alert").filter({ hasText: /Kode tidak cocok/ })).toBeVisible();
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/verifikasi-2fa$/);
});

test("people without a platform grant get a plain not-found", async ({ page }) => {
  await signIn(page, "owner-b@geraiexpress.test");
  for (const path of ["/admin", "/admin/akses", "/admin/audit", "/verifikasi-2fa"]) {
    const res = await page.goto(path);
    expect(res?.status(), path).toBe(404);
  }
});

test("a new administrator enrols an authenticator before entering", async ({ page }) => {
  localSql(`delete from auth.mfa_factors where user_id = '00000000-0000-4000-a000-0000000000f3'`);
  await signIn(page, "admin-new@geraiexpress.test");
  await expect(page).toHaveURL(/\/verifikasi-2fa$/);
  await expect(page.getByRole("heading", { name: "Pasang autentikator" })).toBeVisible();
  await page.getByRole("button", { name: "Mulai pasang autentikator" }).click();
  await expect(page.getByAltText("Kode QR autentikator")).toBeVisible();
  const secret = (await page.getByTestId("totp-secret").textContent())!.trim();
  await page.getByLabel("Kode 6 digit").fill(totp(secret));
  await page.getByRole("button", { name: "Verifikasi" }).click();
  // Monitoring/audit-only administrators land on their first permitted page (T-092: the monitoring overview).
  await expect(page).toHaveURL(/\/admin$/);
  expect((await page.goto("/admin/akses"))?.status()).toBe(404);
  localSql(`delete from auth.mfa_factors where user_id = '00000000-0000-4000-a000-0000000000f3'`);
});

test("suspending a gerai needs a reason, blocks its members and is audited", async ({ page, browser }) => {
  await signInAdmin(page);
  const row = page.getByTestId("platform-tenant").filter({ hasText: "Gerai Uji C" });
  await row.getByText("Bekukan Gerai Uji C").click();
  // The reason and the confirm button live in a confirmation dialog (UI-4 redesign), not inline in the row.
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Bekukan" }).click();
  // The browser refuses an empty reason before submitting; the database enforces it as well.
  expect(await dialog.getByLabel("Alasan (dicatat di audit)").evaluate((el: HTMLTextAreaElement) => el.validity.valueMissing)).toBe(true);
  await expect(row.getByText("Aktif", { exact: true })).toBeVisible();
  await dialog.getByLabel("Alasan (dicatat di audit)").fill("Uji e2e pembekuan");
  await dialog.getByRole("button", { name: "Bekukan" }).click();
  await expect(row.getByText("Dibekukan", { exact: true })).toBeVisible();

  const member = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  await actAsVisitor(member, test.info().project.use.baseURL!, randomVisitorIp());
  const memberPage = await member.newPage();
  await signIn(memberPage, "owner-c@geraiexpress.test");
  await expect(memberPage).toHaveURL(/\/akses$/);
  await member.close();

  await page.goto("/admin/audit");
  const event = page.getByTestId("audit-event").filter({ hasText: "Uji e2e pembekuan" }).first();
  await expect(event).toContainText("oleh admin@geraiexpress.test");
  await expect(event).toContainText("Target: Gerai Uji C");
  await expect(event).toContainText("active → suspended");
  // The decision-type filter is the shared Radix select (T-097) in the audit search form.
  await chooseOption(page, "Jenis keputusan", "Akses admin dicabut");
  await page.getByRole("button", { name: "Terapkan" }).click();
  await expect(page).toHaveURL(/jenis=platform\.revoke/);
  await expect(page.getByTestId("audit-event").filter({ hasText: "Uji e2e pembekuan" })).toHaveCount(0);
  await page.goto("/admin");
  const again = page.getByTestId("platform-tenant").filter({ hasText: "Gerai Uji C" });
  await again.getByText("Aktifkan kembali Gerai Uji C").click();
  await page.getByRole("dialog").getByLabel("Alasan (dicatat di audit)").fill("Uji e2e selesai");
  await page.getByRole("dialog").getByRole("button", { name: "Aktifkan kembali" }).click();
  await expect(again.getByText("Aktif", { exact: true })).toBeVisible();
});

// T-097: the decision-type filter is client state inside a server page; soft navigation (category tab,
// "Hapus filter") must reset it, or the next submit re-applies an obsolete choice. Own test: the admin
// sign-in can wait most of a TOTP window, which leaves no room inside the suspension test.
test("the audit decision-type filter resets on category and clear-filter navigation", async ({ page }) => {
  test.setTimeout(60_000);
  await signInAdmin(page);
  const select = page.getByLabel("Jenis keputusan", { exact: true });
  await page.goto("/admin/audit?jenis=platform.revoke");
  await expect(select).toHaveText("Akses admin dicabut");
  await page.getByRole("search").getByRole("link", { name: "Hapus filter" }).click();
  await expect(page).toHaveURL(/\/admin\/audit\?kategori=akses$/);
  await expect(select).toHaveText("Semua di Akses admin");
  // Choosing "all" in a category submits an empty `jenis` and keeps the category.
  await chooseOption(page, "Jenis keputusan", "Akses admin dicabut");
  await chooseOption(page, "Jenis keputusan", "Semua di Akses admin");
  await page.getByRole("button", { name: "Terapkan" }).click();
  await expect(page).toHaveURL(/kategori=akses&jenis=&q=$/);
  // An unsubmitted choice is dropped when another category tab is opened.
  await chooseOption(page, "Jenis keputusan", "Akses admin dicabut");
  await page.getByRole("navigation", { name: "Kategori keputusan" }).getByRole("link", { name: "Semua", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/audit$/);
  await expect(select).toHaveText("Semua jenis");
  await page.getByRole("button", { name: "Terapkan" }).click();
  await expect(page).toHaveURL(/\/admin\/audit\?jenis=&q=$/);
  // Query-only navigation (same category, no action): clearing a search drops an unsubmitted choice and the text.
  await page.goto("/admin/audit?kategori=akses&q=zzz-tidak-ada");
  await chooseOption(page, "Jenis keputusan", "Akses admin dicabut");
  await page.getByRole("search").getByRole("link", { name: "Hapus filter" }).click();
  await expect(page).toHaveURL(/\/admin\/audit\?kategori=akses$/);
  await expect(select).toHaveText("Semua di Akses admin");
  await expect(page.getByLabel("Cari", { exact: true })).toHaveValue("");
  // Back returns to the searched URL and its filters, not the last client-side choice.
  await page.goBack();
  await expect(page).toHaveURL(/q=zzz-tidak-ada$/);
  await expect(select).toHaveText("Semua di Akses admin");
  await expect(page.getByLabel("Cari", { exact: true })).toHaveValue("zzz-tidak-ada");
});

test("the access page lists administrators and refuses removing the last usable governor", async ({ page }) => {
  await signInAdmin(page);
  await page.goto("/admin/akses");
  await expect(page.getByTestId("platform-admin").filter({ hasText: "admin-2@geraiexpress.test" })).toContainText("Autentikator terpasang");
  await expectNoHorizontalOverflow(page);
  await expectTouchTargets(page);
});
