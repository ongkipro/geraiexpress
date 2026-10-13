// PR-2 / UX-1: save, search, edit and reuse contacts within the current tenant only.
import { expect, test } from "@playwright/test";
import { expectNoHorizontalOverflow, signIn, startDemo } from "./helpers";

test("create a contact with an address, find it, edit it", async ({ page }) => {
  await startDemo(page);
  await page.goto("/kontak");
  await expect(page.getByRole("link", { name: /Sari Wulandari/ })).toBeVisible();
  await page.getByLabel("Nama", { exact: true }).fill("Dewi Lestari Uji");
  await page.getByLabel("No. HP").fill("0812 7777 8888");
  await page.getByText("Tambahkan alamat (opsional)").click();
  await page.getByLabel("Alamat lengkap").fill("Jl. Uji Kontak No. 7");
  await page.getByLabel("Kecamatan / kota").fill("Kec. Uji, Kota Uji");
  await page.getByRole("button", { name: "Simpan kontak" }).click();
  await expect(page.getByRole("heading", { name: "Dewi Lestari Uji" })).toBeVisible();
  await expect(page.getByText("Jl. Uji Kontak No. 7, Kec. Uji, Kota Uji")).toBeVisible();

  await page.getByLabel("Nama", { exact: true }).fill("Dewi Lestari Diubah");
  await page.getByRole("button", { name: "Simpan perubahan" }).click();
  // Wait for the edit's own confirmation, not the earlier "created" notice on the same page.
  await expect(page.getByText("Pengiriman yang sudah dikonfirmasi tidak berubah.", { exact: false })).toBeVisible();

  await page.goto("/kontak?q=Diubah");
  await expect(page.getByRole("link", { name: /Dewi Lestari Diubah/ })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("invalid contact keeps input and marks the field", async ({ page }) => {
  await startDemo(page);
  await page.goto("/kontak");
  await page.getByLabel("Nama", { exact: true }).fill("Nomor Salah");
  await page.getByLabel("No. HP").fill("12");
  await page.getByRole("button", { name: "Simpan kontak" }).click();
  await expect(page.getByLabel("No. HP")).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByLabel("Nama", { exact: true })).toHaveValue("Nomor Salah");
});

test("another tenant's contact is not found", async ({ page }) => {
  await signIn(page, "owner-a@geraiexpress.test");
  await expect(page).toHaveURL(/\/pengiriman$/);
  const res = await page.goto("/kontak/00000000-0000-4000-d000-00000000000b");
  expect(res?.status()).toBe(404);
  await page.goto("/kontak");
  await expect(page.getByText("Kontak Rahasia B")).toHaveCount(0);
});

test("a stale edit from another tab is a visible conflict that keeps the typed values", async ({ browser }) => {
  const context = await browser.newContext();
  const first = await context.newPage();
  await startDemo(first);
  await first.goto("/kontak");
  await first.getByRole("link", { name: /Budi Santoso/ }).click();
  await expect(first).toHaveURL(/\/kontak\/[0-9a-f-]{36}$/);
  const url = first.url();
  const second = await context.newPage();
  await second.goto(url);

  await first.bringToFront();
  await first.getByLabel("Nama", { exact: true }).fill("Budi Versi Satu");
  await first.getByRole("button", { name: "Simpan perubahan" }).click();
  await expect(first.getByText("Pengiriman yang sudah dikonfirmasi tidak berubah.", { exact: false })).toBeVisible();

  await second.bringToFront();
  await second.getByLabel("Nama", { exact: true }).fill("Budi Versi Dua");
  await second.getByRole("button", { name: "Simpan perubahan" }).click();
  await expect(second.getByRole("alert").filter({ hasText: "sudah diubah oleh orang lain" })).toBeVisible();
  await expect(second.getByLabel("Nama", { exact: true })).toHaveValue("Budi Versi Dua");
  await context.close();
});

test("add a second address, archive the primary, and a new primary remains", async ({ page }) => {
  await startDemo(page);
  await page.goto("/kontak");
  await page.getByRole("link", { name: /Budi Santoso/ }).click();
  await page.getByLabel("Label alamat").fill("Kantor");
  await page.getByLabel("Alamat lengkap").fill("Jl. Kantor Uji No. 3");
  await page.getByLabel("Kecamatan / kota").fill("Kec. Kantor, Kota Uji");
  await page.getByRole("button", { name: "Tambah alamat" }).click();
  await expect(page.getByText("Jl. Kantor Uji No. 3", { exact: false })).toBeVisible();

  const primary = page.getByRole("listitem").filter({ hasText: "· utama" });
  await expect(primary).toContainText("Rumah");
  await primary.getByRole("button", { name: "Arsipkan" }).click();
  await expect(page.getByText("Alamat diarsipkan.")).toBeVisible();
  await expect(page.getByText("Jl. Contoh Melati No. 1")).toHaveCount(0);
  await expect(page.getByRole("listitem").filter({ hasText: "· utama" })).toContainText("Kantor");
});

test("a tampered form aimed at another tenant's contact changes nothing", async ({ page, browser }) => {
  await signIn(page, "owner-a@geraiexpress.test");
  await expect(page).toHaveURL(/\/pengiriman$/);
  await page.goto("/kontak/00000000-0000-4000-d000-00000000000a");
  await page.locator('input[name="contact_id"]').first().evaluate((el, id) => ((el as HTMLInputElement).value = id), "00000000-0000-4000-d000-00000000000b");
  await page.getByLabel("Nama", { exact: true }).fill("Diretas");
  await page.getByRole("button", { name: "Simpan perubahan" }).click();
  await expect(page.getByRole("alert").filter({ hasText: /⚠/ }).first()).toBeVisible();

  await page.locator('input[name="contact_id"]').last().evaluate((el, id) => ((el as HTMLInputElement).value = id), "00000000-0000-4000-d000-00000000000b");
  await page.getByLabel("Alamat lengkap").fill("Jl. Sisipan Asing 1");
  await page.getByLabel("Kecamatan / kota").fill("Kota Asing");
  await page.getByRole("button", { name: "Tambah alamat" }).click();
  await expect(page.getByRole("alert").filter({ hasText: /⚠/ }).first()).toBeVisible();

  const other = await browser.newPage();
  await signIn(other, "owner-b@geraiexpress.test");
  await other.goto("/kontak/00000000-0000-4000-d000-00000000000b");
  await expect(other.getByRole("heading", { name: "Kontak Rahasia B" })).toBeVisible();
  await expect(other.getByText("Jl. Sisipan Asing 1")).toHaveCount(0);
  await other.close();
});
