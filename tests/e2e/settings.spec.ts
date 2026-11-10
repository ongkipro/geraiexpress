// PR-8 / UX-3: capability readiness is explicit and demo restrictions are explained.
import { expect, test } from "./fixtures";
import { atDashboard, expectNoHorizontalOverflow, expectTouchTargets, localSql, signIn, startDemo } from "./helpers";

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
  await expect(page).toHaveURL(atDashboard); // UX-16: sign-in lands on the Dashboard.
  await page.goto("/pengaturan");
  await expect(page.getByText("Belum terhubung.", { exact: false })).toBeVisible();
  await expect(page.getByText("Simulasi")).toHaveCount(0);
  // Only the pickup-address row may be ready; every provider capability must not claim readiness.
  for (const name of ["Akun Mengantar", "Cek ongkir", "Penerbitan resi", "Label cetak lokal (barcode resi)", "Masking pengirim di label", "Pelacakan status kurir"]) {
    const row = page.getByRole("listitem").filter({ hasText: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`) });
    await expect(row).toHaveCount(1);
    await expect(row).not.toContainText("Siap");
  }
});

// T-044 / PR-34 / UX-9: the gerai WhatsApp printed on the local label is edited only by a tenant
// administrator, through an audited command; an operator sees it read-only.
const TENANT_A = "00000000-0000-4000-b000-00000000000a";
const resetWhatsapp = () => localSql(`update public.tenants set contact_whatsapp = null, contact_whatsapp_revision = 0, masking_allowed = true where id = '${TENANT_A}'`);

test.describe("gerai WhatsApp (PR-34)", () => {
  test.beforeEach(resetWhatsapp);
  test.afterEach(resetWhatsapp);

  test("a tenant administrator sees validation next to the field, saves a normalized number and the change is audited", async ({ page }) => {
    await signIn(page, "owner-a@geraiexpress.test");
    await page.goto("/pengaturan");
    await expect(page.getByRole("heading", { name: "Identitas label" })).toBeVisible();
    // Empty gerai number is reported on the label readiness row.
    await expect(page.getByRole("listitem").filter({ hasText: /^Label cetak lokal/ })).toContainText("Nomor WhatsApp gerai belum diisi");
    const field = page.getByLabel("Nomor WhatsApp gerai");
    await expect(field).toHaveValue("");
    await expect(page.getByText("Contoh: 081234567890", { exact: false })).toBeVisible();

    await field.fill("12345");
    await page.getByRole("button", { name: "Simpan nomor" }).click();
    const message = "Nomor WhatsApp gerai tidak valid. Gunakan nomor Indonesia (misalnya 081234567890).";
    await expect(page.getByText(message)).toBeVisible();
    await expect(field).toHaveAttribute("aria-invalid", "true");
    await expect(field).toHaveAccessibleDescription(new RegExp(message.slice(0, 30)));
    await expect(field).toHaveValue("12345"); // the entered value is kept for correction
    expect(localSql(`select coalesce(contact_whatsapp, '<null>') from public.tenants where id = '${TENANT_A}'`)).toBe("<null>");
    await expectNoHorizontalOverflow(page);
    await expectTouchTargets(page);

    await field.fill("+62 812-3456-7890");
    await page.getByRole("button", { name: "Simpan nomor" }).click();
    await expect(page.getByText("Nomor WhatsApp gerai disimpan.")).toBeVisible();
    await expect(field).toHaveValue("081234567890");
    expect(localSql(`select contact_whatsapp || '/' || contact_whatsapp_revision from public.tenants where id = '${TENANT_A}'`)).toBe("081234567890/1");
    expect(localSql(`select count(*) from public.audit_events where action = 'tenant.contact_whatsapp' and target_tenant = '${TENANT_A}' and outcome = 'set' and at > now() - interval '1 minute'`)).toBe("1");
    await page.reload();
    await expect(page.getByLabel("Nomor WhatsApp gerai")).toHaveValue("081234567890");
    await expect(page.getByRole("listitem").filter({ hasText: /^Label cetak lokal/ })).not.toContainText("belum diisi");
    await expect(page.getByRole("listitem").filter({ hasText: /^Label cetak lokal/ })).not.toContainText("Siap");
    await expect(page.getByText("Identitas asli gerai dan alamat pickup tetap tersimpan")).toBeVisible();
  });

  test("an operator sees the number read-only and gets no edit control", async ({ page }) => {
    localSql(`update public.tenants set contact_whatsapp = '081355550000' where id = '${TENANT_A}'`);
    await signIn(page, "operator-a@geraiexpress.test");
    await page.goto("/pengaturan");
    await expect(page.getByTestId("whatsapp-readonly")).toContainText("081355550000");
    await expect(page.getByTestId("whatsapp-readonly")).toContainText("Hanya admin gerai yang dapat mengubah nomor ini.");
    await expect(page.getByLabel("Nomor WhatsApp gerai")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Simpan nomor" })).toHaveCount(0);
    await expect(page.getByText("Identitas asli gerai dan alamat pickup tetap tersimpan")).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
  });

  test("when the platform disabled masking, settings say so", async ({ page }) => {
    localSql(`update public.tenants set masking_allowed = false where id = '${TENANT_A}'`);
    await signIn(page, "owner-a@geraiexpress.test");
    await page.goto("/pengaturan");
    await expect(page.getByTestId("masking-disabled-note")).toContainText("Masking pengirim dinonaktifkan untuk gerai ini oleh administrator platform.");
    await expect(page.getByRole("listitem").filter({ hasText: /^Masking pengirim di label/ })).toContainText("Dinonaktifkan oleh administrator platform");
  });
});
