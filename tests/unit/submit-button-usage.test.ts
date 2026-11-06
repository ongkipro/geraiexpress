import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// T-107 / UX-13: a form that posts to a Server Action submits through the shared SubmitButton (pending
// label, aria-busy, duplicate-click guard). The rule is checked per submit button, not per file:
//  - a raw submit is any <Button>/<button> whose type is "submit" (any quoting) or that has no type at all
//    inside a <form> (the HTML default is submit);
//  - it is allowed only inside a GET form: method="get", a string action="/path" (navigation), or a form with
//    no action at all (submits to the same URL as a GET). A form whose action is a JS expression (a Server
//    Action) never allows one.
// Only the shared component itself is exempt as a file.
const EXEMPT_FILES = new Set(["src/components/submit-button.tsx"]);

const ROOT = join(__dirname, "../..");

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "ui" ? [] : sources(path);
    return path.endsWith(".tsx") ? [path] : [];
  });
}

const files = ["src/app", "src/modules", "src/components"].flatMap((dir) => sources(join(ROOT, dir)));

// Opening tag of each <form>, with the source offsets it spans (to its matching </form>).
function forms(src: string): { open: string; from: number; to: number }[] {
  const out: { open: string; from: number; to: number }[] = [];
  const re = /<form\b[^>]*>/g;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    let depth = 1; let i = m.index + m[0].length;
    const tag = /<form\b[^>]*>|<\/form>/g; tag.lastIndex = i;
    for (let t = tag.exec(src); t; t = tag.exec(src)) {
      depth += t[0] === "</form>" ? -1 : 1;
      if (depth === 0) { i = t.index; break; }
    }
    out.push({ open: m[0], from: m.index, to: i });
  }
  return out;
}

// A function (Server Action) action always posts, whatever `method` says; so it is checked first.
// Attribute whitespace (`action = {save}`) is tolerated.
const isGetForm = (open: string) => {
  if (/\baction\s*=\s*\{/.test(open)) return false;
  return /\bmethod\s*=\s*["']get["']/i.test(open) || /\baction\s*=\s*["']\//.test(open) || !/\baction\s*=/.test(open);
};

// Offending raw submit buttons in one source text (exported shape for the negative fixtures below).
export function rawServerActionSubmits(src: string): string[] {
  const found: string[] = [];
  const fs = forms(src);
  const re = /<(Button|button)\b([^>]*)>/g;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    const attrs = m[2];
    // <Button asChild> renders its child (a link) instead of a button element: never a submit.
    if (/\basChild\b/.test(attrs)) continue;
    const typed = /\btype\s*=\s*\{?\s*["']([a-z]+)["']\s*\}?/.exec(attrs)?.[1];
    const owner = fs.find((f) => m!.index > f.from && m!.index < f.to);
    const external = /\bform\s*=/.test(attrs);
    const submits = typed === "submit" || (typed === undefined && (owner !== undefined || external));
    if (!submits) continue;
    if (owner && !external && isGetForm(owner.open)) continue;
    found.push(m[0].slice(0, 80));
  }
  return found;
}

describe("submit-button usage (T-107)", () => {
  it("uses SubmitButton for every Server Action submit; raw submits only inside GET forms", () => {
    const offenders = files
      .filter((file) => !EXEMPT_FILES.has(relative(ROOT, file)))
      .flatMap((file) => rawServerActionSubmits(readFileSync(file, "utf8")).map((tag) => `${relative(ROOT, file)}: ${tag}`));
    expect(offenders).toEqual([]);
  });

  it("rejects every raw-submit variant in a Server Action form and allows GET forms (negative fixtures)", () => {
    const bad = [
      `<form action={save}><Button type="submit">Simpan</Button></form>`,
      `<form action={save}><button type="submit">Simpan</button></form>`,
      `<form action={save}><Button type='submit'>Simpan</Button></form>`,
      `<form action={save}><Button type={"submit"}>Simpan</Button></form>`,
      `<form action={save}><button>Simpan</button></form>`,
      `<form action={save}><Button variant="outline">Simpan</Button></form>`,
      `<Button type="submit" form="discount-form">Simpan versi</Button>`,
      `<form method="get" action="/x"><Button type="submit">Cari</Button></form><form action={save}><Button type="submit">Simpan</Button></form>`,
      `<form action={save} method="get"><button>Save</button></form>`,
      `<form action = {save}><Button type = "submit">Simpan</Button></form>`,
    ];
    for (const src of bad) expect(rawServerActionSubmits(src), src).not.toEqual([]);
    const good = [
      `<form method="get"><Button type="submit">Terapkan</Button></form>`,
      `<form action="/pengiriman" role="search"><Button type="submit">Terapkan</Button></form>`,
      `<form role="search"><Button type="submit">Cari</Button></form>`,
      `<form action={save}><Button type="button">Batal</Button><SubmitButton>Simpan</SubmitButton></form>`,
      `<Button type="button" onClick={go}>Buka</Button>`,
      `<form action={save}><Button asChild><a href="/x">Muat ulang</a></Button><SubmitButton>Simpan</SubmitButton></form>`,
    ];
    for (const src of good) expect(rawServerActionSubmits(src), src).toEqual([]);
  });

  it("never confirms with the browser's window.confirm (the shared dialog names the object)", () => {
    const offenders = files
      .filter((file) => /window\.confirm\s*\(/.test(readFileSync(file, "utf8")))
      .map((file) => relative(ROOT, file));
    expect(offenders).toEqual([]);
  });
});
