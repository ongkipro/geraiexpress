# GeraiExpress

Multi-tenant shipping-counter application using PostgreSQL 17, PostgREST and Mengantar, run as a
self-hosted Node.js container (Next.js standalone) behind a Caddy reverse proxy on a server with a fixed
IPv4 address on Vultr under Coolify (DEC-022). Authentication is an application-owned module (ADR-0002, DEC-021); Supabase and its
CLI are no longer used by the code. Cloudflare Turnstile remains the CAPTCHA widget; Cloudflare is not the
runtime.

Status: DEL-1 stages 1–3 and the 2026-10-28 review features/fixes through waves E and F are
implemented locally (uncommitted); T-050's key ring and T-053's shipment UI are merged. T-043 still
needs the supervised sandbox capture. T-062 moved the runtime from Cloudflare Workers to the
container described below, and T-066 (DEC-021) replaced Supabase in the code with plain PostgreSQL 17,
PostgREST and the application-owned auth module; final counts and the final-build container e2e are
recorded by the lead in STATUS.md. Production is not provisioned; the initial target is same-host PostgreSQL with persistent storage on Vultr + Coolify. Payment,
regeneration and pickup have no supervised provider capture. Technical documentation is English;
conversation and product UI are Bahasa Indonesia.

## Preview

DEC-020 withdraws the old Worker preview as a hosting choice, but that old deployment (a Cloudflare Worker
and its Supabase project) still exists remotely until the owner deletes it and rotates its secrets
(RELEASE.md). Nothing in this repository can reach it any more. No container preview has been deployed. `pnpm smoke:preview`
(`PREVIEW_URL=https://<host>`) checks a deliberately named deployed origin; it is not a deployment command.

## Start here

- [System map and current architecture](ARCHITECTURE.md): what is implemented and proved,
  with runtime, code, data and flow diagrams.
- [Specification index](docs/spec/README.md): canonical product, technical, data,
  access, design, financial, operational and UX contracts.
- [Architecture design](docs/spec/04-SYSTEM-ARCHITECTURE.md): target system boundaries; the
  [auth and database decision](docs/adr/ADR-0002-postgres-owned-auth.md) (ADR-0002) records why Supabase left.
- [Current status](STATUS.md), [decisions](DECISIONS.md), [work queue](TASKS.md)
  and [build history](BUILD-LOG.md): repository handoff and actual evidence.
- [Mengantar Partner study](docs/research/geraiexpress-mengantar-partner-api.md) and
  [reference pricing study](docs/research/geraiexpress-reference-pricing-review.md).

## Vultr + Coolify

Use `compose.coolify.yaml` as the Compose location. It inherits the hardened services from
`compose.yaml`, exposes the internal Caddy gateway on port 8080, and publishes no host ports.
Assign the four HTTPS domains to **proxy:8080** only; Coolify owns TLS and public 80/443.
Set `COOLIFY_PROXY_CIDR` to the verified Coolify edge address (`/32` or `/128`) on the resource
network. Never trust the whole Docker subnet. See [release instructions](RELEASE.md).
The `db` profile adds PostgreSQL with a persistent volume. Do not enable the standalone `prod`
proxy or route public domains to app/PostgREST/PostgreSQL. One app replica only.

Isolated verification without reading the existing development environment:

```bash
node scripts/test-backend-isolated.mjs  # fresh local PG/PostgREST, full DB suite, removes its own fixtures
node scripts/test-coolify-proxy.mjs    # real Caddy: trusted peer, forged headers, internal routes, body cap
```

These commands require a local Docker socket and use only newly generated test credentials.
They never reset the shared `gxdb` database. Unit tests and type checking remain in `package.json`.

## Run locally

Requirements: Node 24, pnpm 12, Docker (for the local database stack and the container). Nothing here
talks to a shared or production service. The local stack (`compose.db.yaml`, Compose project `gxdb`) is
PostgreSQL 17, PostgREST and Mailpit, all published on 127.0.0.1 only: Postgres 55432, PostgREST 55433,
SMTP 55025, Mailpit UI/API 58025.

```bash
pnpm install
pnpm db:up               # dev:env, then the gxdb stack: migrations (db/foundation, db/migrations), seed (db/seed.sql), PostgREST ready
pnpm dev:env             # (already run by db:up) writes gitignored infra/dev/*.env, .env.local (next dev) and .env.container
pnpm dev -p 3100 -H 127.0.0.1   # Next.js dev server → http://127.0.0.1:3100
```

The emailed sign-in code is sent by the app straight to the local Mailpit (`MAIL_TRANSPORT=mailpit`,
`MAILPIT_URL`); read it at http://127.0.0.1:58025. There is no relay to start.

Database scripts (`pnpm db:verify` takes `flock /tmp/gx-db.lock`, so two database suites never run at once):

```bash
pnpm db:up        # generates infra/dev/.env (gitignored secrets; prints names only), starts postgres + mailpit,
                  # applies db/foundation then db/migrations, loads db/seed.sql when absent, starts PostgREST and waits for it
pnpm db:migrate   # applies only new migrations; serializes deploys and refuses missing/changed applied migration history
pnpm db:areas     # T-100 (owner 2026-11-05): owner-only load of committed Mengantar gzip; validated upsert, never delete
pnpm db:backup /secure/path/gxdb.dump  # custom-format archive; exclusive create, mode 0600 (or set BACKUP_DIR)
pnpm db:restore-check /secure/path/gxdb.dump gxrestore_drill # NEW scratch DB, row counts + ledger, then drop
pnpm db:reset     # drops and recreates database gxdb, then migrates (loopback host and gx* name only; no seed)
pnpm db:verify    # lock, reset, seed, restart PostgREST, wait until ready, then vitest tests/db (or the args you pass)
pnpm db:down      # stops the stack and removes its volume
```

Backup/restore scripts default to local gxdb; export operator `DATABASE_URL` for a remote server with PostgreSQL
17 client tools on PATH (password passed via libpq environment, never argv). Quiesce writers for count comparison.
Cluster roles/passwords are re-provisioned, not dumped. Release backup storage, PITR and safe auth-key rotation
procedure: [RELEASE.md](RELEASE.md), gates 11–17. `node scripts/reseal-totp.mjs` rotates sealed MFA secrets in one
transaction with `OLD_AUTH_SECRET` / `NEW_AUTH_SECRET` from protected environment; stop writers first, never
rotate `AUTH_SECRET` alone. Local `GX_PSQL_DB=gxrestore_name` selects a restored copy for rotation rehearsal.

T-100's area catalogue is loaded explicitly after migration, not by seed/reset or the isolated
harness. See [`data/mengantar/README.md`](data/mengantar/README.md) for provenance, gaps,
refresh approval and the optional dataset path. Run the loader twice to verify idempotence:
the second identical load must report `validated=79391 changed=0 unchanged=79391`.

`scripts/db-migrate.sh` also accepts `DATABASE_URL` (psql on PATH) instead of the Compose container, and
`DB_FOUNDATION_DIR`/`DB_MIGRATIONS_DIR` to point at other SQL directories. `db/foundation` creates what plain
PostgreSQL lacks (the roles `anon`, `authenticated`, `service_role`, `authenticator`, the `auth` and
`extensions` schemas); `db/migrations` holds the application schema and the auth core
(`20261029100000_auth_core.sql`). `supabase/` and the Supabase CLI no longer exist.

Run the production container locally (app + the plain-HTTP local proxy profile; `GX_SCHEDULER=1 pnpm docker:up` also starts the scheduler, off by default because a sweep every 5 minutes would race the shared local database suites). The container joins the stack's Docker network `gxdb_default` and reaches PostgREST and Mailpit by container name, so `pnpm db:up` must run first:

```bash
export APP_ORIGIN=http://127.0.0.1:8080     # baked into the static marketing pages at build time
pnpm docker:build                           # docker build --build-arg APP_ORIGIN ... (image geraiexpress:local)
pnpm docker:up                              # compose.yaml + compose.local.yaml, profile local → http://127.0.0.1:8080
pnpm smoke:container                        # build, up, probe /healthz, /masuk, wrong host, the cron route; then down
pnpm docker:down
```

`pnpm build` also requires `APP_ORIGIN` exported because marketing links are prerendered; runtime
configuration is the container environment, not the build shell. `pnpm dev:env` writes
`.env.container` with `HOST_SHARED_MODE=1`, the four `*_ORIGIN` values (the local proxy origin,
`GX_LOCAL_PORT` overrides 8080), the in-network PostgREST and Mailpit URLs
(`http://gxdb-postgrest-1:3000`, `http://gxdb-mailpit-1:8025`) and a `CRON_SECRET`; it preserves the local
credential key. `.env.local` and `.env.container` both carry `AUTH_JWT_SECRET`, `AUTH_SECRET`,
`AUTH_CAPTCHA_DISABLED=true` (the local explicit opt-out of server-side Turnstile; the widget uses
Cloudflare's always-pass test site key) and `MAIL_TRANSPORT=mailpit`. Shared mode is
only for local use, never staging/production. The image is built from `Dockerfile` (multi-stage,
Node 24 pinned by digest, non-root `node` user, `HEALTHCHECK` on `/healthz`); the build context is an
allow-list (`.dockerignore`) and never contains an env file.

For e2e against the container, target the already-running container (the specs read the sign-in codes from
the host's Mailpit on 58025; `E2E_MAILPIT_URL` overrides it):

```bash
E2E_BASE_URL=http://127.0.0.1:8080 E2E_PRODUCTION_BUILD=1 pnpm test:e2e --project=desktop-1280
```

The local proxy profile (`infra/proxy/Caddyfile.local`) trusts **only** gateway `172.30.62.1/32`
(pinned by `compose.local.yaml`) to supply `X-Forwarded-For`, and writes that into `X-Real-IP`.
The e2e fixtures cycle TEST-NET addresses so tests act as distinct visitors; sibling containers are
untrusted. The production proxy trusts no forwarded address. Ingress is IPv4-only: publish A records
only, no AAAA (RELEASE.md). Do not hide failures with sleeps or retries.

AI agents: `next dev` rewrites `AGENTS.md` when it detects an agent environment; start it
with the agent variables unset (see BUILD-LOG.md) or revert the injected block.

### Host topology and configuration names (names only, no values)

Each host serves one audience (apex public site, `app.` gerai application, `owner.` Super Admin,
`hooks.` reserved cookie-less webhook host, with no route today; `src/lib/hosts.ts`). Locally, a bare `127.0.0.1` or `localhost` serves every
audience (the default for `next dev`, Playwright and, with `HOST_SHARED_MODE=1`, the local
container), and `site.localhost`, `app.localhost`, `owner.localhost` and `hooks.localhost` pick one
audience each. A fifth name, `internal.geraiexpress.local`, serves only `/healthz` and the scheduler's
`/api/internal/cron/*` routes; the proxy routes neither that name nor that path. All configuration is
read from the container environment through one reader (`src/lib/config.ts`); `.env.example` lists
the names and `infra/env/*.env.example` are the staging and production templates:

| Name | Where | Purpose |
|---|---|---|
| `HOST_SHARED_MODE` | Container env | `1` enables all audiences on one loopback host: the local container behind the local proxy needs it. `dev:env` writes it into `.env.container`. Never set it for staging/production (`check:environments` refuses it) |
| `APP_ORIGIN` | Build argument and container env | Read by current callers in `src/lib/hosts.ts`: `appOrigin()` builds invitation links and `appHref()` builds marketing CTAs. Missing value throws when a production-build link is built, so pass it to `docker build` (static marketing links bake it) and to the container; local example `http://127.0.0.1:8080` |
| `SITE_ORIGIN`, `OWNER_ORIGIN`, `HOOKS_ORIGIN` | Container env | Mapped by the generic `originFor(audience)` helper, which validates only the requested audience. No current application caller requests those three origins. The marketing `SITE_ORIGIN` is a separate fixed apex constant, not a read of this variable; setting them does not cut over hosts |
| `POSTGREST_URL` | Container env | The PostgREST the app talks to (HTTP, HS256 JWT). Production Compose defaults it to `http://postgrest:3000`; `dev:env` writes `http://127.0.0.1:55433` (`.env.local`) and `http://gxdb-postgrest-1:3000` (`.env.container`). Missing = every data call fails closed |
| `AUTH_JWT_SECRET`, `AUTH_SECRET` | Container env (secrets) | `AUTH_JWT_SECRET` signs the access tokens PostgREST verifies (PostgREST's `PGRST_JWT_SECRET` is the same value) and the machine identity; `AUTH_SECRET` roots the one-time-code HMAC and TOTP sealing keys. Both at least 32 bytes and different; the auth module refuses to start otherwise |
| `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`, `AUTH_CAPTCHA_DISABLED` | Container env | The app verifies the Turnstile token before password sign-in, demo entry, code request and code verification. A configured `TURNSTILE_SECRET_KEY` is enforced; without it the auth module fails closed unless `AUTH_CAPTCHA_DISABLED=true`, which is the explicit local opt-out and which `check:environments` refuses outside `local` |
| `MAIL_TRANSPORT`, `MAILPIT_URL`, `MAIL_FROM` | Container env | Delivery of the emailed code (`src/lib/mail-transport.ts`). Only `mailpit` exists, for local hosts only; anything else or unset fails closed. The production provider is owner-gated (T-063) |
| `PGRST_DB_URI`, `POSTGRES_PASSWORD` | Compose env file | Read by Compose only (not by the app): the `authenticator` connection string of the production `postgrest` service, and the password of the optional `postgres` service (profile `db`) |
| `TRUSTED_PROXY` | Container env | `1` = read the client address from `X-Real-IP`, which the proxy overwrites (`src/lib/client-address.ts`). `compose.yaml` sets it for the app; `dev:env` sets it in `.env.local` for `next dev`. Without it the address is unknown and the visitor limiters refuse in production |
| `CRON_SECRET` | Container env (app and scheduler) | Bearer secret of `/api/internal/cron/dispatch` and `/cleanup`; the routes are disabled (404) while unset. The scheduler holds this secret only |
| `CREDENTIAL_KEYS`, `CREDENTIAL_KEY_CURRENT` | Container env (secret) | Version-to-base64-key JSON ring and current version; opening uses stored `key_version`, sealing uses current. Single `CREDENTIAL_KEY` remains v1 while the ring is unset. Switch production values at first rotation; retain old keys until rewrap completes. Hourly `/api/internal/cron/cleanup` runs environment-scoped rewrap (T-057); inspect `credential_rewrap` counts/disabled state and failures before retiring old keys (OBSERVABILITY.md) |
| `PARTNER_TERMS_VERSION`, `PARTNER_PRIVACY_VERSION`, `PARTNER_TERMS_URL`, `PARTNER_PRIVACY_URL` | Container env | Provider Terms and Privacy document versions and URLs shown and recorded in the Partner consent step. Unset means onboarding is blocked (`configuration_blocked`) and the submit button is disabled; set them in `.env.local` to try the step locally. The real values are owner-held |
| `SIGN_IN_*`, `DEMO_*`, `OTP_*`, `MFA_*`, `REFRESH_*` limiters | In-process (`src/lib/limiter.ts`) | Fixed-window limits (visitor 10/5/3/10 per 60 s, account and refresh 10 per 60 s) with bounded memory; exact for ONE app instance, a second instance needs a shared store |
| `E2E_BASE_URL`, `E2E_APP_URL`, `E2E_SITE_URL`, `E2E_OWNER_URL`, `E2E_HOOKS_URL`, `E2E_MAILPIT_URL` | Playwright shell env | Base URL for the single-origin specs and one origin per audience for `tests/e2e/hosts.spec.ts` (derived as `*.localhost` on the same port when unset) |
| `E2E_PRODUCTION_BUILD` | Playwright shell env | `1` when the server under test is a production build (the container): the host spec then expects `Secure` cookies even over HTTP |

### Demo access (PR-21)

Open `/masuk` and choose **Coba demo**. No account or password is needed: each visitor gets an
isolated sample gerai ("Gerai Contoh Sentosa") with saved contacts and example shipments
(issued, unknown outcome, draft). Quotes, resi (`SIM…`) and labels are simulations and are
marked as such. **Atur ulang demo** restores the examples; **Keluar** ends the session.

Local test accounts (seeded fixtures, local stack only, password `geraiexpress-local-dev`):
`owner-a@geraiexpress.test`, `operator-a@geraiexpress.test`, `owner-b@geraiexpress.test`,
`no-access@geraiexpress.test`, `multi@geraiexpress.test` (two gerai → choose one),
`owner-c@geraiexpress.test` (Gerai Uji C, used by platform lifecycle tests).

Review gerai (local only, optional): `db/review-fixture.sql` adds one synthetic, non-demo,
active gerai, "Gerai Demo Review (contoh)", with `admin-review@geraiexpress.test` (tenant admin)
and `operator-review@geraiexpress.test` (operator), the same fixture password, one outlet in
Bandung, four contacts with addresses, and three simulated shipments (issued, unknown outcome,
draft). It is not part of `seed.sql` and never runs on `pnpm db:reset`, `pnpm db:verify` or against a remote database.
Its tenant insert gets a slug and a shipment prefix from the `tenants_identity` trigger (T-049), so its
shipments use the `PREFIX-yymmdd-seq` references; it has no discount-terms row and no `contact_whatsapp`
value yet, and its shipments are simulated, so the local masked label is not exercised by it.
Apply it with
`docker exec -i gxdb-postgres-1 psql -U postgres -d gxdb -v ON_ERROR_STOP=1 < db/review-fixture.sql`
(safe to repeat; it refuses to run unless the database is the gx-prefixed local one and the local seed user exists).

Credentials (local): `pnpm dev:env` writes a local `CREDENTIAL_KEY` (kept across runs), used as
version 1 to seal keys saved under `/pengaturan`. Ring values belong in runtime secrets (the 0600 env
file outside the repository), never in a committed file. The hourly cleanup task invokes
environment-scoped `reencryptCredentials` (T-057); retain old keys until completion is verified,
and investigate `credential_rewrap` failures or unexpected disabled state (OBSERVABILITY.md).

Registration (local): `/daftar` sends a 6-digit code (valid 10 minutes) to the local Mailpit at
http://127.0.0.1:58025; public registration is open only because `seed.sql` opens it.
Approve applications as a Super Admin under `/admin/pengajuan`.

Super Admin fixtures (open `/masuk`, then `/verifikasi-2fa`): `admin@geraiexpress.test` and
`admin-2@geraiexpress.test` carry a `verified` factor row in `db/seed.sql`, but the seed marks these rows as
catalog fixtures that are NOT usable TOTP secrets (`secret_sealed` is a placeholder, because the app seals
TOTP secrets with `AUTH_SECRET`); `tests/totp.ts` still holds the earlier local secrets (`totp()`).
`admin-new@geraiexpress.test` has no factor and walks through enrolment, which stores a sealed secret.
Whether the seeded rows and `tests/totp.ts` agree for the admin e2e is not established here.

## Checks

```bash
pnpm typecheck && pnpm test:unit
pnpm db:verify                                # plain PostgreSQL stack: reset + seed + restart PostgREST + tests/db
pnpm exec vitest run tests/db/privileges.test.ts   # catalog test: function signatures, relation sweep, seed marker
export APP_ORIGIN=http://127.0.0.1:8080         # local build only; choose the real app host for deploys
pnpm build && pnpm check:bundle               # standalone output in .next/standalone; bundle and baked-secret scan
pnpm smoke:container                          # image build + compose (local profile) + /healthz, /masuk, host and cron checks
pnpm check:environments                       # env templates + compose model + proxy config (see RELEASE.md)
pnpm test:e2e                                 # needs a server on :3100 (or E2E_BASE_URL, e.g. the container on :8080)
```

The catalog test (`tests/db/privileges.test.ts`) compares every function in `public` and `private`
by full signature against the allowlists in the file (anon, authenticated, `service_role`-only machine
RPCs, including the 14 `auth_*` functions of the auth core): add a new function to the right list in the
same change, or the test fails. It also runs as part of `pnpm db:verify` (`pnpm test:db` runs the same files
without the reset, against the stack that `pnpm db:up` started). The suite waits for PostgREST to rebuild
its schema cache and runs the files one at a time against one shared local database, so do not run
two database suites at once. `pnpm check:environments` is a release gate over the env files, the Compose
model and the proxy configuration (no secret value shared between environments, so each has its own database
and signing secrets; no production value in
staging, Turnstile never disabled outside local, only the proxy publishes ports, the proxy overwrites `X-Real-IP` and never routes
`/api/internal`); with no arguments it checks the committed staging and production templates, and a
release passes the real files: `pnpm check:environments staging=<file> production=<file>`.

## Repository layout

```text
geraiexpress/
├── Dockerfile · compose.yaml · compose.local.yaml · compose.db.yaml · .dockerignore   # the container image, its production Compose shape (T-062, ADR-0002) and the local database stack
├── infra/                        # proxy/ (Caddyfile, Caddyfile.local), scheduler/ (sidecar), env/ (templates), dev/ (generated local stack env, gitignored secrets)
├── src/
│   ├── app/                      # Next.js routes: /, fitur, simulasi, cara-kerja, hubungi-kami,
│   │   │                         # masuk, akses, pilih-gerai, daftar, undangan, verifikasi-2fa,
│   │   │                         # admin (akses, audit, pengajuan, integrasi, diskon), api/internal/cron, api/mengantar/area, healthz
│   │   └── (workspace)/          # pengiriman (+ label, invoice, export.csv), kontak, pengaturan, anggota (membership required)
│   ├── components/               # shell, status badge, marketing; ui/ = shadcn (radix, UI-2 tokens)
│   ├── lib/                      # db/ (PostgREST client, session, cookies, refresh), auth/ (service, jwt, password, otp, totp, turnstile), workspace scope, hosts, CSP, platform/registration,
│   │   └── mengantar/            # Partner & Public API clients, account dispatcher, scheduled tasks, live quotes/orders, key rotation, pickup
│   ├── modules/                  # contacts/, credentials/, members/, shipments/, labels/, invoices/, exports/, pricing/
│   └── proxy.ts                  # host → audience 404, session cookie rotation (Node runtime), private no-store responses, security headers
├── db/
│   ├── foundation/               # plain-PostgreSQL prerequisites (roles, auth and extensions schemas)
│   ├── migrations/               # schema, RLS, RPCs, signup gate, COD, Partner onboarding, demo cleanup, 2026-10-28 batch, auth core (2026-10-29)
│   ├── seed.sql                  # local synthetic fixtures only (refuses to run outside a gx-prefixed local database)
│   └── review-fixture.sql        # optional local review gerai
├── tests/                        # unit/, db/ (PostgREST/RPC), e2e/ (Playwright, 3 viewports)
├── scripts/                      # bundle scan, environment guard, docker wrappers, container smoke, ui smoke, dev env
├── docs/                         # canonical spec pack, research, promotion manifest
├── .delivery/                    # delivery-ledger runs (execution evidence)
└── AGENTS.md · STATUS.md · TASKS.md · DECISIONS.md · ARCHITECTURE.md · BUILD-LOG.md · RELEASE.md · OBSERVABILITY.md
```

## Selected direction

PostgreSQL 17 behind PostgREST for data (the app talks to it over HTTP with HS256 JWTs it signs itself; client `@supabase/postgrest-js`, query builder only) and an application-owned auth module for sign-in (ADR-0002, DEC-021; scrypt passwords, emailed codes, rotating refresh tokens, server-side sessions, TOTP for the Super Admin, Turnstile verified by the app); Next.js 16.4.3 App Router (exact pin, DEC-005) as a self-hosted Node.js container on a server with a fixed IPv4 address that is the Mengantar allow-list address (DEC-020; Cloudflare Turnstile is the CAPTCHA widget only). Where the production database runs (the same server or managed PostgreSQL) is the owner's decision. shadcn/ui with the supplied Apple-inspired palette. Customer/resi shipping uses
normal Mengantar tariff (plus two-pass `cod_fee_idr` for COD orders); private seller cost uses the verified activated discount. Sandbox Partner onboarding, live quotes/issuance, COD, registration and Super Admin are implemented and verified locally; production provisioning and live Mengantar egress remain gated (see [RELEASE.md](RELEASE.md) and [TASKS.md](TASKS.md)).
