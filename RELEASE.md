# GeraiExpress — Release Record

Release-ID: preview-2026-10-27-c00e9c85
Base: f059a9a14d46813bf94ef3424073914fcc2d8b47
Environment: production
Declared-Risk: R4
Rollback-Ref: f059a9a14d46813bf94ef3424073914fcc2d8b47
Rollback-Command: pnpm exec wrangler rollback f9bc88ad-4f62-43ca-8b59-acfcb76deeb9 --env preview
Backup-Proof: snapshot://supabase-geraiexpress-preview/jezxplwwmjogrmlixdcw-2026-10-27
Status: READY

## Preview (deployed 2026-10-14, updated 2026-10-27 on owner authorization)

| Component | Value |
|---|---|
| Worker | `geraiexpress-preview` → https://geraiexpress-preview.ongki.workers.dev. Active version `c00e9c85-5cb6-47c8-946d-54fd60ca410a` (2026-10-27, T-025..T-030, placement `aws:ap-southeast-1`); previous versions `f9bc88ad-4f62-43ca-8b59-acfcb76deeb9` (2026-10-18, T-024 + PERF-1) and `dddc2184` (T-018) |
| Supabase | project `geraiexpress-preview`, ref `jezxplwwmjogrmlixdcw`, region ap-southeast-1, Postgres 17; 15/16 migrations applied with `db push` (up to `20261027220000_contact_archive_and_demo_cleanup.sql`, including `cleanup_expired_demos` and `archive_contact`; `20261027230000_production_readiness_polish.sql` verified locally, no seed) |
| Auth settings | `infra/supabase-preview/supabase/config.toml`, applied with `supabase config push --workdir infra/supabase-preview` (never the local config) |
| Worker secrets | `CREDENTIAL_KEY`, `SEND_EMAIL_HOOK_SECRET` (values only in the owner's local secrets store and Cloudflare/Supabase) |
| Security headers | Deployed on non-static responses: `X-Frame-Options: DENY`, `Content-Security-Policy: frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, and HTTPS `Strict-Transport-Security: max-age=31536000; includeSubDomains` |

What works: public marketing pages (`/`, `/fitur`, `/simulasi`, `/cara-kerja`, `/hubungi-kami`), isolated anonymous demo (contacts, simulated quote/issuance, sample
label, reset), closed registration, platform/member pages closed to visitors.
Deliberately not enabled: Auth email (no `MAIL_TRANSPORT`; the hook fails closed, so no codes),
Auth CAPTCHA (no real Turnstile widget yet; the app uses Cloudflare's test site key), any
Mengantar call, real accounts, Super Admin (no platform grant exists on the preview).

Known residuals on the preview (tracked under TASKS "Preview hardening"):
- With CAPTCHA off, anyone with the publishable key can call Supabase directly
  (anonymous sign-in + `start_demo`), bypassing the Worker's `DEMO_LIMITER`; only Supabase's
  300 anonymous sign-ins/hour/IP applies. `cleanup_expired_demos` is deployed in the database and wired to the `0 * * * *` cron in `custom-worker.ts`, though `env.preview` keeps crons and `SUPABASE_SECRET_KEY` off until staging/production enablement.
- Auth's email rate limit appeared lower than the declared `email_sent = 30` in probes; re-check
  when the mail transport is enabled.

Evidence: `pnpm smoke:preview` 6 passed (390 and 1280); HTTP checks (`/healthz` 200, protected
routes redirect, security headers present, unsigned hook 401); remote `db lint` clean; direct Auth API probes: public
signUp/OTP refused, anonymous sign-in allowed, anonymous email change refused by the Worker hook,
platform RPC refused. Details in `.delivery` (T-018, T-025..T-030) and BUILD-LOG.md.

Redeploy: `pnpm deploy:preview` (builds with all local `.env*` files held aside, checks the bundle and an empty baked env, deploys
`--env preview`). Schema: `pnpm exec supabase db push` with the preview DB password from the
secrets store. Production remains not provisioned.

The preview runs T-001..T-030 and PERF-1 (2026-10-27). Live Mengantar stays off there (no
`SUPABASE_SECRET_KEY` or `MENGANTAR_ENV`; `env.preview` sets no crons).

## Production gates for live Mengantar (integration audit, 2026-10-14)

Not provisioned. Before a real gerai issues orders in production:

1. Worker config: vars `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `MENGANTAR_ENV=production`;
   secrets `CREDENTIAL_KEY` (new, never the preview's), `SUPABASE_SECRET_KEY`,
   `SEND_EMAIL_HOOK_SECRET`; a production deploy script with the baked-env and bundle checks
   (`check:bundle` now also refuses a baked `SUPABASE_SECRET_KEY`). Without the machine bindings
   the cron logs `{"event":"dispatch_sweep","disabled":true}` and live features fail closed.
2. Mengantar: one supervised production order (price, resi, billing), the billable-weight rule
   (quotes use actual weight; a different charge is flagged as a `price_mismatch` event), whether
   `goodsValue` triggers insurance or fees, the label PDF whitelist (403 today), and egress
   expectations for create-order (production reads needed no allowlist; the Partner API does).
3. Cloudflare: Workers Paid (a sweep of 20 operations can exceed the free plan's subrequest
   limit); keep tracing/Logpush of subrequest URLs off — the seller key is in the URL path.
4. Monitoring (OBSERVABILITY.md): alert on a missing or `failed` `dispatch_sweep`, on
   `record_failed`, on a persistent `reconcile:inconclusive`, on `price_mismatch` events, on a
   rising `priceUnknown`, and on any non-zero `dispatch_sweep.stuck` count; a
   runbook for unknown, provider-error, unpaid and long-queued shipments (admin re-check, close after checking
   the Mengantar app, payment check).
