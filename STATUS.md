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

Last full verification (2026-10-14): `pnpm test:db` 68, `pnpm test:unit` 16, typecheck, db lint,
build, cf:build, `check:bundle`, worker smoke, and Playwright 176 passed / 1 skipped on both the
Worker (wrangler dev) and next dev.

A synthetic-data preview is deployed (T-018, 2026-10-14): Worker `geraiexpress-preview` at
https://geraiexpress-preview.ongki.workers.dev on Supabase project `geraiexpress-preview`
(RELEASE.md). Auth email, Auth CAPTCHA and Super Admin are intentionally off there. Production
is not provisioned. No Mengantar call, real account, real email or customer data exists.
Simulation output is labelled as such everywhere it appears.

## How to run it

See README.md → "Run locally" (now includes `pnpm dev:hook-relay` for Auth email). Demo access:
open `/masuk` and choose **Coba demo**. Super Admin fixtures and TOTP secrets: README.md.

## Active work

None. See TASKS.md "Next candidates".

## Owner decisions needed next

Accepted 2026-10-14: DEC-005 to DEC-009. Still open:

- Preview hardening inputs: a real Turnstile widget (site key + secret) to enable Auth
  CAPTCHA, and who bootstraps the first Super Admin on the preview.
- Mengantar sandbox access: the sandbox answers 403 for every key from our IP, so Mengantar must
  enable the caller (development and Worker egress addresses) before any write-path proof. The
  supplied sandbox value is a Public API key (owner, 2026-10-14); no Partner credentials exist.
- Mengantar keys pasted in chat on 2026-10-14 (production read key, sandbox key, account password)
  should be rotated once testing is done.
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
