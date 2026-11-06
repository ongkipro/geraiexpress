// PR-1, PR-13, PR-21, UX-3, NFR-4: entry, scope, demo isolation and sign-out in a real browser.
import { actAsVisitor, expect, randomVisitorIp, test } from "./fixtures";
import { randomInt } from "node:crypto";
import { FIXTURE_PASSWORD, atDashboard, expectNoHorizontalOverflow, expectTouchTargets, openSessionActions, signIn, signOut, startDemo } from "./helpers";

const TOO_MANY = /Terlalu banyak percobaan dari jaringan ini/;

// Limiter windows are aligned to the wall clock; start a burst early in a window so it cannot
// straddle a reset.
async function freshLimitWindow() {
  const into = Date.now() % 60_000;
  if (into > 30_000) await new Promise((r) => setTimeout(r, 60_000 - into + 250));
}

test("login page offers sign-in and a discoverable demo entry", async ({ page }) => {
  await page.goto("/masuk");
  await expect(page.getByRole("heading", { name: "Masuk ke ruang kerja gerai" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Coba demo" })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("CSP enforces fresh script nonces with working login scripts", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  const nonces = new Set<string>();
  for (const path of ["/", "/masuk"]) {
    const response = await page.goto(path);
    expect(response?.status()).toBe(200);
    const headers = response!.headers();
    // T-055: one enforced policy (tests/e2e/csp.spec.ts checks every script against it).
    const policy = headers["content-security-policy"];
    expect(policy).toContain("frame-ancestors 'none'; object-src 'none'; base-uri 'none'; form-action 'self'; script-src 'self' 'nonce-");
    expect(headers["content-security-policy-report-only"]).toBeUndefined();
    const nonce = policy.match(/'nonce-([^']+)'/)?.[1];
    expect(nonce).toBeTruthy();
    nonces.add(nonce!);
    expect(policy).toContain("'strict-dynamic' https://challenges.cloudflare.com");
    expect(policy).toContain("frame-src https://challenges.cloudflare.com");
    await expect(page.locator(`script[src*="/_next/"][nonce]`).first()).toBeAttached();
  }
  await expect(page.getByRole("heading", { name: "Masuk ke ruang kerja gerai" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Masuk", exact: true })).toBeEnabled();
  expect(nonces.size).toBe(2);
  expect(errors).toEqual([]);
});

test("the enforced base CSP blocks object embeds and base URL substitution", async ({ page }) => {
  await page.goto("/masuk");
  const outcome = await page.evaluate(() => {
    const { promise, resolve } = Promise.withResolvers<{ directives: string[]; base: string }>();
    const blocked = new Set<string>();
    const base = document.createElement("base");
    const object = document.createElement("object");
    const listener = (event: SecurityPolicyViolationEvent) => {
      if (event.disposition !== "enforce") return;
      if (["base-uri", "object-src"].includes(event.effectiveDirective)) blocked.add(event.effectiveDirective);
      if (blocked.size === 2) {
        const unchangedBase = document.baseURI;
        document.removeEventListener("securitypolicyviolation", listener);
        base.remove();
        object.remove();
        resolve({ directives: [...blocked].sort(), base: unchangedBase });
      }
    };
    document.addEventListener("securitypolicyviolation", listener);
    base.href = "https://csp-probe.invalid/";
    document.head.append(base);
    object.data = "data:text/html,<p>bounded CSP probe</p>";
    document.body.append(object);
    return promise;
  });
  expect(outcome.directives).toEqual(["base-uri", "object-src"]);
  expect(outcome.base).toBe(`${new URL(page.url()).origin}/masuk`);
});

test("wrong password shows one generic error and keeps the email", async ({ page }) => {
  await page.goto("/masuk");
  await page.getByRole("textbox", { name: "Email" }).fill("owner-a@geraiexpress.test");
  await page.getByLabel("Kata sandi").fill("salah-sekali-123");
  await page.getByRole("button", { name: "Masuk", exact: true }).click();
  await expect(page.locator("#signin-error")).toHaveText(/Email atau kata sandi tidak cocok/);
  await expect(page.getByRole("textbox", { name: "Email" })).toHaveValue("owner-a@geraiexpress.test");
});

test("unknown email gets the same message as a wrong password", async ({ page }) => {
  await page.goto("/masuk");
  await page.getByRole("textbox", { name: "Email" }).fill("tidak-terdaftar@geraiexpress.test");
  await page.getByLabel("Kata sandi").fill("apa-saja-12345");
  await page.getByRole("button", { name: "Masuk", exact: true }).click();
  await expect(page.locator("#signin-error")).toHaveText(/Email atau kata sandi tidak cocok/);
});

test("protected pages redirect to sign-in when signed out", async ({ page }) => {
  await page.goto("/pengiriman");
  await expect(page).toHaveURL(/\/masuk$/);
});

test("tenant member sees only their own gerai and can sign out", async ({ page }) => {
  await signIn(page, "owner-a@geraiexpress.test");
  // UX-16: sign-in lands on the Dashboard at "/"; the gerai's own shipments are then checked on the list.
  await expect(page).toHaveURL(atDashboard);
  await expect(page.getByTestId("tenant-name").filter({ visible: true }).first()).toHaveText("Gerai Uji A");
  await expect(page.getByTestId("outlet-name").filter({ visible: true }).first()).toHaveText("Outlet Uji A");
  await page.goto("/pengiriman?q=GXTEST");
  await expect(page.getByText("GXTEST-A1").filter({ visible: true }).first()).toBeVisible();
  await expect(page.getByText("GXTEST-B1")).toHaveCount(0);
  await expect(page.getByText("Demo · Simulasi.")).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
  await signOut(page);
});

test("signed-in user without membership gets the no-access state", async ({ page }) => {
  await signIn(page, "no-access@geraiexpress.test");
  await expect(page).toHaveURL(/\/akses$/);
  await expect(page.getByRole("heading", { name: "Belum ada gerai untuk akun ini" })).toBeVisible();
  await page.goto("/pengiriman");
  await expect(page).toHaveURL(/\/akses$/);
});

test("demo opens a labelled sample workspace with seeded examples", async ({ page }) => {
  await startDemo(page);
  await expect(page.getByText("Demo · Simulasi.")).toBeVisible();
  await expect(page.getByTestId("tenant-name").filter({ visible: true }).first()).toHaveText("Gerai Contoh Sentosa");
  // UX-16: the demo lands on the Dashboard, whose exception list is "Perlu tindakan".
  await expect(page.getByRole("heading", { name: "Perlu tindakan" })).toBeVisible();
  await expect(page.getByText("Hasil belum pasti").filter({ visible: true }).first()).toBeVisible();
  await expect(page.getByText("GXTEST-A1")).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
});

test("two demo visitors are isolated from each other", async ({ browser }) => {
  const a = await browser.newContext();
  await actAsVisitor(a, test.info().project.use.baseURL!, randomVisitorIp());
  const b = await browser.newContext();
  await actAsVisitor(b, test.info().project.use.baseURL!, randomVisitorIp());
  const pa = await a.newPage();
  const pb = await b.newPage();
  await startDemo(pa);
  await startDemo(pb);
  // Demo references repeat across tenants (the same prefix and day counter), so isolation is proved by
  // identity: none of A's shipment pages may be reachable from B's session.
  await pa.goto("/pengiriman");
  const hrefsA = await pa.locator('a[href^="/pengiriman/"]').evaluateAll((links) =>
    Array.from(new Set(links.map((l) => (l as HTMLAnchorElement).getAttribute("href") ?? ""))).filter((h) => /^\/pengiriman\/[0-9a-f-]{36}$/.test(h)),
  );
  expect(hrefsA.length).toBeGreaterThan(0);
  await pb.goto("/pengiriman");
  const hrefsB = await pb.locator('a[href^="/pengiriman/"]').evaluateAll((links) =>
    links.map((l) => (l as HTMLAnchorElement).getAttribute("href") ?? ""),
  );
  for (const href of hrefsA) {
    expect(hrefsB).not.toContain(href);
    const res = await pb.goto(href);
    expect(res?.status(), href).toBe(404);
  }
  await a.close();
  await b.close();
});

test("mobile navigation opens as a sheet and keeps scope visible", async ({ page }) => {
  // T-079: from 768 px the app header and the icon rail replace the mobile top bar and its sheet.
  test.skip((page.viewportSize()?.width ?? 1280) >= 768, "from 768 px the rail and the app header carry navigation");
  await startDemo(page);
  await expect(page.getByTestId("tenant-name").filter({ visible: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Buka menu" }).click();
  await expect(page.getByRole("dialog", { name: "Menu" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Kontak" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Menu" })).toHaveCount(0);
});

test("from 768 px the app header keeps the scope, counts what needs action and searches shipments (T-079)", async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 1280) < 768, "below 768 px the top bar and its sheet carry these");
  await startDemo(page);
  await page.goto("/pengiriman");
  await expect(page.getByTestId("tenant-name").filter({ visible: true }).first()).toHaveText("Gerai Contoh Sentosa");
  await expect(page.getByTestId("outlet-name").filter({ visible: true }).first()).toBeVisible();
  const nav = page.getByRole("navigation", { name: "Navigasi utama" });
  await expect(nav.getByRole("link").first()).toHaveAttribute("href", "/");
  await expect(nav.getByRole("link").first()).toHaveAccessibleName("Dashboard");
  await expect(nav.getByRole("link", { name: "Kontak" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Lokasi halaman" })).toContainText("Pengiriman");
  // The seeded demo has one shipment with an uncertain outcome: the header chip and the Pengiriman item agree.
  const attention = page.getByRole("link", { name: "1 perlu tindakan", exact: true });
  await expect(attention).toHaveAttribute("href", "/pengiriman#perlu-tindakan");
  await expect(nav.getByRole("link", { name: "Pengiriman 1 perlu tindakan" })).toBeVisible();
  const search = page.getByRole("searchbox", { name: "Cari pengiriman" });
  await search.fill("DEMO-");
  await search.press("Enter");
  await expect(page).toHaveURL(/\/pengiriman\?q=DEMO-$/);
  await expect(page.getByText("Cari: “DEMO-”")).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("keyboard focus is visible on the primary action", async ({ page }) => {
  await page.goto("/masuk");
  await page.getByLabel("Kata sandi").focus();
  await page.keyboard.press("Tab");
  const outline = await page.evaluate(() => getComputedStyle(document.activeElement!).outlineStyle);
  // The focused element is the "Masuk" button by accessible name. SubmitButton keeps an aria-hidden
  // pending label in the DOM (same width while pending), so raw textContent is not the name.
  await expect(page.getByRole("button", { name: "Masuk", exact: true })).toBeFocused();
  expect(outline).not.toBe("none");
});

test("a forged tenant cookie cannot widen access", async ({ page, context }) => {
  await signIn(page, "owner-a@geraiexpress.test");
  await expect(page).toHaveURL(atDashboard); // UX-16: sign-in lands on the Dashboard.
  const url = new URL(page.url());
  await context.addCookies([{ name: "ge_tenant", value: "00000000-0000-4000-b000-00000000000b", domain: url.hostname, path: "/" }]);
  await page.reload();
  await expect(page.getByTestId("tenant-name").filter({ visible: true }).first()).toHaveText("Gerai Uji A");
  await expect(page.getByText("GXTEST-B1")).toHaveCount(0);
});

test("a signed-in real account is not silently replaced by a demo session", async ({ page }) => {
  await signIn(page, "no-access@geraiexpress.test");
  await expect(page).toHaveURL(/\/akses$/);
  await page.goto("/masuk");
  await expect(page).toHaveURL(/\/akses$/);
});

test("demo reset restores the seeded examples", async ({ page }) => {
  await startDemo(page);
  await page.goto("/pengiriman?status=unknown");
  await expect(page.getByText("1 pengiriman · halaman 1 dari 1")).toBeVisible();
  await (await openSessionActions(page))("Atur ulang demo").click();
  await expect(page.getByText("Demo sudah dikembalikan ke contoh awal.")).toBeVisible();
  await expect(page.getByText("3 pengiriman · halaman 1 dari 1")).toBeVisible();
});

test("out-of-range page offers a way back instead of an error", async ({ page }) => {
  await startDemo(page);
  await page.goto("/pengiriman?page=999");
  await expect(page.getByText("Halaman 999 tidak tersedia.")).toBeVisible();
});

test("controls meet the 44px touch target on login and queue", async ({ page }) => {
  await page.goto("/masuk");
  await expectTouchTargets(page);
  await startDemo(page);
  await expectTouchTargets(page);
});

test("a person with two gerai memberships must choose one explicitly", async ({ page }) => {
  await signIn(page, "multi@geraiexpress.test");
  await expect(page).toHaveURL(/\/pilih-gerai$/);
  await page.getByRole("button", { name: "Gerai Uji B" }).click();
  await expect(page).toHaveURL(atDashboard); // UX-16: choosing a gerai lands on the Dashboard ("Terbaru" lists GXTEST-B1).
  await expect(page.getByTestId("tenant-name").filter({ visible: true }).first()).toHaveText("Gerai Uji B");
  await expect(page.getByText("GXTEST-B1").filter({ visible: true }).first()).toBeVisible();
  await expect(page.getByText("GXTEST-A1")).toHaveCount(0);
});


test("sign-in is limited per visitor before the auth service is reached (RATE-1)", async ({ page }) => {
  test.setTimeout(120_000);
  await freshLimitWindow();
  await page.goto("/masuk");
  const attempt = async (email: string, password: string) => {
    await page.getByRole("textbox", { name: "Email" }).fill(email);
    await page.getByLabel("Kata sandi").fill(password);
    await Promise.all([
      page.waitForResponse((r) => r.request().method() === "POST" && r.url().includes("/masuk")),
      page.getByRole("button", { name: "Masuk", exact: true }).click(),
    ]);
  };
  for (let i = 0; i < 10; i++) {
    await attempt(`visitor-${randomInt(1_000_000_000)}-${i}@geraiexpress.test`, `salah-${i}-12345`);
    await expect(page.locator("#signin-error")).toHaveText(/Email atau kata sandi tidak cocok/);
  }
  // The 11th attempt in the window is refused even with the right password.
  await attempt("owner-a@geraiexpress.test", FIXTURE_PASSWORD);
  await expect(page.locator("#signin-error")).toHaveText(TOO_MANY);
  await expect(page).toHaveURL(/\/masuk$/);
});

test("demo entry is limited per visitor (RATE-1)", async ({ browser }) => {
  const ip = `10.250.${randomInt(256)}.${randomInt(1, 255)}`;
  test.setTimeout(120_000);
  const baseURL = test.info().project.use.baseURL;
  await freshLimitWindow();
  for (let i = 0; i < 6; i++) {
    const context = await browser.newContext({ baseURL });
    await actAsVisitor(context, baseURL!, ip);
    const page = await context.newPage();
    await page.goto("/masuk");
    await page.getByRole("button", { name: "Coba demo" }).click();
    if (i < 5) await expect(page).toHaveURL(atDashboard); // UX-16: the demo lands on the Dashboard.
    else await expect(page.getByRole("alert").filter({ hasText: TOO_MANY })).toBeVisible();
    await context.close();
  }
});

test("one account is limited across different visitors before password guessing (RATE-2)", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/masuk");
  await freshLimitWindow();
  const email = `account-limit-${randomInt(1_000_000_000)}@geraiexpress.test`;
  for (let i = 0; i < 11; i++) {
    await actAsVisitor(page, test.info().project.use.baseURL!, randomVisitorIp());
    await page.getByRole("textbox", { name: "Email" }).fill(i % 2 ? email.toUpperCase() : email);
    await page.getByLabel("Kata sandi").fill("wrong-test-password");
    await Promise.all([
      page.waitForResponse((response) => response.request().method() === "POST" && response.url().includes("/masuk")),
      page.getByRole("button", { name: "Masuk", exact: true }).click(),
    ]);
    await expect(page.locator("#signin-error")).toHaveText(i < 10 ? /Email atau kata sandi tidak cocok/ : TOO_MANY);
    // Each submission must have completed before the next visitor is installed (T-107: the
    // SubmitButton stays focusable and reports its pending state through aria-busy).
    await expect(page.getByRole("button", { name: "Masuk", exact: true })).not.toHaveAttribute("aria-busy", "true");
  }
});
