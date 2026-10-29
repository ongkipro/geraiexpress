// T-074 / UX-15: client JavaScript per route from the last `pnpm build`.
// Turbopack's build output prints no first-load sizes, so this reads each route's client reference manifest
// (the chunks its layouts and page load) plus the shared bootstrap chunks from build-manifest, and gzips them.
// Usage: node scripts/size-report.mjs [--json]    (run after `pnpm build`)
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join } from "node:path";

const next = ".next";
if (!existsSync(`${next}/server/app`)) {
  console.error("size-report: no build found; run `pnpm build` first");
  process.exit(2);
}

const gz = new Map();
const size = (file) => {
  if (!gz.has(file)) gz.set(file, gzipSync(readFileSync(join(next, file))).length);
  return gz.get(file);
};

// The bootstrap chunks every page loads (polyfills, main, webpack/turbopack runtime).
const build = JSON.parse(readFileSync(`${next}/build-manifest.json`, "utf8"));
const shared = new Set([...(build.rootMainFiles ?? []), ...(build.polyfillFiles ?? [])].filter((f) => f.endsWith(".js")));

function routes(dir, base = "") {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...routes(full, `${base}/${name}`));
    else if (name === "page_client-reference-manifest.js") out.push({ route: base || "/", file: full });
  }
  return out;
}

const rows = routes(`${next}/server/app`).map(({ route, file }) => {
  globalThis.__RSC_MANIFEST = {};
  // The manifest is a script that assigns to __RSC_MANIFEST; it holds data only.
  new Function(readFileSync(file, "utf8"))();
  const manifest = Object.values(globalThis.__RSC_MANIFEST)[0];
  const chunks = new Set(shared);
  // entryJSFiles also lists the error, not-found, global-error and loading boundaries; they load only when
  // rendered, so only the layouts and the page itself count toward the route's first load.
  for (const [entry, files] of Object.entries(manifest.entryJSFiles ?? {})) {
    if (/\/(error|not-found|global-error|loading|template)$/.test(entry)) continue;
    for (const f of files) if (f.endsWith(".js")) chunks.add(f);
  }
  let total = 0;
  for (const f of chunks) total += size(f);
  return { route: route.replace(/\/\([^/]+\)/g, ""), chunks: chunks.size, gzipKB: Math.round((total / 1024) * 10) / 10 };
}).sort((a, b) => b.gzipKB - a.gzipKB);

if (process.argv.includes("--json")) console.log(JSON.stringify(rows, null, 2));
else {
  console.log("route".padEnd(34), "chunks".padStart(7), "gzip KB".padStart(9));
  for (const r of rows) console.log(r.route.padEnd(34), String(r.chunks).padStart(7), r.gzipKB.toFixed(1).padStart(9));
}
