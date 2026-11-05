import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  BRAND,
  MARKETING_NAV,
  ORDERABLE_COURIERS,
  PRODUCTION_HOSTS,
  SIGN_IN_URL,
  SIGN_UP_URL,
  SITE_ORIGIN,
  WHATSAPP_URL,
  isProductionHost,
  robotsFor,
} from "../../src/lib/marketing-data";
import { COURIER_NAME } from "../../src/lib/format";
import { DROP_OFF_UNSUPPORTED, OFFERED_COURIERS } from "../../src/lib/mengantar/public-api";

const ROOT_DIR = join(__dirname, "../..");
const FORBIDDEN_KEYWORD = new RegExp(["c", "u", "a", "n"].join(""), "i");

// Sources that make public claims (PR-35, T-036).
const MARKETING_SOURCES = [
  "src/app/page.tsx",
  "src/app/fitur/page.tsx",
  "src/app/simulasi/page.tsx",
  "src/app/cara-kerja/page.tsx",
  "src/app/hubungi-kami/page.tsx",
  "src/components/marketing/marketing-shell.tsx",
  "src/components/marketing/tariff-example.tsx",
  // The home page sections and hero visual moved out of src/app/page.tsx (C10); they stay under the claim rules.
  "src/components/marketing/home-page.tsx",
  "src/components/marketing/counter-preview.tsx",
  "src/components/marketing/counter-steps.ts",
  "src/components/marketing/contacts-preview.tsx",
];

const hostState = vi.hoisted(() => ({ host: null as string | null }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(hostState.host ? { host: hostState.host } : {}),
}));

function walkFiles(dir: string): string[] {
  const results: string[] = [];
  // `public/` is optional: the app ships no static assets after the edge `_headers` file was removed.
  if (!existsSync(dir)) return results;
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

function marketingText(): { rel: string; text: string }[] {
  return [...MARKETING_SOURCES, "src/lib/marketing-data.ts"].map((rel) => ({
    rel,
    text: readFileSync(join(ROOT_DIR, rel), "utf8"),
  }));
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

    const hrefs = MARKETING_NAV.map((item) => item.href);
    expect(hrefs).toEqual(["/", "/fitur", "/simulasi", "/cara-kerja", "/hubungi-kami"]);
    expect(hrefs).not.toContain("/kontak");
  });
});

describe("Public marketing claims are approved and implemented (PR-35, T-036)", () => {
  it("publishes no percentage, commission/discount/COD-fee/insurance/payout term, free-of-charge claim or partnership claim anywhere in src/ or public/", () => {
    const banned: [string, RegExp][] = [
      ["percentage figure", /\d[\d.,]*\s*%/],
      // Legacy tier or fee figures and spelled-out percentages (persen, percent) in public copy.
      ["legacy tier or fee figure", /22,5|3,33|333n|333\s*bps|\bbps\b|\bpersen\b|\bpercent\b/i],
      ["free-of-charge claim", /\bgratis\b/i],
      ["payout/insurance term", /cair setiap hari|mengasuransikan|fee COD Mengantar|Pencairan COD|ongkir pulang/i],
      ["earnings claim", /laba toko|tambahan laba|komisi bersih|komisi \d|Rp\s?\d[\d.]*\s?(ribu|juta)/i],
      [
        "partnership or endorsement claim",
        /dikembangkan bersama|kemitraan|bermitra|mitra resmi|jaringan resmi|partner resmi|official partner/i,
      ],
    ];
    const files = [...walkFiles(join(ROOT_DIR, "src")), ...walkFiles(join(ROOT_DIR, "public"))].filter((file) =>
      /\.(tsx?|css|json|txt|html|svg|md)$/.test(file),
    );
    const marketingFiles = new Set(marketingText().map(({ rel }) => join(ROOT_DIR, rel)));
    const violations: string[] = [];
    for (const file of files) {
      const content = readFileSync(file, "utf8");
      for (const [label, pattern] of banned) {
        // Layout, pricing and Super Admin code elsewhere in src/ carries percentages and names basis
        // points; the figure rules are about public marketing copy only.
        if ((label === "percentage figure" || label === "legacy tier or fee figure") && !marketingFiles.has(file)) continue;
        if (pattern.test(content)) violations.push(`${label}: ${relative(ROOT_DIR, file)}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it("no longer exports the commission simulator, discount tiers or the COD fee sample", async () => {
    const mod = (await import("../../src/lib/marketing-data")) as Record<string, unknown>;
    for (const removed of [
      "estimateCommission",
      "MENGANTAR_DISCOUNT_TIERS",
      "codSample",
      "SAMPLE_LABEL",
      "MENGANTAR_URL",
      "QUOTE_ONLY_COURIERS",
    ]) {
      expect(mod[removed], removed).toBeUndefined();
    }
  });

  it("does not present unimplemented capabilities as available", () => {
    const claims: [string, RegExp][] = [
      ["scheduled pickup", /jadwalkan|jemput ke toko|kurir (resmi )?(datang|jemput)|penjemputan paket/i],
      ["thermal label or receipt printing", /thermal|cetak resi|nota |invoice|struk/i],
      ["WhatsApp resi", /kirim resi|resi (via|ke) whatsapp|nomor resi ke whatsapp/i],
      ["automatic status tracking", /pelacakan|dilacak|status kiriman mengikuti|otomatis.*status/i],
      ["COD payout report or CSV", /csv|laporan uang|uang gerai|pencairan/i],
      ["return or cancellation page", /halaman retur|paket retur|pembatalan kiriman/i],
      ["volumetric pricing", /ukuran kardus|panjang, lebar|selisih berat|anti-nombok/i],
    ];
    const violations: string[] = [];
    for (const { rel, text } of marketingText()) {
      for (const [label, pattern] of claims) {
        if (pattern.test(text)) violations.push(`${label}: ${rel}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it("describes the drop-off scope and the simulated demo on the public pages", () => {
    const home = readFileSync(join(ROOT_DIR, "src/app/page.tsx"), "utf8");
    const features = readFileSync(join(ROOT_DIR, "src/app/fitur/page.tsx"), "utf8");
    const flow = readFileSync(join(ROOT_DIR, "src/app/cara-kerja/page.tsx"), "utf8");
    for (const text of [home, features, flow]) {
      expect(text).toMatch(/drop-off/i);
      expect(text).toMatch(/simulasi/i);
    }
    expect(features).not.toMatch(/label resi (sungguhan )?dicetak/i);
  });

  it("lists only couriers the application offers, derived from OFFERED_COURIERS and DROP_OFF_UNSUPPORTED", () => {
    expect(ORDERABLE_COURIERS.length).toBeGreaterThan(0);
    for (const courier of ORDERABLE_COURIERS) {
      expect(OFFERED_COURIERS.has(courier.code), courier.code).toBe(true);
      expect(DROP_OFF_UNSUPPORTED.has(courier.code), courier.code).toBe(false);
    }
    expect(ORDERABLE_COURIERS.map((courier) => courier.code).sort()).toEqual(
      [...OFFERED_COURIERS].filter((code) => !DROP_OFF_UNSUPPORTED.has(code)).sort(),
    );
    // A courier added to the application without a display name would vanish from the public list.
    for (const code of OFFERED_COURIERS) expect(COURIER_NAME[code], code).toBeTruthy();
    // Couriers the application refuses or never quotes are not named in public page copy.
    const names = ORDERABLE_COURIERS.map((courier) => courier.name);
    expect(names).not.toContain("AnterAja");
    for (const { rel, text } of marketingText().filter((file) => file.rel !== "src/lib/marketing-data.ts")) {
      expect(text, rel).not.toMatch(/AnterAja|Paxel|Kargo|Cargo|Ninja/i);
      expect(text, rel).not.toMatch(/\d+\+\s*layanan/i);
    }
  });

  it("detects the production host only on the production host list", () => {
    expect(PRODUCTION_HOSTS).toEqual(["geraiexpress.com"]);
    expect(isProductionHost("geraiexpress.com")).toBe(true);
    expect(isProductionHost("GeraiExpress.com:443")).toBe(true);
    for (const host of [
      "geraiexpress-preview.example.workers.dev",
      "staging.geraiexpress.com",
      "app.geraiexpress.com",
      "geraiexpress.com.evil.example",
      "localhost:3203",
      "",
      null,
      undefined,
    ]) {
      expect(isProductionHost(host), String(host)).toBe(false);
    }
  });

  it("publishes index rules and the sitemap only on the production host, and disallows everything elsewhere", async () => {
    const production = robotsFor("geraiexpress.com");
    expect(production.sitemap).toBe("https://geraiexpress.com/sitemap.xml");
    expect(production.rules).toEqual({
      userAgent: "*",
      allow: ["/", "/fitur", "/simulasi", "/cara-kerja", "/hubungi-kami"],
      disallow: [
        "/lacak",
        "/pengiriman",
        "/kas",
        "/kontak",
        "/pengaturan",
        "/anggota",
        "/admin",
        "/api",
        "/masuk",
        "/daftar",
        "/undangan",
        "/verifikasi-2fa",
        "/akses",
        "/pilih-gerai",
      ],
    });
    expect(robotsFor("geraiexpress-preview.example.workers.dev")).toEqual({
      rules: { userAgent: "*", disallow: "/" },
    });

    const { default: robots } = await import("../../src/app/robots");
    hostState.host = "geraiexpress.com";
    expect((await robots()).sitemap).toBe("https://geraiexpress.com/sitemap.xml");
    hostState.host = "staging.geraiexpress.com";
    expect(await robots()).toEqual({ rules: { userAgent: "*", disallow: "/" } });
    hostState.host = null;
    expect(await robots()).toEqual({ rules: { userAgent: "*", disallow: "/" } });
  });

  it("keeps the sitemap, canonical URLs and Open Graph metadata on the production origin", async () => {
    const { default: sitemap } = await import("../../src/app/sitemap");
    expect(sitemap().map((entry) => entry.url)).toEqual([
      "https://geraiexpress.com",
      "https://geraiexpress.com/fitur",
      "https://geraiexpress.com/simulasi",
      "https://geraiexpress.com/cara-kerja",
      "https://geraiexpress.com/hubungi-kami",
    ]);

    const marketingPages: [string, string][] = [
      ["src/app/page.tsx", "/"],
      ["src/app/fitur/page.tsx", "/fitur"],
      ["src/app/simulasi/page.tsx", "/simulasi"],
      ["src/app/cara-kerja/page.tsx", "/cara-kerja"],
      ["src/app/hubungi-kami/page.tsx", "/hubungi-kami"],
    ];

    for (const [relPath, canonicalPath] of marketingPages) {
      const source = readFileSync(join(ROOT_DIR, relPath), "utf8");
      expect(source).toContain("robots: { index: true, follow: true }");
      expect(source).toContain(`alternates: { canonical: "${canonicalPath}" }`);
      expect(source).toContain(`url: "https://geraiexpress.com${canonicalPath === "/" ? "/" : canonicalPath}"`);
      expect(source).toContain('siteName: "GeraiExpress"');
      expect(source).toContain('locale: "id_ID"');
      expect(source).toContain('type: "website"');
    }
  });
});
