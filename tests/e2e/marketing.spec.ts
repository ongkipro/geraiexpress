// T-029/T-036: Public marketing pages on GeraiExpress (Komdigi-clean rebrand, approved and implemented
// claims only), responsive layout + 44px touch targets, and PR-32 root routing preservation for signed-in users.
import { expect, test } from "./fixtures";
import { atDashboard, expectNoHorizontalOverflow, expectTouchTargets, signIn, signOut } from "./helpers";

const FORBIDDEN = new RegExp(["c", "u", "a", "n"].join(""), "i");

const MARKETING_ROUTES: readonly { path: string; heading: string }[] = [
  { path: "/", heading: "Buka loket pengiriman multi-kurir di toko Anda." },
  { path: "/fitur", heading: "Fitur kasir loket multi-kurir" },
  { path: "/simulasi", heading: "Model layanan loket GeraiExpress" },
  { path: "/cara-kerja", heading: "Alur 4 langkah kasir" },
  { path: "/hubungi-kami", heading: "Aktifkan loket di toko Anda" },
];

// PR-35: no numeric commission, discount, COD fee, insurance or payout term, no free-of-charge claim
// and no partnership claim on any public page, and nothing the product does not do yet.
const BANNED_COPY = [
  /\d\s*%/,
  /gratis/i,
  /komisi \d|komisi bersih|laba toko/i,
  /dikembangkan bersama|kemitraan|jaringan resmi/i,
  /jadwalkan|kurir (resmi )?(datang|jemput)|thermal|cetak resi|pencairan|csv|pelacakan/i,
  /AnterAja|Paxel|Kargo|12\+/,
];

test("public marketing pages render approved copy for unauthenticated visitors with 44px targets and zero horizontal overflow", async ({
  page,
}) => {
  for (const route of MARKETING_ROUTES) {
    await page.goto(route.path);
    await expect(page.getByRole("heading", { level: 1, name: route.heading })).toBeVisible();
    await expect(page.getByText("GeraiExpress").first()).toBeVisible();

    const bodyText = await page.locator("body").innerText();
    expect(FORBIDDEN.test(bodyText), `forbidden term on ${route.path}`).toBe(false);
    for (const banned of BANNED_COPY) {
      expect(banned.test(bodyText), `${banned} on ${route.path}`).toBe(false);
    }

    await expectNoHorizontalOverflow(page);
    await expectTouchTargets(page);
  }
});

test("home page lists the orderable couriers and states the drop-off, simulated-demo scope", async ({ page }) => {
  await page.goto("/");
  const couriers = page.getByTestId("courier-list").getByRole("listitem");
  await expect(couriers).toHaveCount(8);
  await expect(page.getByTestId("courier-list")).toContainText("J&T Express");
  await expect(page.getByTestId("courier-list")).not.toContainText("AnterAja");
  await expect(page.locator('[data-stat="kurir"]')).toHaveText("8");
  await expect(page.getByText(/Versi ini melayani drop-off/).first()).toBeVisible();
  await expect(page.getByText("Simulasi", { exact: true })).toBeVisible();
});

test("the former simulator route is a neutral page with no default percentage or earning figure", async ({ page }) => {
  await page.goto("/simulasi");
  await expect(page.getByTestId("sim-packages-output")).toHaveCount(0);
  await expect(page.locator('input[type="range"]')).toHaveCount(0);
  // The CTA comes from environment configuration: relative on a single-origin run, absolute on the app origin otherwise.
  // C10 split the former "Coba demo / Masuk" button into "Coba demo" and "Masuk"; the demo entry lives on /masuk.
  await expect(page.getByRole("link", { name: "Coba demo", exact: true }).first()).toHaveAttribute("href", /(^|\/)masuk$/);
  await expectNoHorizontalOverflow(page);
});

test("a non-production host is served with noindex and a disallow-all robots.txt", async ({ request }) => {
  const page = await request.get("/fitur");
  expect(page.headers()["x-robots-tag"]).toBe("noindex, nofollow");

  const robots = await request.get("/robots.txt");
  const body = await robots.text();
  expect(body).toMatch(/User-Agent: \*/i);
  expect(body).toMatch(/Disallow: \/\s*$/m);
  expect(body).not.toMatch(/^(Allow|Sitemap):/im);
});

test("marketing home page links to /masuk (demo & sign-in) and /daftar, while a signed-in user on / gets the gerai Dashboard", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Coba demo", exact: true }).first()).toHaveAttribute("href", /(^|\/)masuk$/);
  await expect(page.getByRole("link", { name: "Masuk", exact: true }).first()).toHaveAttribute("href", /(^|\/)masuk$/);
  await expect(page.getByRole("link", { name: "Daftar", exact: true }).first()).toHaveAttribute("href", /(^|\/)daftar$/);

  // A signed-in tenant member at / gets the gerai Dashboard in place (PR-32, UX-16): no redirect to another path.
  await signIn(page, "owner-b@geraiexpress.test");
  await page.goto("/");
  await expect(page).toHaveURL(atDashboard);
  await expect(page.getByRole("heading", { name: "Dashboard", level: 1 })).toBeVisible();
  await expect(page.getByTestId("tenant-name").filter({ visible: true }).first()).toHaveText("Gerai Uji B");
  await signOut(page);
});
