// T-086 / UX-20: return and claim cases at 390 and 1280 (768 runs too). Fixtures are synthetic issued
// shipments of tenant A inserted with local SQL and no provider operation row; deleted afterwards.
import { randomUUID } from "node:crypto";
import { expect, test } from "./fixtures";
import { expectNoHorizontalOverflow, localSql, signIn } from "./helpers";

const TENANT_A = "00000000-0000-4000-b000-00000000000a";
const OUTLET_A = "00000000-0000-4000-c000-00000000000a";
const OWNER_A = "00000000-0000-4000-a000-0000000000a1";
const created: string[] = [];

function issuedShipment(courier = "SiCepat", deliveryState = "unobserved") {
  const id = randomUUID(), quote = randomUUID(), reference = `GERA-KSS-${id.slice(0, 6).toUpperCase()}`;
  created.push(id);
  localSql(`
    insert into public.shipments (tenant_id, outlet_id, id, reference, submission_state, delivery_state, sender_name, sender_phone,
      recipient_name, recipient_phone, recipient_address, recipient_area, item_description, weight_grams,
      goods_value_idr, is_cod, is_simulated, created_by, submitted_at, issued_at, awb, customer_charge_idr, pickup_snapshot)
    values ('${TENANT_A}', '${OUTLET_A}', '${id}', '${reference}', 'issued', '${deliveryState}', 'Pengirim Kasus', '081200000088',
      'Penerima Kasus', '081234567890', 'Jl. Tujuan Uji No. 9', 'Kec. Tujuan, Kota Uji', 'Piring', 1500, 50000, false, false,
      '${OWNER_A}', now(), now(), 'SC${id.slice(0, 10).replaceAll("-", "")}', 18000, jsonb_build_object('outlet', 'Outlet A'));
    insert into public.shipment_quotes (tenant_id, shipment_id, id, shipment_revision, courier, service, normal_tariff_idr, eta_days, is_simulated, expires_at)
      values ('${TENANT_A}', '${id}', '${quote}', 1, '${courier}', 'REG', 18000, '1-2', false, now() + interval '1 hour');
    update public.shipments set selected_quote_id = '${quote}' where id = '${id}';`);
  return { id, reference };
}

test.afterAll(() => {
  if (!created.length) return;
  const ids = created.map((i) => `'${i}'`).join(",");
  localSql(`update public.shipments set selected_quote_id = null where id in (${ids}); delete from public.shipments where id in (${ids})`);
});

const UUID_TEXT = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;

test("operator opens and updates a case with an entered anchor; admin closes it with the decided outcome", async ({ page }, testInfo) => {
  const s = issuedShipment();
  await signIn(page, "operator-a@geraiexpress.test");
  await page.goto(`/pengiriman/${s.id}`);
  const section = page.getByTestId("shipment-cases");
  await expect(section).toContainText("Keputusan ganti rugi ada pada kurir atau Mengantar.");
  await section.getByTestId("case-open").click();
  const dialog = page.getByRole("dialog");
  for (const label of ["Hilang", "Rusak", "Terlambat", "Retur", "Lainnya"]) await expect(dialog.getByRole("radio", { name: label, exact: true })).toBeVisible();
  await dialog.getByRole("radio", { name: "Rusak", exact: true }).check();
  await dialog.getByRole("radio", { name: /Klaim nilai penuh/ }).check();
  await dialog.getByLabel("Keterangan").fill("Kardus penyok, piring pecah saat diterima");
  await dialog.getByLabel("Bukti (nama berkas atau tautan)").fill("foto-paket.jpg\nvideo-unboxing.mp4");
  await dialog.getByLabel("Nomor tiket Mengantar (jika ada)").fill("TKT-4411");
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath("case-open-dialog.png"), fullPage: true, animations: "disabled" });
  await dialog.getByTestId("case-save").dblclick();
  await expect(dialog).toHaveCount(0);
  expect(localSql(`select count(*) from public.shipment_cases where shipment_id = '${s.id}'`)).toBe("1");
  const panel = section.getByTestId("case-panel");
  await expect(panel.getByTestId("case-state")).toHaveText("Terbuka");
  // SiCepat counts from the last status; no anchor known before T-045 -> named unknown, never a date.
  await expect(panel.getByTestId("case-deadline-value")).toContainText("Tenggat tidak diketahui");
  await expect(panel.getByTestId("case-deadline-value")).toContainText("Belum bisa dihitung");
  await expect(panel).toContainText("Aturan Mengantar");
  await expect(panel.getByTestId("case-guidance")).toContainText("Tanpa video unboxing");
  await expect(panel.getByTestId("case-guidance")).toContainText("paling lama 14 hari");
  await expect(panel.getByRole("button", { name: "Tutup kasus" })).toHaveCount(0);
  await expect(panel).toContainText("Hanya admin gerai yang dapat menutup kasus.");
  await expect(page.locator("main")).not.toContainText(UUID_TEXT);

  // Update: enter the anchor from the Mengantar app; the database computes the deadline.
  await panel.getByTestId("case-update").click();
  await dialog.getByLabel("Tanggal titik awal tenggat (WIB)").fill("2026-11-02T10:00");
  await dialog.getByRole("radio", { name: "Diajukan ke Mengantar" }).check();
  await page.screenshot({ path: testInfo.outputPath("case-update-dialog.png"), fullPage: true, animations: "disabled" });
  await dialog.getByTestId("case-save").click();
  await expect(dialog).toHaveCount(0);
  await expect(panel.getByTestId("case-state")).toHaveText("Diajukan ke Mengantar");
  await expect(panel.getByTestId("case-deadline-value")).toContainText("16 Nov 2026");
  await expect(panel.getByTestId("case-anchor")).toContainText("dimasukkan petugas: Anda");
  expect(localSql(`select to_char(deadline_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI') from public.shipment_cases where shipment_id = '${s.id}'`)).toBe("2026-11-16 03:00");
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath("case-detail-operator.png"), fullPage: true });

  // The list shows the case under "Terbuka"; the shipment list row carries the case badge.
  await page.goto("/kasus");
  const row = page.getByTestId("case-row").filter({ hasText: s.reference });
  await expect(row).toContainText("Rusak");
  await expect(row).toContainText("Tenggat");
  await expect(page.locator("main")).not.toContainText(UUID_TEXT);
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath("case-list-open.png"), fullPage: true });
  await page.goto(`/pengiriman?q=${s.reference}`);
  await expect(page.getByTestId("case-badge").filter({ visible: true }).first()).toHaveText("Kasus terbuka");

  await page.context().clearCookies();
  await signIn(page, "owner-a@geraiexpress.test");
  await page.goto("/kasus");
  await page.getByTestId("case-row").filter({ hasText: s.reference }).click();
  await expect(page).toHaveURL(/\/kasus\/[0-9a-f-]{36}$/);
  await page.getByTestId("case-close").click();
  for (const label of ["Diganti", "Ditolak", "Retur diterima", "Lainnya"]) await expect(dialog.getByRole("radio", { name: label, exact: true })).toBeVisible();
  await expect(dialog.getByLabel(/Nilai yang diputuskan/)).toHaveCount(0);
  await dialog.getByRole("radio", { name: "Diganti", exact: true }).check();
  await dialog.getByLabel(/Nilai yang diputuskan/).fill("45.000");
  await dialog.getByRole("radio", { name: "Mengantar", exact: true }).check();
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath("case-close-dialog.png"), fullPage: true, animations: "disabled" });
  await dialog.getByTestId("case-close-save").dblclick();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId("case-state")).toHaveText("Ditutup");
  await expect(page.getByTestId("case-outcome")).toContainText("Diganti");
  await expect(page.getByTestId("case-outcome")).toContainText("45.000");
  await expect(page.getByTestId("case-outcome")).toContainText("Mengantar");
  expect(localSql(`select count(*) from public.shipment_case_events e join public.shipment_cases c on c.id = e.case_id
    where c.shipment_id = '${s.id}' and e.kind = 'closed'`)).toBe("1");
  await page.screenshot({ path: testInfo.outputPath("case-closed-admin.png"), fullPage: true });
  await page.goto("/kasus?status=ditutup");
  await expect(page.getByTestId("case-row").filter({ hasText: s.reference })).toContainText("Ditutup");
});

test("a provider return shows Retur with the return rule on list, detail and dashboard", async ({ page }, testInfo) => {
  const s = issuedShipment("spx", "returned");
  await signIn(page, "operator-a@geraiexpress.test");
  await page.goto(`/pengiriman/${s.id}`);
  await expect(page.getByTestId("shipment-cases").getByTestId("return-badge")).toHaveText("Retur");
  await expect(page.getByTestId("return-rule")).toContainText("alamat jemput");
  await page.goto(`/pengiriman?q=${s.reference}`);
  await expect(page.getByTestId("return-badge").filter({ visible: true }).first()).toHaveText("Retur");
  await page.goto("/");
  const region = page.getByTestId("dashboard-case-attention");
  await expect(region).toContainText(s.reference);
  await expect(region.getByTestId("return-badge").first()).toBeVisible();
  // From 768 px the sidebar is visible; below it the same items live in the menu sheet.
  if ((page.viewportSize()?.width ?? 1280) >= 768) {
    await expect(page.getByRole("navigation", { name: "Navigasi utama" }).getByRole("link", { name: /^Kasus \d+ perlu tindakan$/ })).toBeVisible();
  }
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath("case-dashboard-return.png"), fullPage: true });
});
