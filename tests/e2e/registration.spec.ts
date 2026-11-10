// PR-29 / PR-30 / PR-15 / PR-32 / UX-7 / DEC-007: email-first registration, password after
// verification, resumable application, Super Admin approval, then the gerai workspace.
import { actAsVisitor, expect, randomVisitorIp, test } from "./fixtures";
import { atDashboard, expectNoHorizontalOverflow, expectTouchTargets, localSql, mailCode, signIn, signInAdmin } from "./helpers";

test("a new applicant verifies email, sets a password, applies, and works after approval", async ({ page, browser }) => {
  test.setTimeout(90_000);
  const email = `daftar-${Date.now()}-${Math.floor(Math.random() * 1e4)}@geraiexpress.test`;
  const business = `Toko E2E ${Date.now()}`;
  await page.goto("/masuk");
  await page.getByRole("link", { name: "Daftarkan gerai" }).click();
  await expect(page).toHaveURL(/\/daftar$/);
  await page.waitForLoadState("networkidle");
  await expectNoHorizontalOverflow(page);
  await expectTouchTargets(page);
  await page.getByRole("textbox", { name: "Email", exact: true }).fill(email);
  await page.getByRole("button", { name: "Kirim kode" }).click();
  await expect(page.getByText(/kode 6 digit sudah dikirim/)).toBeVisible();
  await page.getByLabel("Kode 6 digit dari email").fill(await mailCode(email));
  await page.getByRole("button", { name: "Verifikasi" }).click();

  await expect(page).toHaveURL(/\/daftar\/kata-sandi$/);
  await page.getByLabel("Kata sandi baru").fill("pendek");
  await page.getByLabel("Ulangi kata sandi").fill("pendek");
  await page.getByRole("button", { name: "Simpan kata sandi" }).click();
  await expect(page.getByText("Minimal 10 karakter.")).toBeVisible();
  // React resets the form after the action; wait for it before typing again.
  await expect(page.getByLabel("Kata sandi baru")).toHaveValue("");
  await page.getByLabel("Kata sandi baru").fill("sandi-pemohon-123");
  await page.getByLabel("Ulangi kata sandi").fill("sandi-pemohon-123");
  await page.getByRole("button", { name: "Simpan kata sandi" }).click();

  await expect(page).toHaveURL(/\/daftar\/gerai$/);
  await page.getByLabel("Nama bisnis / gerai").fill(business);
  await page.getByRole("button", { name: "Simpan draf" }).click();
  await expect(page.getByText("Draf tersimpan.")).toBeVisible();
  // Resumable: a reload keeps the draft.
  await page.reload();
  await expect(page.getByLabel("Nama bisnis / gerai")).toHaveValue(business);
  await page.getByRole("button", { name: "Ajukan untuk ditinjau" }).click();
  await expect(page.getByText("Wajib diisi untuk mengajukan.").first()).toBeVisible();
  await page.getByLabel("Nama cabang pertama").fill("Outlet E2E");
  await page.getByLabel("Alamat pickup gerai").fill("Jl. Uji E2E No. 5");
  await page.getByLabel("Kecamatan / kota").fill("Kec. Uji, Kota E2E");
  await page.getByLabel("No. HP penanggung jawab").fill("081233334444");
  await page.getByRole("button", { name: "Ajukan untuk ditinjau" }).click();
  await expect(page.getByRole("heading", { name: "Sedang ditinjau" })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  // T-107: withdrawing confirms first and names the gerai; Kembali/Escape leaves it under review.
  const withdraw = page.getByRole("button", { name: "Batalkan pengajuan", exact: true });
  await withdraw.click();
  const withdrawDialog = page.getByRole("dialog", { name: `Batalkan pengajuan ${business}?` });
  await expect(withdrawDialog.getByRole("button", { name: "Ya, batalkan pengajuan" })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath(`dialog-withdraw-application-${page.viewportSize()?.width}.png`), animations: "disabled" });
  await page.keyboard.press("Escape");
  await expect(withdrawDialog).toHaveCount(0);
  await expect(withdraw).toBeFocused();
  await expect(page.getByRole("heading", { name: "Sedang ditinjau" })).toBeVisible();

  // A Super Admin approves it in a separate session.
  const baseURL = test.info().project.use.baseURL!;
  const admin = await browser.newContext({ baseURL });
  await actAsVisitor(admin, baseURL, randomVisitorIp());
  const adminPage = await admin.newPage();
  await signInAdmin(adminPage, "admin-2@geraiexpress.test");
  await adminPage.goto("/admin/pengajuan");
  const row = adminPage.getByTestId("application").filter({ hasText: business });
  // The application opens in a detail pane (split view); the decision is confirmed in a dialog with the reason.
  await row.getByRole("link").click();
  await adminPage.getByTestId("application-detail").getByRole("button", { name: `Setujui ${business}` }).click();
  await adminPage.getByRole("dialog").getByLabel("Alasan (dicatat di audit)").fill("Data lengkap dan jelas");
  await adminPage.getByRole("dialog").getByRole("button", { name: "Setujui" }).click();
  await expect(adminPage.getByRole("status").filter({ hasText: /Disetujui\. Gerai aktif/ })).toBeVisible();
  await expect(adminPage).toHaveURL(/status=approved/);
  await expect(adminPage.getByTestId("application").filter({ hasText: business })).toContainText("Data lengkap dan jelas");
  await admin.close();

  await page.goto("/");
  await expect(page).toHaveURL(atDashboard); // UX-16: the approved applicant gets the Dashboard at "/".
  await expect(page.getByTestId("tenant-name").first()).toHaveText(business);

  // Returning: the password set after verification now signs in.
  await page.context().clearCookies();
  await page.goto("/masuk");
  await page.getByRole("textbox", { name: "Email" }).fill(email);
  await page.getByLabel("Kata sandi").fill("sandi-pemohon-123");
  await page.getByRole("button", { name: "Masuk", exact: true }).click();
  await expect(page).toHaveURL(atDashboard); // UX-16: sign-in lands on the Dashboard.
});

test("while registration is closed the public pages say so and point invited staff to the code entry", async ({ page }) => {
  localSql(`update private.settings set value = 'false' where key = 'registration_open'`);
  try {
    await page.goto("/daftar");
    await expect(page.getByText(/Pendaftaran gerai baru belum dibuka\. Jika Anda diundang/)).toBeVisible();
    await page.goto("/masuk");
    await expect(page.getByRole("link", { name: "Daftarkan gerai" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Masuk dengan kode email" })).toBeVisible();
  } finally {
    localSql(`update private.settings set value = 'true' where key = 'registration_open'`);
  }
});

test("the Super Admin switch closes and reopens public registration with an audited reason", async ({ page }) => {
  await signInAdmin(page, "admin-2@geraiexpress.test");
  await expect(page.getByTestId("registration-state")).toContainText("Terbuka");
  try {
    // The gate is a switch now; flipping it opens a confirmation dialog with the reason.
    await page.getByRole("switch", { name: "Pendaftaran publik" }).click();
    await page.getByLabel("Alasan (dicatat di audit)").first().fill("Uji e2e tutup");
    await page.getByRole("button", { name: "Tutup pendaftaran" }).click();
    await expect(page.getByTestId("registration-state")).toContainText("Tertutup");
  } finally {
    localSql(`update private.settings set value = 'true' where key = 'registration_open'`);
  }
  await page.goto("/admin/audit?jenis=registration.toggle");
  await expect(page.getByTestId("audit-event").filter({ hasText: "Uji e2e tutup" }).first()).toBeVisible();
});

test("an applicant only ever sees their own application page, never a workspace", async ({ page }) => {
  await signIn(page, "no-access@geraiexpress.test");
  await expect(page).toHaveURL(/\/akses$/);
  // UX-8: /akses names its way forward "Daftarkan gerai", like /masuk (was "Ajukan gerai Anda sendiri").
  await page.getByRole("link", { name: "Daftarkan gerai" }).click();
  await expect(page).toHaveURL(/\/daftar\/gerai$/);
  await expect(page.getByRole("heading", { name: "Data gerai" })).toBeVisible();
  expect((await page.goto("/admin"))?.status()).toBe(404);
});

// SUP-20 / UX-7 / UI-5: the code step can ask for a new code, change the email, and ties its error
// to the field. A double-click on the resend control sends one request (UX-1 step 5).
test("the code step resends once per click, changes the email and links its error to the field", async ({ page }) => {
  test.setTimeout(90_000);
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
  const first = `salah-${stamp}@geraiexpress.test`;
  const second = `benar-${stamp}@geraiexpress.test`;
  let actionPosts = 0;
  page.on("request", (r) => {
    if (r.method() === "POST" && r.headers()["next-action"]) actionPosts++;
  });

  await page.goto("/daftar");
  await page.waitForLoadState("networkidle");
  const sendCode = page.getByRole("button", { name: "Kirim kode" });
  await page.getByRole("textbox", { name: "Email", exact: true }).fill(first);
  await expect(sendCode).not.toHaveAttribute("aria-disabled", "true");
  await sendCode.click();
  await expect(page.getByText(/kode 6 digit sudah dikirim/)).toBeVisible();
  const binding = (await page.context().cookies()).find((cookie) => cookie.name === "gx_verify_state");
  expect(binding).toMatchObject({ httpOnly: true, sameSite: "Lax", path: "/daftar" });
  // The verification form posts code (and CAPTCHA), never a browser-selected address or state token.
  await expect(page.locator("form").filter({ has: page.locator("#reg-code") }).locator('input[name="email"], input[name="state"], input[name="token"]')).toHaveCount(0);

  // The error belongs to the code field.
  await page.getByLabel("Kode 6 digit dari email").fill("000000");
  await page.getByRole("button", { name: "Verifikasi" }).click();
  const codeInput = page.locator("#reg-code");
  await expect(codeInput).toHaveAttribute("aria-invalid", "true");
  await expect(codeInput).toHaveAttribute("aria-describedby", "reg-code-err");
  await expect(page.locator("#reg-code-err")).toContainText("Kode tidak cocok");

  // Resend: one request for a double-click, with a visible result.
  const resend = page.getByRole("button", { name: "Kirim ulang kode" });
  await expect(resend).toBeVisible();
  await expect(resend).not.toHaveAttribute("aria-disabled", "true");
  const before = actionPosts;
  await resend.dblclick();
  await expect(page.getByRole("status").filter({ hasText: `Kode baru diminta untuk ${first}` })).toBeVisible();
  await page.waitForTimeout(600);
  expect(actionPosts - before).toBe(1);

  // Change the email: back to the email step with the old value, then through to verification.
  await page.getByRole("button", { name: "Ganti email" }).click();
  const email = page.getByRole("textbox", { name: "Email", exact: true });
  await expect(email).toHaveValue(first);
  expect((await page.context().cookies()).some((cookie) => cookie.name === "gx_verify_state")).toBe(false);
  await email.fill(second);
  const sendAgain = page.getByRole("button", { name: "Kirim kode" });
  await expect(sendAgain).not.toHaveAttribute("aria-disabled", "true");
  await sendAgain.click();
  await expect(page.getByText(new RegExp(`Kode dikirim ke ${second}`))).toBeVisible();
  // The old address's "Kode tidak cocok" must not follow the user to the new address.
  await expect(page.locator("#reg-code-err")).toHaveCount(0);
  await expect(page.locator("#reg-code")).not.toHaveAttribute("aria-invalid", "true");
  await page.getByLabel("Kode 6 digit dari email").fill(await mailCode(second));
  await page.getByRole("button", { name: "Verifikasi" }).click();
  await expect(page).toHaveURL(/\/daftar\/kata-sandi$/);
});
