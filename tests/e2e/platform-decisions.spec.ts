// T-077 / UX-6 / UI-4: Super Admin states and decisions end to end, through the dialogs. Fixture tenants,
// applicants and applications are created with local superuser SQL and removed in afterAll, so the
// suspended and provisioning gerai never reach another spec. The tests share fixtures: run serially.
import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { actAsVisitor, expect, randomVisitorIp, test } from "./fixtures";
import { expectNoHorizontalOverflow, expectTouchTargets, localSql, signInAdmin } from "./helpers";

// One administrator session for the whole file (one TOTP sign-in instead of one per test); the replay
// guard can still make that sign-in wait for the next 30-second step.
test.describe.configure({ mode: "serial", timeout: 90_000 });
let page: Page;

const tag = randomUUID().slice(0, 6);
const SUSPENDED = { id: randomUUID(), name: `Gerai Beku ${tag}` };
const PROVISIONING = { id: randomUUID(), name: `Gerai Disiapkan ${tag}` };
const APPROVE = { user: randomUUID(), app: randomUUID(), name: `Toko Setuju ${tag}` };
const REJECT = { user: randomUUID(), app: randomUUID(), name: `Toko Tolak ${tag}` };

function addApplication(a: { user: string; app: string; name: string }) {
  localSql(`insert into auth.users (id, email, email_confirmed_at) values ('${a.user}', 'e2e-${a.app.slice(0, 8)}@geraiexpress.test', now());
    insert into public.tenant_applications (id, applicant, status, business_name, outlet_name, pickup_address, pickup_area, contact_phone, submitted_at)
    values ('${a.app}', '${a.user}', 'submitted', '${a.name}', 'Outlet Uji Keputusan', 'Jl. Uji Keputusan No. 7', 'Kec. Uji, Kota E2E', '081234560077', now())`);
}

test.beforeAll(async ({ browser }) => {
  // Admin sign-in can wait for the account budget window and a fresh TOTP step after earlier specs
  // used admin-2 (T-091/T-092 specs added several), which can exceed the default 30 s hook budget.
  test.setTimeout(150_000);
  localSql(`insert into public.tenants (id, name, lifecycle, is_demo) values
    ('${SUSPENDED.id}', '${SUSPENDED.name}', 'suspended', false),
    ('${PROVISIONING.id}', '${PROVISIONING.name}', 'provisioning', false)`);
  addApplication(APPROVE);
  addApplication(REJECT);
  const use = test.info().project.use;
  const context = await browser.newContext({ baseURL: use.baseURL, viewport: use.viewport, hasTouch: use.hasTouch });
  await actAsVisitor(context, use.baseURL!, randomVisitorIp());
  page = await context.newPage();
  await signInAdmin(page, "admin-2@geraiexpress.test");
});

test.afterAll(async () => {
  await page?.context().close();
  // An approval created a tenant for its applicant: remove it with the fixtures, then the applicants
  // (their applications and memberships cascade). Audit events stay; they are append-only by design.
  const users = `'${APPROVE.user}', '${REJECT.user}'`;
  localSql(`delete from public.tenants where id in ('${SUSPENDED.id}', '${PROVISIONING.id}')
      or id in (select tenant_id from public.tenant_applications where applicant in (${users}) and tenant_id is not null);
    delete from auth.users where id in (${users});
    update private.settings set value = 'true' where key = 'registration_open'`);
});

const count = (sql: string) => Number(localSql(sql));

test("the overview leads with what needs attention and shows suspended and provisioning gerai", async () => {
  await page.goto("/admin");
  await expect(page.getByTestId("platform-scope").first()).toHaveText("Platform");

  const suspended = count(`select count(*) from public.tenants where lifecycle = 'suspended' and not is_demo`);
  const pending = count(`select count(*) from public.tenant_applications where status = 'submitted'`);
  await expect(page.getByTestId("stat-suspended")).toContainText(String(suspended));
  await expect(page.getByTestId("stat-suspended")).toContainText("Lihat daftar");
  await expect(page.getByTestId("stat-applications")).toContainText(String(pending));
  await expect(page.getByTestId("stat-applications")).toContainText("Perlu ditinjau");

  const frozen = page.getByTestId("platform-tenant").filter({ hasText: SUSPENDED.name });
  await expect(frozen.getByText("Dibekukan", { exact: true })).toBeVisible();
  await expect(frozen.getByRole("button", { name: `Aktifkan kembali ${SUSPENDED.name}` })).toBeVisible();
  // A gerai still being set up has a status but no lifecycle action.
  const setup = page.getByTestId("platform-tenant").filter({ hasText: PROVISIONING.name });
  await expect(setup.getByText("Menunggu persetujuan", { exact: true })).toBeVisible();
  await expect(setup.getByRole("button")).toHaveCount(0);
  await expect(setup.getByRole("link", { name: `Kontrol gerai ${PROVISIONING.name}` })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await expectTouchTargets(page);

  // The stat filters the directory to the exception.
  await page.getByTestId("stat-suspended").click();
  await expect(page).toHaveURL(/\/admin\?status=suspended$/);
  await expect(page.getByRole("navigation", { name: "Filter status gerai" }).getByRole("link", { name: /^Dibekukan/ })).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("platform-tenant")).toHaveCount(suspended);
  await expect(page.getByTestId("platform-tenant").filter({ hasText: PROVISIONING.name })).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
});

test("reactivating needs a reason in the dialog, and the audit shows readable detail rows with the JSON behind a toggle", async () => {
  await page.goto("/admin");
  const row = page.getByTestId("platform-tenant").filter({ hasText: SUSPENDED.name });
  await row.getByRole("button", { name: `Aktifkan kembali ${SUSPENDED.name}` }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: `Aktifkan kembali ${SUSPENDED.name}?` })).toBeVisible();
  await expect(dialog).toContainText("Anggota gerai bisa kembali memakai ruang kerjanya.");
  await dialog.getByRole("button", { name: "Aktifkan kembali" }).click();
  expect(await dialog.getByLabel("Alasan (dicatat di audit)").evaluate((el: HTMLTextAreaElement) => el.validity.valueMissing)).toBe(true);
  const reason = `Uji e2e aktif ${tag}`;
  await dialog.getByLabel("Alasan (dicatat di audit)").fill(reason);
  await dialog.getByRole("button", { name: "Aktifkan kembali" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(row.getByText("Aktif", { exact: true })).toBeVisible();

  await page.goto("/admin/audit?jenis=tenant.lifecycle");
  // A decision type selects its category tab.
  await expect(page.getByRole("navigation", { name: "Kategori keputusan" }).getByRole("link", { name: "Gerai", exact: true })).toHaveAttribute("aria-current", "page");
  const event = page.getByTestId("audit-event").filter({ hasText: reason });
  await expect(event).toHaveCount(1);
  await expect(event).toContainText("Status gerai · Aktif");
  await expect(event).toContainText(`Target: ${SUSPENDED.name}`);
  await expect(event).toContainText("suspended → active");
  const rows = event.locator("dl > div");
  await expect(rows.first()).toBeHidden();
  await event.getByText("Rincian perubahan").click();
  await expect(rows.filter({ hasText: "Sebelum" })).toContainText("Dibekukan (suspended)");
  await expect(rows.filter({ hasText: "Sesudah" })).toContainText("Aktif (active)");
  const json = event.locator("pre");
  await expect(json).toBeHidden();
  await event.getByText("Lihat JSON asli").click();
  await expect(json).toContainText('"from": "suspended"');
  await expect(json).toContainText('"to": "active"');
  await expectNoHorizontalOverflow(page);

  // The search narrows the list by reason, and an empty result offers to clear the filter.
  await page.getByLabel("Cari").fill(reason);
  await page.getByRole("button", { name: "Terapkan" }).click();
  await expect(page).toHaveURL(/q=/);
  await expect(page.getByTestId("audit-event")).toHaveCount(1);
  await page.getByLabel("Cari").fill(`tidak-ada-${tag}`);
  await page.getByRole("button", { name: "Terapkan" }).click();
  await expect(page.getByText("Tidak ada keputusan yang cocok")).toBeVisible();
  await expect(page.getByRole("link", { name: "Hapus filter" }).first()).toBeVisible();
});

test("an application is approved through the dialog with a required reason", async () => {
  await page.goto("/admin/pengajuan");
  await page.getByTestId("application").filter({ hasText: APPROVE.name }).getByRole("link").click();
  await expect(page).toHaveURL(new RegExp(`id=${APPROVE.app}`));
  const detail = page.getByTestId("application-detail");
  await expect(detail.getByRole("heading", { name: APPROVE.name })).toBeVisible();
  await expect(detail).toContainText("Jl. Uji Keputusan No. 7");
  await expect(detail.getByRole("group", { name: `Keputusan untuk ${APPROVE.name}` }).getByRole("button")).toHaveCount(3);
  await expectNoHorizontalOverflow(page);
  await expectTouchTargets(page);

  await detail.getByRole("button", { name: `Setujui ${APPROVE.name}` }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: `Setujui: ${APPROVE.name}?` })).toBeVisible();
  await expect(dialog).toContainText("Tidak ada akun Mengantar yang dibuat.");
  // Cancelling decides nothing.
  await dialog.getByRole("button", { name: "Batal" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(localSql(`select status from public.tenant_applications where id = '${APPROVE.app}'`)).toBe("submitted");

  await detail.getByRole("button", { name: `Setujui ${APPROVE.name}` }).click();
  await dialog.getByRole("button", { name: "Setujui" }).click();
  expect(await dialog.getByLabel("Alasan (dicatat di audit)").evaluate((el: HTMLTextAreaElement) => el.validity.valueMissing)).toBe(true);
  expect(localSql(`select status from public.tenant_applications where id = '${APPROVE.app}'`)).toBe("submitted");
  await dialog.getByLabel("Alasan (dicatat di audit)").fill("Uji e2e data lengkap");
  await dialog.getByRole("button", { name: "Setujui" }).click();

  await expect(page).toHaveURL(/status=approved&keputusan=approve/);
  await expect(page.getByRole("status").filter({ hasText: /Disetujui\. Gerai aktif/ })).toBeVisible();
  await expect(page.getByTestId("application").filter({ hasText: APPROVE.name })).toContainText("Uji e2e data lengkap");
  expect(localSql(`select a.status || ' ' || t.lifecycle from public.tenant_applications a join public.tenants t on t.id = a.tenant_id where a.id = '${APPROVE.app}'`)).toBe("approved active");

  await page.goto("/admin");
  await expect(page.getByTestId("platform-tenant").filter({ hasText: APPROVE.name }).getByText("Aktif", { exact: true })).toBeVisible();
});

test("an application is rejected through the dialog with a required reason", async () => {
  await page.goto(`/admin/pengajuan?status=submitted&id=${REJECT.app}`);
  const detail = page.getByTestId("application-detail");
  await detail.getByRole("button", { name: `Tolak ${REJECT.name}` }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: `Tolak: ${REJECT.name}?` })).toBeVisible();
  await expect(dialog).toContainText("Pemohon melihat alasannya.");
  await dialog.getByRole("button", { name: "Tolak" }).click();
  expect(await dialog.getByLabel("Alasan (dicatat di audit)").evaluate((el: HTMLTextAreaElement) => el.validity.valueMissing)).toBe(true);
  await dialog.getByLabel("Alasan (dicatat di audit)").fill("Uji e2e bukan usaha pengiriman");
  await dialog.getByRole("button", { name: "Tolak" }).click();

  await expect(page).toHaveURL(/status=rejected&keputusan=reject/);
  await expect(page.getByRole("status").filter({ hasText: "Pengajuan ditolak." })).toBeVisible();
  const rejected = page.getByTestId("application").filter({ hasText: REJECT.name });
  await expect(rejected).toContainText("Uji e2e bukan usaha pengiriman");
  expect(localSql(`select status || ' ' || coalesce(tenant_id::text, 'tanpa-gerai') from public.tenant_applications where id = '${REJECT.app}'`)).toBe("rejected tanpa-gerai");
  // The detail of a decided application offers no further decision.
  await rejected.getByRole("link").click();
  await expect(page.getByTestId("application-detail").getByText("Ditolak", { exact: true })).toBeVisible();
  await expect(page.getByTestId("application-detail").getByRole("button", { name: /Setujui|Tolak/ })).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
});

test("the registration switch asks for confirmation, states the effect and needs a reason", async () => {
  localSql(`update private.settings set value = 'true' where key = 'registration_open'`);
  await page.goto("/admin");
  const toggle = page.getByRole("switch", { name: "Pendaftaran publik" });
  await expect(toggle).toHaveAttribute("aria-checked", "true");

  // Flipping only opens the confirmation; cancelling leaves the gate as it was.
  await toggle.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Tutup pendaftaran?" })).toBeVisible();
  await expect(dialog).toContainText("Pendaftar baru tidak bisa mengajukan gerai.");
  await expectNoHorizontalOverflow(page);
  await dialog.getByRole("button", { name: "Batal" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await expect(page.getByTestId("registration-state")).toContainText("Terbuka");

  await toggle.click();
  await dialog.getByRole("button", { name: "Tutup pendaftaran" }).click();
  expect(await dialog.getByLabel("Alasan (dicatat di audit)").evaluate((el: HTMLTextAreaElement) => el.validity.valueMissing)).toBe(true);
  await dialog.getByLabel("Alasan (dicatat di audit)").fill(`Uji e2e tutup ${tag}`);
  await dialog.getByRole("button", { name: "Tutup pendaftaran" }).click();
  await expect(page.getByTestId("registration-state")).toContainText("Tertutup");
  await expect(toggle).toHaveAttribute("aria-checked", "false");

  // Reopening warns about the code email first.
  await toggle.click();
  await expect(dialog.getByRole("heading", { name: "Buka pendaftaran?" })).toBeVisible();
  await expect(dialog).toContainText("Buka hanya setelah pengiriman email kode (SMTP) terbukti sampai ke inbox.");
  await dialog.getByLabel("Alasan (dicatat di audit)").fill(`Uji e2e buka ${tag}`);
  await dialog.getByRole("button", { name: "Buka pendaftaran" }).click();
  await expect(page.getByTestId("registration-state")).toContainText("Terbuka");
  await expect(toggle).toHaveAttribute("aria-checked", "true");
});
