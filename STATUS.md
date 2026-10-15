# GeraiExpress — Status

Updated: 2026-10-14
Status: Active
State: REVIEWING
Review-Risk: R3
Independent-Review: PASS
Primary-Worker: claude-code-main (claude-opus-5-5)
Independent-Reviewer: separate review agents per task (see .delivery runs T-001…T-008)
Independent-Review-Head: UNSET

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

The Mengantar integration T-019 to T-024 is complete locally and proven against the Mengantar
sandbox: read client (area search, estimates), Partner client and a Partner-registered sandbox
seller, order adapter with reconciliation, the account dispatcher (DEC-010: machine identity,
one in-flight order per seller, no resend), live quotes and area pickers, and real issuance with
reconciliation, payment checks and a cron sweep (custom Worker entry). Connected real gerai
quote and issue through their own Mengantar key; demo gerai stay simulated. An independent
audit of the whole integration (2026-10-14) found it sound for sandbox and a supervised pilot
and listed production gates (below and RELEASE.md). COD and API payment are T-025.

Last full verification (2026-10-14, T-024): `pnpm test:db` 103 (twice), `pnpm test:unit` 72,
typecheck, db lint, build, cf:build, `check:bundle`, worker smoke, Playwright on next dev (179
passed, 4 opt-in skipped), and the cron sweep in local workerd; the opt-in live sandbox e2e last
ran before the final price follow-ups (order issued unpaid, payment check).

A synthetic-data preview is deployed (T-018, 2026-10-14): Worker `geraiexpress-preview` at
https://geraiexpress-preview.ongki.workers.dev on Supabase project `geraiexpress-preview`
(RELEASE.md). Auth email, Auth CAPTCHA, Super Admin and live Mengantar (no machine identity
or `MENGANTAR_ENV`) are intentionally off there; the preview predates T-019..T-024. Production
is not provisioned. Mengantar has been called only with the owner's sandbox credentials and,
read-only, the owner's production key; no customer data exists. Simulation output is labelled
as such everywhere it appears.

## How to run it

See README.md → "Run locally" (now includes `pnpm dev:hook-relay` for Auth email). Demo access:
open `/masuk` and choose **Coba demo**. Super Admin fixtures and TOTP secrets: README.md.

## Active work

None. See TASKS.md "Next candidates".

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
