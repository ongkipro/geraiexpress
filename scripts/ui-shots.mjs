// Local review helper: signs in with a seeded fixture account (or a demo session) and saves one
// screenshot per path and width, plus the document overflow. Local gxdb fixtures only; never point it
// at a shared or remote origin.
// Usage: node scripts/ui-shots.mjs <baseUrl> <demo|owner-a|operator|admin> <outDir> <path>...
//   WIDTHS=390,768,1280 (default)  FULL=1 for full-page captures
import { mkdirSync } from "node:fs";
import { chromium } from "@playwright/test";

const [base, mode, outDir, ...paths] = process.argv.slice(2);
if (!base || !mode || !outDir || !paths.length) {
  console.error("usage: ui-shots.mjs <baseUrl> <demo|owner-a|operator|admin> <outDir> <path>...");
  process.exit(2);
}
if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(base)) {
  console.error("ui-shots: refusing a non-local origin");
  process.exit(2);
}
const widths = (process.env.WIDTHS ?? "390,768,1280").split(",").map(Number);
const PASSWORD = "geraiexpress-local-dev";
const EMAILS = { "owner-a": "owner-a@geraiexpress.test", operator: "operator-a@geraiexpress.test", admin: "admin@geraiexpress.test" };
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
let failed = false;
for (const width of widths) {
  const context = await browser.newContext({ viewport: { width, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(`${base}/masuk`);
  if (mode === "demo") {
    await page.getByRole("button", { name: "Coba demo" }).click();
  } else {
    await page.getByRole("textbox", { name: "Email" }).fill(EMAILS[mode]);
    await page.getByLabel("Kata sandi").fill(PASSWORD);
    await page.getByRole("button", { name: "Masuk", exact: true }).click();
  }
  await page.waitForURL((url) => !url.pathname.endsWith("/masuk"), { timeout: 30_000 });
  for (const path of paths) {
    const res = await page.goto(base + path, { waitUntil: "load" });
    await page.waitForTimeout(300);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    const file = `${outDir}/${path.replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "") || "root"}-${width}.png`;
    await page.screenshot({ path: file, fullPage: process.env.FULL === "1" });
    console.log(`${width}px ${path} status=${res?.status()} overflow=${overflow} -> ${file}`);
    if (!res?.ok() || overflow > 1) failed = true;
  }
  if (errors.length) console.log(`${width}px console errors: ${errors.slice(0, 3).join(" | ")}`);
  await context.close();
}
await browser.close();
process.exit(failed ? 1 : 0);
