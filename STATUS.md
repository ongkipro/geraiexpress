# GeraiExpress — Status

Updated: 2026-10-29
Status: Active
State: INTEGRATING
Review-Risk: R3
Primary-Worker: codex-backend-audit
Independent-Review: PASS for the inspected T-068 source delta; final digest-bound acceptance is recorded in the verification run. No unresolved High/Medium in the inspected audit changes.
Independent-Reviewer: security_review (separate read-only agent)
Independent-Review-Head: Uncommitted worktree; approval must bind to the delivery boundary digest, not HEAD alone.

## Current implementation

The application runs on Node.js/Next.js, PostgreSQL 17, PostgREST and application-owned
Auth (DEC-020/021). The current deployment direction is **Vultr + Coolify** (DEC-022),
initially one app instance and same-host PostgreSQL with a persistent volume. Runtime
Supabase Auth/SDK/CLI/hooks have been removed. The standalone `@supabase/postgrest-js`
query builder is retained; it does not require a Supabase service. Historical SQL and
completed-task records are retained for migration integrity and provenance.

The local product includes tenant-isolated shipping, contacts, demo login, onboarding,
email codes, staff invitations, platform administration/TOTP, and Mengantar dispatch and
reconciliation. Accepted behavior and remaining product work are in TASKS.md and docs/spec/.
No claim is made here that every earlier task is complete.

T-068 hardening implements atomic first-password setup, session locking during password
writes, removal of retired auth-role/sequence grants, serialized migration execution with
history-integrity checks, dependency-aware readiness, and a separate Coolify Compose/Caddy
configuration. Application containers receive an explicit environment allowlist excluding
SQL owner/login credentials. Local dotenv files are parsed as data instead of shell code.
See [the audit report](docs/review/2026-10-29-backend-audit.md) for findings and test evidence.

T-069 (UI v4, UI-7) redesigns every page on one shadcn-based system and shell. T-070 (counter handoff after confirmation), T-071 (batch label print queue `/pengiriman/cetak`, approved by the owner and independently reviewed to APPROVE after three rounds), T-072 (shared select, area combobox), T-073 (keyboard, focus, reflow and zoom pass with `a11y.spec.ts`, six findings fixed), T-074 (client JavaScript baseline and budget), T-075 and T-056 (payment-attempt age, inviter identity, admin close dialogs) and T-077 (Super Admin decisions end to end) followed the same day. Final local evidence on the combined tree (uncommitted, `next dev`): typecheck clean, 917 unit tests (54 files), a full serial Playwright run of 167 tests per viewport before T-071 with 0 failures (desktop-1280 164 passed / 3 skipped, mobile-390 163 / 4, tablet-768 162 / 5) plus `label.spec.ts` 9/9 and `a11y.spec.ts` after T-071 on all three viewports, and `pnpm build` + `check:bundle` pass. Not proven: the container image with the new UI, real printers, live provider and CAPTCHA, LCP/INP. Open: T-076 (public photo; left UNVERIFIED by owner decision), T-055, T-058, T-059, T-060, T-062, T-063, T-037, T-043, T-045, T-048. See TASKS.md, BUILD-LOG.md and docs/review/2026-10-29-next-work-breakdown.md.

T-078 and T-079 (owner feedback: the UI felt too simple and had no dashboard): the gerai Dashboard is the default home `/` (UX-16; "Perlu tindakan", today's counts with change against yesterday, 7/14/30-day trend, status split, courier ranking, latest shipments, quick actions, admin setup callout; all figures from the gerai's own shipments in WIB, only "ongkir pelanggan" as money) and every workspace and platform page has a top bar with breadcrumb, global shipment search, "Buat pengiriman", an attention badge and an account menu. Local evidence (uncommitted, `next dev`): typecheck clean, 933 unit tests (56 files); a full serial Playwright run had 10 failures across the three viewports that all passed on isolated rerun except two desktop `label.spec.ts` cases that failed once in a combined rerun and passed alone; the Dashboard landing was measured at 2.4 to 4.6 s in dev against the 5 s expect default, so `playwright.config.ts` has an opt-in `E2E_EXPECT_TIMEOUT_MS`. Not yet run: a single clean serial pass of the whole suite at that limit, `pnpm build` and the route size of `/`, the container image. See BUILD-LOG.md 2026-10-29 (T-078 and T-079).

## Verification and delivery

Validation uses disposable PostgreSQL/PostgREST, synthetic credentials, Mailpit and a local
production Docker image. Existing secret env files and databases are not used. No remote
DB write, deployment, resource provisioning, commit, stage or push is performed by this audit.
The repository already contains extensive uncommitted/staged work from earlier sessions.

Current executed evidence: 898 unit tests (53 files), the full isolated database suite
(29 files / 416 cases), upgrade/security regressions (110 tests / 5 files), typecheck,
Docker production image build, environment guards, real Caddy proxy probes and spec
traceability all pass. Targeted browser regressions passed 41/41 on mobile and 40 on desktop
with one intentionally skipped mobile-only navigation test. Production dependency audit
reported zero advisories. Readiness was observed changing 200 → 503 → 200 during a real
isolated PostgREST outage/recovery. The five flows that failed in the previous mobile
handoff passed here. This is local verification, not production readiness or a claim that
the entire three-viewport browser suite passed. Full-suite execution and the final
post-documentation regression checks are retained in the verification run below.

The initial audit run `RUN-20261028T200837Z-d5eb4b27` finished FAIL because concurrent external
pickup UI/module edits occurred outside its declared boundary. Those edits were preserved;
they are not attributed to this audit. Follow-up verification run
`RUN-20261028T202348Z-04a72f5c` captures the current baseline and owns final verification.
The independent reviewer assesses the entire audit delta against the original snapshot;
the failed boundary remains in the immutable ledger.

Backend pass 2026-10-29 (run `RUN-20261028T204220Z-c1d101ad`; detail in the TASKS.md Results):

- **T-054** (`20261029140000` plus the review fixes in `20261029160000`): the code is complete. The
  independent review returned FAIL (2 Medium, 4 Low). All findings are fixed. With the old lock order
  the lock-order test reproduced a real 40P01 deadlock. Closed after the later reviews.
- **T-057** (`20261029150000`): hourly credential rewrap, environment-bound credential reads
  (`p_env`), and server-synchronized consent versions. Closed after the later reviews.
- **T-056 backend** (`20261029170000`): the unknown batch payment close and the ambiguous pickup
  reservation close, plus the held-time-id guard. The server-action contract for the UI buttons is in
  TASKS.md. Buttons and e2e are UI work.
- **T-067:** the third read-only review returned PASS (0 Critical/High). Both Mediums and two Lows are
  fixed, and the restore drill was re-run (42 migrations). Owner decisions remain.
- **Second independent review** (`150000`–`170000`): FAIL on 1 Medium, the cross-environment sweep
  starvation. It is fixed in `20261029180000` (`dispatch_due` takes `p_env`; the batch close is bound to
  `p_attempt`); the mutation check proves the starvation test. Lows are fixed or recorded.
- **Third review** (`180000` plus the effective T-054/T-056/T-057 definitions): FAIL on 1 Medium. An
  `unknown` batch payment was closable at once, risking a double payment. It is fixed in `20261029200000`
  (30 minutes from `sent_at` for every open attempt; a reserved pickup slot is not claimable from the other
  environment). `20261029190000` adds `review_unpaid_batch.payment_attempt_sent_at` and
  `my_invitations.invited_by_email` (only for the invited address, only while the inviter is still an
  active admin there) for the UI session.
- **Fourth review** (`190000`, `200000`): PASS, 0 Critical/High/Medium. T-054, T-057 and T-067 are checked
  off. T-056 stays open for its UI buttons and e2e; its backend is complete. Open Lows: one backend (a reserved
  pickup stranded in another environment has no recovery path), two UI (use `payment_attempt_sent_at`,
  render `invited_by_email`).
- **Executed evidence (after `20261029200000`):** fresh isolated DB suite 29 files / 432 tests, upgrade
  path 432, `pnpm test:unit` 908, typecheck. Mutation checks for the M1, L1 and inviter-admin conditions
  fail as expected.
- **Local dev database:** gxdb now carries every migration (45) through `20261029200000`, applied with
  `pnpm db:up` and no reset.
- **Provenance:** the run's boundary check fails only on out-of-scope UI paths (`src/app` pages,
  `src/components`, `src/modules/**/*.tsx`, `globals.css`, `tests/e2e`). These were changed on purpose by
  the parallel UI sessions (omp and its UI agent), not by the backend work. They were left as they are,
  neither reverted nor tidied.

## Remaining release gates

- Provision the selected Vultr region/host and fixed egress address; configure Coolify
  managed routing, exact trusted proxy peer, DNS and public TLS. Only the gateway is routed;
  app, SQL and PostgREST have no published production ports. Prove the deployed client IP.
- Configure encrypted off-host backups, retention, recovery objectives/PITR and execute a
  restore drill against the selected production topology. Local tests cannot prove recovery
  from losing the future VPS.
- Select and prove production email transport/sender (T-063), configure real Turnstile,
  bootstrap the first owner account and provision/rotate runtime secrets.
- Complete the named Mengantar commercial, entitlement, supervised sandbox/production,
  label, payment and pickup evidence gates in RELEASE.md/TASKS.md. Unknown provider outcomes
  must reconcile the original operation; no blind resend.
- Before exposing general password change/recovery, bind credential verification and
  session creation to one credential version (the current public flow only initializes a
  password). Keep migration artifacts immutable while a runner is executing.
- Complete remaining product/release tasks and the broader browser matrix. This audit does
  not close T-062/T-066/T-067 or all prior task gates solely from targeted regressions.

The remote legacy preview Worker/Supabase deployment was not inspected or changed here;
its previous deployment is historical, not proof of the current stack. Deleting it or
rotating its secrets requires a separately authorized operation. Production has not been
deployed by this audit. Current run instructions are in README.md and RELEASE.md.

## Delivery state machine

PLANNED → READY → IMPLEMENTING → VERIFYING → REVIEWING → INTEGRATING →
PRODUCTION_READY → AWAITING_DEPLOY_APPROVAL → DEPLOYED → SMOKE_TESTING → VERIFIED.
STATUS.md owns workflow state; .delivery records execution evidence. Local verification
does not advance the project to PRODUCTION_READY.
