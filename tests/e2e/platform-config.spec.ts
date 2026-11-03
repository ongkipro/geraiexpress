// T-091 / DEC-024 (G1): the Super Admin "Konfigurasi" page reads the current declaration text and every
// weight rule, appends new versions with a reason, and is hidden from capabilities without either RPC.
import { randomUUID } from "node:crypto";
import { expect, test } from "./fixtures";
import { expectNoHorizontalOverflow, localSql, signIn, signInAdmin } from "./helpers";

test.describe.configure({ mode: "serial" });

test("shows the current declaration and weight rules and appends a new declaration version", async ({ page }) => {
  await signInAdmin(page);
  await page.goto("/admin/konfigurasi");
  await expect(page.getByRole("heading", { name: "Konfigurasi", level: 1 })).toBeVisible();
  await expect(page.getByTestId("declaration-current")).toContainText("Versi 1 berlaku");
  await expect(page.getByTestId("declaration-current")).toContainText("barang yang mudah meledak");
  await expect(page.getByTestId("weight-rule").filter({ hasText: "JNE Kargo" })).toContainText("Min 10 kg");
  await expectNoHorizontalOverflow(page);

  const before = Number(localSql("select max(version) from public.declaration_texts"));
  try {
    await page.getByRole("button", { name: "Tambah versi teks pernyataan…" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Versi lama tetap tersimpan");
    await dialog.getByLabel("Alasan (dicatat di audit)").fill("Uji e2e versi teks");
    await dialog.getByRole("button", { name: "Simpan versi baru" }).click();
    // Server action under a busy suite: allow more than the 5 s default.
    await expect(page.getByRole("status").filter({ hasText: `Versi ${before + 1} teks pernyataan berlaku sekarang.` })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("declaration-current")).toContainText(`Versi ${before + 1} berlaku`);
    expect(localSql(`select count(*) from public.audit_events where action = 'declaration_text.append'`)).not.toBe("0");
  } finally {
    localSql(`alter table public.declaration_texts disable trigger declaration_texts_append_only;
      delete from public.declaration_texts where version > ${before};
      alter table public.declaration_texts enable trigger declaration_texts_append_only;`);
  }
});

test("schedules a weight-rule version that stays inspectable while the current one stays current; a short reason is refused", async ({ page }) => {
  await signInAdmin(page);
  await page.goto("/admin/konfigurasi");
  const row = page.getByTestId("weight-rule").filter({ hasText: "Lion Parcel Reguler" });
  const count = () => Number(localSql("select count(*) from private.billable_weight_rules where courier = 'lion' and service_class = 'regular'"));
  const startCount = count();
  const reason = `Uji e2e jadwal ${randomUUID().slice(0, 8)}`;
  try {
    await row.getByRole("button", { name: /Versi baru/ }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("jangan menebak");
    // A reason under 5 characters never reaches the database (browser constraint) and nothing is saved.
    await dialog.getByLabel("Alasan (dicatat di audit)").fill("ok");
    await dialog.getByRole("button", { name: "Simpan versi baru" }).click();
    await expect(dialog).toBeVisible();
    expect(count()).toBe(startCount);
    await dialog.getByLabel(/Maksimum \(kg\)/).fill("90");
    await dialog.getByLabel(/Berlaku mulai/).fill("2099-01-02T09:30");
    await dialog.getByLabel("Alasan (dicatat di audit)").fill(reason);
    await dialog.getByRole("button", { name: "Simpan versi baru" }).click();
    // Server action under a busy suite: allow more than the 5 s default.
    await expect(page.getByRole("status").filter({ hasText: "Versi aturan lion Reguler disimpan." })).toBeVisible({ timeout: 20_000 });
    expect(count()).toBe(startCount + 1);
    // The current version is still the one in force; the scheduled one is listed with its WIB start.
    await expect(row).toContainText("Berlaku sejak");
    await row.getByText(/Semua versi/).click();
    const scheduled = row.getByTestId("weight-rule-version").filter({ hasText: "Terjadwal" });
    await expect(scheduled).toContainText("Maks 90 kg");
    await expect(scheduled).toContainText("2 Jan 2099");
    expect(localSql(`select effective_at at time zone 'UTC' from private.billable_weight_rules
      where id = (select (detail->>'rule_id')::uuid from public.audit_events where reason = '${reason}')`)).toContain("2099-01-02 02:30:00");
  } finally {
    // Delete only the row this test created (its id is in the audit detail of the unique reason).
    localSql(`delete from private.billable_weight_rules where id = (select (detail->>'rule_id')::uuid from public.audit_events
      where action = 'billable_weight_rule.append' and reason = '${reason}')
      and id not in (select weight_rule_id from public.shipment_quotes where weight_rule_id is not null)`);
  }
  expect(count()).toBe(startCount);
});

test("a Super Admin without either capability has no Konfigurasi menu and the page is not found", async ({ page }) => {
  const ADMIN2 = "00000000-0000-4000-a000-0000000000f2";
  const before = localSql(`select capabilities::text from public.platform_grants where user_id = '${ADMIN2}' and revoked_at is null`);
  localSql(`update public.platform_grants set capabilities = array['platform_monitoring', 'audit_review'] where user_id = '${ADMIN2}' and revoked_at is null`);
  try {
    await signIn(page, "admin-2@geraiexpress.test");
    await expect(page).toHaveURL(/\/verifikasi-2fa$/);
    const { FIXTURE_TOTP, totp } = await import("../totp");
    // Accepted window is previous/current/next step; pick the oldest unused one (same rule as signInAdmin).
    const last = Number(localSql(`select coalesce(max(f.last_used_step), -1) from auth.mfa_factors f where f.user_id = '${ADMIN2}'`));
    let usable: number[] = [];
    for (;;) {
      const now = Math.floor(Date.now() / 30_000);
      usable = [now - 1, now, now + 1].filter((c) => c > last);
      if (usable.length) break;
      await page.waitForTimeout(1000);
    }
    await page.getByLabel("Kode 6 digit").fill(totp(FIXTURE_TOTP["admin-2@geraiexpress.test"], usable[0] * 30_000));
    await page.getByRole("button", { name: "Verifikasi" }).click();
    // T-092: platform_monitoring now lands on the Gerai overview (was: the audit page).
    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByRole("link", { name: "Konfigurasi" })).toHaveCount(0);
    const response = await page.goto("/admin/konfigurasi");
    expect(response?.status()).toBe(404);
  } finally {
    localSql(`update public.platform_grants set capabilities = '${before}'::text[] where user_id = '${ADMIN2}' and revoked_at is null`);
  }
});
