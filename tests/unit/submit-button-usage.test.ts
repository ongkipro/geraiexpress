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

type Tag = { name: string; attrs: string; text: string; index: number; end: number; selfClosing: boolean };

// Every JSX opening tag with its attribute text. The end of a tag is the first `>` outside quotes and
// outside `{...}` expressions (depth counted), so `onSubmit={(e) => ...}` does not cut a tag short. A `<`
// directly after an identifier character is a type argument (`useState<T>`), not a tag.
export function tagsOf(src: string): Tag[] {
  const out: Tag[] = [];
  for (let i = 0; i < src.length; i += 1) {
    if (src[i] !== "<" || !/[A-Za-z]/.test(src[i + 1] ?? "") || /[\w$.)\]]/.test(src[i - 1] ?? " ")) continue;
    const name = /^[A-Za-z][\w.]*/.exec(src.slice(i + 1))![0];
    let depth = 0; let quote = ""; let j = i + 1 + name.length; let closed = false;
    for (; j < src.length; j += 1) {
      const c = src[j];
      if (quote) { if (c === "\\") j += 1; else if (c === quote) quote = ""; continue; }
      if (c === '"' || c === "'" || c === "`") quote = c;
      else if (c === "{") depth += 1;
      else if (c === "}") depth -= 1;
      else if (c === ">" && depth === 0) { closed = true; break; }
    }
    if (!closed) continue;
    out.push({ name, attrs: src.slice(i + 1 + name.length, j), text: src.slice(i, j + 1), index: i, end: j, selfClosing: src[j - 1] === "/" });
    i = j;
  }
  return out;
}

// The <form> elements with the source offsets they span (to the matching </form>).
function forms(src: string, tags: Tag[]): { open: string; from: number; to: number }[] {
  const events = [
    ...tags.filter((t) => t.name === "form" && !t.selfClosing).map((t) => ({ at: t.index, open: t.text })),
    ...[...src.matchAll(/<\/form>/g)].map((m) => ({ at: m.index!, open: null as string | null })),
  ].sort((x, y) => x.at - y.at);
  const stack: { open: string; from: number }[] = [];
  const out: { open: string; from: number; to: number }[] = [];
  for (const e of events) {
    if (e.open !== null) stack.push({ open: e.open, from: e.at });
    else { const top = stack.pop(); if (top) out.push({ ...top, to: e.at }); }
  }
  return out;
}

// A function (Server Action) action always posts, whatever `method` says; so it is checked first.
// A form with `onSubmit` and no string action posts from script (it is no GET form either).
// Attribute whitespace (`action = {save}`) is tolerated.
const isGetForm = (open: string) => {
  if (/\baction\s*=\s*\{/.test(open)) return false;
  if (/\bonSubmit\s*=/.test(open)) return false;
  return /\bmethod\s*=\s*["']get["']/i.test(open) || /\baction\s*=\s*["']\//.test(open) || !/\baction\s*=/.test(open);
};

// Offending raw submit buttons in one source text (exported shape for the negative fixtures below):
//  - a raw <Button>/<button>/<input type=submit|image> that is not inside a GET form;
//  - a `formAction={...}` on any button or input (it posts even from a GET form);
//  - a <SubmitButton form="..."> without `pending={...}`: useFormStatus only sees an enclosing form.
export function rawServerActionSubmits(src: string): string[] {
  const found: string[] = [];
  const tags = tagsOf(src);
  const fs = forms(src, tags);
  for (const tag of tags) {
    const attrs = tag.attrs;
    const external = /\bform\s*=/.test(attrs);
    if (tag.name === "SubmitButton") {
      if (external && !/\bpending\s*=\s*\{/.test(attrs)) found.push(tag.text.slice(0, 80));
      continue;
    }
    const isInput = tag.name === "input";
    if (tag.name !== "Button" && tag.name !== "button" && !isInput) continue;
    if (/\bformAction\s*=\s*\{/.test(attrs)) { found.push(tag.text.slice(0, 80)); continue; }
    // <Button asChild> renders its child (a link) instead of a button element: never a submit.
    if (/\basChild\b/.test(attrs)) continue;
    const typed = /\btype\s*=\s*\{?\s*["']([a-z]+)["']\s*\}?/.exec(attrs)?.[1];
    const owner = fs.filter((f) => tag.index > f.from && tag.index < f.to).at(-1);
    const submits = isInput ? typed === "submit" || typed === "image"
      : typed === "submit" || (typed === undefined && (owner !== undefined || external));
    if (!submits) continue;
    if (owner && !external && isGetForm(owner.open)) continue;
    found.push(tag.text.slice(0, 80));
  }
  return found;
}

// Server Actions an event handler runs from a transition (`startTransition(async () => fooAction(...))`)
// bypass SubmitButton, so the click must be guarded synchronously: the statement right before the call sets
// a `ref.current = true` lock (`pending` only changes on the next render). A transition wrapper that is itself
// a `<form action={wrapper}>` handler is a form submit and needs no lock.
export function unguardedActionTransitions(src: string): string[] {
  const imported = new Set<string>();
  for (const m of src.matchAll(/import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*["'][^"']+["']/g)) {
    for (const part of m[1].split(",")) {
      const local = part.trim().split(/\s+as\s+/).at(-1)!;
      if (/^\w+Action$/.test(local)) imported.add(local);
    }
  }
  if (imported.size === 0) return [];
  const starters = ["startTransition", ...[...src.matchAll(/\[\s*\w+\s*,\s*(\w+)\s*\]\s*=\s*useTransition\(/g)].map((m) => m[1])];
  const found: string[] = [];
  for (const starter of new Set(starters)) {
    for (const m of src.matchAll(new RegExp(`\\b${starter}\\s*\\(`, "g"))) {
      let depth = 1; let i = m.index! + m[0].length;
      for (; i < src.length && depth > 0; i += 1) depth += src[i] === "(" ? 1 : src[i] === ")" ? -1 : 0;
      const body = src.slice(m.index! + m[0].length, i - 1);
      const call = [...body.matchAll(/\b(\w+Action)\s*\(/g)].find((c) => imported.has(c[1]));
      if (!call) continue;
      const before = src.slice(Math.max(0, m.index! - 160), m.index!);
      if (/\b\w+\.current\s*=\s*true;\s*$/.test(before)) continue;
      const wrapper = /(?:const|function)\s+(\w+)\s*(?:=\s*)?\(\s*\w+\s*(?::\s*FormData)?\s*\)[^\n]*$/.exec(src.slice(Math.max(0, m.index! - 120), m.index! + m[0].length));
      if (wrapper && new RegExp(`\\baction\\s*=\\s*\\{\\s*${wrapper[1]}\\s*\\}`).test(src)) continue;
      found.push(`${starter}(… ${call[1]}(…) …)`);
    }
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
      // `=>` inside an attribute must not cut the tag short and hide the Server Action.
      `<form onSubmit={(e) => { e.preventDefault(); }} action={save}><Button type="submit">Simpan</Button></form>`,
      `<form onSubmit={(e) => run(e)}><Button type="submit">Simpan</Button></form>`,
      `<Button onClick={() => {}} form="discount-form" type="submit">Simpan</Button>`,
      `<form method="get"><Button type="submit" formAction={save}>Simpan</Button></form>`,
      `<form action={save}><input type="submit" value="Simpan" /></form>`,
      // A submit button outside the form it names must be handed that form's pending state.
      `<SubmitButton form="discount-form">Simpan</SubmitButton>`,
    ];
    for (const src of bad) expect(rawServerActionSubmits(src), src).not.toEqual([]);
    const good = [
      `<form method="get"><Button type="submit">Terapkan</Button></form>`,
      `<form action="/pengiriman" role="search"><Button type="submit">Terapkan</Button></form>`,
      `<form role="search"><Button type="submit">Cari</Button></form>`,
      `<form action={save}><Button type="button">Batal</Button><SubmitButton>Simpan</SubmitButton></form>`,
      `<Button type="button" onClick={go}>Buka</Button>`,
      `<form action={save}><Button asChild><a href="/x">Muat ulang</a></Button><SubmitButton>Simpan</SubmitButton></form>`,
      `<SubmitButton form="discount-form" pending={pending} onClick={() => go()}>Simpan</SubmitButton>`,
      `const [s, set] = useState<Foo>(null); <form action={save} onSubmit={(e) => { check(e); }}><SubmitButton>Simpan</SubmitButton></form>`,
    ];
    for (const src of good) expect(rawServerActionSubmits(src), src).toEqual([]);
  });

  it("requires a synchronous lock for a Server Action run from a transition outside a form", () => {
    const imports = `import { useTransition, useRef } from "react"; import { payAction } from "./actions";\n`;
    const bad = [
      `${imports}function A() { const [p, startTransition] = useTransition(); return <Button type="button" onClick={() => startTransition(async () => { await payAction(1); })}>Bayar</Button>; }`,
      `${imports}function A() { const [p, startPay] = useTransition(); const go = () => { startPay(async () => payAction(1)); }; }`,
    ];
    for (const src of bad) expect(unguardedActionTransitions(src), src).not.toEqual([]);
    const good = [
      `${imports}function A() { const [p, startTransition] = useTransition(); const lock = useRef(false); const go = () => { if (lock.current) return; lock.current = true; startTransition(async () => { try { await payAction(1); } finally { lock.current = false; } }); }; }`,
      `${imports}function A() { const [p, startTransition] = useTransition(); const archive = (data: FormData) => startTransition(() => payAction(data)); return <form action={archive} />; }`,
      `import { useTransition } from "react"; function A({ action }) { const [p, startTransition] = useTransition(); const go = (data) => startTransition(() => action(data)); }`,
    ];
    for (const src of good) expect(unguardedActionTransitions(src), src).toEqual([]);
  });

  it("guards every click-driven Server Action transition in src", () => {
    const offenders = files.flatMap((file) => unguardedActionTransitions(readFileSync(file, "utf8")).map((call) => `${relative(ROOT, file)}: ${call}`));
    expect(offenders).toEqual([]);
  });

  it("never confirms with the browser's window.confirm (the shared dialog names the object)", () => {
    const offenders = files
      .filter((file) => /window\.confirm\s*\(/.test(readFileSync(file, "utf8")))
      .map((file) => relative(ROOT, file));
    expect(offenders).toEqual([]);
  });
});
