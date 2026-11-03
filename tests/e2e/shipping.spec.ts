// PR-4 / PR-5 / PR-6 / PR-7 / PR-9 / UX-1 / UX-3: contact reuse → draft → simulated quote →
// explicit confirmation → sample label, plus unknown-outcome recovery and foreign access.
import { actAsVisitor, expect, randomVisitorIp, test } from "./fixtures";
import { atDashboard, chooseOption, expectNoHorizontalOverflow, localSql, sessionUserId, signIn, signOut, startDemo } from "./helpers";
import type { Page, Route } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

// Optional screenshot evidence (E2E_EVIDENCE_DIR), as in label.spec.ts and invoice-export.spec.ts.
async function evidence(page: Page, name: string, fullPage = true) {
  const dir = process.env.E2E_EVIDENCE_DIR;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: join(dir, `${name}-${test.info().project.name}.png`), fullPage });
}

test("complete simulated counter flow with saved contacts", async ({ page }) => {
  await startDemo(page);
  // The Dashboard header starts the draft directly (C4: no intermediate page; UX-16 landing). Scoped to the
  // page: the app header (T-079) carries the same action from 768 px.
  await page.getByRole("main").getByRole("button", { name: "Buat pengiriman" }).first().click();
  await expect(page).toHaveURL(/\/pengiriman\/[0-9a-f-]{36}$/);

  await chooseOption(page, "Pilih pengirim tersimpan", "Budi Santoso (contoh) · 081200000001");
  await expect(page.getByLabel("Nama pengirim")).toHaveValue("Budi Santoso (contoh)");
  await chooseOption(page, "Pilih penerima tersimpan", "Sari Wulandari (contoh) · 081200000003");
  await expect(page.getByLabel("Alamat tersimpan")).toBeVisible();
  await page.getByLabel("Isi paket").fill("Buku pelajaran");
  await page.getByLabel("Berat (gram)").fill("1500");
  await expectNoHorizontalOverflow(page);

  await page.getByRole("button", { name: "Simpan & cek ongkir" }).click();
  await expect(page.getByText("Ongkir diperbarui")).toBeVisible();
  await expect(page.getByText("Harga contoh (simulasi)").first()).toBeVisible();
  const reguler = page.locator("label").filter({ hasText: "Reguler" });
  const price = (await reguler.locator(".tabular").textContent())!.trim();
  await reguler.click();
  await page.getByRole("button", { name: "Periksa & konfirmasi" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Ini simulasi")).toBeVisible();
  // T-081: confirmation now requires the content declaration (PR-41).
  await dialog.getByRole("checkbox", { name: "Pengirim menyatakan isi paket bukan barang terlarang" }).check();
  await dialog.getByRole("button", { name: "Konfirmasi & terbitkan resi" }).click();

  await expect(page.getByText(/Resi simulasi sudah terbit/)).toBeVisible();
  await expect(page.getByText(/^SIM\d+ \(simulasi\)$/)).toBeVisible();
  // The issued customer charge is exactly the service price that was reviewed (PR-22).
  await expect(page.locator("dd").filter({ hasText: /^Rp/ }).first()).toHaveText(price);
  await page.getByRole("button", { name: "Siapkan label" }).click();
  await expect(page).toHaveURL(/\/label$/);
  await expect(page.getByText("CONTOH — BUKAN LABEL KURIR")).toBeVisible();
  await expect(page.getByTestId("label-awb")).toHaveText(/^SIM\d+$/);
  await expect(page.getByRole("article", { name: "Label contoh" })).toContainText(price);
  await expectNoHorizontalOverflow(page);
});

test("missing fields block quoting and keep entered values", async ({ page }) => {
  await startDemo(page);
  await page.goto("/pengiriman/baru");
  await page.getByRole("button", { name: "Mulai draf baru" }).click();
  await page.getByLabel("Nama pengirim").fill("Hanya Nama");
  await page.getByRole("button", { name: "Simpan & cek ongkir" }).click();
  await expect(page.getByText("Lengkapi data yang ditandai sebelum cek ongkir.")).toBeVisible();
  await expect(page.getByLabel("Nama pengirim")).toHaveValue("Hanya Nama");
  await expect(page.getByLabel("No. HP pengirim")).toHaveAttribute("aria-invalid", "true");
});

test("editing after a quote requires a new quote before confirmation", async ({ page }) => {
  await startDemo(page);
  await page.goto("/pengiriman/baru");
  await page.getByRole("button", { name: "Mulai draf baru" }).click();
  await chooseOption(page, "Pilih pengirim tersimpan", { index: 1 });
  await chooseOption(page, "Pilih penerima tersimpan", { index: 1 });
  await page.getByLabel("Isi paket").fill("Kain");
  await page.getByLabel("Berat (gram)").fill("800");
  await page.getByRole("button", { name: "Simpan & cek ongkir" }).click();
  await expect(page.getByRole("button", { name: "Periksa & konfirmasi" })).toBeVisible();
  await page.getByLabel("Berat (gram)").fill("2500");
  await expect(page.getByText(/Data berubah sejak ongkir dicek/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Periksa & konfirmasi" })).toHaveCount(0);
});

test("unknown outcome is reconciled without a second order", async ({ page }) => {
  await startDemo(page);
  await page.getByRole("link", { name: "Periksa" }).first().click();
  await expect(page.getByText(/Jangan buat pengiriman baru untuk paket ini/)).toBeVisible();
  await page.getByRole("button", { name: "Periksa status operasi asli" }).click();
  await expect(page.getByText(/Tidak ada pesanan kedua yang dibuat/)).toBeVisible();
  await expect(page.getByText("Resi terbit").first()).toBeVisible();
});

test("an operator sees an unknown outcome but must escalate to the admin (DEC-008)", async ({ page }) => {
  await startDemo(page);
  localSql(`update public.memberships set role = 'operator' where user_id = '${await sessionUserId(page)}'`);
  await page.getByRole("link", { name: "Periksa" }).first().click();
  await expect(page.getByText(/Jangan buat pengiriman baru untuk paket ini/)).toBeVisible();
  await expect(page.getByText("Minta admin gerai memeriksa status operasi asli.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Periksa status operasi asli" })).toHaveCount(0);
});

test("another tenant's shipment is not found", async ({ page }) => {
  await signIn(page, "owner-c@geraiexpress.test");
  await expect(page).toHaveURL(atDashboard); // UX-16: sign-in lands on the Dashboard.
  const res = await page.goto("/pengiriman/00000000-0000-4000-e000-00000000000b");
  expect(res?.status()).toBe(404);
});

test("real tenant without a provider cannot quote and is told why", async ({ page }) => {
  await signIn(page, "operator-a@geraiexpress.test");
  await page.goto("/pengiriman/00000000-0000-4000-e000-00000000000a");
  await page.getByLabel("Nama penerima").fill("Penerima A");
  await page.getByLabel("No. HP penerima").fill("081211112222");
  await page.getByLabel("Alamat lengkap").fill("Jl. Tujuan A No. 9");
  // A real gerai picks the recipient's area from Mengantar (T-023); without a key it cannot.
  await expect(page.getByLabel("Kecamatan / kota")).toHaveCount(0);
  await page.getByLabel("Wilayah penerima").fill("Sukatani");
  // exact: the mobile top bar also has "Cari pengiriman" (T-079).
  await page.getByRole("button", { name: "Cari", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: /Akun Mengantar gerai ini belum terhubung/ })).toBeVisible();
  await page.getByRole("button", { name: "Simpan & cek ongkir" }).click();
  await expect(page.getByText("Lengkapi data yang ditandai sebelum cek ongkir.")).toBeVisible();
});

async function quotedDraft(page: import("@playwright/test").Page) {
  await page.goto("/pengiriman/baru");
  await page.getByRole("button", { name: "Mulai draf baru" }).click();
  await expect(page).toHaveURL(/\/pengiriman\/[0-9a-f-]{36}$/);
  await chooseOption(page, "Pilih pengirim tersimpan", { index: 1 });
  await chooseOption(page, "Pilih penerima tersimpan", { index: 1 });
  await page.getByLabel("Isi paket").fill("Kain");
  await page.getByLabel("Berat (gram)").fill("900");
  await page.getByRole("button", { name: "Simpan & cek ongkir" }).click();
  await expect(page.getByRole("button", { name: "Periksa & konfirmasi" })).toBeVisible();
}

test("quoting again without edits does not duplicate services", async ({ page }) => {
  await startDemo(page);
  await quotedDraft(page);
  await page.getByRole("button", { name: "Simpan & cek ongkir" }).click();
  await expect(page.getByText("Ongkir diperbarui")).toBeVisible();
  await expect(page.locator('input[type="radio"][name="quote"]')).toHaveCount(3);
});

// T-043 / PR-5 / UX-10: the browser path of choosing a pickup in the intake form. The form's own named
// controls travel to the draft; the columns are read back with local SQL and the confirmation review
// carries the handover row. (AnterAja-for-pickup-only is a live-quote filter: unit-tested.)
test("choosing 'Jemput kurir' saves the slot with the draft and the review shows 'Penyerahan'", async ({ page }) => {
  await startDemo(page);
  await quotedDraft(page);
  const id = page.url().match(/\/pengiriman\/([0-9a-f-]{36})$/)![1];
  const column = (name: string) => localSql(`select coalesce(${name}::text, '-') from public.shipments where id = '${id}'`);
  expect(column("handover")).toBe("dropoff");

  await page.getByRole("radio", { name: /Jemput kurir/ }).check();
  await expect(page.getByTestId("pickup-details")).toBeVisible();
  await expect(page.getByText(/Data berubah sejak ongkir dicek/)).toBeVisible();
  // Tomorrow noon WIB is always inside the options (the second date) and always at least 90 minutes ahead.
  await chooseOption(page, "Tanggal jemput", { index: 1 });
  const dateText = (await page.getByLabel("Tanggal jemput").textContent())!.trim();
  await chooseOption(page, "Jam jemput (WIB)", "12.00–13.00 WIB");
  await chooseOption(page, "Perkiraan kendaraan penjemput", "Mobil");
  await page.getByLabel("Catatan jemput (opsional)").fill("Titip di satpam");
  await expectNoHorizontalOverflow(page);

  await page.getByRole("button", { name: "Simpan & cek ongkir" }).click();
  // The previous quote's "Ongkir diperbarui" message is still on screen: wait on the stored state itself.
  const tomorrow = localSql(`select ((now() at time zone 'Asia/Jakarta')::date + 1)::text`);
  await expect.poll(() => localSql(`select coalesce(handover || '|' || pickup_date::text || '|' || pickup_slot_hour || '|' || pickup_volume || '|' || pickup_note, '-')
    from public.shipments where id = '${id}'`)).toBe(`pickup|${tomorrow}|12|volumeMobil|Titip di satpam`);

  await page.getByRole("button", { name: "Periksa & konfirmasi" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Penyerahan", { exact: true })).toBeVisible();
  await expect(dialog.getByText(`Jemput kurir · ${dateText} · 12.00–13.00 WIB`)).toBeVisible();
  await expectNoHorizontalOverflow(page);

  // Back to drop-off: the review says so and the pickup columns are cleared on the next save.
  await dialog.getByRole("button", { name: "Kembali" }).click();
  await page.getByRole("radio", { name: /Antar sendiri/ }).check();
  await page.getByRole("button", { name: "Simpan & cek ongkir" }).click();
  // The previous "Ongkir diperbarui" message is still on screen: wait on the stored state itself.
  await expect.poll(() => column("handover")).toBe("dropoff");
  expect(column("pickup_date")).toBe("-");
  await page.getByRole("button", { name: "Periksa & konfirmasi" }).click();
  await expect(page.getByRole("dialog").getByText("Antar sendiri ke gerai kurir")).toBeVisible();
});

test("confirmation without the content declaration is refused with the missing item named (T-081)", async ({ page }) => {
  await startDemo(page);
  await quotedDraft(page);
  await page.getByRole("button", { name: "Periksa & konfirmasi" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByText("Lihat daftar barang terlarang").click();
  await expect(dialog.getByText("barang yang mudah meledak")).toBeVisible();
  await dialog.getByRole("button", { name: "Konfirmasi & terbitkan resi" }).click();
  await expect(dialog.getByRole("alert")).toContainText("Centang pernyataan isi paket");
  await expectNoHorizontalOverflow(page);
  await dialog.getByRole("checkbox", { name: "Pengirim menyatakan isi paket bukan barang terlarang" }).check();
  await dialog.getByRole("button", { name: "Konfirmasi & terbitkan resi" }).click();
  await expect(page.getByText(/Resi simulasi sudah terbit/)).toBeVisible();
  await expect(page.getByTestId("content-declaration")).toContainText("versi 1");
  await expect(page.getByTestId("content-declaration")).toContainText("dicatat oleh Anda");
});

test("double confirmation creates one operation", async ({ page }) => {
  await startDemo(page);
  await quotedDraft(page);
  await page.getByRole("button", { name: "Periksa & konfirmasi" }).click();
  // T-081: confirmation now requires the content declaration (PR-41).
  await page.getByRole("checkbox", { name: "Pengirim menyatakan isi paket bukan barang terlarang" }).check();
  await page.getByRole("button", { name: "Konfirmasi & terbitkan resi" }).dblclick();
  await expect(page.getByText(/Resi simulasi sudah terbit/)).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: /^Dikonfirmasi/ })).toHaveCount(1);
});

test("confirming from a second, stale tab returns the original order", async ({ browser }) => {
  const context = await browser.newContext();
  await actAsVisitor(context, test.info().project.use.baseURL!, randomVisitorIp());
  const first = await context.newPage();
  await startDemo(first);
  await quotedDraft(first);
  const second = await context.newPage();
  await second.goto(first.url());
  await expect(second.getByRole("button", { name: "Periksa & konfirmasi" })).toBeVisible();

  await first.bringToFront();
  await first.getByRole("button", { name: "Periksa & konfirmasi" }).click();
  // T-081: confirmation now requires the content declaration (PR-41).
  await first.getByRole("checkbox", { name: "Pengirim menyatakan isi paket bukan barang terlarang" }).check();
  await first.getByRole("button", { name: "Konfirmasi & terbitkan resi" }).click();
  await expect(first.getByText(/Resi simulasi sudah terbit/)).toBeVisible();
  const awb = (await first.getByText(/^SIM\d+ \(simulasi\)$/).textContent())!;

  await second.bringToFront();
  await second.getByRole("button", { name: "Periksa & konfirmasi" }).click();
  // T-081: confirmation now requires the content declaration (PR-41).
  await second.getByRole("checkbox", { name: "Pengirim menyatakan isi paket bukan barang terlarang" }).check();
  await second.getByRole("button", { name: "Konfirmasi & terbitkan resi" }).click();
  await expect(second.getByText(awb, { exact: true })).toBeVisible();
  await expect(second.getByRole("listitem").filter({ hasText: /^Dikonfirmasi/ })).toHaveCount(1);
  await context.close();
});

test("saving a typed recipient as a contact is explicit and visible in Kontak", async ({ page }) => {
  await startDemo(page);
  await page.goto("/pengiriman/baru");
  await page.getByRole("button", { name: "Mulai draf baru" }).click();
  await page.getByLabel("Nama penerima").fill("Penerima Baru Disimpan");
  await page.getByLabel("No. HP penerima").fill("081299990000");
  await page.getByLabel("Alamat lengkap").fill("Jl. Baru Disimpan No. 2");
  await page.getByLabel("Kecamatan / kota").fill("Kec. Baru, Kota Uji");
  await page.getByRole("checkbox", { name: "Simpan sebagai kontak penerima" }).click();
  await page.getByRole("button", { name: "Simpan draf" }).click();
  await expect(page.getByText("Draf tersimpan.")).toBeVisible();
  await page.goto("/kontak?q=Penerima Baru");
  await expect(page.getByRole("link", { name: /Penerima Baru Disimpan/ })).toBeVisible();
});

test("label is reused, never regenerated, and print hides the app shell", async ({ page }) => {
  await startDemo(page);
  await page.goto("/pengiriman?status=issued");
  await page.locator("[data-testid=shipment-ref]").filter({ visible: true }).first().click();
  await expect(page).toHaveURL(/\/pengiriman\/[0-9a-f-]{36}$/);
  await page.getByRole("button", { name: "Siapkan label" }).click();
  await expect(page).toHaveURL(/\/label$/);
  const detail = page.url().replace(/\/label$/, "");
  await page.goto(detail);
  // T-070 / UX-14: a demo shipment's primary action names the sample label ("contoh"), never a real print.
  await expect(page.getByRole("link", { name: "Lihat contoh label" })).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: /^Label siap/ })).toHaveCount(1);

  await page.goto(detail + "/label");
  await page.emulateMedia({ media: "print" });
  await expect(page.getByRole("article", { name: "Label contoh" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Cetak" })).toBeHidden();
  await expect(page.getByText("Demo · Simulasi.")).toBeHidden();
});

test("label page for a shipment without an AWB redirects back to its detail", async ({ page }) => {
  await startDemo(page);
  await page.goto("/pengiriman?status=draft");
  await page.locator("[data-testid=shipment-ref]").filter({ visible: true }).first().click();
  await expect(page).toHaveURL(/\/pengiriman\/[0-9a-f-]{36}$/);
  const detail = page.url();
  await page.goto(detail + "/label");
  await expect(page).toHaveURL(detail);
});

test("another tenant's label is not found", async ({ page }) => {
  await signIn(page, "owner-c@geraiexpress.test");
  const res = await page.goto("/pengiriman/00000000-0000-4000-e000-00000000000b/label");
  expect(res?.status()).toBe(404);
});

// T-024 / DEC-008: an unknown real Mengantar outcome is resolved by a tenant admin; an operator
// sees the state and is told to escalate, and gets no reconcile button.
test("operators cannot reconcile a real unknown outcome; admins can", async ({ page }) => {
  const id = randomUUID(), op = randomUUID();
  localSql(`insert into public.shipments (tenant_id, outlet_id, id, reference, submission_state, is_simulated, created_by, submitted_at)
      values ('00000000-0000-4000-b000-00000000000a', '00000000-0000-4000-c000-00000000000a', '${id}', 'GX261014-E2E${op.slice(0, 3).toUpperCase()}', 'unknown', false,
      '00000000-0000-4000-a000-0000000000a1', now());
    insert into public.provider_operations (tenant_id, shipment_id, id, kind, idempotency_key, input_digest, state, is_simulated, actor, provider_env, dispatched_at, attempts)
      values ('00000000-0000-4000-b000-00000000000a', '${id}', '${op}', 'create_order', 'e2e-${op}', 'digest', 'unknown', false,
      '00000000-0000-4000-a000-0000000000a1', 'sandbox', now(), 1)`);
  await signIn(page, "operator-a@geraiexpress.test");
  await page.goto(`/pengiriman/${id}`);
  await expect(page.getByText("Hasil belum pasti").first()).toBeVisible();
  await expect(page.getByText("Minta admin gerai memeriksa status operasi asli.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Periksa status operasi asli" })).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
  await signOut(page);
  await signIn(page, "owner-a@geraiexpress.test");
  await page.goto(`/pengiriman/${id}`);
  await expect(page.getByRole("button", { name: "Periksa status operasi asli" })).toBeVisible();
  localSql(`update public.provider_operations set state = 'failed', result_code = 'CLOSED_NOT_CREATED' where id = '${op}';
    update public.shipments set submission_state = 'failed' where id = '${id}'`);
});

test("simulated COD shipment flow computes COD fee, excludes unsupported couriers, and shows COD collection on detail and sample label (T-025)", async ({ page }) => {
  await startDemo(page);
  await page.goto("/pengiriman/baru");
  await page.getByRole("button", { name: "Mulai draf baru" }).click();
  await expect(page).toHaveURL(/\/pengiriman\/[0-9a-f-]{36}$/);

  await chooseOption(page, "Pilih pengirim tersimpan", "Budi Santoso (contoh) · 081200000001");
  await chooseOption(page, "Pilih penerima tersimpan", "Sari Wulandari (contoh) · 081200000003");
  await page.getByLabel("Isi paket").fill("Sepatu olahraga");
  await page.getByLabel("Berat (gram)").fill("1000");
  await page.getByLabel("Nilai barang (Rp)").fill("100000");
  await page.locator("#f-is_cod").click();

  await page.getByRole("button", { name: "Simpan & cek ongkir" }).click();
  await expect(page.getByText("Ongkir diperbarui")).toBeVisible();
  await expect(page.locator("label").filter({ hasText: "Hemat" })).toHaveCount(0);

  const reguler = page.locator("label").filter({ hasText: "Reguler" });
  await expect(reguler).toContainText(/\+ biaya COD Rp/);
  const price = (await reguler.locator(".tabular").first().textContent())!.trim();
  await reguler.click();

  await page.getByRole("button", { name: "Periksa & konfirmasi" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("COD (Bayar di Tempat)")).toBeVisible();
  await expect(dialog.getByText("Tagihan COD ke penerima")).toBeVisible();
  // T-081: confirmation now requires the content declaration (PR-41).
  await dialog.getByRole("checkbox", { name: "Pengirim menyatakan isi paket bukan barang terlarang" }).check();
  await dialog.getByRole("button", { name: "Konfirmasi & terbitkan resi" }).click();

  await expect(page.getByText(/Resi simulasi sudah terbit/)).toBeVisible();
  await expect(page.getByText("Tagihan COD ke penerima")).toBeVisible();
  await expect(page.getByText("COD", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Siapkan label" }).click();
  await expect(page).toHaveURL(/\/label$/);
  await expect(page.getByRole("article", { name: "Label contoh" })).toContainText(price);

  await page.goto("/pengiriman");
  await expect(page.getByText("COD", { exact: true }).filter({ visible: true }).first()).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("unpaid batch review card shows batch members for admin and escalation notice for operator (T-026)", async ({ page }) => {
  const id = randomUUID(), quoteId = randomUUID(), op = randomUUID();
  const ref = `GX261027-B${op.slice(0, 4).toUpperCase()}`;
  try {
    localSql(`
      insert into public.shipments (
        tenant_id, outlet_id, id, reference, submission_state, payment_state, is_simulated,
        sender_name, sender_phone, recipient_name, recipient_phone, recipient_address,
        recipient_area, recipient_area_id, recipient_postal_code, weight_grams, item_description,
        goods_value_idr, customer_charge_idr, is_cod, cod_amount_idr, pickup_snapshot, submitted_at, created_by
      ) values (
        '00000000-0000-4000-b000-00000000000a', '00000000-0000-4000-c000-00000000000a', '${id}', '${ref}',
        'awaiting_payment', 'unpaid', false,
        'Pengirim Batch', '081234567890', 'Penerima Batch E2E', '081298765432', 'Jl. Batch Uji No. 1',
        'KEBAYORAN BARU', '5fc63169f8f44b34aa4c2ee1', '12110', 1000, 'Paket Batch',
        50000, 18000, true, 68000, '{"outlet":"Outlet Uji A"}'::jsonb, now(), '00000000-0000-4000-a000-0000000000a1'
      );
      insert into public.shipment_quotes (
        id, tenant_id, shipment_id, shipment_revision, courier, service, normal_tariff_idr,
        cod_supported, cod_fee_idr, customer_charge_idr, eta_days, is_simulated, expires_at
      ) values (
        '${quoteId}', '00000000-0000-4000-b000-00000000000a', '${id}', 1, 'JNE', 'Reguler', 16000,
        true, 2000, 18000, '1-2', false, now() + interval '1 hour'
      );
      update public.shipments set selected_quote_id = '${quoteId}' where id = '${id}';
      insert into public.provider_operations (
        id, tenant_id, shipment_id, kind, idempotency_key, input_digest, state, is_simulated,
        actor, provider_env, dispatched_at, attempts, provider_order_id, provider_batch, result_code, provider_price_idr
      ) values (
        '${op}', '00000000-0000-4000-b000-00000000000a', '${id}', 'create_order', 'e2e-batch-${op}', 'digest-${op}',
        'succeeded', false, '00000000-0000-4000-a000-0000000000a1', 'sandbox', now(), 1,
        'ORDE2E01', 'BATCHE2E01', 'UNPAID', 18000
      );
    `);

    await signIn(page, "owner-a@geraiexpress.test");
    await page.goto(`/pengiriman/${id}`);
    const review = page.getByTestId("batch-payment-review");
    await expect(review).toBeVisible();
    await expect(review).toContainText("BATCHE2E01");
    await expect(review).toContainText("ORDE2E01");
    await expect(review.getByRole("button", { name: "Bayar batch dari saldo Mengantar" })).toBeVisible();
    await expectNoHorizontalOverflow(page);

    await signOut(page);
    await signIn(page, "operator-a@geraiexpress.test");
    await page.goto(`/pengiriman/${id}`);
    await expect(page.getByTestId("batch-payment-review")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Bayar batch dari saldo Mengantar" })).toHaveCount(0);
    await expect(page.getByText("Minta admin gerai memeriksa pembayaran batch di GeraiExpress.").first()).toBeVisible();
    await expect(page.getByText("membayarnya di aplikasi Mengantar")).toHaveCount(0);
  } finally {
    localSql(`update public.shipments set selected_quote_id = null where id = '${id}';
      delete from public.shipments where id = '${id}'`);
  }
});

// T-043: a seeded pickup shipment (local SQL, no provider call). The detail page shows the handover,
// the date and slot, the real pickup address and the reservation state apart from the order state.
test("shipment detail shows handover type, slot and reservation state for pickup and drop-off (T-043)", async ({ page }) => {
  const TENANT = "00000000-0000-4000-b000-00000000000a";
  const OUTLET = "00000000-0000-4000-c000-00000000000a";
  const OWNER = "00000000-0000-4000-a000-0000000000a1";
  const seeded: string[] = [];
  const seed = (opts: { handover: "pickup" | "dropoff"; state: string; phase?: string; opState?: string; code?: string }) => {
    const id = randomUUID(), op = randomUUID(), quote = randomUUID();
    const ref = `GX261028-P${op.slice(0, 5).toUpperCase()}`;
    const snapshot = opts.handover === "pickup"
      ? `'{"outlet":"Outlet Uji A","address":"Jl. Pickup Gerai No. 7","area":"KEBAYORAN BARU","handover":"pickup","pickup_date":"2026-12-15","pickup_slot_hour":12,"pickup_volume":"volumeMobil","pickup_note":"Titip di satpam"}'::jsonb`
      : `'{"outlet":"Outlet Uji A","address":"Jl. Pickup Gerai No. 7","area":"KEBAYORAN BARU","handover":"dropoff"}'::jsonb`;
    localSql(`
      insert into public.shipments (tenant_id, outlet_id, id, reference, submission_state, is_simulated, sender_name, sender_phone,
        recipient_name, recipient_phone, recipient_address, recipient_area, recipient_area_id, recipient_postal_code, weight_grams,
        item_description, goods_value_idr, customer_charge_idr, pickup_snapshot, submitted_at, created_by)
      values ('${TENANT}', '${OUTLET}', '${id}', '${ref}', '${opts.state}', false, 'Pengirim Jemput', '081234567890',
        'Penerima Jemput E2E', '081298765432', 'Jl. Jemput Uji No. 1', 'KEBAYORAN BARU', '5fc63169f8f44b34aa4c2ee1', '12110', 1000,
        'Paket Jemput', 50000, 9000, ${snapshot}, now(), '${OWNER}');
      insert into public.shipment_quotes (id, tenant_id, shipment_id, shipment_revision, courier, service, normal_tariff_idr,
        eta_days, is_simulated, expires_at)
      values ('${quote}', '${TENANT}', '${id}', 1, 'JT', 'Reguler', 9000, '1-2', false, now() + interval '1 hour');
      update public.shipments set selected_quote_id = '${quote}' where id = '${id}';
      insert into public.provider_operations (id, tenant_id, shipment_id, kind, idempotency_key, input_digest, state, is_simulated,
        actor, provider_env, dispatched_at, attempts, result_code${opts.phase ? ", pickup_phase, pickup_time_id" : ""})
      values ('${op}', '${TENANT}', '${id}', 'create_order', 'e2e-pickup-${op}', 'digest-${op}', '${opts.opState ?? "queued"}', false,
        '${OWNER}', 'sandbox', now(), 1, ${opts.code ? `'${opts.code}'` : "null"}${opts.phase ? `, '${opts.phase}'${opts.phase === "reserving" ? ", null" : ", '6b0c2a1e9d3f4a5b6c7d8e90'"}` : ""});
    `);
    seeded.push(id);
    return id;
  };
  try {
    const reserved = seed({ handover: "pickup", state: "queued", phase: "reserved" });
    const reserving = seed({ handover: "pickup", state: "unknown", phase: "reserving", opState: "unknown", code: "PICKUP_RESERVATION_UNKNOWN" });
    // The real flow stores the refusal WITH phase 'reserving' (the phase is never cleared): the final
    // state must win over it.
    const refused = seed({ handover: "pickup", state: "failed", phase: "reserving", opState: "failed", code: "PICKUP_SLOT_UNAVAILABLE" });
    const orderRefused = seed({ handover: "pickup", state: "failed", phase: "creating", opState: "failed", code: "PROVIDER_REJECTED" });
    const dropoff = seed({ handover: "dropoff", state: "queued" });
    await signIn(page, "operator-a@geraiexpress.test");

    await page.goto(`/pengiriman/${reserved}`);
    await expect(page.getByText("Serah paket")).toBeVisible();
    await expect(page.getByText("Dijemput kurir")).toBeVisible();
    await expect(page.getByTestId("pickup-slot")).toHaveText("Selasa, 15 Desember 2026 · 12.00–13.00 WIB");
    await expect(page.getByText("Kendaraan penjemput")).toBeVisible();
    await expect(page.getByText("Mobil", { exact: true })).toBeVisible();
    await expect(page.getByTestId("pickup-state")).toHaveText("Slot sudah dipesan di Mengantar; pesanan belum dikirim.");
    await expect(page.getByText("Titip di satpam")).toBeVisible();
    // The real pickup address stays visible (returns), separate from the handover rows.
    await expect(page.getByText("Outlet Uji A, Jl. Pickup Gerai No. 7, KEBAYORAN BARU")).toBeVisible();
    await expectNoHorizontalOverflow(page);

    // A lost reservation answer is shown as unknown, apart from the order state.
    await page.goto(`/pengiriman/${reserving}`);
    await expect(page.getByTestId("pickup-state")).toContainText("Memesan slot… hasil belum pasti");
    await expect(page.getByText("Jangan buat pengiriman baru untuk paket ini")).toBeVisible();
    await expectNoHorizontalOverflow(page);

    // A refused slot is a definite refusal: reopenable, and says that no slot was reserved.
    await page.goto(`/pengiriman/${refused}`);
    await expect(page.getByTestId("pickup-state")).toHaveText("Slot tidak dipesan.");
    await expect(page.getByText(/Mengantar menolak slot jemput yang dipilih/)).toBeVisible();
    await expect(page.getByTestId("pickup-state")).not.toContainText("belum pasti");
    await expect(page.getByRole("button", { name: "Ubah & coba lagi" })).toBeVisible();

    // A refused ORDER after a recorded reservation: the slot was reserved, the order was refused.
    await page.goto(`/pengiriman/${orderRefused}`);
    await expect(page.getByTestId("pickup-state")).toHaveText("Slot sudah dipesan di Mengantar, tetapi Mengantar menolak pesanan. Tidak ada pesanan yang dibuat.");
    await expect(page.getByTestId("pickup-state")).not.toContainText("belum pasti");

    await page.goto(`/pengiriman/${dropoff}`);
    await expect(page.getByText("Antar sendiri ke gerai kurir")).toBeVisible();
    await expect(page.getByTestId("pickup-slot")).toHaveCount(0);
    await expect(page.getByTestId("pickup-state")).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
  } finally {
    for (const id of seeded) {
      localSql(`update public.shipments set selected_quote_id = null where id = '${id}'; delete from public.shipments where id = '${id}'`);
    }
  }
});

// Wave B review (Review-B-Security finding): only mapped codes are rendered; query text never is.
test("the detail page never reflects raw query text next to errors or flags", async ({ page }) => {
  const id = randomUUID();
  localSql(`insert into public.shipments (tenant_id, outlet_id, id, reference, submission_state, is_simulated, created_by, submitted_at)
    values ('00000000-0000-4000-b000-00000000000a', '00000000-0000-4000-c000-00000000000a', '${id}', 'GX261028-S${id.slice(0, 5).toUpperCase()}', 'failed', false,
    '00000000-0000-4000-a000-0000000000a1', now())`);
  try {
    await signIn(page, "operator-a@geraiexpress.test");
    // A known code shows its Bahasa message; the injected detail is not shown.
    await page.goto(`/pengiriman/${id}?galat=nothing_to_check&detail=SPOOF`);
    await expect(page.getByRole("alert").filter({ hasText: "Tidak ada pembayaran yang perlu diperiksa." })).toBeVisible();
    await expect(page.locator("body")).not.toContainText("SPOOF");
    // An unknown code falls back to the generic message, never to the raw text.
    await page.goto(`/pengiriman/${id}?galat=SPOOFCODE&detail=SPOOF`);
    await expect(page.getByRole("alert").filter({ hasText: "Terjadi kesalahan. Coba lagi." })).toBeVisible();
    await expect(page.locator("body")).not.toContainText("SPOOF");
    await page.goto(`/pengiriman/${id}?info=SPOOFINFO&hasil=SPOOFHASIL`);
    await expect(page.locator("body")).not.toContainText("SPOOF");
    await expectNoHorizontalOverflow(page);
  } finally {
    localSql(`delete from public.shipments where id = '${id}'`);
  }
});

// T-053 / UX-13 / SUP-13: seeded real shipments (local SQL, no provider in the loop). Every request the
// browser would send to the server is held and finally aborted, so nothing reaches Mengantar.
const T53_TENANT = "00000000-0000-4000-b000-00000000000a";
const T53_OUTLET = "00000000-0000-4000-c000-00000000000a";
const T53_OWNER = "00000000-0000-4000-a000-0000000000a1";

// `attemptMinutesAgo` ages the payment attempt's sent_at; `reserving` seeds a pickup whose reservation answer
// was lost (operation unknown in phase "reserving"), dispatched `reserving.minutesAgo` minutes ago and read back once.
function seedReal(opts: {
  state: "queued" | "awaiting_payment" | "unknown" | "issued" | "failed";
  attempt?: "sent" | "unknown" | null;
  attemptMinutesAgo?: number;
  reserving?: { minutesAgo: number };
}) {
  const id = randomUUID(), quoteId = randomUUID(), op = randomUUID();
  const ref = `GX261028-T${op.slice(0, 5).toUpperCase()}`;
  const batch = `B${op.replace(/-/g, "").slice(0, 8).toUpperCase()}`;
  const unpaid = opts.state === "awaiting_payment";
  const issued = opts.state === "issued";
  const awb = `JP${op.replace(/[^0-9]/g, "").slice(0, 10).padEnd(10, "0")}`;
  const opState = { queued: "queued", unknown: "unknown", awaiting_payment: "succeeded", issued: "succeeded", failed: "failed" }[opts.state];
  const resultCode = unpaid ? "'UNPAID'" : opts.reserving ? "'PICKUP_RESERVATION_UNKNOWN'" : opts.state === "failed" ? "'PROVIDER_REJECTED'" : "null";
  localSql(`
    insert into public.shipments (
      tenant_id, outlet_id, id, reference, submission_state, payment_state, is_simulated,
      sender_name, sender_phone, recipient_name, recipient_phone, recipient_address,
      recipient_area, recipient_area_id, recipient_postal_code, weight_grams, item_description,
      goods_value_idr, customer_charge_idr, is_cod, cod_amount_idr, pickup_snapshot, submitted_at, created_by, awb, issued_at
    ) values (
      '${T53_TENANT}', '${T53_OUTLET}', '${id}', '${ref}', '${opts.state}', '${unpaid ? "unpaid" : issued ? "paid" : "not_applicable"}', false,
      'Pengirim Uji', '081234567890', 'Penerima T053', '081298765432', 'Jl. Uji No. 1',
      'KEBAYORAN BARU', '5fc63169f8f44b34aa4c2ee1', '12110', 1000, 'Paket T053',
      50000, 18000, true, 68000, ${opts.reserving
        ? `'{"outlet":"Outlet Uji A","address":"Jl. Pickup Gerai No. 7","area":"KEBAYORAN BARU","handover":"pickup","pickup_date":"2026-12-15","pickup_slot_hour":12,"pickup_volume":"volumeMotor"}'::jsonb`
        : `'{"outlet":"Outlet Uji A","handover":"dropoff"}'::jsonb`}, now(), '${T53_OWNER}', ${issued ? `'${awb}'` : "null"}, ${issued ? "now()" : "null"}
    );
    insert into public.shipment_quotes (id, tenant_id, shipment_id, shipment_revision, courier, service, normal_tariff_idr,
      cod_supported, cod_fee_idr, customer_charge_idr, eta_days, is_simulated, expires_at)
    values ('${quoteId}', '${T53_TENANT}', '${id}', 1, 'JNE', 'Reguler', 16000, true, 2000, 18000, '1-2', false, now() + interval '1 hour');
    update public.shipments set selected_quote_id = '${quoteId}' where id = '${id}';
    insert into public.provider_operations (id, tenant_id, shipment_id, kind, idempotency_key, input_digest, state, is_simulated,
      actor, provider_env, dispatched_at, attempts, provider_order_id, provider_batch, result_code, provider_price_idr, pickup_phase, last_checked_at)
    values ('${op}', '${T53_TENANT}', '${id}', 'create_order', 'e2e-t053-${op}', 'digest-${op}',
      '${opState}', false,
      '${T53_OWNER}', 'sandbox', now() - interval '${opts.reserving?.minutesAgo ?? 0} minutes', 1, ${unpaid || issued ? `'ORD${op.replace(/-/g, "").slice(0, 8).toUpperCase()}'` : "null"},
      ${unpaid ? `'${batch}'` : "null"}, ${resultCode}, ${unpaid || issued ? 18000 : "null"},
      ${opts.reserving ? "'reserving'" : "null"}, ${opts.reserving ? "now()" : "null"});
    ${opts.attempt ? `insert into private.batch_payment_attempts (tenant_id, claim_operation_id, batch_code, courier, batch_digest,
      authorization_id, authorized_by, state, lease_expires_at, sent_at)
      values ('${T53_TENANT}', '${op}', '${batch}', 'JNE', 'digest-e2e', gen_random_uuid(), '${T53_OWNER}', '${opts.attempt}', now() + interval '2 minutes',
        now() - interval '${opts.attemptMinutesAgo ?? 0} minutes');` : ""}
  `);
  const cleanup = () => localSql(`update public.shipments set selected_quote_id = null where id = '${id}';
    delete from public.shipments where id = '${id}'`);
  return { id, ref, awb, cleanup };
}

// Holds every Server Action POST (counting them) instead of sending it; abort() releases them without a response.
async function holdServerActions(page: Page) {
  const held: Route[] = [];
  await page.route(/\/pengiriman\//, async (route) => {
    if (route.request().method() === "POST" && route.request().headers()["next-action"]) held.push(route);
    else await route.continue();
  });
  return { held, abort: async () => { for (const r of held) await r.abort(); } };
}

test("'Bayar batch' needs an explicit confirmation naming the orders and the amount, and a double click sends one request (T-053)", async ({ page }) => {
  const { id, cleanup } = seedReal({ state: "awaiting_payment" });
  try {
    await signIn(page, "owner-a@geraiexpress.test");
    await page.goto(`/pengiriman/${id}`);
    const requests = await holdServerActions(page);
    const trigger = page.getByRole("button", { name: "Bayar batch dari saldo Mengantar" });
    await trigger.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("saldo Mengantar");
    await expect(dialog).toContainText("dipotong");
    await expect(dialog.getByTestId("batch-pay-summary")).toContainText("1 pesanan");
    await expect(dialog.getByTestId("batch-pay-summary")).toContainText(/Rp\s*18\.000/);
    await expect(dialog).toContainText("tidak bisa dibatalkan");
    await expectNoHorizontalOverflow(page);

    // Cancelling sends nothing.
    await dialog.getByRole("button", { name: "Batal" }).click();
    await expect(dialog).toHaveCount(0);
    expect(requests.held).toHaveLength(0);

    await trigger.click();
    // The accessible name changes to the pending label while submitting, so the button is found by test id.
    const confirm = page.getByTestId("batch-pay-confirm");
    await confirm.dblclick();
    await expect(confirm).toHaveAttribute("aria-busy", "true");
    await expect(confirm).toHaveAttribute("aria-disabled", "true");
    await expect(page.getByRole("dialog").getByText("Membayar…")).toBeVisible();
    await page.waitForTimeout(600);
    expect(requests.held).toHaveLength(1);
    await requests.abort();
  } finally {
    cleanup();
  }
});

test("an unresolved payment attempt shows a reconcile-only panel with no 'Bayar batch' button (T-053 / R1)", async ({ page }) => {
  await signIn(page, "owner-a@geraiexpress.test");
  for (const attempt of ["sent", "unknown"] as const) {
    const { id, cleanup } = seedReal({ state: "awaiting_payment", attempt });
    try {
      await page.goto(`/pengiriman/${id}`);
      const panel = page.getByTestId("payment-unresolved");
      await expect(panel).toBeVisible();
      await expect(panel).toHaveAttribute("data-attempt-state", attempt);
      await expect(panel).toContainText("Pembayaran sedang dicek / hasil belum pasti.");
      await expect(panel).toContainText("Jangan bayar ulang. Periksa di aplikasi Mengantar atau tunggu pemeriksaan otomatis.");
      await expect(page.getByRole("button", { name: "Bayar batch dari saldo Mengantar" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Periksa pembayaran" })).toBeVisible();
      await expect(page.getByTestId("batch-payment-review")).toContainText("ORD");
      await expectNoHorizontalOverflow(page);
    } finally {
      cleanup();
    }
  }
  // No attempt (or a resolved one): the batch stays payable.
  const { id, cleanup } = seedReal({ state: "awaiting_payment" });
  try {
    await page.goto(`/pengiriman/${id}`);
    await expect(page.getByTestId("payment-unresolved")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Bayar batch dari saldo Mengantar" })).toBeVisible();
  } finally {
    cleanup();
  }
});

test("money and provider buttons go pending, announce it and swallow repeat clicks (T-053 / SUP-13)", async ({ page }) => {
  await signIn(page, "owner-a@geraiexpress.test");
  const cases = [
    // T-089 F10: "Kirim sekarang" now opens a confirmation; its submit is "Ya, kirim ke Mengantar".
    { state: "queued", button: "Ya, kirim ke Mengantar", pendingText: "Mengirim…", opener: "Kirim sekarang" },
    { state: "awaiting_payment", button: "Periksa pembayaran", pendingText: "Memeriksa…" },
    { state: "unknown", button: "Periksa status operasi asli", pendingText: "Memeriksa…" },
  ] as const;
  for (const c of cases) {
    const { id, cleanup } = seedReal({ state: c.state });
    try {
      await page.goto(`/pengiriman/${id}`);
      if ("opener" in c) {
        await page.getByRole("button", { name: c.opener }).click();
        await expect(page.getByRole("dialog")).toContainText("Tidak ada pesanan baru yang dibuat");
      }
      const requests = await holdServerActions(page);
      // The accessible name changes to the pending label while submitting, so find the button by its text content.
      const button = page.locator("form button[type=submit]", { hasText: c.button });
      await button.dblclick();
      await expect(button).toHaveAttribute("aria-busy", "true");
      await expect(button).toHaveAttribute("aria-disabled", "true");
      await expect(button.getByText(c.pendingText)).toBeVisible();
      await page.waitForTimeout(600);
      expect(requests.held, c.button).toHaveLength(1);
      await requests.abort();
      await page.unroute(/\/pengiriman\//);
    } finally {
      cleanup();
    }
  }
});

// T-056: the tenant admin's close commands. Both only record a decision (nothing is sent to Mengantar), sit
// behind a danger confirmation with a required reason, and are never offered to operators.
const attemptState = (shipmentId: string) => localSql(`select a.state from private.batch_payment_attempts a
  join public.provider_operations o on o.id = a.claim_operation_id where o.shipment_id = '${shipmentId}' order by a.created_at desc limit 1`);
const REASON = "Sudah dicek di aplikasi Mengantar, batch belum dibayar.";

test("an operator gets no close control for an unknown payment or an ambiguous reservation (T-056)", async ({ page }) => {
  const payment = seedReal({ state: "awaiting_payment", attempt: "unknown" });
  const reservation = seedReal({ state: "unknown", reserving: { minutesAgo: 40 } });
  try {
    await signIn(page, "operator-a@geraiexpress.test");
    await page.goto(`/pengiriman/${payment.id}`);
    await expect(page.getByText("Minta admin gerai memeriksa pembayaran batch di GeraiExpress.").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Tutup percobaan pembayaran" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Bayar batch dari saldo Mengantar" })).toHaveCount(0);
    await page.goto(`/pengiriman/${reservation.id}`);
    await expect(page.getByText("Minta admin gerai memeriksa status operasi asli.")).toBeVisible();
    await expect(page.getByTestId("close-reservation")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Tutup pemesanan slot jemput" })).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
  } finally {
    payment.cleanup();
    reservation.cleanup();
  }
});

test("an admin closes an 'unknown' or 'sent' payment attempt older than 30 minutes; the batch becomes payable again (T-056)", async ({ page }) => {
  await signIn(page, "owner-a@geraiexpress.test");
  for (const seed of [{ attempt: "unknown" as const, attemptMinutesAgo: 45 }, { attempt: "sent" as const, attemptMinutesAgo: 45 }]) {
    const { id, cleanup } = seedReal({ state: "awaiting_payment", ...seed });
    try {
      await page.goto(`/pengiriman/${id}`);
      // While the attempt is unresolved: the reconcile-only panel, no pay button, the close control.
      await expect(page.getByTestId("payment-unresolved")).toContainText("Jangan bayar ulang.");
      await expect(page.getByRole("button", { name: "Bayar batch dari saldo Mengantar" })).toHaveCount(0);
      await page.getByRole("button", { name: "Tutup percobaan pembayaran" }).click();
      const dialog = page.getByTestId("close-payment-dialog");
      await expect(dialog).toContainText("tidak mengirim apa pun ke Mengantar");
      await expect(dialog).toContainText("aplikasi Mengantar");
      await expect(dialog).toContainText("batch bisa diotorisasi dan dibayar lagi");
      await expectNoHorizontalOverflow(page);
      // The reason is required (5–500 characters): a short one is stopped before anything is sent.
      const reason = dialog.getByLabel("Alasan penutupan");
      await reason.fill("abc");
      await dialog.getByTestId("close-payment-confirm").click();
      expect(await reason.evaluate((el: HTMLTextAreaElement) => el.validity.valid)).toBe(false);
      await expect(page).not.toHaveURL(/[?&]info=/);

      await reason.fill(REASON);
      await dialog.getByTestId("close-payment-confirm").click();
      await expect(page).toHaveURL(/[?&]info=payment_closed$/);
      await expect(page.getByTestId("dispatch-info")).toContainText("Percobaan pembayaran batch ditutup");
      expect(attemptState(id)).toBe("closed");
      await expect(page.getByTestId("payment-unresolved")).toHaveCount(0);
      await expect(page.getByTestId("payment-attempt-closed")).toBeVisible();
      await expect(page.getByRole("button", { name: "Bayar batch dari saldo Mengantar" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Tutup percobaan pembayaran" })).toHaveCount(0);
    } finally {
      cleanup();
    }
  }
});

// 20261029200000: every open attempt (sent or unknown) waits 30 minutes from sent_at; review_unpaid_batch returns
// sent_at, so the page hides the control until then. The database stays authoritative: a form opened inside the
// window but submitted after the attempt was re-sent is refused, and the typed reason survives the refusal.
test("a payment attempt younger than 30 minutes offers no close; a refused close keeps the typed reason (T-056)", async ({ page }) => {
  await signIn(page, "owner-a@geraiexpress.test");
  for (const attempt of ["sent", "unknown"] as const) {
    const fresh = seedReal({ state: "awaiting_payment", attempt });
    try {
      await page.goto(`/pengiriman/${fresh.id}`);
      await expect(page.getByTestId("close-payment"), attempt).toContainText("30 menit setelah perintah bayar dikirim");
      await expect(page.getByRole("button", { name: "Tutup percobaan pembayaran" }), attempt).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Bayar batch dari saldo Mengantar" }), attempt).toHaveCount(0);
    } finally {
      fresh.cleanup();
    }
  }

  const { id, cleanup } = seedReal({ state: "awaiting_payment", attempt: "unknown", attemptMinutesAgo: 45 });
  const setSentAt = (minutesAgo: number) => localSql(`update private.batch_payment_attempts a set sent_at = now() - interval '${minutesAgo} minutes'
    from public.provider_operations o where o.id = a.claim_operation_id and o.shipment_id = '${id}'`);
  try {
    await page.goto(`/pengiriman/${id}`);
    await page.getByRole("button", { name: "Tutup percobaan pembayaran" }).click();
    await page.getByTestId("close-payment-dialog").getByLabel("Alasan penutupan").fill(REASON);
    setSentAt(0);
    await page.getByTestId("close-payment-confirm").click();
    await expect(page).toHaveURL(/[?&]galat=not_closable$/);
    await expect(page.getByRole("alert").filter({ hasText: "Belum bisa ditutup" })).toBeVisible();
    expect(attemptState(id)).toBe("unknown");
    await expect(page.getByRole("button", { name: "Tutup percobaan pembayaran" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Bayar batch dari saldo Mengantar" })).toHaveCount(0);
    // Once the window has passed again, the reopened dialog still holds the reason typed before the refusal.
    setSentAt(45);
    await page.reload();
    await page.getByRole("button", { name: "Tutup percobaan pembayaran" }).click();
    await expect(page.getByTestId("close-payment-dialog").getByLabel("Alasan penutupan")).toHaveValue(REASON);
  } finally {
    cleanup();
  }
});

test("an admin closes an ambiguous pickup reservation once it is closable; the draft can then be reopened (T-056)", async ({ page }) => {
  const fresh = seedReal({ state: "unknown", reserving: { minutesAgo: 5 } });
  const old = seedReal({ state: "unknown", reserving: { minutesAgo: 40 } });
  try {
    await signIn(page, "owner-a@geraiexpress.test");
    // Under 30 minutes after dispatch: explained, not offered.
    await page.goto(`/pengiriman/${fresh.id}`);
    await expect(page.getByTestId("close-reservation")).toContainText("30 menit setelah dikirim");
    await expect(page.getByRole("button", { name: "Tutup pemesanan slot jemput" })).toHaveCount(0);

    await page.goto(`/pengiriman/${old.id}`);
    await expect(page.getByRole("button", { name: "Periksa status operasi asli" })).toBeVisible();
    await page.getByRole("button", { name: "Tutup pemesanan slot jemput" }).click();
    const dialog = page.getByTestId("close-reservation-dialog");
    await expect(dialog).toContainText("tidak mengirim apa pun ke Mengantar");
    await expect(dialog).toContainText(old.ref);
    await expect(dialog).toContainText("drafnya bisa dibuka lagi");
    await expectNoHorizontalOverflow(page);
    await dialog.getByLabel("Alasan penutupan").fill("Tidak ada slot maupun pesanan di aplikasi Mengantar.");
    await dialog.getByTestId("close-reservation-confirm").click();
    await expect(page).toHaveURL(/[?&]info=closed$/);
    await expect(page.getByTestId("dispatch-info")).toContainText("Percobaan ditutup");
    await expect(page.getByText("Gagal", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Ubah & coba lagi" })).toBeVisible();
    expect(localSql(`select state || '|' || result_code from public.provider_operations where shipment_id = '${old.id}'`)).toBe("failed|CLOSED_NOT_CREATED");
  } finally {
    fresh.cleanup();
    old.cleanup();
  }
});

// T-070 / UX-14: the counter handoff after confirmation, one test per row of the UX-14 table.
const printLink = (page: Page) => page.getByRole("link", { name: "Cetak label", exact: true });

// Below 640 px the issued actions sit in a sticky bar: tab through the page and check that no focused
// control outside the bar ends up underneath it (WCAG 2.4.11).
async function expectFocusClearOfBar(page: Page) {
  const bar = page.getByTestId("detail-action-bar");
  await expect(bar).toBeVisible();
  await page.locator("main a").first().focus();
  for (let i = 0; i < 25; i++) {
    const verdict = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      const barEl = document.querySelector<HTMLElement>("[data-testid=detail-action-bar]")!;
      if (!el || barEl.contains(el)) return "bar";
      return el.getBoundingClientRect().bottom <= barEl.getBoundingClientRect().top + 1 ? "clear" : `covered: ${el.textContent?.trim()}`;
    });
    if (verdict === "bar") return;
    expect(verdict).toBe("clear");
    await page.keyboard.press("Tab");
  }
  throw new Error("focus never reached the action bar");
}

test("issued (real): the resi is copyable, 'Cetak label' is primary and 'Buat pengiriman lagi' starts a draft in one click (T-070)", async ({ page, context }) => {
  const s = seedReal({ state: "issued" });
  let next: string | null = null;
  try {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await signIn(page, "owner-a@geraiexpress.test");
    await page.goto(`/pengiriman/${s.id}`);
    const result = page.getByTestId("issued-result");
    await expect(result).toContainText("Resi terbit");
    await expect(result.getByTestId("awb")).toHaveText(s.awb);
    await result.getByRole("button", { name: "Salin resi" }).click();
    await expect(result.getByTestId("awb-copy-status")).toHaveText("Tersalin");
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(s.awb);
    await expect(printLink(page)).toHaveCount(1);
    await expect(printLink(page)).toHaveAttribute("href", `/pengiriman/${s.id}/label`);
    await expect(page.getByRole("button", { name: /Konfirmasi|Periksa & konfirmasi/ })).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
    await evidence(page, "t070-issued-real");
    if ((page.viewportSize()?.width ?? 1280) < 640) {
      await expect(page.getByTestId("detail-action-bar").getByRole("link", { name: "Cetak label", exact: true })).toBeVisible();
      await expectFocusClearOfBar(page);
      await page.evaluate(() => window.scrollTo(0, 700));
      await evidence(page, "t070-issued-real-bar", false);
    } else {
      await expect(page.getByTestId("detail-action-bar")).toBeHidden();
    }
    await page.getByRole("button", { name: "Buat pengiriman lagi" }).click();
    await expect(page).not.toHaveURL(new RegExp(s.id));
    await expect(page).toHaveURL(/\/pengiriman\/[0-9a-f-]{36}$/);
    next = page.url().match(/\/pengiriman\/([0-9a-f-]{36})$/)![1];
    await expect(page.getByLabel("Nama pengirim")).toHaveValue("");
  } finally {
    s.cleanup();
    if (next) localSql(`delete from public.shipments where id = '${next}'`);
  }
});

test("issued (real): without clipboard access the resi is selected for manual copy (T-070)", async ({ page }) => {
  const s = seedReal({ state: "issued" });
  try {
    await page.addInitScript(() => Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true }));
    await signIn(page, "owner-a@geraiexpress.test");
    await page.goto(`/pengiriman/${s.id}`);
    await page.getByRole("button", { name: "Salin resi" }).click();
    await expect(page.getByTestId("awb-copy-status")).toContainText("salin manual");
    expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(s.awb);
  } finally {
    s.cleanup();
  }
});

test("issued (demo): the result and the label are 'contoh', with no real print and no new-order action (T-070)", async ({ page }) => {
  await startDemo(page);
  await page.goto("/pengiriman?status=issued");
  await page.locator("[data-testid=shipment-ref]").filter({ visible: true }).first().click();
  await expect(page).toHaveURL(/\/pengiriman\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId("issued-result")).toContainText("Resi contoh terbit");
  await expect(page.getByTestId("issued-result")).toContainText("bukan label kurir");
  await expect(printLink(page)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Buat pengiriman lagi" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Cetak resi + invoice" })).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
  await evidence(page, "t070-issued-demo");
  await page.getByRole("button", { name: "Siapkan label" }).click();
  await expect(page).toHaveURL(/\/label$/);
  await page.goBack();
  await page.reload();
  await expect(page.getByRole("link", { name: "Lihat contoh label" })).toBeVisible();
});

test("awaiting payment, unknown and failed never offer print or a new order from the same draft (T-070)", async ({ page }) => {
  await signIn(page, "owner-a@geraiexpress.test");
  const rows = [
    { state: "awaiting_payment", primary: "Periksa pembayaran" },
    { state: "unknown", primary: "Periksa status operasi asli" },
    { state: "failed", primary: "Ubah & coba lagi" },
  ] as const;
  for (const row of rows) {
    const s = seedReal({ state: row.state });
    try {
      await page.goto(`/pengiriman/${s.id}`);
      await expect(page.getByRole("button", { name: row.primary })).toBeVisible();
      await expect(printLink(page), row.state).toHaveCount(0);
      await expect(page.getByRole("link", { name: /Cetak|contoh label/ }), row.state).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Buat pengiriman lagi" }), row.state).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Salin resi" }), row.state).toHaveCount(0);
      await expect(page.getByTestId("detail-action-bar"), row.state).toHaveCount(0);
      await expectNoHorizontalOverflow(page);
      await evidence(page, `t070-${row.state}`);
    } finally {
      s.cleanup();
    }
  }
});

test("keyboard only: from the last intake control to the label page (T-070, 1280)", async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 1280) < 1280, "UX-14 item 2 asks for the keyboard path at 1280 px");
  await startDemo(page);
  await quotedDraft(page);
  const tabTo = async (name: string) => {
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press("Tab");
      if ((await page.evaluate(() => document.activeElement?.textContent?.trim() ?? "")).startsWith(name)) return;
    }
    throw new Error(`Tab never reached "${name}"`);
  };
  await page.getByRole("button", { name: "Simpan draf" }).focus();
  await tabTo("Periksa & konfirmasi");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
  // T-081: the declaration checkbox precedes the confirm button; Space ticks it (UX-19 item 7 order).
  await tabTo("Lihat daftar barang terlarang");
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Space");
  await tabTo("Konfirmasi & terbitkan resi");
  await page.keyboard.press("Enter");
  await expect(page.getByText(/Resi simulasi sudah terbit/)).toBeVisible();
  await page.locator("main a").first().focus();
  await tabTo("Siapkan label");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/label$/);
});

// T-072 / UX-15: the recipient area is a keyboard combobox. The area endpoint is answered in the browser
// (page.route), so no request reaches Mengantar; the first search is held to observe the loading state.
test("the recipient area combobox: Enter searches, arrows move, Enter picks, Escape closes; loading, count, empty and error are announced (T-072)", async ({ page }) => {
  const areas = [
    { id: "a1", province: "JAWA BARAT", city: "DEPOK", district: "TAPOS", subdistrict: "SUKATANI", zip: "16454" },
    { id: "a2", province: "JAWA BARAT", city: "BEKASI", district: "TAMBUN SELATAN", subdistrict: "SUKATANI", zip: "17510" },
    { id: "a3", province: "BANTEN", city: "TANGERANG", district: "RAJEG", subdistrict: "SUKATANI", zip: "15540" },
  ];
  let reply: "ok" | "empty" | "error" = "ok";
  const hold = Promise.withResolvers<void>();
  let held = false;
  await page.route(/\/api\/mengantar\/area\?/, async (route) => {
    if (!held) {
      held = true;
      await hold.promise;
    }
    if (reply === "error") await route.fulfill({ status: 502, json: { error: "mengantar_unavailable" } });
    else await route.fulfill({ json: { areas: reply === "ok" ? areas : [] } });
  });
  await signIn(page, "operator-a@geraiexpress.test");
  await page.goto("/pengiriman/00000000-0000-4000-e000-00000000000a");
  const box = page.getByRole("combobox", { name: "Wilayah penerima" });
  const status = page.locator(`[id="${(await box.getAttribute("aria-describedby"))!.split(" ")[1]}"]`);
  await expect(box).toHaveAttribute("aria-expanded", "false");
  const list = page.locator(`[id="${await box.getAttribute("aria-controls")}"]`);
  await expect(list).toHaveAttribute("role", "listbox");

  await box.fill("Sukatani");
  await box.press("Enter");
  await expect(box).toHaveAttribute("aria-busy", "true");
  await expect(status).toHaveText("Mencari wilayah…");
  hold.resolve();
  await expect(status).toContainText("3 wilayah ditemukan");
  await expect(status).toHaveAttribute("role", "status");
  await expect(box).toHaveAttribute("aria-expanded", "true");
  await expect(list.getByRole("option")).toHaveCount(3);
  await expectNoHorizontalOverflow(page);
  await box.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await evidence(page, "t072-area-open", false);

  await box.press("ArrowDown");
  await box.press("ArrowDown");
  const active = page.locator(`[id="${await box.getAttribute("aria-activedescendant")}"]`);
  await expect(active).toContainText("SUKATANI, TAMBUN SELATAN, BEKASI");
  await expect(active).toHaveAttribute("aria-selected", "true");
  await box.press("Enter");
  await expect(page.getByTestId("area-chosen")).toContainText("SUKATANI, TAMBUN SELATAN, BEKASI");
  await expect(page.getByLabel("Kode pos")).toHaveValue("17510");
  await expect(box).toHaveAttribute("aria-expanded", "false");
  await expect(box).not.toHaveAttribute("aria-activedescendant");
  await expect(box).toBeFocused();

  // Arrow Down reopens the last results; Escape closes them without changing the choice.
  await box.press("ArrowDown");
  await expect(box).toHaveAttribute("aria-expanded", "true");
  await box.press("Escape");
  await expect(box).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByTestId("area-chosen")).toContainText("TAMBUN SELATAN");

  reply = "empty";
  await box.fill("Zzzzz");
  await box.press("Enter");
  await expect(status).toContainText("Tidak ada wilayah yang cocok");
  await expect(box).toHaveAttribute("aria-expanded", "false");

  reply = "error";
  await box.press("Enter");
  await expect(status).toContainText("Mengantar sedang tidak bisa dihubungi");
  await expect(box).toHaveAttribute("aria-expanded", "false");
  await box.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await evidence(page, "t072-area-error", false);
});

// T-080: the same operator path is exercised by the 390px and 1280px projects (also tablet).
test("billable weights show sourced volume, survive confirmation, and re-quote after dimension changes", async ({ page }) => {
  await startDemo(page);
  await page.getByRole("main").getByRole("button", { name: "Buat pengiriman" }).first().click();
  await expect(page).toHaveURL(/\/pengiriman\/[0-9a-f-]{36}$/);
  await chooseOption(page, "Pilih pengirim tersimpan", { index: 1 });
  await chooseOption(page, "Pilih penerima tersimpan", { index: 1 });
  await page.getByLabel("Berat (gram)").fill("1000");
  await page.getByLabel("Isi paket").fill("Buku dalam kardus");
  await expect(page.getByText(/Kurir dapat menimbang ulang/)).toBeVisible();
  await page.getByRole("button", { name: "Simpan & cek ongkir" }).click();
  await expect(page.getByTestId("quote-weights").first()).toContainText("Tanpa ukuran: berat volume tidak dihitung");
  await page.getByLabel("Panjang (cm)").fill("30");
  await page.getByLabel("Lebar (cm)").fill("20");
  await page.getByLabel("Tinggi (cm)").fill("20");
  await expect(page.getByRole("button", { name: "Periksa & konfirmasi" })).toHaveCount(0);
  await page.getByRole("button", { name: "Simpan & cek ongkir" }).click();
  const weights = page.getByTestId("quote-weights");
  await expect(weights).toHaveCount(3);
  for (const row of await weights.all()) {
    await expect(row).toContainText("Berat aktual: 1000 g");
    await expect(row).toContainText("Berat volume: 2000 g");
    await expect(row).toContainText("Berat ditagih: 2000 g");
    await expect(row.getByRole("link", { name: "Aturan Mengantar, diperbarui 2026-10-19" })).toHaveAttribute("href", /5387484/);
  }
  await expectNoHorizontalOverflow(page);
  await evidence(page, "billable-weight-intake");
  await page.getByRole("button", { name: "Periksa & konfirmasi" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("2000 g");
  // T-081: confirmation now requires the content declaration (PR-41).
  await dialog.getByRole("checkbox", { name: "Pengirim menyatakan isi paket bukan barang terlarang" }).check();
  await dialog.getByRole("button", { name: "Konfirmasi & terbitkan resi" }).click();
  await expect(page.getByText(/Resi simulasi sudah terbit/)).toBeVisible();
  const facts = page.getByRole("region", { name: "Detail pengiriman" });
  await expect(facts).toContainText("Berat aktual");
  await expect(facts).toContainText("Berat volume");
  await expect(facts).toContainText("Berat ditagih");
  await expectNoHorizontalOverflow(page);
  await evidence(page, "billable-weight-confirmed");
});

test("another member sees which staff member recorded the content declaration (T-081, PR-41)", async ({ page }) => {
  const id = randomUUID(), quote = randomUUID();
  const TENANT_A = "00000000-0000-4000-b000-00000000000a", OUTLET_A = "00000000-0000-4000-c000-00000000000a";
  const OPERATOR_A = "00000000-0000-4000-a000-0000000000a2";
  localSql(`insert into public.shipments (tenant_id, outlet_id, id, reference, submission_state, payment_state, recipient_name, recipient_phone,
      recipient_address, item_description, weight_grams, goods_value_idr, is_simulated, created_by, submitted_at, issued_at, awb, customer_charge_idr,
      content_declaration_version, content_declared_by, content_declared_at, content_declared_by_email)
    values ('${TENANT_A}', '${OUTLET_A}', '${id}', 'DECL-${id.slice(0, 6).toUpperCase()}', 'issued', 'paid', 'Penerima Uji', '081234567890',
      'Jl. Uji 1', 'Buku', 1000, 50000, false, '${OPERATOR_A}', now(), now(), 'JP9999000011', 9000,
      1, '${OPERATOR_A}', now(), 'operator-a@geraiexpress.test');
    insert into public.shipment_quotes (tenant_id, shipment_id, id, shipment_revision, courier, service, normal_tariff_idr, eta_days, is_simulated, expires_at)
      values ('${TENANT_A}', '${id}', '${quote}', 1, 'JT', 'Reguler', 9000, '1-2', false, now() + interval '1 hour');
    update public.shipments set selected_quote_id = '${quote}' where id = '${id}';`);
  try {
    await signIn(page, "owner-a@geraiexpress.test");
    await page.goto(`/pengiriman/${id}`);
    const declaration = page.getByTestId("content-declaration");
    await expect(declaration).toContainText("versi 1");
    await expect(declaration).toContainText("dicatat oleh operator-a@geraiexpress.test");
    await expect(declaration).not.toContainText("Anda");
    await expectNoHorizontalOverflow(page);
  } finally {
    localSql(`update public.shipments set selected_quote_id = null where id = '${id}'; delete from public.shipments where id = '${id}'`);
  }
});
