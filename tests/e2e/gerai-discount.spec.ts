// T-041 / PR-23 / UX-12: the Super Admin gerai-discount screen in a real browser. Tenants and quotes
// are created with local superuser SQL (there is no provider in the loop) and removed afterwards.
import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { expectNoHorizontalOverflow, expectTouchTargets, localSql, signIn, signInAdmin } from "./helpers";

const OWNER_A = "00000000-0000-4000-a000-0000000000a1";
const ADMIN = "00000000-0000-4000-a000-0000000000f1";

function createTenant(name: string, observed: { tariff: number; net: number } | null) {
  const tenant = randomUUID();
  const outlet = randomUUID();
  const shipment = randomUUID();
  localSql(`insert into public.tenants (id, name, lifecycle, is_demo) values ('${tenant}', '${name}', 'active', false);
    insert into public.outlets (tenant_id, id, name) values ('${tenant}', '${outlet}', 'Outlet Diskon');
    insert into public.shipments (tenant_id, outlet_id, id, reference, submission_state, recipient_name, recipient_phone,
      recipient_address, recipient_area_id, item_description, weight_grams, goods_value_idr, is_simulated, created_by)
      values ('${tenant}', '${outlet}', '${shipment}', 'GXE-${randomUUID().slice(0, 8)}', 'estimated', 'Penerima Uji', '081234567890',
      'Jl. Uji 1', '5fc63169f8f44b34aa4c2ee1', 'Dokumen', 1000, 50000, false, '${OWNER_A}')`);
  if (observed) addQuote(tenant, shipment, observed.tariff, observed.net, 5);
  return { tenant, shipment };
}

function addQuote(tenant: string, shipment: string, tariff: number, net: number, minutesAgo: number) {
  const quote = randomUUID();
  localSql(`insert into public.shipment_quotes (tenant_id, shipment_id, id, shipment_revision, courier, service, normal_tariff_idr,
      eta_days, is_simulated, quoted_at, expires_at)
      values ('${tenant}', '${shipment}', '${quote}', 1, 'JT', 'Reguler', ${tariff}, '1-2', false, now() - interval '${minutesAgo} minutes', now() + interval '1 hour');
    insert into private.quote_costs (tenant_id, quote_id, net_shipping_idr) values ('${tenant}', '${quote}', ${net})`);
}

// One estimate: every courier row shares one quoted_at (a single statement = one now()).
function addBatch(tenant: string, shipment: string, rows: { courier: string; tariff: number; net: number }[]) {
  const withId = rows.map((r) => ({ ...r, id: randomUUID() }));
  localSql(`insert into public.shipment_quotes (tenant_id, shipment_id, id, shipment_revision, courier, service, normal_tariff_idr,
      eta_days, is_simulated, quoted_at, expires_at) values ${withId
        .map((r) => `('${tenant}', '${shipment}', '${r.id}', 1, '${r.courier}', 'Reguler', ${r.tariff}, '1-2', false, now() - interval '3 minutes', now() + interval '1 hour')`)
        .join(",")};
    insert into private.quote_costs (tenant_id, quote_id, net_shipping_idr) values ${withId.map((r) => `('${tenant}', '${r.id}', ${r.net})`).join(",")}`);
}

function removeTenants(ids: string[]) {
  const list = ids.map((id) => `'${id}'`).join(",");
  // Terms are append-only: delete them with user triggers off for one transaction, then the tenants.
  localSql(`begin; set local session_replication_role = replica;
    delete from public.gerai_discount_terms where tenant_id in (${list});
    commit; delete from public.tenants where id in (${list})`);
}

async function openTenant(page: Page, name: string) {
  await page.goto("/admin/diskon");
  await page.getByTestId("discount-tenant").filter({ hasText: name }).getByRole("link", { name: /Atur diskon/ }).click();
  await expect(page.getByRole("heading", { name: `Diskon gerai: ${name}` })).toBeVisible();
}

async function fillForm(page: Page, v: { percent: string; source: string; reason: string; status?: string; verification?: string }) {
  await page.getByLabel("Diskon gerai (%)").fill(v.percent);
  if (v.status) await page.getByLabel("Status nilai").selectOption(v.status);
  if (v.verification) await page.getByLabel("Referensi konfirmasi tertulis Mengantar").fill(v.verification);
  await page.getByLabel("Referensi sumber").fill(v.source);
  await page.getByLabel("Alasan (dicatat di audit)").fill(v.reason);
}

const created: string[] = [];
test.afterAll(() => {
  if (created.length) removeTenants(created.splice(0));
});

test("people without a platform grant get a plain not-found on the discount screens", async ({ page }) => {
  await signIn(page, "owner-c@geraiexpress.test");
  for (const path of ["/admin/diskon", `/admin/diskon/${randomUUID()}`]) {
    expect((await page.goto(path))?.status(), path).toBe(404);
  }
});

test("a Super Admin assigns versioned terms; above-observed values are blocked; variance and history show", async ({ page }) => {
  test.setTimeout(90_000); // one long flow: sign-in with TOTP, four saves, two refusals, audit
  const name = `Gerai Diskon ${randomUUID().slice(0, 6)}`;
  const { tenant, shipment } = createTenant(name, { tariff: 23000, net: 18400 }); // observed 20,00%
  created.push(tenant);

  await signInAdmin(page);
  // Reached from the platform navigation (a drawer below 768 px; the icon rail from 768 px, T-079).
  if ((page.viewportSize()?.width ?? 1280) < 768) await page.getByRole("button", { name: "Buka menu" }).click();
  await page.getByRole("link", { name: "Diskon gerai", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/diskon$/);
  await expect(page.getByTestId("discount-template")).toContainText("Templat default");
  await expect(page.getByTestId("discount-tenant").filter({ hasText: name })).toContainText("Belum ada diskon gerai.");

  await openTenant(page, name);
  await expect(page.getByTestId("discount-none")).toBeVisible();
  await expect(page.getByTestId("variance-observed")).toContainText("20,00%");
  await expect(page.getByTestId("variance-assigned")).toContainText("belum ditetapkan");
  await expect(page.getByTestId("remainder-estimate")).toHaveText("belum diketahui");
  await expect(page.getByTestId("variance-difference")).toHaveText("belum diketahui");
  await expect(page.getByText("Selisih ini tidak ditagihkan dan tidak ditanggung GeraiExpress")).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await expectTouchTargets(page);

  // Blocked above the observed discount, with the numbers filled in; no way to review it.
  await fillForm(page, { percent: "25", source: "Pernyataan pemilik 2026-10-28", reason: "Uji e2e penetapan" });
  await expect(page.getByTestId("discount-blocked")).toContainText("Diskon gerai 25,00% melebihi diskon Mengantar tertinggi yang teramati (20,00%)");
  await expect(page.getByTestId("discount-blocked")).toContainText("tidak dapat disimpan");
  await expect(page.getByRole("button", { name: "Tinjau & simpan" })).toBeDisabled();

  // A valid value goes through the confirmation, then saves as version 1 and is audited.
  await page.getByLabel("Diskon gerai (%)").fill("17,5");
  await expect(page.getByTestId("discount-blocked")).toHaveCount(0);
  await page.getByRole("button", { name: "Tinjau & simpan" }).click();
  const confirm = page.getByRole("dialog");
  await expect(confirm).toContainText(name);
  await expect(confirm).toContainText("belum ada");
  await expect(confirm).toContainText("17,50% (Pernyataan pemilik)");
  await expect(confirm).toContainText("Uji e2e penetapan");
  await confirm.getByRole("button", { name: "Simpan versi" }).click();
  await expect(page.getByTestId("discount-saved")).toContainText("Versi 1 disimpan");
  await expect(page.getByTestId("discount-current-percent")).toHaveText("17,50%");
  await expect(page.getByTestId("remainder-estimate")).toHaveText("2,50 poin (perkiraan)");
  await expect(page.getByTestId("variance-difference")).toHaveText("2,50 poin");
  await expect(page.getByTestId("discount-version")).toHaveCount(1);
  await expect(page.getByTestId("discount-current")).toContainText("Nilai ini pernyataan pemilik dan belum diverifikasi Mengantar.");

  // A newer, lower observation appears after the page was loaded: the database refuses and the
  // screen explains it with the fresh numbers; the typed values stay.
  addQuote(tenant, shipment, 10000, 9000, 1); // observed 10,00%
  await fillForm(page, { percent: "15", source: "Pernyataan pemilik 2026-10-29", reason: "Uji e2e lampaui teramati" });
  await page.getByRole("button", { name: "Tinjau & simpan" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Simpan versi" }).click();
  await expect(page.getByTestId("discount-error")).toContainText("Diskon gerai 15,00% melebihi diskon Mengantar tertinggi yang teramati (10,00%)");
  await expect(page.getByLabel("Diskon gerai (%)")).toHaveValue("15");
  await expect(page.getByLabel("Alasan (dicatat di audit)")).toHaveValue("Uji e2e lampaui teramati");
  await expect(page.getByTestId("discount-version")).toHaveCount(1);

  // Another administrator saves version 2 meanwhile: the stale screen reloads and keeps the reason.
  localSql(`insert into public.gerai_discount_terms (tenant_id, version, gerai_discount_bps, effective_from, source_reference, status, created_by)
    values ('${tenant}', 1, 500, date_trunc('day', now() at time zone 'Asia/Jakarta') at time zone 'Asia/Jakarta', 'Admin lain, uji e2e', 'owner_stated', '${ADMIN}')`);
  await page.getByLabel("Diskon gerai (%)").fill("5");
  await page.getByRole("button", { name: "Tinjau & simpan" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Simpan versi" }).click();
  await expect(page.getByTestId("discount-error")).toContainText("Versi diskon berubah sejak halaman dibuka");
  await expect(page.getByLabel("Alasan (dicatat di audit)")).toHaveValue("Uji e2e lampaui teramati");
  await expect(page.getByTestId("discount-version")).toHaveCount(2);
  await expect(page.getByTestId("discount-current-percent")).toHaveText("5,00%");
  await expect(page.getByTestId("variance-observed")).toContainText("10,00%");
  await expect(page.getByTestId("remainder-estimate")).toHaveText("5,00 poin (perkiraan)");
  // Submitting again now uses the reloaded version and succeeds.
  await page.getByLabel("Diskon gerai (%)").fill("8");
  await page.getByRole("button", { name: "Tinjau & simpan" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Simpan versi" }).click();
  await expect(page.getByTestId("discount-saved")).toContainText("Versi 3 disimpan");
  await expect(page.getByTestId("discount-version")).toHaveCount(3);
  await expect(page.getByTestId("discount-version").first()).toContainText("Versi 3 · 8,00%");
  // The save dialog fades out after the action; measure only once it is gone.
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
  await expectTouchTargets(page);

  await page.goto("/admin/audit?jenis=discount.terms");
  const event = page.getByTestId("audit-event").filter({ hasText: "Uji e2e penetapan" }).first();
  await expect(event).toContainText("oleh admin@geraiexpress.test");
  await expect(event).toContainText(`Target: ${name}`);
  await expect(event).toContainText("Versi 1: belum ada → 17,50%");
});

test("with no observed discount the value is held as pending and unknown stays unknown; verification needs a typed reference", async ({ page }) => {
  const name = `Gerai Diskon ${randomUUID().slice(0, 6)}`;
  const { tenant } = createTenant(name, null);
  created.push(tenant);

  await signInAdmin(page, "admin-2@geraiexpress.test");
  await openTenant(page, name);
  await expect(page.getByTestId("variance-observed")).toContainText("tidak diketahui");
  await expect(page.getByTestId("variance-observed")).not.toContainText("0,00%");
  await expect(page.getByTestId("discount-pending-note")).toContainText("Diskon Mengantar belum teramati; diskon gerai ditahan sebagai menunggu.");

  await fillForm(page, { percent: "20", source: "Pernyataan pemilik 2026-10-28", reason: "Uji e2e tanpa pengamatan" });
  await page.getByRole("button", { name: "Tinjau & simpan" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Simpan versi" }).click();
  await expect(page.getByTestId("discount-saved")).toContainText("Versi 1 disimpan");
  await expect(page.getByTestId("discount-unverified")).toBeVisible();
  await expect(page.getByTestId("remainder-estimate")).toHaveText("belum diketahui");

  // Terverifikasi Mengantar shows an extra field that must be typed; the browser refuses it empty.
  await page.getByLabel("Status nilai").selectOption("provider_verified");
  const verification = page.getByLabel("Referensi konfirmasi tertulis Mengantar");
  await expect(verification).toBeVisible();
  await page.getByLabel("Referensi sumber").fill("Surel Mengantar 2026-11-02");
  await page.getByLabel("Alasan (dicatat di audit)").fill("Uji e2e verifikasi");
  await page.getByRole("button", { name: "Tinjau & simpan" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await verification.evaluate((el: HTMLInputElement) => el.validity.valueMissing)).toBe(true);
  await verification.fill("Surel Mengantar no. 7781, 2026-11-02");
  await page.getByRole("button", { name: "Tinjau & simpan" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Simpan versi" }).click();
  await expect(page.getByTestId("discount-saved")).toContainText("Versi 2 disimpan");
  await expect(page.getByTestId("discount-current")).toContainText("Terverifikasi Mengantar");
  await expect(page.getByTestId("discount-version").first()).toContainText("Konfirmasi tertulis: Surel Mengantar no. 7781, 2026-11-02");
});

test("couriers differ: the ceiling is the highest courier, each courier is listed, and the Teramati status needs an exact match", async ({ page }) => {
  test.setTimeout(90_000);
  const name = `Gerai Diskon ${randomUUID().slice(0, 6)}`;
  const { tenant, shipment } = createTenant(name, null);
  created.push(tenant);
  // One estimate answered by two couriers that genuinely differ: J&T 30,00% and SAP 7,15%.
  addBatch(tenant, shipment, [{ courier: "JT", tariff: 10000, net: 7000 }, { courier: "Sap", tariff: 7000, net: 6500 }]);

  await signInAdmin(page, "admin-2@geraiexpress.test");
  await page.goto("/admin/diskon");
  await expect(page.getByTestId("discount-tenant").filter({ hasText: name }).getByTestId("discount-couriers")).toContainText("J&T Express 30,00% · SAP Express 7,15%");
  await openTenant(page, name);
  await expect(page.getByTestId("variance-observed")).toContainText("30,00%");
  const observations = page.getByTestId("observation");
  await expect(observations).toHaveCount(2);
  await expect(observations.filter({ hasText: "J&T Express" })).toContainText("30,00%");
  await expect(observations.filter({ hasText: "SAP Express" })).toContainText("7,15%");
  await expect(page.getByTestId("variance-rule")).toContainText("tidak pernah memakai diskon lebih besar dari diskon kurir itu sendiri");
  await expectNoHorizontalOverflow(page);

  // Above the highest courier is blocked; the courier-specific value is not the ceiling.
  await fillForm(page, { percent: "30,01", source: "Estimasi Mengantar", reason: "Uji e2e batas tertinggi" });
  await expect(page.getByTestId("discount-blocked")).toContainText("melebihi diskon Mengantar tertinggi yang teramati (30,00%)");
  // The Teramati status must equal the highest observed value exactly.
  await fillForm(page, { percent: "29", status: "provider_observed", source: "Estimasi Mengantar", reason: "Uji e2e status teramati" });
  await expect(page.getByTestId("discount-observed-mismatch")).toContainText("sama persis");
  await expect(page.getByRole("button", { name: "Tinjau & simpan" })).toBeDisabled();
  await page.getByLabel("Diskon gerai (%)").fill("30");
  await expect(page.getByTestId("discount-observed-mismatch")).toHaveCount(0);
  await page.getByRole("button", { name: "Tinjau & simpan" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Simpan versi" }).click();
  await expect(page.getByTestId("discount-saved")).toContainText("Versi 1 disimpan");
  await expect(page.getByTestId("discount-current")).toContainText("Teramati dari Mengantar");
  await expect(page.getByTestId("remainder-estimate")).toHaveText("0,00 poin (perkiraan)");
});

// T-053 / R3: the gerai-facing cost for tenant administrators only. Fixture tenant A; the terms are
// inserted in the past (user triggers off for one transaction) so quotes recorded now fall under them.
const TENANT_A = "00000000-0000-4000-b000-00000000000a";
const OUTLET_A = "00000000-0000-4000-c000-00000000000a";

function seedTermsA(bps: number) {
  const id = randomUUID();
  localSql(`begin; set local session_replication_role = replica;
    insert into public.gerai_discount_terms (id, tenant_id, version, gerai_discount_bps, effective_from, source_reference, status, created_by, created_at)
    select '${id}', '${TENANT_A}', coalesce(max(version), 0) + 1, ${bps}, now() - interval '1 day', 'Uji e2e T-053', 'owner_stated', '${ADMIN}', now() - interval '1 day'
    from public.gerai_discount_terms where tenant_id = '${TENANT_A}';
    commit`);
  return id;
}

function removeTermsA(id: string) {
  localSql(`begin; set local session_replication_role = replica; delete from public.gerai_discount_terms where id = '${id}'; commit`);
}

// A real shipment of tenant A with two non-simulated quotes: JT (tariff 23000, net 18400) and JNE (net unknown).
function seedShipmentA(state: "estimated" | "issued") {
  const shipment = randomUUID(), jt = randomUUID(), jne = randomUUID();
  const issued = state === "issued";
  localSql(`insert into public.shipments (tenant_id, outlet_id, id, reference, submission_state, payment_state, is_simulated,
      sender_name, sender_phone, recipient_name, recipient_phone, recipient_address, recipient_area, recipient_area_id,
      recipient_postal_code, weight_grams, item_description, goods_value_idr, customer_charge_idr, pickup_snapshot,
      submitted_at, awb, created_by)
      values ('${TENANT_A}', '${OUTLET_A}', '${shipment}', 'GXE-${randomUUID().slice(0, 8)}', '${state}', '${issued ? "paid" : "not_applicable"}', false,
      'Pengirim Uji', '081234567890', 'Penerima T053', '081298765432', 'Jl. Uji 1', 'KEBAYORAN BARU', '5fc63169f8f44b34aa4c2ee1',
      '12110', 1000, 'Paket T053', 50000, 23000, ${issued ? `'{"outlet":"Outlet Uji A","handover":"dropoff"}'::jsonb` : "null"},
      ${issued ? "now()" : "null"}, ${issued ? "'E2EAWB0053'" : "null"}, '${OWNER_A}');
    insert into public.shipment_quotes (tenant_id, shipment_id, id, shipment_revision, courier, service, normal_tariff_idr,
      eta_days, is_simulated, quoted_at, expires_at) values
      ('${TENANT_A}', '${shipment}', '${jt}', 1, 'JT', 'Reguler', 23000, '1-2', false, now(), now() + interval '1 hour'),
      ('${TENANT_A}', '${shipment}', '${jne}', 1, 'JNE', 'Reguler', 24000, '1-2', false, now(), now() + interval '1 hour');
    insert into private.quote_costs (tenant_id, quote_id, net_shipping_idr, provider_discount_bps) values
      ('${TENANT_A}', '${jt}', 18400, 2000), ('${TENANT_A}', '${jne}', null, null)
    ${issued ? `; update public.shipments set selected_quote_id = '${jt}' where id = '${shipment}'` : ""}`);
  return {
    shipment,
    cleanup: () => localSql(`update public.shipments set selected_quote_id = null where id = '${shipment}'; delete from public.shipments where id = '${shipment}'`),
  };
}

test("a tenant admin sees the gerai cost basis with its explanation; unknown shows 'belum diketahui'; operators never see it (T-053)", async ({ page }) => {
  test.setTimeout(90_000);
  const estimated = seedShipmentA("estimated");
  const issued = seedShipmentA("issued");
  let terms: string | null = null;
  try {
    await signIn(page, "owner-a@geraiexpress.test");
    // No assigned discount yet: unknown, never Rp0.
    await page.goto(`/pengiriman/${estimated.shipment}`);
    const panel = page.getByTestId("gerai-cost-panel");
    await expect(panel).toContainText("Biaya gerai (estimasi)");
    await expect(panel.getByTestId("gerai-cost-value")).toHaveText(["belum diketahui", "belum diketahui"]);
    await expect(panel).not.toContainText(/Rp\s*0(?!\.)/);

    terms = seedTermsA(2000);
    await page.reload();
    const rows = page.getByTestId("gerai-cost-row");
    await expect(rows.filter({ hasText: "J&T Express" }).getByTestId("gerai-cost-value")).toHaveText(/Rp\s*18\.400/);
    // net cost unknown for JNE: still unknown with terms assigned
    await expect(rows.filter({ hasText: "JNE" }).getByTestId("gerai-cost-value")).toHaveText("belum diketahui");
    await expect(panel).toContainText("diskon yang ditetapkan GeraiExpress");
    await expect(panel).toContainText("bukan tagihan");
    await expect(panel).toContainText("tarif akun penjual");
    await expectNoHorizontalOverflow(page);
    await expectTouchTargets(page);

    // Issued summary.
    await page.goto(`/pengiriman/${issued.shipment}`);
    await expect(page.getByTestId("gerai-cost-issued")).toHaveText(/Rp\s*18\.400/);
    await expect(page.getByText("Biaya gerai (estimasi)")).toBeVisible();
    await expectNoHorizontalOverflow(page);

    // The queue (sender-facing list) never mentions it.
    await page.goto("/pengiriman");
    await expect(page.locator("body")).not.toContainText("Biaya gerai");

    // An operator of the same gerai sees neither the panel nor the summary row.
    await page.context().clearCookies();
    await signIn(page, "operator-a@geraiexpress.test");
    for (const id of [estimated.shipment, issued.shipment]) {
      await page.goto(`/pengiriman/${id}`);
      await expect(page.getByTestId("gerai-cost-panel")).toHaveCount(0);
      await expect(page.getByTestId("gerai-cost-issued")).toHaveCount(0);
      await expect(page.locator("body")).not.toContainText("Biaya gerai");
      await expect(page.locator("body")).not.toContainText("18.400");
    }
  } finally {
    estimated.cleanup();
    issued.cleanup();
    if (terms) removeTermsA(terms);
  }
});

test("settings show the assigned gerai discount and its effective date to tenant admins only (T-053)", async ({ page }) => {
  let terms: string | null = null;
  try {
    await signIn(page, "owner-a@geraiexpress.test");
    await page.goto("/pengaturan");
    await expect(page.getByTestId("gerai-discount-none")).toContainText("Belum ada diskon gerai");
    terms = seedTermsA(1750);
    await page.reload();
    const card = page.getByTestId("gerai-discount-card");
    await expect(card.getByTestId("gerai-discount-percent")).toHaveText("17,50%");
    await expect(card.getByTestId("gerai-discount-effective")).toContainText("WIB");
    await expect(card).toContainText("Pernyataan pemilik");
    await expect(card).toContainText("bukan tagihan");
    // Nothing about the observed discount or the remainder is shown to the gerai.
    await expect(card).not.toContainText(/teramati|selisih|sisa/i);
    await expectNoHorizontalOverflow(page);
    await expectTouchTargets(page);

    await page.context().clearCookies();
    await signIn(page, "operator-a@geraiexpress.test");
    await page.goto("/pengaturan");
    await expect(page.getByTestId("gerai-discount-card")).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText("17,50%");
  } finally {
    if (terms) removeTermsA(terms);
  }
});
