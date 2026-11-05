import { randomUUID } from "node:crypto";
import { expect, test } from "./fixtures";
import { expectNoHorizontalOverflow, localSql, signIn } from "./helpers";

const TENANT = "00000000-0000-4000-b000-00000000000a";
const ADMIN = "00000000-0000-4000-a000-0000000000a1";
const outlets: string[] = [];
function cashFixture() {
  const outlet = randomUUID(), name = `Outlet kas ${outlet.slice(0, 8)}`;
  outlets.push(outlet);
  const operator = localSql("select id from auth.users where email = 'operator-a@geraiexpress.test'");
  localSql(`insert into public.outlets(tenant_id, id, name) values ('${TENANT}', '${outlet}', '${name}')`);
  for (const [method, user] of [["cash", operator], ["qris", ADMIN]]) {
    const shipment = randomUUID();
    localSql(`insert into public.shipments(tenant_id, outlet_id, id, reference, submission_state, payment_state,
        recipient_name, recipient_phone, recipient_address, recipient_area, item_description, weight_grams,
        is_cod, is_simulated, created_by, customer_charge_idr)
      values ('${TENANT}', '${outlet}', '${shipment}', 'GERA-KAS-${shipment.slice(0, 8)}', 'issued', 'unpaid',
        'Penerima Uji', '081234567890', 'Jl. Uji 1', 'Kota Uji', 'Buku', 1000, false, false, '${user}', 12000);
      select set_config('request.jwt.claims', '{"sub":"${user}","role":"authenticated"}', false);
      select public.record_counter_payment('${shipment}', '${method}', 12000, null, null);`);
  }
  const period = localSql(`select id from public.cash_periods where outlet_id = '${outlet}' and closed_at is null`);
  return { outlet, name, period };
}
test.afterAll(() => {
  for (const outlet of outlets) localSql(`delete from public.shipments where outlet_id = '${outlet}'; delete from public.outlets where id = '${outlet}'`);
});

test("operator closes once with live variance; only admin can reopen with an audited reason", async ({ page }, testInfo) => {
  const f = cashFixture();
  await signIn(page, "operator-a@geraiexpress.test");
  await page.goto("/kas");
  const period = page.getByTestId(`cash-period-${f.period}`);
  await expect(period).toContainText(f.name);
  await expect(period).toContainText("Tunai");
  await expect(period).toContainText("QRIS");
  await expect(period).toContainText("Petugas");
  // Members are distinguished without exposing raw user ids (no staff-name field exists, DEC-026).
  await expect(period).not.toContainText(/\(0{8}\)|[0-9a-f]{8}-[0-9a-f]{4}-/);
  await period.getByRole("button", { name: "Tutup kas", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Uang tunai terhitung (Rp)", { exact: true }).fill("11500");
  await expect(dialog.getByTestId("cash-variance")).toContainText(/-Rp\s*500/);
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath("cash-close-confirmation.png"), fullPage: true, animations: "disabled" });
  await dialog.getByRole("button", { name: "Konfirmasi tutup kas", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(period).toContainText("Ditutup");
  await expect(period).toContainText(/-Rp\s*500/);
  await expect(period.getByRole("button", { name: "Buka ulang kas" })).toHaveCount(0);
  expect(localSql(`select count(*) from public.cash_period_events where period_id = '${f.period}' and kind = 'close'`)).toBe("1");
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath("cash-closed-operator.png"), fullPage: true });

  await page.context().clearCookies();
  await signIn(page, "owner-a@geraiexpress.test");
  await page.goto("/kas");
  await period.getByRole("button", { name: "Buka ulang kas", exact: true }).click();
  await dialog.getByLabel("Alasan buka ulang").fill("Hitung ulang uang tunai");
  await expect(dialog).toContainText("Riwayat penutupan tetap disimpan");
  await page.screenshot({ path: testInfo.outputPath("cash-reopen-confirmation.png"), fullPage: true, animations: "disabled" });
  await dialog.getByRole("button", { name: "Konfirmasi buka ulang", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(period).toContainText("Periode terbuka");
  await expect(period.getByRole("button", { name: "Tutup kas", exact: true })).toBeVisible();
  expect(localSql(`select count(*) from public.cash_period_events where period_id = '${f.period}'`)).toBe("2");
  expect(localSql(`select reason from public.audit_events where action = 'cash_period.reopen' and detail->>'period' = '${f.period}'`)).toBe("Hitung ulang uang tunai");
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath("cash-reopened-admin.png"), fullPage: true });
});
