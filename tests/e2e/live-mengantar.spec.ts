// T-023: a real gerai connected to the Mengantar SANDBOX quotes live. Opt-in, because it calls
// the sandbox with the Partner-registered sandbox seller's key (the key is typed into the local
// app like an admin would; it is never printed):
//   E2E_MENGANTAR_KEY_VAR=GERAIEXPRESS_MENGANTAR_SANDBOX_SELLER_KEY secrets-env run -- \
//     pnpm exec playwright test tests/e2e/live-mengantar.spec.ts
// The dev server must run with MENGANTAR_ENV=sandbox (pnpm dev:env).
import { expect, test } from "./fixtures";
import { expectNoHorizontalOverflow, expectTouchTargets, localSql, signIn } from "./helpers";

const keyVar = process.env.E2E_MENGANTAR_KEY_VAR ?? "";
const sellerKey = keyVar.startsWith("GERAIEXPRESS_MENGANTAR_SANDBOX_") ? process.env[keyVar] : undefined;
const OUTLET_A = "00000000-0000-4000-c000-00000000000a";

test.skip(!sellerKey, "set E2E_MENGANTAR_KEY_VAR to a sandbox seller key variable");

// Optional visual evidence: E2E_SHOT_DIR=<dir> saves full-page screenshots per viewport.
const shot = async (page: import("@playwright/test").Page, name: string) => {
  if (process.env.E2E_SHOT_DIR) await page.screenshot({ path: `${process.env.E2E_SHOT_DIR}/${test.info().project.name}-${name}.png`, fullPage: true });
};

test("a connected gerai picks its Mengantar pickup, searches the recipient area and gets live quotes", async ({ page }) => {
  test.setTimeout(120_000);
  const before = localSql(`select coalesce(pickup_address, '') || '|' || coalesce(pickup_area, '') from public.outlets where id = '${OUTLET_A}'`);
  const startedAt = localSql("select now()");
  try {
    await signIn(page, "owner-a@geraiexpress.test");
    await page.goto("/pengaturan");
    const keySection = page.getByRole("region", { name: "Akun Mengantar (kunci API sendiri)" });
    await keySection.getByLabel("Kunci API Mengantar").fill(sellerKey!);
    await keySection.getByRole("checkbox").check();
    await keySection.getByRole("button", { name: /Simpan kunci|Ganti kunci/ }).click();
    await expect(page.getByTestId("seller-key-status")).toBeVisible();
    await page.reload();

    // Reading the seller's pickup addresses with the key proves the connection.
    await expect(page.getByText(/Terhubung: kunci berakhiran/)).toBeVisible();
    const pickup = page.getByRole("region", { name: "Alamat pickup Mengantar" });
    await pickup.getByRole("radio", { name: /GeraiExpress Sandbox Uji/ }).check();
    await pickup.getByRole("button", { name: "Pakai alamat ini" }).click();
    await expect(pickup.getByRole("status")).toContainText("Alamat pickup diatur");
    await page.reload();
    const pickupRow = page.getByRole("listitem").filter({ hasText: /^Alamat pickup outlet/ });
    await expect(pickupRow).toContainText("MELAWAI");
    await expect(page.getByRole("listitem").filter({ hasText: /^Cek ongkir/ })).toContainText("Siap");
    await expect(page.getByRole("listitem").filter({ hasText: /^Penerbitan resi/ })).toContainText("Siap");
    await expectNoHorizontalOverflow(page);
    await shot(page, "settings");

    await page.goto("/pengiriman/baru");
    await page.getByRole("button", { name: "Mulai draf baru" }).click();
    await page.getByLabel("Nama pengirim").fill("Pengirim Live");
    await page.getByLabel("No. HP pengirim").fill("081200001111");
    await page.getByLabel("Nama penerima").fill("Penerima Live");
    await page.getByLabel("No. HP penerima").fill("081200002222");
    await page.getByLabel("Alamat lengkap").fill("Jl. Kapitan 1 RT 01/04");
    await page.getByLabel("Wilayah penerima").fill("sukatani");
    // exact: the mobile top bar also has "Cari pengiriman" (T-079).
    await page.getByRole("button", { name: "Cari", exact: true }).click();
    // T-072: the area picker is a combobox; results are listbox options.
    const option = page.getByRole("option", { name: /SUKATANI, TAPOS, DEPOK/ });
    await expect(option).toBeVisible();
    await option.click();
    await expect(page.getByTestId("area-chosen")).toContainText("SUKATANI, TAPOS, DEPOK");
    await expect(page.getByLabel("Kode pos penerima")).toHaveValue("16454");
    await shot(page, "area-picked");
    await page.getByLabel("Isi paket").fill("Dokumen uji");
    await page.getByLabel("Berat (gram)").fill("1000");
    await page.getByLabel("Nilai barang (Rp)").fill("50000");
    await expectNoHorizontalOverflow(page);
    await expectTouchTargets(page);

    await page.getByRole("button", { name: "Simpan & cek ongkir" }).click();
    await expect(page.getByText("Ongkir diperbarui.")).toBeVisible({ timeout: 30_000 });
    const services = page.getByRole("group", { name: "Pilih layanan" });
    await expect(services.getByRole("radio").first()).toBeAttached();
    await expect(services).not.toContainText("simulasi");
    await expect(services).not.toContainText("AnterAja");
    await expect(services).toContainText("J&T Express");
    await expect(services).not.toContainText(" days");
    await shot(page, "quotes");

    // The confirm dialog warns that this creates and pays a real Mengantar order.
    await services.getByRole("radio", { name: /J&T Express/ }).check({ force: true });
    await page.getByRole("button", { name: "Periksa & konfirmasi" }).click();
    await expect(page.getByTestId("live-issuance-warning")).toContainText("pesanan Mengantar sungguhan");
    await shot(page, "confirm");
    // The net provider cost never reaches the page.
    expect(await page.content()).not.toMatch(/net_shipping|netShipping/);

    // T-024: issue for real on one viewport only (each run creates one sandbox order). The
    // sandbox seller has no balance, so the order is created unpaid: no resi yet.
    if (test.info().project.name !== "desktop-1280") return;
    // T-081: confirmation now requires the content declaration (PR-41).
    await page.getByRole("checkbox", { name: "Pengirim menyatakan isi paket bukan barang terlarang" }).check();
    await page.getByRole("button", { name: "Konfirmasi & terbitkan resi" }).click();
    await expect(page.getByTestId("dispatch-result")).toBeVisible({ timeout: 45_000 });
    const result = await page.getByTestId("dispatch-result").innerText();
    expect(result).toMatch(/Resi Mengantar sudah terbit|saldo Mengantar belum cukup/);
    await expect(page.getByText(/ID pesanan Mengantar/)).toBeVisible();
    const shipmentPath = new URL(page.url()).pathname;
    if (/saldo/.test(result)) {
      await expect(page.getByText("Menunggu pembayaran").first()).toBeVisible();
      await page.getByRole("button", { name: "Periksa pembayaran" }).click();
      await expect(page.getByTestId("dispatch-info")).toContainText("belum menerima pembayaran");
    }
    await shot(page, "issued");
    // Confirming the same shipment again (back button, double submit) can never create a second order.
    const reference = (await page.getByRole("heading", { level: 1 }).innerText()).trim();
    expect(localSql(`select count(*) from public.provider_operations o join public.shipments s on s.id = o.shipment_id where s.reference = '${reference}'`)).toBe("1");
    await page.goto(shipmentPath);
    await expect(page.getByRole("button", { name: "Periksa & konfirmasi" })).toHaveCount(0);
  } finally {
    // Remove this run's local drafts/shipments from fixture tenant A (the sandbox order, if one
    // was created, stays at Mengantar's sandbox).
    localSql(`update public.shipments set selected_quote_id = null where tenant_id = '00000000-0000-4000-b000-00000000000a' and created_at >= '${startedAt}';
      delete from public.shipments where tenant_id = '00000000-0000-4000-b000-00000000000a' and created_at >= '${startedAt}'`);
    const [address, area] = before.split("|");
    localSql(`update public.outlets set mengantar_pickup_address_id = null, mengantar_area_id = null,
      pickup_address = nullif('${address.replace(/'/g, "''")}', ''), pickup_area = nullif('${area.replace(/'/g, "''")}', '')
      where id = '${OUTLET_A}';
      update private.seller_credentials set superseded_at = now(), ciphertext = null, iv = null
      where tenant_id = '00000000-0000-4000-b000-00000000000a' and superseded_at is null`);
  }
});
