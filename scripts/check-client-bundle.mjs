// ARCH-1 / NFR-3 / SEC-3: browser-delivered assets must not contain server-only secrets or markers, and no
// secret VALUE from a local env file may be baked into any build output (T-062: the standalone image reads
// its configuration from the container environment at run time, never from the build).
//
//   1. Client bundle: `.next/static` (the only tree the browser downloads; the standalone image serves the
//      same files from `.next/standalone/.next/static`, scanned too) is checked for forbidden names, markers
//      and privileged JWTs.
//   2. Baked values: the SECRET values of `.env`, `.env.local`, `.env.production(.local)`, `.env.container`,
//      `infra/dev/.env` (AUTH_JWT_SECRET, AUTH_SECRET, TURNSTILE_SECRET_KEY, the minted ANON_JWT and
//      SERVICE_ROLE_JWT, database and credential secrets...) and of the process environment, when present, may
//      appear nowhere in `.next/static` (the client files), `.next/server` or `.next/standalone` (node_modules of
//      the traced runtime excluded). Next.js inlines only NEXT_PUBLIC_* values, so this must stay empty.
//   3. No env file may be copied into `.next/standalone`.
// Usage: node scripts/check-client-bundle.mjs [buildDir]   (default: .next)
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const buildDir = process.argv[2] ?? ".next";
const clientRoots = [join(buildDir, "static"), join(buildDir, "standalone", ".next", "static")].filter(existsSync);
if (clientRoots.length === 0) {
  console.error(`check-client-bundle: no build output in ${buildDir}; run pnpm build first`);
  process.exit(1);
}

const forbidden = [
  /AUTH_JWT_SECRET/,
  /AUTH_SECRET/,
  /TURNSTILE_SECRET_KEY/,
  /SERVICE_ROLE_JWT/,
  /PGRST_(JWT_SECRET|DB_URI)/,
  /MENGANTAR_[A-Z_]*(KEY|SECRET)/,
  /CRON_SECRET/,
  /TRACKING_TOKEN_SECRET/,
  /GE_SERVER_ONLY_MARKER/,
];
const jwt = /eyJ[\w-]+\.(eyJ[\w-]+)\.[\w-]+/g;
const scannable = /\.(js|mjs|cjs|css|html|json|txt|map|rsc|body|meta|segment)$/;

// A role claim other than the browser-facing ones is a machine token (service_role); the role is only visible
// after decoding the payload.
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
function walk(dir, visit, { skip = [] } = {}) {
  for (const name of readdirSync(dir)) {
    if (skip.includes(name)) continue;
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) walk(path, visit, { skip });
    else if (scannable.test(name)) visit(path);
  }
}

for (const root of clientRoots) {
  walk(root, (path) => {
    files++;
    const text = readFileSync(path, "utf8");
    for (const re of forbidden) if (re.test(text)) hits.push(`${path}: ${re}`);
    for (const [, payload] of text.matchAll(jwt)) {
      const role = privilegedJwtRole(payload);
      if (role) hits.push(`${path}: JWT with role "${role}"`);
    }
  });
}

// Secret values from env files and from the process environment. Names whose value is public configuration (site
// key, URLs, origins) are not secrets and are ignored. ANON_JWT and SERVICE_ROLE_JWT are the static role tokens
// minted into infra/dev/.env: the browser never talks to PostgREST, so neither may ever reach a build output.
const SECRET_NAMES = new Set([
  "AUTH_JWT_SECRET", "AUTH_SECRET", "TURNSTILE_SECRET_KEY", "ANON_JWT", "SERVICE_ROLE_JWT",
  "PGRST_JWT_SECRET", "PGRST_DB_URI", "POSTGRES_PASSWORD", "AUTHENTICATOR_PASSWORD",
  "CREDENTIAL_KEY", "CREDENTIAL_KEYS", "MENGANTAR_PARTNER_SECRET",
  "GERAIEXPRESS_MENGANTAR_SANDBOX_SECRET", "CRON_SECRET", "TRACKING_TOKEN_SECRET",
]);
const secretValues = new Map();
// A short or empty value would match by chance; real secrets here are 32+ characters.
const remember = (name, value, origin) => {
  if (SECRET_NAMES.has(name) && value.length >= 16) secretValues.set(value, `${name} from ${origin}`);
};
for (const file of [".env", ".env.local", ".env.production", ".env.production.local", ".env.container", "infra/dev/.env"]) {
  if (!existsSync(file)) continue;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m) remember(m[1], m[2].replace(/^(['"])(.*)\1$/, "$2"), file);
  }
}
for (const name of SECRET_NAMES) remember(name, process.env[name] ?? "", "the environment");
if (secretValues.size > 0) {
  const serverRoots = [join(buildDir, "static"), join(buildDir, "server"), join(buildDir, "standalone")].filter(existsSync);
  for (const root of serverRoots) {
    walk(root, (path) => {
      const text = readFileSync(path, "utf8");
      for (const [value, origin] of secretValues) if (text.includes(value)) hits.push(`${path}: value of ${origin} is baked into the build`);
    }, { skip: ["node_modules"] });
  }
}

const standalone = join(buildDir, "standalone");
if (existsSync(standalone)) {
  for (const name of readdirSync(standalone)) {
    if (name.startsWith(".env") || name === ".dev.vars") hits.push(`${join(standalone, name)}: env file copied into the standalone output`);
  }
}

if (files === 0) {
  console.error(`check-client-bundle: FAIL (no scannable files in ${clientRoots.join(", ")})`);
  process.exit(1);
}
if (hits.length) {
  console.error(`check-client-bundle: FAIL\n${hits.join("\n")}`);
  process.exit(1);
}
console.log(`check-client-bundle: PASS (${files} client files in ${clientRoots.join(", ")}; ${secretValues.size} env secret values checked against the build)`);
