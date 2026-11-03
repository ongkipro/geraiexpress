// T-089: regressions for the 2026-11-03 UI/UX audit (docs/review/2026-11-03-uiux-admin-audit.md).
// Each test names its finding; all run on the local stack and the demo or seeded fixtures only.
import { randomUUID } from "node:crypto";
import { expect, test } from "./fixtures";
import { chooseOption, expectNoHorizontalOverflow, localSql, signIn, signInAdmin, startDemo } from "./helpers";

async function quotedDemoDraft(page: import("@playwright/test").Page) {
  await startDemo(page);
  await page.goto("/pengiriman/baru");
  await page.getByRole("button", { name: "Mulai draf baru" }).click();
  await expect(page).toHaveURL(/\/pengiriman\/[0-9a-f-]{36}$/);
  await chooseOption(page, "Pilih pengirim tersimpan", "Budi Santoso (contoh) · 081200000001");
  await chooseOption(page, "Pilih penerima tersimpan", "Sari Wulandari (contoh) · 081200000003");
  await page.getByLabel("Isi paket").fill("Kain");
  await page.getByLabel("Berat (gram)").fill("900");
  await page.getByRole("button", { name: "Simpan & cek ongkir" }).click();
  await expect(page.getByRole("button", { name: "Periksa & konfirmasi" })).toBeVisible();
}

test("F1: a contact search keeps the service the operator chose", async ({ page }) => {
  await quotedDemoDraft(page);
  const kilat = page.locator("label").filter({ hasText: "Kilat" });
  await kilat.click();
  await expect(kilat.locator('input[type="radio"]')).toBeChecked();
  await page.getByLabel("Cari kontak tersimpan (nama atau nomor HP)").fill("Budi");
  await page.getByRole("button", { name: "Saring kontak" }).click();
  await expect(page.getByTestId("contact-search-status")).toBeVisible();
  await expect(kilat.locator('input[type="radio"]')).toBeChecked();
});

test("F7: an address of a contact picked before another search still applies", async ({ page }) => {
  await startDemo(page);
  await page.goto("/pengiriman/baru");
  await page.getByRole("button", { name: "Mulai draf baru" }).click();
  await chooseOption(page, "Pilih penerima tersimpan", "Sari Wulandari (contoh) · 081200000003");
  await expect(page.getByLabel("Alamat lengkap")).toHaveValue("Perumahan Contoh Asri Blok C2 No. 14");
  // Sari drops out of the server's search results; the picker keeps her (cached) addresses.
  await page.getByLabel("Cari kontak tersimpan (nama atau nomor HP)").fill("Budi");
  await page.getByRole("button", { name: "Saring kontak" }).click();
  await expect(page.getByTestId("contact-search-status")).toBeVisible();
  await chooseOption(page, "Alamat tersimpan", /Kantor/);
  await expect(page.getByLabel("Alamat lengkap")).toHaveValue("Gedung Contoh Lt. 3");
});

test("F2: awaiting-payment hints never tell staff to pay in Mengantar", async ({ page }) => {
  await signIn(page, "operator-a@geraiexpress.test");
  await page.goto("/");
  await expect(page.getByTestId("stat-awaiting")).not.toContainText("Bayar di aplikasi Mengantar");
  await page.goto("/pengiriman");
  await expect(page.getByRole("main")).not.toContainText("Bayar di aplikasi Mengantar");
  await expect(page.getByRole("main")).toContainText("Periksa pembayaran batch di detail");
});

test("F8: the dashboard tile names its creation-day basis", async ({ page }) => {
  await signIn(page, "owner-a@geraiexpress.test");
  await page.goto("/");
  await expect(page.getByTestId("stat-issued-today")).toContainText("Dibuat & terbit hari ini");
});

test("F4: an integration-only Super Admin lands on Integrasi Mengantar", async ({ page }) => {
  const ADMIN2 = "00000000-0000-4000-a000-0000000000f2";
  const before = localSql(`select capabilities::text from public.platform_grants where user_id = '${ADMIN2}' and revoked_at is null`);
  localSql(`update public.platform_grants set capabilities = array['integration_operations'] where user_id = '${ADMIN2}' and revoked_at is null`);
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
    await expect(page).toHaveURL(/\/admin\/integrasi$/);
    await expect(page.getByText("Kemampuan Anda belum memiliki halaman")).toHaveCount(0);
  } finally {
    localSql(`update public.platform_grants set capabilities = '${before}'::text[] where user_id = '${ADMIN2}' and revoked_at is null`);
  }
});

test("G2: Audit offers the declaration-text and weight-rule events as filters", async ({ page }) => {
  await signInAdmin(page);
  await page.goto("/admin/audit");
  const options = await page.locator("select option, [role=option]").allTextContents().catch(() => []);
  const html = await page.content();
  expect(options.join("|") + html).toContain("Versi teks pernyataan isi paket");
  expect(options.join("|") + html).toContain("Versi aturan berat Mengantar");
});

test("F10: 'Kirim sekarang' asks for confirmation naming the reference and sends nothing until confirmed", async ({ page }) => {
  const TENANT_A = "00000000-0000-4000-b000-00000000000a", OUTLET_A = "00000000-0000-4000-c000-00000000000a";
  const OWNER_A = "00000000-0000-4000-a000-0000000000a1";
  const id = randomUUID(), quote = randomUUID(), op = randomUUID();
  const ref = `GXF10-${id.slice(0, 6).toUpperCase()}`;
  localSql(`insert into public.shipments (tenant_id, outlet_id, id, reference, submission_state, recipient_name, recipient_phone,
      recipient_address, recipient_area_id, item_description, weight_grams, goods_value_idr, is_simulated, created_by, submitted_at)
    values ('${TENANT_A}', '${OUTLET_A}', '${id}', '${ref}', 'queued', 'Penerima Uji', '081234567890', 'Jl. Uji 1',
      '5fc63169f8f44b34aa4c2ee1', 'Dokumen', 1000, 50000, false, '${OWNER_A}', now());
    insert into public.shipment_quotes (tenant_id, shipment_id, id, shipment_revision, courier, service, normal_tariff_idr, eta_days, is_simulated, expires_at)
      values ('${TENANT_A}', '${id}', '${quote}', 1, 'JT', 'Reguler', 9000, '1-2', false, now() + interval '1 hour');
    update public.shipments set selected_quote_id = '${quote}' where id = '${id}';
    insert into public.provider_operations (tenant_id, shipment_id, id, kind, idempotency_key, input_digest, state, is_simulated, actor)
      values ('${TENANT_A}', '${id}', '${op}', 'create_order', 'key-${op}', 'digest', 'queued', false, '${OWNER_A}');`);
  try {
    await signIn(page, "owner-a@geraiexpress.test");
    await page.goto(`/pengiriman/${id}`);
    let posted = 0;
    page.on("request", (r) => { if (r.method() === "POST" && r.url().includes(`/pengiriman/${id}`)) posted++; });
    await page.getByRole("button", { name: "Kirim sekarang" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText(ref);
    await expect(dialog).toContainText("Tidak ada pesanan baru yang dibuat");
    await expectNoHorizontalOverflow(page);
    await dialog.getByRole("button", { name: "Kembali" }).click();
    await expect(dialog).toHaveCount(0);
    expect(posted).toBe(0);
    expect(localSql(`select state from public.provider_operations where id = '${op}'`)).toBe("queued");
  } finally {
    localSql(`delete from public.provider_operations where shipment_id = '${id}';
      update public.shipments set selected_quote_id = null where id = '${id}'; delete from public.shipments where id = '${id}'`);
  }
});

test("F6: the mobile menu scrolls so the session actions stay reachable on a short screen", async ({ page }) => {
  test.skip(test.info().project.name !== "mobile-390", "the menu sheet exists below 768 px");
  await page.setViewportSize({ width: 390, height: 420 });
  await signIn(page, "owner-a@geraiexpress.test");
  await page.getByRole("button", { name: "Buka menu" }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet).toBeVisible();
  const overflow = await sheet.evaluate((el) => getComputedStyle(el).overflowY);
  expect(["auto", "scroll"]).toContain(overflow);
  const last = sheet.getByRole("link", { name: "Pengaturan" });
  await last.scrollIntoViewIfNeeded();
  await expect(last).toBeInViewport();
});

test.describe("F3", () => {
  // The invitations RPC fails for every authenticated session of this disposable test database (the
  // isolated runner, one worker). The grant is restored in afterEach, which also runs when the test
  // times out (a try/finally inside a timed-out body does not), so later specs never inherit it.
  // lock_timeout keeps the GRANT/REVOKE from queueing behind a pooled connection indefinitely.
  test.afterEach(() => {
    localSql("set lock_timeout = '10s'; grant execute on function public.tenant_invitations_list(uuid) to authenticated");
  });

  test("F3: a failed read shows a load error, not an empty list", async ({ page }) => {
    localSql("set lock_timeout = '10s'; revoke execute on function public.tenant_invitations_list(uuid) from authenticated");
    await signIn(page, "owner-a@geraiexpress.test");
    await page.goto("/anggota");
    await expect(page.getByTestId("load-error")).toContainText("belum bisa dimuat");
    await expect(page.getByText("Tidak ada undangan yang menunggu")).toHaveCount(0);
  });
});
