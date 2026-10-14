// PR-31 / PR-32 / UX-8 / DEC-007 / DEC-008: staff invitation, acceptance and member management.
import { actAsVisitor, expect, randomVisitorIp, test } from "./fixtures";
import { expectNoHorizontalOverflow, expectTouchTargets, localSql, mailCode, signIn, startDemo } from "./helpers";

test("an admin invites staff who join through the email code while public registration is closed", async ({ page, browser }) => {
  test.setTimeout(90_000);
  const email = `staf-e2e-${Date.now()}-${Math.floor(Math.random() * 1e4)}@geraiexpress.test`;
  await signIn(page, "owner-a@geraiexpress.test");
  await page.goto("/anggota");
  await expect(page.getByRole("heading", { name: "Anggota", exact: true })).toBeVisible();
  await page.getByLabel("Email staf").fill(email);
  await page.getByRole("button", { name: "Buat undangan" }).click();
  await expect(page.getByText("Undangan dibuat.")).toBeVisible();
  await expect(page.getByTestId("invitation").filter({ hasText: email })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await expectTouchTargets(page);

  localSql(`update private.settings set value = 'false' where key = 'registration_open'`);
  const baseURL = test.info().project.use.baseURL!;
  const staffContext = await browser.newContext({ baseURL });
  await actAsVisitor(staffContext, baseURL, randomVisitorIp());
  const staff = await staffContext.newPage();
  try {
    await staff.goto("/masuk");
    await staff.getByRole("link", { name: "Masuk dengan kode email" }).click();
    await expect(staff).toHaveURL(/\/daftar$/);
    await staff.waitForLoadState("networkidle");
    await staff.getByRole("textbox", { name: "Email", exact: true }).fill(email);
    await expect(staff.getByRole("textbox", { name: "Email", exact: true })).toHaveValue(email);
    await staff.getByRole("button", { name: "Kirim kode" }).click();
    await staff.getByLabel("Kode 6 digit dari email").fill(await mailCode(email));
    await staff.getByRole("button", { name: "Verifikasi" }).click();
    await expect(staff).toHaveURL(/\/daftar\/kata-sandi$/);
    await staff.getByLabel("Kata sandi baru").fill("sandi-staf-12345");
    await staff.getByLabel("Ulangi kata sandi").fill("sandi-staf-12345");
    await staff.getByRole("button", { name: "Simpan kata sandi" }).click();
    await expect(staff).toHaveURL(/\/undangan$/);
    const invite = staff.getByTestId("my-invitation").filter({ hasText: "Gerai Uji A" });
    await expect(invite).toContainText("Sebagai Operator");
    await expectTouchTargets(staff);
    await invite.getByRole("button", { name: /Terima/ }).click();
    await expect(staff).toHaveURL(/\/pengiriman$/);
    await expect(staff.getByTestId("tenant-name").first()).toHaveText("Gerai Uji A");
    // Operators do not manage members.
    expect((await staff.goto("/anggota"))?.status()).toBe(404);
  } finally {
    localSql(`update private.settings set value = 'true' where key = 'registration_open'`);
  }

  // The admin sees the new member and removes them again; access ends at once.
  await page.reload();
  const member = page.getByTestId("member").filter({ hasText: email });
  await member.getByText(`Atur ${email}…`).click();
  await member.getByRole("button", { name: "Nonaktifkan" }).click();
  await expect(page.getByTestId("member").filter({ hasText: email })).toHaveCount(0);
  await staff.goto("/pengiriman");
  await expect(staff).toHaveURL(/\/akses$/);
  await staffContext.close();
});

test("an invitation can be revoked before it is used", async ({ page }) => {
  const email = `cabut-${Date.now()}@geraiexpress.test`;
  await signIn(page, "owner-a@geraiexpress.test");
  await page.goto("/anggota");
  await page.getByLabel("Email staf").fill(email);
  await page.getByRole("radio", { name: "Admin gerai" }).check();
  await page.getByRole("button", { name: "Buat undangan" }).click();
  const row = page.getByTestId("invitation").filter({ hasText: email });
  await expect(row).toContainText("Admin gerai");
  await row.getByRole("button", { name: /Cabut undangan/ }).click();
  await expect(page.getByTestId("invitation").filter({ hasText: email })).toHaveCount(0);
});

test("the only admin of a gerai cannot step down or remove themselves", async ({ page }) => {
  await signIn(page, "owner-b@geraiexpress.test");
  await page.goto("/anggota");
  const me = page.getByTestId("member").filter({ hasText: "owner-b@geraiexpress.test" });
  await me.getByText("Atur owner-b@geraiexpress.test…").click();
  await me.getByRole("radio", { name: "Operator" }).check();
  await me.getByRole("button", { name: "Simpan peran" }).click();
  await expect(me.getByRole("alert")).toHaveText(/minimal satu admin gerai/);
});

test("operators and demo sessions get no member management", async ({ page }) => {
  await signIn(page, "operator-a@geraiexpress.test");
  await expect(page.getByRole("link", { name: "Anggota" })).toHaveCount(0);
  expect((await page.goto("/anggota"))?.status()).toBe(404);
  await page.context().clearCookies();
  await startDemo(page);
  await expect(page.getByRole("link", { name: "Anggota" })).toHaveCount(0);
  expect((await page.goto("/anggota"))?.status()).toBe(404);
});
