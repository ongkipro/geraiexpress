# Cross-project review: Geraicuan lessons for GeraiExpress

Date: 2026-11-02
Status: source review and selected offline validation completed. This is review evidence, not a second specification, work queue, security certification, or release approval.
Owner request: review Geraicuan and existing research before continuing GeraiExpress development; review, audit, improve and document every subsequent task.

## 1. Scope, baselines and evidence labels

| Target | Baseline inspected | Treatment |
|---|---|---|
| GeraiExpress | `f8746c6e500dd4c696da1072660999842ceaf41f` plus existing dirty research/specification documents | Current implementation and accepted decisions own integration choices. Existing changes are preserved. |
| Geraicuan primary checkout | `3e3ebf6`, `feat/phase-12-admin-patterns`, dirty | Historical checkout, **not** the reference implementation. Its dirty changes are not reviewed or adopted as integrated behavior. |
| Geraicuan reference application | Local `origin/main` / `0ab05ea`; source inspected in `~/Projects/geraicuan-integrate-20261029` and `~/Projects/geraicuan-brand` | Application source and tests are unchanged from this commit in both worktrees; their dirty handoff documents are separate, unintegrated evidence. The brand worktree has the installed test runner. |
| Geraicuan backup reference | Local ref `docs/ops-backup-r2`, `2f86b08`; dated handoff records | Historical operational evidence only; not a newly performed restore or live-health observation. |
| T-080 | GeraiExpress worktree `~/Projects/.gx-wt/T-080`, branch `feat/t-080` | Separate unintegrated implementation. Its earlier review/test report is historical evidence, not a fresh main-tree pass. |

No remote fetch, production probe, secret-file access, real customer-data access, provider API request, database migration or deployment is included. Public documentation fetches are not authenticated provider API calls. No Geraicuan source was edited. Local refs may lag the remote; "latest" here means the best integrated local reference inspected, not the latest remote revision. Other feature worktrees are not assumed merged, tested or absent merely from their branch names.

Evidence labels:
- **Observed source:** verified code/control/contract at the named baseline; not proof of live behavior.
- **Executed:** a check performed in this review, with its real boundary and substitutions stated.
- **Historical:** a previous report or handoff; not rerun here.
- **Proposal:** useful direction needing canonical specification/acceptance before implementation.
- **Unknown:** insufficient evidence; never converted into zero, success or entitlement.

The 2026-10-28 legacy comparison remains historical. Its comparison of GeraiExpress as Workers + Supabase and its egress-gateway recommendation are superseded by DEC-020/021/022. Do not use that hosting rationale to select today's architecture. Its warning against copying the legacy account, pricing and identity models still applies.

## 2. Coverage and limits

| Area | Reviewed material | Depth and limit |
|---|---|---|
| Product and navigation | Geraicuan system map, metrics contract, manifest, status and route/test inventory; GeraiExpress tasks, architecture and research | Broad inventory; not a rendered review of every page. |
| Tenant and account authority | `src/db/tenant-context.ts`, `src/lib/mengantar-credentials.ts`, account serialization and status-pull call chain | Direct source review; no live RLS/concurrency experiment. |
| Provider operations | Webhook handler and repository, status pull, HTTP boundary, order serialization, cancellation and cancellation repository | Direct control-flow review; no real order, cancellation or callback. |
| Money and settlement | COD constant, settlement exact-decimal parser, ledger repository, cancellation reversals, pricing study | Source and selected offline tests; no settlement import or proof of commercial terms. |
| Counter workflow | Handover rules, barcode/thermal tests, quote prefill and WhatsApp helpers | Source and selected static-render/behavior tests; no physical printer/scanner or browser layout proof. |
| Auth and hosting | Production origin/proxy/cookie configuration, Dockerfile, current/historical ops handoff | Configuration review; not a complete Better Auth exploit audit, fresh image build or production audit. |
| Research | Market/regulatory research, pricing review, market-gap analysis and official-data/provider evidence lanes | Source/provenance review; targeted provider-doc re-fetch. Not a complete revalidation of every citation or legal opinion. |
| Verification quality | Selected test bodies and runner setup | Behavioral assertions distinguished from source-string/static-markup guards; full Geraicuan suite and DB tests not run. |

This is a cross-domain improvement review, not a claim to have exhaustively audited every Geraicuan function or certified it secure.

## 3. Findings that change the next work

| ID | Priority | Finding and concrete evidence | GeraiExpress disposition |
|---|---|---|---|
| XR-01 | High | Legacy webhook routing assumes one configured platform account: `src/db/mengantar-webhook-repository.ts` defaults to `PLATFORM_WEBHOOK_ACCOUNT_KEY`; `mengantarWebhookConfig` accepts one configured secret. GeraiExpress requires a separate seller per tenant. | T-045 must design seller-secret lookup and account/order correlation first. Reuse the signature vector and bounded-body behavior, **not** the default account lookup. A signed AWB alone is not authority over another seller's shipment. |
| XR-02 | High | Legacy COD arithmetic embeds `MENGANTAR_COD_FEE_BASIS_POINTS = 333` in `src/lib/mengantar-cod-fee.ts`; its settlement parsing also checks that historical identity. GeraiExpress's pricing study explicitly rejects importing the reference break-even COD Ongkir formula. | Preserve PR-22/PR-23 and provider-derived fee inclusion exactly once. Use legacy examples only as historical regression vectors, never as an activated rate, minimum, markup, tax or revenue policy. |
| XR-03 | High | Cancellation distinguishes `REFUSED`, `SKIPPED`, `UNKNOWN`, `NOT_RECORDED` and confirmed deletion in `src/lib/shipment-cancellation.ts`. The UNKNOWN branch returns without persisting a cancellation operation; a later invocation can reach another DELETE if local status remains eligible. | Reuse the outcome taxonomy in T-045, but design a durable original-operation record and reconcile gate before offering any repeat mutation. This is a source-observed transfer hazard; duplicate provider effects were not reproduced. |
| XR-04 | Medium | Status pull is scheduled by a tenant-admin visit using `after()`; `AUTO_STATUS_PULL_DAYS = 14`, one outlet per visit (`src/lib/mengantar-status-pull.ts`). | T-045 should use GeraiExpress's existing secret-protected scheduler, not copy visit-triggered freshness as a dependable background service. Define stale/failed-pull visibility and treatment of older open/returning parcels. |
| XR-05 | Medium | Local handover is a separate fact from provider pickup scan: actor/time/method, undo while ISSUED, and "Diserahkan, belum discan kurir" attention (`src/lib/shipment-handover.ts`). | Valuable **new proposal**, not delivered by T-070's post-confirmation handoff UX or T-043's pickup reservation. Specify an auditable local handover event and tenant/outlet scope before adding a task. Do not manufacture a courier status from a staff click. |
| XR-06 | Medium | Cancellation and status-pull paths can append ledger reversals atomically. The metrics contract explicitly admits webhook cancellation waits for a later pull before reversal; prepaid refund is not inferred. | Reuse append-only correction/idempotency principles, not the legacy ledger schema or a blanket "cancelled means refunded" rule. T-045/T-087 must distinguish cancellation, provider refund evidence, customer counter-payment void and earnings. |
| XR-07 | Medium | Legacy metric conventions define WIB half-open periods, current-state snapshots versus event/cohort counts, unknown denominators, and generated-at freshness. Its own conventions also say whole-IDR-only although settlement uses four decimals. | Keep metric definitions with canonical GeraiExpress PRD/data/UX/architecture owners. Add parity/unknown/boundary tests when implementing T-087 or changing dashboard metrics. Do not copy this internal documentation contradiction or create a competing metrics truth. |
| XR-08 | Medium | Geraicuan's handoff records a production image initially missing `public/`; the current Dockerfile explicitly copies it. Its health check renders login, not a dependency-aware readiness endpoint. | Retain GeraiExpress's stronger dependency-aware readiness. T-055/T-062 final-image checks should include brand/courier assets on the correct hosts and the auth/email flow, not only a 200 login response. No new stack is needed. |
| XR-09 | Medium | Several legacy "integration" tests assert source strings or static HTML; even the webhook test's "records once" uses a mocked record callback and does not prove persistent deduplication. | Borrow observable fixtures and invariants; write real isolated DB tests for uniqueness, replay, ordering, atomicity and tenant denial. Do not equate the legacy test-file label, source assertion or count with end-to-end proof. |
| XR-10 | Medium | GeraiExpress pickup source and SQL still enforce 90 minutes (`src/lib/mengantar/pickup.ts`, migration `20261028200000`), while T-043's 2026-11-02 amendment asks for sourced per-courier cut-offs and configurable default 120 minutes. | T-043 has implementation work as well as supervised-capture gates. Its earlier "only capture remains" result predates that amendment. Use a forward migration, not edits to the applied historical SQL. |
| XR-11 | Medium | Current main has no counter-payment/cash-period/declaration/tracking-link implementation; T-080 is only in a worktree. T-082/T-084 worktree names do not indicate implementation; their inspected changes are documentation only. | T-080–T-087 remain open. Never promote the market-gap research or an existing worktree into a completion claim. |
| XR-12 | Medium | The old active delivery envelope captured a different HEAD; some architecture rows also say admin close/rewrap are absent although code exists. | Historical run closed BLOCKED, not rewritten or relabelled PASS. This documentation slice starts against current HEAD. Broader architecture/release corrections and final-container evidence remain T-037/T-055/T-062 work. |

These priorities indicate the consequence of a wrong transfer or an incomplete workflow. They are not independently reproduced vulnerability ratings against Geraicuan production.

## 4. Reuse matrix: learn selectively, do not fork the old product

All legacy paths below are relative to reference `0ab05ea`.

| Candidate | Source / observable behavior worth retaining | Decision | Existing canonical owner |
|---|---|---|---|
| Webhook verification | `src/lib/mengantar-webhook.ts`: raw-byte HMAC, timestamp window, constant-time compare, body cap, feature gate, body-free errors | Adapt with per-seller identity, environment binding and persistent idempotency | T-045, SEC-6, PR-12 |
| Provider status vocabulary | `src/lib/provider-delivery-status.ts`; distinguish documented/observed values from UI-only guesses | Adapt mapping tests; unknown/LOST stays non-final until captured/accepted | T-045, then T-085/T-086 |
| Safe cancellation | `shipment-cancellation.ts`, `src/db/shipment-cancellation-repository.ts`: refusal/partial/local-write outcomes | Adapt semantics; add durable unknown-operation handling | T-045 |
| Precise settlement | `mengantar-settlement.ts`: parse decimal numeric text with bigint units; discard irrelevant PII | Reference only while settlement is deferred; establish needed precision independently | Existing deferred settlement scope; no new ledger now |
| Handover record/scan | `shipment-handover.ts`, handover repository and tests: staff fact separate from provider fact | Proposal; do not import its 24-hour threshold as a provider SLA | PRD/UX/data/IAM amendment needed before a new task |
| Share resi | `src/lib/whatsapp.ts`, `tests/counter-quick-wins-t287.integration.test.ts`: user-initiated `wa.me`, number validation, no amount/address, label-derived sender | Adapt to stricter GeraiExpress snapshot masking/public projection and token contract | T-085; receipt message remains T-082 |
| Quote → draft prefill | `src/lib/shipment-prefill.ts`, counter quick-win tests | Proposal; retain server validation and treat price as untrusted/stale | Existing quote/intake contracts; separate task only if accepted |
| Thermal label discipline | `tests/label-thermal.integration.test.ts`: immutable facts, Code128, physical-size assertions, sender-stub PII exclusions | Mostly already present; compare before adding anything | T-044/T-071; T-048 physical/courier acceptance; T-084 notice |
| Reports and navigation | `docs/spec/18-SYSTEM-MAP.md`, `19-METRICS-ANALYTICS-CONTRACT.md`: map routes/actions/data ownership and metric provenance | Reuse maintenance discipline in existing GeraiExpress architecture/spec docs, not its duplicate claims/counts | T-037 and affected feature task |
| Invoice and CSV | Legacy snapshot/export patterns | Already implemented in GeraiExpress; invoices must not be relabelled paid receipts | T-047 complete; T-082 adds payment-backed receipts |
| Ops evidence | Current Dockerfile and dated backup/restore handoff | Validate the chosen GeraiExpress topology independently | T-055/T-062, RELEASE.md/OBSERVABILITY.md |
| Auth | Strict configured hosts/proxies, secure cookie policy, live grant/session checks | Borrow negative-test cases; retain owned auth and PostgREST trust model | T-058/T-060; no Better Auth/Drizzle migration |

Reject: shared platform-default provider credentials; per-outlet provider-account topology; one-tenant-per-user restriction; app-asserted RLS identity as a replacement for verified JWT/RPC scope; shared production demo credentials; hard-coded historical COD fee; brand-specific ledger enums; session advisory locks copied without pool-exhaustion evidence; unnecessary chart/date/dependency stacks. GeraiExpress already has helpers for CSV, labels, date/money formatting, dashboards, auth and dispatch—reuse them first.

## 5. Research screening and fresh source checks

Canonical research read: `geraiexpress-reference-pricing-review.md`, `geraiexpress-market-and-regulatory-research.md`, `geraiexpress-indonesia-market-gap-analysis.md`, `geraiexpress-mengantar-operations-contract.md`, the official-data/provider lanes under `docs/research/evidence/2026-11-02/`, and the prior counter-contract review.

| Claim / proposal | Validation in this review | Safe consequence |
|---|---|---|
| Volumetric divisors, heavier-of-actual/volume, 0.30 kg tolerance (Lion 0.31), regular max weights and balance adjustments | **Fresh public source fetched:** [Mengantar help 5387484](https://help.mengantar.com/id/articles/5387484-cara-menghitung-berat-produk-dan-selisih-ongkos-kirim), page says updated 2026-10-19. Confirms JNE /4000, regular default /6000, IDX cargo /4000; 1.30→1 and 1.31→2 examples, Lion 1.31→1 and 1.32→2. | Supports T-080. Does not establish a universal sub-kg minimum, missing-dimension policy or route-specific cargo limits. Resolve those acceptance limitations explicitly. |
| Pickup API lead, webhook signing and batch-delete refund fields | **Fresh public source fetched:** [Public API docs](https://api-public.mengantar.com/docs/). Confirms 90-minute API minimum; timestamp/raw-body HMAC vector; optional unsigned sandbox environment header; `totalBalanceRefund`/`errorMessages` documented only for lion/anteraja/pos/spx. | Keep stricter local default 120 as a product policy, not a fabricated API requirement. Never trust the unsigned environment header as account/environment authentication. Missing refund ≠ zero. |
| QRIS merchant counts and the claimed October-2026 MDR change | BI direct fetch failed. Fresh search unavailable because the requested provider route lacked API-path authentication. Existing lane itself discloses indirect retrieval and conflicting transaction-value totals. | **Not revalidated.** No hard-coded MDR, numeric marketing claim or financial forecast. T-082 is a manual payment record, not QRIS acquiring or a gateway. Preserve the accepted no-surcharge constraint independently of the unverified rate figure. |
| Postal QR/masking, agent licensing and PP 33/2026 | Existing source register reviewed, not all primary texts re-fetched. The official-data lane already records PP effective-date uncertainty and an earlier chronology contradiction. | Counsel/provider questions remain T-048/T-088. Do not implement a personal-data QR or announce legal compliance based on this review. A provider label/QR may be distinct from the local operational printout. |
| Counter-payment, cash close and WhatsApp demand | Evidence population is mixed seller/counter; day-close and some sharing severity are explicitly provisional. Competitor feature absence was public-surface absence, not authenticated feature absence. | Build accepted counter contracts, but use the pilot to measure actual payment mix, time-to-resi, discrepancies and support load; do not call these validated market-demand statistics. |
| Earnings/monetization | Reference pricing study defers to owner-selected normal customer tariff and separate private cost; DEC-016 collects no platform fee. | T-087 must not count goods/COD principal, fee/insurance pass-through or hypothetical platform remainder as earnings/revenue. No subscription/markup/gateway is introduced. |

Fresh source content is evidence, not an instruction or authorization to change accepted behavior. Every still-external answer must carry its source/date and remain Unknown if missing.

## 6. Development routing after this review

`TASKS.md` remains the sole executable queue. This section maps findings, not a competing checklist or a new acceptance decision.

1. **T-037 bounded documentation slice:** preserve historical evidence; reconcile stale active execution state; record this source/validation review. Do not close all of T-037: current full-container/three-viewport/release gates remain unproved.
2. **T-080:** first implementation candidate. Review its complete worktree delta and contract limitations, then integrate only after rule/fallback/cargo disposition and a new bounded R3 run. Re-run focused behavioral, real isolated DB, build and 390/1280 browser checks on the integrated tree; obtain independent review. Prior worktree results alone cannot close it.
3. **T-081 → T-082 → T-083:** declaration, payment/receipt, cash period. Prioritize immutable accepted charge, separate provider payment from customer payment, COD no-double-collection, unknown charge refusal, audited void/reopen and concurrency. Receipt wording and Proposed IAM/policy items still require canonical acceptance; a general instruction to continue does not invent those decisions.
4. **T-043/T-045 and T-084/T-085:** safe pickup/cancel/status, masking notice and share/tracking. T-085 can build share/empty timeline without live status, but cannot claim live tracking until T-045. Do not let webhook lookup or cancellation recovery become a shortcut around tenant/account scope.
5. **T-086/T-087:** case/claim deadlines and earnings use the established event/payment basis, not raw courier text or provider-private cost. Both remain dependent on their queue contracts.
6. **T-055/T-058/T-059/T-060/T-062/T-063/T-048:** security, final-image/regression and owner/provider gates remain release blockers as applicable; they are not waived by a new counter feature. Existing code-only tasks may need verification rather than reimplementation.
7. Handover proof/scan, quote-only prefill and metric/freshness extensions are **proposals**, not silently added feature work. Accept the smallest canonical spec/IAM delta and add a task in TASKS.md before implementing them.

## 7. Mandatory closeout loop for each subsequent task

1. Read its accepted requirement, dependencies, caller/data flow and existing helpers. State unknowns and owner-held decisions before code.
2. Start a fresh delivery boundary against the actual HEAD and fingerprint pre-existing changes. Use an isolated feature worktree. No overlapping writers or blanket import of another worktree.
3. Implement one bounded vertical slice; preserve migrations and server-derived tenant/outlet/account authority.
4. Run project-native focused checks, positive and negative trust-boundary cases, and full integration where required. UI changes require opened narrow/wide renders plus keyboard/state checks; a static render is insufficient.
5. Review correctness, security, money/idempotency, accessibility and unnecessary complexity in proportion to the task. R3/R4 and other boundary-required cases need an actual separate reviewer, not renamed self-review.
6. Repair confirmed findings and re-run affected checks on the final surface. Keep failed evidence; no PASS from "passes alone" while an unresolved whole-suite failure remains relevant.
7. Update existing canonical specs/architecture only for accepted changes; append BUILD-LOG evidence; update TASKS result/checkbox and STATUS handoff honestly. Update RELEASE/OBSERVABILITY when their contract changes. Distinguish implemented, integrated, verified and owner-gated.
8. Run traceability and delivery boundary/integrity checks, bind independent review where required, and close the bounded run. A blocked gate is recorded as blocked; move to a dependency-independent task only when it is accepted and explicitly scoped.

No automatic commit, push, deploy, live provider mutation, secret read or production change is authorized by this loop.

## 8. Executed verification and residuals

- Source baselines: Geraicuan application/test/config files checked against `0ab05ea`; GeraiExpress reviewed at `f8746c6` with pre-existing documentation changes preserved.
- Previous review in this session, before this documentation slice: GeraiExpress unit **56 files / 933 tests PASS**, typecheck PASS, spec traceability **16 files / 257 declarations / 62 tasks / 0 findings**. These are current-session main-tree results, not Geraicuan or T-080 evidence.
- Selected Geraicuan checks launched from `~/Projects/geraicuan-brand` with its installed project runner: `env -u DATABASE_URL -u APP_DATABASE_URL APP_DATABASE_URL=postgresql://offline:offline@127.0.0.1:1/offline_review pnpm test:integration tests/mengantar-webhook.integration.test.ts tests/mengantar-settlement.integration.test.ts tests/provider-delivery-vocabulary.integration.test.ts tests/analytics-range.integration.test.ts tests/label-thermal.integration.test.ts tests/counter-quick-wins-t287.integration.test.ts`. **PASS: 6 files / 115 tests, exit 0** (Vitest 4.1.11, 6.44 seconds). Provider HTTP uses fixture/mocked transports; render tests use synthetic props. Real DB/replay/concurrency and browser/physical-print claims are excluded. Task receipt: `bf68dbf86`; output: `.pi/tasks/01a19c76-b807-7288-ba09-fbeb00ac5f06-143606/bf68dbf86.output`. The output path is machine-local and currently untracked, not ignored or portable release evidence; its generated receipt/log are explicitly included in the delivery scope. The command, baseline and result are retained here and in the delivery record.
- Review evidence check: PASS; both reference worktrees have unchanged tracked source/tests/config against `0ab05ea`; the test worktree has no untracked source/test files; 17 named evidence paths exist and all 12 finding IDs are indexed. Re-run with final-document traceability and delivery boundary/integrity checks before closing the bounded run. The evidence-path check proves provenance consistency, not application correctness.
- Boundary follow-up: the initial check correctly failed because the background test generated two untracked `.pi/tasks` artifacts outside the original document-only allowlist. These are verification receipts, not application changes; include their exact paths through requirement-linked scope expansion, preserve the failed check and obtain independent review. The classifier escalated the effective risk from declared R1 to R2. Separate reviewer `0587a659-a5f3-40fb-9369-882b47a2a7a1` returned **APPROVE / no issues found**, limited to this documentation slice and the two receipts. The parent verified its session metadata: provider `9router-fantastico`, model `cx/gpt-6.1-sol`, reasoning `high` (the reviewer itself did not receive that metadata). It independently checked key source claims and receipt consistency but did not rerun tests or network/runtime checks. Final closeout metadata and digest binding must still be approved against the final surface before run PASS. Any R3 implementation needs its own separate review.
- No new production vulnerability, commercial entitlement, current production availability, whole-application browser acceptance or final release readiness is certified.
