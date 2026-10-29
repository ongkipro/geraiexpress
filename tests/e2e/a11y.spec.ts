// T-073 / UX-15 items 3 to 5 / NFR-4: keyboard, focus, reflow and zoom quality on the redesigned routes, at
// the 390, 768 and 1280 projects. Checks are computed from the live DOM (no hard-coded control lists):
//  (1) Tab order equals DOM (reading) order for the first focus stops, and every stop shows a focus ring;
//  (2) every dialog or sheet trigger on the page opens with Enter, closes with Escape and returns focus;
//  (3) while tabbing the intake and detail pages no focused control is fully covered by a sticky bar
//      (WCAG 2.4.11);
//  (4) at a 320 px viewport no page scrolls horizontally, and any inner scroll container is a labelled
//      region (WCAG 1.4.10) — run once, in the mobile-390 project;
//  (5) at 200% zoom (1280x900 at zoom 2 = a 640x450 CSS viewport with device scale 2) key actions, badges and
//      labels on intake, detail, label and invoice are unclipped and reachable — run once, in desktop-1280;
//  (6) T-079 app header: from 768 px the account menu opens with Enter/Space, moves with arrows/End, closes
//      with Escape back to its trigger and runs an action by keyboard; the global search submits with Enter;
//      below 768 px the search sheet opens with its field focused; the platform header has no gerai actions.
// Fixtures: the seeded draft GXTEST-A1, a synthetic real issued shipment of Gerai Uji A inserted with local
// SQL (deleted afterwards), the demo workspace's seeded issued and unknown shipments, and the fixture admin.
import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { localSql, sessionUserId, signIn, signInAdmin, startDemo } from "./helpers";

const TENANT_A = "00000000-0000-4000-b000-00000000000a";
const OUTLET_A = "00000000-0000-4000-c000-00000000000a";
const OWNER_A = "00000000-0000-4000-a000-0000000000a1";
const DRAFT_A1 = "00000000-0000-4000-e000-00000000000a"; // GXTEST-A1 (db/seed.sql)
const STOPS = 15;

let issuedA = "";

test.beforeAll(() => {
  issuedA = randomUUID();
  const quote = randomUUID();
  localSql(`
    update public.tenants set contact_whatsapp = '081355550000', contact_whatsapp_revision = 0, masking_allowed = true where id = '${TENANT_A}';
    insert into public.shipments (tenant_id, outlet_id, id, reference, submission_state, payment_state, sender_name, sender_phone,
      recipient_name, recipient_phone, recipient_address, recipient_area, recipient_postal_code, item_description, weight_grams,
      goods_value_idr, is_cod, cod_amount_idr, is_simulated, created_by, submitted_at, issued_at, awb, customer_charge_idr, pickup_snapshot)
    values ('${TENANT_A}', '${OUTLET_A}', '${issuedA}', 'A11Y-${issuedA.slice(0, 6).toUpperCase()}', 'issued', 'paid', 'Pengirim Asli', '081200000099',
      'Penerima Uji', '+6281234567890', 'Jl. Tujuan Uji No. 9', 'Kec. Tujuan, Kota Uji', '40132', 'Buku', 1500, 50000, true, 125000, false,
      '${OWNER_A}', now(), now(), 'JP1234567890', 24680,
      jsonb_build_object('outlet', 'Pickup Mengantar Rahasia', 'address', 'Jl. Pickup Nyata No. 5', 'area', 'Kec. Pickup, Kota Nyata'));
    insert into public.shipment_quotes (tenant_id, shipment_id, id, shipment_revision, courier, service, normal_tariff_idr, eta_days, is_simulated, expires_at)
      values ('${TENANT_A}', '${issuedA}', '${quote}', 1, 'JT', 'REG', 24680, '1-2', false, now() + interval '1 hour');
    update public.shipments set selected_quote_id = '${quote}' where id = '${issuedA}';`);
});

test.afterAll(() => {
  if (issuedA) localSql(`update public.shipments set selected_quote_id = null where id = '${issuedA}'; delete from public.shipments where id = '${issuedA}'`);
  localSql(`update public.tenants set contact_whatsapp = null, contact_whatsapp_revision = 0 where id = '${TENANT_A}'`);
});

// The loaded pages may be slow on a busy machine: wait for the main landmark, not a fixed time.
async function open(page: Page, path: string) {
  await page.goto(path);
  await expect(page.locator("main").first()).toBeVisible({ timeout: 20_000 });
}

type Stop = { index: number; name: string; ring: boolean; covered: string | null };

// Runs in the page: the tabbable elements in DOM order (what sequential focus navigation must follow when
// no positive tabindex is used), with one stop per native radio group, and a readable name for each.
declare global {
  interface Window {
    __a11yTabbables(): HTMLElement[];
    __a11yName(el: Element): string;
    __a11yRing(el: Element): boolean;
    __a11yCovered(el: Element): string | null;
    __a11yList: HTMLElement[];
    __a11yComposite: string;
  }
}

const PAGE_HELPERS = () => {
  const visible = (el: Element) => {
    if (!el.getClientRects().length) return false;
    if (getComputedStyle(el).visibility === "hidden") return false;
    const closed = el.closest("details:not([open])");
    return !closed || (el.tagName === "SUMMARY" && el.parentElement === closed);
  };
  const name = (el: Element) => {
    const by = el.getAttribute("aria-labelledby");
    const labelled = by ? by.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? "").join(" ") : "";
    const labels = "labels" in el && el.labels instanceof NodeList ? [...el.labels].map((l) => l.textContent ?? "").join(" ") : "";
    const text = el instanceof HTMLElement ? el.innerText : el.textContent ?? "";
    const raw = el.getAttribute("aria-label") || labelled || labels || text || el.getAttribute("title") || el.getAttribute("placeholder") || el.tagName.toLowerCase();
    return raw.replace(/\s+/g, " ").trim().slice(0, 60);
  };
  // A composite widget (radio group, toolbar, tab list, ...) is one Tab stop: arrow keys move inside it
  // (Radix roving focus, native radio groups). It counts when it holds a tabbable or a roving item.
  const COMPOSITE = "[role=radiogroup], [role=toolbar], [role=tablist], [role=menubar], [role=grid], [role=tree]";
  window.__a11yComposite = COMPOSITE;
  window.__a11yTabbables = () => {
    const focusable = "a[href], area[href], button, input, select, textarea, summary, iframe, [tabindex], [contenteditable='true']";
    const tabbable = (el: HTMLElement) =>
      !el.matches(":disabled") && el.tabIndex >= 0 && !el.closest("[inert]") && !el.matches("input[type=hidden]") && visible(el);
    const stops = [...document.querySelectorAll<HTMLElement>(`${focusable}, ${COMPOSITE}`)].filter((el) => {
      if (el.matches(COMPOSITE)) {
        return visible(el) && !el.closest("[inert]")
          && [...el.querySelectorAll<HTMLElement>(focusable)].some((item) => tabbable(item) || (item.matches("[data-radix-collection-item]") && !item.matches(":disabled")));
      }
      return !el.parentElement?.closest(COMPOSITE) && tabbable(el);
    });
    // A native radio group outside a composite role is still one stop: the checked radio, else the first.
    const seenRadio = new Set<string>();
    return stops.filter((el) => {
      if (!(el instanceof HTMLInputElement) || el.type !== "radio" || !el.name) return true;
      const group = stops.filter((o): o is HTMLInputElement => o instanceof HTMLInputElement && o.type === "radio" && o.name === el.name && o.form === el.form);
      const key = `${el.form?.id ?? ""}|${el.name}`;
      if (seenRadio.has(key) || (group.find((o) => o.checked) ?? group[0]) !== el) return false;
      seenRadio.add(key);
      return true;
    });
  };
  window.__a11yName = name;
  // A focus ring is an outline (not transparent, width > 0) or a box-shadow on the control or on the label
  // that wraps it (radio cards draw the ring on the label with :has(:focus-visible)).
  window.__a11yRing = (el: Element) => {
    const shows = (node: Element | null) => {
      if (!node) return false;
      const s = getComputedStyle(node);
      const outline = s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0 && !/rgba\([^)]*,\s*0\)|transparent/.test(s.outlineColor);
      return outline || (s.boxShadow !== "none" && s.boxShadow !== "");
    };
    return shows(el) || shows(el.closest("label"));
  };
  // WCAG 2.4.11: the focused control is fully hidden when every sample point inside it lands on a sticky or
  // fixed element that does not contain it.
  window.__a11yCovered = (el: Element) => {
    const r = el.getBoundingClientRect();
    const xs = [r.left + 2, r.left + r.width / 2, r.right - 2];
    const ys = [r.top + 2, r.top + r.height / 2, r.bottom - 2];
    let inside = 0;
    let hidden = 0;
    let by = "";
    for (const x of xs) for (const y of ys) {
      if (x < 0 || y < 0 || x >= window.innerWidth || y >= window.innerHeight) continue;
      inside++;
      const hit = document.elementFromPoint(x, y);
      if (!hit || el.contains(hit) || hit.contains(el)) continue;
      for (let n: Element | null = hit; n; n = n.parentElement) {
        const p = getComputedStyle(n).position;
        if ((p === "sticky" || p === "fixed") && !n.contains(el)) {
          hidden++;
          by = n.tagName.toLowerCase() + (n.getAttribute("aria-label") ? `[${n.getAttribute("aria-label")}]` : "");
          break;
        }
      }
    }
    if (inside === 0) return "outside the viewport";
    return hidden === inside ? `covered by ${by}` : null;
  };
};

async function installHelpers(page: Page) {
  await page.evaluate(PAGE_HELPERS);
}

// (1) and (3): Tab from the top of the document through the first stops.
async function tabStops(page: Page, count: number): Promise<{ expected: string[]; stops: Stop[] }> {
  await installHelpers(page);
  const expected = await page.evaluate((n) => {
    window.scrollTo(0, 0);
    const list = window.__a11yTabbables();
    window.__a11yList = list;
    // Start sequential navigation at the document start.
    document.body.setAttribute("tabindex", "-1");
    document.body.focus();
    document.body.removeAttribute("tabindex");
    return list.slice(0, n).map((el, i) => `${i}: ${window.__a11yName(el)}`);
  }, count);
  const stops: Stop[] = [];
  for (let i = 0; i < expected.length; i++) {
    await page.keyboard.press("Tab");
    stops.push(await page.evaluate(() => {
      const el = document.activeElement;
      if (!(el instanceof HTMLElement) || el === document.body) return { index: -1, name: "(body)", ring: false, covered: null };
      const index = window.__a11yList.indexOf(el.closest<HTMLElement>(window.__a11yComposite) ?? el);
      return { index, name: window.__a11yName(window.__a11yList[index] ?? el), ring: window.__a11yRing(el), covered: window.__a11yCovered(el) };
    }));
  }
  return { expected, stops };
}

async function expectTabOrder(page: Page, label: string, opts: { sticky?: boolean; count?: number } = {}) {
  const { expected, stops } = await tabStops(page, opts.count ?? STOPS);
  expect(expected.length, `${label}: focusable controls found`).toBeGreaterThan(0);
  const actual = stops.map((s) => `${s.index}: ${s.name}`);
  expect(actual, `${label}: Tab order follows DOM order`).toEqual(expected);
  const ringless = stops.filter((s) => !s.ring).map((s) => s.name);
  expect(ringless, `${label}: every focus stop shows a focus ring`).toEqual([]);
  if (opts.sticky) {
    const covered = stops.filter((s) => s.covered).map((s) => `${s.name} (${s.covered})`);
    expect(covered, `${label}: no focused control is fully covered by a sticky bar`).toEqual([]);
  }
}

// (2): every visible dialog/sheet trigger (aria-haspopup=dialog), once per accessible name.
async function expectDialogsEscape(page: Page, label: string) {
  const triggers = page.locator("[aria-haspopup='dialog']").filter({ visible: true });
  const count = await triggers.count();
  const seen = new Set<string>();
  for (let i = 0; i < count; i++) {
    const trigger = triggers.nth(i);
    if (await trigger.isDisabled()) continue;
    const key = ((await trigger.getAttribute("aria-label")) ?? (await trigger.innerText())).replace(/\s+/g, " ").trim();
    if (seen.has(key)) continue;
    seen.add(key);
    await trigger.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog");
    await expect(dialog, `${label}: "${key}" opens a dialog`).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog, `${label}: Escape closes "${key}"`).toHaveCount(0);
    await expect(trigger, `${label}: focus returns to "${key}"`).toBeFocused();
  }
  // Recorded on the test so the report shows which triggers were exercised at this width.
  test.info().annotations.push({ type: "dialogs", description: `${label}: ${[...seen].join(" | ") || "none"}` });
}

// (4): document reflow at the current viewport, and inner scroll containers must be labelled regions.
// Polled: client components size some content after hydration (the print preview scales to fit).
async function expectReflow(page: Page, label: string) {
  await expect.poll(() => page.evaluate(() => {
    const problems: string[] = [];
    const overflow = document.documentElement.scrollWidth - window.innerWidth;
    if (overflow > 0) problems.push(`document scrolls horizontally by ${overflow}px`);
    for (const el of document.querySelectorAll<HTMLElement>("body *")) {
      const s = getComputedStyle(el);
      if (!/(auto|scroll)/.test(s.overflowX) || el.scrollWidth <= el.clientWidth + 1 || !el.getClientRects().length) continue;
      // A labelled scroll region: the container (or the landmark/group directly around it) has a role and a name.
      const named = (n: Element | null) => !!n && !!n.getAttribute("role") && !!(n.getAttribute("aria-label") || n.getAttribute("aria-labelledby"));
      const landmark = (n: Element | null) => !!n && (n.tagName === "NAV" || n.tagName === "SECTION") && !!(n.getAttribute("aria-label") || n.getAttribute("aria-labelledby"));
      if (named(el) || landmark(el) || landmark(el.parentElement) || named(el.parentElement)) continue;
      problems.push(`unlabelled scroll container ${el.tagName.toLowerCase()}.${el.className.toString().split(/\s+/).slice(0, 4).join(".")} (${el.scrollWidth}>${el.clientWidth})`);
    }
    return problems;
  }), { message: `${label}: no horizontal overflow outside labelled scroll regions`, timeout: 15_000 }).toEqual([]);
}

// (5): in the main content, actions, badges and labels are not clipped, and every action can be scrolled
// into view with its centre reachable (not under a sticky bar). Print sheets are documents, not UI, and
// shrink their own text by design; they are excluded.
async function expectUnclipped(page: Page, label: string) {
  await installHelpers(page);
  const problems = await page.evaluate(async () => {
    const out: string[] = [];
    const main = document.querySelector("main");
    if (!main) return ["no main"];
    const targets = [...main.querySelectorAll<HTMLElement>("button, a[href], [data-slot='badge'], label, h1, h2, [role='status'], [role='alert']")]
      .filter((el) => el.getClientRects().length && getComputedStyle(el).visibility !== "hidden" && !el.closest(".sr-only")
        && !el.closest("[data-testid='label-sheet'], [data-testid='invoice-sheet'], [aria-label='Label contoh']"));
    const name = window.__a11yName;
    for (const el of targets) {
      const s = getComputedStyle(el);
      if (s.overflowX !== "visible" || s.overflowY !== "visible" || s.textOverflow === "ellipsis") {
        if (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1) out.push(`clipped text: ${name(el)}`);
      }
      const r = el.getBoundingClientRect();
      for (let n = el.parentElement; n && n !== main.parentElement; n = n.parentElement) {
        const ps = getComputedStyle(n);
        if (!/(hidden|clip)/.test(ps.overflowX + ps.overflowY)) continue;
        if (/(auto|scroll)/.test(ps.overflowX + ps.overflowY)) break;
        const pr = n.getBoundingClientRect();
        if (r.left < pr.left - 1 || r.right > pr.right + 1 || r.top < pr.top - 1 || r.bottom > pr.bottom + 1) {
          out.push(`cut by an overflow-hidden parent: ${name(el)}`);
          break;
        }
      }
    }
    for (const el of targets.filter((t) => t.matches("button, a[href]"))) {
      el.scrollIntoView({ block: "center", inline: "nearest" });
      const frame = Promise.withResolvers<number>();
      requestAnimationFrame(frame.resolve);
      await frame.promise;
      const r = el.getBoundingClientRect();
      const x = Math.min(Math.max(r.left + r.width / 2, 0), window.innerWidth - 1);
      const y = Math.min(Math.max(r.top + r.height / 2, 0), window.innerHeight - 1);
      const hit = document.elementFromPoint(x, y);
      if (r.right <= 0 || r.left >= window.innerWidth) out.push(`off-screen action: ${name(el)}`);
      else if (!hit || !(el.contains(hit) || hit.contains(el) || hit.closest("label")?.contains(el))) out.push(`action not reachable: ${name(el)}`);
    }
    window.scrollTo(0, 0);
    return out;
  });
  expect(problems, `${label}: actions, badges and labels unclipped and reachable`).toEqual([]);
}

async function demoShipments(page: Page) {
  const user = await sessionUserId(page);
  const rows = localSql(`select s.submission_state || '=' || s.id from public.shipments s join public.memberships m on m.tenant_id = s.tenant_id
    where m.user_id = '${user}' and s.submission_state in ('issued', 'unknown') order by s.created_at`).split("\n");
  const pick = (state: string) => rows.find((r) => r.startsWith(`${state}=`))?.split("=")[1] ?? "";
  const issued = pick("issued"), unknown = pick("unknown");
  expect(issued, "demo issued shipment").not.toBe("");
  expect(unknown, "demo unknown shipment").not.toBe("");
  return { issued, unknown };
}

test.describe("keyboard and focus (UX-15 item 5)", () => {
  test("sign-in page", async ({ page }) => {
    await open(page, "/masuk");
    await expectTabOrder(page, "/masuk");
    await expectDialogsEscape(page, "/masuk");
  });

  test("gerai pages: list, draft intake, label, invoice, settings, contacts", async ({ page }) => {
    test.setTimeout(240_000);
    await signIn(page, "owner-a@geraiexpress.test");
    for (const path of ["/pengiriman", "/pengaturan", "/kontak", `/pengiriman/${issuedA}/label`, `/pengiriman/${issuedA}/invoice`]) {
      await open(page, path);
      await expectTabOrder(page, path);
      await expectDialogsEscape(page, path);
    }
    // The intake is tabbed further, past the sticky bottom bar, for WCAG 2.4.11.
    await open(page, `/pengiriman/${DRAFT_A1}`);
    await expect(page.getByLabel("Nama pengirim")).toBeVisible();
    await expectTabOrder(page, "intake GXTEST-A1", { sticky: true, count: 40 });
    await expectDialogsEscape(page, "intake GXTEST-A1");
  });

  test("demo shipment detail: issued and unknown", async ({ page }) => {
    test.setTimeout(180_000);
    await startDemo(page);
    const { issued, unknown } = await demoShipments(page);
    for (const [state, id] of [["issued", issued], ["unknown", unknown]] as const) {
      await open(page, `/pengiriman/${id}`);
      await expectTabOrder(page, `detail ${state}`, { sticky: true, count: 30 });
      await expectDialogsEscape(page, `detail ${state}`);
    }
  });

  test("mobile top bar: the search opens in a sheet with the field focused and submits with Enter (T-079)", async ({ page }) => {
    test.skip((page.viewportSize()?.width ?? 1280) >= 768, "from 768 px the search is a field in the app header");
    test.setTimeout(120_000);
    await startDemo(page);
    const trigger = page.getByRole("button", { name: "Cari pengiriman" });
    await trigger.focus();
    await page.keyboard.press("Enter");
    const sheet = page.getByRole("dialog", { name: "Cari pengiriman" });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole("searchbox", { name: "Cari pengiriman" })).toBeFocused();
    await page.keyboard.type("DEMO-");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/pengiriman\?q=DEMO-$/);
    await expect(sheet).toHaveCount(0);
    await expect(page.getByText("Cari: “DEMO-”")).toBeVisible();
  });

  test("app header: the account menu works by keyboard and the search submits with Enter (T-079)", async ({ page }) => {
    test.skip((page.viewportSize()?.width ?? 1280) < 768, "below 768 px the search is a sheet (checked as a dialog) and the session actions sit in the menu sheet");
    test.setTimeout(120_000);
    await startDemo(page);
    const trigger = page.getByRole("button", { name: "Menu akun" });
    const menu = page.getByRole("menu");
    // Enter opens the menu on its first item; arrows move; Escape closes and returns focus to the trigger.
    await trigger.focus();
    await page.keyboard.press("Enter");
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "Atur ulang demo" })).toBeFocused();
    await expect(menu.getByRole("menuitem", { name: "Ganti gerai" })).toHaveCount(0);
    await page.keyboard.press("ArrowDown");
    await expect(menu.getByRole("menuitem", { name: "Keluar" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(trigger, "focus returns to the account menu trigger").toBeFocused();
    // Space opens it as well.
    await page.keyboard.press("Space");
    await expect(menu).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(trigger).toBeFocused();

    // The global search submits with Enter to the filtered shipment list.
    const search = page.getByRole("searchbox", { name: "Cari pengiriman" });
    await search.focus();
    await page.keyboard.type("DEMO-");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/pengiriman\?q=DEMO-$/);

    // A menu action runs from the keyboard: End moves to "Keluar", Enter signs out.
    await trigger.focus();
    await page.keyboard.press("Enter");
    await expect(menu).toBeVisible();
    await page.keyboard.press("End");
    await expect(menu.getByRole("menuitem", { name: "Keluar" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/masuk$/);
  });

  test("platform admin overview", async ({ page }) => {
    test.setTimeout(180_000);
    await signInAdmin(page);
    await open(page, "/admin");
    await expectTabOrder(page, "/admin");
    await expectDialogsEscape(page, "/admin");
    // The registration gate is a switch that opens its confirmation (not a dialog trigger button).
    const gate = page.getByRole("switch", { name: "Pendaftaran publik" });
    await gate.focus();
    await page.keyboard.press("Space");
    await expect(page.getByRole("dialog"), "/admin: the registration switch opens its confirmation").toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(gate, "/admin: focus returns to the registration switch").toBeFocused();
    // T-079: the platform header has no gerai search or create action; its account menu only signs out.
    await expect(page.getByRole("searchbox", { name: "Cari pengiriman" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Cari pengiriman" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Buat pengiriman" })).toHaveCount(0);
    if ((page.viewportSize()?.width ?? 1280) >= 768) {
      const trigger = page.getByRole("button", { name: "Menu akun" });
      await trigger.focus();
      await page.keyboard.press("Enter");
      const menu = page.getByRole("menu");
      await expect(menu.getByRole("menuitem")).toHaveCount(1);
      await expect(menu.getByRole("menuitem", { name: "Keluar" })).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(menu).toHaveCount(0);
      await expect(trigger, "/admin: focus returns to the account menu trigger").toBeFocused();
    }
  });
});

test.describe("reflow at 320 px (UX-15 item 3)", () => {
  test.use({ viewport: { width: 320, height: 640 } });

  test("every route reflows without two-dimensional scrolling", async ({ page }, info) => {
    test.skip(info.project.name !== "mobile-390", "runs once, in mobile-390");
    test.setTimeout(300_000);
    await open(page, "/masuk");
    await expectReflow(page, "/masuk");
    await expectUnclipped(page, "/masuk at 320");
    await signIn(page, "owner-a@geraiexpress.test");
    for (const path of ["/pengiriman", `/pengiriman/${DRAFT_A1}`, `/pengiriman/${issuedA}`, `/pengiriman/${issuedA}/label`,
      `/pengiriman/${issuedA}/invoice`, "/pengaturan", "/kontak"]) {
      await open(page, path);
      await expectReflow(page, path);
      await expectUnclipped(page, `${path} at 320`);
    }
    await page.context().clearCookies();
    await startDemo(page);
    const { issued, unknown } = await demoShipments(page);
    for (const id of [issued, unknown]) {
      await open(page, `/pengiriman/${id}`);
      await expectReflow(page, `demo detail ${id}`);
      await expectUnclipped(page, `demo detail ${id} at 320`);
    }
    await page.context().clearCookies();
    await signInAdmin(page);
    await open(page, "/admin");
    await expectReflow(page, "/admin");
    await expectUnclipped(page, "/admin at 320");
  });
});

test.describe("200% zoom (UX-15 item 4)", () => {
  // Browser zoom 200% on a 1280x900 window lays the page out in 640x450 CSS px at device scale 2.
  test.use({ viewport: { width: 640, height: 450 }, deviceScaleFactor: 2 });

  test("intake, detail, label and invoice keep actions, badges and labels unclipped", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop-1280", "runs once, in desktop-1280");
    test.setTimeout(300_000);
    await signIn(page, "owner-a@geraiexpress.test");
    for (const path of [`/pengiriman/${DRAFT_A1}`, `/pengiriman/${issuedA}`, `/pengiriman/${issuedA}/label`, `/pengiriman/${issuedA}/invoice`]) {
      await open(page, path);
      await expectReflow(page, `${path} at 200%`);
      await expectUnclipped(page, `${path} at 200%`);
    }
    await page.context().clearCookies();
    await startDemo(page);
    const { issued, unknown } = await demoShipments(page);
    for (const [state, id] of [["issued", issued], ["unknown", unknown]] as const) {
      await open(page, `/pengiriman/${id}`);
      await expectUnclipped(page, `demo detail ${state} at 200%`);
    }
  });
});
