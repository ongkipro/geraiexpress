# GeraiExpress — Release Record

Release-ID: preview-2026-10-14-dddc2184
Base: f64add4 + T-018 changes (preview configuration)
Environment: preview (DEL-1 stage 2, synthetic demo data only)
Declared-Risk: R3
Rollback-Ref: `fcd6b075-3a37-4e85-99a1-c22a5f97765f` (first complete version, same code with both secrets); earlier versions 0d9b134c/d8a6e109 lack one or both secrets and must not be targeted; to take the preview down instead: `wrangler delete --env preview`
Rollback-Command: for later releases, name the target: env -u CLOUDFLARE_API_TOKEN -u CF_API_TOKEN pnpm exec wrangler rollback <version-id> --env preview
Backup-Proof: NOT_REQUIRED (no customer data; synthetic demo tenants only)
Status: PREVIEW_DEPLOYED

## Preview (deployed 2026-10-14 on owner authorization)

| Component | Value |
|---|---|
| Worker | `geraiexpress-preview` → https://geraiexpress-preview.ongki.workers.dev. Active version `f9bc88ad-4f62-43ca-8b59-acfcb76deeb9` (2026-10-18, T-024 + PERF-1, placement `aws:ap-southeast-1`); previous version `dddc2184` (T-018) |
| Supabase | project `geraiexpress-preview`, ref `jezxplwwmjogrmlixdcw`, region ap-southeast-1, Postgres 17; 12 migrations applied with `db push` (no seed) |
| Auth settings | `infra/supabase-preview/supabase/config.toml`, applied with `supabase config push --workdir infra/supabase-preview` (never the local config) |
| Worker secrets | `CREDENTIAL_KEY`, `SEND_EMAIL_HOOK_SECRET` (values only in the owner's local secrets store and Cloudflare/Supabase) |

What works: public pages, isolated anonymous demo (contacts, simulated quote/issuance, sample
label, reset), closed registration, platform/member pages closed to visitors.
Deliberately not enabled: Auth email (no `MAIL_TRANSPORT`; the hook fails closed, so no codes),
Auth CAPTCHA (no real Turnstile widget yet; the app uses Cloudflare's test site key), any
Mengantar call, real accounts, Super Admin (no platform grant exists on the preview).

Known residuals on the preview (tracked under TASKS "Preview hardening"):
- With CAPTCHA off, anyone with the publishable key can call Supabase directly
  (anonymous sign-in + `start_demo`), bypassing the Worker's `DEMO_LIMITER`; only Supabase's
  300 anonymous sign-ins/hour/IP applies. Anonymous users and demo tenants are never cleaned up.
- No `X-Frame-Options`/CSP `frame-ancestors` or HSTS headers yet.
- Auth's email rate limit appeared lower than the declared `email_sent = 30` in probes; re-check
  when the mail transport is enabled.

Evidence: `pnpm smoke:preview` 6 passed (390 and 1280); HTTP checks (`/healthz` 200, protected
routes redirect, unsigned hook 401); remote `db lint` clean; direct Auth API probes: public
signUp/OTP refused, anonymous sign-in allowed, anonymous email change refused by the Worker hook,
platform RPC refused. Details in `.delivery` (T-018) and BUILD-LOG.md.

Redeploy: `pnpm deploy:preview` (builds with all local `.env*` files held aside, checks the bundle and an empty baked env, deploys
`--env preview`). Schema: `pnpm exec supabase db push` with the preview DB password from the
secrets store. Production remains not provisioned.

The preview runs T-019..T-024 and PERF-1 (2026-10-18). Live Mengantar stays off there (no
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
