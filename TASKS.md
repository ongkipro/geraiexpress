# GeraiExpress — Execution Queue

Updated: 2026-10-14

This is the sole execution queue. Canonical requirements remain in
[docs/spec/02-PRD.md](docs/spec/02-PRD.md); no competing root PRD is maintained.

## Completed slice — DEL-1 local foundation and usable demo preview

Owner request (2026-10-13): run development task by task, leave delivery footprint and
produce a system map. Scope was DEL-1's first two stages only: local foundation and a
synthetic demo preview (PR-21, IAM-4, UX-3). No cloud resource, Mengantar call, seller
onboarding, email, deployment, commit or push was made. Owner-held policies (CTX-9
ownership, roles, registration, pricing activation, retention) stay open; the demo uses only
synthetic data and a server-side simulated provider.

Shared constraints for every task: Cloudflare + Supabase; tenant scope comes from
server-verified membership, never a client selector; every tenant-owned path pairs a
same-tenant success with a cross-tenant denial (NFR-1); provider work is simulated and refuses
non-demo tenants; UI copy is Bahasa Indonesia; tokens follow UI-2.

Every task below ran as its own `delivery-ledger` run with executed checks, a boundary check
and a separate independent reviewer. Run IDs and evidence are in `.delivery/runs/`; the
narrative is in [BUILD-LOG.md](BUILD-LOG.md).

| Task | Requirement | Risk | Result | Done-when evidence |
|---|---|---|---|---|
| T-001 Runtime foundation and Workers compatibility | ARCH-1, DEL-1 | R1→R3 | PASS, reviewed | typecheck, build, cf:build, bundle scan, worker smoke, browser smoke |
| T-002 Supabase schema, RLS and isolation tests | TEN-1, DATA-1/2, IAM-4 | R3 | PASS, security-reviewed | db reset, 32 isolation/flow tests, db lint, mutation check |
| T-003 Auth, demo entry, scoped shell, queue | PR-1, PR-13, PR-21, UX-3 | R2→R3 | PASS, reviewed | e2e on next dev and Worker incl. 44px targets, forged cookie |
| T-003b Two-membership fixture and tenant chooser test | PR-1 | R2→R3 | PASS, reviewed | `/pilih-gerai` e2e |
| T-004 Contact directory | PR-2 | R2 | PASS, reviewed | contacts e2e incl. stale tab and tampered foreign form |
| T-005 Intake, simulated quote, review, confirmation | PR-4, PR-5, PR-7, PR-22 (sim), NFR-2 | R3 | PASS, security-reviewed | unit, DB, e2e incl. double-click, stale tab, charge = reviewed price |
| T-006 Sample label and print | PR-6 (sim), UX-3 | R2 | PASS, reviewed | label reuse, print media, no-AWB redirect |
| T-008 Quote reuse in RPC and seeded quotes | DATA-2, PR-4 | R3 | PASS, security-reviewed | DB tests, db lint, Worker e2e |
| T-007 Readiness settings, browser proof, system map | PR-8, UX-3, NFR-4 | R2→R3 | PASS, reviewed | settings e2e, full Worker e2e, ARCHITECTURE.md system map |
| T-009 Lock anonymous demo identities (no email/phone/password conversion; OAuth linking off) | PR-31, IAM-4, IAM-8 | R3 | PASS, security-reviewed | DB tests incl. direct-SQL refusal, mutation check, full e2e on next dev and Worker |
| T-010 Unknown-outcome recovery is admin-only; demo visitor is admin of own sample gerai | IAM-1, DEC-008, PR-21 | R3 | PASS, security-reviewed | operator-denied RPC test (mutation-checked), operator escalation e2e, full e2e on next dev and Worker |
| T-011 Per-visitor limits on sign-in and demo entry (Workers Rate Limiting) | RATE-1 native Auth ingress portion (run recorded as NFR-3) | R3 | PASS, security-reviewed | unit key/fail-closed tests, e2e limit tests (mutation-checked), full e2e on Worker and next dev |

T-008 was inserted after T-006 so the closing documentation reflects the final database.

## Completed slice — platform administration and onboarding (local only)

Owner request (2026-10-14): develop and refine everything that needs no further owner decision,
adding any gap found as a task. Accepted policy: DEC-006 to DEC-008. Everything stays local;
public registration is closed by default outside local development until the mail path (PR-33)
is proved, and no cloud resource, Mengantar call or real credential is involved.

| Task | Requirement | Risk | Result | Done-when evidence |
|---|---|---|---|---|
| T-012 Super Admin foundation: platform grants, TOTP `aal2`, tenant directory and lifecycle, access governance with final-admin guard, append-only audit | PR-24, PR-15, PR-28, IAM-7, TEN-4, DEC-008 | R3 | PASS, security-reviewed | DB denial matrix (tenant, demo, aal1, revoked, wrong capability), final-admin guard, audit immutability, e2e 2FA enrol/challenge and lifecycle |
| T-013 Registration and gerai application with Super Admin review | PR-29, PR-30, PR-15, DEC-007, TEN-5 | R3 | PASS, security-reviewed | email OTP via local mail capture, resumable application, approve/reject/corrections, closed-by-default gate |
| T-014 Staff invitations and member management | PR-31, PR-32, DEC-007, DEC-008, IAM-2 | R3 | PASS, security-reviewed | email-bound single-use 7-day invites, wrong-email/expired/revoked denial, last-admin guard, role re-check after lock |
| T-015 Mengantar credentials: sealed BYOK seller-key storage (no readback), Partner ID setting, Partner Secret as Worker binding (readiness only) | PR-18 (storage), PR-26, IAM-3, SEC-3, DATA-4 | R3 | PASS, security-reviewed | Worker-side encryption with a Worker secret, ciphertext-only storage, operator/foreign denial, readiness without secret projection |
| T-016 Turnstile CAPTCHA on Auth entry points: password and demo sign-in, OTP, signup, recovery, resend (gap found 2026-10-14: an anonymous session can make Auth send email-change mail to any address before the T-009 trigger refuses the change, and OTP requests also send mail, so the project mail quota can be drained) | SEC-5, RATE-1, PR-33 | R3 | PASS, security-reviewed | Cloudflare test keys locally; Auth captcha enforced for password and anonymous sign-in, OTP, signup, recovery and resend; real keys are an owner/Cloudflare setup step |
| T-017 Auth email via the Worker's Send Email Hook (DEC-009): signed hook, anonymous refusal, Bahasa Indonesia code mail, transport binding (Mailpit locally, fail closed otherwise) | PR-33, SEC-5, ARCH-3 | R3 | PASS, security-reviewed | unit signature/policy tests (mutation-checked), hook e2e on both runtimes, anonymous email change sends no mail, full e2e with codes through the hook |
| T-018 Preview: Supabase project + Worker on workers.dev, migrations without seed, remote Auth settings from a dedicated config, Worker secrets from the secrets store | DEL-1 stage 2 | R3 | PASS, security-reviewed | `pnpm smoke:preview` (6), HTTP checks, remote db lint, direct Auth probes |
| T-019 Mengantar Public API read client (area search, estimate) with sanitized production fixtures and a live read-only contract check; no order, payment or UI wiring | DEL-1 stage 3, TD-3, UX line 187 | R2 | PASS | `pnpm test:unit` (parser/transport, mutation-checked), `pnpm test:contract` live against production (owner-approved read-only, Node), client run in local workerd, sandbox refusal recorded |
| T-020 Mengantar Partner client (signed list/register/get key, sandbox origin) and sandbox proof: seller registered via Partner, Public API with that key, write path (pickup address, order, status simulation) | DEL-1 stage 3, DEC-006, PR-17–PR-20, TD-3 | R3 | PASS | unit (offline signing vector, envelope/error mapping, mutation-checked), `pnpm test:contract` on the sandbox (Partner list, area search, estimate), recorded sandbox order `261014LJ9GP7` → DELIVERED |
| T-021 Mengantar order adapter: create one drop-off order judged per item (issued / unpaid / failed / rejected / unknown outcome), GeraiExpress reference as `destinationMark`, reconciliation by ORDER_ID and by reference scan | DEL-1 stage 3, TD-3, PR-10 | R3 | PASS | unit (sandbox fixtures, mutation-checked), live sandbox adapter run (rejected, unpaid, both reconciliations) |
| T-022 Account dispatcher core (DEC-010): migration (Mengantar ids on outlets/shipments, operation result fields, one in-flight real operation per tenant, `awaiting_payment`, service_role-only `dispatch_claim`/`dispatch_begin_reconcile`/`dispatch_record`) and `src/lib/mengantar/dispatcher.ts` (dispatch, reconcile by reference); not wired to the UI | TD-3, DEC-010, DATA-2 | R3 | PASS | test:db 84 (dispatcher 16), unit 63 (dispatcher 11, mutation-checked), live: dispatcher on the local DB against the sandbox (order sent, lost answer reconciled, never-sent → not created), shipping e2e 42 |
| T-023 Live quotes and area pickers: machine identity in the Worker (`SUPABASE_SECRET_KEY`, `MENGANTAR_ENV` bindings), tenant admin picks the outlet's Mengantar pickup address (re-read from Mengantar), recipient area search in intake, live estimates written by `record_live_quotes` (service_role only; net cost private), courier names and day ranges for display; live issuance stays locked until T-024 | PR-3, PR-4, UX line 187, DEC-010 | R3 | PASS | test:db 89 (live quotes 5), unit 67, build/cf:build/check:bundle/worker smoke, full e2e on next dev (176), opt-in live e2e against the sandbox on 390/768/1280 with screenshots reviewed |

## Next candidates (not started; each needs its owner decision or gate)

Owner decisions DEC-005 to DEC-008 (adapter, CTX-9, CTX-34, roles) were accepted on
2026-10-14 and the verified slice was committed and pushed on owner request.

1. Enforce DEC-008 operator limits in RLS/RPC as each remaining gated action (contact archive,
   export) is built; each needs an operator-denied test and a role re-check after its row lock
   (member management and `reconcile_shipment` already do this, T-014).
2. Preview hardening: a real Turnstile widget (enable Auth captcha), Cloudflare Email Sending
   as the hook transport (codes on the preview), and a Super Admin bootstrap on the preview; demo/anonymous cleanup, frame/HSTS headers, and
   the email rate limit re-check (RELEASE.md residuals).
3. Live quotes (after T-019): store a provider area id on outlets and recipient addresses (area
   search in the address form), then quote through the tenant's sealed BYOK key in the Worker and
   write quotes via a server-only RPC, keeping simulated quotes for the demo. Needs the account
   dispatcher's key-opening path (TD-3) and a decision on caching/rate limits for estimates.
4. T-024 issuance wiring: confirm_shipment creates real operations for connected tenants, the
   server action runs the dispatcher with the machine identity (bindings exist since T-023),
   reconciliation UI and a sweep for stale operations, COD amount on shipments,
   pay-unpaid as a batch command; add `recipient_area_id` to the confirmation input digest and
   status labels for `awaiting_payment`; validate dispatch inputs before confirmation (a refused
   real operation ends the shipment); re-check the outlet pickup against Mengantar before dispatch
   (the pickup RPC trusts its admin caller); keep a Mengantar area id on saved contact addresses so
   repeat recipients need no new area search; if `dispatch_release` itself fails the operation drifts to
   unknown and could be concluded "not created" — the sweep must surface it, not fail it silently.
   Label PDF needs Mengantar to whitelist the account;
   webhooks need a public URL and the callback secret.

## Deferred (owner decision or external gate)

Real registration/invitations (PR-29–PR-33, DEC-007; needs ARCH-3 mail),
seller onboarding/BYOK (PR-17–PR-20, DEC-006; needs Partner access/egress),
live quotes/issuance/labels (sandbox credentials), Super Admin workspace
(PR-15, PR-23–PR-28, bootstrap per DEC-008), CSV/export/overview.
