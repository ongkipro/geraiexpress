// T-082 / UX-17 items 1-4, 7, 8: the counter payment record and the customer receipt at the 390, 768
// and 1280 projects. Fixtures are synthetic real issued shipments of tenant A inserted with local SQL
// and no provider operation row (nothing for the dispatch sweep); they are deleted afterwards.
// window.print is stubbed: opening the browser dialog is not paper output.
import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { expectNoHorizontalOverflow, localSql, signIn, startDemo } from "./helpers";

const TENANT_A = "00000000-0000-4000-b000-00000000000a";
const OUTLET_A = "00000000-0000-4000-c000-00000000000a";
const OWNER_A = "00000000-0000-4000-a000-0000000000a1";
const CHARGE = 24680;

const created: string[] = [];
const demoTenants: string[] = [];

function issuedShipment(opts: { cod?: number; charge?: number | null } = {}) {
  const id = randomUUID(), quote = randomUUID();
  created.push(id);
  const charge = opts.charge === undefined ? CHARGE : opts.charge;
  localSql(`
    insert into public.shipments (tenant_id, outlet_id, id, reference, submission_state, payment_state, sender_name, sender_phone,
      recipient_name, recipient_phone, recipient_address, recipient_area, item_description, weight_grams,
      goods_value_idr, is_cod, cod_amount_idr, is_simulated, created_by, submitted_at, issued_at, awb, customer_charge_idr, pickup_snapshot)
    values ('${TENANT_A}', '${OUTLET_A}', '${id}', 'GERA-PAY-${id.slice(0, 6).toUpperCase()}', 'issued', 'unpaid',
      'Pengirim Kasir', '081200000077', 'Penerima Uji', '081234567890', 'Jl. Tujuan Uji No. 9', 'Kec. Tujuan, Kota Uji',
      'Buku', 1500, 50000, ${opts.cod ? "true" : "false"}, ${opts.cod ?? "null"}, false, '${OWNER_A}',
      now(), now(), 'JP9876543210', ${charge === null ? "null" : charge}, jsonb_build_object('outlet', 'Outlet A'));
    insert into public.shipment_quotes (tenant_id, shipment_id, id, shipment_revision, courier, service, normal_tariff_idr, eta_days, is_simulated, expires_at)
      values ('${TENANT_A}', '${id}', '${quote}', 1, 'JT', 'REG', ${CHARGE}, '1-2', false, now() + interval '1 hour');
    insert into private.quote_costs (tenant_id, quote_id, net_shipping_idr) values ('${TENANT_A}', '${quote}', 13579);
    update public.shipments set selected_quote_id = '${quote}' where id = '${id}';`);
  return id;
}

const activeCount = (shipment: string) =>
  Number(localSql(`select count(*) from public.counter_payments where shipment_id = '${shipment}' and voided_at is null`));

test.afterAll(() => {
  if (created.length > 0) {
    const ids = created.map((i) => `'${i}'`).join(",");
    localSql(`update public.shipments set selected_quote_id = null where id in (${ids}); delete from public.shipments where id in (${ids})`);
  }
  for (const tenant of demoTenants) localSql(`delete from public.tenants where id = '${tenant}'`);
});

declare global {
  interface Window { __prints: number }
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.__prints = 0;
    window.print = () => { window.__prints++; };
  });
});

const card = (page: Page) => page.getByTestId("counter-payment");

test("operator records a cash payment once, even on a double-click, and prints the receipt", async ({ page }, testInfo) => {
  const id = issuedShipment();
  await signIn(page, "operator-a@geraiexpress.test");
  await page.goto(`/pengiriman/${id}`);
  await expect(card(page).getByTestId("counter-payment-state")).toHaveText("Pelanggan: belum bayar");
  await page.getByTestId("record-payment").click();

  const dialog = page.getByRole("dialog");
  for (const method of ["Tunai", "QRIS", "Transfer", "Lainnya"]) await expect(dialog.getByRole("radio", { name: method })).toBeVisible();
  await expect(dialog.getByLabel("Jumlah dibayar (Rp)")).toHaveValue(String(CHARGE));
  await dialog.getByLabel("Uang diterima (Rp)").fill("30000");
  await expect(dialog.getByTestId("payment-change")).toContainText("5.320");
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath("payment-dialog.png"), fullPage: true });

  await dialog.getByTestId("payment-save").dblclick();
  await expect(card(page).getByTestId("counter-payment-state")).toContainText("Pelanggan: sudah bayar (Lunas) · Tunai · Petugas");
  await expect(card(page).getByTestId("counter-payment-state")).toContainText("WIB");
  expect(activeCount(id)).toBe(1);
  // Lunas at the counter must never replace an unpaid provider state.
  await expect(page.getByTestId("provider-payment-state")).toHaveText("Belum dibayar ke Mengantar");
  await expect(card(page).getByTestId("void-payment")).toHaveCount(0);

  await card(page).getByRole("link", { name: "Cetak struk" }).click();
  await expect(page).toHaveURL(new RegExp(`/pengiriman/${id}/struk$`));
  const sheet = page.getByTestId("receipt-sheet");
  await expect(sheet).toHaveAttribute("data-width", "58");
  await expect(sheet).toContainText("Tunai");
  await expect(sheet).toContainText("Kembalian");
  const paymentId = localSql(`select id from public.counter_payments where shipment_id = '${id}' and voided_at is null`);
  await expect(sheet).toContainText(`PAY-${paymentId.slice(0, 8).toUpperCase()}`);
  await expect(sheet).toContainText("Cabang Outlet A");
  await expect(sheet).not.toContainText(/13\.579|diskon|bersih|Petugas/i);
  await sheet.screenshot({ path: testInfo.outputPath("receipt-58.png") });
  await page.getByTestId("receipt-width-80").click();
  await expect(sheet).toHaveAttribute("data-width", "80");
  await sheet.screenshot({ path: testInfo.outputPath("receipt-80.png") });
  await page.getByTestId("receipt-print").click();
  await expect.poll(() => page.evaluate(() => window.__prints)).toBe(1);
  expect(localSql(`select kind || '|' || size from public.label_print_events where shipment_id = '${id}'`)).toBe("receipt|80");
  await expect(page.getByTestId("receipt-whatsapp")).toHaveAttribute("href", /^https:\/\/wa\.me\/6281200000077\?text=/);
  const whatsappText = new URL((await page.getByTestId("receipt-whatsapp").getAttribute("href"))!).searchParams.get("text");
  expect(whatsappText).toContain(`No. pembayaran: PAY-${paymentId.slice(0, 8).toUpperCase()}`);
  expect(whatsappText).toContain("Cabang Outlet A");
  expect(whatsappText).not.toMatch(/Petugas/i);
  await expectNoHorizontalOverflow(page);
});

test("a different amount needs a reason; only the tenant administrator sees the difference and can void", async ({ page }) => {
  const id = issuedShipment();
  await signIn(page, "operator-a@geraiexpress.test");
  await page.goto(`/pengiriman/${id}`);
  await page.getByTestId("record-payment").click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("radio", { name: "QRIS" }).check();
  await dialog.getByLabel("Jumlah dibayar (Rp)").fill("20000");
  await dialog.getByTestId("payment-save").click();
  expect(activeCount(id)).toBe(0); // Required reason blocks submission rather than silently correcting.
  await dialog.getByLabel("Alasan selisih").fill("Pelanggan langganan");
  await dialog.getByTestId("payment-save").click();
  await expect(card(page).getByTestId("counter-payment-state")).toContainText("QRIS");
  await expect(card(page).getByTestId("counter-payment-difference")).toHaveCount(0);

  await page.context().clearCookies();
  await signIn(page, "owner-a@geraiexpress.test");
  await page.goto(`/pengiriman/${id}`);
  await expect(card(page).getByTestId("counter-payment-difference")).toContainText("Pelanggan langganan");
  await card(page).getByTestId("void-payment").click();
  const voidDialog = page.getByRole("dialog");
  const summary = voidDialog.getByTestId("void-payment-summary");
  await expect(summary).toContainText(`GERA-PAY-${id.slice(0, 6).toUpperCase()}`);
  await expect(summary).toContainText("20.000");
  await expect(summary).toContainText("QRIS");
  await expect(summary).toContainText("Petugas");
  await voidDialog.getByLabel("Alasan").fill("Salah metode bayar");
  await voidDialog.getByTestId("void-save").click();
  await expect(card(page).getByTestId("counter-payment-state")).toHaveText("Pelanggan: belum bayar");
  await expect(card(page).getByTestId("counter-payment-voided")).toContainText("Dibatalkan");
  await expect(card(page).getByTestId("counter-payment-voided")).toContainText("Salah metode bayar");
  expect(activeCount(id)).toBe(0);
  expect(Number(localSql(`select count(*) from public.counter_payments where shipment_id = '${id}'`))).toBe(1);
});

test("a COD receipt refuses stale identity before printing, then freezes it for reprints without a counter payment", async ({ page }) => {
  const id = issuedShipment({ cod: 74680 });
  const original = JSON.parse(localSql(`select jsonb_build_object('name', name, 'whatsapp', contact_whatsapp)
    from public.tenants where id = '${TENANT_A}'`)) as { name: string; whatsapp: string | null };
  const literal = (value: string | null) => value === null ? "null" : `'${value.replaceAll("'", "''")}'`;
  const setIdentity = (name: string, whatsapp: string | null) => localSql(`update public.tenants
    set name = ${literal(name)}, contact_whatsapp = ${literal(whatsapp)} where id = '${TENANT_A}'`);
  try {
    await signIn(page, "operator-a@geraiexpress.test");
    await page.goto(`/pengiriman/${id}`);
    await expect(card(page).getByTestId("counter-payment-state")).toContainText("Ditagih kurir (COD)");
    await expect(page.getByTestId("record-payment")).toHaveCount(0);
    await card(page).getByRole("link", { name: "Cetak struk" }).click();
    const sheet = page.getByTestId("receipt-sheet");
    await expect(sheet).toContainText("Ditagih kurir (COD)");
    await expect(sheet).toContainText("74.680");
    await expect(sheet).toContainText(original.name);
    await expect(sheet).toContainText("Cabang Outlet A");
    await expect(sheet).not.toContainText(/Dibayar|Petugas|No\. pembayaran/i);
    await expectNoHorizontalOverflow(page);

    setIdentity("Gerai COD Saat Cetak", "081234561111");
    await page.getByTestId("receipt-print").click();
    await expect(page.getByRole("alert").filter({ hasText: "Identitas gerai pada struk" })).toContainText("Muat ulang struk sebelum mencetak");
    expect(await page.evaluate(() => window.__prints)).toBe(0);
    expect(localSql(`select count(*) from public.label_print_events where shipment_id = '${id}'`)).toBe("0");
    await page.getByRole("link", { name: "Muat ulang struk" }).click();
    await expect(sheet).toContainText("Gerai COD Saat Cetak");
    await expect(sheet).toContainText("WhatsApp 081234561111");
    await page.getByTestId("receipt-print").click();
    await expect.poll(() => page.evaluate(() => window.__prints)).toBe(1);

    setIdentity("Gerai COD Setelah Cetak", "081234562222");
    await page.reload();
    await expect(sheet).toContainText("Gerai COD Saat Cetak");
    await expect(sheet).toContainText("WhatsApp 081234561111");
    await expect(sheet).not.toContainText(/Gerai COD Setelah Cetak|081234562222|Petugas/);
    const whatsappText = new URL((await page.getByTestId("receipt-whatsapp").getAttribute("href"))!).searchParams.get("text");
    expect(whatsappText).toContain("Gerai COD Saat Cetak");
    expect(whatsappText).toContain("WhatsApp 081234561111");
    expect(whatsappText).not.toMatch(/Gerai COD Setelah Cetak|081234562222|Petugas|No\. pembayaran/);
    await page.getByTestId("receipt-print").click();
    await expect.poll(() => page.evaluate(() => window.__prints)).toBe(1);
    expect(localSql(`select count(*) from public.label_print_events where shipment_id = '${id}' and kind = 'receipt'
      and receipt_payment_id is null and receipt_gerai_name = 'Gerai COD Saat Cetak' and receipt_gerai_whatsapp = '081234561111'`)).toBe("2");
    expect(activeCount(id)).toBe(0);
  } finally {
    setIdentity(original.name, original.whatsapp);
  }
});

test("a shipment whose charge is unknown shows 'Tarif belum pasti' and no payment action", async ({ page }) => {
  const id = issuedShipment({ charge: null });
  await signIn(page, "operator-a@geraiexpress.test");
  await page.goto(`/pengiriman/${id}`);
  await expect(card(page).getByTestId("counter-payment-state")).toHaveText("Tarif belum pasti");
  await expect(page.getByTestId("record-payment")).toHaveCount(0);
});

test("a failed shipment keeps its payment visible so the administrator can void before reopening", async ({ page }) => {
  const id = issuedShipment();
  await signIn(page, "owner-a@geraiexpress.test");
  await page.goto(`/pengiriman/${id}`);
  await page.getByTestId("record-payment").click();
  await page.getByRole("dialog").getByTestId("payment-save").click();
  await expect(card(page).getByTestId("counter-payment-state")).toContainText("Lunas");
  localSql(`update public.shipments set submission_state = 'failed' where id = '${id}'`);
  await page.reload();
  await expect(card(page).getByTestId("counter-payment-state")).toContainText("Lunas");
  await card(page).getByTestId("void-payment").click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Alasan").fill("Pengiriman ditolak");
  await dialog.getByTestId("void-save").click();
  await expect(card(page).getByTestId("counter-payment-voided")).toContainText("Dibatalkan");
  expect(activeCount(id)).toBe(0);
  await expect(page.getByTestId("record-payment")).toHaveCount(0);
});

test("demo payment and receipt amounts are labelled contoh and the dialog works from the keyboard", async ({ page }) => {
  await startDemo(page);
  // This is the non-secret workspace selector, not an auth cookie. startDemo creates an isolated tenant.
  const tenant = (await page.context().cookies()).find((cookie) => cookie.name === "ge_tenant")?.value;
  if (!tenant || !/^[0-9a-f-]{36}$/i.test(tenant)) throw new Error("Demo workspace selector missing");
  demoTenants.push(tenant);
  const id = localSql(`select id from public.shipments where tenant_id = '${tenant}' and submission_state = 'issued' and not is_cod limit 1`);
  await page.goto(`/pengiriman/${id}`);
  await page.getByTestId("record-payment").focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Jumlah dibayar (Rp) (contoh)")).toBeVisible();
  await dialog.getByRole("radio", { name: "QRIS", exact: true }).check();
  await dialog.getByTestId("payment-save").click();
  await expect(card(page)).toContainText("(contoh)");
  await card(page).getByRole("link", { name: "Cetak struk" }).click();
  const sheet = page.getByTestId("receipt-sheet");
  await expect(sheet).toContainText("STRUK CONTOH");
  const amounts = sheet.locator("dd").filter({ hasText: /Rp/ });
  expect(await amounts.count()).toBeGreaterThan(0);
  for (const amount of await amounts.all()) await expect(amount).toContainText("(contoh)");
  await expectNoHorizontalOverflow(page);
  await page.goto(`/pengiriman/${id}`);
  await card(page).getByTestId("void-payment").click();
  const voidDialog = page.getByRole("dialog");
  await expect(voidDialog.getByTestId("void-payment-summary")).toContainText("(contoh)");
  await expect(voidDialog.getByTestId("void-payment-summary")).toContainText("QRIS");
  await expect(voidDialog.getByTestId("void-payment-summary")).toContainText("Petugas");
  await voidDialog.getByLabel("Alasan").fill("Pembatalan contoh pembayaran");
  await voidDialog.getByTestId("void-save").click();
  await expect(card(page).getByTestId("counter-payment-voided")).toContainText("(contoh)");
});

test("a committed payment with a lost Server Action response is discovered by reload without replay", async ({ page }) => {
  const id = issuedShipment();
  await signIn(page, "operator-a@geraiexpress.test");
  await page.goto(`/pengiriman/${id}`);
  await page.getByTestId("record-payment").click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("radio", { name: "Transfer", exact: true }).check();

  let actionPosts = 0;
  let responseWasLost!: () => void;
  const lostResponse = new Promise<void>((resolve) => { responseWasLost = resolve; });
  await page.route((url) => url.pathname === `/pengiriman/${id}`, async (route) => {
    const request = route.request();
    if (request.method() !== "POST" || !request.headers()["next-action"]) return route.fallback();
    actionPosts++;
    // Forward the original mutation exactly once, wait for the real upstream response and verify
    // committed state, then discard that response before the browser can observe success.
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    expect(activeCount(id)).toBe(1);
    await route.abort("failed");
    responseWasLost();
  });
  await dialog.getByTestId("payment-save").click();
  await lostResponse;
  expect(actionPosts).toBe(1);
  // Reload is a read reconciliation, not a second attempt to submit the form. The interceptor stays
  // installed to catch any automatic or reload-triggered replay of the Server Action.
  await page.reload();
  await expect(card(page).getByTestId("counter-payment-state")).toContainText("Pelanggan: sudah bayar (Lunas) · Transfer");
  await expect(page.getByTestId("record-payment")).toHaveCount(0);
  expect(actionPosts).toBe(1);
  expect(activeCount(id)).toBe(1);
  expect(localSql(`select count(*) from public.counter_payments where shipment_id = '${id}'`)).toBe("1");
  expect(localSql(`select count(*) from public.audit_events where action = 'counter_payment.record' and detail->>'shipment' = '${id}'`)).toBe("1");
});

test("unsupported stored amounts stay unrounded through void and a new safe payment", async ({ page }) => {
  const id = issuedShipment();
  // Setup only: the database accepts the full bigint domain, while JS receipt presentation fails
  // closed above MAX_SAFE_INTEGER. Do not bypass the append-only guard by editing a saved record.
  localSql(`
    insert into public.cash_periods (tenant_id, outlet_id, opened_by)
      values ('${TENANT_A}', '${OUTLET_A}', '${OWNER_A}') on conflict do nothing;
    insert into public.counter_payments (tenant_id, shipment_id, outlet_id, period_id, method, amount_idr,
      expected_idr, difference_reason, recorded_by, receipt_gerai_name)
      select '${TENANT_A}', '${id}', '${OUTLET_A}', id, 'transfer', 9007199254740992,
        ${CHARGE}, 'Nilai uji besar', '${OWNER_A}', 'Gerai Uji'
      from public.cash_periods where tenant_id = '${TENANT_A}' and outlet_id = '${OUTLET_A}' and closed_at is null;
  `);
  await signIn(page, "owner-a@geraiexpress.test");
  await page.goto(`/pengiriman/${id}`);
  await expect(card(page).getByTestId("counter-payment-state")).toHaveText("Pembayaran pelanggan sudah tercatat.");
  await expect(page.getByTestId("record-payment")).toHaveCount(0);
  await card(page).getByTestId("void-payment").click();
  const dialog = page.getByRole("dialog");
  const summary = dialog.getByTestId("void-payment-summary");
  await expect(summary).toContainText(`GERA-PAY-${id.slice(0, 6).toUpperCase()}`);
  await expect(summary).toContainText("Jumlah tidak dapat ditampilkan dengan tepat");
  await expect(summary).toContainText("Transfer");
  await expect(summary).toContainText("Petugas");
  await expect(summary).not.toContainText(/9[.,]?007|9007199254740992/);
  await dialog.getByLabel("Alasan").fill("Pembatalan nilai tidak didukung");
  await dialog.getByTestId("void-save").click();
  await expect(card(page).getByTestId("counter-payment-state")).toHaveText("Pelanggan: belum bayar");
  expect(activeCount(id)).toBe(0);
  expect(localSql(`select (voided_at is not null) from public.counter_payments where shipment_id = '${id}'`)).toBe("t");
  const history = card(page).getByTestId("counter-payment-voided");
  await expect(history).toContainText("Dibatalkan");
  await expect(history).toContainText("Jumlah tidak dapat ditampilkan dengan tepat");
  await expect(history).toContainText("Pembatalan nilai tidak didukung");
  await expect(history).not.toContainText(/9[.,]?007|9007199254740992/);

  // An unsafe voided historical row cannot block a new safe record for the known current charge.
  await page.getByTestId("record-payment").click();
  const paymentDialog = page.getByRole("dialog");
  await expect(paymentDialog.getByLabel("Jumlah dibayar (Rp)")).toHaveValue(String(CHARGE));
  await paymentDialog.getByRole("radio", { name: "QRIS", exact: true }).check();
  await paymentDialog.getByTestId("payment-save").click();
  await expect(card(page).getByTestId("counter-payment-state")).toContainText("Pelanggan: sudah bayar (Lunas) · QRIS");
  await expect(page.getByTestId("record-payment")).toHaveCount(0);
  expect(activeCount(id)).toBe(1);
  expect(localSql(`select count(*) || '|' || count(*) filter (where voided_at is not null)
    from public.counter_payments where shipment_id = '${id}'`)).toBe("2|1");
  expect(localSql(`select amount_idr from public.counter_payments where shipment_id = '${id}' and voided_at is null`)).toBe(String(CHARGE));
  expect(localSql(`select amount_idr from public.counter_payments where shipment_id = '${id}' and voided_at is not null`)).toBe("9007199254740992");
  await expect(history).toContainText("Dibatalkan");
  await expect(history).toContainText("Jumlah tidak dapat ditampilkan dengan tepat");
  await expect(history).toContainText("Pembatalan nilai tidak didukung");
  await expect(history).not.toContainText(/9[.,]?007|9007199254740992/);
});
