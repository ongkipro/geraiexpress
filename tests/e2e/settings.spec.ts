// PR-8 / UX-3: capability readiness is explicit and demo restrictions are explained.
import { expect, test } from "@playwright/test";
import { expectNoHorizontalOverflow, expectTouchTargets, signIn, startDemo } from "./helpers";

test("demo settings show simulated capabilities and restrictions", async ({ page }) => {
  await startDemo(page);
  await page.goto("/pengaturan");
  await expect(page.getByRole("heading", { name: "Kesiapan outlet" })).toBeVisible();
  await expect(page.getByText("Simulasi").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Dibatasi di demo" })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await expectTouchTargets(page);
});

test("real tenant settings never claim provider readiness", async ({ page }) => {
  await signIn(page, "owner-a@geraiexpress.test");
  await expect(page).toHaveURL(/\/pengiriman$/);
  await page.goto("/pengaturan");
  await expect(page.getByText("Belum terhubung.", { exact: false })).toBeVisible();
  await expect(page.getByText("Simulasi")).toHaveCount(0);
  // Only the pickup-address row may be ready; every provider capability must not claim readiness.
  for (const name of ["Akun Mengantar", "Cek ongkir & penerbitan resi", "Identitas pengirim pelanggan (dropshipper)", "Label resmi (PDF kurir)", "Pelacakan status kurir"]) {
    const row = page.getByRole("listitem").filter({ hasText: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`) });
    await expect(row).toHaveCount(1);
    await expect(row).not.toContainText("Siap");
  }
});
