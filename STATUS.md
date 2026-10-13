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

The DEL-1 local foundation and synthetic demo preview are implemented and locally verified.
Next.js 16.3.8 runs on Cloudflare Workers through `@opennextjs/cloudflare` 1.20.10 (proved in
workerd via `wrangler dev`), against a local Supabase stack with fresh migrations, RLS and
seeded synthetic fixtures. The demo (“Coba demo”) gives every visitor an isolated sample gerai
with contacts, shipments, simulated quotes/issuance and a watermarked sample label.

Tasks T-001 to T-006 (with T-003b) and T-008 each finished `PASS` in their own delivery-ledger
run with executed checks and an approved independent review; the closing run T-007 (settings,
system map, documentation) records its own result in `.delivery`. The slice was committed and pushed
to the private GitHub repository on owner request (2026-10-14). Reviews are bound to the
surface recorded in `.delivery`.

Nothing is provisioned or deployed. No Mengantar call, real account, real email or customer
data exists. Simulation output is labelled as such everywhere it appears.

## How to run it

See README.md → "Run locally". Demo access: open `/masuk` and choose **Coba demo**.

## Active work

None. The slice is complete; see TASKS.md "Next candidates".

## Owner decisions needed next

Accepted 2026-10-14: DEC-005 (OpenNext 1.x, pinned), DEC-006 (CTX-9), DEC-007 (CTX-34),
DEC-008 (roles). Still open:

- Permission to provision a remote Supabase project and a Cloudflare preview, plus the Auth
  rate-limit approach for Worker egress.
- Terms/Privacy, retention, mail sender domain and Mengantar sandbox credentials.

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
