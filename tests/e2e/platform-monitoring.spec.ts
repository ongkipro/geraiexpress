// T-092 / DEC-024: Super Admin monitoring overview, searchable/paged directory and per-gerai summary.
// Monitoring-only administrators read everything here but get no write control.
import { randomUUID } from "node:crypto";
import { expect, test } from "./fixtures";
import { expectNoHorizontalOverflow, localSql, signIn, signInAdmin } from "./helpers";

test("the overview and directory show aggregates, search and filter; the per-gerai page shows activity without customer data", async ({ page }) => {
  await signInAdmin(page);
  await expect(page.getByTestId("platform-overview")).toBeVisible();
  const active = localSql("select count(*) from public.tenants where not is_demo and lifecycle = 'active'");
  await expect(page.getByTestId("ov-active")).toContainText(active);
  await expectNoHorizontalOverflow(page);

  // Drill-down: the "Hasil belum pasti" signal lists exactly the gerai that have one.
  await page.getByTestId("ov-unknown").getByRole("link").click();
  await expect(page).toHaveURL(/perhatian=unknown/);
  await expect(page.getByTestId("attention-filter")).toContainText("Ada hasil belum pasti");
  const unknownTenants = Number(localSql(`select count(distinct s.tenant_id) from public.shipments s join public.tenants t on t.id = s.tenant_id
    where not t.is_demo and not s.is_simulated and s.submission_state = 'unknown'`));
  await expect(page.getByTestId("platform-tenant")).toHaveCount(Math.min(unknownTenants, 25));
  // Searching keeps the operational filter.
  await page.getByLabel("Cari gerai (nama atau slug)").fill("zzz-tidak-ada");
  await page.getByRole("button", { name: "Cari", exact: true }).click();
  await expect(page).toHaveURL(/perhatian=unknown/);
  await expect(page).toHaveURL(/q=zzz-tidak-ada/);
  await expect(page.getByTestId("attention-filter")).toBeVisible();
  await page.getByRole("link", { name: "Hapus saringan" }).click();
  await expect(page).not.toHaveURL(/perhatian=/);
  await page.goto("/admin");

  await page.getByLabel("Cari gerai (nama atau slug)").fill("Uji A");
  await page.getByRole("button", { name: "Cari", exact: true }).click();
  await expect(page).toHaveURL(/q=Uji\+A/);
  await expect(page.getByTestId("platform-tenant").filter({ hasText: "Gerai Uji A" })).toBeVisible();
  await expect(page.getByTestId("platform-tenant").filter({ hasText: "Gerai Uji C" })).toHaveCount(0);

  await page.getByTestId("platform-tenant").filter({ hasText: "Gerai Uji A" }).getByRole("link", { name: /Kontrol gerai/ }).click();
  await expect(page.getByRole("heading", { name: "Gerai Uji A", level: 1 })).toBeVisible();
  await expect(page.getByTestId("tenant-activity")).toContainText("30 hari terakhir");
  await expect(page.getByRole("heading", { name: "Cabang dan pickup" })).toBeVisible();
  // Aggregates only: no recipient name from this gerai's shipments appears on the page.
  const recipient = localSql("select recipient_name from public.shipments where tenant_id = '00000000-0000-4000-b000-00000000000a' and recipient_name is not null limit 1");
  if (recipient) await expect(page.getByRole("main")).not.toContainText(recipient);
  await expect(page.getByRole("heading", { name: "Masking pengirim di label" })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("a monitoring-only Super Admin reads overview and summary but gets no lifecycle, registration or masking controls", async ({ page }) => {
  const ADMIN2 = "00000000-0000-4000-a000-0000000000f2";
  const before = localSql(`select capabilities::text from public.platform_grants where user_id = '${ADMIN2}' and revoked_at is null`);
  localSql(`update public.platform_grants set capabilities = array['platform_monitoring'] where user_id = '${ADMIN2}' and revoked_at is null`);
  // One submitted application with a known phone, so the drill-down has a row and the phone check bites.
  const user = randomUUID(), app = randomUUID();
  localSql(`insert into auth.users (id, email, email_confirmed_at) values ('${user}', 'e2e-mon-${app.slice(0, 8)}@geraiexpress.test', now());
    insert into public.tenant_applications (id, applicant, status, business_name, outlet_name, pickup_address, pickup_area, contact_phone, submitted_at)
    values ('${app}', '${user}', 'submitted', 'Toko Pantau ${app.slice(0, 6)}', 'Outlet Pantau', 'Jl. Rahasia Pantau No. 9', 'Kec. Pantau, Kota E2E', '081299990077', now())`);
  try {
    await signIn(page, "admin-2@geraiexpress.test");
    await expect(page).toHaveURL(/\/verifikasi-2fa$/);
    const { FIXTURE_TOTP, totp } = await import("../totp");
    // Accepted window is previous/current/next step; pick the oldest unused one (same rule as signInAdmin).
    const last = Number(localSql(`select coalesce(max(f.last_used_step), -1) from auth.mfa_factors f where f.user_id = '${ADMIN2}'`));
    let usable: number[] = [];
    for (;;) {
      const now = Math.floor(Date.now() / 30_000);
      usable = [now - 1, now, now + 1].filter((c) => c > last);
      if (usable.length) break;
      await page.waitForTimeout(1000);
    }
    await page.getByLabel("Kode 6 digit").fill(totp(FIXTURE_TOTP["admin-2@geraiexpress.test"], usable[0] * 30_000));
    await page.getByRole("button", { name: "Verifikasi" }).click();
    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByTestId("platform-overview")).toBeVisible();
    await expect(page.getByTestId("platform-tenant").first()).toBeVisible();
    await expect(page.getByRole("button", { name: /^Bekukan|^Aktifkan kembali/ })).toHaveCount(0);
    await expect(page.getByTestId("registration-state")).toHaveCount(0);
    // Pending applications drill down to a read-only list without contact data; the review page stays 404.
    const submitted = Number(localSql("select count(*) from public.tenant_applications where status = 'submitted'"));
    await expect(page.getByTestId("ov-applications")).toContainText(String(submitted));
    await page.getByTestId("ov-applications").getByRole("link").click();
    await expect(page).toHaveURL(/\/admin\/pantau-pengajuan$/);
    await expect(page.getByTestId("pending-application")).toHaveCount(submitted);
    await expect(page.getByTestId("pending-application").filter({ hasText: "Toko Pantau" })).toBeVisible();
    await expect(page.getByRole("main")).not.toContainText("081299990077");
    await expect(page.getByRole("main")).not.toContainText("Jl. Rahasia Pantau");
    await expect(page.getByRole("button", { name: /Setujui|Tolak|Minta perbaikan/ })).toHaveCount(0);
    expect((await page.goto("/admin/pengajuan"))?.status()).toBe(404);
    await page.goto("/admin");
    await page.getByTestId("platform-tenant").filter({ hasText: "Gerai Uji A" }).getByRole("link", { name: /Kontrol gerai/ }).click();
    await expect(page.getByTestId("tenant-activity")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Masking pengirim di label" })).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
  } finally {
    localSql(`update public.platform_grants set capabilities = '${before}'::text[] where user_id = '${ADMIN2}' and revoked_at is null`);
    localSql(`delete from public.tenant_applications where id = '${app}'; delete from auth.users where id = '${user}'`);
  }
});

test("a gerai member cannot reach the platform overview", async ({ page }) => {
  await signIn(page, "owner-a@geraiexpress.test");
  const response = await page.goto("/admin");
  expect(response?.status()).toBe(404);
});
