// PR-31 / PR-32 / UX-8 / DEC-007 / DEC-008: staff invitation, acceptance and member management.
import type { Route } from "@playwright/test";
import { actAsVisitor, expect, randomVisitorIp, test } from "./fixtures";
import { atDashboard, expectNoHorizontalOverflow, expectTouchTargets, localSql, mailCode, signIn, startDemo } from "./helpers";

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
    // UI v4: the invitation card lists Gerai, Peran and Berlaku sampai as separate rows (was "Sebagai Operator").
    await expect(invite).toContainText(/PeranOperator/);
    // T-075: the invitee sees who invited them (the inviter's sign-in email, only while they are an active admin).
    await expect(invite.getByTestId("invitation-inviter")).toHaveText("owner-a@geraiexpress.test");
    await expectTouchTargets(staff);
    await invite.getByRole("button", { name: /Terima/ }).click();
    await expect(staff).toHaveURL(atDashboard); // UX-16: accepting an invitation lands on the Dashboard.
    await expect(staff.getByTestId("tenant-name").first()).toHaveText("Gerai Uji A");
    // Operators do not manage members.
    expect((await staff.goto("/anggota"))?.status()).toBe(404);
  } finally {
    localSql(`update private.settings set value = 'true' where key = 'registration_open'`);
  }

  // The admin sees the new member and removes them again; access ends at once.
  await page.reload();
  const member = page.getByTestId("member").filter({ hasText: email });
  // Deactivation confirms in a dialog (destructive-action tier); the server action is unchanged.
  await member.getByRole("button", { name: `Nonaktifkan ${email}` }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Nonaktifkan" }).click();
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
  // T-107: revoking confirms in a dialog that names the invited email; Batal and Escape change nothing.
  const revoke = row.getByRole("button", { name: `Cabut undangan untuk ${email}` });
  await revoke.click();
  const dialog = page.getByRole("dialog", { name: "Cabut undangan?" });
  await expect(dialog).toContainText(email);
  await page.screenshot({ path: test.info().outputPath(`dialog-revoke-invite-${page.viewportSize()?.width}.png`), animations: "disabled" });
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(revoke).toBeFocused();
  await expect(row).toBeVisible();
  await revoke.click();
  await dialog.getByRole("button", { name: "Cabut undangan", exact: true }).click();
  await expect(page.getByTestId("invitation").filter({ hasText: email })).toHaveCount(0);
});

// T-107 review: the confirmation dialog unmounts its form when it closes, so the pending guard must live
// outside it. While a revoke is still running, closing the dialog and confirming again must not send a
// second request: the trigger stays disabled and busy until the first one settles.
test("closing and reopening the revoke dialog while the request runs sends one request", async ({ page }) => {
  const email = `cabut-tahan-${Date.now()}@geraiexpress.test`;
  await signIn(page, "owner-a@geraiexpress.test");
  await page.goto("/anggota");
  await page.getByLabel("Email staf").fill(email);
  await page.getByRole("button", { name: "Buat undangan" }).click();
  const row = page.getByTestId("invitation").filter({ hasText: email });
  await expect(row).toBeVisible();
  const held: Route[] = [];
  await page.route(/\/anggota/, async (route) => {
    if (route.request().method() === "POST" && route.request().headers()["next-action"]) held.push(route);
    else await route.continue();
  });
  const revoke = row.getByRole("button", { name: `Cabut undangan untuk ${email}` });
  await revoke.click();
  const dialog = page.getByRole("dialog", { name: "Cabut undangan?" });
  await dialog.getByRole("button", { name: "Cabut undangan", exact: true }).click();
  await expect.poll(() => held.length).toBe(1);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  // The trigger is disabled while the first request is held: no way to reopen and confirm again.
  await expect(revoke).toBeDisabled();
  await expect(revoke).toHaveAttribute("aria-busy", "true");
  await revoke.click({ force: true }).catch(() => {});
  await page.waitForTimeout(600);
  expect(held).toHaveLength(1);
  await page.unroute(/\/anggota/);
  await held[0].continue();
  await expect(page.getByTestId("invitation").filter({ hasText: email })).toHaveCount(0);
});

test("an admin changes a member's role through the dialog and the change shows at once", async ({ page }) => {
  const operator = "operator-a@geraiexpress.test";
  try {
    await signIn(page, "owner-a@geraiexpress.test");
    await page.goto("/anggota");
    const member = page.getByTestId("member").filter({ hasText: operator });
    await member.getByRole("button", { name: `Ubah peran ${operator}` }).click();
    const dialog = page.getByRole("dialog", { name: "Ubah peran" });
    await expect(dialog.getByRole("radio", { name: /Operator/ })).toBeChecked();
    await dialog.getByRole("radio", { name: /Admin gerai/ }).check();
    await dialog.screenshot({ path: test.info().outputPath("member-role-dialog.png") });
    await dialog.getByRole("button", { name: "Simpan peran" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Peran diperbarui." })).toBeVisible();
    await expect(dialog).toHaveCount(0);
    expect(localSql(`select m.role from public.memberships m join auth.users u on u.id = m.user_id
      where m.tenant_id = '00000000-0000-4000-b000-00000000000a' and u.email = '${operator}'`)).toBe("tenant_admin");
  } finally {
    localSql(`update public.memberships m set role = 'operator' from auth.users u
      where u.id = m.user_id and u.email = '${operator}' and m.tenant_id = '00000000-0000-4000-b000-00000000000a'`);
  }
});

test("the only admin of a gerai cannot step down or remove themselves", async ({ page }) => {
  await signIn(page, "owner-b@geraiexpress.test");
  await page.goto("/anggota");
  const me = page.getByTestId("member").filter({ hasText: "owner-b@geraiexpress.test" });
  // Role changes are chosen and confirmed in a dialog.
  await me.getByRole("button", { name: "Ubah peran owner-b@geraiexpress.test" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("radio", { name: /Operator/ }).check();
  await dialog.getByRole("button", { name: "Simpan peran" }).click();
  await expect(dialog.getByRole("alert")).toHaveText(/minimal satu admin gerai/);
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
