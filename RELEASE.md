# GeraiExpress — Release Record

Release-ID: preview-2026-10-27-c00e9c85
Base: f059a9a14d46813bf94ef3424073914fcc2d8b47
Environment: preview (HISTORICAL Cloudflare Worker + Supabase preview, withdrawn by DEC-020; production has never been deployed)
Declared-Risk: R4
Rollback-Ref: f9bc88ad-4f62-43ca-8b59-acfcb76deeb9 (the Worker version that preceded `c00e9c85` on `geraiexpress-preview`, 2026-10-18, code of T-024 + PERF-1 at git `d85fa92`, which exists locally as a commit; the Cloudflare version itself was not re-checked remotely in this audit)
Rollback-Command: env -u CLOUDFLARE_API_TOKEN -u CF_API_TOKEN pnpm exec wrangler rollback f9bc88ad-4f62-43ca-8b59-acfcb76deeb9 --env preview (HISTORICAL: Workers tooling and `scripts/deploy-preview.sh` are gone from the current tree; run it only from commit `f059a9a`, with the token-unset prefix that the old deploy script used so a stray API token cannot select another account. The current stack rolls back by image tag, see gate 5 below)
Backup-Proof: NOT_REQUIRED for this historical record: the preview held only isolated anonymous demo data (no real accounts, no Mengantar call, no Super Admin). The earlier reference `snapshot://supabase-geraiexpress-preview/jezxplwwmjogrmlixdcw-2026-10-27` does not resolve and is not a backup of anything the current code deploys. For the current stack no production or staging backup artifact exists yet: the local mechanism is proven (gates 12 and 13), the off-server target and RPO/RTO are owner input I3 (`docs/runbooks/staging-alpha.md` section 6)
Status: NOT_RELEASED (the metadata above describes the withdrawn preview. No Node container, staging host or production host is deployed; alpha staging is prepared locally only and waits for owner inputs I1 (Vultr plan, DNS), I2 (SMTP) and I3 (backup target, RPO/RTO). There is no current release candidate and no `.delivery/releases/` snapshot; production backup storage and PITR remain owner-gated: T-067)

## Preferred deployment: Vultr + Coolify (DEC-022, T-068)

Alpha staging (T-114): the ordered, placeholder-only execution checklist is `docs/runbooks/staging-alpha.md`; the
gates below remain the source of each step.

This is the current deployment direction. Nothing has been deployed by this audit. Use
`compose.coolify.yaml` as the Coolify Compose location; it is a flat, self-contained mirror of
`compose.yaml` (Coolify parses YAML without custom tags and does not resolve `extends`), and
`pnpm check:environments` fails if the two drift apart beyond the documented proxy and profile differences. Select an immutable `GX_IMAGE` built for the target `APP_ORIGIN`. Configure
all runtime values in Coolify; the app receives only its allowlisted variables, never
`DATABASE_URL`, `PGRST_DB_URI`, `POSTGRES_PASSWORD` or `AUTHENTICATOR_PASSWORD`.
Use managed Compose routing, not Raw Compose (this definition does not supply edge labels).
Enable **Preserve repository during deployment**: the gateway bind-mounts
`infra/proxy/Caddyfile.coolify`, which must remain a real file on the deployment host.

1. Configure the four public HTTPS domains **only on service `proxy`, internal port 8080**.
   Coolify owns TLS/public 80/443. Do not add host port mappings or public domains to app,
   PostgREST or PostgreSQL. Do not use the standalone `--profile prod` command below for this resource.
2. Inspect the actual Coolify edge address on the resource network, then set
   `COOLIFY_PROXY_CIDR` to that exact IPv4 `/32` or IPv6 `/128`. Re-verify after the edge
   is recreated. Never use `private_ranges`, a whole subnet or `0.0.0.0/0`. Caddy resolves
   forwarded addresses right-to-left; untrusted peers cannot choose a visitor's limiter key.
3. For the initial same-host PostgreSQL target, `compose.coolify.yaml` always starts `postgres`
   (it has no profiles, so `COMPOSE_PROFILES` is not needed); give `postgres_data` persistent storage, and set independent database passwords. Apply the
   schema as the `postgres` migration owner through the approved operator credential path;
   PostgREST must connect as `authenticator`. Never seed or reset production.
4. Validate both the rendered Compose model and proxy config before release:
   `pnpm check:environments staging=<protected-file> production=<protected-file>`.
   Templates use a documentation-only peer and prove structure only; the real files must
   contain the verified edge address. Local checks: `node scripts/test-coolify-proxy.mjs`
   and `node scripts/test-backend-isolated.mjs`.
5. `/healthz` must return 200 with the database available, 503 during an isolated data-path
   outage, and recover afterward. Its two-second probe checks SQL/schema readiness and (T-105)
   that the server configuration loads (PostgREST URL, auth secrets and CAPTCHA setting,
   tracking secret), not provider entitlements or production mail. Since T-109 it also answers
   503 `reason: "schema_behind"` while the database's newest migration is older than the image's
   `EXPECTED_SCHEMA_VERSION`: apply migrations first (a newer database is ready, so an image
   rollback after a forward migration stays healthy). The T-109 migration also sets per-role
   database timeouts (`authenticated` 15 s, `anon` 5 s, `service_role` 60 s statement; lock and
   idle-in-transaction limits; `authenticator` 65 s) and sends `notify pgrst, 'reload config'`; a
   PostgREST that missed the notify applies them after its next restart. Migrations and
   maintenance run as `postgres` and are not limited by them.
   A production container with a missing or invalid required variable now refuses to start
   (`startup_config_invalid` names the variables, never a value) and never becomes healthy:
   check `docker compose logs app` before suspecting the database. `compose.yaml` stops the
   app and the scheduler with a 300 s grace period (270 s cron deadline plus drain); a
   deployment restart can take up to five minutes while a scheduled run finishes. Record real public HTTPS, client-IP/forged-header,
   host-routing and login smoke evidence on the deployed host before calling it verified.
6. One app replica only. Coolify Compose does not provide a zero-downtime rollout guarantee;
   allow a maintenance window. Roll back by selecting the previous compatible image, without
   reversing data migrations. Preserve the PostgreSQL volume and verify off-host encrypted
   backup restoration before accepting production data. Backup location, schedule, retention,
   RPO/RTO and PITR/WAL policy remain explicit production gates.

The T-068 migration is additive for application data. The first-password RPC is machine-only;
old general password operations remain compatible. Historic migration checksums are unchanged.
The runner takes a database advisory lock across its full run, checks for missing/renamed/changed
applied migrations, and commits each new file with its ledger row. DDL waits at most 5 seconds
for ordinary locks and each statement at most 120 seconds; schedule a maintenance window for
larger changes rather than silently raising limits.

Official references: [Coolify Compose](https://coolify.io/docs/applications/builds/docker-compose),
[Coolify networking](https://coolify.io/docs/core/networking-in-coolify),
[Caddy forwarded-client trust](https://caddyserver.com/docs/caddyfile/options#trusted-proxies).

## Standalone container alternative and shared release gates (T-062, DEC-020)

The application ships as ONE Docker image (`Dockerfile`: Next.js standalone, Node 24 pinned by digest,
non-root, `HEALTHCHECK` on `/healthz`) run by `compose.yaml` as `app`, `scheduler` and `proxy` (Caddy,
TLS, the four hosts of DEC-015) on a server the owner controls and provisions; nothing is provisioned or
deployed by this record. The server's **fixed IPv4 address is the Mengantar Partner API allow-list
address**: production Partner calls leave directly from the container host, so register that address
with Mengantar before the first production order. The data store is PostgreSQL 17 behind PostgREST (compose
service `postgrest`, internal only) with an application-owned auth module (ADR-0002, DEC-021); Supabase and its
CLI are not used by the code. Where PostgreSQL runs (the optional `postgres` service of `compose.yaml` on the same
server) is the initial DEC-022 target; a managed PostgreSQL alternative requires a recorded decision. Cloudflare Turnstile stays the CAPTCHA, verified
by the app. Gates before a release is started:

1. **Image digest.** Build with the environment's own `APP_ORIGIN`
   (`docker build --build-arg APP_ORIGIN=https://app.geraiexpress.com -t geraiexpress:<tag> .`; the static
   marketing links bake it, so an image belongs to one environment). The build runs the browser-bundle
   scan. Record the tag AND the digest (`docker image inspect --format '{{.Id}}' geraiexpress:<tag>`,
   or the registry digest after a push) in this record; start containers from the tag recorded here,
   never from a moving tag. Base images (`node:24.x-bookworm-slim`, `caddy:2.x-alpine`) are pinned by
   tag and digest in `Dockerfile` and `compose.yaml`; bump tag and digest together.
2. **`docker compose config`.** `GX_ENV_FILE=<env file> docker compose --env-file <env file> -f compose.yaml --profile prod config`
   must render without error and show: the app publishes no port, only the proxy publishes 80 and 443
   explicitly on **0.0.0.0 (IPv4 only)**, `postgrest` publishes no port and the app's `POSTGREST_URL` names it
   (or the managed endpoint you chose), the app has `TRUSTED_PROXY=1`, the scheduler holds `CRON_SECRET`
   only, images are pinned, the production proxy mounts `infra/proxy/Caddyfile` (never the local file),
   every root filesystem is read-only and every service uses bounded `local` logging (10 MB × 3).
3. **Secrets via an env file, mode 0600, outside the repository** (for example
   `/etc/geraiexpress/production.env`, owner-readable only; templates: `infra/env/*.env.example`, names
   and public values only). Start with
   `GX_ENV_FILE=/etc/geraiexpress/production.env docker compose --env-file /etc/geraiexpress/production.env --profile prod up -d`.
   Never bake a secret into an image or commit one; `.dockerignore` is an allow-list and
   `pnpm check:bundle` refuses a baked secret value. `GX_ENV_FILE` is REQUIRED (no production fallback
   to `.env.container`). The env file carries `AUTH_JWT_SECRET` (also PostgREST's JWT secret) and
   `AUTH_SECRET` (at least 32 bytes each, different),
   `TRACKING_TOKEN_SECRET` (independent random 32+ byte HMAC root; rotation changes re-derived links, so revoke/re-share deliberately), `PGRST_DB_URI` (the `authenticator` connection string,
   read by Compose for PostgREST), `POSTGRES_PASSWORD` only with the `db` profile, the Turnstile pair, `CRON_SECRET`
   (at least 32 characters) and the Mengantar and credential values; every configured secret must also be at
   least 32 characters and not a placeholder. Blank example values
   are placeholders only; the real env file is checked at release.
4. **`pnpm check:environments staging=<staging env file> production=<production env file>`** passes:
   no secret value shared between environments (each has its own database, JWT, auth, Turnstile, credential
   and cron secrets), Turnstile never disabled (`AUTH_CAPTCHA_DISABLED=true` is refused outside local), no
   production value in staging (hosts, provider environment, shared secrets), no
   `HOST_SHARED_MODE`/Mailpit/local address outside local, the compose model above (including PostgREST's
   `public` schema, `anon` role, `authenticated` audience and 1000-row cap), and the proxy configuration
   (`X-Real-IP` overwritten with the peer, `/api/internal` denied). Without arguments it checks the committed
   templates. Record the passing run; do not bypass it.
5. **Rollback = the previous image tag.** Keep the previous image on the host; roll back with
   `GX_IMAGE=geraiexpress:<previous-tag> GX_ENV_FILE=<env file> docker compose --env-file <env file> --profile prod up -d`
   (app and scheduler restart, the proxy keeps its certificates in the `caddy_data` volume). A
   rollback never runs migrations backwards: check that the previous image works with the current
   schema, or restore from a database backup taken before release (local drill gate 13 is not production
   recovery proof; production storage/PITR remain owner-gated). Unknown provider outcomes
   reconcile their original operation after a restart; they are never replayed.
6. **Single instance.** The in-process rate limiter (`src/lib/limiter.ts`) and the in-process cron
   lock are correct for ONE app container. Do not run a second replica until a shared limiter store
   exists; a rolling restart briefly forgets all rate-limit windows.
7. **Proxy trust.** `TRUSTED_PROXY=1` is safe only because the app port is not published and the
   proxy overwrites `X-Real-IP`. If a CDN or another proxy is ever put in front of Caddy, configure
   Caddy `trusted_proxies` and revisit `infra/proxy/Caddyfile` first; until then the proxy is the edge.
8. **IPv4-only ingress: NO AAAA records** for apex, `app.`, `owner.` or `hooks.`. Docker's IPv6-to-IPv4
   userland proxy can replace every IPv6 visitor's address with the bridge gateway, merging their
   abuse budgets. Only A records may point to this deployment until native IPv6 is enabled end to end
   and separately verified. Do not "fix" this by rejecting private addresses in the app: it cannot
   restore the lost source and would reject legitimate local/LAN users. `check:environments` refuses
   unspecified or IPv6 proxy port binds.
9. **Request and abuse boundaries.** Both Caddy profiles cap request bodies at 1 MB. The official Caddy image
   has no request-rate limiter module; there is no network DDoS/WAF/bot protection from Cloudflare. Provision
   appropriate upstream protection before exposed traffic demands it, without trusting a forwarded header from
   an unknown peer. Per-visitor limits are the app's own in-process limiters keyed by the trusted proxy's
   `X-Real-IP` (gate 6, 7); there is no external Auth service whose per-IP limits need sizing.
10. **Retire the old remote preview (owner action).** The old preview deployment (a Cloudflare Worker with its
    Supabase project `geraiexpress-preview`) still exists remotely; removing its source and tooling here did NOT
    delete it. The owner must delete/disable that Worker and its preview URLs/routes, delete or pause that
    Supabase project, revoke its bindings, rotate the old preview's `CREDENTIAL_KEY` and
    `SEND_EMAIL_HOOK_SECRET` (including the Supabase hook setting), and review any other secret ever given to
    it. Rewrap retained credential ciphertext before retiring an encryption key. Nothing remote was changed here.
11. **Database provisioning (owner-gated).** Apply `DATABASE_URL` from a protected operator environment with
    `scripts/db-migrate.sh` (never `--reset`, never seed production). Foundation creates roles; runner verifies
    applied checksums before applying new files. After applying, run `notify pgrst, 'reload schema';` (or restart
    PostgREST) and call one RPC added by the release: a migration that forgot its own notify (for example
    `20261104100000_customer_data_review.sql`; the later T-094 migration notifies for both) must not leave the
    running Data API on an old schema cache. Local runner provisions `authenticator` from generated
    `AUTHENTICATOR_PASSWORD`; remote runner deliberately does not set it. On the remote server, connect as
    database administrator with `psql` using libpq environment, run `\password authenticator` interactively
    (no password in SQL history or argv), then put the same strong, URI-encoded password in `PGRST_DB_URI`.
    Restart PostgREST after password changes. Never use the database superuser as PostgREST's login.
    `pg_dump --globals-only` is NOT used: roles are re-provisioned by `db/foundation` and passwords by the runner
    locally or this remote owner procedure; backups contain database objects/data, not cluster credentials.
    First production Super Admin grant and TOTP enrollment require owner action; no production seed.
    Apply all pending migrations in order, including `20261104120000_counter_payments.sql`,
    `20261104130000_gerai_logos.sql` and `20261105100000_mengantar_area_catalogue.sql`, plus the
    forthcoming `20261105110000_review_hardening.sql` once integrated. The hardening migration adds
    `pg_trgm` and a trigram index on `mengantar_areas.search`; it requires the `pg_trgm` contrib
    module, present in the official `postgres:17` image. After schema reload, obtain explicit owner
    approval before loading the catalogue into any retained or production database. Using the protected
    operator `DATABASE_URL` and owner/migration role, run `npm run db:areas`. This load is separate
    from migrations and seed execution. Record the dataset version and counts, verify a known member
    search, and verify an identical second load reports `validated=79391 changed=0 unchanged=79391`
    for the bundled 2026-10-30 dataset. Do not harvest or refresh provider data without separate approval.
    Local-only T-099 prerequisite: `compose.db.yaml` now runs PostgreSQL with `init: true`. Recreate
    an existing local gxdb PostgreSQL container with `docker compose -f compose.db.yaml up -d postgres`
    (keep the volume) before running `tests/db/batch-payment-fixes` against it.
12. **Backup policy (owner-gated; local mechanism proven).** Schedule `pnpm db:backup` at least daily and before
    migrations, with `BACKUP_DIR` pointing at an existing private directory. Archive uses `pg_dump -Fc`, mode
    0600, exclusive creation (no overwrite); optional first argument selects an exact file. Default target is
    `gxdb-postgres-1`; remote target is exported `DATABASE_URL`, parsed by `db-common.sh` into libpq environment
    (password never argv; install PostgreSQL 17 client tools). Treat archives as credentials: they contain
    password hashes, sealed MFA/credential material, identities and session hashes. Owner chooses off-server
    storage, retention, encryption-at-rest/key custody and encrypted transport; copy every successful archive
    off-server, monitor missed backups/copy failures, test decryption and restore from that off-server copy.
    No production schedule/storage/encryption has been provisioned. RPO: **OWNER-DECIDED: [pending]**.
    RTO: **OWNER-DECIDED: [pending]**. Record backup age, restore wall time and owner acceptance before release.
13. **Restore drill (local evidence; owner-gated on actual deployment/off-server archive).** Stop source writers
    during dump/comparison or expect row-count drift; source data is never modified by these scripts. Run
    `pnpm db:restore-check <archive> <scratch>` on the same server with CREATE DATABASE privilege. Scratch must
    match `^gxrestore[a-z0-9_]*$` (at most 63 characters), differ from source and not already exist; restore uses
    one transaction, compares every table in `public`, `private`, `auth` and migration checksum ledger, queries
    `auth.users`, then drops only the database it created even on failure. Existing scratch names are refused.
    Production restore to another server first requires foundation roles and authenticator password provisioning
    from gate 11. No role/global dump is used. Exact local commands executed:

    ```bash
    pnpm db:backup /tmp/gx-ops-20261028.dump
    pnpm db:restore-check /tmp/gx-ops-20261028.dump gxrestore_ops20261028
    ```

    Local result: 560835 bytes, dump 1 s, restore 2 s, restore/check 3 s (combined command wall time 6.73 s).
    Comparison output: `Row counts: MATCH (31 tables)`, `Migration checksums: MATCH (36 migrations)`;
    `select count(*) from auth.users` returned 59.

    Re-run 2026-10-29 after the final script edits (`.partial` backup rename, `pg_restore -d`) and
    migrations through `20261029170000`, against the local gxdb (docker mode; the `DATABASE_URL` mode is
    still unexecuted without a remote database): 900082 bytes, dump 1 s, restore 3 s, restore/check 3 s,
    `Row counts: MATCH (32 tables)` (now including `auth.retired_refresh_tokens`),
    `Migration checksums: MATCH (42 migrations)`, `auth.users` 230, no `.partial` file left.
    Per-table counts of the first run:

    ```text
    auth.mfa_factors|2                  auth.otp_codes|9
    auth.sessions|129                   auth.users|59
    private.batch_payment_attempts|0    private.batch_payment_authorizations|0
    private.invoice_counters|1          private.quote_costs|111
    private.reference_counters|41       private.schema_migrations|36
    private.seller_credentials|2        private.settings|2
    private.tenant_mengantar_onboarding|0
    public.audit_events|38              public.contact_addresses|208
    public.contacts|169                 public.gerai_discount_terms|0
    public.invoice_snapshots|0          public.label_jobs|3
    public.label_print_events|0         public.label_snapshots|0
    public.memberships|49               public.outlets|45
    public.platform_grants|3            public.provider_operations|87
    public.shipment_events|240          public.shipment_quotes|111
    public.shipments|139                public.tenant_applications|1
    public.tenant_invitations|2         public.tenants|45
    ```

    **Restoring a database that served live Mengantar traffic (T-110, DR-1).** A restore rolls local rows
    back, not Mengantar: an order, batch payment, seller registration or key rotation sent after the backup
    point is missing locally, and its create operation may look `queued` again. Never resend blindly (TD-3):

    1. **Fence.** A restore into a new cluster or database, an in-place `pg_restore --clean`, PITR, a promoted
       replica or a `pg_upgrade` (new system identifier) changes the recorded cluster identity
       (`system_identifier:database oid:fence table oid:timeline`, `private.provider_cluster_identity()`), so the
       provider mutation fence is engaged with no step; after a planned `pg_upgrade` without a restore, review and
       clear it the same way. **A physical restore keeps the identity too** (a Vultr/VM or volume snapshot, a
       data-directory copy, or a base backup started without recovery: same system identifier, database and table
       oids, timeline), so the fence stays OPEN by itself; treat it exactly like a data-only restore and engage the
       fence explicitly before the app starts (second-opinion review 2026-11-06, `.delivery/reviews/2026-11-06-fable-t110.md`).
       When in doubt, always engage: an unnecessary engagement only pauses mutations until a reviewed clear.
       A data-only restore into the existing tables keeps that identity: as the postgres
       owner, immediately after `pg_restore` and before the app starts, run
       `select private.engage_provider_fence('Pemulihan dari cadangan <tanggal>: <tiket>');`. A backup taken
       before migration `20261105200000` has no fence: run `scripts/db-migrate.sh` (gate 17 ledger check) on the
       restored database FIRST, then `engage_provider_fence`, still before the app starts (the migration records
       the restored cluster's own identity, so the fence would otherwise start open). While engaged,
       `dispatch_claim`, the pickup write-aheads, `authorize_batch_payment`, `dispatch_mark_batch_payment_sent`,
       `fence_partner_key_rotation` and every mutating Partner request refuse with SQLSTATE 55000
       `provider_fence_engaged`; reconciliation, payment checks and reads keep running.
    2. **Reconcile.** Let the 5-minute sweep (or "Cek hasil" per shipment) resolve `in_flight`/`unknown`
       operations and unresolved batch payments by reference reads; check Partner onboarding/rotation states
       (`registered_key_pending`, `rotation_unknown`) through their recovery paths, which read the current key
       and never register or regenerate again. Re-establish credential versions and authorization (gates 11
       and 15) before going on.
    3. **Review.** As a Super Admin with `integration_operations` (aal2), read `platform_provider_fence()`:
       `queued_real_operations`, `unresolved_real_operations`, `unresolved_batch_payments`. The queued count is
       what the clear will mark.
    4. **Clear.** `platform_clear_provider_fence(reason, expected_queued)` (reason at least 5 characters; the
       reviewed queued count, else `stale_state`) re-records the live identity, marks every real queued create
       operation `restore_check_required` in the same transaction, writes `provider_fence.cleared` to the audit
       log and returns the marked count. There is no UI yet (follow-up); call it with the Super Admin session.
    5. **Dispatcher checks.** Each marked operation is looked up at Mengantar by its reference (orders since the
       operation was created) before any create: exactly one live order is recorded as issued/unpaid (no
       create); several, or only provider error items, are recorded `unknown` for reconciliation/manual review;
       none clears the flag and the order is created once (or failed `QUOTE_STALE`, reopenable, past the six-hour
       quote window). A failed lookup, the Partner quota or a re-engaged fence leaves it queued with the flag
       (`restore_check_pending`). `dispatch_sweep.stuck` and the shipment pages show what remains. The flag stays
       on an operation recorded as found or unknown, so its later reconciliation scans Mengantar from the
       operation's creation, not only from the post-restore attempt.
    6. **Operator exit for a check that never completes** (the lookup keeps failing: Mengantar unreachable for the
       seller, a key that no longer opens, more orders since the operation than the scan bound): a Super Admin
       with `integration_operations` (aal2) calls `platform_mark_restore_check_unknown(operation, env, reason)`.
       It moves only a queued, flagged operation to `unknown` (`RESTORE_CHECK_MANUAL`, audited as
       `provider_fence.restore_check_manual`, returns the shipment reference) and sends nothing. From there the
       ordinary path applies: the gerai admin checks the Mengantar app by that reference; "Cek hasil"/the sweep
       records a found order; only a reconciliation that concludes "not created" lets the admin close
       (`close_failed_operation`) and reopen the shipment for a new order. No UI yet (follow-up).

    Residual gap, stated plainly: a shipment confirmed AND sent after the backup point does not exist in the
    restored database at all, so neither the fence nor the restore check can see it; its order exists only at
    Mengantar. Gerai staff must not re-enter such a shipment until its reference has been checked in the
    Mengantar app (the same customer can otherwise get a second order). Operations sent after the backup point but
    restored as `queued` are covered by step 5; operations restored as `in_flight`/`unknown` by step 2.

    Not covered locally: a restore drill against the live provider (the DB tests simulate a restore by changing
    the recorded identity, `tests/db/partner-quota-restore-fence.test.ts`).

14. **PITR (OWNER decision; unprovisioned).** Self-hosted WAL archiving plus base backups permits point-in-time
    recovery but needs durable off-server WAL storage, retention, monitoring and rehearsed recovery operations.
    Managed-provider PITR delegates those operations at recurring cost/vendor dependence; verify its retention,
    restore granularity and actual restore time. Logical daily dumps alone cannot meet sub-backup-interval RPO.
15. **Auth secret custody and rotation (owner-gated; helper proven locally).** Keep independent random
    `AUTH_JWT_SECRET` and `AUTH_SECRET` (minimum 32 bytes) per environment in 0600 external env files and an
    encrypted recovery store; never log them, put them in argv, image/build args, client bundles or archives
    without encryption. `dev-env.sh` generates/reuses local values only; do not run it for production rotation.
    `AUTH_JWT_SECRET` signs all access and static anon/service JWTs (`src/lib/auth/instance.ts`, `jwt.ts`).
    Rotation invalidates every access token and every old static role JWT. Enter maintenance, stop app/scheduler
    writers, replace value in app and PostgREST configuration with the SAME value, restart/recreate both plus
    scheduler, and reissue any external static anon/service JWTs. App regenerates its memoized role JWTs on
    restart. Refresh tokens remain stored independently: rotation alone is not logout-all; for compromise,
    revoke affected/all sessions explicitly under incident approval before reopening traffic. Verify old JWT
    refused, new machine RPC and user sign-in work, then retire old signing secret.

    **Do not replace `AUTH_SECRET` without resealing first: every sealed TOTP secret becomes unreadable.**
    OTP HMAC keys also derive from it (`otp.ts`); pending codes become invalid. There is no runtime key ring.
    Safe maintenance procedure (recorded operator change, never shell tracing):
    1. Stop app and scheduler writers; take encrypted backup and retain old env/key securely. Prove restore
       first. Load old/new keys from protected secret files into `OLD_AUTH_SECRET` / `NEW_AUTH_SECRET`, and
       export operator `DATABASE_URL` (or use local container default). No literal secrets in command history.
    2. Run `node scripts/reseal-totp.mjs`. Helper decrypts every factor using old key/user-associated data,
       generates application-compatible seals, locks factor table, checks unchanged set/old seals and commits
       all updates in ONE transaction. Wrong key, changed rows or SQL failure aborts without partial rotation.
       Quiescence is required across its initial read and commit. Do not resume old-key writers after success.
    3. Atomically replace runtime `AUTH_SECRET` with new key; restart all app processes/scheduler before allowing
       requests. Ask users with pending OTP codes to request new codes. Test fresh OTP and existing-admin TOTP.
       If restart fails, keep maintenance; reverse helper with keys swapped while rows use new key, then restore
       old runtime key. Never revert env alone after successful reseal. Retain old key for encrypted historical
       backups until their retention expires; unset operator key variables after success.

    Exact copy-only local rotation proof executed (no source writes; scratch dropped by trap):

    ```bash
    bash -c 'set -euo pipefail; source scripts/db-common.sh; scratch=gxrestore_reseal20261028; GX_PSQL_DB=postgres gx_psql -q -c "CREATE DATABASE $scratch TEMPLATE template0"; trap '\''GX_PSQL_DB=postgres gx_psql -q -c "DROP DATABASE $scratch"'\'' EXIT; docker exec -i "$GX_DB_CONTAINER" pg_restore -U postgres -d "$scratch" --exit-on-error --single-transaction < /tmp/gx-ops-20261028.dump; export GX_PSQL_DB="$scratch" OLD_AUTH_SECRET="$AUTH_SECRET" NEW_AUTH_SECRET; NEW_AUTH_SECRET="$(openssl rand -hex 32)"; node scripts/reseal-totp.mjs; OLD_AUTH_SECRET="$NEW_AUTH_SECRET" NEW_AUTH_SECRET="$AUTH_SECRET" node scripts/reseal-totp.mjs; gx_psql -c "select count(*) from auth.mfa_factors where secret_sealed like '\''v1.%'\'';"'
    ```

    Output twice: `TOTP factors re-sealed: 2 (one transaction)`; final sealed-factor count 2; wall time 4.24 s.
    Unit compatibility tests open application seals and open resealed output through `src/lib/auth/totp.ts`.
16. **PostgREST exposure (owner-gated on deployment).** Gate 2 forbids published PostgREST ports; firewall must
    also exclude its listener. Rendered config must expose only `PGRST_DB_SCHEMAS=public`, anon role `anon`,
    audience `authenticated`; never expose `auth` or `private`. Run these read-only catalog queries via operator
    `psql`/`gx_psql` and retain output (schema query: `auth` only for claim functions; table query: zero rows;
    function query: `public.registration_open()`, `auth.uid()`, `auth.jwt()` only):

    ```sql
    SELECT nspname FROM pg_namespace WHERE nspname IN ('auth','private')
      AND has_schema_privilege('anon',oid,'USAGE');
    SELECT n.nspname,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname IN ('public','private','auth') AND c.relkind IN ('r','p','v','m','f')
      AND has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER');
    SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname IN ('public','private','auth') AND has_function_privilege('anon',p.oid,'EXECUTE')
      ORDER BY 1;
    SELECT rolname,rolcanlogin,rolinherit,rolsuper,rolbypassrls FROM pg_roles
      WHERE rolname IN ('authenticator','anon','authenticated','service_role');
    ```

    Confirm `authenticator` LOGIN/NOINHERIT/non-superuser/non-BYPASSRLS, API roles NOLOGIN; `service_role`
    alone intentionally BYPASSRLS. Catalog privilege checks do not replace network/schema-config checks.
17. **Migration ledger verification (owner-gated on deployment).** Before migration, compare every applied
    filename/SHA-256 to checkout without applying anything (zero diff required; run from repository root):

    ```bash
    bash -c 'set -euo pipefail; source scripts/db-common.sh; diff -u <(for f in db/foundation/*.sql db/migrations/*.sql; do sha256sum "$f"; done | while read -r sum file; do printf "%s|%s\n" "${file##*/}" "$sum"; done | sort) <(gx_psql -At -c "SELECT filename,sha256 FROM private.schema_migrations ORDER BY filename" | sort)'
    ```

    A pending migration appears in this full comparison: account for it explicitly before approval; after
    migration zero diff is mandatory. Never change applied SQL to force a match. Restore drill also compares
    source/restored version/SHA-256 ledgers. Database credentials remain in libpq environment, not argv.

Owner decisions still open before a first deployment: the server provider/region and its fixed IPv4
address, where the production database runs (same server or managed PostgreSQL) with its backup and
point-in-time-recovery plan (T-067), DNS for the four hosts (apex, `app.`, `owner.`, `hooks.`), the ACME contact email, the
production mail provider and sending domain (T-063; production mail fails closed until then), and
Mengantar's acceptance of the egress address.

## Historical Worker preview (withdrawn by DEC-020; kept as the record of what was deployed)

Everything in this section describes the OLD deployment (a Cloudflare Worker with a hosted Supabase project)
and its past state. It does not describe how the current code works: the code no longer contains Workers
tooling, Supabase, GoTrue, the Send Email Hook or the Supabase CLI steps mentioned below, and nothing here can
deploy or reach that preview.

| Component | Value |
|---|---|
| Worker | `geraiexpress-preview` → https://geraiexpress-preview.ongki.workers.dev. Active version `c00e9c85-5cb6-47c8-946d-54fd60ca410a` (2026-10-27, T-025..T-030, placement `aws:ap-southeast-1`); previous versions `f9bc88ad-4f62-43ca-8b59-acfcb76deeb9` (2026-10-18, T-024 + PERF-1) and `dddc2184` (T-018) |
| Supabase | project `geraiexpress-preview`, ref `jezxplwwmjogrmlixdcw`, region ap-southeast-1, Postgres 17; 15/16 migrations applied with `db push` (up to `20261027220000_contact_archive_and_demo_cleanup.sql`, including `cleanup_expired_demos` and `archive_contact`; `20261027230000_production_readiness_polish.sql` verified locally, no seed) |
| Auth settings | `infra/supabase-preview/supabase/config.toml` (since removed from the repository), applied with `supabase config push --workdir infra/supabase-preview` (never the local config) |
| Worker secrets | `CREDENTIAL_KEY`, `SEND_EMAIL_HOOK_SECRET` (values only in the owner's local secrets store and Cloudflare/Supabase) |
| Security headers | Deployed on non-static responses: `X-Frame-Options: DENY`, `Content-Security-Policy: frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, and HTTPS `Strict-Transport-Security: max-age=31536000; includeSubDomains` |

What works: public marketing pages (`/`, `/fitur`, `/simulasi`, `/cara-kerja`, `/hubungi-kami`), isolated anonymous demo (contacts, simulated quote/issuance, sample
label, reset), closed registration, platform/member pages closed to visitors.
Deliberately not enabled: Auth email (no `MAIL_TRANSPORT`; the hook fails closed, so no codes),
Auth CAPTCHA (no real Turnstile widget yet; the app uses Cloudflare's test site key), any
Mengantar call, real accounts, Super Admin (no platform grant exists on the preview).

Known residuals on the old preview (tracked under TASKS "Preview hardening"):
- With CAPTCHA off, anyone with the publishable key can call Supabase directly
  (anonymous sign-in + `start_demo`), bypassing the Worker's `DEMO_LIMITER`; only Supabase's
  300 anonymous sign-ins/hour/IP applies. `cleanup_expired_demos` is deployed in the database and is wired to the Worker's aligned-hour tick of the `*/5 * * * *` cron in `custom-worker.ts` (needs only `SUPABASE_URL` and the secret key) and, once migration `20261028180000` is applied, to the pg_cron job `demo-cleanup`; `env.preview` keeps crons and `SUPABASE_SECRET_KEY` off until staging/production enablement, so nothing cleans the preview until that migration is applied there.
- Auth's email rate limit appeared lower than the declared `email_sent = 30` in probes; re-check
  when the mail transport is enabled.

Evidence: `pnpm smoke:preview` 6 passed (390 and 1280); HTTP checks (`/healthz` 200, protected
routes redirect, security headers present, unsigned hook 401); remote `db lint` clean; direct Auth API probes: public
signUp/OTP refused, anonymous sign-in allowed, anonymous email change refused by the Worker hook,
platform RPC refused. Details in `.delivery` (T-018, T-025..T-030) and BUILD-LOG.md.

Historical only: the preview was built and deployed on owner authorization. Those deploy scripts and
the Workers toolchain are removed; do not redeploy it. Its remote deletion and secret rotation remain
the owner's explicit action (gate 10 above). Schema changes remain separately approved.

The preview runs T-001..T-030 and PERF-1 (2026-10-27). The local 2026-10-28 work through waves
E/F is not deployed there; migrations through `20261028260000_pickup_known_time_ids.sql`
are not applied to that project. Live Mengantar stays off there (no machine identity/provider
environment; preview crons are empty). Local completion is not release readiness.

## Local release-gate state (2026-11-06)

`production-gate` on `feat/counter-ops-2026-11` is expected to stay BLOCKED until a real release exists:
- `release_manifest` INVALID (Status is NOT_RELEASED) and `rollback` BLOCKED (Backup-Proof is the historical Supabase
  snapshot): both turn only with a deployed server, a real backup artifact and a rollback target that exists. They
  are not edited to pass.
- `security` FAIL is a known limitation of the shared `security-check` scanner, which has no per-repository allowlist:
  its 42 hits were reviewed one by one on 2026-11-06 and are synthetic test fixtures (named test/fixture values, the
  RFC 6238 Base32 test vector, the documented local fixture password `geraiexpress-local-dev`) or plain code that
  compares or copies variables (`AUTH_JWT_SECRET === AUTH_SECRET`, `PGPASSWORD = decodeURIComponent(...)`). No real
  credential. Separately, every revision of the repository (236 commits, all branches) was scanned for committed
  sensitive files and high-signal secret patterns, with a planted-fake control (2/2 caught): nothing found.
- `independent_review` reads the STATUS header (reviewer and reviewed head of the current milestone).

## Production gates for live Mengantar (integration audit, 2026-10-14)

Not provisioned. Before a real gerai issues orders in production:

0a. **Status webhook (T-045).** Publish DNS + TLS for `hooks.geraiexpress.com` and set `HOOKS_ORIGIN`.
   Per gerai, the admin copies the Webhook URL from /pengaturan into Mengantar (Settings → Account →
   Integrasi Public API; production webhooks are enabled per account by Mengantar) and pastes the Webhook
   Secret back. Before relying on it, capture one sandbox `POST /order/simulation` delivery against the
   hooks host and compare it with the fixtures (T-048). Without a webhook, statuses come only from the
   status pull, which gives no freshness guarantee: a shipment becomes eligible only after more than 2 hours
   without a provider update AND more than 2 hours since its last pull (`STATUS_PULL_STALE`, strict cutoffs in
   `machine_status_pull_candidates`), and the pull runs only in the hourly `cleanup` task (scheduler minute 0
   UTC). An update at 10:00:01 is therefore first eligible at 13:00:00 (about 3 hours), and later still when
   the queue exceeds the per-run cap (200, least recently pulled first) or the provider read fails.
0. **Partner-wide quota entitlement (T-110).** Every Partner API request reserves the shared quota in
   `private.partner_quota_limits` before it is signed. The seeded values (30 requests/minute, 100 new sellers per
   WIB day, `entitlement_verified = false`) are deliberately conservative placeholders, NOT Mengantar's numbers;
   the reviewed contract states 60/minute and 1,000 new sellers/day, but our account's entitlement is unknown
   until Mengantar confirms it. Record the confirmed values as the postgres owner, for example
   `update private.partner_quota_limits set requests_per_minute = <n>, new_sellers_per_day = <n>,
   entitlement_verified = true, note = '<evidence reference>', updated_at = now() where provider_env = 'production';`.
1. Container configuration (see the container gates above; public names in `.env.example`; every name in
   `infra/env/production.env.example`): `POSTGREST_URL` (the compose `postgrest` service by default),
   `MENGANTAR_ENV=production`; the auth values `AUTH_JWT_SECRET` and `AUTH_SECRET` (the machine identity of
   DEC-010 is a service_role JWT signed with `AUTH_JWT_SECRET`), `TURNSTILE_SITE_KEY`,
   `TURNSTILE_SECRET_KEY` and `TURNSTILE_HOSTNAMES` (production `app.geraiexpress.com,owner.geraiexpress.com`, staging the
   `-staging` hosts; bare hostnames only, never localhost: without it the container refuses to start), `MAIL_FROM` (`no-reply@geraiexpress.com`); code mail: `MAIL_TRANSPORT` stays unset
   (fails closed) until the SMTP provider account exists and geraiexpress.com publishes SPF/DKIM/DMARC; then
   `MAIL_TRANSPORT=smtp` with `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURITY` (tls|starttls), `SMTP_USERNAME`,
   `SMTP_PASSWORD` (secret) and one controlled delivery to an owner address before opening registration (T-063); scheduler secret `CRON_SECRET`; encryption values `CREDENTIAL_KEYS` and
   `CREDENTIAL_KEY_CURRENT` (one ring per environment). Single `CREDENTIAL_KEY` still works as v1;
   production must switch to the ring at first rotation, retaining old keys until rewrap is complete.
   Decrypt uses stored `key_version`, encrypt uses current; downgrade is refused. The hourly
   `cleanup` task rewraps this `MENGANTAR_ENV`'s active credentials (T-057; log event
   `credential_rewrap`, counts only). Retire an old ring key only after a run logs `rewrapped: 0`,
   `failed: 0` and `conflicts: 0` with every runtime already on the new `CREDENTIAL_KEY_CURRENT`; a
   `disabled: true` event means the ring or `MENGANTAR_ENV` is missing and nothing was rewrapped. Build with the deployment's **`APP_ORIGIN` build argument**
   (local example only: `http://127.0.0.1:8080`). It is read by invitation and marketing link callers;
   static marketing links bake it at build time. `SITE_ORIGIN`, `OWNER_ORIGIN`, `HOOKS_ORIGIN` are
   mapped by `originFor` but have no current application caller; the marketing apex constant is not a
   read of `SITE_ORIGIN`. Keep the
   bundle guard; `check:bundle` refuses baked machine secrets and secret values from env files.
   `HOST_SHARED_MODE` stays unset in staging/production (`check:environments` refuses it); local
   `dev:env` writes it into `.env.container` only. `AUTH_CAPTCHA_DISABLED` stays unset outside local
   (`check:environments` refuses `true`). Set the four owner-held `PARTNER_TERMS_VERSION`,
   `PARTNER_PRIVACY_VERSION`, `PARTNER_TERMS_URL`, `PARTNER_PRIVACY_URL` values; unset blocks
   onboarding. The server writes the configured versions to the database before every onboarding begin
   (T-057), and the database refuses any other version. When bumping them, drain containers that still
   carry the old values first; otherwise old and new containers overwrite each other's versions and a
   begin may be refused (fails closed). The rate limits are in-process (see gate 6
   above), so there is no per-environment limiter namespace to configure.
2. Mengantar: one supervised production order (price, resi, billing), the billable-weight rule
   (quotes use actual weight; a different charge is flagged as a `price_mismatch` event), whether
   `goodsValue` triggers insurance or fees, the label PDF whitelist (403 today), and egress
   expectations for create-order (production reads needed no allowlist; the Partner API does).
3. Server: the fixed IPv4 address registered with Mengantar, a firewall that exposes only 80 and 443
   (and SSH from the owner's addresses), backups of the Caddy certificate volume and of the env file,
   OS patching, and log retention for container stdout. The seller key is in a provider URL path, so
   never ship outbound request URLs (proxy or network tracing, HTTP debug logs) to a log service.
4. Monitoring (OBSERVABILITY.md): alert on a missing or `failed` `dispatch_sweep`, on
   `record_failed`, on a persistent `reconcile:inconclusive`, on `price_mismatch` events, on a
   rising `priceUnknown`, and on any non-zero `dispatch_sweep.stuck` count; a
   runbook for unknown, provider-error, unpaid and long-queued shipments (admin re-check, close after checking
   the Mengantar app, payment check).
5. Database, before any shared environment applies the 2026-10-28 migrations through `20261028260000` and
   the auth core `20261029100000_auth_core.sql` (existing data is synthetic and is not migrated, DEC-021):
   run the duplicate-seller query (the T-032 migration aborts and deletes nothing if two tenants share a
   `partner_seller_id`; a hit is an incident, not a cleanup), list every non-null
   `partner_seller_id` and every active Partner credential and check each with `sellers/list`,
   note that `pg_cron` is optional (the plain PostgreSQL 17 image has none; the migration is guarded and
   cleanup is then the scheduler container's hourly call),
   shipments confirmed before migration `20261028160000` carry no provider ids and dispatch refuses
   them (`INPUT_INCOMPLETE`), so re-confirm or re-quote any that are still queued.
6. Monitoring additions (OBSERVABILITY.md): `auth_rate_limited` rate, `auth_unavailable` and
   `session_resolution_failed` events, `auth_mail_failed`, `demo_cleanup` with
   `failed: true` or a persistent `hasMore: true`; no alert rule exists for any of them yet.
7. **Required environment gate:** `pnpm check:environments` (container gate 4 above) must pass on
   the real staging and production env files: no secret value shared between environments (each has its own
   database and signing secrets), no
   production value in staging, the compose model and the proxy configuration. Record a passing
   run; do not bypass it or deploy a shared configuration.
8. **Runtime/auth evidence:** local refresh refusals answer **503 with Retry-After 60** (`src/proxy.ts`
   itself answers it, so the request does not continue with expired cookies), retaining the session;
   the same 503 answers a refresh the database could not answer. `auth_rate_limited` logs bounded
   route/status, including local action throttles and the first local refresh refusal (503, route
   `/refresh`). Record session-preservation evidence and do not interpret that 503 as permission to replay
   provider work. Password account budgets follow CAPTCHA; code verification checks Turnstile in the app and binds the
   email to a signed verification-state cookie (T-058 implementation). SQL reconcile `p_env` is also still T-057.
   The container e2e must set `E2E_BASE_URL` and `E2E_PRODUCTION_BUILD=1` to the
   container behind the local proxy profile (`:8080` locally; the local stack's Mailpit on 58025 supplies the
   codes), with an explicit
   runtime-appropriate expect policy (T-059), not blind sleeps/retries. Final-build e2e counts
   are recorded by the lead in STATUS.md. No final verification or new release is claimed here.
