import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
// @ts-expect-error plain ESM script, no type declarations
import { checkCompose, checkEnvFiles, checkProxyConfig, parseEnv, validProxyPeer } from "../../scripts/check-environments.mjs";

// T-062: the environment guard validates env files, the Compose model and the proxy configuration.
const fixture = (name: string) => readFileSync(new URL(`./fixtures/environments/${name}`, import.meta.url), "utf8");
const staging = () => ({ vars: parseEnv(fixture("staging.env")) as Record<string, string> });
const production = () => ({ vars: parseEnv(fixture("production.env")) as Record<string, string> });
const compose = () => JSON.parse(fixture("compose-ok.json"));

describe("Coolify boundary", () => {
  it("accepts only an exact proxy peer, not a subnet or a list", () => {
    for (const value of ["192.0.2.1/32", "2001:db8::1/128"]) expect(validProxyPeer(value)).toBe(true);
    for (const value of [undefined, "", "private_ranges", "0.0.0.0/0", "172.20.0.0/16", "::/0", "192.0.2.1/32 192.0.2.2/32"])
      expect(validProxyPeer(value)).toBe(false);
  });

  it("requires an internal-only gateway and keeps database login secrets out of the app", () => {
    const model = compose();
    model.services.proxy.ports = [];
    model.services.proxy.expose = ["8080"];
    model.services.proxy.environment.COOLIFY_PROXY_CIDR = "192.0.2.1/32";
    model.services.proxy.volumes[0].source = "./infra/proxy/Caddyfile.coolify";
    expect(checkCompose(model, { coolify: true })).toEqual([]);
    model.services.proxy.ports = [{ host_ip: "0.0.0.0", target: 8080, published: "8080" }];
    model.services.proxy.environment.COOLIFY_PROXY_CIDR = "172.20.0.0/16";
    model.services.app.environment.POSTGRES_PASSWORD = "synthetic-fixture";
    expect(checkCompose(model, { coolify: true })).toEqual(expect.arrayContaining([
      "compose: Coolify owns public ports; proxy must not publish any",
      "compose: COOLIFY_PROXY_CIDR must be one exact IPv4 /32 or IPv6 /128 peer",
      "compose: the app must not receive database owner/login credential POSTGRES_PASSWORD",
    ]));
  });
});

describe("parseEnv", () => {
  it("reads KEY=value lines with comments, export, quotes and inline comments", () => {
    const vars = production().vars;
    expect(vars.AUTH_JWT_SECRET).toBe("production-jwt-secret-0123456789abcdef");
    expect(vars.CREDENTIAL_KEYS).toBe('{"current":"1","keys":{"1":"cHJvZHVjdGlvbi1rZXktMDEyMzQ1Njc4OWFiY2RlZg=="}}');
    expect(vars.CRON_SECRET).toBe("production-cron-secret-0123456789abcdef");
    expect(Object.keys(vars)).not.toContain("#");
  });
});

describe("env files", () => {
  it("pass when every environment has its own secrets, database and hosts", () => {
    expect(checkEnvFiles({ staging: staging(), production: production() })).toEqual([]);
  });

  it.each(["SITE_ORIGIN", "APP_ORIGIN", "OWNER_ORIGIN", "HOOKS_ORIGIN"])("validates %s in every deployable environment and template", (origin) => {
    for (const name of ["staging", "production", "preview"]) {
      for (const template of [false, true]) {
        for (const value of ["", "not a url", "https://example.test/path", "https://example.test/a/..", "https://example.test/?q=1", "https://example.test/#x", "https://example.test/?", "https://example.test/#", "https://user:pass@example.test", " https://example.test "]) {
          const env = { ...staging(), template };
          env.vars[origin] = value;
          expect(checkEnvFiles({ [name]: env }).some((p: string) => p.includes(`${origin} `))).toBe(true);
        }
        const env = { ...staging(), template };
        env.vars[origin] = "https://example.test";
        expect(checkEnvFiles({ [name]: env }).filter((p: string) => p.includes(`${origin} must`) || p.includes(`${origin} is not`))).toEqual([]);
      }
    }
  });

  it("fail when staging reuses the production auth and database secrets", () => {
    const s = staging();
    s.vars.AUTH_JWT_SECRET = production().vars.AUTH_JWT_SECRET;
    s.vars.PGRST_DB_URI = production().vars.PGRST_DB_URI;
    const problems = checkEnvFiles({ staging: s, production: production() });
    expect(problems).toEqual([
      "staging and production share the same AUTH_JWT_SECRET value: every environment needs its own",
      "staging and production share the same PGRST_DB_URI value: every environment needs its own",
    ]);
  });

  it("fail when the local environment shares a secret with another one", () => {
    const local = { vars: { AUTH_SECRET: staging().vars.AUTH_SECRET, CRON_SECRET: "local-cron-secret-0123456789abcdef" } };
    expect(checkEnvFiles({ local, staging: staging() })).toEqual(["local and staging share the same AUTH_SECRET value: every environment needs its own"]);
  });

  it("fail when a real environment lacks the auth, database or Turnstile configuration", () => {
    const s = staging();
    for (const name of ["AUTH_JWT_SECRET", "TRACKING_TOKEN_SECRET", "PGRST_DB_URI", "TURNSTILE_SITE_KEY", "TURNSTILE_SECRET_KEY"]) delete s.vars[name];
    s.vars.AUTH_SECRET = "<REPLACE_WITH_OWN_SECRET>";
    expect(checkEnvFiles({ staging: s, production: production() })).toEqual(expect.arrayContaining([
      "staging: AUTH_JWT_SECRET is not set",
      "staging: TRACKING_TOKEN_SECRET is not set",
      "staging: AUTH_SECRET is not set",
      "staging: PGRST_DB_URI is not set",
      "staging: TURNSTILE_SITE_KEY is not set",
      "staging: TURNSTILE_SECRET_KEY is not set",
    ]));
  });

  it("fail when the two auth secrets are the same value", () => {
    const s = staging();
    s.vars.AUTH_SECRET = s.vars.AUTH_JWT_SECRET;
    expect(checkEnvFiles({ staging: s, production: production() })).toEqual(["staging: AUTH_SECRET must differ from AUTH_JWT_SECRET"]);
  });

  it("fail when PostgREST would connect as another role or a libpq query parameter overrides the identity", () => {
    const strong = "x".repeat(32);
    const cases: [string, string][] = [
      [`postgres://postgres:${strong}@db.staging.internal:5432/geraiexpress`, "staging: PGRST_DB_URI must connect as the authenticator role"],
      [`postgres://authenticator:short@db.staging.internal:5432/geraiexpress`, "staging: the PGRST_DB_URI password must contain at least 32 characters and must not be a placeholder"],
      [`postgres://authenticator:${strong}@db.staging.internal:5432/geraiexpress?user=postgres`, 'staging: PGRST_DB_URI query parameter "user" is not allowed (only sslmode, sslrootcert, connect_timeout, application_name)'],
      [`postgres://authenticator:${strong}@db.staging.internal:5432/geraiexpress?host=other.internal`, 'staging: PGRST_DB_URI query parameter "host" is not allowed (only sslmode, sslrootcert, connect_timeout, application_name)'],
      // T-067 re-review: libpq has no fragment, so a "#" (or whitespace URL strips) could hide parameters from this check.
      [`postgres://authenticator:${strong}@db.staging.internal:5432/#?dbname=gx&user=postgres`, "staging: PGRST_DB_URI is not a PostgreSQL URI"],
      [`postgres://authenticator:${strong}@db.staging.internal:5432/geraiexpress#`, "staging: PGRST_DB_URI is not a PostgreSQL URI"],
      [`postgres://authenticator:${strong}@db.staging.internal:5432/gerai\texpress?us\ter=postgres`, "staging: PGRST_DB_URI is not a PostgreSQL URI"],
    ];
    for (const [uri, problem] of cases) {
      const s = staging();
      s.vars.PGRST_DB_URI = uri;
      expect(checkEnvFiles({ staging: s, production: production() }), uri).toEqual([problem]);
    }
    const ok = staging();
    ok.vars.PGRST_DB_URI = `postgres://authenticator:${strong}@db.staging.internal:5432/geraiexpress?sslmode=verify-full&connect_timeout=5`;
    expect(checkEnvFiles({ staging: ok, production: production() })).toEqual([]);
  });

  it("fail when MENGANTAR_ENV is production outside production", () => {
    const s = staging();
    s.vars.MENGANTAR_ENV = "production";
    expect(checkEnvFiles({ staging: s, production: production() })).toEqual(['staging: MENGANTAR_ENV is "production" in a non-production environment']);
    const local = { vars: { MENGANTAR_ENV: "production", CRON_SECRET: "local-cron-secret-0123456789abcdef" } };
    expect(checkEnvFiles({ local })).toEqual(['local: MENGANTAR_ENV is "production" in a non-production environment']);
  });

  it("fail when staging carries production values: hosts and shared secrets", () => {
    const s = staging();
    s.vars.APP_ORIGIN = "https://app.geraiexpress.com";
    s.vars.CRON_SECRET = production().vars.CRON_SECRET;
    s.vars.CREDENTIAL_KEY = "same";
    const p = production();
    p.vars.CREDENTIAL_KEY = "same";
    const problems = checkEnvFiles({ staging: s, production: p });
    expect(problems).toContain("staging and production share the same CRON_SECRET value: every environment needs its own");
    expect(problems).toContain("staging and production share the same CREDENTIAL_KEY value: every environment needs its own");
    expect(problems).toContain("staging: APP_ORIGIN is the production host app.geraiexpress.com");
  });

  it("fail on local-only settings and local addresses in staging or production", () => {
    const s = staging();
    s.vars.HOST_SHARED_MODE = "1";
    s.vars.MAIL_TRANSPORT = "mailpit";
    s.vars.AUTH_CAPTCHA_DISABLED = "true";
    s.vars.POSTGREST_URL = "http://host.docker.internal:55433";
    s.vars.SITE_ORIGIN = "http://staging.geraiexpress.com";
    delete s.vars.OWNER_ORIGIN;
    const problems = checkEnvFiles({ staging: s, production: production() });
    expect(problems).toEqual(expect.arrayContaining([
      "staging: HOST_SHARED_MODE=1 is for local use only",
      "staging: MAIL_TRANSPORT=mailpit is for local use only",
      "staging: AUTH_CAPTCHA_DISABLED=true is for local use only",
      "staging: POSTGREST_URL is a local address",
      "staging: SITE_ORIGIN must be an https origin",
      "staging: OWNER_ORIGIN is not set (a production build refuses to build a link without it)",
    ]));
    s.vars.POSTGREST_URL = "not a url";
    expect(checkEnvFiles({ staging: s, production: production() })).toContain("staging: POSTGREST_URL is not a valid URL");
  });

  it("fail when the proxy hosts and the app origins disagree, or the certificate contact is missing or a placeholder", () => {
    const s = staging();
    s.vars.APP_HOST = "app.geraiexpress.com";
    delete s.vars.ACME_EMAIL;
    const p = production();
    p.vars.ACME_EMAIL = "ops@example.invalid";
    expect(checkEnvFiles({ staging: s, production: p })).toEqual(expect.arrayContaining([
      "staging: APP_HOST (app.geraiexpress.com) does not match the host of APP_ORIGIN (app-staging.geraiexpress.com)",
      "staging: ACME_EMAIL is not set (the proxy needs a certificate contact)",
      "production: ACME_EMAIL is still the template placeholder",
    ]));
  });

  it("allow the local environment its shared mode, Mailpit, disabled CAPTCHA and local addresses", () => {
    const local = {
      vars: {
        CRON_SECRET: "local-cron-secret-0123456789abcdef", POSTGREST_URL: "http://gxdb-postgrest-1:3000", HOST_SHARED_MODE: "1",
        MAIL_TRANSPORT: "mailpit", MENGANTAR_ENV: "sandbox", AUTH_CAPTCHA_DISABLED: "true",
      },
    };
    expect(checkEnvFiles({ local, staging: staging(), production: production() })).toEqual([]);
  });

  it("refuse a committed template that carries a secret value", () => {
    const t = { vars: parseEnv(readFileSync(new URL("../../infra/env/production.env.example", import.meta.url), "utf8")), template: true };
    expect(checkEnvFiles({ production: t })).toEqual([]);
    t.vars.CRON_SECRET = "oops";
    t.vars.AUTH_JWT_SECRET = "oops";
    expect(checkEnvFiles({ production: t })).toEqual([
      "production: the committed template carries a value for AUTH_JWT_SECRET; secrets belong in the 0600 env file outside the repository",
      "production: the committed template carries a value for CRON_SECRET; secrets belong in the 0600 env file outside the repository",
    ]);
  });

  it("the committed staging and production templates pass together and name the data and auth settings", () => {
    const read = (name: string) => ({ vars: parseEnv(readFileSync(new URL(`../../infra/env/${name}.env.example`, import.meta.url), "utf8")), template: true });
    expect(checkEnvFiles({ staging: read("staging"), production: read("production") })).toEqual([]);
    for (const template of [read("staging"), read("production")]) {
      for (const name of ["POSTGREST_URL", "AUTH_JWT_SECRET", "AUTH_SECRET", "TRACKING_TOKEN_SECRET", "TURNSTILE_SITE_KEY", "TURNSTILE_SECRET_KEY", "PGRST_DB_URI"]) {
        expect(Object.keys(template.vars), name).toContain(name);
      }
      expect(Object.keys(template.vars).filter((name) => /SUPABASE|SEND_EMAIL_HOOK|AUTH_FORWARD/.test(name))).toEqual([]);
    }
  });

  it("requires real cron secrets and refuses short or placeholder secrets without printing their values", () => {
    const s = staging();
    delete s.vars.CRON_SECRET;
    s.vars.AUTH_JWT_SECRET = "<REPLACE_WITH_REAL_JWT_SECRET>";
    s.vars.MENGANTAR_PARTNER_SECRET = "short-private";
    const errors: string[] = checkEnvFiles({ staging: s });
    expect(errors).toContain("staging: CRON_SECRET must be configured with at least 32 characters");
    expect(errors).toContain("staging: AUTH_JWT_SECRET must contain at least 32 characters and must not be a placeholder");
    expect(errors).toContain("staging: MENGANTAR_PARTNER_SECRET must contain at least 32 characters and must not be a placeholder");
    expect(errors.join(" ")).not.toContain("short-private");
    s.vars.CRON_SECRET = "a".repeat(31);
    expect(checkEnvFiles({ staging: s })).toContain("staging: CRON_SECRET must contain at least 32 characters and must not be a placeholder");
    const t = { vars: { ...production().vars }, template: true };
    for (const key of ["AUTH_JWT_SECRET", "AUTH_SECRET", "TRACKING_TOKEN_SECRET", "TURNSTILE_SECRET_KEY", "PGRST_DB_URI", "CREDENTIAL_KEYS", "CRON_SECRET"]) t.vars[key] = "<REPLACE_WITH_OWN_SECRET>";
    expect(checkEnvFiles({ production: t })).toEqual([]);
  });
});

describe("compose model", () => {
  it("passes for the expected shape", () => {
    expect(checkCompose(compose())).toEqual([]);
  });

  it("fails when the app publishes a port", () => {
    const model = compose();
    model.services.app.ports = [{ target: 3000, published: "3000" }];
    expect(checkCompose(model)).toEqual(["compose: service app publishes ports; only the proxy may (the app is reachable on the compose network alone)"]);
  });

  it("fails on an unpinned image, a missing digest, a missing service and a missing TRUSTED_PROXY", () => {
    const model = compose();
    model.services.app.image = "geraiexpress:latest";
    model.services.scheduler.image = "geraiexpress";
    model.services.proxy.image = "caddy:2.11.2-alpine";
    delete model.services.app.environment.TRUSTED_PROXY;
    const problems = checkCompose(model);
    expect(problems).toEqual(expect.arrayContaining([
      'compose: service app image "geraiexpress:latest" is not pinned to a tag',
      'compose: service scheduler image "geraiexpress" is not pinned to a tag',
      "compose: the proxy image is not pinned by digest",
      "compose: the app must run with TRUSTED_PROXY=1 behind the proxy (the client address would be unknown)",
    ]));
    delete model.services.scheduler;
    expect(checkCompose(model)).toContain('compose: service "scheduler" is missing');
  });

  it("fails when the scheduler holds more than the cron secret, or the app has shared mode", () => {
    const model = compose();
    model.services.scheduler.environment.AUTH_JWT_SECRET = "x";
    model.services.scheduler.env_file = [{ path: ".env" }];
    model.services.app.environment.HOST_SHARED_MODE = "1";
    expect(checkCompose(model)).toEqual(expect.arrayContaining([
      "compose: the scheduler holds AUTH_JWT_SECRET; it may hold CRON_SECRET only",
      "compose: the scheduler must not load the app's env file (it holds CRON_SECRET only)",
      "compose: the app has HOST_SHARED_MODE=1",
    ]));
  });

  it("requires PostgREST on the internal network with the documented settings, and a non-local POSTGREST_URL for the app", () => {
    const model = compose();
    model.services.postgrest.ports = [{ target: 3000, published: "3000" }];
    model.services.postgrest.environment.PGRST_DB_ANON_ROLE = "service_role";
    model.services.postgrest.environment.PGRST_DB_MAX_ROWS = "100000";
    model.services.app.environment.POSTGREST_URL = "http://127.0.0.1:55433";
    expect(checkCompose(model)).toEqual(expect.arrayContaining([
      "compose: service postgrest publishes ports; only the proxy may (the app is reachable on the compose network alone)",
      "compose: postgrest must run with PGRST_DB_ANON_ROLE=anon",
      "compose: postgrest must run with PGRST_DB_MAX_ROWS=1000",
      "compose: the app's POSTGREST_URL is a local address",
    ]));
    delete model.services.postgrest;
    delete model.services.app.environment.POSTGREST_URL;
    expect(checkCompose(model)).toEqual(expect.arrayContaining(['compose: service "postgrest" is missing', "compose: the app has no valid POSTGREST_URL"]));
  });

  it("refuses IPv6 or unspecified binds that collapse IPv6 visitors through docker-proxy", () => {
    for (const host_ip of [undefined, "::", "[::]", "127.0.0.1"]) {
      const model = compose();
      model.services.proxy.ports[0].host_ip = host_ip;
      expect(checkCompose(model)).toContain("compose: proxy ports must bind explicitly to IPv4 0.0.0.0 (no IPv6-to-IPv4 client-address collapse)");
    }
  });

  it("requires the production Caddyfile mount, bounded service logs and read-only roots", () => {
    const model = compose();
    model.services.proxy.volumes[0].source = "./infra/proxy/Caddyfile.local";
    delete model.services.app.logging;
    model.services.proxy.read_only = false;
    model.services.proxy.cap_add.push("SYS_ADMIN");
    const errors = checkCompose(model);
    expect(errors).toContain("compose: the production proxy must mount infra/proxy/Caddyfile read-only, never Caddyfile.local");
    expect(errors).toContain("compose: service app must use bounded local logging (10m, 3 files)");
    expect(errors).toContain("compose: service proxy must have a read-only root filesystem");
    expect(errors).toContain("compose: proxy capabilities must drop ALL and add only NET_BIND_SERVICE");
  });
});

describe("proxy configuration (inspection of infra/proxy)", () => {
  const caddy = readFileSync(new URL("../../infra/proxy/Caddyfile", import.meta.url), "utf8");
  const local = readFileSync(new URL("../../infra/proxy/Caddyfile.local", import.meta.url), "utf8");

  it("the real files pass", () => {
    expect(checkProxyConfig(caddy)).toEqual([]);
    expect(checkProxyConfig(local, { local: true })).toEqual([]);
  });

  it("production overwrites X-Real-IP with the TCP peer, replaces X-Forwarded-For and trusts no client header", () => {
    expect(caddy).toContain("header_up X-Real-IP {remote_host}");
    expect(caddy).toContain("header_up -Forwarded");
    expect(caddy).toContain("header_up -CF-Connecting-IP");
    expect(caddy).not.toMatch(/^\s*(?!#).*trusted_proxies/m);
    expect(caddy).not.toMatch(/auto_https\s+off/);
    for (const host of ["SITE_HOST", "APP_HOST", "OWNER_HOST", "HOOKS_HOST"]) expect(caddy).toContain(`{$${host}:`);
  });

  it("/api/internal is denied before anything is proxied, in both profiles", () => {
    for (const text of [caddy, local]) {
      const deny = text.indexOf("handle @internal");
      const proxy = text.indexOf("reverse_proxy app:3000");
      expect(deny).toBeGreaterThan(-1);
      expect(deny).toBeLessThan(proxy);
      expect(text).toMatch(/respond "Not Found" 404/);
    }
    const re = /^\/+api\/+internal(\/|$)/i;
    for (const path of ["/api/internal", "/api/internal/cron/dispatch", "//api//internal/cron/cleanup", "/API/Internal/cron/dispatch"]) expect(re.test(path), path).toBe(true);
    for (const path of ["/api/internals", "/api/auth/send-email", "/"]) expect(re.test(path), path).toBe(false);
  });

  it("the local profile alone trusts X-Forwarded-For from the pinned local gateway", () => {
    expect(local).toMatch(/trusted_proxies static 172\.30\.62\.1\/32/);
    expect(local).not.toContain("private_ranges");
    expect(local).toContain("header_up X-Real-IP {client_ip}");
    const override = readFileSync(new URL("../../compose.local.yaml", import.meta.url), "utf8");
    expect(override).toContain("gateway: 172.30.62.1");
    expect(checkProxyConfig(local.replace("172.30.62.1/32", "private_ranges"), { local: true })).toContain("proxy: local forwarded headers may be trusted only from the pinned gateway 172.30.62.1/32");
  });

  it("flags a production proxy that trusts clients or forwards the client's address", () => {
    expect(checkProxyConfig(caddy.replaceAll("header_up X-Real-IP {remote_host}", ""))).toContain("proxy: X-Real-IP is not overwritten with the peer address");
    expect(checkProxyConfig(caddy.replace("admin off", "admin off\n\tservers {\n\t\ttrusted_proxies static private_ranges\n\t}"))).toContain("proxy: the production proxy must not trust any client X-Forwarded-* (remove trusted_proxies)");
    expect(checkProxyConfig(caddy.replaceAll("handle @internal", "handle @nothing"))).toContain("proxy: /api/internal is not denied");
  });
});
