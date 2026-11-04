// T-098 (IAM-7): a Super Admin without a page's capability gets a plain 404 indistinguishable from an
// unknown /admin path: status, tab title and body text. Before T-098 the page's static `metadata`
// export still rendered its own title after notFound(), revealing that the page exists.
import { expect, test } from "./fixtures";
import { freshAdminCode, localSql, signIn, signInAdmin } from "./helpers";

const ADMIN2 = "00000000-0000-4000-a000-0000000000f2";
const TENANT_A = "00000000-0000-4000-b000-00000000000a";

// Every capability-gated page, with the capabilities that open it (any of them).
const PAGES: { path: string; title: string; opens: string[] }[] = [
  { path: "/admin/konfigurasi", title: "Konfigurasi · Super Admin", opens: ["tenant_governance", "integration_operations"] },
  { path: "/admin/integrasi", title: "Integrasi Mengantar · Super Admin", opens: ["integration_operations"] },
  { path: "/admin/audit", title: "Audit · Super Admin", opens: ["audit_review"] },
  { path: `/admin/tenant/${TENANT_A}`, title: "Detail gerai · Super Admin", opens: ["tenant_governance", "platform_monitoring"] },
  { path: "/admin/pantau-pengajuan", title: "Pengajuan menunggu · Super Admin", opens: ["platform_monitoring", "tenant_governance"] },
  { path: "/admin/pengajuan", title: "Pengajuan gerai · Super Admin", opens: ["tenant_governance"] },
  { path: "/admin/diskon", title: "Diskon gerai · Super Admin", opens: ["integration_operations"] },
  { path: `/admin/diskon/${TENANT_A}`, title: "Atur diskon gerai · Super Admin", opens: ["integration_operations"] },
  { path: "/admin/akses", title: "Akses Super Admin", opens: ["access_governance"] },
  { path: "/admin/pelanggan", title: "Data pelanggan · Super Admin", opens: ["customer_data_review"] },
  { path: `/admin/pelanggan/${TENANT_A}`, title: "Data pelanggan gerai · Super Admin", opens: ["customer_data_review"] },
];

test("a refused capability answers every gated page with the plain 404 (status, title, body); a held one shows its title", async ({ page }) => {
  test.setTimeout(150_000);
  const before = localSql(`select capabilities::text from public.platform_grants where user_id = '${ADMIN2}' and revoked_at is null`);
  // Holds only audit_review: every other page is refused; the audit page itself is the positive control.
  localSql(`update public.platform_grants set capabilities = array['audit_review'] where user_id = '${ADMIN2}' and revoked_at is null`);
  try {
    // An audit-only administrator is redirected from /admin to /admin/audit after the second factor.
    await signIn(page, "admin-2@geraiexpress.test");
    await expect(page).toHaveURL(/\/verifikasi-2fa$/);
    await page.getByLabel("Kode 6 digit").fill(await freshAdminCode("admin-2@geraiexpress.test"));
    await page.getByRole("button", { name: "Verifikasi" }).click();
    await expect(page).toHaveURL(/\/admin\/audit$/);
    const unknown = await page.goto("/admin/tidak-ada-halaman-ini");
    expect(unknown?.status()).toBe(404);
    const unknownTitle = await page.title();
    const unknownText = await page.locator("body").innerText();
    for (const target of PAGES) {
      const response = await page.goto(target.path);
      if (target.opens.includes("audit_review")) {
        expect(response?.status(), target.path).toBe(200);
        expect(await page.title(), target.path).toBe(`${target.title} · GeraiExpress`);
        continue;
      }
      expect(response?.status(), target.path).toBe(404);
      expect(await page.title(), target.path).toBe(unknownTitle);
      expect(await page.locator("body").innerText(), target.path).toBe(unknownText);
    }
  } finally {
    localSql(`update public.platform_grants set capabilities = '${before}'::text[] where user_id = '${ADMIN2}' and revoked_at is null`);
  }
});

// Review P1: the scenario above holds audit_review, so /admin/audit is refused here instead: a grant
// without it (monitoring only) gets the same plain 404 there, while its own monitoring pages still open.
test("a grant without audit_review gets the plain 404 on /admin/audit too", async ({ page }) => {
  test.setTimeout(150_000);
  const before = localSql(`select capabilities::text from public.platform_grants where user_id = '${ADMIN2}' and revoked_at is null`);
  localSql(`update public.platform_grants set capabilities = array['platform_monitoring'] where user_id = '${ADMIN2}' and revoked_at is null`);
  try {
    await signInAdmin(page, "admin-2@geraiexpress.test");
    const unknown = await page.goto("/admin/tidak-ada-halaman-ini");
    expect(unknown?.status()).toBe(404);
    const unknownTitle = await page.title();
    const unknownText = await page.locator("body").innerText();
    const audit = await page.goto("/admin/audit");
    expect(audit?.status()).toBe(404);
    expect(await page.title()).toBe(unknownTitle);
    expect(await page.locator("body").innerText()).toBe(unknownText);
    // Positive control for this grant: a monitoring page opens with its own title.
    const own = PAGES.find((p) => p.path === "/admin/pantau-pengajuan")!;
    expect((await page.goto(own.path))?.status()).toBe(200);
    expect(await page.title()).toBe(`${own.title} · GeraiExpress`);
  } finally {
    localSql(`update public.platform_grants set capabilities = '${before}'::text[] where user_id = '${ADMIN2}' and revoked_at is null`);
  }
});

test("with every capability each gated page keeps its own title", async ({ page }) => {
  test.setTimeout(150_000);
  const before = localSql(`select capabilities::text from public.platform_grants where user_id = '${ADMIN2}' and revoked_at is null`);
  localSql(`update public.platform_grants set capabilities = array['tenant_governance', 'platform_monitoring', 'integration_operations',
    'access_governance', 'audit_review', 'customer_data_review'] where user_id = '${ADMIN2}' and revoked_at is null`);
  try {
    await signInAdmin(page, "admin-2@geraiexpress.test");
    for (const target of PAGES) {
      const response = await page.goto(target.path);
      expect(response?.status(), target.path).toBe(200);
      expect(await page.title(), target.path).toBe(`${target.title} · GeraiExpress`);
    }
  } finally {
    localSql(`update public.platform_grants set capabilities = '${before}'::text[] where user_id = '${ADMIN2}' and revoked_at is null`);
  }
});
