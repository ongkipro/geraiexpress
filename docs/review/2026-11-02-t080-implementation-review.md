# T-080 implementation review and verification

Status: regular-service source integrated and locally verified on 2026-11-03 under owner approval. Full T-080 remains open and cargo stays disabled. Final bounded approval is owned by the digest-bound delivery run, not this document; no release approval is implied. This document is evidence, not a replacement for TASKS.md or STATUS.md. The sections below dated 2026-11-02 are historical worktree evidence, not final integrated approval.

## Change location

- Worktree: `/home/ongki/Projects/.gx-wt/T-080`, branch `feat/t-080`.
- Migration: `db/migrations/20261102100000_billable_weight.sql`.
- Implementation: versioned weight rules, capability-protected audited rule updates, grouped estimates preserving COD handling, frozen confirmation weight through dispatch, operator weight presentation, and regression tests.
- Existing research/specification edits in that worktree are baseline and are not implementation changes.

## Independent review

Reviewer run `b1e3a8f0-a58e-4fb3-9ce6-386dcb7ad12d` inspected tracked and untracked implementation files. No concrete correctness/security defect found. Merge verdict: OK with notes. Acceptance verdict: APPROVE WITH FIXES, pending browser evidence and disposition of fallback/cargo limitations. The reviewer inspected test logs, but did not independently rerun the suites.

## Executed verification

Worker final execution artifacts report:

| Check | Recorded outcome |
|---|---|
| `GX_TEST_ENV_FILE=/dev/null pnpm typecheck` | Exit 0 |
| `GX_TEST_ENV_FILE=/dev/null pnpm test:unit` | 58 files, 961 tests passed; exit 0 |
| `node scripts/test-backend-isolated.mjs` | 30 files, 442 tests passed; exit 0 |
| Build with explicit loopback origin configuration | Exit 0 |

Parent independently built the worktree image and ran:

```sh
docker build --build-arg APP_ORIGIN=http://127.0.0.1:18080 -t geraiexpress:audit-local .
E2E_EVIDENCE_DIR=/tmp/t080-browser-evidence node scripts/test-backend-isolated.mjs --browser tests/e2e/shipping.spec.ts tests/e2e/workspace-states.spec.ts --project=mobile-390 --project=desktop-1280
```

Outcome: 85 passed, 1 skipped, exit 0. Tests used disposable local application, PostgreSQL and PostgREST containers; readiness outage/recovery checks and cleanup completed. No live provider requests or existing database mutations were part of this verification.

Logs: `/tmp/t080-browser-image.log`, `/tmp/t080-browser-tests.log`. Worker logs: `/tmp/t080-{typecheck,unit,db,build}-resume.log`. These temporary local artifacts are not portable release evidence.

The parent opened the intake screenshots at 390 and 1280 px and the confirmed-detail screenshot at 390 px. Weight rows and provenance links are visible, wrap within the cards, and retain the existing blue/neutral system. Narrow layouts are long, with the existing sticky action appearing within full-page captures; this is not a new T-080 layout design or whole-application visual approval. Browser tests cover dimension-change invalidation, re-quoting, confirmation, keyboard flows and horizontal overflow. No separate comprehensive accessibility audit is claimed.

## Historical acceptance limitations (2026-11-02)

1. Missing dimensions preserve actual grams and NULL volumetric weight. Complete-dimension sub-kg calculations preserve positive raw weight at integer-gram precision rather than inventing a provider-wide 1 kg minimum. These bounded supervisor interpretations still need canonical contract disposition.
2. Cargo regional ranges are evidence only, not verified route-specific constraints. Live quote actions currently supply regular services only; the rule model has no route selector. Cargo helper coverage is not end-to-end cargo support.
3. Provider reweigh ingestion remains T-045; this implementation only adds nullable storage/presentation.
4. Integration is withheld: the parent repository has a pre-existing active T-054 delivery run (`RUN-20261028T204220Z-c1d101ad`) with an observed HEAD different from current HEAD. It must be reconciled through delivery-ledger before a truthful T-080 boundary/integration run can be recorded. No ledger records were hand-edited and no completion result was fabricated.

T-080 remains incomplete. T-082/T-084 and subsequent waves have not started implementation. No commit, push or deployment was performed.

## Approved regular-service integration (2026-11-03)

- Owner approved integrating regular services first, keeping cargo disabled and leaving full T-080 open. This is not cargo or release acceptance.
- Bounded run: `RUN-20261103T085327Z-57f4e09f`, declared R3, parent HEAD `f8746c6e500dd4c696da1072660999842ceaf41f`.
- Integrated the 15 T-080 code/test files from `feat/t-080` without importing its pre-existing research/specification edits. The original migration is unchanged; only newly created disposable databases receive it during verification.
- DATA-14 now explicitly rounds the heavier raw actual/volume with the sourced tolerance (not `max(unrounded actual, rounded volume)`). Missing dimensions or an unknown formula preserve exact actual grams and NULL volume. Sub-kg values retain positive integer-gram precision without an invented minimum or iDexpress half-fare. TASKS/PR-43/UX-19 and ARCHITECTURE record the same regular-only boundary.
- Initial separate review `d264fdd1-6723-4373-8d56-67733f212566` found no concrete correctness/security bug. It requested behavioral coverage of legacy NULL-weight dispatch and effective rule transitions. Added two disposable-DB/offline-dispatch tests for those branches; the latter exercises the same rule RPC/grouped estimator as live quoting and proves future versions are ignored while an older selected quote retains its weight through confirmation/dispatch.
- Integrated verification iterations: typecheck and 58 files / 961 unit tests passed. The first full DB run had 443/444 cases pass: the added legacy fixture accidentally included psql's `UPDATE 1` command tag in a UUID; separating UPDATE from SELECT fixed it. The second full run again had 443/444 pass: its hard-coded Rp27,000 provider mock price disagreed with the legacy Rp9,000 quote, correctly triggering the existing mismatch guard. The mock now follows that fixture's frozen charge while retaining strict outbound-weight and no-mismatch assertions. These were test-fixture defects, not application/migration edits. Both failure logs are retained under `.pi/tasks/t080-verification/backend-{first,second}-failure.log`.
- The second iteration's secret-free Docker build passed. Its real local production-image browser run passed **85 tests / 1 intentional skip** across 390 and 1280 px (`shipping.spec.ts`, `workspace-states.spec.ts`), including readiness outage/recovery, dimension-change invalidation, re-quoting, confirmation and existing keyboard/state paths. Parent opened all four intake/confirmed captures in `/tmp/gx-t080-final-evidence/`: actual/volume/billable values and source links are readable, wrap inside cards and preserve the existing blue/neutral hierarchy. The existing sticky bar appears mid-page in full-page mobile captures; no new layout or whole-app visual approval is claimed. The subsequent bounded visual review and corrected final execution are recorded below.
- `.pi/tasks/t080-verification/verify.py run <check>` executes the actual command and records its exit code, exact arguments, log hash, runner hash and before/after product/test-source manifests. `verify <check>` only grades a completed execution and rejects a changed/failed/missing result; it never claims to rerun tests. This separates product-source freshness from generated `.pi` task metadata and documentation closeout; final documents and all unignored runtime evidence remain covered by the full delivery boundary and traceability. Final ledger grading/digest approval must follow the successful corrected runs.
- Follow-up reviewer `3399952f-cc69-4745-aaa8-eb1b103c771b` confirmed the two behavioral coverage additions and canonical regular-only boundary, and returned **bounded visual PASS** after opening all four screenshots. It found two P2 defects in the local receipt grader, not shipment code: Python `assert` checks disappeared under `-O`/`PYTHONOPTIMIZE`, and the manifest omitted executed `db/foundation/*.sql`. Both were reproduced before repair. Explicit rejection checks and foundation coverage now pass `.pi/tasks/t080-verification/test_verify.py` (2 tests, including failed/tampered/valid receipt cases under optimized Python). The red result is retained as `grader-before-repair.log`; old-runner passes are preserved under `old-runner-pass/` and do not satisfy corrected-runner closeout. Reviewer `2957899e-9617-4acf-90f0-5ce0656fe7b7` inspected both repairs and their regression tests and found no issues; it did not rerun the suites. A runtime-disconnected review attempt (`cfa9e65f-a97a-499d-805f-ebcbed6c1a96`) yielded no verdict; its single same-route retry produced this review.
- Focused corrected DB regression run passed **42 tests / 2 files**, covering billable-weight scenarios and the privilege catalog.

### Corrected final execution and closeout contract

Task `ba24c71f4` exited 0 after actually executing all commands with the repaired grader. All before/after product/test/foundation manifests match the final source. No old receipt hash was rewritten to manufacture a new pass.

| Check | Actual command (loopback/disposable environment) | Final result |
|---|---|---|
| TypeScript | `GX_TEST_ENV_FILE=/dev/null pnpm typecheck` | PASS |
| Unit | `GX_TEST_ENV_FILE=/dev/null pnpm test:unit` | 58 files / 961 tests PASS |
| Database | `node scripts/test-backend-isolated.mjs` | 30 files / 444 tests PASS |
| Production image | `docker build --build-arg APP_ORIGIN=http://127.0.0.1:18080 -t geraiexpress:audit-local .` | Build and client-bundle scan PASS |
| Browser | `E2E_EVIDENCE_DIR=/tmp/gx-t080-final-evidence node scripts/test-backend-isolated.mjs --browser tests/e2e/shipping.spec.ts tests/e2e/workspace-states.spec.ts --project=mobile-390 --project=desktop-1280` | 85 PASS / 1 intentional skip; readiness 200 → 503 → 200 |
| Receipt regressions | `python3 .pi/tasks/t080-verification/test_verify.py` | 2 test methods PASS, including six optimized-Python receipt cases |

Final raw logs and JSON execution receipts are `.pi/tasks/t080-verification/{typecheck,unit,backend,container-build,browser}.{log,json}`. The final ledger executable graders verify these completed commands' exit codes, exact arguments, log hashes, runner hash and unchanged source, rather than claiming to rerun the suites. These are local consistency receipts, **not independent tamper-resistant attestations** or a complete execution-environment binding. Final docs and all unignored evidence are separately bound by fresh traceability and the full delivery boundary. The matching independent digest approval must exist before the bounded run reports PASS; see `RUN-20261103T085327Z-57f4e09f` for that approval/result.

Four final PNG captures are preserved in `.pi/tasks/t080-verification/visual-final/` with SHA256, byte size and image dimensions in `manifest.json`. Screenshots establish only the bounded weight presentation, not interaction or comprehensive accessibility. Browser interactions/keyboard/state claims come from the executed tests. Provider HTTP is synthetic; matching mock prices do not establish real provider tariff agreement.
- Residual boundaries: no live provider pricing/entitlement proof, no cargo route/order support, no T-045 provider reweigh ingestion, no real printer or production proof, no full three-viewport whole-application acceptance. No commit, push, deployment or existing database mutation.

## Cargo transport preparation (2026-11-03)

Owner renewed offline implementation authorization following public-research approval
`RUN-20261103T104120Z-26594853`. New bounded R3 run:
`RUN-20261103T114322Z-9ac39bc7`, implemented first in the existing `feat/t-080` worktree.
This is non-COD transport preparation and grouping hardening, not a full cargo feature.
No UI, database schema, historical migration, dispatcher activation or credential binding
is changed. All real shipping actions remain regular-only.

The adapter now has explicit opt-in cargo parsing using cargo-specific prices, net,
discount, ETA and validated route-minimum metadata. Service-class identity is retained
across weight groups and supplied-estimator two-pass COD; a stale/missing route minimum
cannot borrow a regular row or pass as verified cargo configuration. Explicit non-COD
creation uses base courier plus an item Boolean, rejects unsupported input before sending,
and requires a true cargo echo plus a readable/non-contradictory price before accepting the
response. Missing/wrong echo/price stays UNKNOWN without retry; read-back retains known
Boolean mode and does not equate unknown with regular. Cargo COD is blocked at parse and
creation boundaries pending resolution of the captured fee discrepancy.

The new cargo regressions initially failed **19/35** before implementation; 16 passing
cases described already-existing fail-closed behavior. Two public response fixtures are
unauthenticated shape evidence only. Added grouping regressions distinguish both same-
and different-weight regular/cargo rows for one base courier, and reject missing/stale
provider minimums. TypeScript LSP found zero diagnostics across the four edited TS files.
The first focused run passed82/83; the old exact-shape read-back test lacked the newly
preserved `cargo: false`. Its assertion was updated to retain and check false, not remove
mode data. The run stopped before typecheck. A requirement-linked R3 scope expansion
covers that existing test, with unit/typecheck verification required. Seven source/test/
fixture files are integrated. Final main `GX_TEST_ENV_FILE=/dev/null pnpm typecheck`
and `GX_TEST_ENV_FILE=/dev/null pnpm test:unit` actually exited0: **59 files / 1004 tests**.
Source stayed unchanged during that final execution. Fresh main LSP reported zero diagnostics
across all five edited TS files. Logs are `.pi/tasks/cargo-transport/{typecheck,unit}.log`,
with the red/failure logs preserved alongside. Final independent review/digest acceptance
must bind the unchanged surface in `RUN-20261103T114322Z-9ac39bc7`; this report is not an
approval. No provider success, production build, DB suite, E2E rerun or changed-UI
validation is inferred from these offline commands; no UI/schema/dispatcher was changed.

The first independent review (`08a3ffe1-c56c-4eb2-94d0-712dd95d7416`) approved the
source/docs then present with no findings. The first PASS closeout was nevertheless denied
because mandatory direct-record typecheck/unit checks were stale after documentation and
runtime-artifact updates. That approval is historical, not acceptance of a subsequent digest.
Direct pass logs are preserved in `pre-receipt-pass/`; source/regular receipts were not
rewritten. A byte-identical isolated copy of the already-reviewed regular-slice receipt
runner and its regression suite is under `.pi/tasks/cargo-transport/`; both regression
methods passed, including real Python-O rejection cases and foundation-source coverage.
Fresh execution task `b9fc7fadb` actually reran typecheck and the full unit suite: both
exit0, **59 files / 1004 tests**, identical before/after product/test/foundation manifests.
Final source-bound JSON/log receipts are `.pi/tasks/cargo-transport/{typecheck,unit}.{json,log}`.
Closeout requires executable receipt grading on the final source. Grading checks actual
completed commands/exit codes/log/runner/source and does not rerun them. It is local evidence
consistency, not external attestation or complete environment binding. Final documents and
all unignored runtime artifacts are separately covered by fresh traceability and a new
independent digest-bound review. See the delivery run for the final verdict/finish.

Fresh public Partner docs were compared with the existing implementation rather than
adding another client/secret store. Current hosting proposals are qualified by DEC-020–022.
The existing rotation client deliberately drops callbackSecret under PR-19, so webhook
secret persistence/readiness is not claimed and remains a separately accepted T-045 concern.
Credential provenance after the owner's 99ribu correction is unresolved; no credential,
authenticated provider call, order/payment/rotation or existing DB access is part of this
slice. Cargo-limit correction and DB snapshot/UI/dispatch/reconciliation activation remain
required before full T-080 closure.

GeraiExpress dev was separately started on Tailscale port3100 and opened in the native
browser: title `Kasir Loket Pengiriman Multi-Kurir · GeraiExpress`, with the GeraiExpress
public landing page. The process on3099 was identified by its working directory as the
99ribu checkout and was not changed. Public-page startup is not authenticated-flow proof.
