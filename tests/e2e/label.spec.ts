// T-044 / PR-6 / PR-34 / UX-9 / UI-6: the local masked label of a real issued shipment, at the 390 and
// 1280 projects. The fixtures are synthetic real (non-simulated) shipments inserted with local SQL and no
// provider operation row, so nothing for the dispatch sweep to pick up; they are deleted afterwards.
// window.print is stubbed: opening the browser dialog is not paper output, and the print preview evidence
// comes from print-media emulation and a print-to-PDF of the page (the @page size).
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { expectNoHorizontalOverflow, expectTouchTargets, localSql, signIn } from "./helpers";
import { CODE128_PATTERNS, CODE128_QUIET_MODULES, CODE128_STOP } from "../../src/lib/label-code128";

const TENANT_A = "00000000-0000-4000-b000-00000000000a";
const OUTLET_A = "00000000-0000-4000-c000-00000000000a";
const OWNER_A = "00000000-0000-4000-a000-0000000000a1";
const WHATSAPP = "081355550000";
const PICKUP_NAME = "Pickup Mengantar Rahasia";
const CHARGE = 24680;
const EVIDENCE = process.env.E2E_EVIDENCE_DIR;

const created: string[] = [];

function resetTenant(whatsapp: string | null = WHATSAPP, masking = true) {
  localSql(`update public.tenants set contact_whatsapp = ${whatsapp ? `'${whatsapp}'` : "null"}, contact_whatsapp_revision = 0,
    masking_allowed = ${masking} where id = '${TENANT_A}'`);
}

function realShipment(opts: { cod?: number; awb?: string | null; state?: string; address?: string; name?: string; item?: string } = {}) {
  const id = randomUUID(), quote = randomUUID();
  const awb = opts.awb === undefined ? "JP1234567890" : opts.awb;
  created.push(id);
  localSql(`
    insert into public.shipments (tenant_id, outlet_id, id, reference, submission_state, payment_state, sender_name, sender_phone,
      recipient_name, recipient_phone, recipient_address, recipient_area, recipient_postal_code, item_description, weight_grams,
      goods_value_idr, is_cod, cod_amount_idr, is_simulated, created_by, submitted_at, issued_at, awb, customer_charge_idr, pickup_snapshot)
    values ('${TENANT_A}', '${OUTLET_A}', '${id}', 'GERA-E2E-${id.slice(0, 6).toUpperCase()}', '${opts.state ?? "issued"}', 'paid',
      'Pengirim Asli', '081200000099', '${opts.name ?? "Penerima Uji"}', '081234567890', '${opts.address ?? "Jl. Tujuan Uji No. 9"}',
      'Kec. Tujuan, Kota Uji', '40132', '${opts.item ?? "Buku"}', 1500, 50000, ${opts.cod ? "true" : "false"}, ${opts.cod ?? "null"}, false, '${OWNER_A}',
      now(), now(), ${awb === null ? "null" : `'${awb}'`}, ${CHARGE},
      jsonb_build_object('outlet', '${PICKUP_NAME}', 'address', 'Jl. Pickup Nyata No. 5', 'area', 'Kec. Pickup, Kota Nyata'));
    insert into public.shipment_quotes (tenant_id, shipment_id, id, shipment_revision, courier, service, normal_tariff_idr, eta_days, is_simulated, expires_at)
      values ('${TENANT_A}', '${id}', '${quote}', 1, 'JT', 'REG', ${CHARGE}, '1-2', false, now() + interval '1 hour');
    insert into private.quote_costs (tenant_id, quote_id, net_shipping_idr) values ('${TENANT_A}', '${quote}', 13579);
    update public.shipments set selected_quote_id = '${quote}' where id = '${id}';`);
  return id;
}

const count = (table: string, shipment: string) => Number(localSql(`select count(*) from public.${table} where shipment_id = '${shipment}'`));

test.afterAll(() => {
  if (created.length > 0) {
    const ids = created.map((i) => `'${i}'`).join(",");
    localSql(`update public.shipments set selected_quote_id = null where id in (${ids}); delete from public.shipments where id in (${ids})`);
  }
  resetTenant(null, true);
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

const prints = (page: Page) => page.evaluate(() => window.__prints);
// Stores the shown choice as a snapshot (Cetak label) and switches to print media once the preview is
// the stored label: print output exists only for a stored snapshot.
async function storeThenPrintMedia(page: Page) {
  const before = await prints(page);
  await page.emulateMedia({ media: "screen" });
  await printButton(page).click();
  await expect.poll(() => prints(page)).toBe(before + 1);
  await expect(page.getByTestId("preview-source")).toContainText("Label tersimpan");
  await page.emulateMedia({ media: "print" });
}
const maskSwitch = (page: Page) => page.getByRole("switch", { name: /Gunakan masking pengirim/ });
const printButton = (page: Page) => page.getByRole("button", { name: /^(Cetak label|Cetak ulang label)$/ });
// The @page rule the sheet ships (Playwright's text matching skips <style> elements, so read the CSS rules).
const pageRule = (page: Page) => page.evaluate(() =>
  [...document.styleSheets].flatMap((sheet) => [...sheet.cssRules]).filter((rule) => rule instanceof CSSPageRule).map((rule) => rule.cssText).join(" "));
const sizeRadio = (page: Page, size: "10 × 15" | "10 × 10") => page.getByRole("radio", { name: new RegExp(size) });

// Reads the bars the label really draws (the SVG path), not a data attribute, and decodes the Code128
// symbols back to text: start, data (sets B and C), check symbol and stop.
async function decodeBarcode(page: Page): Promise<string> {
  const svg = page.getByTestId("label-barcode");
  const d = (await svg.locator("path").getAttribute("d"))!;
  const width = Number((await svg.getAttribute("viewBox"))!.split(" ")[2]);
  const cells = Array.from({ length: width }, () => "0");
  for (const m of d.matchAll(/M(\d+) 0h(\d+)v1h-\d+z/g)) for (let i = 0; i < Number(m[2]); i++) cells[Number(m[1]) + i] = "1";
  expect(cells.slice(0, CODE128_QUIET_MODULES).join(""), "leading quiet zone").toBe("0".repeat(CODE128_QUIET_MODULES));
  expect(cells.slice(width - CODE128_QUIET_MODULES).join(""), "trailing quiet zone").toBe("0".repeat(CODE128_QUIET_MODULES));
  const runs = [...cells.join("").replace(/^0+|0+$/g, "").matchAll(/0+|1+/g)].map((m) => m[0].length);
  const count = (runs.length - 7) / 6;
  expect(Number.isInteger(count)).toBe(true);
  const values = Array.from({ length: count }, (_, j) => CODE128_PATTERNS.slice(0, CODE128_STOP).indexOf(runs.slice(6 * j, 6 * j + 6).join("")));
  expect(values.every((v) => v >= 0), "every symbol is a Code128 symbol").toBe(true);
  expect(runs.slice(6 * count).join("")).toBe(CODE128_PATTERNS[CODE128_STOP]);
  const [start, ...rest] = values;
  const check = rest.pop()!;
  expect(rest.reduce((acc, v, i) => acc + v * (i + 1), start) % 103, "check symbol").toBe(check);
  let set = start === 105 ? "C" : "B";
  let out = "";
  for (const v of rest) {
    if (set === "C") {
      if (v === 100) set = "B";
      else out += String(v).padStart(2, "0");
    } else if (v === 99) set = "C";
    else out += String.fromCharCode(v + 32);
  }
  return out;
}

// What the browser would print to a page: Chromium's print-to-PDF honours the @page rule, so its page size
// and count are the print preview geometry (1 mm = 72/25.4 pt).
async function printedPages(page: Page) {
  const pdf = (await page.pdf({ preferCSSPageSize: true, printBackground: true })).toString("latin1");
  const box = /\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/.exec(pdf);
  expect(box, "PDF page size").not.toBeNull();
  return { widthMm: (Number(box![1]) * 25.4) / 72, heightMm: (Number(box![2]) * 25.4) / 72, pages: (pdf.match(/\/Type\s*\/Page(?![a-z])/g) ?? []).length };
}

async function evidence(page: Page, name: string) {
  if (!EVIDENCE) return;
  mkdirSync(EVIDENCE, { recursive: true });
  await page.screenshot({ path: join(EVIDENCE, `${name}-${test.info().project.name}.png`), fullPage: true });
}

test("a real issued shipment offers Cetak label, prints a decodable local label and reprints on the same snapshot", async ({ page }) => {
  resetTenant();
  const id = realShipment({ cod: 125000 });
  await signIn(page, "owner-a@geraiexpress.test");
  await page.goto(`/pengiriman/${id}`);
  // Neutral wording (DEC-017: courier acceptance of a local label is unproven until T-048): the local
  // label is offered and the Mengantar-app label stays a fallback; nothing is said about courier acceptance.
  await expect(page.getByText("label dari aplikasi Mengantar tetap bisa dipakai sebagai cadangan", { exact: false })).toBeVisible();
  await expect(page.getByText("tidak diperlukan", { exact: false })).toHaveCount(0);
  await expect(page.getByText("Cetak label resmi dari aplikasi Mengantar")).toHaveCount(0);
  // The real pickup address stays visible on the detail for returns.
  await expect(page.getByText("Jl. Pickup Nyata No. 5", { exact: false })).toBeVisible();
  await page.getByRole("link", { name: "Cetak label" }).click();
  await expect(page).toHaveURL(new RegExp(`/pengiriman/${id}/label$`));

  // Off by default, with visible on/off text; the preview is the gerai identity.
  await expect(maskSwitch(page)).not.toBeChecked();
  await expect(page.getByTestId("mask-state")).toHaveText("Nonaktif");
  await expect(page.getByTestId("preview-source")).toHaveText("Belum disimpan");
  const sheet = page.getByTestId("label-sheet");
  await expect(page.getByTestId("label-sender-name")).toHaveText("Gerai Uji A");
  await expect(page.getByTestId("label-sender-phone")).toHaveText(WHATSAPP);
  await expect(page.getByTestId("label-sender-place")).toHaveText("Jl. Pickup Nyata No. 5, Kec. Pickup, Kota Nyata");
  await expect(sheet).toHaveAttribute("data-size", "10x15");
  await expect.poll(() => pageRule(page)).toContain("size: 100mm 150mm");

  // Content: recipient, courier and service, weight, COD instruction, barcode and AWB text, reference.
  await expect(sheet).toContainText("Penerima Uji");
  await expect(sheet).toContainText("Jl. Tujuan Uji No. 9, Kec. Tujuan, Kota Uji, 40132");
  await expect(page.getByTestId("label-service")).toContainText("J&T Express REG");
  await expect(page.getByTestId("label-service")).toContainText("1,5 kg");
  await expect(page.getByTestId("label-cod")).toHaveText(/COD — Tagih ke penerima: Rp\s*125\.000/);
  await expect(page.getByTestId("label-awb")).toHaveText("JP1234567890");
  await expect(page.getByTestId("label-reference")).toContainText("GERA-E2E-");
  expect(await decodeBarcode(page)).toBe("JP1234567890");
  // Never the Mengantar pickup name or outlet as sender, and no price, cost or discount.
  const printedText = (await sheet.innerText()).replace(/\s+/g, " ");
  expect(printedText).not.toContain(PICKUP_NAME);
  expect(printedText).not.toContain("Outlet Uji A");
  expect(printedText).not.toMatch(/Ongkir|24\.680|24680|13\.579|diskon|biaya/i);
  await expectNoHorizontalOverflow(page);
  await expectTouchTargets(page);
  await evidence(page, "label-screen");

  // First print: one snapshot, one history row, one print dialog request, wording never claims paper.
  expect(count("label_snapshots", id)).toBe(0);
  await printButton(page).click();
  await expect(page.getByTestId("print-notice")).toContainText("belum membuktikan kertas tercetak");
  await expect.poll(() => prints(page)).toBe(1);
  await expect(page.getByTestId("print-history").getByRole("listitem")).toHaveCount(1);
  await expect(page.getByTestId("preview-source")).toContainText("Label tersimpan versi 1");
  expect(count("label_snapshots", id)).toBe(1);
  expect(count("label_print_events", id)).toBe(1);

  // Reprint after the gerai is renamed: the stored snapshot is reused, not rebuilt from live data.
  localSql(`update public.tenants set name = 'Gerai Diganti Nama' where id = '${TENANT_A}'`);
  try {
    await page.reload();
    await expect(page.getByTestId("label-sender-name")).toHaveText("Gerai Uji A");
    await expect(printButton(page)).toHaveText(/Cetak ulang label/);
    await printButton(page).click();
    await expect.poll(() => prints(page)).toBe(1); // a fresh page load: one print since reload
    await expect(page.getByTestId("print-history").getByRole("listitem")).toHaveCount(2);
  } finally {
    localSql(`update public.tenants set name = 'Gerai Uji A' where id = '${TENANT_A}'`);
  }
  expect(count("label_snapshots", id)).toBe(1);
  expect(count("label_print_events", id)).toBe(2);
});

test("masking on needs all three sender fields, previews them, keeps the true identity and prints no indicator", async ({ page }) => {
  resetTenant();
  const id = realShipment();
  await signIn(page, "operator-a@geraiexpress.test");
  await page.goto(`/pengiriman/${id}/label`);
  await maskSwitch(page).check();
  await expect(page.getByTestId("mask-state")).toHaveText("Aktif");
  await expect(page.getByText("Masking aktif", { exact: true })).toBeVisible();
  await expect(page.getByTestId("sender-fields")).toBeVisible();
  // Operators do not see the administrators' retention note.
  await expect(page.getByTestId("retention-note")).toHaveCount(0);

  // T-094: the fields start from the shipment's own sender (this one has no address or area yet).
  await expect(page.getByLabel("Nama pengirim")).toHaveValue("Pengirim Asli");
  await expect(page.getByLabel("No. HP pengirim")).toHaveValue("081200000099");
  await expect(page.getByLabel("Alamat pengirim (opsional)")).toHaveValue("");
  // Blocked with a field error next to each input until the required ones are entered; nothing is stored.
  await page.getByLabel("Nama pengirim").fill("");
  await page.getByLabel("No. HP pengirim").fill("");
  await printButton(page).click();
  await expect(page.getByLabel("Nama pengirim")).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByText("Isi nama pengirim.")).toBeVisible();
  await expect(page.getByText("Isi nomor HP pengirim.")).toBeVisible();
  await expect(page.getByText("Isi kecamatan / kota pengirim.")).toBeVisible();
  await expect(page.getByLabel("Nama pengirim")).toBeFocused();
  expect(await prints(page)).toBe(0);
  expect(count("label_snapshots", id)).toBe(0);

  await page.getByLabel("Nama pengirim").fill("Toko Pelanggan");
  await page.getByLabel("No. HP pengirim").fill("0813-1111-2222");
  await expect(page.getByText("Isi nama pengirim.")).toHaveCount(0);
  await page.getByLabel("Kecamatan / kota pengirim").fill("Bandung");
  // The preview changes with the entered sender and no longer shows the gerai pickup address.
  await expect(page.getByTestId("label-sender-name")).toHaveText("Toko Pelanggan");
  await expect(page.getByTestId("label-sender-phone")).toHaveText("081311112222");
  await expect(page.getByTestId("label-sender-place")).toHaveText("Bandung");
  const sender = (await page.getByTestId("label-sender").innerText()).replace(/\s+/g, " ");
  await expect(page.getByTestId("gerai-identity")).toContainText("Gerai Uji A");
  for (const gerai of [WHATSAPP, "Jl. Pickup Nyata No. 5", PICKUP_NAME]) expect(sender).not.toContain(gerai);
  await expect(page.getByTestId("label-sheet")).not.toContainText(WHATSAPP);
  await expect(page.getByTestId("label-sheet").locator('a[href*="wa.me"], a[href^="tel:"]')).toHaveCount(0);
  expect(await decodeBarcode(page)).toBe("JP1234567890");
  await expectNoHorizontalOverflow(page);
  await expectTouchTargets(page);
  await evidence(page, "label-masked-screen");

  await printButton(page).click();
  await expect.poll(() => prints(page)).toBe(1);
  await expect(page.getByTestId("preview-source")).toContainText("Label tersimpan versi 1");
  const row = JSON.parse(localSql(`select row_to_json(s) from public.label_snapshots s where shipment_id = '${id}'`));
  expect(row).toMatchObject({
    mask_sender: true, printed_sender_name: "Toko Pelanggan", printed_sender_phone: "081311112222", printed_sender_city: "Bandung",
    printed_sender_address: null, true_tenant_name: "Gerai Uji A", true_pickup_name: PICKUP_NAME, true_pickup_address: "Jl. Pickup Nyata No. 5",
  });

  // Print preview: the on-screen "Masking aktif" indicator and every control are absent from the printout.
  await page.emulateMedia({ media: "print" });
  await expect(page.getByText("Masking aktif", { exact: true })).toBeHidden();
  await expect(page.getByRole("button", { name: /Cetak/ })).toBeHidden();
  await expect(maskSwitch(page)).toBeHidden();
  await expect(page.getByTestId("label-sheet")).toBeVisible();
  await expect(page.locator("aside, header").filter({ visible: true })).toHaveCount(0);

  // A changed switch adds a version; the earlier snapshot is untouched.
  await page.emulateMedia({ media: "screen" });
  await maskSwitch(page).uncheck();
  await expect(page.getByTestId("preview-source")).toHaveText("Belum disimpan");
  await printButton(page).click();
  await expect.poll(() => prints(page)).toBe(2);
  expect(count("label_snapshots", id)).toBe(2);
  expect(localSql(`select string_agg(version || ':' || mask_sender, ',' order by version) from public.label_snapshots where shipment_id = '${id}'`)).toBe("1:true,2:false");
});

test("the print preview is exactly the chosen size, one label per page, with no chrome and no clipping", async ({ page }) => {
  resetTenant();
  const id = realShipment({
    cod: 99000, awb: "SPXID012345678901", name: "Penerima Dengan Nama Yang Sangat Panjang Sekali Untuk Menguji Tampilan Label",
    address: `Jl. Contoh Panjang Sekali ${"Perumahan Contoh Asri Blok C2 No. 14 RT 004 RW 009 ".repeat(4)}`.trim(),
  });
  await signIn(page, "operator-a@geraiexpress.test");
  await page.goto(`/pengiriman/${id}/label`);
  await expect(sizeRadio(page, "10 × 15")).toBeChecked();
  for (const [size, label, widthMm, heightMm] of [["10 × 15", "10x15", 100, 150], ["10 × 10", "10x10", 100, 100]] as const) {
    await page.emulateMedia({ media: "screen" });
    await sizeRadio(page, size).check();
    await expect(page.getByTestId("label-sheet")).toHaveAttribute("data-size", label);
    await expect.poll(() => pageRule(page)).toContain(`size: ${widthMm}mm ${heightMm}mm`);
    // Print output exists for a stored snapshot only: store this size first, then read it in print media.
    await storeThenPrintMedia(page);
    const box = await page.getByTestId("label-sheet").evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { w: r.width, h: r.height, scrollH: el.scrollHeight, clientH: el.clientHeight, scrollW: el.scrollWidth, clientW: el.clientWidth };
    });
    expect(box.w / (96 / 25.4), `${label} width mm`).toBeCloseTo(widthMm, 0);
    expect(box.h / (96 / 25.4), `${label} height mm`).toBeCloseTo(heightMm, 0);
    // Long names and addresses wrap or shrink inside the sheet; nothing is clipped.
    expect(box.scrollH, `${label} vertical clipping`).toBeLessThanOrEqual(box.clientH);
    expect(box.scrollW, `${label} horizontal clipping`).toBeLessThanOrEqual(box.clientW);
    expect(await decodeBarcode(page)).toBe("SPXID012345678901");
    await expect(page.locator("aside, header, nav").filter({ visible: true })).toHaveCount(0);
    const pdf = await printedPages(page);
    expect(pdf.pages, `${label} pages`).toBe(1);
    expect(pdf.widthMm).toBeCloseTo(widthMm, 0);
    expect(pdf.heightMm).toBeCloseTo(heightMm, 0);
    await evidence(page, `label-print-${label}`);
  }
});

// The barcode block (bars, AWB text, reference) must always be fully inside the sheet and below every
// text block, however long the name, address and item are (B-T044b).
test("worst case: COD, a 100-character name, a 460-character address and a 200-character item keep the barcode inside both sizes", async ({ page }) => {
  resetTenant();
  const id = realShipment({
    cod: 1234567, awb: "SPXID012345678901",
    name: "Penerima Dengan Nama Panjang ".repeat(5).slice(0, 100).trim(),
    address: "Jl. Contoh Panjang Sekali Perumahan Contoh Asri Blok C2 No. 14 RT 004 RW 009 ".repeat(8).slice(0, 460).trim(),
    item: "Buku pelajaran dan alat tulis lengkap ".repeat(6).slice(0, 200).trim(),
  });
  await signIn(page, "operator-a@geraiexpress.test");
  await page.goto(`/pengiriman/${id}/label`);
  for (const [size, label, minBarcodeMm] of [["10 × 15", "10x15", 19], ["10 × 10", "10x10", 11.5]] as const) {
    await page.emulateMedia({ media: "screen" });
    await sizeRadio(page, size).check();
    await expect(page.getByTestId("label-sheet")).toHaveAttribute("data-size", label);
    await expect(page.getByTestId("label-cod")).toBeVisible();
    await storeThenPrintMedia(page);
    const m = await page.evaluate(() => {
      const box = (testid: string) => {
        const r = document.querySelector(`[data-testid="${testid}"]`)!.getBoundingClientRect();
        return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, height: r.height };
      };
      return {
        sheet: box("label-sheet"), barcode: box("label-barcode"), awb: box("label-awb"), reference: box("label-reference"),
        block: box("label-barcode-block"), service: box("label-service"), recipient: box("label-recipient"), sender: box("label-sender"), cod: box("label-cod"), item: box("label-item"),
      };
    });
    const mm = 96 / 25.4;
    for (const key of ["barcode", "awb", "reference"] as const) {
      expect(m[key].top, `${label} ${key} top`).toBeGreaterThanOrEqual(m.sheet.top - 0.5);
      expect(m[key].bottom, `${label} ${key} bottom`).toBeLessThanOrEqual(m.sheet.bottom + 0.5);
      expect(m[key].left, `${label} ${key} left`).toBeGreaterThanOrEqual(m.sheet.left - 0.5);
      expect(m[key].right, `${label} ${key} right`).toBeLessThanOrEqual(m.sheet.right + 0.5);
    }
    expect(m.barcode.height / mm, `${label} barcode keeps its height`).toBeGreaterThanOrEqual(minBarcodeMm);
    // Nothing above overlaps the barcode block.
    for (const key of ["sender", "recipient", "service", "cod", "item"] as const) {
      expect(m[key].bottom, `${label} ${key} stays above the barcode`).toBeLessThanOrEqual(m.block.top + 0.5);
    }
    expect(await decodeBarcode(page)).toBe("SPXID012345678901");
    expect((await printedPages(page)).pages, `${label} pages`).toBe(1);
    await evidence(page, `label-worst-${label}`);
  }
});

test("Ctrl+P on an unsaved preview prints no sheet; a stored snapshot prints", async ({ page }) => {
  resetTenant();
  const id = realShipment({ cod: 99000 });
  await signIn(page, "owner-a@geraiexpress.test");
  await page.goto(`/pengiriman/${id}/label`);
  await expect(page.getByTestId("preview-source")).toHaveText("Belum disimpan");
  // Print media before pressing Cetak label: the unsaved preview is not part of the printout.
  await page.emulateMedia({ media: "print" });
  await expect(page.getByTestId("label-sheet")).toBeHidden();
  expect(count("label_snapshots", id)).toBe(0);
  // Pressing Cetak label stores the snapshot; only then does the sheet print.
  await page.emulateMedia({ media: "screen" });
  await expect(page.getByTestId("label-sheet")).toBeVisible();
  await printButton(page).click();
  await expect.poll(() => prints(page)).toBe(1);
  expect(count("label_snapshots", id)).toBe(1);
  await page.emulateMedia({ media: "print" });
  await expect(page.getByTestId("label-sheet")).toBeVisible();
  // Changing the choice makes the preview unsaved again: nothing prints until it is stored.
  await page.emulateMedia({ media: "screen" });
  await sizeRadio(page, "10 × 10").check();
  await page.emulateMedia({ media: "print" });
  await expect(page.getByTestId("label-sheet")).toBeHidden();
});

test("an empty gerai WhatsApp blocks the unmasked print: operators see the prompt only, administrators a link", async ({ page }) => {
  resetTenant(null);
  const id = realShipment();
  await signIn(page, "operator-a@geraiexpress.test");
  await page.goto(`/pengiriman/${id}/label`);
  const prompt = page.getByTestId("whatsapp-missing");
  await expect(prompt).toContainText("Nomor WhatsApp gerai belum diisi. Minta administrator gerai mengisinya di Pengaturan.");
  await expect(page.getByRole("link", { name: /Isi nomor WhatsApp gerai/ })).toHaveCount(0);
  await expect(printButton(page)).toBeDisabled();
  expect(count("label_snapshots", id)).toBe(0);
  await expectNoHorizontalOverflow(page);
  await evidence(page, "label-whatsapp-missing-operator");
  // Masking supplies its own sender, so it is not blocked by the missing gerai number.
  await maskSwitch(page).check();
  await expect(prompt).toHaveCount(0);
  await expect(printButton(page)).toBeEnabled();

  await page.context().clearCookies();
  await signIn(page, "owner-a@geraiexpress.test");
  await page.goto(`/pengiriman/${id}/label`);
  await expect(page.getByTestId("whatsapp-missing")).toBeVisible();
  // The link opens the WhatsApp section of the grouped settings page (C8), not just the page top.
  await expect(page.getByRole("link", { name: /Isi nomor WhatsApp gerai/ })).toHaveAttribute("href", "/pengaturan#whatsapp-gerai");
  await expect(printButton(page)).toBeDisabled();
  expect(count("label_snapshots", id)).toBe(0);
});

test("masking disabled by the platform: the switch is disabled with the reason, the gerai identity still prints", async ({ page }) => {
  resetTenant(WHATSAPP, false);
  const id = realShipment();
  await signIn(page, "owner-a@geraiexpress.test");
  await page.goto(`/pengiriman/${id}/label`);
  await expect(maskSwitch(page)).toBeDisabled();
  await expect(maskSwitch(page)).not.toBeChecked();
  await expect(page.getByTestId("mask-disabled-reason")).toHaveText(
    "Masking pengirim dinonaktifkan untuk gerai ini oleh administrator platform. Label dicetak dengan identitas gerai. Hubungi administrator gerai untuk informasi lebih lanjut.",
  );
  await expect(maskSwitch(page)).toHaveAccessibleDescription(/dinonaktifkan untuk gerai ini oleh administrator platform/);
  await expect(page.getByTestId("label-sender-name")).toHaveText("Gerai Uji A");
  await expect(sizeRadio(page, "10 × 10")).toBeEnabled();
  await expectNoHorizontalOverflow(page);
  await expectTouchTargets(page);
  await evidence(page, "label-masking-disabled");
  await printButton(page).click();
  await expect.poll(() => prints(page)).toBe(1);
  expect(localSql(`select mask_sender from public.label_snapshots where shipment_id = '${id}'`)).toBe("f");
  // The database refusal of a masked snapshot for this tenant is proved in tests/db/masked-label.test.ts.
});

test("unavailable shipments send the user back to the detail, and another gerai's label is not found", async ({ page }) => {
  resetTenant();
  const noAwb = realShipment({ state: "unknown", awb: null });
  await signIn(page, "operator-a@geraiexpress.test");
  await page.goto(`/pengiriman/${noAwb}/label`);
  await expect(page).toHaveURL(new RegExp(`/pengiriman/${noAwb}$`));
  const issued = realShipment();
  await page.context().clearCookies();
  await signIn(page, "owner-b@geraiexpress.test");
  const res = await page.goto(`/pengiriman/${issued}/label`);
  expect(res?.status()).toBe(404);
});

test("batch queue prints selected labels and excludes unavailable shipments", async ({ page }) => {
  resetTenant();
  const first = realShipment(), second = realShipment(), unavailable = realShipment({ state: "unknown", awb: null });
  await signIn(page, "owner-a@geraiexpress.test");
  await page.goto(`/pengiriman?q=GERA-E2E`);
  await page.getByRole("checkbox", { name: new RegExp(first.slice(0, 6), "i") }).check();
  if ((page.viewportSize()?.width ?? 1280) >= 768) {
    // The 44px cell around the 20px box is the target: a click near its edge toggles the row.
    const cell = page.getByTestId("row-select").filter({ has: page.getByRole("checkbox", { name: new RegExp(second.slice(0, 6), "i") }) });
    await cell.click({ position: { x: 2, y: 2 } });
    await expect(page.getByRole("checkbox", { name: new RegExp(second.slice(0, 6), "i") })).toBeChecked();
  } else {
    await page.getByRole("checkbox", { name: new RegExp(second.slice(0, 6), "i") }).check();
  }
  await evidence(page, "batch-list");
  await page.getByRole("link", { name: "Cetak label (2)" }).click();
  await expect(page.getByRole("heading", { name: "Cetak label massal" })).toBeVisible();
  await page.goto(`/pengiriman/cetak?ids=${first},${second},${unavailable}`);
  await expect(page.getByText("Resi belum terbit.")).toBeVisible();
  await expect(page.getByTestId("label-sheet")).toHaveCount(2);
  await evidence(page, "batch-queue");
  await expectNoHorizontalOverflow(page);
  // Hold the print request so the pending state is observable: every choice control is locked.
  const { promise: held, resolve: release } = Promise.withResolvers<void>();
  await page.route("**/pengiriman/cetak**", async (route) => {
    if (route.request().method() === "POST") await held;
    await route.continue();
  });
  await page.getByRole("button", { name: "Cetak 2 label" }).click();
  await expect(page.getByRole("radio", { name: "10 × 10 cm" })).toBeDisabled();
  await expect(page.getByRole("radio", { name: "10 × 15 cm" })).toBeDisabled();
  await expect(page.getByRole("switch", { name: "Gunakan masking pengirim" })).toBeDisabled();
  expect(await prints(page)).toBe(0);
  release();
  await expect.poll(() => prints(page)).toBe(1);
  await page.unroute("**/pengiriman/cetak**");
  await expect(page.getByRole("switch", { name: "Gunakan masking pengirim" })).toBeEnabled();
  expect(count("label_print_events", first)).toBe(1);
  expect(count("label_print_events", second)).toBe(1);
  await page.emulateMedia({ media: "print" });
  const geometry = await printedPages(page);
  expect(geometry.pages).toBe(2);
  expect(geometry.widthMm).toBeCloseTo(100, 0);
  expect(geometry.heightMm).toBeCloseTo(150, 0);
  await page.emulateMedia({ media: "screen" });
  await page.getByRole("switch", { name: "Gunakan masking pengirim" }).check();
  await expect(page.getByText("Isi kecamatan / kota pengirim.").first()).toBeVisible();
  await page.getByLabel("Kecamatan / kota pengirim untuk kiriman yang belum mengisinya").fill("Bandung");
  await page.getByRole("radio", { name: "10 × 10 cm" }).click();
  await page.getByRole("button", { name: "Cetak 2 label" }).click();
  await expect.poll(() => prints(page)).toBe(2);
  expect(localSql(`select printed_sender_city from public.label_snapshots where shipment_id = '${first}' order by version desc limit 1`)).toBe("Bandung");
  await page.emulateMedia({ media: "print" });
  const square = await printedPages(page);
  expect(square.pages).toBe(2);
  expect(square.heightMm).toBeCloseTo(100, 0);
  await page.context().clearCookies();
  await signIn(page, "owner-b@geraiexpress.test");
  expect((await page.goto(`/pengiriman/cetak?ids=${first}`))?.status()).toBe(404);
  // A repeated parameter arrives as an array: not-found, never a server error.
  expect((await page.goto(`/pengiriman/cetak?ids=${first}&ids=${second}`))?.status()).toBe(404);
});
