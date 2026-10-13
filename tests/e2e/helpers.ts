import { expect, type Page } from "@playwright/test";

export const FIXTURE_PASSWORD = "geraiexpress-local-dev";

export async function signIn(page: Page, email: string) {
  await page.goto("/masuk");
  await page.getByRole("textbox", { name: "Email" }).fill(email);
  await page.getByLabel("Kata sandi").fill(FIXTURE_PASSWORD);
  await page.getByRole("button", { name: "Masuk", exact: true }).click();
  await page.waitForURL((url) => !url.pathname.endsWith("/masuk"));
}

export async function startDemo(page: Page) {
  await page.goto("/masuk");
  await page.getByRole("button", { name: "Coba demo" }).click();
  await expect(page).toHaveURL(/\/pengiriman$/);
}

export async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, "document must not scroll horizontally").toBeLessThanOrEqual(0);
}

export async function signOut(page: Page) {
  const isMobile = (page.viewportSize()?.width ?? 1280) < 1024;
  if (isMobile) await page.getByRole("button", { name: "Buka menu" }).click();
  await page.getByRole("button", { name: "Keluar" }).click();
  await expect(page).toHaveURL(/\/masuk$/);
}

// UI-2 / NFR-4: every visible interactive control offers at least a 44×44px target.
export async function expectTouchTargets(page: Page) {
  const small = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("a[href], button, select, input:not([type=hidden]), [role=button]")]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        if (r.width === 0 || r.height === 0 || style.visibility === "hidden") return false;
        if (el.closest(".sr-only") || el.classList.contains("sr-only")) return false;
        // A radio/checkbox is exempt when its clickable label provides the target.
        if (el.matches("input[type=radio], input[type=checkbox], button[role=checkbox]")) {
          const label = el.closest("label");
          if (label) {
            const lr = label.getBoundingClientRect();
            return lr.height < 44;
          }
        }
        return r.height < 44 || r.width < 44;
      })
      .map((el) => `${el.tagName.toLowerCase()} "${(el.textContent || el.getAttribute("aria-label") || "").trim().slice(0, 40)}" ${Math.round(el.getBoundingClientRect().width)}×${Math.round(el.getBoundingClientRect().height)}`),
  );
  expect(small, "touch targets below 44px").toEqual([]);
}
