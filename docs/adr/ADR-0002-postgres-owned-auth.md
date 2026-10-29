# ADR-0002: Plain PostgreSQL with PostgREST and an application-owned auth module (replaces Supabase)

- **Status:** Accepted (owner direction, 2026-10-29); mechanics implemented locally in T-064..T-066 (uncommitted), pending T-067 independent security review and PostgreSQL backup/PITR release gates.
- **Date:** 2026-10-29
- **Author:** Engineering (assistant), for Paduka Ongki
- **Deciders:** Paduka Ongki ("supabase ganti postgresql", scope answer: "Penuh: PostgreSQL + auth buatan sendiri di aplikasi"; existing data is synthetic and is not migrated)
- **Supersedes:** the Supabase part of DEC-001, ARCH-3's Auth service, DEC-009's Send Email Hook mechanism, DEC-010's wording about "the Supabase secret key". The recommendation recorded in BUILD-LOG 2026-10-29 (stay on Supabase) was overruled by the owner; this ADR executes the owner's call.
- **Evidence base:** `~/Documents/work/notes/geraiexpress-pg-migration/inventory-sql.md`, `inventory-app.md`, `inventory-tests.md` (read-only scout inventories, 2026-10-29).

## 1. Context (Observed)

The application uses Supabase for four things only: (1) the PostgreSQL database (33 migrations, RLS policies, `security definer` RPC functions), (2) PostgREST as the only data API (80 `.rpc(` call sites over 34 functions and `.from(` on 15 tables; zero storage, zero realtime), (3) GoTrue Auth (9 auth methods: `signInWithPassword`, `signInWithOtp`, `verifyOtp`, `signInAnonymously`, `signOut`, `getUser`, `getClaims`, `updateUser`, `mfa.*`), (4) the local CLI stack. SQL depends on Supabase through `auth.users` (17 foreign keys, columns `id, email, is_anonymous, email_confirmed_at, encrypted_password, created_at, deleted_at, email_change, phone, phone_change`), `auth.uid()`, `auth.jwt()` (only the claims `is_anonymous` and `aal`), `auth.mfa_factors`, two triggers on `auth.users` (`lock_anonymous_identity`, `discard_pre_verification_password`), one Auth hook function (`private.before_user_created`), the roles `anon`, `authenticated`, `service_role`, `supabase_auth_admin`, and the optional `pg_cron`. Session cookies are host-only, HttpOnly, 7 days for gerai and 12 hours for the Super Admin.

## 2. Decision

Run **PostgreSQL 17 (plain, official image or managed instance) + PostgREST (standard open-source service) + an auth module owned by the Next.js application**. No Supabase platform component remains: no GoTrue, no Supabase CLI, no Supabase Auth client and no `@supabase/supabase-js` or `@supabase/ssr`. The one package kept is `@supabase/postgrest-js`, used only as a stand-alone PostgREST query-builder client (an MIT library with no dependency on the Supabase platform); it keeps the 80 call sites unchanged, and it is replaceable by hand-written `fetch` calls at the cost of rewriting them (owner may veto the package name; the behavior does not change).

Why PostgREST stays: it keeps every migration, every RLS policy, every `security definer` function, all 80 RPC call sites and the contact-search filter strings valid, and it keeps the 351-test database suite meaningful. Replacing it would rewrite the data layer for no product gain. This is the one deliberate carry-over; it is plain PostgreSQL plus one stateless proxy that translates HTTP to SQL under the JWT's database role.

## 3. Architecture

```
browser --TLS--> Caddy --> app (Next.js: pages, actions, auth module) --HTTP+JWT--> PostgREST --> PostgreSQL
                                   |                                                              ^
                                   +--service JWT (machine RPCs: auth_*, dispatch_*)--------------+
```

### 3.1 Database roles and the JWT contract
- Roles (created by the foundation migration; the same names the SQL already uses): `anon`, `authenticated`, `service_role` (NOLOGIN, no BYPASSRLS except `service_role` keeps the table-level grants it has today), `authenticator` (LOGIN, `NOINHERIT`, used by PostgREST; may switch to the three roles), and a NOLOGIN role named `supabase_auth_admin` ONLY so existing grants in old migrations keep applying (legacy name; recorded as debt).
- PostgREST validates HS256 JWTs signed with `AUTH_JWT_SECRET` (min 32 bytes, from the environment of app and PostgREST only). Claims: `sub` (user uuid), `role` (`authenticated` | `anon` | `service_role`), `aud` = `authenticated`, `iat`, `exp`, `session_id`, `email`, `is_anonymous` (boolean), `aal` (`aal1` | `aal2`), `amr`. `auth.uid()` and `auth.jwt()` are re-created in the foundation migration with the same signatures reading `current_setting('request.jwt.claims', true)`.
- Three token kinds: user access JWT (TTL 10 minutes), a static `anon` JWT (no expiry issues: long TTL, role `anon`, can only call `registration_open`), a static `service_role` JWT for the machine identity (replaces `SUPABASE_SECRET_KEY`; server-only; rotation = change `AUTH_JWT_SECRET` and re-issue; stored in the environment, never the client bundle).
- PostgREST configuration: `db-schemas = public`, `db-anon-role = anon`, `db-max-rows = 1000` (same as `max_rows` today), `jwt-secret` from env, no `db-pre-request` needed. The PostgREST port is not published; only the app reaches it on the internal network.

### 3.2 Auth module (app-owned; all state in PostgreSQL)
Tables in schema `auth` (not exposed through PostgREST): `users` (the Supabase-compatible columns listed in section 1, plus `banned_until`, `last_sign_in_at`), `sessions` (`id`, `user_id`, `aal`, `refresh_hash`, `previous_refresh_hash`, `refresh_rotated_at`, `absolute_expires_at`, `idle_expires_at`, `revoked_at`, `created_at`, `user_agent_hash`), `otp_codes` (`email`, `purpose`, `code_hash`, `expires_at`, `attempts`, `consumed_at`), `mfa_factors` (`user_id`, `friendly_name`, `status` unverified|verified, `secret_sealed`, `last_used_step`, `created_at`, `verified_at`). Every auth operation is a `security definer` function in `public` executable by `service_role` only (machine RPC pattern already in the codebase, listed in `tests/db/privileges.test.ts` MACHINE_ONLY by full signature), with `search_path = ''`, never callable by `authenticated` or `anon`.

Cryptography (Node built-ins and Web Crypto only; no new dependency):
- **Passwords:** hashed in the app with `crypto.scrypt` (N=2^15, r=8, p=1, 16-byte salt, 64-byte key, constant-time compare), stored as `scrypt$N$r$p$salt$hash` in `auth.users.encrypted_password`; minimum length 10 (same as today); the password never reaches SQL text or logs as plaintext; a pre-verification password is discarded by the existing trigger on email confirmation (PR-29, SEC-5 behavior preserved).
- **OTP:** 6 digits from `crypto.randomInt`, stored as HMAC-SHA256 with a key derived from `AUTH_SECRET`; TTL 10 minutes; at most 5 wrong attempts per code, then the code is dead; one live code per (email, purpose); single use.
- **Refresh tokens:** 32 random bytes, stored only as SHA-256 hash; rotation on every refresh; the previous hash is accepted for a 10-second reuse interval only (parallel tabs), otherwise reuse revokes the session; sessions have an absolute expiry (7 days gerai, 12 hours Super Admin: the existing cookie bounds become server-enforced, not only cookie `maxAge`) and an idle expiry.
- **Access JWT:** HS256 signed with `AUTH_JWT_SECRET` through Web Crypto (works in the Edge middleware and Node), verified with constant-time comparison, `exp`, `aud` and `role` checks.
- **TOTP (Super Admin 2FA):** RFC 6238 (HMAC-SHA1, 6 digits, 30 s, window ±1) in the app; the secret is sealed with AES-256-GCM using a key derived (HKDF) from `AUTH_SECRET` with the user id as associated data; replay is blocked by `last_used_step`; a successful verification upgrades the session to `aal2` and mints a JWT with `aal = aal2`; the existing `private.platform_capable()` check of `auth.jwt() ->> 'aal'` stays, and T-054's TOTP recency becomes possible because `aal2` is a server-held session attribute with a timestamp.
- **Anonymous demo users:** `auth.users.is_anonymous = true`, no email, a session with `aal1`; the existing `lock_anonymous_identity` trigger keeps blocking demo-to-permanent conversion.
- **Signup gate:** the existing `private.before_user_created(event jsonb)` logic (registration open, or an unexpired invitation for that email) is called by the `auth_begin_signup` function before any user row or OTP exists; blocked requests answer the same Bahasa message as today.
- **CAPTCHA:** the app verifies the Cloudflare Turnstile token (`siteverify`, server-side, secret from env, fail closed) before sign-in, demo entry, OTP request AND OTP verification (closes the T-058 gap).
- **Rate limits:** the existing in-process limiters stay; the client address is the trusted proxy address directly (the `Sb-Forwarded-For` forwarding, `AUTH_FORWARD_CLIENT_IP` and the Supabase per-IP quota concern disappear). The per-account budget after CAPTCHA and the 503 refresh refusal keep their designed behavior.
- **Email:** the app renders the Bahasa OTP mail and sends it through the existing transport interface (Mailpit locally; production transport is T-063) directly; the Send Email Hook route, its Standard Webhooks signature check and `SEND_EMAIL_HOOK_SECRET` are removed. The anonymous-identity refusal moves into the OTP issue function (an anonymous user can never request mail).

### 3.3 Session cookies and middleware
Cookies `gx_at` (access JWT) and `gx_rt` (refresh token), host-only, `HttpOnly`, `SameSite=Lax`, `Secure` in production, path `/`, `maxAge` bounded by the same 7 days / 12 hours rule (the server-side session expiry is authoritative). The Edge middleware verifies `gx_at` locally on GET/HEAD and refreshes through `auth_refresh_session` when it expires within 60 seconds (rate-limited by `REFRESH_LIMITER`, 503 + `Retry-After` on local refusal, exactly as today); on POST it additionally checks the session row is live (`auth_session_live`, the equivalent of `getUser()` revocation checking). A failed refresh clears both cookies. Server components never write cookies (unchanged).

### 3.4 Data client
`src/lib/supabase/*` is replaced by `src/lib/db/*`: `userClient(accessToken)` (PostgREST client with the user's bearer), `machineClient()` (service JWT), `anonClient()`. The call sites keep the same builder API (`.rpc`, `.from(...).select/insert/update`), so only the factories and the identity lookups (`getUser` -> `currentUser()` reading verified claims plus `auth_session_live` where needed) change. Environment: `DATABASE_URL` is NOT used by the app (no direct SQL connection from Next.js); `POSTGREST_URL`, `AUTH_JWT_SECRET`, `AUTH_SECRET`, `SERVICE_ROLE_JWT` (or minted at boot from `AUTH_JWT_SECRET`), `TURNSTILE_SECRET_KEY`.

### 3.5 Migrations, seed, scheduler
- Foundation migration `20261001000000_pg_foundation.sql` runs BEFORE the existing 33 (earlier timestamp): extensions (`pgcrypto`), roles, `auth` schema objects, `auth.uid()`, `auth.jwt()`, default privileges (including `alter default privileges` revokes already assumed by T-035), the legacy role name. A migration runner (`scripts/db-migrate.sh`, `psql -v ON_ERROR_STOP=1 -1`, a `public`-invisible `private.schema_migrations` ledger, refuses to run a file whose checksum changed) replaces `supabase db reset/push`. The directory `supabase/` is renamed `db/` (migrations, `seed.sql`, `review-fixture.sql`); `seed.sql` fixtures use scrypt password hashes (the published fixture password stays local-only) and the demo-secret guard becomes a guard on the database name/host so the seed never runs against production.
- `pg_cron` is dropped as a dependency: the cleanup job is already guarded; hourly cleanup runs through the scheduler container's internal cron route (T-062). Postgres major version 17.
- Production database hosting is NOT chosen here (owner decision): either the same server (`db` service with a named volume) or a managed PostgreSQL. Backups: `scripts/db-backup.sh` (`pg_dump` custom format, encrypted at rest by the owner's storage) is provided; a restore drill and point-in-time recovery strategy (WAL archiving or the managed provider's PITR) are owner decisions and a RELEASE gate.

### 3.6 Tests
- DB tests keep their structure: `tests/db/helpers.ts` exports the same helper names; `client()`/`signIn()`/`machine()` use the new data client with JWTs minted by the test helper from `AUTH_JWT_SECRET` and live sessions created through the auth RPCs (so session tables are exercised); 22 files need only that. The four files that tested GoTrue behavior (`captcha`, `isolation` auth parts, `invitations`, `platform`) are rewritten against the new auth functions. New suites: auth core (password, OTP, refresh rotation and reuse, expiry, TOTP replay, anonymous lock, signup gate, rate/attempt limits) in `tests/db` and `tests/unit`.
- `tests/db/privileges.test.ts` keeps the catalog allowlists; the new `auth_*` functions are MACHINE_ONLY by full signature; the roles list is checked against the foundation migration.
- E2E keeps Mailpit for emailed codes; the hook relay and `auth-hook-relay.mjs` are deleted.

## 4. Security obligations for the build and its review (each must be demonstrated)
1. No user-callable path reaches `auth.*` tables or `auth_*` functions (revoked from `anon`/`authenticated`/PUBLIC; schema `auth` not exposed).
2. JWT: algorithm pinned to HS256 (reject `alg: none` and others), `aud`/`role`/`exp` checked, secret length enforced at boot, constant-time compare, clock-skew tolerance <= 30 s.
3. Refresh-token rotation with reuse detection; revoked/expired sessions fail closed on the next check; logout revokes server-side; a password change or deactivation revokes all sessions of the user.
4. Brute force: per-visitor and per-account budgets (existing design) plus per-code attempt limits; OTP and password errors are indistinguishable for unknown vs known emails (no account enumeration; timing equalized by hashing a dummy on unknown users).
5. TOTP secret never leaves the server in plaintext after enrollment display; replay protection; a verified-factor user cannot reach `aal2` without a code.
6. Machine key (`service_role` JWT) exists only in the app's server environment and the scheduler path; the client bundle check scans for it.
7. The anonymous demo user cannot become permanent, cannot request mail, cannot hold platform grants (existing invariants preserved by the same triggers and functions).
8. Session fixation: a new session id on every sign-in; cookies rotate on privilege change (`aal2`).
9. Open redirect and CSRF surfaces of the former hook/callback flows are gone; Server Actions Origin checks stay.
10. Logs never contain passwords, OTPs, tokens, TOTP secrets or JWTs.

## 5. Consequences
- **Good:** no third-party auth/service dependency to host or upgrade beyond PostgreSQL and PostgREST; full control of session policy (server-enforced 7 d / 12 h, TOTP recency, CAPTCHA on OTP verify); the SQL core stays; the hosting story is simply "Docker on one server".
- **Cost and risk (Observed/Inferred):** the app now owns a security-critical identity system (R4): password hashing, OTP, sessions, TOTP, token signing. Mitigated by narrow scope, built-in crypto primitives only, the obligations above, an independent security review, and a regression suite. PostgreSQL and PostgREST upgrades, backups and monitoring are the owner's operations. Self-service password recovery and social login are NOT included (PR-32 stays scheduled, now built on the same OTP primitive).
- **Debt:** the legacy role name `supabase_auth_admin` and the `auth` schema name are kept for compatibility with 33 existing migrations; a later cleanup migration may rename them.

## 6. Alternatives considered
- Keep Supabase (recommended earlier; overruled by the owner).
- Plain PostgreSQL with a hand-written data layer (rewrites 80 call sites and the query-filter strings; rejected for risk and cost).
- A third-party self-hosted identity server (Keycloak/Authentik/Ory): offered to the owner; not chosen.

## 7. Tasks and order
T-064 (foundation: roles, auth schema, migrations runner, dev stack, seed, DB test plumbing) -> T-065 (auth core: SQL functions, TypeScript module, DB and unit tests) -> T-066 (application cutover: data client, cookies, middleware, auth actions and pages, mail, scripts, e2e, removal of Supabase packages and files) -> T-067 (independent security review and fixes, documentation and release gates). Nothing is provisioned; no production data exists to migrate.

- Related: DEC-001, DEC-007, DEC-009, DEC-010, DEC-020, ADR-0001 (superseded), SEC-5, IAM-8, ARCH-3.

## 8. Implementation status note (2026-10-28)
T-064 to T-066 are implemented locally in the uncommitted working tree (`db/foundation/20261001000000_pg_foundation.sql`, `db/migrations/20261029100000_auth_core.sql`, `src/lib/auth/**`, `src/lib/db/**`, `src/proxy.ts`, `src/lib/auth-mail.ts`, `src/lib/mail-transport.ts`, `compose.yaml`, `compose.db.yaml`, `scripts/db-{common,migrate,up,down,verify}.sh`, `scripts/db-seed-totp.mjs`). Minor refinements from the initial proposal in section 3 above:
- `src/proxy.ts` (renamed from `src/middleware.ts`) runs on the Node.js runtime under Next.js 16 rather than the Edge runtime, sharing the in-process limiter tables and the auth service with Server Actions.
- The signup gate (`private.before_user_created`) runs inside `public.auth_issue_otp` (stage 1 of the code flow, `db/migrations/20261029100000_auth_core.sql:102-186`) before any user row or OTP row exists, rather than a separate `auth_begin_signup` function.
- `service_role` keeps `bypassrls` in `db/foundation/20261001000000_pg_foundation.sql:16` as it did on Supabase; `auth.*` table privileges remain revoked from `public`, `anon`, `authenticated`, and `service_role` (`db/foundation/20261001000000_pg_foundation.sql:83`, `db/migrations/20261029100000_auth_core.sql:42`), so access goes exclusively through the 14 `security definer` `public.auth_*` machine RPCs.
- Server-side TOTP QR SVG generation uses the MIT, dependency-free `qrcode-generator` package (`package.json:34`, `src/app/verifikasi-2fa/totp-qr.ts`).
- `scripts/db-backup.sh` and the restore drill / point-in-time recovery proof are not yet on disk; they remain open under T-067 together with the independent security review of the owned auth module.
