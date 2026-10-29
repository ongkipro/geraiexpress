import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { config } from "../../src/lib/config";

// T-062 / DEC-020: the self-hosted container runtime. These checks are file inspections of what the Done-when
// names: one configuration reader, no Cloudflare/OpenNext remains, a standalone non-root Docker image whose
// build context excludes every secret-bearing file.
vi.mock("server-only", () => ({}));
const root = join(__dirname, "../..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

afterEach(() => vi.unstubAllEnvs());

describe("the configuration reader", () => {
  it("reads process.env at call time and treats an empty value as unset", () => {
    vi.stubEnv("CRON_SECRET", "");
    expect(config("CRON_SECRET")).toBeUndefined();
    vi.stubEnv("CRON_SECRET", "abc");
    expect(config("CRON_SECRET")).toBe("abc");
    vi.stubEnv("CRON_SECRET", "");
    expect(config("CRON_SECRET")).toBeUndefined();
    vi.stubEnv("CRON_SECRET", " \t\n ");
    expect(config("CRON_SECRET")).toBeUndefined();
    vi.stubEnv("CRON_SECRET", " keep-exact ");
    expect(config("CRON_SECRET")).toBe(" keep-exact ");
    expect(config("MENGANTAR_PARTNER_SECRET")).toBeUndefined();
  });
});

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(join(root, dir))) {
    const rel = join(dir, name);
    if (["node_modules", ".next", ".git", "fixtures"].includes(name)) continue;
    if (statSync(join(root, rel)).isDirectory()) sources(rel, out);
    else if (/\.(ts|tsx|mjs|sh|json|yaml|yml)$/.test(name) || name === "Dockerfile" || name === "Caddyfile") out.push(rel);
  }
  return out;
}

describe("no Cloudflare Workers runtime remains", () => {
  it("has none of the Worker files and no Worker dependency or script", () => {
    for (const file of ["custom-worker.ts", "open-next.config.ts", "wrangler.jsonc", "src/lib/worker-secret.ts", "scripts/worker-smoke.sh", "scripts/deploy-preview.sh", "scripts/deploy-staging.sh", ".dev.vars", "public/_headers"]) {
      expect(existsSync(join(root, file)), file).toBe(false);
    }
    const pkg = JSON.parse(read("package.json")) as { dependencies: Record<string, string>; devDependencies: Record<string, string>; scripts: Record<string, string> };
    const all = { ...pkg.dependencies, ...pkg.devDependencies };
    expect(Object.keys(all).filter((n) => /opennext|wrangler|workerd|cloudflare/i.test(n))).toEqual([]);
    expect(Object.keys(pkg.scripts).filter((n) => /^(cf:|cf-typegen|preview$|smoke:worker|deploy:)/.test(n))).toEqual([]);
    expect(Object.keys(pkg.scripts)).toEqual(expect.arrayContaining(["docker:build", "docker:up", "smoke:container", "check:bundle", "check:environments"]));
    expect(read("pnpm-lock.yaml")).not.toMatch(/opennextjs|wrangler|workerd/);
  });

  it("imports no Cloudflare module and reads no Cloudflare header in application code or scripts", () => {
    // infra/proxy is out of scope here on purpose: the Caddyfile DROPS CF-Connecting-IP and friends from requests.
    const files = [...sources("src"), ...sources("scripts"), ...sources("infra/scheduler"), "next.config.ts", "package.json", "compose.yaml", "Dockerfile"];
    for (const file of files) {
      const text = read(file);
      expect(text, file).not.toMatch(/@opennextjs|getCloudflareContext|cf-connecting-ip|wrangler (secret|deploy|dev|types|rollback)|opennextjs-cloudflare/i);
    }
  });

  it("builds a standalone output", () => {
    expect(read("next.config.ts")).toMatch(/output:\s*"standalone"/);
  });
});

describe("the Docker image", () => {
  const dockerfile = read("Dockerfile");

  it("is multi-stage, pinned by digest, non-root and health-checked", () => {
    expect(dockerfile.match(/^FROM /gm)?.length).toBeGreaterThanOrEqual(3);
    expect(dockerfile).toMatch(/^FROM node:24\.\d+\.\d+-bookworm-slim@sha256:[0-9a-f]{64} AS base/m);
    expect(dockerfile).toMatch(/^USER node$/m);
    expect(dockerfile).toMatch(/^HEALTHCHECK /m);
    expect(dockerfile).toContain("/healthz");
    expect(dockerfile).toMatch(/CMD \["node", "server\.js"\]/);
    expect(dockerfile).toContain("corepack enable");
    expect(dockerfile).toContain("--frozen-lockfile");
  });

  it("scans the browser bundle in the build and requires APP_ORIGIN", () => {
    expect(dockerfile).toMatch(/test -n "\$APP_ORIGIN"/);
    expect(dockerfile).toContain("node scripts/check-client-bundle.mjs");
    expect(dockerfile).not.toMatch(/COPY .*\.env/);
    expect(dockerfile).not.toContain("--chown");
    expect(dockerfile).toContain("chown node:node /app/.next/cache");
  });

  it("has a build context that excludes every secret-bearing or heavy path", () => {
    const lines = read(".dockerignore").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
    // Allow-list context: everything is excluded first.
    expect(lines[0]).toBe("**");
    for (const pattern of ["**/.env", "**/.env.*", "**/.dev.vars", "**/node_modules", "**/test-results", "**/.next", "**/.git"]) {
      expect(lines, pattern).toContain(pattern);
    }
    // The excludes come AFTER the allow-list entries, so they win.
    const lastAllow = Math.max(...lines.map((l, i) => (l.startsWith("!") ? i : -1)));
    expect(lines.indexOf("**/.env.*")).toBeGreaterThan(lastAllow);
    for (const allowed of lines.filter((l) => l.startsWith("!"))) expect(allowed).not.toMatch(/\.env|dev\.vars|infra\/dev/);
  });

  it("refuses to build without APP_ORIGIN and says which variable to set", () => {
    const env = { ...process.env };
    delete env.APP_ORIGIN;
    const run = spawnSync("bash", ["scripts/docker.sh", "build"], { cwd: root, env, encoding: "utf8" });
    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain("APP_ORIGIN");
  });
});

describe("compose.yaml", () => {
  const compose = read("compose.yaml");
  const local = read("compose.local.yaml");

  it("names app, scheduler, postgrest and proxy, and publishes ports from the proxy only", () => {
    for (const service of ["app", "scheduler", "postgrest", "proxy"]) expect(compose).toMatch(new RegExp(`^  ${service}:$`, "m"));
    expect(compose.match(/^\s+ports:/gm)).toHaveLength(1);
    expect(compose.indexOf("ports:")).toBeGreaterThan(compose.indexOf("  proxy:"));
    expect(compose).toContain('TRUSTED_PROXY: "1"');
    expect(compose).toMatch(/caddy:2\.\d+\.\d+-alpine@sha256:[0-9a-f]{64}/);
    expect(compose).not.toMatch(/:latest/);
  });

  it("runs PostgREST pinned by digest with the documented settings, and offers PostgreSQL only in the db profile", () => {
    expect(compose).toMatch(/postgrest\/postgrest:v\d+\.\d+@sha256:[0-9a-f]{64}/);
    expect(compose).toMatch(/postgres:17@sha256:[0-9a-f]{64}/);
    for (const setting of [
      "PGRST_DB_URI: ${PGRST_DB_URI:-}", "PGRST_JWT_SECRET: ${AUTH_JWT_SECRET:-}", "PGRST_DB_SCHEMAS: public",
      "PGRST_DB_ANON_ROLE: anon", "PGRST_JWT_AUD: authenticated", 'PGRST_DB_MAX_ROWS: "1000"',
      "POSTGREST_URL: ${POSTGREST_URL:-http://postgrest:3000}",
    ]) expect(compose, setting).toContain(setting);
    expect(compose).toMatch(/^  postgres:\n(?:.*\n)*?    profiles: \[db\]$/m);
    expect(compose).toContain("postgres_data:/var/lib/postgresql/data");
    expect(compose).not.toMatch(/SUPABASE/i);
  });

  it("keeps the local plain-HTTP proxy to loopback and out of the default profile", () => {
    expect(local).toMatch(/profiles: \[local\]/);
    expect(local).toContain('"127.0.0.1:${GX_LOCAL_PORT:-8080}:8080"');
    expect(compose).toMatch(/profiles: \[prod\]/);
    expect(compose).not.toMatch(/^    env_file:/m);
    expect(local).toContain("env_file: !override");
  });
});

describe("scripts/check-client-bundle.mjs", () => {
  const scan = (files: Record<string, string>, env: Record<string, string> = {}) => {
    const dir = mkdtempSync(join(tmpdir(), "gx-bundle-"));
    try {
      for (const [path, text] of Object.entries(files)) {
        mkdirSync(dirname(join(dir, path)), { recursive: true });
        writeFileSync(join(dir, path), text);
      }
      return spawnSync("node", [join(root, "scripts/check-client-bundle.mjs"), dir], { cwd: dir, encoding: "utf8", env: { ...process.env, ...env } });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };

  it("passes a clean client bundle and fails on a server secret name, a secret key or a privileged JWT", () => {
    expect(scan({ "static/a.js": "console.log('hello')" }).status).toBe(0);
    expect(scan({ "static/a.js": "x=process.env.AUTH_JWT_SECRET" }).status).toBe(1);
    expect(scan({ "static/a.js": "x=process.env.CRON_SECRET" }).status).toBe(1);
    const jwt = (role: string) => `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ role })).toString("base64url")}.sig`;
    expect(scan({ "static/a.js": `k='${jwt("service_role")}'` }).status).toBe(1);
    expect(scan({ "static/a.js": `k='${jwt("anon")}'` }).status).toBe(0);
  });

  it("fails on a missing build, and on an env file copied into the standalone output", () => {
    expect(scan({ "other/x.txt": "x" }).status).toBe(1);
    const copied = scan({ "static/a.js": "ok", "standalone/.env.local": "A=1" });
    expect(copied.status).toBe(1);
    expect(copied.stderr).toContain("env file copied into the standalone output");
  });

  it("fails when a secret VALUE from an env file of the working directory is baked into the build output", () => {
    const secret = "0123456789abcdef0123456789abcdef";
    const baked = scan({ ".env.local": `CRON_SECRET=${secret}\n`, "static/a.js": "ok", "server/chunk.js": `const s='${secret}'` });
    expect(baked.status).toBe(1);
    expect(baked.stderr).toContain("value of CRON_SECRET from .env.local is baked into the build");
    expect(scan({ ".env.local": `CRON_SECRET=${secret}\n`, "static/a.js": "ok", "server/chunk.js": "const s=process.env.CRON_SECRET_NAME_ONLY" }).status).toBe(0);
  });

  it("fails on the auth and database secrets: their names in client files, their values anywhere in the build", () => {
    for (const name of ["AUTH_JWT_SECRET", "AUTH_SECRET", "TURNSTILE_SECRET_KEY", "SERVICE_ROLE_JWT", "PGRST_JWT_SECRET", "PGRST_DB_URI"]) {
      expect(scan({ "static/a.js": `x=process.env.${name}` }).status, name).toBe(1);
    }
    const jwtSecret = "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90";
    const minted = `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ role: "anon" })).toString("base64url")}.c2ln-minted-anon-signature`;
    const env = `AUTH_JWT_SECRET=${jwtSecret}\nANON_JWT=${minted}\nSERVICE_ROLE_JWT=eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.c2ln-minted-service-signature\n`;
    const leaked = scan({ "infra/dev/.env": env, "static/a.js": "ok", "server/chunk.js": `const s='${jwtSecret}'` });
    expect(leaked.status).toBe(1);
    expect(leaked.stderr).toContain("value of AUTH_JWT_SECRET from infra/dev/.env is baked into the build");
    // The anon token is an allowed JWT in a client file by role, yet its minted VALUE may not ship.
    const anon = scan({ "infra/dev/.env": env, "static/a.js": `k='${minted}'` });
    expect(anon.status).toBe(1);
    expect(anon.stderr).toContain("value of ANON_JWT from infra/dev/.env is baked into the build");
    expect(scan({ "infra/dev/.env": env, "static/a.js": "ok", "server/chunk.js": "const s=1" }).status).toBe(0);
  });

  it("also checks the values present in the process environment", () => {
    const secret = "ffeeddccbbaa99887766554433221100ffeeddccbbaa99887766554433221100";
    const leaked = scan({ "static/a.js": `k='${secret}'` }, { TURNSTILE_SECRET_KEY: secret });
    expect(leaked.status).toBe(1);
    expect(leaked.stderr).toContain("value of TURNSTILE_SECRET_KEY from the environment is baked into the build");
    expect(scan({ "static/a.js": "ok" }, { TURNSTILE_SECRET_KEY: secret }).status).toBe(0);
  });
});
