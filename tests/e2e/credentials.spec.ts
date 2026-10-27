// PR-18 / PR-26 / IAM-3 / SEC-3 / DEC-006: a tenant admin stores their own Mengantar key; it is
// sealed server-side, never shown again, and readiness stays "not verified".
import { expect, test } from "./fixtures";
import { expectNoHorizontalOverflow, expectTouchTargets, signIn, signInAdmin } from "./helpers";

test("an admin stores a seller key that is never shown again and stays unverified", async ({ page }) => {
  const key = `mk_e2e_${Date.now()}SECRETVALUEWXYZ`;
  await signIn(page, "owner-a@geraiexpress.test");
  await page.goto("/pengaturan");
  const section = page.getByRole("region", { name: "Akun Mengantar (kunci API sendiri)" });
  await section.getByLabel("Kunci API Mengantar").fill("pendek");
  await section.getByRole("button", { name: /Simpan kunci|Ganti kunci/ }).click();
  await expect(section.getByRole("alert")).toHaveText(/Konfirmasi bahwa akun Mengantar ini milik bisnis Anda/);
  await section.getByLabel("Kunci API Mengantar").fill("pendek");
  await section.getByRole("checkbox").check();
  await section.getByRole("button", { name: /Simpan kunci|Ganti kunci/ }).click();
  await expect(section.getByRole("alert")).toHaveText(/Kunci API tidak valid/);

  await section.getByLabel("Kunci API Mengantar").fill(key);
  await section.getByRole("checkbox").check();
  await section.getByRole("button", { name: /Simpan kunci|Ganti kunci/ }).click();
  await expect(page.getByTestId("seller-key-status")).toContainText("…WXYZ");
  await expect(page.getByText(/berakhiran …WXYZ tersimpan terenkripsi/)).toBeVisible();
  await expect(page.getByText("Belum diverifikasi").first()).toBeVisible();
  await page.reload();
  expect(await page.content()).not.toContain("SECRETVALUE");
  await expectNoHorizontalOverflow(page);
  await expectTouchTargets(page);

  await page.getByRole("button", { name: "Hapus kunci" }).click();
  await expect(page.getByTestId("seller-key-status")).toHaveCount(0);
});

test("operators see the connection state but cannot change it", async ({ page }) => {
  await signIn(page, "operator-a@geraiexpress.test");
  await page.goto("/pengaturan");
  await expect(page.getByText("Akun Mengantar", { exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Pendaftaran akun Mengantar baru (Partner)" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Akun Mengantar (kunci API sendiri)" })).toHaveCount(0);
});

test("Partner API onboarding card enforces owner consent and operators cannot see it (T-027)", async ({ page }) => {
  await signIn(page, "owner-a@geraiexpress.test");
  await page.goto("/pengaturan");
  const section = page.getByRole("region", { name: "Pendaftaran akun Mengantar baru (Partner)" });
  await expect(section).toBeVisible();
  await expect(section.getByText("Lupa Password")).toBeVisible();

  await section.getByLabel("Nama pemilik akun Mengantar").fill("Pemilik Gerai Uji A");
  await section.getByLabel("Email pemilik").fill("pemilik-uji-a@geraiexpress.test");
  await section.getByLabel("No. HP pemilik (08...)").fill("081234567890");
  await section.getByRole("button", { name: "Daftarkan akun Mengantar baru" }).click();
  await expect(section.getByRole("alert")).toHaveText(/Centang persetujuan kepemilikan akun dan Ketentuan\/Privasi Mengantar/);
  await expectNoHorizontalOverflow(page);
});

test("the Super Admin integration page shows readiness without values and sets the Partner ID", async ({ page }) => {
  await signInAdmin(page);
  await page.goto("/admin/integrasi");
  await expect(page.getByTestId("sealing-key-status")).toContainText("Terpasang");
  await expect(page.getByTestId("partner-secret-status")).toContainText("Belum dipasang");
  await expect(page.getByTestId("seller-binding").filter({ hasText: "Gerai Uji A" })).toBeVisible();
  await page.getByText("Ubah Partner ID…").click();
  await page.getByLabel("Partner ID (bukan rahasia)").fill("gx-e2e-partner");
  await page.getByLabel("Alasan (dicatat di audit)").fill("Uji e2e partner");
  await page.getByRole("button", { name: "Simpan Partner ID" }).click();
  await expect(page.getByTestId("partner-id-status")).toContainText("gx-e2e-partner");
  await page.getByLabel("Partner ID (bukan rahasia)").fill("");
  await page.getByLabel("Alasan (dicatat di audit)").fill("Kosongkan lagi");
  await page.getByRole("button", { name: "Simpan Partner ID" }).click();
  await expect(page.getByTestId("partner-id-status")).toContainText("Belum diisi");
  await expectNoHorizontalOverflow(page);
});
