// T-029: Public marketing pages on GeraiExpress (Komdigi-clean rebrand), margin simulator,
// responsive layout + 44px touch targets, and PR-32 root routing preservation for signed-in users.
import { expect, test } from "./fixtures";
import { expectNoHorizontalOverflow, expectTouchTargets, signIn, signOut } from "./helpers";

const FORBIDDEN = new RegExp(["c", "u", "a", "n"].join(""), "i");

const MARKETING_ROUTES: readonly { path: string; heading: string }[] = [
  { path: "/", heading: "Buka loket 12+ layanan ekspedisi di toko Anda. Gratis." },
  { path: "/fitur", heading: "Fitur lengkap kasir loket multi-kurir, gratis" },
  { path: "/simulasi", heading: "Hitung potensi tambahan keuntungan toko Anda" },
  { path: "/cara-kerja", heading: "Alur 4 langkah kasir: cepat, praktis, gratis" },
  { path: "/hubungi-kami", heading: "Aktifkan loket di toko Anda, gratis" },
];

test("public marketing pages render for unauthenticated visitors with 44px targets and zero horizontal overflow", async ({
  page,
}) => {
  for (const route of MARKETING_ROUTES) {
    await page.goto(route.path);
    await expect(page.getByRole("heading", { level: 1, name: route.heading })).toBeVisible();
    await expect(page.getByText("GeraiExpress").first()).toBeVisible();

    const bodyText = await page.locator("body").innerText();
    expect(FORBIDDEN.test(bodyText), `forbidden term on ${route.path}`).toBe(false);

    await expectNoHorizontalOverflow(page);
    await expectTouchTargets(page);
  }
});

test("commission simulator updates estimates interactively on /simulasi", async ({ page }) => {
  await page.goto("/simulasi");
  await expect(page.getByTestId("sim-packages-output")).toHaveText("40 paket / hari");
  await expect(page.getByTestId("sim-monthly")).toContainText("4.200.000");

  await page.getByRole("button", { name: "150 paket" }).click();
  await expect(page.getByTestId("sim-packages-output")).toHaveText("150 paket / hari");
  // 150 * 30 = 4,500 packages/month -> 22.5% tier
  await expect(page.getByTestId("sim-formula")).toContainText("22,5%");
  await expectNoHorizontalOverflow(page);
});

test("marketing home page links to /masuk (demo & sign-in) and /daftar, while signed-in user on / routes to /pengiriman", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("link", { name: /Coba demo \/ Masuk/i })).toHaveAttribute("href", "/masuk");
  await expect(page.getByRole("link", { name: "Daftar gratis" }).first()).toHaveAttribute("href", "/daftar");

  // Signed-in tenant member visiting / continues to route directly to /pengiriman (PR-32).
  await signIn(page, "owner-a@geraiexpress.test");
  await page.goto("/");
  await expect(page).toHaveURL(/\/pengiriman$/);
  await signOut(page);
});
