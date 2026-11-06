// T-093 / DEC-024 (a): Super Admin customer-data review. Only `customer_data_review` sees the menu, the
// cross-gerai phone search and the per-gerai customer list; each read needs a reason and is audited.
import { randomUUID } from "node:crypto";
import { expect, test } from "./fixtures";
import { expectNoHorizontalOverflow, freshAdminCode, localSql, notFoundBodyText, signIn, signInAdmin } from "./helpers";

test.describe.configure({ mode: "serial" });

const ADMIN2 = "00000000-0000-4000-a000-0000000000f2";
const TENANT_A = "00000000-0000-4000-b000-00000000000a";
const TENANT_B = "00000000-0000-4000-b000-00000000000b";
const OWNER_A = "00000000-0000-4000-a000-0000000000a1";

function insertShipment(id: string, tenant: string, outlet: string, recipientPhone: string) {
  localSql(`insert into public.shipments (id, tenant_id, outlet_id, reference, created_by, sender_name, sender_phone,
      recipient_name, recipient_phone, recipient_address, recipient_area, item_description, weight_grams)
    values ('${id}', '${tenant}', '${outlet}', 'E2E093-${id.slice(0, 6)}', '${OWNER_A}', 'Pengirim E2E', '081200000099',
      'Penerima E2E ${id.slice(0, 4)}', '${recipientPhone}', 'Jl. E2E Pelanggan No. 3', 'Kota E2E', 'Buku', 500)`);
}

test("with the capability: menu, cross-gerai phone search with reason, per-gerai customer list, both audited", async ({ page }) => {
  test.setTimeout(90_000);
  const before = localSql(`select capabilities::text from public.platform_grants where user_id = '${ADMIN2}' and revoked_at is null`);
  const phone = `0818${String(Date.now()).slice(-8)}`;
  const a = randomUUID(), b = randomUUID();
  localSql(`update public.platform_grants set capabilities = array['platform_monitoring', 'customer_data_review'] where user_id = '${ADMIN2}' and revoked_at is null`);
  insertShipment(a, TENANT_A, "00000000-0000-4000-c000-00000000000a", phone);
  insertShipment(b, TENANT_B, "00000000-0000-4000-c000-00000000000b", `+62${phone.slice(1)}`);
  const reason = `Uji e2e pelanggan ${randomUUID().slice(0, 6)}`;
  // The phone (either form) must never appear in any URL the browser requests or navigates to.
  const urls: string[] = [];
  page.on("request", (r) => urls.push(r.url()));
  page.on("framenavigated", (f) => urls.push(f.url()));
  const readRows = () => Number(localSql(`select count(*) from public.audit_events where action like 'customer_data.%' and actor = '${ADMIN2}'`));
  try {
    await signInAdmin(page, "admin-2@geraiexpress.test");
    // Reached from the platform navigation (a drawer below 768 px; the icon rail from 768 px, T-079).
    if ((page.viewportSize()?.width ?? 1280) < 768) await page.getByRole("button", { name: "Buka menu" }).click();
    await page.getByRole("link", { name: "Data pelanggan", exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/pelanggan$/);
    await expect(page.getByRole("heading", { name: "Data pelanggan", level: 1 })).toBeVisible();
    await expectNoHorizontalOverflow(page);

    // The browser enforces the reason before anything is read. Baseline before any submission.
    const before = readRows();
    await page.getByLabel("Nomor HP pelanggan").fill(phone);
    await page.getByRole("button", { name: "Cari pelanggan" }).click();
    expect(await page.getByLabel(/Alasan membuka data pelanggan/).evaluate((el: HTMLTextAreaElement) => el.validity.valueMissing)).toBe(true);
    // Without a reason not one row is read: no profile on screen and no audited read.
    await expect(page.getByTestId("customer-profile")).toHaveCount(0);
    expect(readRows()).toBe(before);
    await page.getByLabel(/Alasan membuka data pelanggan/).fill(reason);
    await page.getByRole("button", { name: "Cari pelanggan" }).click();
    const profile = page.getByTestId("customer-profile");
    await expect(profile).toContainText(phone, { timeout: 20_000 });
    await expect(page.getByTestId("customer-totals")).toContainText("2");
    await expect(page.getByTestId("customer-gerai")).toHaveCount(2);
    await expect(page.getByTestId("customer-gerai").filter({ hasText: "Outlet Uji A" })).toBeVisible();

    await expectNoHorizontalOverflow(page);
    expect(localSql(`select count(*) from public.audit_events where action = 'customer_data.lookup' and reason = '${reason}'`)).toBe("1");

    // Per-gerai list from the gerai page.
    await page.getByTestId("customer-gerai").filter({ hasText: "Outlet Uji B" }).getByRole("link").click();
    await expect(page).toHaveURL(new RegExp(`/admin/pelanggan/${TENANT_B}$`));
    await expect(page.getByRole("heading", { name: "Data pelanggan gerai", level: 1 })).toBeVisible();
    // The per-gerai panel reads nothing until a reason is submitted.
    const beforePanel = readRows();
    await expect(page.getByTestId("tenant-customer")).toHaveCount(0);
    await page.getByRole("button", { name: "Buka data pelanggan" }).click();
    expect(await page.getByLabel(/Alasan membuka data pelanggan/).evaluate((el: HTMLTextAreaElement) => el.validity.valueMissing)).toBe(true);
    await expect(page.getByTestId("tenant-customer")).toHaveCount(0);
    expect(readRows()).toBe(beforePanel);
    await page.getByLabel(/Alasan membuka data pelanggan/).fill(`${reason} gerai`);
    await page.getByRole("button", { name: "Buka data pelanggan" }).click();
    await expect(page.getByTestId("tenant-customer").filter({ hasText: `E2E093-${b.slice(0, 6)}` })).toContainText(`+62${phone.slice(1)}`, { timeout: 20_000 });
    await expect(page.getByTestId("tenant-customers")).not.toContainText(`E2E093-${a.slice(0, 6)}`);
    await expectNoHorizontalOverflow(page);
    expect(localSql(`select count(*) from public.audit_events where action = 'customer_data.tenant_view' and reason = '${reason} gerai' and target_tenant = '${TENANT_B}'`)).toBe("1");
    // With monitoring as well, the gerai summary page carries the same audited panel.
    await page.goto(`/admin/tenant/${TENANT_A}`);
    await expect(page.getByRole("heading", { name: "Data pelanggan gerai ini" })).toBeVisible();
    await expect(page.getByTestId("tenant-customer")).toHaveCount(0);
    // POST only: neither form of the phone is in any requested or navigated URL.
    const digits = phone.slice(1);
    expect(urls.filter((u) => decodeURIComponent(u).replace(/[^0-9]/g, "").includes(digits))).toEqual([]);
  } finally {
    localSql(`update public.platform_grants set capabilities = '${before}'::text[] where user_id = '${ADMIN2}' and revoked_at is null;
      delete from public.shipments where id in ('${a}', '${b}')`);
  }
});

test("without the capability: no menu, the page is a plain 404 and the gerai page shows no customer panel", async ({ page }) => {
  await signInAdmin(page);
  await expect(page.getByRole("link", { name: "Data pelanggan" })).toHaveCount(0);
  // A plain not-found, identical to an unknown platform path: no hint that the page exists.
  const unknown = await page.goto("/admin/tidak-ada-halaman-ini");
  expect(unknown?.status()).toBe(404);
  const unknownTitle = await page.title();
  const unknownText = await notFoundBodyText(page);
  const response = await page.goto("/admin/pelanggan");
  expect(response?.status()).toBe(404);
  expect(await page.title()).toBe(unknownTitle);
  expect(await notFoundBodyText(page)).toBe(unknownText);
  await expect(page.getByLabel("Nomor HP pelanggan")).toHaveCount(0);
  // The per-gerai customer page is the same plain 404.
  const perGerai = await page.goto(`/admin/pelanggan/${TENANT_A}`);
  expect(perGerai?.status()).toBe(404);
  expect(await page.title()).toBe(unknownTitle);
  expect(await notFoundBodyText(page)).toBe(unknownText);
  await page.goto(`/admin/tenant/${TENANT_A}`);
  await expect(page.getByTestId("tenant-activity")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Data pelanggan gerai ini" })).toHaveCount(0);
});

// Review P1: the capability alone (no monitoring or governance) lands on the customer page, follows a
// gerai link to its customer list and pages through it; each page is one audited read with one reason.
test("customer_data_review alone: landing, gerai customer page and paging, one audited read per page", async ({ page }) => {
  test.setTimeout(120_000);
  const before = localSql(`select capabilities::text from public.platform_grants where user_id = '${ADMIN2}' and revoked_at is null`);
  const phone = `0817${String(Date.now()).slice(-8)}`;
  const ids = Array.from({ length: 22 }, () => randomUUID());
  const reason = `Uji e2e halaman ${randomUUID().slice(0, 6)}`;
  localSql(`update public.platform_grants set capabilities = array['customer_data_review'] where user_id = '${ADMIN2}' and revoked_at is null`);
  for (const id of ids) insertShipment(id, TENANT_B, "00000000-0000-4000-c000-00000000000b", phone);
  const audited = () => JSON.parse(localSql(`select coalesce(json_agg(json_build_object('reason', reason, 'offset', (detail->>'offset')::int) order by id), '[]')
    from public.audit_events where action = 'customer_data.tenant_view' and actor = '${ADMIN2}' and reason = '${reason}'`));
  try {
    await signIn(page, "admin-2@geraiexpress.test");
    await expect(page).toHaveURL(/\/verifikasi-2fa$/);
    await page.getByLabel("Kode 6 digit").fill(await freshAdminCode("admin-2@geraiexpress.test"));
    await page.getByRole("button", { name: "Verifikasi" }).click();
    // Landing: /admin redirects a capability-only administrator to the customer page.
    await expect(page).toHaveURL(/\/admin\/pelanggan$/);
    await page.getByLabel("Nomor HP pelanggan").fill(phone);
    await page.getByLabel(/Alasan membuka data pelanggan/).fill(`${reason} cari`);
    await page.getByRole("button", { name: "Cari pelanggan" }).click();
    await page.getByTestId("customer-gerai").filter({ hasText: "Outlet Uji B" }).getByRole("link").click();
    await expect(page).toHaveURL(new RegExp(`/admin/pelanggan/${TENANT_B}$`));
    await page.getByLabel(/Alasan membuka data pelanggan/).fill(reason);
    await page.getByRole("button", { name: "Buka data pelanggan" }).click();
    await expect(page.getByTestId("tenant-customer")).toHaveCount(20, { timeout: 20_000 });
    await expect(page.getByTestId("tenant-customers-count")).toContainText("Gerai Uji B");
    await page.getByRole("button", { name: /Muat berikutnya/ }).click();
    const total = Number(localSql(`select count(*) from public.shipments where tenant_id = '${TENANT_B}' and not is_simulated`));
    await expect(page.getByTestId("tenant-customer")).toHaveCount(Math.min(total, 40), { timeout: 20_000 });
    const refs = await page.getByTestId("tenant-customer").locator(".font-mono").allTextContents();
    expect(new Set(refs).size).toBe(refs.length);
    expect(audited()).toEqual([{ reason, offset: 0 }, { reason, offset: 20 }]);
    await expectNoHorizontalOverflow(page);
  } finally {
    localSql(`update public.platform_grants set capabilities = '${before}'::text[] where user_id = '${ADMIN2}' and revoked_at is null;
      delete from public.shipments where id in ('${ids.join("','")}')`);
  }
});
