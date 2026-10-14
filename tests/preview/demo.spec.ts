// T-018 / PR-21 / DEL-1 stage 2: the public preview works end to end on synthetic demo data.
import { expect, test } from "@playwright/test";

test("health, sign-in page and closed registration", async ({ page, request }) => {
  expect((await request.get("/healthz")).status()).toBe(200);
  await page.goto("/masuk");
  await expect(page.getByRole("heading", { name: "Masuk ke ruang kerja gerai" })).toBeVisible();
  await page.goto("/daftar");
  await expect(page.getByText(/Pendaftaran gerai baru belum dibuka/)).toBeVisible();
});

test("a visitor opens an isolated demo, issues a simulated shipment and prints a sample label", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/masuk");
  await page.getByRole("button", { name: "Coba demo" }).click();
  await expect(page).toHaveURL(/\/pengiriman$/);
  await expect(page.getByText(/Demo · Simulasi/)).toBeVisible();

  await page.getByRole("link", { name: "Buat pengiriman" }).filter({ visible: true }).first().click();
  await page.getByRole("button", { name: "Mulai draf baru" }).click();
  await expect(page).toHaveURL(/\/pengiriman\/[0-9a-f-]{36}$/);
  await page.getByLabel("Pilih pengirim tersimpan").selectOption({ label: "Budi Santoso (contoh) · 081200000001" });
  await page.getByLabel("Pilih penerima tersimpan").selectOption({ label: "Sari Wulandari (contoh) · 081200000003" });
  await page.getByLabel("Isi paket").fill("Buku pelajaran");
  await page.getByLabel("Berat (gram)").fill("1500");
  await page.getByRole("button", { name: "Simpan & cek ongkir" }).click();
  await expect(page.getByText("Harga contoh (simulasi)").first()).toBeVisible();
  await page.locator("label").filter({ hasText: "Reguler" }).click();
  await page.getByRole("button", { name: "Periksa & konfirmasi" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Konfirmasi & terbitkan resi" }).click();
  await expect(page.getByText(/Resi simulasi sudah terbit/)).toBeVisible();
  await page.getByRole("button", { name: "Siapkan label" }).click();
  await expect(page).toHaveURL(/\/label$/);
  await expect(page.getByText("CONTOH — BUKAN LABEL KURIR")).toBeVisible();
});

test("protected pages and the platform stay closed to anonymous visitors", async ({ page }) => {
  await page.goto("/pengiriman");
  await expect(page).toHaveURL(/\/masuk$/);
  await page.goto("/masuk");
  await page.getByRole("button", { name: "Coba demo" }).click();
  await expect(page).toHaveURL(/\/pengiriman$/);
  expect((await page.goto("/admin"))?.status()).toBe(404);
  expect((await page.goto("/anggota"))?.status()).toBe(404);
});
