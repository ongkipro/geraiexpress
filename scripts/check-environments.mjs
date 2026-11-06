// The only libpq URI query parameters PostgREST's connection string may carry: they change transport, never identity.
const PGRST_URI_QUERY_ALLOWED = ["sslmode", "sslrootcert", "connect_timeout", "application_name"];
// DEL-2 / TEN-1 / T-062 environment separation guard for the self-hosted container deployment (DEC-020, ADR-0002).
// Validates, per environment, the env file the container is started with and the Compose model built from it:
//
//   Env files (one per environment: staging, production, and optionally local):
//   * every environment has its own auth and data secrets: no secret value (JWT secret, auth secret, Turnstile
//     secret, database URI or password, credential key, cron secret, Partner secret) is shared between
//     environments, so a token signed in one is worthless in another and no two environments share a database;
//   * a real file configures AUTH_JWT_SECRET, AUTH_SECRET (different), PGRST_DB_URI and the Turnstile pair, every
//     secret at least 32 characters and never a placeholder; Turnstile is never disabled outside `local`;
//   * no production value in staging or local: MENGANTAR_ENV is "production" only in `production`; staging
//     origins are never the production hosts;
//   * staging and production never set HOST_SHARED_MODE=1, never use the Mailpit transport, never point
//     POSTGREST_URL at a local address, and name https origins;
//   * a committed `*.example` template carries NO secret value.
//
//   Compose model (`docker compose config --format json` of compose.yaml with the env file):
//   * the services app, scheduler, postgrest and proxy exist; images are pinned (no `latest`, the proxy by digest);
//   * only the proxy publishes ports (the app and PostgREST are reachable on the compose network alone), and the
//     app runs with TRUSTED_PROXY=1 only behind it;
//   * PostgREST serves the `public` schema as role `anon` for audience `authenticated`, at most 1000 rows;
//   * the scheduler holds CRON_SECRET and no other secret.
//
//   Proxy configuration (infra/proxy/Caddyfile): replaces X-Real-IP with the TCP peer, trusts no client
//   X-Forwarded-*, never routes /api/internal.
//
// Usage: node scripts/check-environments.mjs [--no-compose] [name=path ...]
//   default: staging=infra/env/staging.env.example production=infra/env/production.env.example (the committed
//   templates); pass the real files to gate a release, for example
//   `pnpm check:environments staging=/etc/geraiexpress/staging.env production=/etc/geraiexpress/production.env`.
import { isIP } from "node:net";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

export const SECRET_NAMES = [
  "AUTH_JWT_SECRET", "AUTH_SECRET", "TRACKING_TOKEN_SECRET", "TURNSTILE_SECRET_KEY", "PGRST_DB_URI", "POSTGRES_PASSWORD",
  "CREDENTIAL_KEY", "CREDENTIAL_KEYS", "MENGANTAR_PARTNER_SECRET", "GERAIEXPRESS_MENGANTAR_SANDBOX_SECRET", "CRON_SECRET",
];
// Provider-issued secrets: never committed, never shared between environments, but their length is the provider's.
export const PROVIDER_SECRET_NAMES = ["SMTP_PASSWORD"];
const PRODUCTION_HOSTS = ["geraiexpress.com", "app.geraiexpress.com", "owner.geraiexpress.com", "hooks.geraiexpress.com"];
const ORIGIN_NAMES = ["SITE_ORIGIN", "APP_ORIGIN", "OWNER_ORIGIN", "HOOKS_ORIGIN"];
const LOCAL_HOSTS = ["127.0.0.1", "localhost", "[::1]", "host.docker.internal", "0.0.0.0"];
// Empty values in committed examples are placeholders, not usable credentials.
const placeholder = (value) => !value?.trim() || /^(?:<[^>]+>|(?:REPLACE|CHANGE)[_-]?ME(?:[_-].*)?)$/i.test(value.trim());

// KEY=value lines (compose env-file style): `#` comments, optional `export `, optional single or double quotes.
export function parseEnv(text) {
  const vars = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m) continue;
    let value = m[2];
    const quoted = /^(['"])(.*)\1$/.exec(value);
    if (quoted) value = quoted[2];
    else value = value.replace(/\s+#.*$/, "");
    vars[m[1]] = value;
  }
  return vars;
}

const hostOf = (value) => {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return null;
  }
};

// envs: { [name]: { vars, template?: boolean } }. Returns a list of problem strings (empty = pass).
export function checkEnvFiles(envs) {
  const problems = [];
  const entries = Object.entries(envs);

  // The same secret value in two environments means a leak in one reaches the other.
  const holders = new Map();
  for (const [name, { vars, template }] of entries) {
    if (template) continue;
    for (const secret of [...SECRET_NAMES, ...PROVIDER_SECRET_NAMES]) {
      const value = vars[secret];
      if (!value) continue;
      const key = `${secret}\0${value}`;
      holders.set(key, [...(holders.get(key) ?? []), name]);
    }
  }
  for (const [key, names] of holders) {
    if (names.length > 1) problems.push(`${names.join(" and ")} share the same ${key.split("\0")[0]} value: every environment needs its own`);
  }

  for (const [name, { vars, template }] of entries) {
    if (template) {
      for (const secret of [...SECRET_NAMES, ...PROVIDER_SECRET_NAMES]) {
        if (!placeholder(vars[secret])) problems.push(`${name}: the committed template carries a value for ${secret}; secrets belong in the 0600 env file outside the repository`);
      }
    } else {
      if (placeholder(vars.CRON_SECRET)) problems.push(`${name}: CRON_SECRET must be configured with at least 32 characters`);
      for (const secret of SECRET_NAMES) {
        const value = vars[secret];
        if (value && (placeholder(value) || value.trim().length < 32)) {
          problems.push(`${name}: ${secret} must contain at least 32 characters and must not be a placeholder`);
        }
      }
    }
    if (vars.MENGANTAR_ENV === "production" && name !== "production") {
      problems.push(`${name}: MENGANTAR_ENV is "production" in a non-production environment`);
    }
    // `local` is explicitly non-deployable; never counts as release-environment evidence.
    if (name === "local") continue;
    if (vars.HOST_SHARED_MODE?.trim() === "1") problems.push(`${name}: HOST_SHARED_MODE=1 is for local use only`);
    if (vars.MAIL_TRANSPORT === "mailpit") problems.push(`${name}: MAIL_TRANSPORT=mailpit is for local use only`);
    // T-063: SMTP needs TLS (implicit or STARTTLS); a release environment never submits in clear text.
    if (vars.MAIL_TRANSPORT === "smtp" && !["tls", "starttls"].includes(vars.SMTP_SECURITY?.trim() ?? "")) {
      problems.push(`${name}: MAIL_TRANSPORT=smtp needs SMTP_SECURITY=tls or starttls`);
    }
    if (vars.AUTH_CAPTCHA_DISABLED?.trim().toLowerCase() === "true") problems.push(`${name}: AUTH_CAPTCHA_DISABLED=true is for local use only`);
    const postgrestHost = hostOf(vars.POSTGREST_URL ?? "");
    if (vars.POSTGREST_URL && !postgrestHost) problems.push(`${name}: POSTGREST_URL is not a valid URL`);
    if (postgrestHost && LOCAL_HOSTS.includes(postgrestHost)) problems.push(`${name}: POSTGREST_URL is a local address`);
    if (!template) {
      // The auth module and PostgREST cannot run without these; a missing value is a failed release, not a default.
      for (const required of ["AUTH_JWT_SECRET", "AUTH_SECRET", "TRACKING_TOKEN_SECRET", "PGRST_DB_URI", "TURNSTILE_SITE_KEY", "TURNSTILE_SECRET_KEY"]) {
        if (placeholder(vars[required])) problems.push(`${name}: ${required} is not set`);
      }
      if (vars.AUTH_JWT_SECRET && vars.AUTH_JWT_SECRET === vars.AUTH_SECRET) problems.push(`${name}: AUTH_SECRET must differ from AUTH_JWT_SECRET`);
      // PostgREST must connect as the NOINHERIT `authenticator` role with a strong password, never as a
      // superuser or with a placeholder; the URI's own length says nothing about its password (review F-07).
      if (!placeholder(vars.PGRST_DB_URI)) {
        let uri = null;
        // libpq has no URI fragment and keeps whitespace that WHATWG URL strips: a "#..." or a tab/newline
        // could hide query parameters from this check while libpq still applies them (T-067 re-review).
        try { if (!/[#\s]/.test(vars.PGRST_DB_URI)) uri = new URL(vars.PGRST_DB_URI); } catch { /* reported below */ }
        if (!uri || !["postgres:", "postgresql:"].includes(uri.protocol)) problems.push(`${name}: PGRST_DB_URI is not a PostgreSQL URI`);
        else {
          if (decodeURIComponent(uri.username) !== "authenticator") problems.push(`${name}: PGRST_DB_URI must connect as the authenticator role`);
          const password = decodeURIComponent(uri.password);
          if (placeholder(password) || password.length < 32) problems.push(`${name}: the PGRST_DB_URI password must contain at least 32 characters and must not be a placeholder`);
          // libpq lets query parameters override the authority (user, password, host, dbname, service...): only
          // transport options may appear there.
          for (const key of uri.searchParams.keys()) {
            if (!PGRST_URI_QUERY_ALLOWED.includes(key)) problems.push(`${name}: PGRST_DB_URI query parameter "${key}" is not allowed (only ${PGRST_URI_QUERY_ALLOWED.join(", ")})`);
          }
        }
      }
    }
    for (const origin of ORIGIN_NAMES) {
      const value = vars[origin];
      if (!value) {
        problems.push(`${name}: ${origin} is not set (a production build refuses to build a link without it)`);
        continue;
      }
      let url;
      try {
        url = new URL(value);
      } catch {
        problems.push(`${name}: ${origin} is not a valid URL`);
        continue;
      }
      if (url.protocol !== "https:") problems.push(`${name}: ${origin} must be an https origin`);
      if (url.username || url.password || url.pathname !== "/" || url.search || url.hash || !/^https:\/\/[^/?#\\\s]+\/?$/.test(value)) {
        problems.push(`${name}: ${origin} must be an origin only (no credentials, path, query or fragment)`);
      }
      if (name === "staging" && PRODUCTION_HOSTS.includes(url.hostname.toLowerCase())) {
        problems.push(`staging: ${origin} is the production host ${url.hostname}`);
      }
    }
    if (name === "production") {
      const apex = hostOf(vars.SITE_ORIGIN ?? "");
      if (apex && !PRODUCTION_HOSTS.includes(apex)) problems.push(`production: SITE_ORIGIN host ${apex} is not a production host`);
    }
    // The proxy serves exactly the hosts the app builds links for, and needs a certificate contact.
    for (const [hostVar, originVar] of [["SITE_HOST", "SITE_ORIGIN"], ["APP_HOST", "APP_ORIGIN"], ["OWNER_HOST", "OWNER_ORIGIN"], ["HOOKS_HOST", "HOOKS_ORIGIN"]]) {
      const origin = hostOf(vars[originVar] ?? "");
      if (vars[hostVar] && origin && vars[hostVar].toLowerCase() !== origin) problems.push(`${name}: ${hostVar} (${vars[hostVar]}) does not match the host of ${originVar} (${origin})`);
    }
    if (!vars.ACME_EMAIL) problems.push(`${name}: ACME_EMAIL is not set (the proxy needs a certificate contact)`);
    else if (!template && /\.invalid$/i.test(vars.ACME_EMAIL)) problems.push(`${name}: ACME_EMAIL is still the template placeholder`);
  }
  return problems;
}

// Trust only the verified edge peer, not a shared Docker subnet or all private ranges.
export function validProxyPeer(value) {
  if (typeof value !== "string") return false;
  const [address, mask, extra] = value.split("/");
  return extra === undefined && ((isIP(address) === 4 && mask === "32") || (isIP(address) === 6 && mask === "128"));
}

const asList = (value) => (Array.isArray(value) ? value : value ? [value] : []);

// model: the JSON of `docker compose config --format json`.
export function checkCompose(model, { name = "compose", coolify = false } = {}) {
  const problems = [];
  const services = model?.services ?? {};
  for (const required of ["app", "scheduler", "postgrest", "proxy"]) {
    if (!services[required]) problems.push(`${name}: service "${required}" is missing`);
  }
  for (const [serviceName, service] of Object.entries(services)) {
    const image = String(service.image ?? "");
    const tag = image.split("@")[0].split("/").pop()?.split(":")[1];
    if (!image) problems.push(`${name}: service ${serviceName} has no image`);
    else if (!tag || tag === "latest") problems.push(`${name}: service ${serviceName} image "${image}" is not pinned to a tag`);
    if (serviceName !== "proxy" && asList(service.ports).length) {
      problems.push(`${name}: service ${serviceName} publishes ports; only the proxy may (the app is reachable on the compose network alone)`);
    }
    const logging = service.logging;
    if (logging?.driver !== "local" || logging.options?.["max-size"] !== "10m" || String(logging.options?.["max-file"]) !== "3") {
      problems.push(`${name}: service ${serviceName} must use bounded local logging (10m, 3 files)`);
    }
    if (!service.read_only) problems.push(`${name}: service ${serviceName} must have a read-only root filesystem`);
  }
  const proxyImage = String(services.proxy?.image ?? "");
  if (services.proxy && !/@sha256:[0-9a-f]{64}$/.test(proxyImage)) problems.push(`${name}: the proxy image is not pinned by digest`);
  const proxyPorts = asList(services.proxy?.ports).map((p) => Number(p.target));
  if (services.proxy && !coolify && !(proxyPorts.includes(80) && proxyPorts.includes(443))) {
    problems.push(`${name}: the proxy must publish 80 and 443 (automatic HTTPS)`);
  }
  if (services.proxy) {
    for (const port of asList(services.proxy.ports)) {
      if (port.host_ip !== "0.0.0.0") problems.push(`${name}: proxy ports must bind explicitly to IPv4 0.0.0.0 (no IPv6-to-IPv4 client-address collapse)`);
    }
    if (coolify && asList(services.proxy.ports).length) problems.push(`${name}: Coolify owns public ports; proxy must not publish any`);
    if (coolify && !asList(services.proxy.expose).map(String).includes("8080")) problems.push(`${name}: Coolify proxy must expose 8080 internally`);
    if (coolify && !validProxyPeer(services.proxy.environment?.COOLIFY_PROXY_CIDR)) problems.push(`${name}: COOLIFY_PROXY_CIDR must be one exact IPv4 /32 or IPv6 /128 peer`);
    const expected = fileURLToPath(new URL(coolify ? "../infra/proxy/Caddyfile.coolify" : "../infra/proxy/Caddyfile", import.meta.url));
    const mountsProduction = asList(services.proxy.volumes).some((v) =>
      v.type === "bind" && resolve(v.source) === expected && v.target === "/etc/caddy/Caddyfile" && v.read_only === true);
    if (!mountsProduction) problems.push(`${name}: the production proxy must mount infra/proxy/Caddyfile read-only, never Caddyfile.local`);
    if (asList(services.proxy.cap_add).some((c) => c !== "NET_BIND_SERVICE") || !asList(services.proxy.cap_drop).includes("ALL")) {
      problems.push(`${name}: proxy capabilities must drop ALL and add only NET_BIND_SERVICE`);
    }
  }

  const appEnv = services.app?.environment ?? {};
  for (const key of ["DATABASE_URL", "PGRST_DB_URI", "POSTGRES_PASSWORD", "AUTHENTICATOR_PASSWORD"]) {
    if (key in appEnv) problems.push(`${name}: the app must not receive database owner/login credential ${key}`);
  }
  if (services.app && String(appEnv.TRUSTED_PROXY ?? "") !== "1") {
    problems.push(`${name}: the app must run with TRUSTED_PROXY=1 behind the proxy (the client address would be unknown)`);
  }
  if (services.app && String(appEnv.HOST_SHARED_MODE ?? "").trim() === "1") problems.push(`${name}: the app has HOST_SHARED_MODE=1`);
  const sched = services.scheduler;
  if (sched) {
    if (asList(sched.env_file).length) problems.push(`${name}: the scheduler must not load the app's env file (it holds CRON_SECRET only)`);
    const schedEnv = sched.environment ?? {};
    if (!schedEnv.CRON_SECRET) problems.push(`${name}: the scheduler has no CRON_SECRET`);
    for (const secret of SECRET_NAMES) {
      if (secret !== "CRON_SECRET" && secret in schedEnv) problems.push(`${name}: the scheduler holds ${secret}; it may hold CRON_SECRET only`);
    }
  }
  const postgrest = services.postgrest;
  if (postgrest) {
    const env = postgrest.environment ?? {};
    const expected = { PGRST_DB_SCHEMAS: "public", PGRST_DB_ANON_ROLE: "anon", PGRST_JWT_AUD: "authenticated", PGRST_DB_MAX_ROWS: "1000" };
    for (const [key, value] of Object.entries(expected)) {
      if (String(env[key] ?? "") !== value) problems.push(`${name}: postgrest must run with ${key}=${value}`);
    }
  }
  const appPostgrest = hostOf(String(appEnv.POSTGREST_URL ?? ""));
  if (services.app && !appPostgrest) problems.push(`${name}: the app has no valid POSTGREST_URL`);
  else if (appPostgrest && LOCAL_HOSTS.includes(appPostgrest)) problems.push(`${name}: the app's POSTGREST_URL is a local address`);
  return problems;
}

// Inspection of the proxy configuration text (the invariants the app's trust model rests on).
export function checkProxyConfig(text, { local = false, name = "proxy" } = {}) {
  const problems = [];
  const code = text.split("\n").filter((l) => !l.trim().startsWith("#")).join("\n");
  if (!/header_up\s+X-Real-IP\s+\{(remote_host|client_ip)\}/.test(code)) problems.push(`${name}: X-Real-IP is not overwritten with the peer address`);
  if (!/@internal\s+path_regexp\s+\S*api\/\+?internal/.test(code) || !/handle\s+@internal\s*\{\s*respond\s+"[^"]*"\s+404/s.test(code)) {
    problems.push(`${name}: /api/internal is not denied`);
  }
  const trusting = /trusted_proxies/.test(code);
  if (!local && trusting) problems.push(`${name}: the production proxy must not trust any client X-Forwarded-* (remove trusted_proxies)`);
  if (local && /auto_https\s+off/.test(code) === false) problems.push(`${name}: the local profile is expected to be plain HTTP (auto_https off)`);
  if (local && !/trusted_proxies\s+static\s+172\.30\.62\.1\/32\s*\n/.test(code)) problems.push(`${name}: local forwarded headers may be trusted only from the pinned gateway 172.30.62.1/32`);
  if (!/request_body\s*\{\s*max_size\s+1MB\s*\}/.test(code)) problems.push(`${name}: request bodies must be capped at 1MB`);
  if (!local && /auto_https\s+off/.test(code)) problems.push(`${name}: production must keep automatic HTTPS`);
  if (!local && !/\{\$SITE_HOST[:}]/.test(code)) problems.push(`${name}: the four hosts are not configured`);
  return problems;
}

function composeModel(envFile, template, coolify = false) {
  const env = { ...process.env, GX_ENV_FILE: envFile };
  // A template carries no secrets by design; Compose still wants a CRON_SECRET to render the scheduler.
  if (template) {
    env.CRON_SECRET = "check-environments-placeholder-32-chars";
    if (coolify) env.COOLIFY_PROXY_CIDR = "192.0.2.1/32";
  }
  const out = execFileSync("docker", ["compose", "-p", "gxcheck", "--env-file", envFile, "-f", coolify ? "compose.coolify.yaml" : "compose.yaml", "--profile", "prod", "config", "--format", "json"], { env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  return JSON.parse(out);
}

function main() {
  const args = process.argv.slice(2);
  const noCompose = args.includes("--no-compose");
  const named = args.filter((a) => a.includes("="));
  const targets = named.length
    ? named.map((a) => [a.slice(0, a.indexOf("=")), a.slice(a.indexOf("=") + 1)])
    : [["staging", "infra/env/staging.env.example"], ["production", "infra/env/production.env.example"]];
  const envs = {};
  const problems = [];
  for (const [name, path] of targets) {
    if (!existsSync(path)) {
      console.error(`check-environments: cannot read ${path} for ${name}`);
      process.exit(1);
    }
    envs[name] = { vars: parseEnv(readFileSync(path, "utf8")), template: path.endsWith(".example") };
  }
  problems.push(...checkEnvFiles(envs));
  if (!noCompose) {
    for (const [name, path] of targets) {
      try {
        for (const coolify of [false, true]) {
          problems.push(...checkCompose(composeModel(path, path.endsWith(".example"), coolify), { name: `${name} ${coolify ? "Coolify" : "standalone"} compose`, coolify }));
        }
      } catch {
        // Compose diagnostics can include interpolated secret values; never relay them.
        console.error(`check-environments: cannot render the Compose model for ${name}; check Docker Compose and required variables (diagnostic values withheld)`);
        process.exit(1);
      }
    }
  }
  problems.push(...checkProxyConfig(readFileSync("infra/proxy/Caddyfile", "utf8"), { name: "infra/proxy/Caddyfile" }));
  problems.push(...checkProxyConfig(readFileSync("infra/proxy/Caddyfile.local", "utf8"), { name: "infra/proxy/Caddyfile.local", local: true }));
  if (problems.length) {
    console.error(`check-environments: FAIL\n${problems.map((p) => `  - ${p}`).join("\n")}`);
    process.exit(1);
  }
  console.log(`check-environments: PASS (${targets.map(([n, p]) => `${n}=${p}`).join(", ")}${noCompose ? "; compose skipped" : ""})`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
