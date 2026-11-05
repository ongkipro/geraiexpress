// T-094 / PR-34 / DEC-017. The intake stores an optional, length-limited sender address and can keep it on
// a saved sender contact; a masked label starts from the shipment's own sender and prints its address.
import { randomUUID } from "node:crypto";
import { expect, test } from "./fixtures";
import { chooseOption, expectNoHorizontalOverflow, localSql, sessionUserId, signIn, startDemo } from "./helpers";

const TENANT_A = "00000000-0000-4000-b000-00000000000a";
const OUTLET_A = "00000000-0000-4000-c000-00000000000a";
const OWNER_A = "00000000-0000-4000-a000-0000000000a1";
const created: string[] = [];

test.afterAll(() => {
  if (!created.length) return;
  const ids = created.map((i) => `'${i}'`).join(",");
  localSql(`update public.shipments set selected_quote_id = null where id in (${ids}); delete from public.shipments where id in (${ids})`);
  localSql(`update public.tenants set masking_allowed = true where id = '${TENANT_A}'`);
});

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { (window as unknown as { __prints: number }).__prints = 0; window.print = () => { (window as unknown as { __prints: number }).__prints++; }; });
});

test("the intake keeps a tidy sender address and saves it on the sender contact", async ({ page }) => {
  await startDemo(page);
  await page.goto("/pengiriman/baru");
  await page.getByRole("button", { name: "Mulai draf baru" }).click();
  const name = `Pengirim Alamat ${randomUUID().slice(0, 6)}`;
  await page.getByLabel("Nama pengirim").fill(name);
  await page.getByLabel("No. HP pengirim").fill("081277770001");
  const street = page.getByLabel("Alamat pengirim (opsional)");
  // The field stops at the printed limit and shows the remaining length while typing.
  await expect(street).toHaveAttribute("maxlength", "120");
  await street.fill("Jl. Kenanga No. 3");
  await expect(page.locator("#f-sender_address-hint")).toContainText("17/120 karakter");
  await expect(page.getByLabel("Kecamatan / kota pengirim")).toHaveAttribute("maxlength", "40");
  await page.getByLabel("Kecamatan / kota pengirim").fill("Kec. Coblong, Bandung");
  await page.getByLabel("Kode pos pengirim").fill("40132");
  await page.getByRole("checkbox", { name: "Simpan sebagai kontak pengirim" }).click();
  await page.getByRole("button", { name: "Simpan draf" }).click();
  await expect(page.getByText("Draf tersimpan.")).toBeVisible();
  await expect(street).toHaveValue("Jl. Kenanga No. 3");
  await expectNoHorizontalOverflow(page);

  // The saved sender contact keeps the address and fills it again in a new draft.
  await page.goto("/pengiriman/baru");
  await page.getByRole("button", { name: "Mulai draf baru" }).click();
  await page.getByLabel("Cari kontak tersimpan (nama atau nomor HP)").fill(name);
  await page.getByRole("button", { name: "Saring kontak" }).click();
  await expect(page.getByTestId("contact-search-status")).toBeVisible();
  await chooseOption(page, "Pilih pengirim tersimpan", `${name} · 081277770001`);
  await expect(page.getByLabel("Alamat pengirim (opsional)")).toHaveValue("Jl. Kenanga No. 3");
  await expect(page.getByLabel("Kecamatan / kota pengirim")).toHaveValue("Kec. Coblong, Bandung");
  await expect(page.getByLabel("Kode pos pengirim")).toHaveValue("40132");
});

test("switching to a sender contact without an address clears the previous sender's address", async ({ page }) => {
  await startDemo(page);
  // The demo gerai of THIS session (its own visitor), not any other demo.
  const tenant = localSql(`select tenant_id from public.memberships where user_id = '${await sessionUserId(page)}' and status = 'active' limit 1`);
  const withAddress = randomUUID(), withoutAddress = randomUUID(), tag = randomUUID().slice(0, 6);
  localSql(`insert into public.contacts (tenant_id, id, name, phone, is_sender) values
      ('${tenant}', '${withAddress}', 'Pengirim Beralamat ${tag}', '081277770101', true),
      ('${tenant}', '${withoutAddress}', 'Pengirim Tanpa Alamat ${tag}', '081277770102', true);
    insert into public.contact_addresses (tenant_id, contact_id, label, address_line, area, postal_code, is_primary)
      values ('${tenant}', '${withAddress}', 'Utama', 'Jl. Kenanga No. 3', 'Kec. Coblong', '40132', true);`);
  await page.goto("/pengiriman/baru");
  await page.getByRole("button", { name: "Mulai draf baru" }).click();
  await page.getByLabel("Cari kontak tersimpan (nama atau nomor HP)").fill(tag);
  await page.getByRole("button", { name: "Saring kontak" }).click();
  await expect(page.getByTestId("contact-search-status")).toBeVisible();
  await chooseOption(page, "Pilih pengirim tersimpan", `Pengirim Beralamat ${tag} · 081277770101`);
  await expect(page.getByLabel("Alamat pengirim (opsional)")).toHaveValue("Jl. Kenanga No. 3");
  await chooseOption(page, "Pilih pengirim tersimpan", `Pengirim Tanpa Alamat ${tag} · 081277770102`);
  await expect(page.getByLabel("Nama pengirim")).toHaveValue(`Pengirim Tanpa Alamat ${tag}`);
  await expect(page.getByLabel("Alamat pengirim (opsional)")).toHaveValue("");
  await expect(page.getByLabel("Kecamatan / kota pengirim")).toHaveValue("");
  await expect(page.getByLabel("Kode pos pengirim")).toHaveValue("");
});

test("saving a sender contact with a half-entered address names the missing field and saves nothing", async ({ page }) => {
  await startDemo(page);
  await page.goto("/pengiriman/baru");
  await page.getByRole("button", { name: "Mulai draf baru" }).click();
  const name = `Pengirim Separuh ${randomUUID().slice(0, 6)}`;
  await page.getByLabel("Nama pengirim").fill(name);
  await page.getByLabel("No. HP pengirim").fill("081277770201");
  await page.getByLabel("Alamat pengirim (opsional)").fill("Jl. Kenanga No. 3");
  await page.getByRole("checkbox", { name: "Simpan sebagai kontak pengirim" }).click();
  await page.getByRole("button", { name: "Simpan draf" }).click();
  await expect(page.getByText("Periksa isian yang ditandai.")).toBeVisible();
  await expect(page.getByLabel("Kecamatan / kota pengirim")).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByText(/Isi kecamatan \/ kota pengirim, atau kosongkan semua alamat pengirim/)).toBeVisible();
  // The entered street is kept on screen and no contact was created.
  await expect(page.getByLabel("Alamat pengirim (opsional)")).toHaveValue("Jl. Kenanga No. 3");
  expect(localSql(`select count(*) from public.contacts where name = '${name}'`)).toBe("0");
});

// An issued real shipment whose sender already has an address (synthetic data, no provider operation).
function issuedWithSender(): string {
  const id = randomUUID(), quote = randomUUID();
  created.push(id);
  localSql(`insert into public.shipments (tenant_id, outlet_id, id, reference, submission_state, payment_state, sender_name, sender_phone,
      sender_address, sender_area, recipient_name, recipient_phone, recipient_address, recipient_area, recipient_postal_code, item_description,
      weight_grams, is_simulated, created_by, submitted_at, issued_at, awb, pickup_snapshot)
    values ('${TENANT_A}', '${OUTLET_A}', '${id}', 'GERA-E2E094-${id.slice(0, 4).toUpperCase()}', 'issued', 'paid', 'Toko Pelanggan', '081311112222',
      'Jl. Kenanga No. 3', 'Kec. Coblong, Bandung', 'Penerima Uji', '081234567890', 'Jl. Tujuan Uji No. 9', 'Kec. Tujuan, Kota Uji', '40132', 'Buku',
      1500, false, '${OWNER_A}', now(), now(), 'JP0940000099',
      jsonb_build_object('outlet', 'Pickup Rahasia', 'address', 'Jl. Pickup Nyata No. 5', 'area', 'Kec. Pickup, Kota Nyata'));
    insert into public.shipment_quotes (tenant_id, shipment_id, id, shipment_revision, courier, service, normal_tariff_idr, eta_days, is_simulated, expires_at)
      values ('${TENANT_A}', '${id}', '${quote}', 1, 'JT', 'REG', 12000, '1-2', false, now() + interval '1 hour');
    update public.shipments set selected_quote_id = '${quote}' where id = '${id}';`);
  return id;
}

test("a masked label starts from the shipment's sender, prints its address, and refuses an over-long street", async ({ page }) => {
  localSql(`update public.tenants set masking_allowed = true where id = '${TENANT_A}'`);
  const id = issuedWithSender();
  await signIn(page, "operator-a@geraiexpress.test");
  await page.goto(`/pengiriman/${id}/label`);
  await page.getByRole("switch", { name: /Gunakan masking pengirim/ }).check();
  // T-084 / PR-46: JT has no recorded masking acceptance, so the masked print needs the acknowledgement.
  await page.getByRole("checkbox", { name: /Saya mengerti penerimaannya belum terverifikasi/ }).check();
  await expect(page.getByLabel("Nama pengirim")).toHaveValue("Toko Pelanggan");
  await expect(page.getByLabel("No. HP pengirim")).toHaveValue("081311112222");
  await expect(page.getByLabel("Alamat pengirim (opsional)")).toHaveValue("Jl. Kenanga No. 3");
  await expect(page.getByLabel("Kecamatan / kota pengirim")).toHaveValue("Kec. Coblong, Bandung");
  await expect(page.getByTestId("label-sender-place")).toHaveText("Jl. Kenanga No. 3, Kec. Coblong, Bandung");
  // The printed sender never falls back to the gerai pickup address.
  await expect(page.getByTestId("label-sender")).not.toContainText("Jl. Pickup Nyata No. 5");
  // The input stops at the printed limit, so the tidy label cannot overflow its block.
  await expect(page.getByLabel("Alamat pengirim (opsional)")).toHaveAttribute("maxlength", "120");
  await expectNoHorizontalOverflow(page);

  await page.getByRole("button", { name: /^(Cetak label|Cetak ulang label)$/ }).click();
  await expect(page.getByTestId("preview-source")).toContainText("Label tersimpan versi 1");
  const row = JSON.parse(localSql(`select row_to_json(s) from public.label_snapshots s where shipment_id = '${id}'`));
  expect(row).toMatchObject({
    mask_sender: true, printed_sender_name: "Toko Pelanggan", printed_sender_phone: "081311112222",
    printed_sender_address: "Jl. Kenanga No. 3", printed_sender_city: "Kec. Coblong, Bandung", true_pickup_address: "Jl. Pickup Nyata No. 5",
  });
  // Clearing the optional street prints without one (a new version), never the pickup address.
  await page.getByLabel("Alamat pengirim (opsional)").fill("");
  await expect(page.getByTestId("label-sender-place")).toHaveText("Kec. Coblong, Bandung");
  await page.getByRole("button", { name: /^(Cetak label|Cetak ulang label)$/ }).click();
  await expect(page.getByTestId("preview-source")).toContainText("Label tersimpan versi 2");
  expect(localSql(`select coalesce(printed_sender_address, '-') from public.label_snapshots where shipment_id = '${id}' and version = 2`)).toBe("-");
});
