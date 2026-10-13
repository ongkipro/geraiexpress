// Minimal rendered-browser check: page renders at NFR-4 widths without document overflow
// or console errors. Usage: node scripts/ui-smoke.mjs <baseUrl> <path> [expectedText]
import { chromium } from "@playwright/test";

const [base = "http://127.0.0.1:8787", path = "/", expected] = process.argv.slice(2);
const browser = await chromium.launch();
let failed = false;
for (const width of [390, 768, 1280]) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  const errors = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  const res = await page.goto(base + path, { waitUntil: "load" });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  const text = await page.locator("body").innerText();
  const ok = res?.ok() && overflow <= 0 && errors.length === 0 && (!expected || text.includes(expected));
  console.log(`${width}px status=${res?.status()} overflow=${overflow} consoleErrors=${errors.length} ${ok ? "OK" : "FAIL"}`);
  if (!ok) failed = true;
  await page.close();
}
await browser.close();
process.exit(failed ? 1 : 0);
