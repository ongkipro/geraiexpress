// T-096: runs under mobile-390 and desktop-1280 (also the repository's tablet project).
// Local synthetic tenant/issued shipment only; no provider operation or live request is created.
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "./fixtures";
import { expectNoHorizontalOverflow, expectTouchTargets, localSql, signIn } from "./helpers";

const tenant = randomUUID(), outlet = randomUUID();
const owner = "00000000-0000-4000-a000-0000000000a1", operator = "00000000-0000-4000-a000-0000000000a2";
const NAME = "Gerai Logo E2E";
const GERAI_WHATSAPP = "081355550000";
// Synthetic 96x24 raster marks, generated offline with Python stdlib PNG/zlib: black GE on white,
// then white GX on black, each with a parcel icon. Distinct pixels make print evidence meaningful.
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAGAAAAAYCAAAAAAggqdIAAAAVUlEQVR42mP4T2PAgGDBAKYImvgwsoABL0CxAM1cTEHsrqO9Bbg4CO5AWIBp06gFcLPQEwChTEBfC3DI0dcCipLpqAUj3gKa1weD1ALSqkyatypoBADyyQJh1kGTMwAAAABJRU5ErkJggg==", "base64");
const replacement = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAGAAAAAYCAAAAAAggqdIAAAAT0lEQVR42mNgoBv4DwPIIljZw8iC/3gBulJM9mCwABcHC5eOFmCK45YdcRZgTQB4cgB9LcAvRycLcLGJioMRaQFpOXm4W0Dz+mCQWjAyAADSy8hGBK4x/wAAAABJRU5ErkJggg==", "base64");
const EVIDENCE = process.env.E2E_EVIDENCE_DIR;

test.beforeAll(() => {
  localSql(`insert into public.tenants(id,name,lifecycle,contact_whatsapp) values ('${tenant}','${NAME}','active','${GERAI_WHATSAPP}');
    insert into public.outlets(tenant_id,id,name) values ('${tenant}','${outlet}','Outlet Logo E2E');
    insert into public.memberships(tenant_id,user_id,role) values ('${tenant}','${owner}','tenant_admin'),('${tenant}','${operator}','operator');`);
});
test.afterAll(() => { localSql(`delete from public.tenants where id='${tenant}'`); });

async function evidence(page: import("@playwright/test").Page, name: string) {
  const testInfo = test.info();
  await page.screenshot({ path: testInfo.outputPath(`gerai-logo-${name}.png`), fullPage: true });
  if (!EVIDENCE) return;
  mkdirSync(EVIDENCE, { recursive: true });
  await page.screenshot({ path: join(EVIDENCE, `gerai-logo-${name}-${test.info().project.name}.png`), fullPage: true });
}
async function selectTenant(page: import("@playwright/test").Page, baseURL: string, email: string) {
  await signIn(page, email);
  await page.context().addCookies([{ name: "ge_tenant", value: tenant, url: baseURL }]);
}
function shipment() {
  const id = randomUUID();
  localSql(`insert into public.shipments(tenant_id,outlet_id,id,reference,submission_state,payment_state,sender_name,sender_phone,
    sender_address,sender_area,recipient_name,recipient_phone,recipient_address,recipient_area,item_description,weight_grams,goods_value_idr,is_cod,is_simulated,created_by,awb)
    values ('${tenant}','${outlet}','${id}','LOGO-${id.slice(0, 8)}','issued','paid','Pengirim Uji','081234567890',
    'Jl. Pengirim Uji 7','Bandung','Penerima Uji','081234567890','Jl. Tujuan Uji 9','Kota Uji','Buku',1000,50000,false,false,'${owner}','JP1234567890');`);
  return id;
}

async function expectMaskedSender(sheet: import("@playwright/test").Locator) {
  await expect(sheet.getByTestId("label-sender-name")).toHaveText("Pengirim Uji");
  await expect(sheet.getByTestId("label-sender-phone")).toHaveText("081234567890");
  await expect(sheet.getByTestId("label-sender-place")).toHaveText("Jl. Pengirim Uji 7, Bandung");
  await expect(sheet).not.toContainText(GERAI_WHATSAPP);
  await expect(sheet.locator('a[href*="wa.me"], a[href^="tel:"]')).toHaveCount(0);
}
async function expectParcelLayout(sheet: import("@playwright/test").Locator) {
  const boxes = await sheet.evaluate((element) => {
    const box = (id: string) => {
      const r = element.querySelector(`[data-testid="${id}"]`)!.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
    };
    return { identity: box("gerai-identity"), name: box("label-sender-name"), place: box("label-sender-place"),
      sender: box("label-sender"), recipient: box("label-recipient"), barcode: box("label-barcode-block") };
  });
  expect(boxes.identity.bottom, "branding stays above the masked sender fields").toBeLessThanOrEqual(boxes.name.top + 0.5);
  for (const part of [boxes.identity, boxes.name, boxes.place]) {
    expect(part.bottom, "sender content is not clipped").toBeLessThanOrEqual(boxes.sender.bottom + 0.5);
  }
  expect(boxes.identity.bottom, "branding stays above recipient").toBeLessThanOrEqual(boxes.recipient.top + 0.5);
  expect(boxes.recipient.bottom, "recipient stays above barcode").toBeLessThanOrEqual(boxes.barcode.top + 0.5);
}

test("admin previews, uploads, replaces and removes; unmasked print and reprint retain immutable branding", async ({ page, baseURL }) => {
  await page.addInitScript(() => { window.__prints = 0; window.print = () => { window.__prints++; }; });
  await selectTenant(page, baseURL!, "owner-a@geraiexpress.test");
  await page.goto("/pengaturan#logo-gerai");
  const form = page.getByTestId("gerai-logo-form");
  const input = form.getByLabel("Logo gerai", { exact: true });
  await expect(form.getByTestId("logo-preview")).toContainText(NAME);
  await input.setInputFiles({ name: "bad.svg", mimeType: "image/svg+xml", buffer: Buffer.from("<svg/>") });
  await expect(form.getByRole("alert")).toContainText("SVG tidak diizinkan");
  await input.setInputFiles({ name: "huge.png", mimeType: "image/png", buffer: Buffer.alloc(204801) });
  await expect(form.getByRole("alert")).toContainText("maksimal 200 KB");
  await input.setInputFiles({ name: "spoof.png", mimeType: "image/png", buffer: Buffer.from("<svg/>") });
  await expect(form.getByRole("alert")).toContainText("yang valid");
  await input.setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: png });
  const preview = form.getByRole("img", { name: `Logo ${NAME}` });
  await expect(preview).toBeVisible();
  await expect.poll(() => preview.evaluate((img) => (img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await evidence(page, "settings-unsaved-preview");
  await form.getByRole("button", { name: "Simpan logo", exact: true }).click();
  await expect(form.getByRole("status")).toContainText("Logo disimpan");
  await expect(form.getByTestId("logo-preview")).toContainText("versi 1");
  await expectNoHorizontalOverflow(page);
  await expectTouchTargets(page);
  await evidence(page, "settings-saved");

  const id = shipment();
  await page.goto(`/pengiriman/${id}/label`);
  const identity = page.getByTestId("label-sheet").getByTestId("gerai-identity");
  await expect(identity).toContainText(NAME);
  await expect(identity.getByRole("img")).toHaveAttribute("src", `data:image/png;base64,${png.toString("base64")}`);
  await page.getByRole("button", { name: "Cetak label", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__prints)).toBe(1);
  await expect(page.getByTestId("preview-source")).toContainText("Label tersimpan versi 1");
  const first = JSON.parse(localSql(`select row_to_json(s) from public.label_snapshots s where shipment_id='${id}'`));
  expect(first.gerai_logo.version).toBe(1);
  await page.emulateMedia({ media: "print" });
  const dimensions = await identity.getByRole("img").boundingBox();
  expect(dimensions!.width).toBeLessThanOrEqual(84); // <=22mm at 96 CSS px/in
  expect(dimensions!.height).toBeLessThanOrEqual(20); // <=5mm
  await evidence(page, "label-print");
  await page.emulateMedia({ media: "screen" });

  await page.goto("/pengaturan#logo-gerai");
  await input.setInputFiles({ name: "replacement.png", mimeType: "image/png", buffer: replacement });
  await form.getByRole("button", { name: "Ganti logo", exact: true }).click();
  await expect(form.getByTestId("logo-preview")).toContainText("versi 2");
  await form.getByRole("button", { name: "Hapus logo", exact: true }).click();
  await expect(form.getByRole("status")).toContainText("Logo dihapus");
  await expect(form.getByTestId("logo-preview").getByRole("img")).toHaveCount(0);
  await evidence(page, "settings-removed");

  await page.goto(`/pengiriman/${id}/label`);
  await expect(identity.getByRole("img")).toHaveAttribute("src", `data:image/png;base64,${png.toString("base64")}`);
  await page.getByRole("button", { name: "Cetak ulang label", exact: true }).click();
  await expect(page.getByTestId("print-history").getByRole("listitem")).toHaveCount(2);
  expect(JSON.parse(localSql(`select row_to_json(s) from public.label_snapshots s where shipment_id='${id}'`))).toEqual(first);

  const next = shipment();
  await page.goto(`/pengiriman/${next}/label`);
  await expect(identity).toContainText(NAME);
  await expect(identity.getByRole("img")).toHaveCount(0);
  await page.getByRole("button", { name: "Cetak label", exact: true }).click();
  await expect(page.getByTestId("preview-source")).toContainText("Label tersimpan");
  const removed = JSON.parse(localSql(`select json_build_object('logo',gerai_logo,'revision',gerai_logo_revision) from public.label_snapshots where shipment_id='${next}'`));
  expect(removed).toEqual({ logo: null, revision: 3 });
});

// Each size has its own shipments: the first snapshot locks the format.
for (const size of ["10x10", "10x15"] as const) {
  test(`batch ${size}: mixed frozen/current logos, removal and masked reprints`, async ({ page, baseURL }) => {
    await page.addInitScript(() => { window.__prints = 0; window.print = () => { window.__prints++; }; });
    await selectTenant(page, baseURL!, "owner-a@geraiexpress.test");
    const snapshots = (id: string): Record<string, unknown>[] => JSON.parse(localSql(
      `select coalesce(json_agg(s order by s.version),'[]'::json) from public.label_snapshots s where shipment_id='${id}'`,
    ));
    const events = (id: string) => Number(localSql(`select count(*) from public.label_print_events where shipment_id='${id}'`));
    const sheet = (id: string) => page.getByRole("region", { name: `Pratinjau LOGO-${id.slice(0, 8)}`, exact: true }).getByTestId("label-sheet");
    const form = page.getByTestId("gerai-logo-form");
    async function upload(bytes: Buffer) {
      await page.goto("/pengaturan#logo-gerai");
      const revision = Number(await form.locator('input[name="revision"]').inputValue()) + 1;
      await form.getByLabel("Logo gerai", { exact: true }).setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: bytes });
      await expect(form.getByTestId("logo-preview")).toContainText("belum disimpan");
      await expect.poll(() => form.getByRole("img").evaluate((img) => (img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
      await evidence(page, `batch-${size}-settings-preview-v${revision}`);
      await form.getByRole("button", { name: /^(Simpan|Ganti) logo$/ }).click();
      await expect(form.getByTestId("logo-preview")).toContainText(`versi ${revision}.`);
      return revision;
    }
    async function openBatch(ids: string[], masked = false) {
      await page.goto(`/pengiriman/cetak?ids=${ids.join(",")}`);
      // The tab's remembered choice is restored after hydration; a click before that restore is undone by it.
      await expect(page.getByTestId("batch-settings")).toHaveAttribute("data-preference-restored", "true");
      // Choices are sessionStorage-backed; never inherit the prior masked test's choice.
      await page.getByRole("switch", { name: "Gunakan masking pengirim", exact: true }).setChecked(masked);
      // T-084 / PR-46: these fixtures have no quote (NULL courier = unverified), so a masked batch needs the acknowledgement.
      if (masked) await page.getByRole("checkbox", { name: /Saya mengerti penerimaannya belum terverifikasi/ }).check();
      await page.getByRole("radio", { name: size === "10x10" ? "10 × 10 cm" : "10 × 15 cm", exact: true }).click();
      await expect(page.getByTestId("label-sheet")).toHaveCount(ids.length);
      for (const id of ids) await expect(sheet(id)).toHaveAttribute("data-size", size);
      await expectNoHorizontalOverflow(page);
      await expectTouchTargets(page);
    }
    async function expectBrand(id: string, bytes: Buffer | null) {
      const identities = [sheet(id).getByTestId("gerai-identity")];
      const preview = page.getByRole("region", { name: `Pratinjau LOGO-${id.slice(0, 8)}`, exact: true });
      if (size === "10x15") identities.push(preview.getByTestId("customer-slip").getByTestId("gerai-identity"));
      for (const identity of identities) {
        await expect(identity).toContainText(NAME);
        if (bytes) {
          await expect(identity.getByRole("img")).toHaveAttribute("src", `data:image/png;base64,${bytes.toString("base64")}`);
          await expect.poll(() => identity.getByRole("img").evaluate((img) => (img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
        } else await expect(identity.getByRole("img")).toHaveCount(0);
      }
    }
    async function printBatch(ids: string[], phase: string) {
      const before = await page.evaluate(() => window.__prints);
      await page.getByRole("button", { name: `Cetak ${ids.length} label`, exact: true }).click();
      await expect.poll(() => page.evaluate(() => window.__prints)).toBe(before + 1);
      await page.emulateMedia({ media: "print" });
      for (const image of await page.getByTestId("gerai-identity").getByRole("img").all()) {
        const box = await image.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.width).toBeLessThanOrEqual(84); // Existing <=22mm constraint.
        expect(box!.height).toBeLessThanOrEqual(20); // Existing <=5mm constraint.
      }
      for (const id of ids) await expectParcelLayout(sheet(id));
      await evidence(page, `batch-${size}-${phase}-print`);
      // Same real PDF page-count/size check as label.spec.ts; screenshots alone do not prove pagination.
      const pdf = (await page.pdf({ path: test.info().outputPath(`gerai-logo-batch-${size}-${phase}.pdf`), preferCSSPageSize: true, printBackground: true })).toString("latin1");
      const box = /\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/.exec(pdf);
      expect(box, "PDF page size").not.toBeNull();
      expect((Number(box![1]) * 25.4) / 72).toBeCloseTo(100, 0);
      expect((Number(box![2]) * 25.4) / 72).toBeCloseTo(size === "10x10" ? 100 : 150, 0);
      expect((pdf.match(/\/Type\s*\/Page(?![a-z])/g) ?? []).length).toBe(ids.length);
      await page.emulateMedia({ media: "screen" });
    }

    const initialRevision = await upload(png);
    const old = shipment(), current = shipment(), removed = shipment(), masked = shipment();
    await openBatch([old]);
    await expectBrand(old, png);
    expect(snapshots(old)).toEqual([]); // Preview must not store a snapshot or print event.
    expect(events(old)).toBe(0);
    await evidence(page, `batch-${size}-initial-preview`);
    await printBatch([old], "first");
    await expectBrand(old, png);
    const first = snapshots(old);
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ version: 1, size, mask_sender: false, gerai_logo_revision: initialRevision,
      gerai_logo: { version: initialRevision, mime: "image/png", base64: png.toString("base64") } });
    expect(events(old)).toBe(1);

    const replacementRevision = await upload(replacement);
    await openBatch([old, current]);
    await expectBrand(old, png);
    await expectBrand(current, replacement);
    expect(snapshots(old)).toEqual(first);
    expect(snapshots(current)).toEqual([]);
    expect(events(current)).toBe(0);
    await evidence(page, `batch-${size}-mixed-preview`);
    await printBatch([old, current], "mixed-replacement");
    await expectBrand(old, png);
    await expectBrand(current, replacement);
    expect(snapshots(old)).toEqual(first); // Complete row including digest, timestamp and revision.
    const second = snapshots(current);
    expect(second).toHaveLength(1);
    expect(second[0]).toMatchObject({ version: 1, size, mask_sender: false, gerai_logo_revision: replacementRevision,
      gerai_logo: { version: replacementRevision, mime: "image/png", base64: replacement.toString("base64") } });
    expect(events(old)).toBe(2);
    expect(events(current)).toBe(1);

    // Owner (2026-11-05): branding stays visible on masked parcels, but never the gerai contact.
    // T-094 sender address/area are inserted by shipment(), never patched onto an issued shipment.
    await openBatch([masked], true);
    await expectBrand(masked, replacement);
    await expectMaskedSender(sheet(masked));
    await printBatch([masked], "masked-first");
    await expectBrand(masked, replacement);
    await expectMaskedSender(sheet(masked));
    const maskedFirst = snapshots(masked);
    expect(maskedFirst).toHaveLength(1);
    expect(maskedFirst[0]).toMatchObject({ version: 1, size, mask_sender: true, gerai_logo_revision: replacementRevision,
      gerai_logo: { version: replacementRevision, mime: "image/png", base64: replacement.toString("base64") } });
    expect(events(masked)).toBe(1);

    await page.goto("/pengaturan#logo-gerai");
    await form.getByRole("button", { name: "Hapus logo", exact: true }).click();
    await expect(form.getByRole("status")).toContainText("Logo dihapus");
    await expect(form.getByTestId("logo-preview").getByRole("img")).toHaveCount(0);
    await evidence(page, `batch-${size}-settings-removed`);
    await openBatch([old, current, removed]);
    await expectBrand(old, png);
    await expectBrand(current, replacement);
    await expectBrand(removed, null);
    expect(snapshots(removed)).toEqual([]);
    expect(events(removed)).toBe(0);
    await evidence(page, `batch-${size}-removed-preview`);
    await printBatch([old, current, removed], "mixed-removal");
    await expectBrand(old, png);
    await expectBrand(current, replacement);
    await expectBrand(removed, null);
    expect(snapshots(old)).toEqual(first);
    expect(snapshots(current)).toEqual(second);
    const withoutLogo = snapshots(removed);
    expect(withoutLogo).toHaveLength(1);
    expect(withoutLogo[0]).toMatchObject({ version: 1, size, mask_sender: false, gerai_logo: null, gerai_logo_revision: replacementRevision + 1 });
    expect(events(old)).toBe(3);
    expect(events(current)).toBe(2);
    expect(events(removed)).toBe(1);

    await openBatch([masked], true);
    await expectBrand(masked, replacement);
    await expectMaskedSender(sheet(masked));
    await printBatch([masked], "masked-reprint-after-removal");
    await expectBrand(masked, replacement);
    await expectMaskedSender(sheet(masked));
    expect(snapshots(masked)).toEqual(maskedFirst);
    expect(events(masked)).toBe(2);

    const maskedRemoved = shipment();
    await openBatch([maskedRemoved], true);
    await expectBrand(maskedRemoved, null);
    await expectMaskedSender(sheet(maskedRemoved));
    await printBatch([maskedRemoved], "masked-name-fallback");
    await expectBrand(maskedRemoved, null);
    await expectMaskedSender(sheet(maskedRemoved));
    expect(snapshots(maskedRemoved)[0]).toMatchObject({ size, mask_sender: true, gerai_logo: null, gerai_logo_revision: replacementRevision + 1 });
  });
}

for (const size of ["10x10", "10x15"] as const) {
  test(`individual masked ${size}: branded preview, immutable replacement/removal reprint and name fallback`, async ({ page, baseURL }) => {
    await page.addInitScript(() => { window.__prints = 0; window.print = () => { window.__prints++; }; });
    await selectTenant(page, baseURL!, "owner-a@geraiexpress.test");
    const form = page.getByTestId("gerai-logo-form");
    const sheet = page.getByTestId("label-sheet");
    async function upload(bytes: Buffer) {
      await page.goto("/pengaturan#logo-gerai");
      await form.getByLabel("Logo gerai", { exact: true }).setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: bytes });
      await form.getByRole("button", { name: /^(Simpan|Ganti) logo$/ }).click();
      await expect(form.getByRole("status")).toContainText("Logo disimpan");
    }
    async function open(id: string, bytes: Buffer | null) {
      await page.goto(`/pengiriman/${id}/label`);
      // A shipment without a stored label restores this tab's remembered switch after hydration (the earlier
      // open() left it on); a click before that restore is undone by it, so wait for the final state first.
      await expect(page.getByTestId("label-workbench")).toHaveAttribute("data-preference-restored", "true");
      await page.getByRole("switch", { name: /Gunakan masking pengirim/ }).setChecked(true);
      // T-084 / PR-46: NULL courier (no quote) is unverified, so the masked print needs the acknowledgement.
      await page.getByRole("checkbox", { name: /Saya mengerti penerimaannya belum terverifikasi/ }).check();
      const sizeOption = page.getByRole("radio", { name: size === "10x10" ? "10 × 10 cm" : "10 × 15 cm (standar)", exact: true });
      if (await sizeOption.isEnabled()) await sizeOption.check();
      else await expect(sizeOption).toBeChecked();
      await expect(sheet).toHaveAttribute("data-size", size);
      const identities = [sheet.getByTestId("gerai-identity")];
      if (size === "10x15") identities.push(page.getByTestId("customer-slip").getByTestId("gerai-identity"));
      for (const identity of identities) {
        await expect(identity).toContainText(NAME);
        if (bytes) await expect(identity.getByRole("img")).toHaveAttribute("src", `data:image/png;base64,${bytes.toString("base64")}`);
        else await expect(identity.getByRole("img")).toHaveCount(0);
      }
      await expectMaskedSender(sheet);
    }
    async function print(phase: string) {
      const before = await page.evaluate(() => window.__prints);
      await page.getByRole("button", { name: /^(Cetak label|Cetak ulang label)$/ }).click();
      await expect.poll(() => page.evaluate(() => window.__prints)).toBe(before + 1);
      await page.emulateMedia({ media: "print" });
      await expectMaskedSender(sheet);
      await expectParcelLayout(sheet);
      await evidence(page, `individual-masked-${size}-${phase}-print`);
      await page.emulateMedia({ media: "screen" });
    }
    const snapshot = (id: string) => JSON.parse(localSql(`select row_to_json(s) from public.label_snapshots s where shipment_id='${id}'`));
    await upload(png);
    const id = shipment();
    await open(id, png);
    await print("first");
    const first = snapshot(id);
    expect(first).toMatchObject({ size, mask_sender: true, gerai_logo: { mime: "image/png", base64: png.toString("base64") } });
    await upload(replacement);
    await open(id, png);
    await print("reprint-after-replacement");
    expect(snapshot(id)).toEqual(first);
    await page.goto("/pengaturan#logo-gerai");
    await form.getByRole("button", { name: "Hapus logo", exact: true }).click();
    await expect(form.getByRole("status")).toContainText("Logo dihapus");
    await open(id, png);
    await print("reprint-after-removal");
    expect(snapshot(id)).toEqual(first);
    const removed = shipment();
    await open(removed, null);
    await print("name-fallback");
    expect(snapshot(removed)).toMatchObject({ size, mask_sender: true, gerai_logo: null, true_tenant_name: NAME });
    await expectNoHorizontalOverflow(page);
  });
}

test("operator has a readable identity and no upload/removal controls", async ({ page, baseURL }) => {
  await selectTenant(page, baseURL!, "operator-a@geraiexpress.test");
  await page.goto("/pengaturan#logo-gerai");
  const form = page.getByTestId("gerai-logo-form");
  await expect(form).toContainText(NAME);
  await expect(form).toContainText("Hanya admin gerai");
  await expect(form.locator('input[type="file"]')).toHaveCount(0);
  await expect(form.getByRole("button")).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
});

test("an unreadable image leaves a visible gerai name and Bahasa feedback", async ({ page, baseURL }) => {
  await selectTenant(page, baseURL!, "owner-a@geraiexpress.test");
  const nextVersion = Number(localSql(`select coalesce(max(version),0)+1 from private.gerai_logo_versions where tenant_id='${tenant}'`));
  // A recognized signature is not a full decoder; this stored corrupt raster exercises the real onError path.
  localSql(`insert into private.gerai_logo_versions(tenant_id,version,mime,bytes,created_by)
    values ('${tenant}',${nextVersion},'image/png',decode('89504e470d0a1a0a','hex'),'${owner}')`);
  await page.goto("/pengaturan#logo-gerai");
  const form = page.getByTestId("gerai-logo-form");
  await expect(form.getByRole("alert")).toContainText("Logo tidak dapat dibaca");
  await expect(form.getByTestId("logo-preview")).toContainText(NAME);
  await expect(form.getByTestId("logo-preview").getByRole("img")).toHaveCount(0);
  const id = shipment();
  await page.goto(`/pengiriman/${id}/label`);
  const identity = page.getByTestId("label-sheet").getByTestId("gerai-identity");
  await expect(identity).toContainText(NAME);
  await expect(identity.getByRole("img")).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
  await evidence(page, "image-fallback");
});

test("completed image failures are recovered when logo hydration is delayed", async ({ page, baseURL }) => {
  await selectTenant(page, baseURL!, "owner-a@geraiexpress.test");
  const nextVersion = Number(localSql(`select coalesce(max(version),0)+1 from private.gerai_logo_versions where tenant_id='${tenant}'`));
  localSql(`insert into private.gerai_logo_versions(tenant_id,version,mime,bytes,created_by)
    values ('${tenant}',${nextVersion},'image/png',decode('89504e470d0a1a0a','hex'),'${owner}')`);
  const id = shipment();
  for (const surface of [
    { path: "/pengaturan#logo-gerai", selector: '[data-testid="logo-preview"] img', testId: "logo-preview" },
    { path: `/pengiriman/${id}/label`, selector: '[data-testid="gerai-identity"] img', testId: "gerai-identity" },
  ]) {
    const scripts = Promise.withResolvers<void>();
    const holdHydration = async (route: import("@playwright/test").Route) => {
      if (route.request().resourceType() === "script") await scripts.promise;
      await route.fallback();
    };
    await page.route("**/_next/**", holdHydration);
    try {
      // Inspect the real SSR image before any Next script can attach a React error handler. No sleep
      // or synthetic error event: the browser must actually finish decoding the corrupt inline PNG.
      await page.goto(surface.path, { waitUntil: "commit" });
      await page.waitForFunction((selector) => {
        const image = document.querySelector<HTMLImageElement>(selector);
        return image?.complete && image.naturalWidth === 0;
      }, surface.selector);
      const identity = surface.testId === "gerai-identity" ? page.getByTestId("label-sheet").getByTestId(surface.testId) : page.getByTestId(surface.testId);
      await expect(identity.getByRole("img")).toHaveCount(1);
      scripts.resolve();
      await expect(identity).toContainText(NAME);
      await expect(identity.getByRole("img")).toHaveCount(0);
      if (surface.testId === "logo-preview") {
        await expect(page.getByTestId("gerai-logo-form").getByRole("alert")).toContainText("Logo tidak dapat dibaca");
      }
    } finally {
      scripts.resolve();
      await page.unroute("**/_next/**", holdHydration);
    }
  }
});
