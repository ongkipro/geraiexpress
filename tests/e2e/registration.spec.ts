// PR-29 / PR-30 / PR-15 / PR-32 / UX-7 / DEC-007: email-first registration, password after
// verification, resumable application, Super Admin approval, then the gerai workspace.
import { actAsVisitor, expect, randomVisitorIp, test } from "./fixtures";
import { expectNoHorizontalOverflow, expectTouchTargets, localSql, mailCode, signIn, signInAdmin } from "./helpers";

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
  await page.getByLabel("Nama outlet pertama").fill("Outlet E2E");
  await page.getByLabel("Alamat pickup outlet").fill("Jl. Uji E2E No. 5");
  await page.getByLabel("Kecamatan / kota").fill("Kec. Uji, Kota E2E");
  await page.getByLabel("No. HP penanggung jawab").fill("081233334444");
  await page.getByRole("button", { name: "Ajukan untuk ditinjau" }).click();
  await expect(page.getByRole("heading", { name: "Sedang ditinjau" })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  // A Super Admin approves it in a separate session.
  const baseURL = test.info().project.use.baseURL!;
  const admin = await browser.newContext({ baseURL });
  await actAsVisitor(admin, baseURL, randomVisitorIp());
  const adminPage = await admin.newPage();
  await signInAdmin(adminPage);
  await adminPage.goto("/admin/pengajuan");
  const row = adminPage.getByTestId("application").filter({ hasText: business });
  await row.getByText(`Tinjau ${business}…`).click();
  await row.getByLabel("Alasan (dicatat di audit)").fill("Data lengkap dan jelas");
  await row.getByRole("button", { name: "Setujui" }).click();
  await expect(adminPage.getByRole("status").filter({ hasText: /Disetujui\. Gerai aktif/ })).toBeVisible();
  await expect(adminPage).toHaveURL(/status=approved/);
  await expect(adminPage.getByTestId("application").filter({ hasText: business })).toContainText("Data lengkap dan jelas");
  await admin.close();

  await page.goto("/");
  await expect(page).toHaveURL(/\/pengiriman$/);
  await expect(page.getByTestId("tenant-name").first()).toHaveText(business);

  // Returning: the password set after verification now signs in.
  await page.context().clearCookies();
  await page.goto("/masuk");
  await page.getByRole("textbox", { name: "Email" }).fill(email);
  await page.getByLabel("Kata sandi").fill("sandi-pemohon-123");
  await page.getByRole("button", { name: "Masuk", exact: true }).click();
  await expect(page).toHaveURL(/\/pengiriman$/);
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
  await signInAdmin(page);
  await expect(page.getByTestId("registration-state")).toContainText("Terbuka");
  try {
    await page.getByText("Tutup pendaftaran…").click();
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
  await page.getByRole("link", { name: "Ajukan gerai Anda sendiri" }).click();
  await expect(page).toHaveURL(/\/daftar\/gerai$/);
  await expect(page.getByRole("heading", { name: "Data gerai" })).toBeVisible();
  expect((await page.goto("/admin"))?.status()).toBe(404);
});
