// T-047 / PR-16 / PR-6 / UX-9: the invoice view ("Cetak resi + invoice") and the tenant-admin CSV export, at
// the 390 and 1280 projects. Fixtures are synthetic real (non-simulated) shipments inserted with local SQL and
// no provider operation row, so nothing for the dispatch sweep to pick up; they are deleted afterwards.
// window.print is stubbed: opening the browser dialog is not paper output, and the print geometry evidence
// comes from Chromium's print-to-PDF of the page (the @page rules).
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { request as playwrightRequest, type Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { expectNoHorizontalOverflow, expectTouchTargets, localSql, signIn } from "./helpers";

const TENANT_A = "00000000-0000-4000-b000-00000000000a";
const TENANT_B = "00000000-0000-4000-b000-00000000000b";
const OUTLET_A = "00000000-0000-4000-c000-00000000000a";
const OUTLET_B = "00000000-0000-4000-c000-00000000000b";
const OWNER_A = "00000000-0000-4000-a000-0000000000a1";
const OWNER_B = "00000000-0000-4000-a000-0000000000b1";
const WHATSAPP = "081355550000";
const CHARGE = 24680;
const NET_COST = 13579;
const EVIDENCE = process.env.E2E_EVIDENCE_DIR;

const created: string[] = [];
const tag = randomUUID().slice(0, 6).toUpperCase();

type Opts = {
  tenant?: string; outlet?: string; owner?: string; cod?: number; awb?: string | null; state?: string; simulated?: boolean;
  recipient?: string; ref?: string; createdAt?: string;
};

function realShipment(opts: Opts = {}) {
  const tenant = opts.tenant ?? TENANT_A, outlet = opts.outlet ?? OUTLET_A;
  const id = randomUUID(), quote = randomUUID();
  const awb = opts.awb === undefined ? "JP1234567890" : opts.awb;
  created.push(id);
  localSql(`
    insert into public.shipments (tenant_id, outlet_id, id, reference, submission_state, payment_state, sender_name, sender_phone,
      recipient_name, recipient_phone, recipient_address, recipient_area, recipient_postal_code, item_description, weight_grams,
      goods_value_idr, is_cod, cod_amount_idr, is_simulated, created_by, submitted_at, issued_at, awb, customer_charge_idr, pickup_snapshot, created_at)
    values ('${tenant}', '${outlet}', '${id}', '${opts.ref ?? `INV-E2E-${tag}-${id.slice(0, 4).toUpperCase()}`}', '${opts.state ?? "issued"}', 'paid',
      'Pengirim Asli', '081200000099', '${(opts.recipient ?? "Penerima Uji").replace(/'/g, "''")}', '+6281234567890', 'Jl. Tujuan Uji No. 9', 'Kec. Tujuan, Kota Uji', '40132',
      'Buku', 1500, 50000, ${opts.cod ? "true" : "false"}, ${opts.cod ?? "null"}, ${opts.simulated ? "true" : "false"}, '${opts.owner ?? OWNER_A}',
      now(), now(), ${awb === null ? "null" : `'${awb}'`}, ${CHARGE},
      jsonb_build_object('outlet', 'Pickup Mengantar Rahasia', 'address', 'Jl. Pickup Nyata No. 5', 'area', 'Kec. Pickup, Kota Nyata'),
      ${opts.createdAt ? `'${opts.createdAt}'` : "now()"});
    insert into public.shipment_quotes (tenant_id, shipment_id, id, shipment_revision, courier, service, normal_tariff_idr, eta_days, is_simulated, expires_at)
      values ('${tenant}', '${id}', '${quote}', 1, 'JT', 'REG', ${CHARGE}, '1-2', false, now() + interval '1 hour');
    insert into private.quote_costs (tenant_id, quote_id, net_shipping_idr) values ('${tenant}', '${quote}', ${NET_COST});
    update public.shipments set selected_quote_id = '${quote}' where id = '${id}';`);
  return id;
}

const count = (table: string, shipment: string) => Number(localSql(`select count(*) from public.${table} where shipment_id = '${shipment}'`));
const slugA = () => localSql(`select slug from public.tenants where id = '${TENANT_A}'`);
const exportAudits = () => Number(localSql(`select count(*) from public.audit_events where action = 'export.shipments' and target_tenant = '${TENANT_A}'`));

test.beforeAll(() => {
  localSql(`update public.tenants set contact_whatsapp = '${WHATSAPP}', contact_whatsapp_revision = 0, masking_allowed = true where id = '${TENANT_A}'`);
});

test.afterAll(() => {
  if (created.length > 0) {
    const ids = created.map((i) => `'${i}'`).join(",");
    localSql(`update public.shipments set selected_quote_id = null where id in (${ids}); delete from public.shipments where id in (${ids})`);
  }
  localSql(`delete from public.shipments where reference like 'CAPE2E-${tag}-%'`);
  localSql(`update public.tenants set contact_whatsapp = null, contact_whatsapp_revision = 0 where id = '${TENANT_A}'`);
});

declare global {
  interface Window { __prints: number; __jobs: string[] }
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.__prints = 0;
    window.__jobs = [];
    // Also records which sheet the print view had in print for each job (data-print-job).
    window.print = () => {
      window.__prints++;
      window.__jobs.push(document.querySelector("[data-print-job]")?.getAttribute("data-print-job") ?? "");
    };
  });
});

const prints = (page: Page) => page.evaluate(() => window.__prints);
const pageRules = (page: Page) => page.evaluate(() =>
  [...document.styleSheets].flatMap((sheet) => [...sheet.cssRules]).filter((rule) => rule instanceof CSSPageRule).map((rule) => rule.cssText).join(" "));

async function evidence(page: Page, name: string) {
  if (!EVIDENCE) return;
  mkdirSync(EVIDENCE, { recursive: true });
  await page.screenshot({ path: join(EVIDENCE, `${name}-${test.info().project.name}.png`), fullPage: true });
}

// Every page box of Chromium's print-to-PDF (1 pt = 25.4/72 mm): the print preview geometry.
async function printedPageSizes(page: Page) {
  await page.emulateMedia({ media: "print" });
  const pdf = (await page.pdf({ preferCSSPageSize: true, printBackground: true })).toString("latin1");
  await page.emulateMedia({ media: "screen" });
  return [...pdf.matchAll(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/g)]
    .map((m) => [Math.round((Number(m[1]) * 25.4) / 72), Math.round((Number(m[2]) * 25.4) / 72)]);
}

// Minimal RFC 4180 reader for the assertions: quoted fields, doubled quotes, CRLF records.
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; } else if (c === '"') quoted = false; else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\r" && text[i + 1] === "\n") { row.push(field); rows.push(row); row = []; field = ""; i++; }
    else field += c;
  }
  return rows;
}

test.describe("invoice view (Cetak resi + invoice)", () => {
  test("the list offers it for a real issued shipment only; the invoice is issued once, immutable and prints with the stored label", async ({ page }) => {
    const id = realShipment({ cod: 125000 });
    const queued = realShipment({ state: "queued", awb: null });
    const demoLike = realShipment({ simulated: true });
    await signIn(page, "owner-a@geraiexpress.test");
    await page.goto(`/pengiriman?q=INV-E2E-${tag}`);
    await expect(page.getByTestId("shipment-ref").filter({ visible: true })).toHaveCount(3);
    const links = page.getByRole("link", { name: "Resi + invoice" }).filter({ visible: true });
    await expect(links).toHaveCount(1);
    await expect(links).toHaveAttribute("href", `/pengiriman/${id}/invoice`);
    await expectNoHorizontalOverflow(page);
    await expectTouchTargets(page);
    await evidence(page, "list-invoice-link");

    // Ineligible shipments redirect back to the detail instead of offering a document.
    for (const other of [queued, demoLike]) {
      await page.goto(`/pengiriman/${other}/invoice`);
      await expect(page).toHaveURL(new RegExp(`/pengiriman/${other}$`));
    }

    await page.goto(`/pengiriman?q=INV-E2E-${tag}`);
    await links.click();
    await expect(page).toHaveURL(new RegExp(`/pengiriman/${id}/invoice$`));
    // No label yet: the recovery points to the label view; the invoice can still be issued.
    await expect(page.getByTestId("label-missing")).toContainText("belum dibuat");
    await expect(page.getByRole("link", { name: "Buat label" })).toHaveAttribute("href", `/pengiriman/${id}/label`);
    // The scope option is "Keduanya" (renamed so it does not repeat the "Resi + invoice" tab of the print header).
    await expect(page.getByRole("radio", { name: "Keduanya" })).toBeDisabled();
    await expect(page.getByRole("radio", { name: "Invoice saja" })).toBeChecked();
    await expect(page.getByRole("button", { name: "Cetak" })).toBeDisabled();
    expect(count("invoice_snapshots", id)).toBe(0);

    await page.getByRole("button", { name: "Terbitkan invoice" }).click();
    const sheet = page.getByTestId("invoice-sheet");
    await expect(sheet).toBeVisible();
    expect(count("invoice_snapshots", id)).toBe(1);
    const number = (await page.getByTestId("invoice-number").innerText()).trim();
    const prefix = localSql(`select shipment_prefix from public.tenants where id = '${TENANT_A}'`);
    expect(number).toMatch(new RegExp(`^${prefix}-INV-\\d{6}-\\d{3,}$`));

    // Content: gerai identity as printed, parties, line item, sender-facing charge, COD note, footer.
    await expect(page.getByTestId("invoice-gerai-name")).toHaveText("Gerai Uji A");
    await expect(page.getByTestId("invoice-gerai-whatsapp")).toContainText(WHATSAPP);
    await expect(page.getByTestId("invoice-gerai-address")).toHaveText("Jl. Pickup Nyata No. 5, Kec. Pickup, Kota Nyata");
    await expect(page.getByTestId("invoice-sender")).toHaveText("Pengirim Asli");
    await expect(page.getByTestId("invoice-recipient")).toHaveText("Penerima Uji");
    await expect(page.getByTestId("invoice-awb")).toHaveText("JP1234567890");
    await expect(page.getByTestId("invoice-lines")).toContainText("J&T Express REG");
    await expect(page.getByTestId("invoice-total")).toHaveText(/Rp\s*24\.680/);
    await expect(page.getByTestId("invoice-cod")).toContainText(/Rp\s*125\.000/);
    await expect(page.getByTestId("invoice-footer")).toHaveText("Dokumen ini adalah rincian tagihan ongkos kirim, bukan bukti pembayaran.");
    const printed = (await sheet.innerText()).replace(/\s+/g, " ");
    expect(printed).not.toMatch(/13\.579|13579|diskon|laba|margin|persen|%/i);
    await expectNoHorizontalOverflow(page);
    await expectTouchTargets(page);
    await evidence(page, "invoice-only");

    // Create the label in the label view (masking off), then the combined view prints label then invoice.
    await page.goto(`/pengiriman/${id}/label`);
    await page.getByRole("button", { name: /^Cetak label$/ }).click();
    await expect.poll(() => count("label_snapshots", id)).toBe(1);
    // Snapshot creation and print recording are consecutive RPCs, not one transaction.
    await expect.poll(() => count("label_print_events", id)).toBe(1);

    await page.goto(`/pengiriman/${id}/invoice`);
    await expect(page.getByTestId("label-source")).toBeVisible();
    await expect(page.getByTestId("invoice-source")).toContainText(number);
    await expect(page.getByRole("radio", { name: "Keduanya" })).toBeChecked();
    const label = page.getByTestId("label-sheet");
    await expect(label).toBeVisible();
    await expect(sheet).toBeVisible();
    await expect(label.getByTestId("label-awb")).toHaveText("JP1234567890");
    // Label first, invoice second in the document order, each on its own page rules.
    const labelBox = await label.evaluate((el) => el.compareDocumentPosition(document.querySelector("[data-testid=invoice-sheet]")!) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(labelBox).toBeTruthy();
    const rules = await pageRules(page);
    expect(rules).toContain("size: 100mm 150mm");
    expect(rules).toMatch(/@page invoice[^}]*size: a4/i);
    await expect(sheet).toHaveCSS("page", "invoice");
    // The thermal label and the A4 invoice never share one print job (C6): with no job running, "Keduanya"
    // puts only the label in print; the Cetak button then opens one job per sheet.
    expect(await printedPageSizes(page)).toEqual([[100, 150]]);
    await expectNoHorizontalOverflow(page);
    await expectTouchTargets(page);
    await evidence(page, "label-and-invoice");

    // Print: two print jobs (label, then invoice), one print request on the label history; reloading shows
    // the same stored invoice (no new one).
    await page.getByRole("button", { name: "Cetak" }).click();
    await expect.poll(() => prints(page)).toBe(2);
    expect(await page.evaluate(() => window.__jobs)).toEqual(["label", "invoice"]);
    expect(count("label_print_events", id)).toBe(2);
    await page.reload();
    await expect(page.getByTestId("invoice-number")).toHaveText(number);
    expect(count("invoice_snapshots", id)).toBe(1);

    // Scope: "Resi saja" and "Invoice saja" show and print one document each.
    await page.getByRole("radio", { name: "Resi saja" }).check();
    await expect(sheet).toHaveCount(0);
    await expect(label).toBeVisible();
    expect(await printedPageSizes(page)).toEqual([[100, 150]]);
    await page.getByRole("radio", { name: "Invoice saja" }).check();
    await expect(label).toHaveCount(0);
    await expect(sheet).toBeVisible();
    expect(await printedPageSizes(page)).toEqual([[210, 297]]);

    // The stored invoice is not rewritten when the gerai or the shipment changes afterwards.
    localSql(`update public.tenants set name = 'Gerai Diganti Nama' where id = '${TENANT_A}'`);
    try {
      await page.reload();
      await expect(page.getByTestId("invoice-gerai-name")).toHaveText("Gerai Uji A");
      await expect(page.getByTestId("invoice-number")).toHaveText(number);
    } finally {
      localSql(`update public.tenants set name = 'Gerai Uji A' where id = '${TENANT_A}'`);
    }
  });

  test("a shipment of another gerai is not found, and an operator can open the view", async ({ page }) => {
    const other = realShipment({ tenant: TENANT_B, outlet: OUTLET_B, owner: OWNER_B });
    await signIn(page, "operator-a@geraiexpress.test");
    expect((await page.goto(`/pengiriman/${other}/invoice`))!.status()).toBe(404);
    const mine = realShipment();
    await page.goto(`/pengiriman/${mine}/invoice`);
    await expect(page.getByRole("heading", { name: /Cetak resi \+ invoice/ })).toBeVisible();
    await page.getByRole("button", { name: "Terbitkan invoice" }).click();
    await expect(page.getByTestId("invoice-sheet")).toBeVisible();
  });
});

test.describe("CSV export", () => {
  test("a tenant admin downloads the filtered list; formulas are neutralized and private fields are absent", async ({ page }) => {
    // Own tag: the search below must see this test's rows only.
    const tag = randomUUID().slice(0, 6).toUpperCase();
    const evil = realShipment({ recipient: '=HYPERLINK("http://evil.example","klik"), +A', cod: 90000, ref: `INV-E2E-${tag}-EVIL` });
    realShipment({ recipient: "Budi, \"Si\" Santoso", ref: `INV-E2E-${tag}-BUDI` });
    const other = realShipment({ tenant: TENANT_B, outlet: OUTLET_B, owner: OWNER_B, ref: `INV-E2E-${tag}-OTHER` });
    const old = realShipment({ ref: `INV-E2E-${tag}-OLD`, createdAt: "2019-05-04T03:00:00Z", state: "failed", awb: null });
    expect(other).not.toBe(evil);
    await signIn(page, "owner-a@geraiexpress.test");
    const before = exportAudits();
    await page.goto(`/pengiriman?q=INV-E2E-${tag}`);
    await expect(page.getByRole("link", { name: "Ekspor CSV" })).toHaveAttribute("href", `/pengiriman/export.csv?q=INV-E2E-${tag}`);
    await expectNoHorizontalOverflow(page);
    await expectTouchTargets(page);
    await evidence(page, "list-export");

    // The button downloads a file named after the tenant slug and the WIB date.
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Ekspor CSV" }).click()]);
    expect(download.suggestedFilename()).toMatch(new RegExp(`^pengiriman-${slugA()}-\\d{8}\\.csv$`));
    expect(exportAudits()).toBe(before + 1);

    const response = await page.request.get(`/pengiriman/export.csv?q=INV-E2E-${tag}`);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("text/csv");
    expect(response.headers()["content-type"]).toContain("utf-8");
    expect(response.headers()["cache-control"]).toContain("no-store");
    expect(response.headers()["content-disposition"]).toMatch(new RegExp(`^attachment; filename="pengiriman-${slugA()}-\\d{8}\\.csv"$`));
    expect(response.headers()["x-export-truncated"]).toBe("false");
    const body = await response.text();
    expect(body.startsWith("\uFEFF")).toBe(true);
    const rows = parseCsv(body.slice(1));
    expect(rows[0]).toEqual([
      "Referensi", "Dibuat (WIB)", "Status", "Kurir", "Layanan", "Resi", "Nama penerima", "Telepon penerima", "Area penerima",
      "Berat (gram)", "Nilai barang (Rp)", "Ongkir pelanggan (Rp)", "Nominal COD (Rp)", "Status pembayaran", "Masking pengirim",
    ]);
    const data = rows.slice(1).filter((r) => r.length > 1);
    expect(data).toHaveLength(3);
    // Tenant B's shipment is absent.
    expect(body).not.toContain(`INV-E2E-${tag}-OTHER`);
    // Formula guard, RFC 4180 quoting and the phone with a leading plus.
    const evilRow = data.find((r) => r[6].includes("HYPERLINK"))!;
    expect(evilRow[6]).toBe(`'=HYPERLINK("http://evil.example","klik"), +A`);
    expect(evilRow[7]).toBe("'+6281234567890");
    expect(data.find((r) => r[6].startsWith("Budi"))![6]).toBe('Budi, "Si" Santoso');
    // Operational columns: integers, WIB ISO date, courier and service, payment state, COD only when COD.
    expect(evilRow).toEqual(expect.arrayContaining(["J&T Express", "REG", "JP1234567890", "1500", "50000", String(CHARGE), "90000", "Sudah dibayar", "Belum ada label"]));
    expect(evilRow[1]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+07:00$/);
    expect(data.find((r) => r[6].startsWith("Budi"))![12]).toBe("");
    expect(evilRow[2]).toBe("Resi terbit");
    // Never the net cost, a discount, a percentage, or the sender's WhatsApp or the pickup address.
    expect(body).not.toContain(String(NET_COST));
    expect(body).not.toMatch(/diskon|laba|margin|persen|%/i);
    expect(body).not.toContain("081200000099");
    expect(body).not.toContain("Pickup");

    // Filters: status and a creation-date range in WIB.
    const failed = parseCsv((await (await page.request.get(`/pengiriman/export.csv?q=INV-E2E-${tag}&status=failed`)).text()).slice(1)).filter((r) => r.length > 1);
    expect(failed).toHaveLength(2);
    expect(failed[1][0]).toBe(`INV-E2E-${tag}-OLD`);
    expect(failed[1][1]).toBe("2019-05-04T10:00:00+07:00");
    const dated = parseCsv((await (await page.request.get(`/pengiriman/export.csv?q=INV-E2E-${tag}&from=2019-05-04&to=2019-05-04`)).text()).slice(1)).filter((r) => r.length > 1);
    expect(dated.map((r) => r[0])).toEqual(["Referensi", `INV-E2E-${tag}-OLD`]);
    const none = parseCsv((await (await page.request.get(`/pengiriman/export.csv?q=INV-E2E-${tag}&from=2019-05-05&to=2019-05-05`)).text()).slice(1)).filter((r) => r.length > 1);
    expect(none).toHaveLength(1); // header only
    expect(old).toBeTruthy();

    // The audit row records who, the filters and the row count; a text search only as present.
    const audit = JSON.parse(localSql(`select row_to_json(e) from public.audit_events e where action = 'export.shipments' and target_tenant = '${TENANT_A}' and detail -> 'filters' ->> 'status' = 'failed' order by id desc limit 1`));
    expect(audit).toMatchObject({ actor: OWNER_A, outcome: "ok", detail: { filters: { status: "failed", has_query: true }, rows: 1, truncated: false } });
    expect(JSON.stringify(audit)).not.toContain(`INV-E2E-${tag}`);
  });

  test("the list filters by creation date and the page says what the export contains", async ({ page }) => {
    realShipment({ ref: `INV-E2E-${tag}-DAY`, createdAt: "2019-06-01T03:00:00Z" });
    await signIn(page, "owner-a@geraiexpress.test");
    await page.goto(`/pengiriman?q=INV-E2E-${tag}-DAY&from=2019-06-01&to=2019-06-01`);
    await expect(page.getByTestId("shipment-ref").filter({ visible: true })).toHaveCount(1);
    await expect(page.getByRole("link", { name: "Ekspor CSV" })).toHaveAttribute("href", `/pengiriman/export.csv?q=INV-E2E-${tag}-DAY&from=2019-06-01&to=2019-06-01`);
    await page.goto(`/pengiriman?q=INV-E2E-${tag}-DAY&from=2019-06-02&to=2019-06-02`);
    await expect(page.getByText("Tidak ada pengiriman yang cocok")).toBeVisible();
    await expect(page.getByLabel("Dibuat dari")).toHaveValue("2019-06-02");
    await evidence(page, "list-date-filter");
  });

  test("operators and anonymous visitors are refused, and no audit row is written", async ({ page, baseURL }) => {
    const before = exportAudits();
    const anonymous = await playwrightRequest.newContext({ baseURL: baseURL! });
    const denied = await anonymous.get("/pengiriman/export.csv");
    expect(denied.status()).toBe(404);
    expect(await denied.text()).not.toContain("Referensi");
    await anonymous.dispose();

    await signIn(page, "operator-a@geraiexpress.test");
    const refused = await page.request.get("/pengiriman/export.csv");
    expect(refused.status()).toBe(403);
    expect(refused.headers()["content-type"]).not.toContain("text/csv");
    expect(await refused.text()).not.toContain("Referensi");
    await page.goto("/pengiriman");
    await expect(page.getByRole("heading", { name: "Pengiriman", level: 1 })).toBeVisible();
    await expect(page.getByRole("link", { name: "Ekspor CSV" })).toHaveCount(0);
    expect(exportAudits()).toBe(before);
  });

  test("an export over the row cap is cut to 10.000 rows and says so in a header", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop-1280", "one run of the large fixture is enough");
    test.setTimeout(120_000);
    localSql(`insert into public.shipments (tenant_id, outlet_id, reference, created_by, created_at, updated_at)
      select '${TENANT_A}', '${OUTLET_A}', 'CAPE2E-${tag}-' || n, '${OWNER_A}', '2018-03-03T03:00:00Z'::timestamptz + (n || ' seconds')::interval, '2018-03-03T03:00:00Z'
      from generate_series(1, 10050) n`);
    await signIn(page, "owner-a@geraiexpress.test");
    const response = await page.request.get("/pengiriman/export.csv?from=2018-03-03&to=2018-03-03", { timeout: 100_000 });
    expect(response.status()).toBe(200);
    expect(response.headers()["x-export-truncated"]).toBe("true");
    expect(response.headers()["x-export-row-cap"]).toBe("10000");
    expect(response.headers()["x-export-rows"]).toBe("10000");
    expect(response.headers()["x-export-note"]).toContain("10.000 baris pertama");
    const rows = parseCsv((await response.text()).slice(1)).filter((r) => r.length > 1);
    expect(rows).toHaveLength(10001);
    expect(localSql(`select outcome || ':' || (detail ->> 'rows') from public.audit_events where action = 'export.shipments' and target_tenant = '${TENANT_A}' order by id desc limit 1`)).toBe("truncated:10000");
    // The list tells an admin about the cap.
    await page.goto("/pengiriman?from=2018-03-03&to=2018-03-03");
    await expect(page.getByText("Ekspor dibatasi 10.000 baris pertama")).toBeVisible();
    localSql(`delete from public.shipments where reference like 'CAPE2E-${tag}-%'`);
  });
});

// T-084 / PR-46 / UX-9: the "Resi + invoice" view of a stored masked label shows the acknowledgement gate
// only for a courier that is not verified, and the return-destination help whenever the label is masked;
// neither appears for an unmasked label, and neither is part of the printout.
test.describe("masking acceptance on the Resi + invoice view (PR-46)", () => {
  const ackBox = (page: Page) => page.getByRole("checkbox", { name: /Saya mengerti penerimaannya belum terverifikasi/ });
  const setJt = (state: "verified" | null) => localSql(state === null ? `delete from private.masking_acceptance where courier = 'JT'`
    : `insert into private.masking_acceptance (courier, state, evidence_ref, recorded_by)
        values ('JT', '${state}', 'Uji scan e2e', '00000000-0000-4000-a000-0000000000f1')
        on conflict (courier) do update set state = excluded.state, evidence_ref = excluded.evidence_ref`);
  test.afterEach(() => { setJt(null); });

  // Stores the label in the label view (the only place a snapshot is made), masked or not.
  async function storeLabel(page: Page, id: string, masked: boolean) {
    await page.goto(`/pengiriman/${id}/label`);
    if (masked) {
      await page.getByRole("switch", { name: /Gunakan masking pengirim/ }).check();
      await page.getByLabel("Kecamatan/kota pengirim").fill("Bandung");
      if (await ackBox(page).count()) await ackBox(page).check();
    }
    await page.getByRole("button", { name: /^(Cetak label|Cetak ulang label)$/ }).click();
    await expect.poll(() => count("label_print_events", id)).toBe(1);
  }

  test("masked + unverified: gate and return note; the acknowledgement is required and recorded; neither prints", async ({ page }) => {
    setJt(null);
    const id = realShipment();
    await signIn(page, "owner-a@geraiexpress.test");
    await storeLabel(page, id, true);
    await page.goto(`/pengiriman/${id}/invoice`);
    await expect(page.getByTestId("label-source")).toBeVisible();
    await expect(page.getByTestId("masking-acceptance")).toContainText("Belum terverifikasi untuk J&T Express");
    const note = page.getByTestId("return-destination");
    await expect(note).toContainText("alamat pickup (Jl. Pickup Nyata No. 5)");
    await expect(note).toContainText("bukan ke pengirim yang tercetak di label");
    await expectNoHorizontalOverflow(page);
    await expectTouchTargets(page);
    await evidence(page, "invoice-masked-unverified");

    await page.getByRole("radio", { name: "Resi saja" }).click();
    await page.getByRole("button", { name: "Cetak resi" }).click();
    await expect(page.getByText("Centang konfirmasi bahwa penerimaan label masking oleh kurir belum terverifikasi sebelum mencetak.")).toBeVisible();
    expect(await prints(page)).toBe(0);
    expect(count("label_print_events", id)).toBe(1);
    await ackBox(page).check();
    await page.getByRole("button", { name: "Cetak resi" }).click();
    await expect.poll(() => prints(page)).toBe(1);
    expect(localSql(`select acceptance_state || '|' || acknowledged from public.label_print_events where shipment_id = '${id}' order by id desc limit 1`))
      .toBe("unverified|true");

    // Screen help only: absent in print media while the stored label itself prints.
    await page.emulateMedia({ media: "print" });
    await expect(page.getByTestId("return-destination")).toBeHidden();
    await expect(page.getByTestId("masking-acceptance")).toBeHidden();
    await expect(page.getByTestId("label-sheet")).toBeVisible();
    await expect(page.getByTestId("label-sheet")).not.toContainText("alamat pickup");
    await page.emulateMedia({ media: "screen" });
  });

  test("masked + verified: no gate, the return note is still shown", async ({ page }) => {
    setJt("verified");
    const id = realShipment();
    await signIn(page, "owner-a@geraiexpress.test");
    await storeLabel(page, id, true);
    await page.goto(`/pengiriman/${id}/invoice`);
    await expect(page.getByTestId("label-source")).toBeVisible();
    await expect(page.getByTestId("masking-acceptance")).toHaveCount(0);
    await expect(page.getByTestId("return-destination")).toContainText("alamat pickup (Jl. Pickup Nyata No. 5)");
    await expectNoHorizontalOverflow(page);
    await evidence(page, "invoice-masked-verified");
    await page.emulateMedia({ media: "print" });
    await expect(page.getByTestId("return-destination")).toBeHidden();
    await page.emulateMedia({ media: "screen" });
  });

  test("unmasked: neither the gate nor the return note", async ({ page }) => {
    setJt(null);
    const id = realShipment();
    await signIn(page, "owner-a@geraiexpress.test");
    await storeLabel(page, id, false);
    await page.goto(`/pengiriman/${id}/invoice`);
    await expect(page.getByTestId("label-source")).toBeVisible();
    await expect(page.getByTestId("masking-acceptance")).toHaveCount(0);
    await expect(page.getByTestId("return-destination")).toHaveCount(0);
  });
});
