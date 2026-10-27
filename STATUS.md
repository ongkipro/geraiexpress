# GeraiExpress — Status

Updated: 2026-10-27
Status: Active
State: AWAITING_DEPLOY_APPROVAL
Review-Risk: R4
Independent-Review: PASS
Primary-Worker: agy-main (gemini-4-argon)
Independent-Reviewer: separate review agents per task (see .delivery runs T-001…T-031)
Independent-Review-Head: f059a9a14d46813bf94ef3424073914fcc2d8b47

## Current state

The DEL-1 local foundation and synthetic demo preview are implemented and locally verified,
and the platform/onboarding slice T-009 to T-017 is complete locally: anonymous demo identities
are locked (T-009), recovery is admin-only (T-010), Auth entry points have per-visitor limits
(T-011) and Turnstile CAPTCHA (T-016), a Super Admin workspace with TOTP, tenant lifecycle,
access governance and audit exists (T-012), registration with application review (T-013),
staff invitations and member management (T-014), sealed BYOK Mengantar key storage (T-015), and
Auth email goes through the Worker's Send Email Hook that refuses anonymous identities (T-017).
Every task finished `PASS` in its own delivery-ledger run with executed checks, mutation checks
and an approved independent security review; evidence is in `.delivery`.

The Mengantar integration and standalone GeraiExpress launch slice T-019 to T-031 are complete
locally and proven against the Mengantar sandbox: read client (area search, estimates), Partner
client and a Partner-registered sandbox seller, order adapter with reconciliation, the account
dispatcher (DEC-010: machine identity, one in-flight order per seller, no resend), live quotes and
area pickers, real issuance with reconciliation, payment checks and a cron sweep (custom Worker
entry), COD shipments with two-pass COD fee pricing (T-025), batch `pay-unpaid` recovery bound by
batch digest (T-026), Partner API sandbox seller onboarding in `/pengaturan` (T-027), `tenant_admin`
contact archive guard and cron/credential unit coverage (T-028), Komdigi-clean GeraiExpress public
marketing pages (`/`, `/fitur`, `/simulasi`, `/cara-kerja`, `/hubungi-kami`) with zero legacy brand
footprint (T-029), security headers (`X-Frame-Options`, `CSP frame-ancestors`, `nosniff`,
`Referrer-Policy`, `HSTS`), expired demo cleanup RPC (`cleanup_expired_demos`), and `wrangler.jsonc`
`env.staging` configuration (T-030), and holistic live-readiness polish (`T-031`: SEO indexation
override + `robots.ts` + `sitemap.ts`, hourly cron demo cleanup, `provider_operations_batch_idx`,
failed initial Partner registration outcome recovery, COD label instruction, `/admin/integrasi`
mode badge, full repository legacy brand scrub including `docs/**`, and E2E coverage for
T-025..T-028).

Last full verification (2026-10-27, T-031): `pnpm test:db` 115, `pnpm test:unit` 108,
typecheck, db lint, build, cf:build, `check:bundle`, worker smoke, spec traceability (16 files,
145 declarations, 7 tasks, 0 findings), and Playwright e2e on next dev across 390/768/1280.

A synthetic-data preview is deployed (T-018, 2026-10-14; redeployed 2026-10-18 with T-019..T-024
and PERF-1; redeployed 2026-10-27 with T-025..T-030 at Worker version `c00e9c85-5cb6-47c8-946d-54fd60ca410a`
and 15 remote Supabase migrations; migration 16 `20261027230000_production_readiness_polish.sql` and T-031
are verified locally and awaiting owner approval before remote `supabase db push` and `wrangler deploy`):
Worker `geraiexpress-preview` at https://geraiexpress-preview.ongki.workers.dev on Supabase project
`geraiexpress-preview` (RELEASE.md). Auth email, Auth CAPTCHA, Super Admin and live Mengantar (no
machine identity or `MENGANTAR_ENV`) are intentionally off there. Production
is not provisioned. Mengantar has been called only with the owner's sandbox credentials and,
read-only, the owner's production key; no customer data exists. Simulation output is labelled
as such everywhere it appears.

## How to run it

See README.md → "Run locally" (now includes `pnpm dev:hook-relay` for Auth email). Demo access:
open `/masuk` and choose **Coba demo**. Super Admin fixtures and TOTP secrets: README.md.

## Active work

None in progress. Tasks `T-001` through `T-031` are completed and verified in [TASKS.md](TASKS.md).

## Owner decisions needed next

Accepted 2026-10-14: DEC-005 to DEC-009. Still open:

- Preview hardening inputs: a real Turnstile widget (site key + secret) to enable Auth
  CAPTCHA, and who bootstraps the first Super Admin on the preview.
- Before a real gerai issues in production (audit 2026-10-14): one supervised production order
  to confirm price and resi, Mengantar's billable-weight and goods-value/insurance rules, the
  label PDF whitelist (403 today), production Worker vars/secrets (`SUPABASE_URL`,
  `SUPABASE_SECRET_KEY`, `MENGANTAR_ENV=production`, a new `CREDENTIAL_KEY`) with a production
  deploy script, Workers Paid (cron subrequests), and alerts on the `dispatch_sweep` log.
- Cloudflare Email Sending eligibility and sending domain (the hook's production transport;
  until then production Auth email fails closed), Terms/Privacy
  and retention.

## Implementation gates

Provider owner mapping, current account/courier entitlements, fee semantics, custom PDF output,
production egress, email delivery and privacy/recovery policies retain their named gates.
Additional gates found during implementation are listed in ARCHITECTURE.md.

## Delivery state machine

PLANNED → READY → IMPLEMENTING → VERIFYING → REVIEWING → INTEGRATING →
PRODUCTION_READY → AWAITING_DEPLOY_APPROVAL → DEPLOYED → SMOKE_TESTING → VERIFIED.
Only actual executed evidence may justify later states. STATUS.md owns current
workflow state; .delivery is the execution-evidence projection. Local verification is not
production readiness.
