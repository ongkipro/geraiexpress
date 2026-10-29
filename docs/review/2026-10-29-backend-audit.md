# Backend, PostgreSQL and deployment audit — 2026-10-29

Task: T-068 (SEC-3, TEN-1, NFR-5). Implementation and verification are local; this report
is not a production certification. The owner authorized repairs to the existing dirty
working tree and selected Vultr + Coolify. No cloud resource, real credential, customer
record, provider operation or remote database was used by this audit.

## Architecture conclusion

Retain PostgreSQL 17 + PostgREST and the existing application auth. RLS, foreign keys,
constraints, transactional RPCs and the current test suite already implement the tenant
boundary. Replacing them with another database/ORM would introduce migration risk without
addressing a demonstrated defect. Start with one application instance and same-host
PostgreSQL under Coolify; encrypted off-host recovery is still a release gate (DEC-022).

Active source/configuration contains no Supabase platform client, auth hook or environment
binding. `@supabase/postgrest-js` is intentionally retained as the standalone HTTP query
builder. Historical migrations and inert compatibility roles remain reproducible; retired
role access is removed in a forward migration instead of rewriting checksummed history.
The legacy remote preview was not modified or assessed.

## Findings and repairs

| Finding / exposure | Repair and invariant | Verification |
| --- | --- | --- |
| Medium: two first-password submissions from the same verified session could both pass the application precheck and overwrite each other | `auth_initialize_password` locks the user and checks the password is still unset; kept session is locked by the setter. Only machine role can call it | `backend-audit.test.ts` races two different passwords; exactly one succeeds and only that password signs in; anonymous/missing-session calls fail |
| Medium: migration runners could race; a missing applied file was not rejected | Session advisory lock covers manifest validation, ledger and per-file transactions; all applied filenames/checksums must match the checkout | `migration-runner.test.ts`: parallel runners apply once, missing/changed history fails, failed SQL rolls back, subsequent valid migration succeeds |
| Local availability defect discovered by the concurrent test: role password provisioning could raise `tuple concurrently updated` after successful migration | Provision the local authenticator inside a maintenance-database transaction with a separate advisory lock; DATABASE_URL paths never alter its password | Same concurrency regression; maintenance database makes the cooperating lock common across target databases |
| Medium operational gap: `/healthz` returned success during data API/database outage | Bounded, uncached anonymous SQL RPC readiness check; return sanitized 503 on failures and accept both true/false valid gate values | Eight unit cases; production container 200 → stopped PostgREST 503 → restarted PostgREST 200 |
| Deployment mismatch: standalone Caddy ports/TLS conflict with Coolify's edge; careless forwarding can merge/spoof visitor rate-limit identities | Dedicated Compose entrypoint with internal gateway port 8080, no host app/data ports, exact trusted edge peer and right-to-left forwarded-IP parsing | Rendered Compose guard; real Caddy probes for trusted/untrusted peer, spoofed headers, hosts, encoded internal paths and body limit |
| Excess secret exposure: app inherited a full production env file including SQL login material | Explicit application environment allowlist; owner/SQL credentials stay outside app | Environment guard and runtime-file unit checks; local Compose overlay remains supported |
| Local command-execution risk: dotenv sourced as shell | Parse with Node `parseEnv`, reject unsupported multiline values, preserve explicit process targets; no shell evaluation | Literal command-substitution sentinel and target-precedence unit tests |
| Legacy privilege debt: retired hook role and API roles kept unnecessary grants | Forward migration revokes private hook role access and API-role public-sequence/default grants | SQL privilege/default-privilege tests and full tenant/RPC regressions |
| Verification defect: background SQL in four DB suites assumed the default database | Pass the actual `DB_NAME`; disposable PostgreSQL also declares its test database | Full suite and lock/concurrency probes against a randomly named isolated stack |

The independent reviewer traced auth service/actions, JWT/session handling, SQL locks and
ACLs, migration integrity, proxy trust and deployment configuration. No Critical/High was
confirmed in the inspected paths. This bounded review is not an exhaustive ASVS certification.

## Verification evidence

The final run/counts are recorded in STATUS.md and the T-068 BUILD-LOG entry. Repeatable commands:

```bash
node scripts/test-backend-isolated.mjs
node scripts/test-backend-isolated.mjs --upgrade tests/db/backend-audit.test.ts tests/db/auth-core.test.ts tests/db/privileges.test.ts tests/db/isolation.test.ts tests/db/migration-runner.test.ts
node scripts/test-coolify-proxy.mjs
pnpm check:environments
pnpm exec tsc --noEmit --incremental false
pnpm audit --prod --audit-level high
```

The isolated harness creates its own PostgreSQL/PostgREST containers, synthetic credentials
and network and removes those resources afterwards. `--upgrade` first applies the preceding
schema and seeds tenant/auth data, then applies the audit migration. `--browser` uses the
separately built `geraiexpress:audit-local` image and Mailpit on loopback port 18080:

```bash
node scripts/test-backend-isolated.mjs --browser tests/e2e/auth-demo.spec.ts tests/e2e/registration.spec.ts tests/e2e/auth-mail.spec.ts tests/e2e/platform.spec.ts tests/e2e/gerai-discount.spec.ts --project=mobile-390
# Repeat with --project=desktop-1280.
```

These flows include onboarding to an approved tenant, email verification, sign-in and
sign-out, forged/cross-tenant scope denial, rate limits, demo reset, TOTP enrolment,
suspension and platform access, and gerai discount checks. Browser tests use synthetic
CAPTCHA/test configuration, not a live Turnstile proof. The entire browser suite and tablet
viewport are outside this audit's targeted browser evidence.

Initial test failures were investigated rather than counted as passes: the disposable DB
initially used trust auth (changed to password auth), background probes assumed the wrong DB
(fixed), and concurrent local role provisioning failed (fixed). Browser harness initially
omitted the public CAPTCHA test site key (fixed). An experimental unit invocation supplied a
nonexistent server-only alias; it was discarded and the ordinary test configuration rerun.
Harness cleanup was repaired after an interrupted browser run; only its own leaked test
containers/networks were removed. None of these runs touched a shared database.

## Residual limits and release gates

- General password change/recovery is not currently exposed. Before enabling it, bind
  password verification and session creation to the same credential version: a login that
  verified an old hash must not open a session after a concurrent password replacement.
  The new initialization flow closes the reachable overwrite case, not that future contract.
- Migration source artifacts must remain immutable while running (manifest hash precedes
  streaming SQL). Use an immutable release checkout/image; do not edit deployed SQL in place.
- Single-instance in-process auth budgets are retained. A second application replica needs
  coordinated rate limiting and a fresh concurrency/release assessment.
- Real Coolify routing, its proxy peer address, Vultr firewall/egress, public DNS/TLS,
  production mail, live CAPTCHA and secret provisioning require deployment proof.
- Same-host PostgreSQL is not host-loss recovery. Encrypted off-host backups, restore drill,
  chosen RPO/RTO/PITR and backup alerting remain mandatory release evidence.
- Provider commercial terms, supervised sandbox/production operations and the remaining
  product tasks remain governed by TASKS.md and RELEASE.md. No unknown operation is replayed.

## Provenance and delivery boundary

The initial implementation run `RUN-20261028T200837Z-d5eb4b27` failed its boundary because
concurrent external edits changed `src/modules/shipments/pickup-status.ts` and
`src/app/(workspace)/pengiriman/[id]/page.tsx` (with companion
`tests/unit/shipments-handover.test.ts` changes). They were preserved and excluded from audit
attribution. The failed record is retained. Follow-up verification run
`RUN-20261028T202348Z-04a72f5c` owns fresh checks and final review; the reviewer also compares
the complete audit delta with the original pre-audit snapshot. No commit/push is performed.

Official references checked during the audit:

- [PostgreSQL 17 advisory locks](https://www.postgresql.org/docs/17/explicit-locking.html#ADVISORY-LOCKS)
- [Caddy trusted proxy and strict header parsing](https://caddyserver.com/docs/caddyfile/options)
- [Coolify Compose deployment, domains and repository preservation](https://coolify.io/docs/applications/builds/docker-compose)
