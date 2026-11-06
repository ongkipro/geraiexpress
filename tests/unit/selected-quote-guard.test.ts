import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// T-112: `selected_quote_id` is null until a quote is chosen (drafts, fixtures). A PostgREST filter
// `.eq("id", x.selected_quote_id)` with a null value is sent as the string "null" and raises
// `invalid input syntax for type uuid` in the database. Every such lookup must be the consequent of a ternary whose
// condition is that same expression: `x.selected_quote_id ? <query using it> : <fallback>`. The check is per
// expression: the lookup must lie between that `?` and its matching `:` (nesting-aware), so a guard of an
// unrelated, already-finished expression next to it does not count.
const ROOT = join(__dirname, "../..");

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(ts|tsx)$/.test(path) ? [path] : [];
  });
}

// Offset of the ':' that closes the ternary opened by the '?' at `q`, skipping nested ?/: pairs, strings and
// brackets; -1 if the statement ends first.
function ternaryEnd(src: string, q: number): number {
  let depth = 0; let nested = 0;
  for (let i = q + 1; i < src.length; i++) {
    const c = src[i];
    if (c === '"' || c === "'" || c === "`") { const end = src.indexOf(c, i + 1); if (end < 0) return -1; i = end; continue; }
    if ("([{".includes(c)) depth++;
    else if (")]}".includes(c)) { if (depth === 0) return -1; depth--; }
    else if (depth === 0 && c === ";") return -1;
    else if (depth === 0 && c === "?" && src[i + 1] !== "." && src[i + 1] !== "?") nested++;
    else if (depth === 0 && c === ":") { if (nested === 0) return i; nested--; }
  }
  return -1;
}

export function unguardedQuoteLookups(src: string): number[] {
  const found: number[] = [];
  const lookup = /\.eq\(\s*["']id["']\s*,\s*([\w.?]+\.selected_quote_id)\s*\)/g;
  for (let m = lookup.exec(src); m; m = lookup.exec(src)) {
    const expr = m[1].replace(/\?\./g, ".");
    const escaped = expr.replace(/[.$]/g, (c) => `\\${c}`);
    const guard = new RegExp(`${escaped}\\s*\\?(?![.?])`, "g");
    let guarded = false;
    for (let g = guard.exec(src); g && g.index < m.index; g = guard.exec(src)) {
      const q = g.index + g[0].length - 1;
      const end = ternaryEnd(src, q);
      if (end > m.index) { guarded = true; break; }
    }
    if (!guarded) found.push(src.slice(0, m.index).split("\n").length);
  }
  return found;
}

describe("selected quote lookups are guarded against a null id (T-112)", () => {
  it("every .eq(\"id\", ….selected_quote_id) in src is preceded by its own truthiness guard", () => {
    const offenders = ["src"].flatMap((dir) => sources(join(ROOT, dir))).flatMap((file) =>
      unguardedQuoteLookups(readFileSync(file, "utf8")).map((line) => `${relative(ROOT, file)}:${line}`));
    expect(offenders).toEqual([]);
  });

  it("catches the unguarded form and accepts only a lookup inside its own guard's ternary (fixtures)", () => {
    // unguarded
    expect(unguardedQuoteLookups(`const { data: quote } = await db.from("shipment_quotes").select("courier, service")
    .eq("tenant_id", t).eq("id", s.selected_quote_id).maybeSingle();`)).toEqual([2]);
    // guarded (the fixed label page shape)
    expect(unguardedQuoteLookups(`const { data: quote } = s.selected_quote_id
    ? await db.from("shipment_quotes").select("courier, service")
      .eq("tenant_id", t).eq("id", s.selected_quote_id).maybeSingle()
    : { data: null };`)).toEqual([]);
    // guarded inside Promise.all (the struk page shape)
    expect(unguardedQuoteLookups(`await Promise.all([
    s.selected_quote_id
      ? db.from("q").select("a").eq("id", s.selected_quote_id).maybeSingle()
      : Promise.resolve({ data: null }),
    other(),
  ]);`)).toEqual([]);
    // an unrelated, finished guard right next to the lookup does not count (review P2)
    expect(unguardedQuoteLookups(`const x = s.selected_quote_id ? a : b;
    q.eq("id", s.selected_quote_id);`)).toEqual([2]);
    // the lookup in the fallback branch is not guarded
    expect(unguardedQuoteLookups(`const r = s.selected_quote_id ? a : q.eq("id", s.selected_quote_id);`)).toEqual([1]);
    // a guard of a different expression does not count
    expect(unguardedQuoteLookups(`const r = t.selected_quote_id ? q.eq("id", s.selected_quote_id) : b;`)).toEqual([1]);
    // optional chaining in the condition is not a ternary
    expect(unguardedQuoteLookups(`const r = s?.selected_quote_id?.length; q.eq("id", s.selected_quote_id);`)).toEqual([1]);
  });
});
