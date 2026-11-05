// T-084 / PR-46: the Super Admin records per-courier masking acceptance on /admin/integrasi with a reason
// (and evidence for a verdict); the change is audited and immediately changes the operator's print gate.
import { expect, test } from "./fixtures";
import { expectNoHorizontalOverflow, expectTouchTargets, localSql, signInAdmin } from "./helpers";

test.afterEach(() => { localSql(`delete from private.masking_acceptance where courier = 'Sap'`); });

test("a Super Admin records a courier's masking acceptance with evidence and a reason; the result is audited", async ({ page }, testInfo) => {
  // Visual evidence of the per-courier list and the change dialog, one file per project (390 and 1280).
  const shot = (name: string) => page.screenshot({ path: testInfo.outputPath(`masking-acceptance-${name}-${testInfo.project.name}.png`),
    fullPage: true, animations: "disabled" });
  localSql(`delete from private.masking_acceptance where courier = 'Sap'`);
  await signInAdmin(page);
  await page.goto("/admin/integrasi");
  await expect(page.getByRole("heading", { name: "Penerimaan label masking per kurir" })).toBeVisible();
  const row = page.getByTestId("masking-acceptance-row").filter({ hasText: "SAP Express" });
  await expect(row).toContainText("Belum terverifikasi");
  await expect(row).toContainText("Belum ada catatan");
  await expectNoHorizontalOverflow(page);
  await expectTouchTargets(page);
  await row.scrollIntoViewIfNeeded();
  await shot("list");

  await row.getByRole("button", { name: /Ubah status/ }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Berlaku untuk cetak berikutnya di semua gerai");
  await shot("dialog");
  await dialog.getByRole("radio", { name: /^Terverifikasi/ }).check();
  await dialog.getByLabel("Alasan (dicatat di audit)").fill("Uji e2e penerimaan");
  // A verdict without evidence is refused by the database and the dialog stays open.
  await dialog.getByRole("button", { name: "Simpan status" }).click();
  await expect(dialog).toContainText("Isi referensi bukti");
  expect(localSql(`select count(*) from private.masking_acceptance where courier = 'Sap'`)).toBe("0");
  // The form may reset after an action; fill every field again before resubmitting.
  await dialog.getByRole("radio", { name: /^Terverifikasi/ }).check();
  await dialog.getByLabel("Alasan (dicatat di audit)").fill("Uji e2e penerimaan");
  await dialog.getByLabel("Referensi bukti").fill("Uji scan e2e SAP #1");
  await dialog.getByRole("button", { name: "Simpan status" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Status penerimaan label masking disimpan: terverifikasi." })).toBeVisible({ timeout: 20_000 });
  await expect(row).toContainText("Terverifikasi");
  await expect(row).toContainText("Uji scan e2e SAP #1");
  await shot("list-after-change");
  expect(localSql(`select state || '|' || evidence_ref from private.masking_acceptance where courier = 'Sap'`)).toBe("verified|Uji scan e2e SAP #1");
  expect(localSql(`select outcome || '|' || reason from public.audit_events where action = 'masking_acceptance.set' order by id desc limit 1`))
    .toBe("verified|Uji e2e penerimaan");
  await expectNoHorizontalOverflow(page);
});
// Capability refusal (plain 404 without integration_operations) is covered for /admin/integrasi in
// tests/e2e/platform-not-found.spec.ts; the RPC refusal is covered in tests/db/masking-acceptance.test.ts.
