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

### Proposal for I1–I3 (assistant recommendation, 2026-11-07; NOT approved — the owner selects)

Based only on what the repository already runs; no plan, price or account is chosen here, and no current
pricing is quoted (check the provider console at selection time).

**I1 — host and region**
- Workload on one host: Coolify v4 (its own containers) + `compose.coolify.yaml` = `app` (Next.js), `scheduler`,
  `postgrest`, `proxy` (Caddy), `postgres` 17. Coolify's documented minimum is 2 CPU cores / 2 GB RAM / 10 GB
  free disk (coolify.io self-hosted install page), for Coolify alone.
- Recommended starting size: **2 vCPU, 4 GB RAM, ≥ 80 GB SSD, fixed IPv4.** Reason: the 2 GB Coolify minimum
  plus four app containers and PostgreSQL leaves no margin at 2 GB; local backups (`BACKUP_DIR`) and previous
  image tags kept for rollback (step 6; app image ≈ 0.4 GB each) need disk. Build images off-host (step 3,
  `GX_IMAGE` immutable), so the host does not need build headroom. Resize later if `docker stats` shows memory
  pressure; this is a staging/pilot size, not a production sizing.
- Region criteria (owner decides): (1) lowest latency to the pilot gerai and to Mengantar's API for Indonesian
  users — Vultr's nearest public region is **Singapore** (Vultr lists no Indonesian region at the time of
  writing; verify in the console); (2) fixed IPv4 that can later be allowlisted by Mengantar (§1); (3) data
  location acceptable to the owner (DEC-029 defers legal/PSE for alpha only; production revisits it).
- DNS (owner action): A records for the four staging hosts (§2), no AAAA; whoever controls the
  `geraiexpress.com` zone publishes them.

**I2 — mail**
- The code supports any SMTP submission service with TLS (`MAIL_TRANSPORT=smtp`, port 465 `tls` or 587
  `starttls`, DEC-027/T-063); no provider SDK. Options: a transactional mail provider, or the owner's existing
  mailbox provider if it allows SMTP submission for `no-reply@geraiexpress.com`. Needed: host/port/user and an
  app password (stored only in the host env file), plus the provider's SPF include, DKIM record and a DMARC
  record (start `p=none`, tighten after delivery is confirmed). Volume at alpha is only sign-in codes and
  invitations, so a free or entry tier is normally enough (owner checks the tier's limits).

**I3 — backup and recovery**
- Supported mechanism: `pnpm db:backup` logical dumps (`pg_dump -Fc`, 0600) + `pnpm db:restore-check`
  (RELEASE gates 12–13). PITR/WAL archiving is NOT built (RELEASE gate 14), so the RPO cannot be shorter than
  the dump interval.
- Off-host target options: an S3-compatible bucket (e.g. the same provider's object storage) or a second host;
  archives are credentials, so encrypt before upload and keep the key outside the bucket.
- Recommended pilot targets (assumptions: one pilot gerai, low write volume, staff can re-enter a few hours of
  shipments from Mengantar/paper records, sandbox key on staging):
  - **RPO 24 h** (daily dump + dump before every migration); move to 6-hourly dumps when real transactions
    start (Level B), since that only changes the schedule.
  - **RTO 4 h** (new host + Coolify + restore from the off-host copy + provider fence per §6), to be confirmed
    by the timed restore drill in §6; if the drill takes longer, the owner either accepts the measured time or
    keeps a warm second host.

**Owner choices still required (nothing remote starts before them):** (a) approve or change the host size and
pick the region; (b) confirm who publishes the four A records; (c) pick the SMTP service and confirm the sender
DNS can be published; (d) pick the off-host backup target and who holds the encryption key; (e) accept or change
RPO 24 h / RTO 4 h for the pilot.

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
- Resolved: **T-115** (deadlock between `reconcile_shipment` and the admin "close unknown" actions on the same operation) is fixed by the forward-only migration `20261106110000` (commits `be066ea`, `1da9327`, merged `aa5fad1`) and validated on head `aa5fad1` by INT-M5 `RUN-20261106T155227Z-d6a2a53f` (unit 1500, db 625, upgrade 625, e2e three viewports 723/0/27). The staging stack applies it with the other migrations; nothing to schedule before multi-admin use.

## Locally verified (T-114 local preparation)
See the T-114 ledger run: committed templates pass `pnpm check:environments` (staging + production templates, Compose
and Coolify models, proxy configs); host/origin separation and SMTP/secret rules covered by
`tests/unit/check-environments.test.ts`; nothing above that needs a host is claimed.
