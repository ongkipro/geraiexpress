// PR-4 / PR-5 / PR-6 / PR-7 / PR-9 / UX-1 / UX-3: contact reuse → draft → simulated quote →
// explicit confirmation → sample label, plus unknown-outcome recovery and foreign access.
import { actAsVisitor, expect, randomVisitorIp, test } from "./fixtures";
import { expectNoHorizontalOverflow, localSql, sessionUserId, signIn, startDemo } from "./helpers";

test("complete simulated counter flow with saved contacts", async ({ page }) => {
  await startDemo(page);
  await page.getByRole("link", { name: "Buat pengiriman" }).filter({ visible: true }).first().click();
  await page.getByRole("button", { name: "Mulai draf baru" }).click();
  await expect(page).toHaveURL(/\/pengiriman\/[0-9a-f-]{36}$/);

  await page.getByLabel("Pilih pengirim tersimpan").selectOption({ label: "Budi Santoso (contoh) · 081200000001" });
  await expect(page.getByLabel("Nama pengirim")).toHaveValue("Budi Santoso (contoh)");
  await page.getByLabel("Pilih penerima tersimpan").selectOption({ label: "Sari Wulandari (contoh) · 081200000003" });
  await expect(page.getByLabel("Alamat tersimpan")).toBeVisible();
  await page.getByLabel("Isi paket").fill("Buku pelajaran");
  await page.getByLabel("Berat (gram)").fill("1500");
  await expectNoHorizontalOverflow(page);

  await page.getByRole("button", { name: "Simpan & cek ongkir" }).click();
  await expect(page.getByText("Ongkir diperbarui")).toBeVisible();
  await expect(page.getByText("Harga contoh (simulasi)").first()).toBeVisible();
  const reguler = page.locator("label").filter({ hasText: "Reguler" });
  const price = (await reguler.locator(".tabular").textContent())!.trim();
  await reguler.click();
  await page.getByRole("button", { name: "Periksa & konfirmasi" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Ini simulasi")).toBeVisible();
  await dialog.getByRole("button", { name: "Konfirmasi & terbitkan resi" }).click();

  await expect(page.getByText(/Resi simulasi sudah terbit/)).toBeVisible();
  await expect(page.getByText(/^SIM\d+ \(simulasi\)$/)).toBeVisible();
  // The issued customer charge is exactly the service price that was reviewed (PR-22).
  await expect(page.locator("dd").filter({ hasText: /^Rp/ }).first()).toHaveText(price);
  await page.getByRole("button", { name: "Siapkan label" }).click();
  await expect(page).toHaveURL(/\/label$/);
  await expect(page.getByText("CONTOH — BUKAN LABEL KURIR")).toBeVisible();
  await expect(page.getByTestId("label-awb")).toHaveText(/^SIM\d+$/);
  await expect(page.getByRole("article", { name: "Label contoh" })).toContainText(price);
  await expectNoHorizontalOverflow(page);
});

test("missing fields block quoting and keep entered values", async ({ page }) => {
  await startDemo(page);
  await page.goto("/pengiriman/baru");
  await page.getByRole("button", { name: "Mulai draf baru" }).click();
  await page.getByLabel("Nama pengirim").fill("Hanya Nama");
  await page.getByRole("button", { name: "Simpan & cek ongkir" }).click();
  await expect(page.getByText("Lengkapi data yang ditandai sebelum cek ongkir.")).toBeVisible();
  await expect(page.getByLabel("Nama pengirim")).toHaveValue("Hanya Nama");
  await expect(page.getByLabel("No. HP pengirim")).toHaveAttribute("aria-invalid", "true");
});

test("editing after a quote requires a new quote before confirmation", async ({ page }) => {
  await startDemo(page);
  await page.goto("/pengiriman/baru");
  await page.getByRole("button", { name: "Mulai draf baru" }).click();
  await page.getByLabel("Pilih pengirim tersimpan").selectOption({ index: 1 });
  await page.getByLabel("Pilih penerima tersimpan").selectOption({ index: 1 });
  await page.getByLabel("Isi paket").fill("Kain");
  await page.getByLabel("Berat (gram)").fill("800");
  await page.getByRole("button", { name: "Simpan & cek ongkir" }).click();
  await expect(page.getByRole("button", { name: "Periksa & konfirmasi" })).toBeVisible();
  await page.getByLabel("Berat (gram)").fill("2500");
  await expect(page.getByText(/Data berubah sejak ongkir dicek/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Periksa & konfirmasi" })).toHaveCount(0);
});

test("unknown outcome is reconciled without a second order", async ({ page }) => {
  await startDemo(page);
  await page.getByRole("link", { name: "Periksa" }).first().click();
  await expect(page.getByText(/Jangan buat pengiriman baru untuk paket ini/)).toBeVisible();
  await page.getByRole("button", { name: "Periksa status operasi asli" }).click();
  await expect(page.getByText(/Tidak ada pesanan kedua yang dibuat/)).toBeVisible();
  await expect(page.getByText("Resi terbit").first()).toBeVisible();
});

test("an operator sees an unknown outcome but must escalate to the admin (DEC-008)", async ({ page }) => {
  await startDemo(page);
  localSql(`update public.memberships set role = 'operator' where user_id = '${await sessionUserId(page)}'`);
  await page.getByRole("link", { name: "Periksa" }).first().click();
  await expect(page.getByText(/Jangan buat pengiriman baru untuk paket ini/)).toBeVisible();
  await expect(page.getByText("Minta admin gerai memeriksa status operasi asli.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Periksa status operasi asli" })).toHaveCount(0);
});

test("another tenant's shipment is not found", async ({ page }) => {
  await signIn(page, "owner-a@geraiexpress.test");
  await expect(page).toHaveURL(/\/pengiriman$/);
  const res = await page.goto("/pengiriman/00000000-0000-4000-e000-00000000000b");
  expect(res?.status()).toBe(404);
});

test("real tenant without a provider cannot quote and is told why", async ({ page }) => {
  await signIn(page, "owner-a@geraiexpress.test");
  await page.goto("/pengiriman/00000000-0000-4000-e000-00000000000a");
  await page.getByLabel("Nama penerima").fill("Penerima A");
  await page.getByLabel("No. HP penerima").fill("081211112222");
  await page.getByLabel("Alamat lengkap").fill("Jl. Tujuan A No. 9");
  await page.getByLabel("Kecamatan / kota").fill("Kec. Tujuan, Kota A");
  await page.getByRole("button", { name: "Simpan & cek ongkir" }).click();
  await expect(page.getByText(/Akun Mengantar gerai ini belum terhubung/)).toBeVisible();
});

async function quotedDraft(page: import("@playwright/test").Page) {
  await page.goto("/pengiriman/baru");
  await page.getByRole("button", { name: "Mulai draf baru" }).click();
  await expect(page).toHaveURL(/\/pengiriman\/[0-9a-f-]{36}$/);
  await page.getByLabel("Pilih pengirim tersimpan").selectOption({ index: 1 });
  await page.getByLabel("Pilih penerima tersimpan").selectOption({ index: 1 });
  await page.getByLabel("Isi paket").fill("Kain");
  await page.getByLabel("Berat (gram)").fill("900");
  await page.getByRole("button", { name: "Simpan & cek ongkir" }).click();
  await expect(page.getByRole("button", { name: "Periksa & konfirmasi" })).toBeVisible();
}

test("quoting again without edits does not duplicate services", async ({ page }) => {
  await startDemo(page);
  await quotedDraft(page);
  await page.getByRole("button", { name: "Simpan & cek ongkir" }).click();
  await expect(page.getByText("Ongkir diperbarui")).toBeVisible();
  await expect(page.locator('input[type="radio"][name="quote"]')).toHaveCount(3);
});

test("double confirmation creates one operation", async ({ page }) => {
  await startDemo(page);
  await quotedDraft(page);
  await page.getByRole("button", { name: "Periksa & konfirmasi" }).click();
  await page.getByRole("button", { name: "Konfirmasi & terbitkan resi" }).dblclick();
  await expect(page.getByText(/Resi simulasi sudah terbit/)).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: /^Dikonfirmasi/ })).toHaveCount(1);
});

test("confirming from a second, stale tab returns the original order", async ({ browser }) => {
  const context = await browser.newContext();
  await actAsVisitor(context, test.info().project.use.baseURL!, randomVisitorIp());
  const first = await context.newPage();
  await startDemo(first);
  await quotedDraft(first);
  const second = await context.newPage();
  await second.goto(first.url());
  await expect(second.getByRole("button", { name: "Periksa & konfirmasi" })).toBeVisible();

  await first.bringToFront();
  await first.getByRole("button", { name: "Periksa & konfirmasi" }).click();
  await first.getByRole("button", { name: "Konfirmasi & terbitkan resi" }).click();
  await expect(first.getByText(/Resi simulasi sudah terbit/)).toBeVisible();
  const awb = (await first.getByText(/^SIM\d+ \(simulasi\)$/).textContent())!;

  await second.bringToFront();
  await second.getByRole("button", { name: "Periksa & konfirmasi" }).click();
  await second.getByRole("button", { name: "Konfirmasi & terbitkan resi" }).click();
  await expect(second.getByText(awb, { exact: true })).toBeVisible();
  await expect(second.getByRole("listitem").filter({ hasText: /^Dikonfirmasi/ })).toHaveCount(1);
  await context.close();
});

test("saving a typed recipient as a contact is explicit and visible in Kontak", async ({ page }) => {
  await startDemo(page);
  await page.goto("/pengiriman/baru");
  await page.getByRole("button", { name: "Mulai draf baru" }).click();
  await page.getByLabel("Nama penerima").fill("Penerima Baru Disimpan");
  await page.getByLabel("No. HP penerima").fill("081299990000");
  await page.getByLabel("Alamat lengkap").fill("Jl. Baru Disimpan No. 2");
  await page.getByLabel("Kecamatan / kota").fill("Kec. Baru, Kota Uji");
  await page.getByRole("checkbox", { name: "Simpan sebagai kontak penerima" }).click();
  await page.getByRole("button", { name: "Simpan draf" }).click();
  await expect(page.getByText("Draf tersimpan.")).toBeVisible();
  await page.goto("/kontak?q=Penerima Baru");
  await expect(page.getByRole("link", { name: /Penerima Baru Disimpan/ })).toBeVisible();
});

test("label is reused, never regenerated, and print hides the app shell", async ({ page }) => {
  await startDemo(page);
  await page.goto("/pengiriman?status=issued");
  await page.locator("[data-testid=shipment-ref]").filter({ visible: true }).first().click();
  await expect(page).toHaveURL(/\/pengiriman\/[0-9a-f-]{36}$/);
  await page.getByRole("button", { name: "Siapkan label" }).click();
  await expect(page).toHaveURL(/\/label$/);
  const detail = page.url().replace(/\/label$/, "");
  await page.goto(detail);
  await expect(page.getByRole("link", { name: "Lihat & cetak label" })).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: /^Label siap/ })).toHaveCount(1);

  await page.goto(detail + "/label");
  await page.emulateMedia({ media: "print" });
  await expect(page.getByRole("article", { name: "Label contoh" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Cetak" })).toBeHidden();
  await expect(page.getByText("Demo · Simulasi.")).toBeHidden();
});

test("label page for a shipment without an AWB redirects back to its detail", async ({ page }) => {
  await startDemo(page);
  await page.goto("/pengiriman?status=draft");
  await page.locator("[data-testid=shipment-ref]").filter({ visible: true }).first().click();
  await expect(page).toHaveURL(/\/pengiriman\/[0-9a-f-]{36}$/);
  const detail = page.url();
  await page.goto(detail + "/label");
  await expect(page).toHaveURL(detail);
});

test("another tenant's label is not found", async ({ page }) => {
  await signIn(page, "owner-a@geraiexpress.test");
  const res = await page.goto("/pengiriman/00000000-0000-4000-e000-00000000000b/label");
  expect(res?.status()).toBe(404);
});
