// ARCH-1 / NFR-3: browser-delivered assets must not contain server-only secrets or markers.
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

const roots = [".open-next/assets", ".next/static"].filter(existsSync);
if (roots.length === 0) {
  console.error("check-client-bundle: no build output; run pnpm build / pnpm cf:build first");
  process.exit(1);
}

const forbidden = [
  /SUPABASE_SERVICE_ROLE/,
  /SUPABASE_SECRET_KEY/,
  /sb_secret_[A-Za-z0-9_-]{8,}/,
  /MENGANTAR_[A-Z_]*(KEY|SECRET)/,
  /GE_SERVER_ONLY_MARKER/,
];
const jwt = /eyJ[\w-]+\.(eyJ[\w-]+)\.[\w-]+/g;

// Legacy Supabase keys are JWTs; the role is only visible after decoding the payload.
const privilegedJwtRole = (payload) => {
  try {
    const role = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")).role;
    return role && role !== "anon" && role !== "authenticated" ? role : null;
  } catch {
    return null;
  }
};

const hits = [];
let files = 0;
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else if (/\.(js|mjs|css|html|json|txt|map)$/.test(name)) {
      files++;
      const text = readFileSync(path, "utf8");
      for (const re of forbidden) if (re.test(text)) hits.push(`${path}: ${re}`);
      for (const [, payload] of text.matchAll(jwt)) {
        const role = privilegedJwtRole(payload);
        if (role) hits.push(`${path}: JWT with role "${role}"`);
      }
    }
  }
};
roots.forEach(walk);

if (files === 0) {
  console.error(`check-client-bundle: FAIL (no scannable files in ${roots.join(", ")})`);
  process.exit(1);
}
if (hits.length) {
  console.error(`check-client-bundle: FAIL\n${hits.join("\n")}`);
  process.exit(1);
}
console.log(`check-client-bundle: PASS (${files} files in ${roots.join(", ")})`);
