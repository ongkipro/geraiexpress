// T-055 / SEC-6: the enforced nonce CSP, on the 390 and 1280 projects. Meant for the production container
// (E2E_PRODUCTION_BUILD=1); against `next dev` it runs too, where the policy also carries 'unsafe-eval'.
// Per page: the response sends ONE enforced policy (no Report-Only) whose script-src carries a nonce;
// every <script> in the served HTML carries that nonce; every script in the DOM afterwards carries it or
// is an external script loaded through 'strict-dynamic' (next/script, the Turnstile stand-in of
// tests/e2e/fixtures.ts, chunks); no securitypolicyviolation event fires and no CSP console error appears.
// Fixture: a synthetic real issued shipment of Gerai Uji A inserted with local SQL (deleted afterwards).
import { randomUUID } from "node:crypto";
import type { Page, Response } from "@playwright/test";
import { expect, test } from "./fixtures";
import { localSql, signIn } from "./helpers";

const TENANT_A = "00000000-0000-4000-b000-00000000000a";
const OUTLET_A = "00000000-0000-4000-c000-00000000000a";
const OWNER_A = "00000000-0000-4000-a000-0000000000a1";
const PRODUCTION = process.env.E2E_PRODUCTION_BUILD === "1";

let issued = "";

test.beforeAll(() => {
  issued = randomUUID();
  const quote = randomUUID();
  localSql(`
    insert into public.shipments (tenant_id, outlet_id, id, reference, submission_state, payment_state, sender_name, sender_phone,
      recipient_name, recipient_phone, recipient_address, recipient_area, recipient_postal_code, item_description, weight_grams,
      goods_value_idr, is_cod, is_simulated, created_by, submitted_at, issued_at, awb, customer_charge_idr, pickup_snapshot)
    values ('${TENANT_A}', '${OUTLET_A}', '${issued}', 'CSP-${issued.slice(0, 6).toUpperCase()}', 'issued', 'paid', 'Pengirim Uji', '081200000099',
      'Penerima Uji', '081234567890', 'Jl. Tujuan Uji No. 9', 'Kec. Tujuan, Kota Uji', '40132', 'Buku', 1500, 50000, false, false,
      '${OWNER_A}', now(), now(), 'JP1234567890', 24680,
      jsonb_build_object('outlet', 'Pickup Uji', 'address', 'Jl. Pickup Uji No. 5', 'area', 'Kec. Pickup, Kota Uji'));
    insert into public.shipment_quotes (tenant_id, shipment_id, id, shipment_revision, courier, service, normal_tariff_idr, eta_days, is_simulated, expires_at)
      values ('${TENANT_A}', '${issued}', '${quote}', 1, 'JT', 'REG', 24680, '1-2', false, now() + interval '1 hour');
    update public.shipments set selected_quote_id = '${quote}' where id = '${issued}';`);
});

test.afterAll(() => {
  if (issued) localSql(`update public.shipments set selected_quote_id = null where id = '${issued}'; delete from public.shipments where id = '${issued}'`);
});

declare global {
  interface Window { __cspViolations: string[] }
}

const consoleErrors = new WeakMap<Page, string[]>();

test.beforeEach(async ({ page }, info) => {
  test.skip(!["mobile-390", "desktop-1280"].includes(info.project.name), "runs in mobile-390 and desktop-1280");
  // Injected by the browser driver before any page script, so the listener itself is not subject to the CSP.
  await page.addInitScript(() => {
    window.__cspViolations = [];
    document.addEventListener("securitypolicyviolation", (event) =>
      window.__cspViolations.push(`${event.effectiveDirective} ${event.blockedURI} ${event.disposition}`));
  });
  const errors: string[] = [];
  consoleErrors.set(page, errors);
  page.on("console", (message) => {
    if (/Content Security Policy|Refused to (execute|load|frame)/i.test(message.text())) errors.push(message.text());
  });
});

const SCRIPT_SRC = new RegExp(
  "; script-src 'self' 'nonce-([A-Za-z0-9+/]{22}==)' 'strict-dynamic' https://challenges\\.cloudflare\\.com"
  + (PRODUCTION ? "" : "( 'unsafe-eval')?") + "; frame-src https://challenges\\.cloudflare\\.com$",
);

// The response header is the enforced policy with this response's nonce; returns that nonce.
async function enforcedNonce(response: Response | null): Promise<string> {
  expect(response).not.toBeNull();
  const headers = response!.headers();
  expect(headers["content-security-policy-report-only"]).toBeUndefined();
  const policy = headers["content-security-policy"] ?? "";
  expect(policy).toMatch(/^frame-ancestors 'none'; object-src 'none'; base-uri 'none'; form-action 'self'; /);
  const nonce = SCRIPT_SRC.exec(policy)?.[1];
  expect(nonce, policy).toBeTruthy();
  return nonce!;
}

// Every parser-inserted script (the served HTML) carries the nonce; afterwards no script in the DOM is
// inline without it, and no violation was reported.
async function expectCleanPage(page: Page, response: Response | null, html: string) {
  const nonce = await enforcedNonce(response);
  for (const tag of html.match(/<script\b[^>]*>/gi) ?? []) expect(tag, "served script tag").toContain(` nonce="${nonce}"`);
  await page.waitForLoadState("load");
  const scripts = await page.evaluate(() => [...document.scripts].map((script) => ({ nonce: script.nonce, src: script.src, type: script.type })));
  for (const script of scripts) {
    if (script.nonce === nonce) continue;
    // Not from the HTML (checked above): a script inserted at run time, allowed only through
    // 'strict-dynamic', always external.
    expect(script.src, `script without the nonce: ${JSON.stringify(script)}`).toMatch(/^(https?:\/\/[^/]+\/_next\/static\/|https:\/\/challenges\.cloudflare\.com\/)/);
  }
  expect(await page.evaluate(() => window.__cspViolations)).toEqual([]);
  expect(consoleErrors.get(page)).toEqual([]);
}

async function visit(page: Page, path: string) {
  const response = await page.goto(path);
  const html = (await response?.text()) ?? "";
  return { response, html };
}

test("public pages: marketing / and the request-rendered /fitur hydrate under the enforced nonce policy", async ({ page }) => {
  for (const path of ["/", "/fitur"]) {
    const { response, html } = await visit(page, path);
    expect(response?.status(), path).toBe(200);
    expect(html, path).toContain("<script");
    // The framework bootstrap ran: blocked chunks would leave window.next undefined.
    await expect.poll(() => page.evaluate(() => Boolean((window as { next?: unknown }).next)), { message: path }).toBe(true);
    await expectCleanPage(page, response, html);
  }
});

test("/masuk loads the Turnstile script through 'strict-dynamic' and the widget issues a token", async ({ page }) => {
  const { response, html } = await visit(page, "/masuk");
  expect(response?.status()).toBe(200);
  // The (stubbed) Turnstile api.js executed: next/script inserted it at run time without a nonce.
  await expect.poll(() => page.evaluate(() => typeof (window as { turnstile?: unknown }).turnstile)).toBe("object");
  await expect(page.getByRole("button", { name: "Masuk", exact: true })).not.toHaveAttribute("aria-disabled", "true");
  await expectCleanPage(page, response, html);
});

test("a signed-in workspace page and the label print page render under the enforced nonce policy", async ({ page }) => {
  await signIn(page, "owner-a@geraiexpress.test");
  for (const path of ["/pengiriman", `/pengiriman/${issued}/label`]) {
    const { response, html } = await visit(page, path);
    expect(response?.status(), path).toBe(200);
    await expect.poll(() => page.evaluate(() => Boolean((window as { next?: unknown }).next)), { message: path }).toBe(true);
    await expectCleanPage(page, response, html);
  }
  await expect(page.getByRole("heading", { name: "Pratinjau" })).toBeVisible();
});

// An unknown path is answered by Next's `/_not-found` route. Prerendered, its HTML would carry no nonce
// and the enforced policy would block its scripts; src/app/not-found.tsx renders it per request.
test("an unknown path renders the not-found page per request with this response's nonce", async ({ page }) => {
  const { response, html } = await visit(page, "/admin/tidak-ada-halaman-ini");
  expect(response?.status()).toBe(404);
  expect(response?.headers()["x-nextjs-cache"]).toBeUndefined();
  expect(html).toContain("<script");
  expect(html).toContain("Halaman tidak ditemukan");
  await expect(page.getByRole("heading", { level: 1, name: "Halaman tidak ditemukan" })).toBeVisible();
  await expectCleanPage(page, response, html);
});

// A page that calls notFound() is streamed by Next as an empty error shell whose not-found UI is in the
// nonce'd flight scripts and painted on the client, so it is visible only if those scripts ran.
test("a notFound() page carries the nonce on every script and paints its not-found UI", async ({ page }) => {
  await signIn(page, "owner-a@geraiexpress.test");
  const { response, html } = await visit(page, `/pengiriman/${randomUUID()}`);
  expect(response?.status()).toBe(404);
  expect(html).toContain("<script");
  expect(html).toContain("Halaman atau data tidak ditemukan");
  await expect(page.getByRole("heading", { level: 1, name: "Halaman atau data tidak ditemukan" })).toBeVisible();
  await expectCleanPage(page, response, html);
});

// The shared local host serves the tracking family too (src/lib/hosts.ts), so the base URL is enough.
test("the constant public tracking 404 sends the enforced policy and runs no script", async ({ page }) => {
  const { response, html } = await visit(page, `/lacak/${"U".repeat(43)}`);
  expect(response?.status()).toBe(404);
  expect(html).not.toContain("<script");
  await expect(page.getByRole("heading", { name: "Halaman tidak ditemukan" })).toBeVisible();
  await expectCleanPage(page, response, html);
});

// Negative control (review of T-055): the policy is ENFORCED by the browser, not just sent. The policy uses
// 'strict-dynamic', under which a script element created at run time by already-running script is trusted by
// design (it propagates trust), so a DOM-inserted probe proves nothing. The probes are therefore PARSER-inserted:
// the real response (with the app's own CSP header, untouched) has three inline scripts added to its HTML before it
// reaches the browser: one with this response's nonce (positive control: proves the probe can run), one without a
// nonce and one with a wrong nonce. Only the first may execute; the other two must each raise an enforced
// securitypolicyviolation for script-src.
test("an inline script without this response's nonce, or with a wrong one, is blocked and reported as enforced", async ({ page }) => {
  await page.route((url) => url.pathname === "/", async (route) => {
    const response = await route.fetch();
    const policy = response.headers()["content-security-policy"] ?? "";
    const nonce = /'nonce-([^']+)'/.exec(policy)?.[1] ?? "";
    const probe = (name: string, attr: string) => `<script${attr}>(window.__cspRan ||= {})[${JSON.stringify(name)}] = true;</script>`;
    const body = (await response.text()).replace("</body>",
      probe("matching", ` nonce="${nonce}"`) + probe("missing", "") + probe("wrong", ' nonce="AAAAAAAAAAAAAAAAAAAAAA=="') + "</body>");
    await route.fulfill({ response, body });
  });
  const response = await page.goto("/");
  const policy = response?.headers()["content-security-policy"] ?? "";
  expect(policy, "the app's enforced policy reaches the browser unchanged").toMatch(/'nonce-[^']+' 'strict-dynamic'/);
  await page.waitForLoadState("load");
  const result = await page.evaluate(() => ({
    ran: (window as unknown as { __cspRan?: Record<string, boolean> }).__cspRan ?? {},
    violations: window.__cspViolations,
  }));
  expect(result.ran).toEqual({ matching: true });
  const blocked = result.violations.filter((entry) => /^script-src(-elem)? inline enforce$/.test(entry));
  expect(blocked, JSON.stringify(result.violations)).toHaveLength(2);
});
