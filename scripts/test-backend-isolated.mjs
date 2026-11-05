// Disposable local PostgreSQL/PostgREST verification. No existing env file or database is used.
// Usage: node scripts/test-backend-isolated.mjs [tests/db/...test.ts ...]
import { execFileSync, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { copyFileSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { seedSql } from "./db-seed-totp.mjs";

const docker = (...args) => execFileSync("docker", args, { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
const endpoint = process.env.DOCKER_HOST ?? docker("context", "inspect", "--format", "{{.Endpoints.docker.Host}}");
if (!endpoint.startsWith("unix://")) throw new Error("Isolated tests require a local Unix Docker socket");
const name = `gxdb-audit-${process.pid}-${randomBytes(4).toString("hex")}`;
const container = `${name}-postgres`;
const api = `${name}-postgrest`;
const source = readFileSync("compose.db.yaml", "utf8");
const pgImage = source.match(/image: (postgres:17@sha256:[a-f0-9]+)/)[1];
const apiImage = source.match(/image: (postgrest\/postgrest:v[^\s]+)/)[1];
const env = {
  ...process.env, GX_DB_CONTAINER: container, GX_DB_NAME: "gx_audit",
  GX_DB_ENV_FILE: "/dev/null", GX_TEST_ENV_FILE: "/dev/null", GX_AUDIT_ISOLATED: "1",
  AUTHENTICATOR_PASSWORD: randomBytes(32).toString("hex"),
  POSTGRES_PASSWORD: randomBytes(32).toString("hex"),
  AUTH_JWT_SECRET: randomBytes(32).toString("hex"), AUTH_SECRET: randomBytes(32).toString("hex"),
  TRACKING_TOKEN_SECRET: randomBytes(32).toString("hex"),
};
delete env.DATABASE_URL;
const run = (cmd, args, extra = {}) => {
  const result = spawnSync(cmd, args, { env, stdio: "inherit", ...extra });
  if (result.status !== 0) throw new Error(`${cmd} exited ${result.status}`);
};
let networkCreated = false, pgCreated = false, apiCreated = false;
const browser = process.argv[2] === "--browser";
const upgrade = process.argv[2] === "--upgrade";
const extraContainers = [];
let browserDir;
let upgradeDir;
try {
  docker("network", "create", name); networkCreated = true;
  // Init reaps killed exec descendants; postmaster as PID 1 mistakes them for crashed backends.
  // Match production password authentication; neither database nor SQL port is published.
  run("docker", ["run", "--init", "-d", "--name", container, "--network", name, "-e", "POSTGRES_PASSWORD",
    "-e", "POSTGRES_DB=gx_audit", "-e", "PGDATABASE=gx_audit", pgImage, "postgres", "-c", "app.gx_local=on"], { stdio: "ignore" }); pgCreated = true;
  let ready = false;
  for (let i = 0; i < 60; i++) {
    try {
      docker("exec", container, "pg_isready", "-h", "127.0.0.1", "-U", "postgres", "-d", "gx_audit"); ready = true;
    } catch { /* the final server is still starting */ }
    if (ready) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  if (!ready) throw new Error("Disposable PostgreSQL did not start");
  if (upgrade) {
    upgradeDir = mkdtempSync(join(tmpdir(), "gx-upgrade-migrations-"));
    for (const file of readdirSync("db/migrations")) {
      if (file.endsWith(".sql") && file < "20261029130000") copyFileSync(join("db/migrations", file), join(upgradeDir, file));
    }
    env.DB_MIGRATIONS_DIR = upgradeDir;
  }
  run("bash", ["scripts/db-migrate.sh"]);
  run("docker", ["exec", "-i", container, "psql", "-U", "postgres", "-d", "gx_audit", "-q", "-1", "-v", "ON_ERROR_STOP=1"], { input: readFileSync("db/seed.sql"), stdio: ["pipe", "inherit", "inherit"] });
  if (upgrade) {
    delete env.DB_MIGRATIONS_DIR;
    run("bash", ["scripts/db-migrate.sh"]);
    console.log("Upgrade: applied audit migration to the previous schema with seeded tenant/auth data");
  }
  env.PGRST_JWT_SECRET = env.AUTH_JWT_SECRET;
  env.PGRST_DB_URI = `postgres://authenticator:${env.AUTHENTICATOR_PASSWORD}@${container}:5432/gx_audit`;
  run("docker", ["run", "-d", "--name", api, "--network", name, "-p", "127.0.0.1::3000",
    "-e", "PGRST_JWT_SECRET", "-e", "PGRST_DB_URI", "-e", "PGRST_DB_ANON_ROLE=anon",
    "-e", "PGRST_DB_SCHEMAS=public", "-e", "PGRST_JWT_AUD=authenticated",
    "-e", "PGRST_DB_MAX_ROWS=1000", "-e", "PGRST_DB_POOL=5", apiImage]); apiCreated = true;
  env.POSTGREST_URL = `http://${docker("port", api, "3000/tcp")}`;
  ready = false;
  for (let i = 0; i < 60; i++) {
    try { ready = (await fetch(`${env.POSTGREST_URL}/rpc/registration_open`, { method: "POST", signal: AbortSignal.timeout(1000) })).ok; } catch {}
    if (ready) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  if (!ready) throw new Error("Disposable PostgREST did not start");
  if (browser) {
    // The image was built separately from the same source with APP_ORIGIN=http://127.0.0.1:18080.
    run("docker", ["exec", "-i", container, "psql", "-U", "postgres", "-d", "gx_audit", "-q", "-v", "ON_ERROR_STOP=1"], {
      input: seedSql(env.AUTH_SECRET), stdio: ["pipe", "inherit", "inherit"],
    });
    const mailImage = source.match(/image: (axllent\/mailpit:[^\s]+)/)[1];
    docker("run", "-d", "--name", `${name}-mail`, "--network", name, "--network-alias", "gxdb-mailpit-1", "-p", "127.0.0.1::8025", mailImage);
    extraContainers.push(`${name}-mail`);
    env.E2E_MAILPIT_URL = `http://${docker("port", `${name}-mail`, "8025/tcp")}`;
    Object.assign(env, {
      POSTGREST_URL: `http://${api}:3000`, MAILPIT_URL: "http://gxdb-mailpit-1:8025", MAIL_TRANSPORT: "mailpit",
      HOST_SHARED_MODE: "1", TRUSTED_PROXY: "1", AUTH_CAPTCHA_DISABLED: "true", TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
      SITE_ORIGIN: "http://127.0.0.1:18080", APP_ORIGIN: "http://127.0.0.1:18080",
      OWNER_ORIGIN: "http://127.0.0.1:18080", HOOKS_ORIGIN: "http://127.0.0.1:18080",
      CRON_SECRET: randomBytes(32).toString("hex"), CREDENTIAL_KEY: randomBytes(32).toString("base64"), MENGANTAR_ENV: "sandbox",
    });
    const names = ["POSTGREST_URL", "AUTH_JWT_SECRET", "AUTH_SECRET", "TRACKING_TOKEN_SECRET", "MAILPIT_URL", "MAIL_TRANSPORT", "HOST_SHARED_MODE", "TRUSTED_PROXY",
      "AUTH_CAPTCHA_DISABLED", "TURNSTILE_SITE_KEY", "SITE_ORIGIN", "APP_ORIGIN", "OWNER_ORIGIN", "HOOKS_ORIGIN", "CRON_SECRET", "CREDENTIAL_KEY", "MENGANTAR_ENV"];
    run("docker", ["run", "-d", "--name", `${name}-app`, "--network", name, "--network-alias", "app",
      ...names.flatMap((key) => ["-e", key]), "geraiexpress:audit-local"], { stdio: "ignore" });
    extraContainers.push(`${name}-app`);
    const gateway = docker("network", "inspect", "--format", "{{(index .IPAM.Config 0).Gateway}}", name);
    browserDir = mkdtempSync(join(tmpdir(), "gx-browser-proxy-"));
    writeFileSync(join(browserDir, "Caddyfile"), readFileSync("infra/proxy/Caddyfile.local", "utf8").replaceAll("172.30.62.1/32", `${gateway}/32`));
    const caddyImage = readFileSync("compose.yaml", "utf8").match(/image: (caddy:[^\s]+)/)[1];
    docker("create", "--name", `${name}-proxy`, "--network", name, "-p", "127.0.0.1:18080:8080",
      "-v", `${browserDir}/Caddyfile:/etc/caddy/Caddyfile:ro`, caddyImage);
    extraContainers.push(`${name}-proxy`);
    docker("start", `${name}-proxy`);
    env.E2E_BASE_URL = env.APP_ORIGIN; env.E2E_PRODUCTION_BUILD = "1";
    ready = false;
    for (let i = 0; i < 80; i++) {
      try { ready = (await fetch(`${env.E2E_BASE_URL}/healthz`, { signal: AbortSignal.timeout(1000) })).status === 200; } catch {}
      if (ready) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    if (!ready) throw new Error("Production image did not become ready");
    // A real dependency outage must change readiness; recovery must restore it.
    docker("stop", api);
    if ((await fetch(`${env.E2E_BASE_URL}/healthz`)).status !== 503) throw new Error("Readiness accepted a stopped data API");
    docker("start", api);
    for (let i = 0; i < 40; i++) {
      if ((await fetch(`${env.E2E_BASE_URL}/healthz`)).status === 200) break;
      if (i === 39) throw new Error("Readiness did not recover");
      await new Promise((r) => setTimeout(r, 250));
    }
    console.log("Container readiness: PASS (healthy -> dependency stopped -> recovered)");
    run("pnpm", ["exec", "playwright", "test", ...process.argv.slice(3)]);
  } else {
  // envDir=false prevents Vite loading unrelated .env files. Explicit test variables above
  // let the ordinary fixtures target only these newly created containers.
  const filters = process.argv.slice(upgrade ? 3 : 2);
  env.GX_TEST_FILTERS = JSON.stringify(filters.length ? filters : ["tests/db"]);
  run("node", ["--input-type=module", "-e", `
    import { startVitest } from 'vitest/node';
    const ctx = await startVitest(JSON.parse(process.env.GX_TEST_FILTERS),
      { config: false, watch: false, fileParallelism: false, testTimeout: 20000 },
      { envDir: false, test: { globalSetup: [] } });
    if (ctx) await ctx.close();
  `]);
  }
  console.log("Isolated backend verification: PASS");
} finally {
  // These names are generated and created by this invocation only. No shared volume is used.
  for (const item of extraContainers.reverse()) docker("rm", "-f", "-v", item);
  if (browserDir) rmSync(browserDir, { recursive: true, force: true });
  if (upgradeDir) rmSync(upgradeDir, { recursive: true, force: true });
  if (apiCreated) docker("rm", "-f", "-v", api);
  if (pgCreated) docker("rm", "-f", "-v", container);
  if (networkCreated) docker("network", "rm", name);
}
