# GeraiExpress alpha staging — execution checklist (T-114)

Status: **local preparation done; deployment NOT done.** Every remote step below is open until its evidence is
recorded. This checklist only sequences gates that already exist in `RELEASE.md` (Vultr + Coolify, DEC-022) and
`OBSERVABILITY.md`; it does not replace them. Placeholders only: `<…>` values are filled on the host, never in git.

Alpha scope (DEC-029, STATUS "Release-blocker handoff"): one pilot gerai, BYOK (its own Mengantar key), registration
closed, staff invited by the owner. Legal/compliance/PSE and VAT/PPN are deferred for alpha by DEC-029 (not a legal
exemption); they return before a public or production release.

Hosts (from `infra/env/staging.env.example`): `staging.geraiexpress.com` (apex), `app-staging.geraiexpress.com`,
`owner-staging.geraiexpress.com`, `hooks-staging.geraiexpress.com`. IPv4 only (RELEASE container gate 8: no AAAA).

## 0. Owner inputs (blocking; nothing remote starts without them)

| # | Input | Used in step |
|---|---|---|
| I1 | Vultr plan/region approval and a funded account; DNS access for `geraiexpress.com` | 1, 2 |
| I2 | SMTP provider account (any SMTP submission service with TLS) and the ability to publish SPF/DKIM/DMARC for `geraiexpress.com` | 5 |
| I3 | Off-server backup storage (bucket or second host) and the RPO/RTO numbers | 6 |
| I4 | (Level B only, not staging) pilot gerai + its Mengantar key + approval for one supervised paid order | 8 |

## 1. Host (Vultr + Coolify) — skills `vultr`, `vps-deploy`
- [ ] Owner-approved instance with a **fixed IPv4**; Coolify v4 installed; firewall: 80/443 public, SSH from the owner's addresses only.
- [ ] Record the IPv4 (needed later for the Mengantar production allowlist; staging uses the sandbox).
- Evidence: Coolify reachable; `ss -tlnp` shows only 22/80/443 public.

## 2. DNS + TLS
- [ ] A records for the four staging hosts → the instance IPv4. **No AAAA** (RELEASE gate 8).
- [ ] Coolify Compose resource from `compose.coolify.yaml` (managed routing, "Preserve repository during deployment" ON); the four HTTPS domains only on service `proxy`, port 8080 (RELEASE Vultr+Coolify steps 1–2).
- [ ] `COOLIFY_PROXY_CIDR` = the exact edge address seen on the resource network (/32), never a range.

## 3. Environment file (on the host only)
- [ ] Copy `infra/env/staging.env.example` to `/etc/geraiexpress/staging.env`, `chmod 600`, fill every empty secret with fresh random values (never reused from production or local; the checker refuses shared values).
- [ ] `MENGANTAR_ENV=sandbox` (the checker refuses `production` outside production).
- [ ] `GX_IMAGE` = an immutable image built with `APP_ORIGIN=https://app-staging.geraiexpress.com` (RELEASE container gate 1).
- [ ] Run on the host: `pnpm check:environments staging=/etc/geraiexpress/staging.env production=<production file or the template>` → PASS (validates host/origin separation, secret length/uniqueness, local-only settings, Compose model).

## 4. Database and app up
- [ ] `COMPOSE_PROFILES=db`, persistent `postgres_data`; migrations as the `postgres` owner via `scripts/db-migrate.sh`; never seed or reset (RELEASE Vultr+Coolify step 3).
- [ ] Registration closed: the Super Admin uses the registration switch (`platform_set_registration`, audited reason; `registration_open()` must answer false); staff join by owner invitation (alpha scope).
- [ ] `/healthz` 200; 503 during an isolated data-path outage, then recovery (step 5). `docker compose logs app` shows no `startup_config_invalid`.
- [ ] Host routing smoke (unauthenticated only; staging is never seeded and CAPTCHA stays on): from a workstation, run
      only the host-matrix block: unauthenticated HTTP boundary checks (GETs, plus a POST that must be refused by the removed hook path), and it signs nobody in:
      `E2E_SITE_URL=https://staging.geraiexpress.com E2E_APP_URL=https://app-staging.geraiexpress.com E2E_OWNER_URL=https://owner-staging.geraiexpress.com E2E_HOOKS_URL=https://hooks-staging.geraiexpress.com pnpm exec playwright test tests/e2e/hosts.spec.ts --project=desktop-1280 --grep "host matrix over HTTP"`
      Do NOT run the rest of that file (or any other spec) against staging: they sign in as local fixture accounts
      with a dummy Turnstile token meant for a local CAPTCHA-disabled server.
- [ ] Internal routes refused publicly, checked separately: `curl -s -o /dev/null -w '%{http_code}\n' https://<each staging host>/api/internal/cron/dispatch` answers 404 on all four hosts.

## 5. Mail (T-063) — needs I2
- [ ] Publish SPF, DKIM and DMARC for the sending domain (values from the SMTP provider).
- [ ] In the env file: `MAIL_TRANSPORT=smtp`, `MAIL_FROM=no-reply@geraiexpress.com`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURITY` (`tls` for 465, `starttls` for 587), `SMTP_USERNAME`, `SMTP_PASSWORD` (secret). An incomplete set makes startup name the missing variables and mail stays off.
- [ ] One controlled code mail to an owner address arrives (sign-in code flow). Until then mail fails closed and nobody can sign in with a code.

## 6. Backup, restore drill and rollback target — needs I3
- [ ] Schedule `pnpm db:backup` (daily and before every migration) with `BACKUP_DIR` private; copy every archive off-server (RELEASE gate 12). Archives are credentials.
- [ ] Restore drill from the **off-server copy**: `pnpm db:restore-check <archive> gxrestore_<date>` on the host; record bytes, restore wall time, row/checksum MATCH (RELEASE gate 13).
- [ ] Provider fence after any restore (RELEASE "Restoring a database that served live Mengantar traffic"): a dump restore into a new cluster engages it by itself; **a data-only restore and a PHYSICAL restore (Vultr/VM or volume snapshot, data-directory copy) keep the cluster identity, so engage it explicitly before the app starts**: `select private.engage_provider_fence('Pemulihan dari cadangan <tanggal>: <tiket>');` When in doubt, engage.
- [ ] Rollback target (Coolify): keep the previous immutable image tag on the host; rollback = set the Coolify resource's
      `GX_IMAGE` back to that tag and redeploy the SAME resource (its configuration and the `postgres_data` volume stay);
      then `/healthz` 200 (a newer database stays compatible: forward-only migrations, RELEASE Vultr+Coolify step 5).
      Never run the standalone `--profile prod` command on a Coolify host: Coolify owns ports 80/443 (RELEASE
      Vultr+Coolify step 1). Update RELEASE `Rollback-Ref` / `Backup-Proof` to the real objects only after they exist.

## 7. Scheduler and status
- [ ] Scheduler container running; `cron_run` events every 5 min (dispatch) and hourly (cleanup incl. `status_pull`, `webhook_secret_rewrap`) in the logs (OBSERVABILITY.md).
- [ ] Webhook optional for alpha: if used, publish `hooks-staging` and follow RELEASE production gate 0a. Without it the pull gives no freshness guarantee (eligible after >2 h, first poll up to ~3 h, cap 200/run).

## 8. Level B (real transactions; NOT part of staging acceptance)
- [ ] I4: one supervised sandbox→production order with the pilot's key (price, resi, billing, `price_mismatch` watched); T-048 items 2/6 captures under `docs/research/**`.
- Known defect to schedule before multi-admin use: **T-115** (deadlock between `reconcile_shipment` and the admin "close unknown" actions on the same operation; one request fails and is retried, no data corruption; priority before more than one gerai admin works the same unknown operations).

## Locally verified (T-114 local preparation)
See the T-114 ledger run: committed templates pass `pnpm check:environments` (staging + production templates, Compose
and Coolify models, proxy configs); host/origin separation and SMTP/secret rules covered by
`tests/unit/check-environments.test.ts`; nothing above that needs a host is claimed.
