// T-085: synthetic issued shipments only, no provider calls; anonymous public page needs no JS.
import { randomUUID } from "node:crypto";
import { expect, test, actAsVisitor, randomVisitorIp } from "./fixtures";
import { audienceUrl, expectNoHorizontalOverflow, localSql, signIn } from "./helpers";

const tenant = "00000000-0000-4000-b000-00000000000a";
const outlet = "00000000-0000-4000-c000-00000000000a";
const owner = "00000000-0000-4000-a000-0000000000a1";
const created: string[] = [];
const fullNames = ["Pengirim Sangat Rahasia", "Penerima Sangat Rahasia", "Nama Cetak Tersamar"];
const privateValues = [...fullNames, "081200000099", "081299998888", "081377778888", "Jl. Tujuan Rahasia 9", "Jl. Pickup Rahasia 5", "Barang Sangat Rahasia", "987654", "999999"];

function seed(withPhone = true) {
  const id = randomUUID(), quote = randomUUID(); created.push(id);
  localSql(`insert into public.shipments(tenant_id,outlet_id,id,reference,submission_state,payment_state,sender_name,sender_phone,
    recipient_name,recipient_phone,recipient_address,recipient_area,item_description,weight_grams,goods_value_idr,is_cod,cod_amount_idr,
    is_simulated,created_by,awb,issued_at,pickup_snapshot)
    values ('${tenant}','${outlet}','${id}','TRACK-E2E-${id.slice(0,8)}','issued','paid','${fullNames[0]}',${withPhone ? "'081200000099'" : "null"},
    '${fullNames[1]}','081299998888','Jl. Tujuan Rahasia 9','Kec. Tujuan, Kota Uji','Barang Sangat Rahasia',1000,987654,true,999999,
    false,'${owner}','JP1234567890',now(),jsonb_build_object('outlet','Pickup Rahasia','address','Jl. Pickup Rahasia 5'));
    insert into public.shipment_quotes(tenant_id,shipment_id,id,shipment_revision,courier,service,normal_tariff_idr,eta_days,is_simulated,expires_at)
    values ('${tenant}','${id}','${quote}',1,'JT','REG',24680,'1-2',false,now()+interval '1 hour');
    update public.shipments set selected_quote_id='${quote}' where id='${id}'`);
  return id;
}
function label(id: string, masked: boolean) {
  localSql(`select set_config('request.jwt.claims','{"sub":"${owner}","role":"authenticated","aal":"aal1"}',true);
    select public.create_label_snapshot('${id}',${masked},'10x15','${fullNames[2]}','081377778888','Kota Asal',null)`);
}

test.afterAll(() => {
  if (created.length) {
    const ids = created.map((id) => `'${id}'`).join(",");
    localSql(`update public.shipments set selected_quote_id=null where id in (${ids}); delete from public.shipments where id in (${ids})`);
  }
});

declare global { interface Window { __trackingCopy: string } }
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.__trackingCopy = "";
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (text: string) => { window.__trackingCopy = text; } } });
  });
});

test("share, repeat share, anonymous privacy at 390 px, latest masking, revocation and re-share", async ({ page, browser, baseURL }, info) => {
  const id = seed();
  await signIn(page, "owner-a@geraiexpress.test");
  await page.goto(`/pengiriman/${id}`);
  await expect(page.getByRole("button", { name: "Kirim resi ke pelanggan", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Salin tautan", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__trackingCopy)).toMatch(/\/lacak\/[A-Za-z0-9_-]{43}$/);
  const link = await page.evaluate(() => window.__trackingCopy);
  expect(link).not.toContain("JP1234567890"); expect(link).not.toContain(id);
  await expect(page.getByText("Tautan sudah disiapkan untuk dibagikan.")).toBeVisible();
  await page.getByRole("button", { name: "Salin tautan", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Tautan tersalin." })).toBeVisible();
  expect(await page.evaluate(() => window.__trackingCopy)).toBe(link);

  // SITE_ORIGIN builds the share URL. Exercise the same path on the local apex audience,
  // exactly as hosts.spec.ts does; this also works when the configured share origin is shared loopback.
  const site = audienceUrl("site", baseURL!) ?? new URL(link).origin;
  const publicUrl = `${site}${new URL(link).pathname}`;
  const anon = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
  await actAsVisitor(anon, site, randomVisitorIp());
  const reader = await anon.newPage();
  try {
    const response = await reader.goto(publicUrl);
    expect(response?.status()).toBe(200);
    expect(response?.headers()["x-robots-tag"]).toContain("noindex");
    expect(response?.headers()["cache-control"]).toContain("private");
    expect(response?.headers()["cache-control"]).toContain("no-store");
    expect(response?.headers()["content-security-policy"]).toBeTruthy();
    expect(response?.headers()["set-cookie"]).toBeUndefined();
    expect(await anon.cookies()).toEqual([]);
    await expect(reader.getByRole("heading", { name: "Lacak pengiriman" })).toBeVisible();
    await expect(reader.getByRole("heading", { name: "Status belum tersedia" })).toBeVisible();
    await expect(reader.getByText("JP1234567890", { exact: true })).toBeVisible();
    await expect(reader.getByText("Disembunyikan", { exact: true })).toHaveCount(1);
    const gerai = localSql(`select name from public.tenants where id='${tenant}'`);
    expect(await reader.locator("body").innerText()).not.toContain(gerai);
    for (const value of privateValues) expect(await response!.text()).not.toContain(value);
    await expectNoHorizontalOverflow(reader);
    await reader.screenshot({ path: info.outputPath("tracking-no-snapshot-390.png"), fullPage: true });

    // Create immutable label versions through the real command. No snapshot => fail closed;
    // masked latest snapshot => printed sender initials, never the real pickup identity.
    label(id, true);
    await reader.reload();
    await expect(reader.getByText("N. C. T.", { exact: true })).toBeVisible();
    expect(await reader.locator("body").innerText()).not.toContain(gerai);
    for (const value of privateValues) expect(await reader.content()).not.toContain(value);
    await reader.screenshot({ path: info.outputPath("tracking-masked-390.png"), fullPage: true });

    // Unmasked creation needs the gerai WhatsApp; restore its previous value after the command.
    const before = localSql(`select coalesce(contact_whatsapp,'') from public.tenants where id='${tenant}'`);
    try {
      localSql(`update public.tenants set contact_whatsapp='081355550000' where id='${tenant}'`);
      label(id, false);
    } finally { localSql(`update public.tenants set contact_whatsapp=nullif('${before}','') where id='${tenant}'`); }
    await reader.reload();
    await expect(reader.getByText(gerai, { exact: true })).toBeVisible();
    for (const value of privateValues) expect(await reader.content()).not.toContain(value);
    await reader.screenshot({ path: info.outputPath("tracking-unmasked-390.png"), fullPage: true });
    await reader.setViewportSize({ width: 1280, height: 800 });
    await reader.screenshot({ path: info.outputPath("tracking-unmasked-1280.png"), fullPage: true });
    await reader.setViewportSize({ width: 390, height: 844 });

    await page.reload();
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Cabut tautan", exact: true }).click();
    await expect(page.getByText("Tautan telah dicabut. Bagikan lagi untuk membuat tautan baru.")).toBeVisible();
    expect((await reader.goto(publicUrl))?.status()).toBe(404);
    await expect(reader.getByRole("heading", { name: "Halaman tidak ditemukan" })).toBeVisible();
    await expect(reader.getByText("GeraiExpress · Lacak pengiriman")).toBeVisible();
    await expect(reader.getByRole("link", { name: "Ke beranda GeraiExpress" })).toHaveAttribute("href", "/");
    const revokedBody = await reader.content();
    expect((await reader.goto(`${site}/lacak/malformed`))?.status()).toBe(404);
    expect(await reader.content()).toBe(revokedBody);
    await reader.screenshot({ path: info.outputPath("tracking-revoked-390.png"), fullPage: true });
    await reader.setViewportSize({ width: 1280, height: 800 });
    await reader.screenshot({ path: info.outputPath("tracking-revoked-1280.png"), fullPage: true });
    await reader.setViewportSize({ width: 390, height: 844 });

    await page.getByRole("button", { name: "Salin tautan", exact: true }).click();
    // The reload above reset the stub to "", so wait for an actual new link, not merely "not the old one".
    await expect.poll(() => page.evaluate(() => window.__trackingCopy)).toMatch(/\/lacak\/[A-Za-z0-9_-]{43}$/);
    const nextLink = await page.evaluate(() => window.__trackingCopy);
    expect(nextLink).not.toBe(link);
    expect((await reader.goto(`${site}${new URL(nextLink).pathname}`))?.status()).toBe(200);
    expect((await reader.goto(publicUrl))?.status()).toBe(404);
  } finally { await anon.close(); }
});

test("a missing sender phone offers Salin pesan with a complete Bahasa message, never automated sending", async ({ page }) => {
  const id = seed(false);
  await signIn(page, "owner-a@geraiexpress.test");
  await page.goto(`/pengiriman/${id}`);
  await expect(page.getByRole("button", { name: "Kirim resi ke pelanggan", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Salin pesan", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__trackingCopy)).toContain("Lacak pengiriman:");
  const message = await page.evaluate(() => window.__trackingCopy);
  expect(message).toContain("JP1234567890"); expect(message).toContain("J&T Express REG");
  expect(message).toMatch(/\/lacak\/[A-Za-z0-9_-]{43}/);
  expect(message).not.toContain(fullNames[0]);
});
