// PR-36 / TEN-6 / SEC-6 / TD-14: host topology in a real browser and over real HTTP. One dev server
// answers for several host names (`*.localhost` locally); sessions must stay on the host that set them.
import { actAsVisitor, expect, randomVisitorIp, test } from "./fixtures";
import { atDashboard, audienceUrl, signIn, type Audience } from "./helpers";

const AUDIENCES: Audience[] = ["site", "app", "owner", "hooks"];

function hostOf(origin: string) {
  return new URL(origin).host;
}

test.describe("host matrix over HTTP", () => {
  test.beforeEach(() => {
    const base = test.info().project.use.baseURL!;
    test.skip(!audienceUrl("app", base), "needs loopback or E2E_<AUDIENCE>_URL origins");
  });

  // [audience, path, expected status]; GET only, redirects never followed.
  const cells: [Audience, string, number][] = [
    ["site", "/", 200], ["site", "/fitur", 200], ["site", "/masuk", 404], ["site", "/admin", 404],
    ["site", "/pengiriman", 404], ["site", "/healthz", 200],
    ["app", "/fitur", 404], ["app", "/admin", 404], ["app", "/verifikasi-2fa", 404], ["app", "/masuk", 200],
    ["app", "/healthz", 200], ["app", "/api/auth/send-email", 404],
    ["owner", "/fitur", 404], ["owner", "/pengiriman", 404], ["owner", "/daftar", 404], ["owner", "/masuk", 200],
    ["owner", "/healthz", 200],
    ["hooks", "/", 404], ["hooks", "/masuk", 404], ["hooks", "/admin", 404], ["hooks", "/healthz", 200],
    ["hooks", "/api/auth/send-email", 404],
  ];

  for (const [audience, path, status] of cells) {
    test(`${audience} host answers ${path} with ${status}, no redirect, noindex off the apex`, async ({ playwright, baseURL }) => {
      const origin = audienceUrl(audience, baseURL!)!;
      const api = await playwright.request.newContext({ baseURL: baseURL! });
      const res = await api.get(path, { headers: { host: hostOf(origin) }, maxRedirects: 0 });
      expect(res.status()).toBe(status);
      expect(res.headers()["location"]).toBeUndefined();
      if (status === 404) {
        // No hint of another host or of the route that exists elsewhere.
        const body = await res.text();
        expect(body).not.toMatch(/localhost|geraiexpress|admin|masuk/i);
      }
      // None of these hosts is the production apex, so every one is noindex.
      expect(res.headers()["x-robots-tag"]).toBe("noindex, nofollow");
      await api.dispose();
    });
  }

  test("the removed Send Email Hook path answers 404 on every host, the hooks host included", async ({ playwright, baseURL }) => {
    const api = await playwright.request.newContext({ baseURL: baseURL! });
    for (const audience of AUDIENCES) {
      const res = await api.post("/api/auth/send-email", {
        headers: { host: hostOf(audienceUrl(audience, baseURL!)!), "content-type": "application/json" },
        data: "{}",
        maxRedirects: 0,
      });
      expect(res.status(), audience).toBe(404);
    }
    await api.dispose();
  });

  test("a forwarded host header is ignored: it neither opens nor closes a route", async ({ playwright, baseURL }) => {
    const api = await playwright.request.newContext({ baseURL: baseURL! });
    const app = hostOf(audienceUrl("app", baseURL!)!);
    const owner = hostOf(audienceUrl("owner", baseURL!)!);
    const closed = await api.get("/admin", { headers: { host: app, "x-forwarded-host": owner }, maxRedirects: 0 });
    expect(closed.status()).toBe(404);
    const open = await api.get("/masuk", { headers: { host: owner, "x-forwarded-host": app }, maxRedirects: 0 });
    expect(open.status()).toBe(200);
    await api.dispose();
  });
});

test("a gerai session is host-only: HttpOnly, no Domain, never sent to the owner host", async ({ browser, baseURL }) => {
  const app = audienceUrl("app", baseURL!);
  const owner = audienceUrl("owner", baseURL!);
  test.skip(!app || !owner, "needs loopback or E2E_APP_URL and E2E_OWNER_URL");
  const context = await browser.newContext({ baseURL: app! });
  await actAsVisitor(context, app!, randomVisitorIp());
  const page = await context.newPage();
  await signIn(page, "owner-a@geraiexpress.test");
  await expect(page).toHaveURL(atDashboard); // UX-16: sign-in lands on the Dashboard.

  const cookies = await context.cookies(app!);
  const session = cookies.filter((c) => c.name === "gx_at" || c.name === "gx_rt");
  expect(session.map((c) => c.name).sort()).toEqual(["gx_at", "gx_rt"]);
  const maxSeconds = 7 * 24 * 60 * 60;
  for (const c of cookies) {
    // Host-only cookies carry the bare host (no leading dot) and no Domain attribute.
    expect(c.domain, c.name).toBe(new URL(app!).hostname);
    expect(c.sameSite, c.name).toBe("Lax");
    // Secure follows the request protocol, and a production build marks cookies Secure even over plain
    // HTTP (the reverse proxy terminates TLS). The spec cannot read the server's NODE_ENV, so a run against a
    // production build (the container behind the local proxy profile) sets E2E_PRODUCTION_BUILD=1; `next dev`
    // leaves it unset.
    expect(c.secure, c.name).toBe(app!.startsWith("https:") || process.env.E2E_PRODUCTION_BUILD === "1");
  }
  for (const c of session) {
    expect(c.httpOnly, c.name).toBe(true);
    // Bounded lifetime: the 7 day gerai session bound.
    expect(c.expires - Date.now() / 1000, c.name).toBeLessThanOrEqual(maxSeconds + 5);
  }
  expect(await page.evaluate(() => document.cookie)).not.toMatch(/gx_(at|rt)/);

  // The browser sends nothing to the owner host, and the owner host does not know this person.
  expect((await context.cookies(owner!)).filter((c) => c.name === "gx_at" || c.name === "gx_rt")).toEqual([]);
  const ownerPage = await context.newPage();
  await ownerPage.goto(`${owner}/`);
  await expect(ownerPage).toHaveURL(`${owner}/masuk`);
  expect((await ownerPage.goto(`${owner}/pengiriman`))?.status()).toBe(404);
  expect((await ownerPage.goto(`${owner}/admin`))?.url()).toBe(`${owner}/masuk`);
  // The gerai session on the app host is untouched.
  await page.goto("/pengiriman");
  await expect(page).toHaveURL(/\/pengiriman$/);
  await context.close();
});

test("the apex reads no session and the hooks host sets no cookie", async ({ browser, baseURL }) => {
  const app = audienceUrl("app", baseURL!);
  const site = audienceUrl("site", baseURL!);
  const hooks = audienceUrl("hooks", baseURL!);
  test.skip(!app || !site || !hooks, "needs loopback or E2E_<AUDIENCE>_URL origins");
  const context = await browser.newContext({ baseURL: site! });
  const page = await context.newPage();
  const res = await page.goto(`${site}/`);
  expect(res?.status()).toBe(200);
  expect(await context.cookies()).toEqual([]);
  const hookRes = await context.request.get(`${hooks}/healthz`);
  expect(hookRes.status()).toBe(200);
  expect(hookRes.headers()["set-cookie"]).toBeUndefined();
  await context.close();
});

test("every audience name in the helper resolves to a distinct origin", async ({ baseURL }) => {
  const origins = AUDIENCES.map((a) => audienceUrl(a, baseURL!));
  test.skip(origins.some((o) => !o), "needs loopback or E2E_<AUDIENCE>_URL origins");
  expect(new Set(origins).size).toBe(AUDIENCES.length);
});
