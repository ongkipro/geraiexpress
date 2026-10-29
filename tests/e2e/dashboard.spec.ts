import { randomUUID } from "node:crypto";
import { expect, test } from "./fixtures";
import { atDashboard, expectNoHorizontalOverflow, expectTouchTargets, localSql, signIn, startDemo } from "./helpers";

// T-078 / UX-16: the Dashboard at "/" — numbers equal the database, computed in WIB, for a busy and an empty gerai.
// The seeded rows live in Gerai Uji C (owner-c, a tenant admin of a gerai without Mengantar, pickup or
// WhatsApp) and are removed by the test that created them.

const TENANT_C = "00000000-0000-4000-b000-00000000000c";
const OUTLET_C = "00000000-0000-4000-c000-00000000000c";
const OWNER_C = "00000000-0000-4000-a000-0000000000e1";
const tag = randomUUID().slice(0, 6).toUpperCase();
const WIB_MS = 7 * 3_600_000;
const DAY_MS = 86_400_000;

const STATES = ["issued", "issued", "draft", "estimated", "awaiting_payment", "failed", "unknown", "queued", "issued", "in_flight"];
const COURIERS = ["JT", "JNE", "SiCepat"];

// 00:00 WIB of today, as an instant.
function wibMidnight(now = Date.now()) {
  return Math.floor((now + WIB_MS) / DAY_MS) * DAY_MS - WIB_MS;
}

// ~40 shipments over the last 30 WIB days, with rows 30 s on each side of today's WIB midnight.
function seed() {
  const midnight = wibMidnight();
  const instants: number[] = [midnight + 30_000, midnight - 30_000, midnight + 60_000, midnight - 60_000];
  for (let i = 0; i < 36; i++) instants.push(midnight - (i % 30) * DAY_MS + 3_600_000 * (1 + (i % 5)));
  const sql = instants.map((at, i) => {
    const id = randomUUID(), quote = randomUUID();
    const state = STATES[i % STATES.length];
    // A row seeded "later today" than now would be in the future: keep every instant in the past.
    const created = new Date(Math.min(at, Date.now() - 5_000 - i)).toISOString();
    const issued = state === "issued";
    const withQuote = state !== "draft";
    return `insert into public.shipments (tenant_id, outlet_id, id, reference, submission_state, payment_state, recipient_name, is_cod,
        customer_charge_idr, awb, issued_at, created_by, created_at, updated_at)
      values ('${TENANT_C}', '${OUTLET_C}', '${id}', 'DASH-E2E-${tag}-${String(i).padStart(2, "0")}', '${state}',
        '${state === "awaiting_payment" ? "unpaid" : issued ? "paid" : "not_applicable"}', 'Penerima ${i}', ${issued && i % 3 === 0},
        ${withQuote ? 15000 + i * 100 : "null"}, ${issued ? `'JP${tag}${i}'` : "null"}, ${issued ? `'${created}'` : "null"}, '${OWNER_C}', '${created}', '${created}');`
      + (withQuote
        ? `insert into public.shipment_quotes (tenant_id, shipment_id, id, shipment_revision, courier, service, normal_tariff_idr, eta_days, is_simulated, expires_at)
             values ('${TENANT_C}', '${id}', '${quote}', 1, '${COURIERS[i % 3]}', 'REG', ${15000 + i * 100}, '1-2', false, now() + interval '1 hour');
           update public.shipments set selected_quote_id = '${quote}' where id = '${id}';`
        : "");
  }).join("\n");
  localSql(sql);
}

function cleanup() {
  localSql(`update public.shipments set selected_quote_id = null where tenant_id = '${TENANT_C}' and reference like 'DASH-E2E-${tag}-%';
    delete from public.shipments where tenant_id = '${TENANT_C}' and reference like 'DASH-E2E-${tag}-%'`);
}

// Database truth for gerai C, with days as WIB calendar days.
const T0 = `(date_trunc('day', now() at time zone 'Asia/Jakarta') at time zone 'Asia/Jakarta')`;
const countC = (where: string) => Number(localSql(`select count(*) from public.shipments where tenant_id = '${TENANT_C}' and ${where}`));
const signedText = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : "0");

test("a busy gerai: every Dashboard figure equals the database, the period stays in the URL", async ({ page }) => {
  test.setTimeout(120_000);
  seed();
  try {
    await signIn(page, "owner-c@geraiexpress.test");
    // UX-16 (1): the Dashboard at "/" is the landing after sign-in and keeps the scope visible.
    await expect(page).toHaveURL(atDashboard);
    await expect(page.getByRole("heading", { name: "Dashboard", level: 1 })).toBeVisible();
    await expect(page).toHaveTitle(/^Dashboard/);
    await expect(page.getByTestId("dashboard-scope")).toHaveText("Gerai Uji C · Outlet Uji C");
    await expect(page.getByTestId("dashboard-date")).toContainText("WIB");

    const today = { created: countC(`created_at >= ${T0}`), issued: countC(`created_at >= ${T0} and submission_state = 'issued'`) };
    const yesterday = {
      created: countC(`created_at >= ${T0} - interval '1 day' and created_at < ${T0}`),
      issued: countC(`created_at >= ${T0} - interval '1 day' and created_at < ${T0} and submission_state = 'issued'`),
    };
    expect(today.created).toBeGreaterThan(0);
    const stat = (key: string) => page.getByTestId(`stat-${key}`);
    await expect(stat("created-today").getByTestId("stat-value")).toHaveText(String(today.created));
    await expect(stat("created-today").getByTestId("stat-delta")).toHaveText(signedText(today.created - yesterday.created));
    await expect(stat("issued-today").getByTestId("stat-value")).toHaveText(String(today.issued));
    await expect(stat("issued-today").getByTestId("stat-delta")).toHaveText(signedText(today.issued - yesterday.issued));
    await expect(stat("awaiting").getByTestId("stat-value")).toHaveText(String(countC(`submission_state = 'awaiting_payment'`)));
    await expect(stat("drafts").getByTestId("stat-value")).toHaveText(String(countC(`submission_state = 'draft'`)));
    // Each count opens the matching filtered list.
    await expect(stat("awaiting")).toHaveAttribute("href", "/pengiriman?status=awaiting_payment");
    await expect(stat("drafts")).toHaveAttribute("href", "/pengiriman?status=draft");
    await expect(stat("issued-today")).toHaveAttribute("href", /^\/pengiriman\?status=issued&from=\d{4}-\d{2}-\d{2}&to=\d{4}-\d{2}-\d{2}$/);

    const attention = countC(`submission_state in ('unknown', 'failed', 'awaiting_payment', 'queued', 'in_flight')`);
    await expect(page.getByTestId("attention-count")).toHaveText(`Jumlah: ${attention}`);
    await expect(page.getByTestId("dashboard-attention").getByRole("link", { name: /Periksa/ }).first()).toHaveAttribute("href", /^\/pengiriman\/[0-9a-f-]{36}$/);

    // The trend (default 14 days): the stat, the data table, the status composition and the courier ranking agree.
    const period = async (days: number) => {
      const total = countC(`created_at >= ${T0} - interval '${days - 1} days'`);
      const trend = page.getByTestId("dashboard-trend");
      await expect(trend.getByTestId("trend-total")).toHaveText(String(total));
      await expect(trend.getByTestId("trend-issued")).toHaveText(String(countC(`created_at >= ${T0} - interval '${days - 1} days' and submission_state = 'issued'`)));
      await expect(trend.getByTestId("trend-table").locator("tbody tr")).toHaveCount(days);
      await expect(trend.getByTestId("trend-table-total")).toHaveText(String(total));
      await expect(page.getByTestId("status-total")).toHaveText(String(total));
      await expect(page.getByTestId("courier-total")).toHaveText(String(total));
      const statusSum = (await page.getByTestId("status-count").allTextContents()).reduce((a, t) => a + Number(t), 0);
      const courierSum = (await page.getByTestId("courier-count").allTextContents()).reduce((a, t) => a + Number(t), 0);
      expect(statusSum).toBe(total);
      expect(courierSum).toBe(total);
      await expect(page.getByRole("img", { name: new RegExp(`^Tren ${days} hari .*: ${total} pengiriman`) })).toBeVisible();
    };
    await period(14);
    await expect(page.getByRole("navigation", { name: "Periode" }).getByRole("link", { name: "14 hari" })).toHaveAttribute("aria-current", "true");
    await page.getByRole("navigation", { name: "Periode" }).getByRole("link", { name: "30 hari" }).click();
    await expect(page).toHaveURL((url) => url.pathname === "/" && url.search === "?hari=30");
    await expect(page.getByRole("navigation", { name: "Periode" }).getByRole("link", { name: "30 hari" })).toHaveAttribute("aria-current", "true");
    await period(30);
    await page.reload();
    await expect(page.getByRole("navigation", { name: "Periode" }).getByRole("link", { name: "30 hari" })).toHaveAttribute("aria-current", "true");

    // Terbaru: the last five, newest first.
    const newest = localSql(`select reference from public.shipments where tenant_id = '${TENANT_C}' order by created_at desc, id desc limit 5`).split("\n");
    await expect(page.getByTestId("recent-row")).toHaveCount(newest.length);
    await expect(page.getByTestId("recent-row").first()).toContainText(newest[0]);

    // A tenant admin of an incomplete gerai sees the setup callout, each missing fact linking to its setting.
    const setup = page.getByTestId("dashboard-setup");
    await expect(setup.getByRole("heading", { name: "Lengkapi pengaturan gerai" })).toBeVisible();
    await expect(setup.getByRole("link", { name: /Akun Mengantar/ })).toHaveAttribute("href", "/pengaturan#mengantar");
    await expect(setup.getByRole("link", { name: /WhatsApp gerai/ })).toHaveAttribute("href", "/pengaturan#whatsapp-gerai");
    // No private cost, discount or COD amount; a real gerai shows no "contoh" label.
    await expect(page.getByText(/biaya bersih|laba|untung|diskon|nominal cod/i)).toHaveCount(0);
    await expect(page.getByText("contoh", { exact: true })).toHaveCount(0);

    await expectNoHorizontalOverflow(page);
    await expectTouchTargets(page);
  } finally {
    cleanup();
  }
});

test("an empty gerai shows empty states with a next action, never a placeholder trend", async ({ page }) => {
  expect(countC("true"), "Gerai Uji C must have no shipments").toBe(0);
  await signIn(page, "owner-c@geraiexpress.test");
  await expect(page).toHaveURL(atDashboard);
  await expect(page.getByTestId("dashboard-attention")).toContainText("Tidak ada yang perlu ditindaklanjuti.");
  await expect(page.getByTestId("attention-count")).toHaveText("Jumlah: 0");
  await expect(page.getByTestId("stat-created-today").getByTestId("stat-value")).toHaveText("0");
  await expect(page.getByTestId("stat-created-today").getByTestId("stat-delta")).toHaveText("0");
  await expect(page.getByTestId("trend-empty")).toHaveText(/Belum ada pengiriman dalam 14 hari terakhir/);
  await expect(page.getByRole("img", { name: /belum ada pengiriman/ })).toBeVisible();
  await expect(page.getByTestId("trend-table-total")).toHaveText("0");
  await expect(page.getByTestId("dashboard-status")).toContainText("Belum ada pengiriman pada periode ini.");
  await expect(page.getByTestId("dashboard-couriers")).toContainText("Belum ada pengiriman pada periode ini.");
  await expect(page.getByTestId("recent-empty").getByRole("button", { name: "Buat pengiriman pertama" })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("an operator lands on the Dashboard and gets no setup callout", async ({ page }) => {
  await signIn(page, "operator-a@geraiexpress.test");
  await expect(page).toHaveURL(atDashboard);
  await expect(page.getByTestId("dashboard-trend")).toBeVisible();
  await expect(page.getByTestId("dashboard-quick-actions")).toBeVisible();
  await expect(page.getByTestId("dashboard-setup")).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
});

test("a demo labels every figure contoh", async ({ page }) => {
  await startDemo(page);
  for (const key of ["created-today", "issued-today", "awaiting", "drafts"]) {
    await expect(page.getByTestId(`stat-${key}`)).toContainText("contoh");
  }
  for (const id of ["dashboard-attention", "dashboard-trend", "dashboard-status", "dashboard-couriers", "dashboard-recent"]) {
    await expect(page.getByTestId(id).getByText("contoh", { exact: true }).first()).toBeVisible();
  }
  await expect(page.getByTestId("dashboard-setup")).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
});

test("an anonymous visitor on the shared host still gets the public home at /; a demo session gets the Dashboard there", async ({ page }) => {
  const res = await page.goto("/");
  expect(res?.status()).toBe(200);
  await expect(page.getByRole("link", { name: "Coba demo", exact: true }).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Dashboard", level: 1 })).toHaveCount(0);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /^https:\/\/geraiexpress\.com\/?$/);
  await startDemo(page);
  await expect(page.getByRole("heading", { name: "Dashboard", level: 1 })).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Periode" }).getByRole("link", { name: "30 hari" })).toHaveAttribute("href", "/?hari=30");
});
