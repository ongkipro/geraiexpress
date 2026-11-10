// T-087 / PR-45 / UX-17 item 6: a tenant administrator sees the pilot report on /kas/laporan and
// downloads the CSV; an operator neither sees the nav item nor reaches the page or the CSV. Fixture
// shipments of tenant A sit on an isolated past WIB day so no other spec's data falls into the period.
import { randomUUID } from "node:crypto";
import { request as playwrightRequest } from "@playwright/test";
import { expect, test } from "./fixtures";
import { expectNoHorizontalOverflow, localSql, signIn } from "./helpers";

const TENANT_A = "00000000-0000-4000-b000-00000000000a";
const OWNER_A = "00000000-0000-4000-a000-0000000000a1";
const DAY = "2019-07-07";
const outlets: string[] = [];
let terms: string | null = null;

// Two issued shipments in one new outlet of tenant A: one with a known gerai cost (tariff 23000, net 18400,
// assigned 2000 bps -> earnings 4600) and one with an unknown net cost, so the outlet total is unknown.
function seed() {
  const outlet = randomUUID(), name = `=Outlet pilot ${outlet.slice(0, 6)}`;
  outlets.push(outlet);
  terms = randomUUID();
  localSql(`insert into public.outlets(tenant_id, id, name) values ('${TENANT_A}', '${outlet}', '${name}');
    begin; set local session_replication_role = replica;
    insert into public.gerai_discount_terms (id, tenant_id, version, gerai_discount_bps, effective_from, source_reference, status, created_by, created_at)
      select '${terms}', '${TENANT_A}', coalesce(max(version), 0) + 1, 2000, '${DAY}T00:00:00+07:00', 'Uji e2e T-087', 'owner_stated', '${OWNER_A}', '${DAY}T00:00:00+07:00'
      from public.gerai_discount_terms where tenant_id = '${TENANT_A}';
    commit;`);
  for (const [net, minutes] of [[18400, 10], [null, 30]] as const) {
    const shipment = randomUUID(), quote = randomUUID();
    localSql(`insert into public.shipments(tenant_id, outlet_id, id, reference, submission_state, payment_state, recipient_name, recipient_phone,
        recipient_address, recipient_area, item_description, weight_grams, is_cod, is_simulated, created_by, customer_charge_idr,
        created_at, submitted_at, issued_at, awb)
      values ('${TENANT_A}', '${outlet}', '${shipment}', 'GERA-PIL-${shipment.slice(0, 8)}', 'issued', 'paid', 'Penerima Uji', '081234567890',
        'Jl. Uji 1', 'Kota Uji', 'Buku', 1000, false, false, '${OWNER_A}', 23000,
        timestamptz '${DAY}T10:00:00+07:00' - interval '${minutes} minutes', '${DAY}T10:00:00+07:00', '${DAY}T10:00:00+07:00', 'PIL${shipment.slice(0, 8).toUpperCase()}');
      insert into public.shipment_quotes (tenant_id, shipment_id, id, shipment_revision, courier, service, normal_tariff_idr, eta_days, is_simulated, quoted_at, expires_at)
        values ('${TENANT_A}', '${shipment}', '${quote}', 1, 'JT', 'REG', 23000, '1-2', false, timestamptz '${DAY}T09:00:00+07:00', timestamptz '${DAY}T11:00:00+07:00');
      insert into private.quote_costs (tenant_id, quote_id, net_shipping_idr) values ('${TENANT_A}', '${quote}', ${net ?? "null"});
      update public.shipments set selected_quote_id = '${quote}' where id = '${shipment}';`);
  }
  return { outlet, name };
}

const exportAudits = () => Number(localSql(`select count(*) from public.audit_events where action = 'export.pilot_report' and target_tenant = '${TENANT_A}'`));

test.afterAll(() => {
  for (const outlet of outlets) {
    localSql(`update public.shipments set selected_quote_id = null where outlet_id = '${outlet}';
      delete from public.shipments where outlet_id = '${outlet}'; delete from public.outlets where id = '${outlet}'`);
  }
  if (terms) localSql(`begin; set local session_replication_role = replica; delete from public.gerai_discount_terms where id = '${terms}'; commit`);
});

test("a tenant admin sees the pilot report per outlet and day and downloads the CSV", async ({ page }, testInfo) => {
  const f = seed();
  await signIn(page, "owner-a@geraiexpress.test");
  await page.goto("/kas");
  await page.getByRole("main").getByRole("link", { name: "Laporan pilot" }).click();
  await expect(page).toHaveURL(/\/kas\/laporan$/);
  await page.goto(`/kas/laporan?from=${DAY}&to=${DAY}`);
  await expect(page.getByRole("heading", { name: "Laporan pilot", level: 1 })).toBeVisible();
  // Below the lg shell width (sidebar + table do not fit at 768) rows are record cards.
  const narrow = (page.viewportSize()?.width ?? 1280) < 1024;
  if (narrow) {
    // UI-7: below 1024 px (phones and tablets) the rows are record cards and the table is not shown.
    await expect(page.getByTestId("pilot-table")).toBeHidden();
    const card = page.getByTestId("pilot-card-day").filter({ hasText: f.name });
    await expect(card).toBeVisible();
    // Heading: outlet and WIB day.
    const heading = card.getByRole("heading", { level: 3 });
    await expect(heading).toContainText(f.name);
    await expect(heading).toContainText("2019");
    for (const [label, value] of [
      ["Resi terbit", "2"],
      ["Median draf ke resi", "20 menit"],
      ["Label masking", "Belum diketahui"],
      ["Pendapatan (estimasi)", "Belum diketahui"],
    ] as const) {
      const item = card.locator("dl > div").filter({ has: page.locator("dt", { hasText: label }) });
      await expect(item, label).toContainText(value);
    }
    const mix = card.locator("dl > div").filter({ has: page.locator("dt", { hasText: "Cara bayar" }) });
    for (const method of ["Tunai: 0", "QRIS: 0", "Transfer: 0", "Lainnya: 0"]) await expect(mix).toContainText(method);
    await expect(card.getByTestId("pilot-card-earnings")).toContainText("1 pengiriman biaya gerai belum diketahui");
    await expect(page.getByTestId("pilot-card-outlet").filter({ hasText: `Total ${f.name}` })).toBeVisible();
    await expect(page.getByTestId("pilot-card-total")).toContainText("Total semua cabang");
  } else {
    await expect(page.getByTestId("pilot-cards")).toBeHidden();
    const table = page.getByTestId("pilot-table");
    const day = table.getByTestId("pilot-row-day").filter({ hasText: f.name });
    await expect(day).toContainText("2");
    await expect(day).toContainText("20 menit"); // median of 10 and 30 minutes
    await expect(day.getByTestId("pilot-earnings")).toContainText("Belum diketahui");
    await expect(day.getByTestId("pilot-earnings")).toContainText("1 pengiriman biaya gerai belum diketahui");
    await expect(table.getByTestId("pilot-row-total")).toContainText("Total semua cabang");
  }
  await expect(page.getByTestId("pilot-data-at")).toContainText("WIB");
  // No net cost (18400) and no percentage on the page.
  await expect(page.locator("main")).not.toContainText(/18\.400|20\s?%/);
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath(`pilot-report-admin-${narrow ? "cards" : "table"}.png`), fullPage: true });

  const before = exportAudits();
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Unduh CSV" }).click()]);
  expect(download.suggestedFilename()).toMatch(/^laporan-pilot-[a-z0-9-]+-\d{8}\.csv$/);
  const response = await page.request.get(`/kas/laporan/export.csv?from=${DAY}&to=${DAY}`);
  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toContain("no-store");
  expect(response.headers()["content-type"]).toContain("text/csv");
  const body = await response.text();
  expect(body.startsWith("\uFEFF")).toBe(true);
  expect(body).toContain(`'${f.name}`); // formula guard on the outlet name
  expect(body).toContain("Belum diketahui");
  expect(body).toContain("Definisi");
  expect(body).not.toContain("18400");
  expect(exportAudits()).toBe(before + 2);
});

test("an operator does not see or reach the pilot report or its CSV", async ({ page, baseURL }) => {
  const before = exportAudits();
  const anonymous = await playwrightRequest.newContext({ baseURL: baseURL! });
  expect((await anonymous.get("/kas/laporan/export.csv")).status()).toBe(404);
  await anonymous.dispose();

  await signIn(page, "operator-a@geraiexpress.test");
  await page.goto("/kas");
  await expect(page.getByRole("heading", { name: "Kas", level: 1 })).toBeVisible();
  await expect(page.getByRole("link", { name: "Laporan pilot" })).toHaveCount(0);
  await page.goto("/kas/laporan");
  await expect(page.getByRole("heading", { name: "Halaman atau data tidak ditemukan" })).toBeVisible();
  await expect(page.getByTestId("pilot-table")).toHaveCount(0);
  const refused = await page.request.get("/kas/laporan/export.csv");
  expect(refused.status()).toBe(403);
  expect(refused.headers()["content-type"]).not.toContain("text/csv");
  expect(exportAudits()).toBe(before);
  await expectNoHorizontalOverflow(page);
});
