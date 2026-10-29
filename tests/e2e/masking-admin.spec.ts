// T-053 / DEC-018 item 3 / PR-34 / UX-9: the Super Admin allows or disables sender masking per gerai.
// A fresh tenant is created with local superuser SQL (no provider in the loop) and removed afterwards.
import { randomUUID } from "node:crypto";
import { expect, test } from "./fixtures";
import { expectNoHorizontalOverflow, expectTouchTargets, localSql, signIn, signInAdmin } from "./helpers";

test("a Super Admin disables and re-allows masking for one gerai, with a required reason, visible result and audit", async ({ page }) => {
  test.setTimeout(90_000);
  const tenant = randomUUID();
  const name = `Gerai Masking ${tenant.slice(0, 6)}`;
  localSql(`insert into public.tenants (id, name, lifecycle, is_demo) values ('${tenant}', '${name}', 'active', false)`);
  const masking = () => localSql(`select masking_allowed from public.tenants where id = '${tenant}'`);
  try {
    await signInAdmin(page);
    await page.getByTestId("platform-tenant").filter({ hasText: name }).getByRole("link", { name: /Kontrol gerai/ }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/tenant/${tenant}$`));
    await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
    await expect(page.getByTestId("masking-state")).toContainText("Diizinkan");
    await expect(page.getByTestId("masking-last-change")).toContainText("Belum pernah diubah");
    await expectNoHorizontalOverflow(page);
    await expectTouchTargets(page);

    // The reason is required: the browser refuses an empty one and the database has not changed.
    const form = page.getByTestId("masking-form");
    await form.getByRole("button", { name: "Nonaktifkan masking" }).click();
    expect(await form.getByLabel("Alasan (dicatat di audit)").evaluate((el: HTMLTextAreaElement) => el.validity.valueMissing)).toBe(true);
    expect(masking()).toBe("t");
    // The refused click must not lock the button: typing a reason and clicking again at once submits
    // (the lock used to swallow clicks for 5 seconds after an invalid submit).
    await expect(form.getByRole("button", { name: "Nonaktifkan masking" })).not.toHaveAttribute("aria-disabled", "true");

    await form.getByLabel("Alasan (dicatat di audit)").fill("Uji e2e kurir menolak label");
    await form.getByRole("button", { name: "Nonaktifkan masking" }).click();
    await expect(page.getByTestId("masking-result")).toContainText("Masking pengirim dinonaktifkan");
    await expect(page.getByTestId("masking-state")).toContainText("Dinonaktifkan");
    await expect(page.getByTestId("masking-last-change")).toContainText("dinonaktifkan pada");
    expect(masking()).toBe("f");
    await expectNoHorizontalOverflow(page);

    // The flip button now offers the opposite action.
    await page.getByLabel("Alasan (dicatat di audit)").fill("Uji e2e diizinkan lagi");
    await page.getByRole("button", { name: "Izinkan masking" }).click();
    await expect(page.getByTestId("masking-result")).toContainText("Masking pengirim diizinkan");
    await expect(page.getByTestId("masking-state")).toContainText("Diizinkan");
    expect(masking()).toBe("t");

    // Audit visibility: link from the page, newest first, with actor, target and reason.
    await page.getByRole("link", { name: "Lihat audit izin masking" }).click();
    await expect(page).toHaveURL(/jenis=tenant\.masking/);
    const events = page.getByTestId("audit-event").filter({ hasText: name });
    await expect(events).toHaveCount(2);
    await expect(events.first()).toContainText("Izin masking pengirim · Diizinkan");
    await expect(events.first()).toContainText("Uji e2e diizinkan lagi");
    await expect(events.first()).toContainText("oleh admin@geraiexpress.test");
    await expect(events.last()).toContainText("Izin masking pengirim · Dinonaktifkan");
    await expect(events.last()).toContainText("Uji e2e kurir menolak label");
    await expectNoHorizontalOverflow(page);
  } finally {
    localSql(`delete from public.tenants where id = '${tenant}'`);
  }
});

test("the masking control is not reachable without tenant governance, and an unknown gerai is a plain 404", async ({ page }) => {
  await signIn(page, "owner-b@geraiexpress.test");
  for (const path of [`/admin/tenant/${randomUUID()}`, "/admin/tenant/not-a-uuid"]) {
    expect((await page.goto(path))?.status(), path).toBe(404);
  }
  await page.context().clearCookies();
  await signInAdmin(page, "admin-2@geraiexpress.test");
  expect((await page.goto(`/admin/tenant/${randomUUID()}`))?.status()).toBe(404);
  expect((await page.goto("/admin/tenant/not-a-uuid"))?.status()).toBe(404);
});
