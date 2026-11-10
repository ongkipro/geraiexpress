import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
// @ts-expect-error plain ESM script, no type declarations
import { checkCompose, checkCoolifySecrets, checkEnvFiles, checkProxyConfig, composeDrift, parseEnv, validProxyPeer } from "../../scripts/check-environments.mjs";

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
  it("MAIL_TRANSPORT=smtp needs host, port, username and password in a real environment file (P2-8)", () => {
    const prod = production();
    const smtp = { ...prod.vars, MAIL_TRANSPORT: "smtp", SMTP_SECURITY: "tls" };
    const problems = checkEnvFiles({ staging: staging(), production: { vars: smtp } });
    for (const name of ["SMTP_HOST", "SMTP_PORT", "SMTP_USERNAME", "SMTP_PASSWORD"]) expect(problems).toContain(`production: MAIL_TRANSPORT=smtp needs ${name}`);
    const full = { ...smtp, SMTP_HOST: "smtp.example.com", SMTP_PORT: "465", SMTP_USERNAME: "mailer", SMTP_PASSWORD: "production-smtp-password-0123456789ab" };
    expect(checkEnvFiles({ staging: staging(), production: { vars: full } }).filter((p: string) => p.includes("SMTP"))).toEqual([]);
  });

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

  it("fail when TURNSTILE_HOSTNAMES is unset, local or not a bare hostname, in real files and templates", () => {
    for (const template of [false, true]) {
      for (const value of [undefined, "", " , "]) {
        const s = { ...staging(), template };
        if (value === undefined) delete s.vars.TURNSTILE_HOSTNAMES;
        else s.vars.TURNSTILE_HOSTNAMES = value;
        expect(checkEnvFiles({ staging: s })).toContain("staging: TURNSTILE_HOSTNAMES is not set (the public hosts serving the Turnstile widget)");
      }
      const s = { ...staging(), template };
      s.vars.TURNSTILE_HOSTNAMES = "app-staging.geraiexpress.com, LocalHost,127.0.0.1,gx.localhost,https://owner-staging.geraiexpress.com";
      expect(checkEnvFiles({ staging: s })).toEqual(expect.arrayContaining([
        "staging: TURNSTILE_HOSTNAMES must not include the local host localhost",
        "staging: TURNSTILE_HOSTNAMES must not include the local host 127.0.0.1",
        "staging: TURNSTILE_HOSTNAMES must not include the local host gx.localhost",
        'staging: TURNSTILE_HOSTNAMES entry "https://owner-staging.geraiexpress.com" is not a bare hostname (no scheme, port or path)',
      ]));
    }
    // A staging file copied from the production template must not keep the production hosts: every token would fail.
    const copied = staging();
    copied.vars.TURNSTILE_HOSTNAMES = "app.geraiexpress.com,owner.geraiexpress.com";
    expect(checkEnvFiles({ staging: copied, production: production() })).toEqual(expect.arrayContaining([
      "staging: TURNSTILE_HOSTNAMES includes the production host app.geraiexpress.com",
      "staging: TURNSTILE_HOSTNAMES includes the production host owner.geraiexpress.com",
    ]));
    const local = { vars: { CRON_SECRET: "local-cron-secret-0123456789abcdef", TURNSTILE_HOSTNAMES: "localhost" } };
    expect(checkEnvFiles({ local }).filter((p: string) => p.includes("TURNSTILE_HOSTNAMES"))).toEqual([]);
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

  // T-063: SMTP submission is TLS-only in release environments, and its password is a secret like the others.
  it("require TLS for MAIL_TRANSPORT=smtp and treat SMTP_PASSWORD as a never-committed, never-shared secret", () => {
    const s = staging(); const p = production();
    s.vars.MAIL_TRANSPORT = "smtp"; s.vars.SMTP_SECURITY = "none";
    expect(checkEnvFiles({ staging: s, production: p })).toContain("staging: MAIL_TRANSPORT=smtp needs SMTP_SECURITY=tls or starttls");
    s.vars.SMTP_SECURITY = "starttls";
    expect(checkEnvFiles({ staging: s, production: p })).not.toContain("staging: MAIL_TRANSPORT=smtp needs SMTP_SECURITY=tls or starttls");
    s.vars.SMTP_PASSWORD = "provider-key-1"; p.vars.SMTP_PASSWORD = "provider-key-1";
    expect(checkEnvFiles({ staging: s, production: p })).toContain("staging and production share the same SMTP_PASSWORD value: every environment needs its own");
    const t = { vars: parseEnv(readFileSync(new URL("../../infra/env/production.env.example", import.meta.url), "utf8")), template: true };
    t.vars.SMTP_PASSWORD = "provider-key-1";
    expect(checkEnvFiles({ production: t })).toContain("production: the committed template carries a value for SMTP_PASSWORD; secrets belong in the 0600 env file outside the repository");
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

  // T-114: the alpha staging checklist (docs/runbooks/staging-alpha.md) relies on these template facts.
  it("the staging template names the staging hosts, a sandbox provider, and the complete SMTP set with no secret value", () => {
    const st = parseEnv(readFileSync(new URL("../../infra/env/staging.env.example", import.meta.url), "utf8"));
    expect([st.SITE_HOST, st.APP_HOST, st.OWNER_HOST, st.HOOKS_HOST]).toEqual([
      "staging.geraiexpress.com", "app-staging.geraiexpress.com", "owner-staging.geraiexpress.com", "hooks-staging.geraiexpress.com"]);
    expect(st.APP_ORIGIN).toBe("https://app-staging.geraiexpress.com");
    expect(st.MENGANTAR_ENV).toBe("sandbox");
    for (const name of ["MAIL_TRANSPORT", "MAIL_FROM", "SMTP_HOST", "SMTP_PORT", "SMTP_SECURITY", "SMTP_USERNAME", "SMTP_PASSWORD"]) {
      expect(Object.keys(st), name).toContain(name);
    }
    expect(st.MAIL_TRANSPORT ?? "").toBe("");
    expect(st.SMTP_PASSWORD ?? "").toBe("");
    expect(st.MAIL_FROM).toBe("no-reply@geraiexpress.com");
  });

  it("the committed staging and production templates pass together and name the data and auth settings", () => {
    const read = (name: string) => ({ vars: parseEnv(readFileSync(new URL(`../../infra/env/${name}.env.example`, import.meta.url), "utf8")), template: true });
    expect(checkEnvFiles({ staging: read("staging"), production: read("production") })).toEqual([]);
    for (const template of [read("staging"), read("production")]) {
      for (const name of ["POSTGREST_URL", "AUTH_JWT_SECRET", "AUTH_SECRET", "TRACKING_TOKEN_SECRET", "TURNSTILE_SITE_KEY", "TURNSTILE_SECRET_KEY", "TURNSTILE_HOSTNAMES", "PGRST_DB_URI"]) {
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
  const coolify = readFileSync(new URL("../../infra/proxy/Caddyfile.coolify", import.meta.url), "utf8");

  it("the Coolify proxy file is inspected too (P2-8)", () => {
    expect(checkProxyConfig(coolify, { coolify: true })).toEqual([]);
    expect(checkProxyConfig(coolify.replace("trusted_proxies static {$COOLIFY_PROXY_CIDR}", "trusted_proxies static private_ranges"), { coolify: true }))
      .toContain("proxy: the Coolify proxy must trust only {$COOLIFY_PROXY_CIDR} (strict)");
    expect(checkProxyConfig(coolify.replace("header_up X-Real-IP {client_ip}", ""), { coolify: true })).toContain("proxy: X-Real-IP is not overwritten with the peer address");
    expect(checkProxyConfig(coolify.replace("handle @internal", "handle @nothing"), { coolify: true })).toContain("proxy: /api/internal is not denied");
    // Behind Cloudflare the visitor is only in CF-Connecting-IP; an X-Forwarded-For fallback would let the trusted edge's
    // copy of a client header choose the limiter key (live finding 2026-11-10).
    for (const bad of ["client_ip_headers X-Forwarded-For", "client_ip_headers CF-Connecting-IP X-Forwarded-For"]) {
      expect(checkProxyConfig(coolify.replace("client_ip_headers CF-Connecting-IP", bad), { coolify: true }))
        .toContain("proxy: the Coolify proxy must read the visitor address from CF-Connecting-IP only");
    }
    expect(readFileSync(new URL("../../scripts/check-environments.mjs", import.meta.url), "utf8")).toContain('"infra/proxy/Caddyfile.coolify"');
  });

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

describe("compose.coolify.yaml stays a faithful flat mirror of compose.yaml", () => {
  const base = () => ({ services: {
    app: { image: "img", environment: { A: "1", B: "2" }, stop_grace_period: "5m0s", read_only: true },
    proxy: { image: "caddy", ports: [{ target: 80 }], volumes: [{ source: "./infra/proxy/Caddyfile" }], environment: { SITE_HOST: "x" } },
    postgres: { image: "pg", profiles: ["db"] },
  } });
  const flat = () => ({ services: {
    app: { image: "img", environment: { A: "1", B: "2" }, stop_grace_period: "5m0s", read_only: true },
    proxy: { image: "caddy", expose: ["8080"], volumes: [{ source: "./infra/proxy/Caddyfile.coolify" }], environment: { SITE_HOST: "x", COOLIFY_PROXY_CIDR: "192.0.2.1/32" } },
    postgres: { image: "pg" },
  } });

  it("accepts the documented Coolify differences only", () => {
    expect(composeDrift(base(), flat())).toEqual([]);
  });

  it("names the drifted path (never a value) for a missing variable, a changed field or a missing service", () => {
    const f = flat();
    delete (f.services.app.environment as Record<string, string>).B;
    f.services.app.read_only = false;
    delete (f.services as Record<string, unknown>).postgres;
    const problems = composeDrift(base(), f);
    expect(problems).toEqual(expect.arrayContaining([
      "Coolify compose drifts from compose.yaml at services.app.environment.B",
      "Coolify compose drifts from compose.yaml at services.app.read_only",
      "Coolify compose drifts from compose.yaml at services.postgres.(service)",
    ]));
    expect(problems.join("\n")).not.toContain("192.0.2.1");
  });

  it("does not excuse a difference outside the documented list (proxy image, app ports)", () => {
    const f = flat();
    f.services.proxy.image = "caddy:other";
    (f.services.app as Record<string, unknown>).ports = [{ target: 3000 }];
    expect(composeDrift(base(), f)).toEqual(expect.arrayContaining([
      "Coolify compose drifts from compose.yaml at services.proxy.image",
      "Coolify compose drifts from compose.yaml at services.app.ports",
    ]));
  });
});

describe("Coolify secrets come from per-service host files, never from Coolify's shared .env (live finding 2026-11-10)", () => {
  // The rendered model of the real compose.coolify.yaml (the same call check:environments makes).
  const rendered = () => JSON.parse(execFileSync("docker", ["compose", "-p", "gxcheck", "--env-file", "infra/env/production.env.example",
    "-f", "compose.coolify.yaml", "config", "--format", "json"], { env: { ...process.env, COOLIFY_PROXY_CIDR: "192.0.2.1/32" }, encoding: "utf8" }));

  it("accepts compose.coolify.yaml as committed", () => {
    expect(checkCoolifySecrets(rendered())).toEqual([]);
  });

  it("refuses a secret value in any service environment, including the proxy", () => {
    const m = rendered();
    m.services.app.environment.AUTH_JWT_SECRET = "${AUTH_JWT_SECRET}";
    m.services.proxy.environment.CREDENTIAL_KEYS = "x";
    m.services.postgres.environment.POSTGRES_PASSWORD = "x";
    m.services.postgrest.environment.PGRST_DB_URI = "postgres://authenticator:x@postgres/geraiexpress";
    m.services.scheduler.environment.CRON_SECRET = "x";
    expect(checkCoolifySecrets(m)).toEqual(expect.arrayContaining([
      "compose: service app receives AUTH_JWT_SECRET through its environment; Coolify secrets come from a host file",
      "compose: service proxy receives CREDENTIAL_KEYS through its environment; Coolify secrets come from a host file",
      "compose: service postgres receives POSTGRES_PASSWORD through its environment; Coolify secrets come from a host file",
      "compose: service postgrest receives PGRST_DB_URI through its environment; Coolify secrets come from a host file",
      "compose: service scheduler receives CRON_SECRET through its environment; Coolify secrets come from a host file",
    ]));
  });

  it("refuses an auto-created, writable or missing secret mount, a missing group or --env-file", () => {
    const m = rendered();
    m.services.app.volumes[0].bind = {};
    m.services.scheduler.volumes[0].read_only = false;
    m.services.postgrest.group_add = [];
    m.services.postgres.volumes = m.services.postgres.volumes.filter((v: { target: string }) => v.target !== "/run/gx/postgres_password");
    m.services.app.command = ["node", "server.js"];
    expect(checkCoolifySecrets(m)).toEqual(expect.arrayContaining([
      "compose: service app must mount /etc/geraiexpress/app.env read-only at /run/gx/app.env with create_host_path: false",
      "compose: service scheduler must mount /etc/geraiexpress/scheduler.env read-only at /run/gx/scheduler.env with create_host_path: false",
      "compose: service postgrest must join group 10103 to read its secret file",
      "compose: service postgres must mount /etc/geraiexpress/postgres_password read-only at /run/gx/postgres_password with create_host_path: false",
      "compose: service app must start node with --env-file=/run/gx/app.env",
    ]));
  });

  it("refuses a proxy running as root or holding another service's secret file", () => {
    const m = rendered();
    delete m.services.proxy.user;
    m.services.proxy.volumes.push({ type: "bind", source: "/etc/geraiexpress/app.env", target: "/x", read_only: true });
    expect(checkCoolifySecrets(m)).toEqual(expect.arrayContaining([
      "compose: the Coolify proxy must run as the unprivileged user 65534",
      "compose: service proxy mounts a secret file it does not own",
    ]));
  });
});
