// T-051 (SUP-14, SUP-16, SUP-08): Bahasa not-found pages with a way back, the gerai switcher,
// "Tutup" on dialogs and sheets, and the intake note about dimensions. Runs at 390 and 1280.
import { expect, test } from "./fixtures";
import { atDashboard, chooseOption, expectNoHorizontalOverflow, openSessionActions, optionTexts, signIn, startDemo } from "./helpers";

const UNKNOWN_SHIPMENT = "00000000-0000-4000-e000-0000000000ff";

test("a denied page is a Bahasa not-found with a link back, and shows no stack or secret", async ({ page }) => {
  // The same answer as a page that does not exist (SEC): /admin for a person without platform access.
  await signIn(page, "no-access@geraiexpress.test");
  const response = await page.goto("/admin");
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "Halaman tidak ditemukan" })).toBeVisible();
  await expect(page.getByText("could not be found")).toHaveCount(0);
  const back = page.getByRole("link", { name: "Kembali ke beranda" });
  await expect(back).toHaveAttribute("href", "/");
  await expectNoHorizontalOverflow(page);
  await expect(page.locator("body")).not.toContainText(/at\s+\S+\s+\(|node_modules|AUTH_JWT_SECRET|PGRST|secret/i);
});

test("inside a gerai, a missing record shows the workspace not-found and leads back to Pengiriman", async ({ page }) => {
  await signIn(page, "operator-a@geraiexpress.test");
  const response = await page.goto(`/pengiriman/${UNKNOWN_SHIPMENT}`);
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "Halaman atau data tidak ditemukan" })).toBeVisible();
  await expect(page.getByTestId("tenant-name").filter({ visible: true }).first()).toHaveText("Gerai Uji A");
  await expectNoHorizontalOverflow(page);
  await page.getByRole("link", { name: "Kembali ke Pengiriman" }).click();
  await expect(page).toHaveURL(/\/pengiriman$/);
});

test("a person with several gerai switches without signing out and then sees only the other gerai", async ({ page }) => {
  await signIn(page, "multi@geraiexpress.test");
  await expect(page).toHaveURL(/\/pilih-gerai$/);
  await page.getByRole("button", { name: "Gerai Uji B" }).click();
  // UX-16: choosing a gerai lands on the Dashboard; its "Terbaru" list shows Gerai Uji B's only shipment.
  await expect(page).toHaveURL(atDashboard);
  await expect(page.getByTestId("tenant-name").filter({ visible: true }).first()).toHaveText("Gerai Uji B");
  await expect(page.getByText("GXTEST-B1").filter({ visible: true }).first()).toBeVisible();

  // T-079: "Ganti gerai" is an account-menu item from 768 px and a sheet button below it.
  const switchGerai = (await openSessionActions(page))("Ganti gerai");
  await switchGerai.click();
  await expect(page).toHaveURL(/\/pilih-gerai$/);
  await expect(page.getByRole("heading", { name: "Pilih gerai" })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.getByRole("button", { name: "Gerai Uji A" }).click();
  await expect(page).toHaveURL(atDashboard);
  await expect(page.getByTestId("tenant-name").filter({ visible: true }).first()).toHaveText("Gerai Uji A");
  // Gerai Uji A has more than five shipments, so its fixture row is checked on the list.
  await page.goto("/pengiriman?q=GXTEST");
  await expect(page.getByText("GXTEST-A1").filter({ visible: true }).first()).toBeVisible();
  await expect(page.getByText("GXTEST-B1")).toHaveCount(0);
});

test("/pilih-gerai renders while a gerai is chosen, marks it, and shows the refusal message", async ({ page }) => {
  await signIn(page, "multi@geraiexpress.test");
  await page.getByRole("button", { name: "Gerai Uji B" }).click();
  await expect(page).toHaveURL(atDashboard); // UX-16: gerai switch lands on the Dashboard.
  await page.goto("/pilih-gerai?galat=1");
  await expect(page).toHaveURL(/\/pilih-gerai\?galat=1$/);
  await expect(page.getByRole("alert").filter({ hasText: "Gerai itu tidak tersedia untuk akun Anda" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Gerai Uji B \(sedang dipakai\)/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Gerai Uji A" })).toBeVisible();
});

test("a person with one gerai has no switcher and is sent past /pilih-gerai", async ({ page }) => {
  await signIn(page, "owner-b@geraiexpress.test");
  await expect(page).toHaveURL(atDashboard); // UX-16: sign-in lands on the Dashboard.
  const action = await openSessionActions(page);
  await expect(action("Keluar")).toBeVisible();
  await expect(action("Ganti gerai")).toHaveCount(0);
  await page.goto("/pilih-gerai");
  await expect(page).not.toHaveURL(/\/pilih-gerai/);
});

test("dialog and sheet close buttons are announced as Tutup", async ({ page }) => {
  await startDemo(page);
  // The menu sheet exists below 768 px (T-079: from 768 px the app header replaces the mobile top bar).
  if ((page.viewportSize()?.width ?? 1280) < 768) {
    await page.getByRole("button", { name: "Buka menu" }).click();
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByRole("button", { name: "Tutup", exact: true })).toBeVisible();
    await expect(sheet.getByRole("button", { name: "Close", exact: true })).toHaveCount(0);
    await sheet.getByRole("button", { name: "Tutup", exact: true }).click();
    await expect(sheet).toHaveCount(0);
  }

  await page.goto("/pengiriman/baru");
  await page.getByRole("button", { name: "Mulai draf baru" }).click();
  await expect(page).toHaveURL(/\/pengiriman\/[0-9a-f-]{36}$/);
  await chooseOption(page, "Pilih pengirim tersimpan", { index: 1 });
  await chooseOption(page, "Pilih penerima tersimpan", { index: 1 });
  await page.getByLabel("Isi paket").fill("Kain");
  await page.getByLabel("Berat (gram)").fill("900");
  await page.getByRole("button", { name: "Simpan & cek ongkir" }).click();
  await page.getByRole("button", { name: "Periksa & konfirmasi" }).click();
  const dialog = page.getByRole("dialog");
  const close = dialog.getByRole("button", { name: "Tutup", exact: true });
  await expect(close).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Close", exact: true })).toHaveCount(0);
  await close.click();
  await expect(dialog).toHaveCount(0);
});

test("live and demo intake explain per-courier billable weight and reweigh settlement", async ({ page }) => {
  const NOTE = "Berat ditagih mengikuti aturan tiap kurir (ukuran opsional).";
  await signIn(page, "operator-a@geraiexpress.test");
  await page.goto("/pengiriman/00000000-0000-4000-e000-00000000000a");
  await expect(page.getByText(NOTE)).toBeVisible();
  await expect(page.getByLabel("Panjang (cm)")).toHaveAttribute("aria-describedby", /dims-note/);
  await expectNoHorizontalOverflow(page);

  await page.context().clearCookies();
  await startDemo(page);
  await page.goto("/pengiriman/baru");
  await page.getByRole("button", { name: "Mulai draf baru" }).click();
  await expect(page.getByLabel("Panjang (cm)")).toBeVisible();
  await expect(page.getByText(NOTE)).toBeVisible();
  await expect(page.getByText(/selisih ongkir didebit atau dikreditkan/)).toBeVisible();
  await expect(page.getByLabel("Panjang (cm)")).toHaveAttribute("aria-describedby", /dims-note/);
});

test("the contact search keeps the draft form and puts the term in the address", async ({ page }) => {
  await startDemo(page);
  await page.goto("/pengiriman/baru");
  await page.getByRole("button", { name: "Mulai draf baru" }).click();
  await expect(page).toHaveURL(/\/pengiriman\/[0-9a-f-]{36}$/);
  await page.getByLabel("Isi paket").fill("Catatan tetap");
  await page.getByLabel("Cari kontak tersimpan (nama atau nomor HP)").fill("Budi");
  // Enter searches and does not submit the draft.
  await page.getByLabel("Cari kontak tersimpan (nama atau nomor HP)").press("Enter");
  await expect(page).toHaveURL(/[?&]kontak=Budi(&|$)/);
  await expect(page.getByLabel("Isi paket")).toHaveValue("Catatan tetap");
});

test("a typed +62 phone finds the stored contact, and an unsaved pick survives a later search", async ({ page }) => {
  await startDemo(page);
  await page.goto("/pengiriman/baru");
  await page.getByRole("button", { name: "Mulai draf baru" }).click();
  await expect(page).toHaveURL(/\/pengiriman\/[0-9a-f-]{36}$/);
  const search = page.getByLabel("Cari kontak tersimpan (nama atau nomor HP)");
  const sender = page.getByLabel("Pilih pengirim tersimpan");
  await chooseOption(page, "Pilih pengirim tersimpan", "Budi Santoso (contoh) · 081200000001");
  await expect(page.getByLabel("Nama pengirim")).toHaveValue("Budi Santoso (contoh)");

  // A later search that does not match Budi must not drop the picked sender from the dropdown.
  await search.fill("Sari");
  await search.press("Enter");
  await expect(page).toHaveURL(/[?&]kontak=Sari(&|$)/);
  await expect(page.getByTestId("contact-search-status")).toBeVisible();
  await expect(sender).toHaveText("Budi Santoso (contoh) · 081200000001");
  await expect(page.getByLabel("Nama pengirim")).toHaveValue("Budi Santoso (contoh)");

  // International and dashed phone input is normalized to the stored 0-form.
  await search.fill("+62 812-0000-0003");
  await search.press("Enter");
  await expect(page).toHaveURL(/[?&]kontak=/);
  const recipients = await optionTexts(page, "Pilih penerima tersimpan");
  expect(recipients.filter((t) => t.includes("Sari Wulandari (contoh) · 081200000003"))).toHaveLength(1);
  expect(recipients.filter((t) => t.includes("Budi Santoso"))).toHaveLength(0);
  await expectNoHorizontalOverflow(page);
});
