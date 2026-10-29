#!/usr/bin/env bash
# Local-only environment for the gxdb stack and the app (`pnpm dev:env`; `pnpm db:up` runs it first). Writes:
#   infra/dev/*.env  the stack's own files (compose.db.yaml) and the test/script values (AUTH_JWT_SECRET, ANON_JWT...)
#   .env.local       for `next dev` (host URLs, 127.0.0.1)
#   .env.container   for the local container (`pnpm docker:up`): the same values with the container's view of the
#                    stack (compose.local.yaml joins the gxdb_default network) and the local proxy's origins
# All are gitignored, mode 0600, and hold LOCAL values only: never point them at a shared or remote database.
# Existing secrets are reused, so locally stored ciphertext and sessions stay valid. Server-only secrets live
# in these files, which is safe: Next.js inlines only NEXT_PUBLIC_* values into the browser bundle, the Docker
# build context excludes every .env* file, and `pnpm check:bundle` scans the build output for these values.
# Production secrets come from a 0600 env file OUTSIDE the repository (RELEASE.md).
set -euo pipefail
root="$(dirname "$(dirname "$(realpath "${BASH_SOURCE[0]}")")")"
node --input-type=module - "$root" <<'NODE'
import { randomBytes, randomUUID, createHmac } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
const dir = `${process.argv[2]}/infra/dev`;
const file = `${dir}/.env`;
const previous = existsSync(file) ? parseEnv(readFileSync(file, 'utf8')) : {};
const secret = (name) => /^[a-f0-9]{64}$/.test(previous[name] ?? '') ? previous[name] : randomBytes(32).toString('hex');
const jwtSecret = secret('AUTH_JWT_SECRET');
const authSecret = secret('AUTH_SECRET');
const postgresPassword = secret('POSTGRES_PASSWORD');
const authenticatorPassword = secret('AUTHENTICATOR_PASSWORD');
const now = Math.floor(Date.now() / 1000);
function jwt(role) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    role, aud: 'authenticated', iat: now, exp: now + 10 * 365 * 86400,
    session_id: randomUUID(), email: '', is_anonymous: false, aal: 'aal1', amr: [],
  })).toString('base64url');
  const data = `${header}.${payload}`;
  return `${data}.${createHmac('sha256', jwtSecret).update(data).digest('base64url')}`;
}
// Static role tokens intentionally have no user `sub`: they must never impersonate a fixture user.
const values = {
  POSTGRES_DB: 'gxdb', POSTGRES_USER: 'postgres', POSTGRES_PASSWORD: postgresPassword,
  AUTHENTICATOR_PASSWORD: authenticatorPassword, AUTH_JWT_SECRET: jwtSecret, AUTH_SECRET: authSecret,
  POSTGREST_URL: 'http://127.0.0.1:55433',
  ANON_JWT: jwt('anon'), SERVICE_ROLE_JWT: jwt('service_role'),
  MAILPIT_URL: 'http://127.0.0.1:58025', SMTP_HOST: '127.0.0.1', SMTP_PORT: '55025',
};
// Each container receives only its own variables (least privilege).
const services = {
  'postgres.env': { POSTGRES_DB: 'gxdb', POSTGRES_USER: 'postgres', POSTGRES_PASSWORD: postgresPassword, PGDATABASE: 'gxdb' },
  'postgrest.env': {
    PGRST_DB_URI: `postgres://authenticator:${authenticatorPassword}@postgres:5432/gxdb`, PGRST_JWT_SECRET: jwtSecret,
  },
};
mkdirSync(dir, { recursive: true, mode: 0o700 });
chmodSync(dir, 0o700);
const render = (entries) => Object.entries(entries).map(([name, value]) => `${name}=${value}\n`).join('');
const header = '# Local disposable gxdb only. Generated secrets; never commit or copy to production.\n';
writeFileSync(file, header + render(values), { mode: 0o600 });
chmodSync(file, 0o600);
for (const [name, entries] of Object.entries(services)) {
  writeFileSync(`${dir}/${name}`, header + render(entries), { mode: 0o600 });
  chmodSync(`${dir}/${name}`, 0o600);
}
// The app's own environment. The app mints its static role tokens from AUTH_JWT_SECRET itself, so neither
// ANON_JWT nor SERVICE_ROLE_JWT is passed to it. Live Mengantar calls use the sandbox (DEC-010).
const appFiles = ['.env.local', '.env.container'];
const reused = (name, valid) => {
  for (const appFile of appFiles) {
    const path = `${process.argv[2]}/${appFile}`;
    const value = existsSync(path) ? parseEnv(readFileSync(path, 'utf8'))[name] : undefined;
    if (value && valid(value)) return value;
  }
  return undefined;
};
const credentialKey = reused('CREDENTIAL_KEY', (value) => Buffer.from(value, 'base64').length === 32) ?? randomBytes(32).toString('base64');
const cronSecret = reused('CRON_SECRET', (value) => value.length >= 32) ?? randomBytes(32).toString('hex');
const common = {
  AUTH_JWT_SECRET: jwtSecret, AUTH_SECRET: authSecret, AUTH_CAPTCHA_DISABLED: 'true',
  MAIL_TRANSPORT: 'mailpit', CREDENTIAL_KEY: credentialKey, CRON_SECRET: cronSecret, MENGANTAR_ENV: 'sandbox',
  // The widget's public site key: Cloudflare's always-pass test key. Server-side verification is off locally.
  TURNSTILE_SITE_KEY: '1x00000000000000000000AA',
};
// HOST_SHARED_MODE=1 (a production build on a loopback host serves every audience from one host only with this
// flag, src/lib/hosts.ts; never for staging or production) and the four *_ORIGIN values (a production build
// refuses to build a link without them) apply to the container only: `next dev` leaves links relative.
// TRUSTED_PROXY=1 is set here for `next dev` only (no proxy; the e2e fixtures send X-Real-IP themselves); the
// container gets it from compose.yaml, where the proxy really overwrites it.
const origin = `http://127.0.0.1:${process.env.GX_LOCAL_PORT || '8080'}`;
const appEnv = {
  '.env.local': { POSTGREST_URL: values.POSTGREST_URL, MAILPIT_URL: values.MAILPIT_URL, TRUSTED_PROXY: '1', ...common },
  '.env.container': {
    POSTGREST_URL: 'http://gxdb-postgrest-1:3000', MAILPIT_URL: 'http://gxdb-mailpit-1:8025',
    HOST_SHARED_MODE: '1', SITE_ORIGIN: origin, APP_ORIGIN: origin, OWNER_ORIGIN: origin, HOOKS_ORIGIN: origin, ...common,
  },
};
for (const [name, entries] of Object.entries(appEnv)) {
  writeFileSync(`${process.argv[2]}/${name}`, header + render(entries), { mode: 0o600 });
  chmodSync(`${process.argv[2]}/${name}`, 0o600);
}
console.log([...Object.keys(values), ...Object.values(services).flatMap((entries) => Object.keys(entries)), ...appFiles].join('\n'));
NODE
