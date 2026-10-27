import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BRAND,
  MARKETING_NAV,
  MENGANTAR_DISCOUNT_TIERS,
  ORDERABLE_COURIERS,
  SAMPLE_LABEL,
  SIGN_IN_URL,
  SIGN_UP_URL,
  SITE_ORIGIN,
  WHATSAPP_URL,
  codSample,
  encodeCode128B,
  estimateCommission,
} from "../../src/lib/marketing-data";

const ROOT_DIR = join(__dirname, "../..");
const FORBIDDEN_KEYWORD = new RegExp(["c", "u", "a", "n"].join(""), "i");

function walkFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      results.push(...walkFiles(full));
    } else if (stat.isFile()) {
      results.push(full);
    }
  }
  return results;
}

describe("Komdigi-clean GeraiExpress marketing rebrand (T-029)", () => {
  it("contains zero occurrences of the blocked keyword across src/ and public/", () => {
    const files = [...walkFiles(join(ROOT_DIR, "src")), ...walkFiles(join(ROOT_DIR, "public"))];
    expect(files.length).toBeGreaterThan(20);

    const violations: string[] = [];
    for (const file of files) {
      const rel = relative(ROOT_DIR, file);
      if (FORBIDDEN_KEYWORD.test(rel)) {
        violations.push(`path: ${rel}`);
      }
      const content = readFileSync(file, "utf8");
      if (FORBIDDEN_KEYWORD.test(content)) {
        violations.push(`content: ${rel}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it("uses GeraiExpress brand identity and avoids /kontak workspace route collision", () => {
    expect(BRAND).toBe("GeraiExpress");
    expect(SITE_ORIGIN).toBe("https://geraiexpress.com");
    expect(SIGN_IN_URL).toBe("/masuk");
    expect(SIGN_UP_URL).toBe("/daftar");
    expect(WHATSAPP_URL).toContain("GeraiExpress");
    expect(FORBIDDEN_KEYWORD.test(WHATSAPP_URL)).toBe(false);
    expect(SAMPLE_LABEL.publicReference).toBe("GX-CONTOH01");

    const hrefs = MARKETING_NAV.map((item) => item.href);
    expect(hrefs).toEqual(["/", "/fitur", "/simulasi", "/cara-kerja", "/hubungi-kami"]);
    expect(hrefs).not.toContain("/kontak");
    expect(MARKETING_NAV.find((item) => item.href === "/simulasi")?.label).toBe("Simulasi margin");
    expect(ORDERABLE_COURIERS.length).toBe(8);
    expect(MENGANTAR_DISCOUNT_TIERS.map((t) => t.discount)).toEqual(["20%", "22,5%", "25%"]);
  });

  it("calculates commission estimates across the 20%, 22.5%, and 25% monthly volume tiers", () => {
    // 40 packages/day = 1,200/month -> 20% tier; 20% of Rp 17.500 = Rp 3.500/package
    const tier20 = estimateCommission(40, 17_500);
    expect(tier20.monthlyPackages).toBe(1200);
    expect(tier20.activeTierLabel).toBe("20%");
    expect(tier20.perPackageTierIdr).toBe(3500);
    expect(tier20.dailyTierIdr).toBe(140_000);
    expect(tier20.monthlyTierIdr).toBe(4_200_000);
    expect(tier20.yearlyTierIdr).toBe(50_400_000);

    // 100 packages/day = 3,000/month -> 22.5% tier
    const tier225 = estimateCommission(100, 20_000);
    expect(tier225.monthlyPackages).toBe(3000);
    expect(tier225.activeTierLabel).toBe("22,5%");
    expect(tier225.perPackageTierIdr).toBe(4500);
    expect(tier225.monthlyTierIdr).toBe(13_500_000);

    // 200 packages/day = 6,000/month -> 25% tier
    const tier25 = estimateCommission(200, 20_000);
    expect(tier25.monthlyPackages).toBe(6000);
    expect(tier25.activeTierLabel).toBe("25%");
    expect(tier25.perPackageTierIdr).toBe(5000);
    expect(tier25.monthlyTierIdr).toBe(30_000_000);
  });

  it("computes integer COD round-up and Code 128 B bars for the sample thermal label", () => {
    const sample = codSample(100_000, 15_000);
    expect(sample.codIdr).toBe(118_962);
    expect(sample.mengantarFeeIdr).toBe(3961);
    expect(sample.disbursementIdr).toBe(100_001);
    expect(sample.labelOngkirIdr).toBe(18_962);

    const barcode = encodeCode128B(SAMPLE_LABEL.awb);
    expect(barcode.bars.length).toBeGreaterThan(30);
    expect(barcode.modules).toBeGreaterThan(150);
  });
});
