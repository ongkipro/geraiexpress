# GeraiExpress — Status

Updated: 2026-11-04
Status: Active
State: INTEGRATING
Review-Risk: R3
Primary-Worker: 01a19c76-b807-7288-ba09-fbeb00ac5f06
Independent-Review: Regular baseline approval belongs to RUN-20261103T085327Z-57f4e09f. The separate cargo-transport source review and exact digest acceptance belong to RUN-20261103T114322Z-9ac39bc7; this summary is not review evidence. Neither slice closes full T-080, cargo activation or release gates.
Independent-Reviewer: d264fdd1-6723-4373-8d56-67733f212566 (separate reviewer; latest repair review 2957899e-9617-4acf-90f0-5ce0656fe7b7; same retained session)
Independent-Review-Head: Uncommitted worktree; approval must bind to the delivery boundary digest, not HEAD alone.

## T-094 Sender address and masked-label sender (2026-11-04, PASS; pushed, not deployed)

Run `RUN-20261104T095832Z-7628e0cb` (R3) closed PASS and verified. Implementation commit `f020c09`,
merged as `c91927a` into `feat/counter-ops-2026-11` and pushed to origin. Integration typecheck and
all 1,025 unit tests passed; both branches' ledger histories and T-098 work were preserved.
Only TASKS.md and the generated delivery projection conflicted; both were resolved without source changes.
No production migration, provider operation, deployment or physical-printer verification was performed.
The closing e2e initially failed at Super Admin 2FA login (114 passed, 1 failed, 1 skipped).
The fixture helper could select a previous-step TOTP that expires during rollover; the trace shows
submission crossing the boundary, strongly supporting this diagnosis without establishing the submitted
step. It now selects only unused current/next steps; deterministic rollover/replay-selection tests cover the fix.
Production authentication and replay protection are unchanged. Final gates passed: typecheck,
1,025 unit tests, 477 DB tests, 115 e2e tests (1 skipped). A separate running-PostgREST upgrade proof
passed all 7 sender-address tests without restarting the API. Independent final review e27c4118 approved
the implementation, with only the diagnosis-certainty note corrected here. Run closure and its final
surface-bound verification are recorded by the delivery ledger. Owner decisions
recorded as DEC-025: the masked label may print the full sender address; structured fields with text
limits; the recipient arranged the same way. Assistant-recommended limits: sender name 60, street 5–120,
area 3–40 (printed 2–40), postal 5 digits; recipient name/address keep the provider limits (100/300 live).
The sender address never reaches Mengantar (dispatch payload unchanged, DB test). Review 1 found four
issues (stale sender address after switching contacts, missing PostgREST schema reload, partial contact
address silently dropped, one weakened unit assertion); all repaired, review 2 APPROVE. RELEASE.md step 11
now requires a schema reload after server migrations (the committed T-093 migration has no notify of its
own; the T-094 migration's notify covers both). Reports: `/data/tmp/t094/review/`.
Next: T-096 logo → T-095 resi formats; T-084 after T-094 (same label RPCs); T-082 (in progress), T-099.

## T-099 DB test lifecycle (implementation verified; final source-bound gates and review pending)

Run `RUN-20261104T132445Z-6016ac5f`, worktree `.gx-wt/T-099`; not merged or committed.
The initial normal-test-only patch was rejected by independent review: blocking fixture SQL, late fixture
continuations and lost container-session ownership remained reachable. The repaired implementation uses
asynchronous optional helper I/O, cancellation-bound fetch, per-test ownership, a durable closed startup
gate, container-side process bounds and independent bounded cleanup. Existing assertions and test budgets
are unchanged. Normal isolated file: 12 PASS; full isolated DB: 470 PASS; typecheck PASS. The added permanent
HTTP transport regression passed 2 tests, proving pre/post-fetch cancellation and no follow-up dispatch,
not server transaction completion. Executed logs and probe instrumentation: `/data/tmp/t099/`.
Forced startup-delay, late-encryption and host-delay probes observed no late backend/fixture; stronger
pre-admission proof additionally observed container resumption and closed-gate exit 125.
BLOCKER: admitted-process proof v2/v3 fails real teardown: initial cleanup psql exits 0, final cleanup psql
exits 2, first observer connection also exits 2 then recovers, and one fixture remains. Process ownership
was verified and the delayed connection did not resume. A single quiet-host diagnostic v4 reproduced
failure and captured an actual signal-9 return receipt for owned group 150, followed at the same time by
PostgreSQL PID 1 reporting abnormal child 168, terminating other processes, reinitializing and recovery.
Immediately before the kill, process 168 belonged to the proof-owned delayed shell (PPID 151, group 150),
not an identified postgres process. Independent reviewer 9dfe9b67 corroborated the PID-1 orphan-adoption/reaping fault rather than a
backend inheriting the client's process group. Official upstream PG17 stable postmaster source confirms
waitpid(-1) routes abnormal unrecognized children to HandleChildCrash before BackendList membership.
The source branch was not independently matched to the pinned image's exact minor/build.
Filtered lifecycle/process receipts: `/data/tmp/t099/admitted-connect18-v4-{events.jsonl,driver.log}`.
No raw secret-bearing PostgreSQL logs were persisted; v2/v3 evidence remains untouched.
Requirement-linked R3 expansions add Docker --init in the isolated harness and init:true in the local
compose PostgreSQL service; production configurations are unchanged. Compose validates with env-file
resolution disabled. A single otherwise unchanged v5 init proof PASS: init PID 1, postmaster PID 7,
successful group-SIGKILL receipt, both cleanup psql exits 0, 69 clean observer samples over 25 seconds,
no delayed resumption and no kill-associated PostgreSQL recovery. Original test intentionally times out
at 15 seconds (runner exit 1); that expected failure is separate from proof PASS. Cleanup budgets remain
7 seconds container/8 seconds host. Evidence: `/data/tmp/t099/admitted-connect18-v5-init-{events.jsonl,driver.log}`.
Canonical --init harness regression passed: 12 file tests and 470 full isolated DB tests. A final preflight
now rejects known unsafe postmaster-PID-1, missing or empty proc identity before fixture SQL/admission;
its actionable message requests recreation without restarting the existing user database. Four permanent
shell-preflight cases plus the two HTTP-cancellation cases PASS (6 total), typecheck PASS and all 12
DB lifecycle tests PASS again. Logs: `/data/tmp/t099/{init-full-db,preflight-unit,preflight-typecheck,preflight-file}.log`.
Reviewer 82ae9b2c accepted the init changes and comparable v5 causal confirmation. Its lifecycle timestamp
finding was repaired to start from the matching kill request while requiring successful return; replay of
stored v5 receipts passes the wider interval without another runtime claim. Existing compose containers
have NOT been recreated: configuration validation is not current-stack runtime acceptance. The guard
fails safely on the known unsafe topology until the user recreates it with init.
Reviewer 2b471b29 accepted the final preflight and its regression without findings. This guard rejects
known-unsafe topology; it does not certify every possible PID 1 reaper, nor suppress all afterEach SQL.
Final executed typecheck/full DB, current-source admitted proof, compose validation and independent
digest-bound review remain due before source-run closure. Keep task unchecked until the verified
implementation is integrated and its separate documentation handoff records completion.

## T-093 Super Admin customer-data review (2026-11-04, PASS, local only)

Run `RUN-20261104T061201Z-1b6e7ebc` (R3). Owner instruction: everything stays local — no commit, no
push, no deploy; the T-093 work is in the working tree only. Capability `customer_data_review`
(assistant-proposed safeguard, DEC-024) is held by no grant by default and is granted only through
`platform_set_grant` (access_governance, reason, audit). Owner hard conditions, held by DB and e2e
tests: without the capability every page is a plain 404 identical (status, title, body) to an unknown
path and every RPC is refused before validation; without a valid reason no row is read or returned and
nothing is audited; the phone never enters a URL (Server Actions; every requested/navigated URL checked
for both phone forms). Each read writes one audit row (phone masked + SHA-256 of the normalized key).
Demo gerai and simulated shipments are excluded. Production use waits for counsel (T-048).

Findings during verification: the e2e caught a 404 title leak (a static `metadata` export renders even
after `notFound()`); `/admin/pelanggan` now checks the capability in `generateMetadata`. Review 1
(CHANGES REQUIRED): P1 a capability-only admin could not open per-gerai data (the gerai page needs
monitoring) → new `/admin/pelanggan/[tenant]` without monitoring RPCs; P2 audit baseline taken too late,
pagination untested, SHA-256 checked by shape only, demo exclusion conditional → all strengthened, no
assertion weakened. Review 2 APPROVE (digest 10810c88). Known limit (accepted by the reviewer): the
"Muat berikutnya" reason is client form state; every page is re-validated and audited by the RPC, so it
is per-read evidence, not tamper-resistant session continuity. Reports: `/data/tmp/t093/review/`.

Migration integrity (explicit): `20261104100000_customer_data_review.sql` was **edited after** its first
apply to the disposable local DB `gxdb` (06:17:58Z) — not before. The first version lacked
`grant execute on function private.customer_phone_key(text) to authenticated`, which
`tests/db/privileges.test.ts` exposed (gerai shipment writes failed because the new expression indexes
evaluate the function). The file gained that grant (line 25), and `gxdb` was adjusted **by hand** with
exactly two statements: the same grant, and `update private.schema_migrations set sha256 = <new sha>
where version = '20261104100000'`. Nothing else was hand-written; the file was never committed or applied
elsewhere. Proof: a fresh database `gx_t093_verify` migrated from zero (`scripts/db-migrate.sh --reset`,
51 migrations) recorded sha256 `76bc2400e751d7fe5a3f7db4ffa47ed183eb52e161452e8c80adc5a5969705f9` for this
version, equal to the file and to `gxdb`, with the grant and the extended capability check present; it was
dropped afterwards. Ledger check `migration-integrity` (declared); note `/data/tmp/t093/migration-integrity.md`.

Run conditions: suites ran strictly one at a time, each only at a one-minute load <= 4 and with no other
browser/integration suite on the machine (`/data/tmp/t093/gate-wait.log`). A power outage interrupted
the first DB gate; its leftover disposable containers/networks were removed after confirming their
runner was gone. Git integrity: right after the reboot this session observed `git fsck --no-dangling`
exit 2 with `missing tree 4b825dc6…` (the empty tree), referenced only by `refs/pi-rewind/store`
(session-reported; no artifact was saved at that time). The implementer performed no repair and ran no
command that writes into `.git` (owner instruction). A later read-only check (15:18 WIB,
`/data/tmp/t093/review/git-integrity-readonly.txt`) shows `git fsck` exit 0, the object present and every
ref, including `refs/pi-rewind/store`, passing; which process restored the object is not established.
Branch commits and worktrees are intact.
Next queue: T-094 → T-096 → T-095 → legacy native `<select>` to shadcn.

## T-097 Super Admin controls on shadcn primitives (2026-11-04, PASS)

Queue item 1 after the pause. Run `RUN-20261103T200404Z-5913b3ec` (declared R2, boundary R3):
Konfigurasi "Teks masih sementara" uses the shared `Checkbox` inside a 44px label; the Direktori
search uses `Input`/`Label`; the Audit "Jenis keputusan" filter uses the shared Radix select
(`src/app/admin/audit/action-select.tsx`, hidden `jenis` so "all" stays empty). Review 1 found a P1:
the select kept an unsubmitted or cleared choice across soft navigation (Next keeps client state on
query changes) and re-applied it on submit; review 2 found the first key repair partial. The search
form is now keyed by category, action and query; e2e covers clear-filter, query-only clear, category
tab and Back. Review 3 APPROVE with P2 (36px checkbox target), repaired; review 4 APPROVE. Reports in
`.pi/tasks/t097/review/`.
Evidence lesson: `scripts/test-backend-isolated.mjs --browser` tests the prebuilt image
`geraiexpress:audit-local` and does not build it. The first "48 passed" ran a pre-T-097 image and was
withdrawn in the ledger; the image must be rebuilt after every `src/` change before browser evidence
counts (`.pi/tasks/t097/*stale-image*` logs are not evidence). Test-harness fix: `freshAdminCode`
extends the test once by its TOTP-step wait, like the sign-in budget wait.
Known, not changed: the Konfigurasi page has pre-existing sub-44px links (source/date) from T-091.
Next queue: T-093 → T-094 → T-096 → T-095 → legacy native `<select>` to shadcn.

## Handoff — paused by owner (2026-11-04)

Last closed task: **T-092** (`RUN-20261103T151534Z-fdd8ce09`, PASS, final re-review APPROVE).
All session work is committed on branch `feat/counter-ops-2026-11` (7 commits `48221d4`..`a01b27e`)
and pushed to `origin` (repository is now **public**; gitleaks: 0 findings in the new commits; only
pre-existing test fixtures on `main`). Not merged to `main`, not deployed. No active delivery run.
GeraiExpress dev server (port 3100) and background jobs stopped at pause.

Next queue when resuming (same rule: implement → full verification → independent review → repair →
close → commit/push): (1) replace hand-written controls from T-091/T-092 with shadcn `Input`,
`Checkbox`, `Select`; (2) T-093 Super Admin customer data (DEC-024, capability `customer_data_review`);
(3) T-094 sender address; (4) T-096 gerai logo upload; (5) T-095 resi formats 10x15 (10x10 + 10x5 slip:
gerai logo/name | courier, barcode, resi number) and 10x10, locked at first print; (6) legacy native
`<select>` controls to shadcn. Owner working rule (2026-11-04): decisions → apply the best
recommendation and record it as assistant-recommended; risky/binding items → build behind a gate or
defer. Authenticated Mengantar calls, live orders and deploy still need explicit approval.

## Previous — T-092 Super Admin monitoring (2026-11-03, PASS)

T-091 closed PASS (re-review APPROVE). Run `RUN-20261103T151534Z-fdd8ce09`: forward migration
`20261103130000_platform_monitoring.sql` adds read-only RPCs `platform_overview()`,
`platform_tenant_directory(q, lifecycle, limit, offset)` and `platform_tenant_summary(tenant)` for
`platform_monitoring` or `tenant_governance` (aggregates only, demo excluded, LIKE wildcards escaped).
`/admin` now shows a platform summary (active gerai, today's shipments/resi, unknown, awaiting payment,
queued/in-flight, failed), a searchable/filterable/paged directory with readiness and 30-day activity,
and `/admin/tenant/[id]` an activity, state and cabang/pickup summary. Monitoring-only admins see these
without lifecycle/registration/masking controls; their landing moved from Audit to `/admin`. Focused
DB 33/33. Focused browser runs showed two intermittent hangs under load (a sign-in button and a save
staying pending); immediate reruns passed 6/6 twice. Logs are kept in `.pi/tasks/t092/`; this is
recorded, not hidden by retries.
First review (075da8e3) CHANGES REQUIRED: overview 'created' counted older shipments issued today;
tiles had no drill-down; monitoring-only admins could not see pending applications. Repaired:
created filtered by WIB creation day, every tile links to `/admin?perhatian=…` (directory narrowed by
`p_attention`) or the status filter, and a read-only pending-applications tile (linked only with
tenant_governance), with DB and e2e regressions.
Root cause of the intermittent sign-in hang (3 occurrences): the e2e sign-in waits for a token from the
real Cloudflare Turnstile script (test site key, live network); when it is late the Masuk button stays
aria-disabled and the 30 s test times out. Third-party/network dependency in the test environment,
already in the T-059 sign-in-timeout class; not a T-092 defect. Logs kept as
`.pi/tasks/t092/browser-turnstile-signin-flake.*`. After a third occurrence the e2e fixtures now serve a local Turnstile stand-in (test infrastructure only; the stack under test already disables server CAPTCHA). A separate WIB-midnight flake in the discount spec is recorded under T-059.
The next full run surfaced two test-harness defects, now fixed in tests only: the F3 grant
revoke/restore used try/finally inside a body that could time out, so a timed-out test left
`tenant_invitations_list` revoked and broke later member specs (restore moved to `afterEach` with
`lock_timeout`); and `signIn` could meet the server's per-account sign-in budget before its
client-side window expected it (it now recognizes the named refusal, waits one window and retries
once). Logs: `.pi/tasks/t092/browser-f3-grant-leak.*`, `e2e-f3-fix-focused*.log`.
Re-review 94f918c8 found the stand-in's `reset` was a no-op, so a same-page retry after a failed
sign-in would stay disabled (auth-demo rate-limit specs, outside the selected suite). Fixed: the
stand-in tracks widgets and reissues a token on reset; auth-demo now runs in the T-092 browser
receipt (focused: 42 passed / 2 skipped at 390+1280).
The clipboard spec then timed out only after earlier specs had signed in owner-a nine times: the
helper's client-side budget wait (up to 61 s) ran inside a 30 s test. The wait now extends that test's
timeout; the shipping spec passes 35/35 on mobile-390 (`e2e-clipboard-budget-wait.log` is the
reproduction).
An interrupted session left disposable test containers on port 18080 (removed after confirming
their runner was gone). `platform-decisions` beforeAll then reached /admin but exceeded its 30 s hook
budget (admin-2 budget/TOTP waits after the new admin specs); the hook now has an explicit 150 s budget.
Re-review (3701a6a0) CHANGES REQUIRED: monitoring-only pending tile had no list; search dropped
the attention filter. Repaired: read-only `platform_pending_applications()` (business/outlet name,
area, submitted time, revision; no contact data or review action) at `/admin/pantau-pengajuan`, and the
search form keeps `perhatian`; DB and e2e regressions.

## Previous — T-091 Super Admin Konfigurasi (2026-11-03, PASS)

T-090 (DEC-024 docs) closed PASS after a provenance repair. Run `RUN-20261103T142255Z-9ce2f764`
adds `/admin/konfigurasi` (menu "Konfigurasi", visible with tenant_governance or
integration_operations): current declaration text + history and append (tenant_governance), every
billable-weight/cargo rule version with current/scheduled flags and per-service append
(integration_operations), each behind a confirmation with a required reason (audit). New read RPC
`platform_billable_weight_rules()` in forward migration `20261103120000_platform_configuration.sql`.
Focused DB 43/43 and e2e 6/6 at 390/1280 passed; full verification and review pending.

## Previous — owner decisions DEC-024 and next queue (2026-11-03)

T-089 closed PASS (re-review APPROVE). DEC-024 records the owner's Super Admin selections (full
oversight incl. customer data; monitoring only; one gerai = one cabang) and, labelled separately,
assistant-proposed safeguards (separate audited capability) and an unconfirmed counsel implication and the queue T-091 configuration → T-092 monitoring/directory/per-gerai → T-093 customer
data → T-094 sender address → T-095 resi formats (pending owner answers). Correction: DEC-012 records
Partner ID `ongkirich` as GeraiExpress's own Partner account, so the sandbox Partner credential the
owner supplied belongs to GeraiExpress; the earlier "99ribu" attribution referred to the 3099 preview
URL only. Authenticated sandbox use still needs an explicit go-ahead per call class.

## Previous — T-089 UI/UX audit fixes (2026-11-03, PASS)

Owner asked to continue with UI/UX, menus, Super Admin and Admin Gerai. A read-only source audit
(`docs/review/2026-11-03-uiux-admin-audit.md`) found no P0, 2 P1 and 8 P2. Run
`RUN-20261103T132554Z-e20e30af` fixes F1 (chosen service kept across contact search), F2 (no "pay in
Mengantar" hint on overview tiles), F3 (load-error state instead of empty/default on Anggota,
Integrasi, Diskon detail, Pengaturan), F4 (integration-only Super Admin lands on Integrasi), F6
(mobile menu scrolls), F7 (cached contact address works), F8 (tile says "Dibuat & terbit hari ini"),
F9 (cargo exclusions named; one summary for below-minimum), F10 (confirmation before "Kirim
sekarang") and G2 (audit labels/filters for declaration-text and weight-rule versions). F5 was fixed
inside T-081. New e2e `tests/e2e/uiux-audit.spec.ts` failed on the previous image and passes on the
rebuilt one (logs in `.pi/tasks/t089/`). Owner decisions remain: G1 Super Admin editor for
declaration/weight rules, G3 monitoring-only workspace, G4 fuller tenant directory/detail.

## Previous — T-081 content declaration (2026-11-03, PASS)

Next task after the non-COD cargo run closed PASS. Bounded R3 run `RUN-20261103T124731Z-215400e6`.
Forward migration `20261103110000_content_declaration.sql`: append-only declaration texts (v1 seeded
with Permenkomdigi 8/2025 Pasal 22(3) categories verified verbatim from JDIH Komdigi; acknowledgement
wording provisional until the Mengantar sync), platform-only append, and `confirm_shipment` with
`p_declaration_version` (old signature dropped) that refuses a blank description or non-current
version and freezes version/member/time. The confirm dialog shows a checkbox, the body and an
expandable category list; refusal is named in Bahasa; detail shows the frozen declaration.
First independent review (157a1d98) returned CHANGES REQUIRED: the detail collapsed other confirmers to
"anggota gerai". Repair freezes the confirmer email at confirmation and shows it to other members, with
DB and e2e two-member regressions; audit finding F5 (required state, disabled confirm without text) is
folded in. Fresh verification and re-review are required before closing.
Verification and independent review belong to the run.

## Previous — T-080 non-COD cargo activation (2026-11-03, PASS)

Owner asked to adjust non-COD cargo, then review/audit/develop the remaining points, re-reviewing
each task before the next. Bounded R3 run `RUN-20261103T122618Z-12425328`.

Implemented: forward migration `20261103100000_cargo_noncod.sql` (quote `service_class`, a table
check that cargo is never COD, sourced cargo min/max versions JNE 10–30, SiCepat 10–50, iDexpress
10–70 kg from help 5502313; SAP cargo kept excluded for region-dependent minimums); live quoting now
requests regular plus non-COD cargo (`quoteServices`), stores cargo as service `Kargo` only when the
provider route minimum equals the rule; confirmation refuses cargo COD and freezes `service_class`;
dispatch sends base courier + `orders[].cargo`; reconciliation refuses to settle with an order of the
other service (`service_mismatch`, Bahasa copy added). Applied migrations are unchanged.

Not claimed: live sandbox cargo order acceptance (account attribution unresolved), cargo COD, SAP
cargo, provider reweigh (T-045). Verification and independent review results belong to this run.

## Previous focus — T-080 cargo transport implementation (2026-11-03)

Owner renewed implementation authorization after the public research, while requesting a
separate GeraiExpress dev server. Current bounded R3 run:
`RUN-20261103T114322Z-9ac39bc7`. Seven transport/test/fixture files prepared in the
existing `feat/t-080` worktree are now integrated. Main typecheck and the full unit suite
passed (**59 files / 1004 tests**). Final independent review/digest acceptance must bind
the unchanged surface in that run; this summary is not an approval.
The implementation is an
explicit non-COD transport capability and service-identity hardening, not cargo activation.
No UI, database schema, historical migration or credential binding is changed by this slice.
The first focused run passed82/83; its one failure was the old exact-shape read-back
expectation missing the newly retained `cargo: false`. That assertion now explicitly
checks false rather than removing mode metadata; typecheck did not run after that failed
suite. Final main `GX_TEST_ENV_FILE=/dev/null pnpm typecheck` and `pnpm test:unit`
checks actually exited0, with local test-env loading disabled and source unchanged during
execution. Fresh main LSP also reported zero diagnostics across all five edited TS files.
Both the initial red suite and focused failure are retained under `.pi/tasks/cargo-transport/`;
final logs are `typecheck.log` and `unit.log`. No build, DB suite, E2E or new UI proof is
claimed for this transport-only slice; the earlier regular-slice evidence remains historical.

Closeout freshness: the first finish attempt was denied because the mandatory direct-record
checks became stale after docs/runtime artifacts changed, not because tests failed. Direct
pass logs are preserved in `pre-receipt-pass/`. An isolated byte-identical copy of the
already-reviewed T-080 receipt runner and its two regression methods now lives in
`.pi/tasks/cargo-transport/`. Fresh execution `b9fc7fadb` exited0 after actually rerunning
both commands: typecheck PASS and **59 files / 1004 unit tests PASS**, with identical
before/after product/test/foundation manifests. Final JSON receipts/logs are in that folder;
closeout requires executable grading of those completed commands on the final source.
Grading does not claim to rerun a suite; final docs/runtime artifacts
remain bound separately by traceability and a new independent final-digest approval.
The original regular-slice receipts are untouched; the denied attempt is not hidden.

The regular workflow still requests regular services only. Cargo parsing is opt-in, requires
explicit cargo prices and a positive route minimum, and never borrows generic regular
net/discount fields. All cargo COD is blocked pending verified fee semantics. Creation
uses the base courier and an item-level Boolean flag; missing/wrong cargo echo or unreadable/
contradictory cargo price leaves the original operation unknown, without retry. Read-back
preserves known mode and leaves absent/unreadable mode unknown. Grouping keeps courier plus
service class separate and rejects a route minimum inconsistent with its verified rule.

Credential/account attribution from the latest owner correction remains unresolved; no
credential is used or rebound based on an env-variable name. No authenticated provider call,
seller registration, order, payment, rotation or existing-database operation is authorized
by this offline implementation. Before cargo activation, verify the GeraiExpress account,
sandbox route/order behavior, forward limit correction, server/Data API snapshots and
end-to-end UI/dispatch/reconciliation. Full T-080 stays open; no live cargo support is claimed.

GeraiExpress dev is running at the private tailnet address (port 3100), verified by native browser title
and public-page snapshot. Port3099 belongs to the separate 99ribu checkout; that server is
untouched. The dev start did not regenerate env files, migrate/reset a database or inject
provider credentials. Public landing-page readiness is not authenticated workflow proof.

## Approved public cargo research baseline (2026-11-03)

Owner requested cargo analysis, external research and API study before implementation.
Bounded research run: `RUN-20261103T104120Z-26594853`, T-080 / PR-43,
declared R2 and classified effective R3 by the change boundary;
no new application/migration code or authenticated call is part of this slice. The review
header above describes the verified regular baseline, not cargo approval.

Fresh official docs confirm cargo uses the base courier plus `orders[].cargo: true`.
Four unauthenticated public tariff GETs expose `minimumWeightCargo` and cargo-specific
price fields. Official help distinguishes JTR/Gokil/IDX minimum/maximum pairs from SAP's
regional minima; the historical cargo range interpretation needs a forward correction,
not a migration rewrite. Public COD replies also show a one-rupiah disagreement between
generic `codFee` and cargo total-minus-tariff. No guessed tolerance, fixed fee, universal
cargo cap or account discount is accepted from this research.

Findings, public response snapshots and implementation impact are in
[the cargo follow-up](docs/research/geraiexpress-mengantar-public-api.md#cargo-follow-up--public-contract-and-read-only-probes-2026-11-03-t-080).
This completed research slice did not authorize implementation or activation. The owner
subsequently authorized the offline transport slice above; activation still requires approval
for sandbox credential use,
bounded seller estimates/pickup-reference checks and at most one supported synthetic
non-COD cargo order plus read-back. No production account/key, payment, top-up, delete
or blind replay. Cargo remains disabled and full T-080 stays open. This is an approval
boundary, not a claim that the sandbox or cargo order contract has been exercised.

## Verified regular-service baseline (2026-11-03)

Owner approved integrating and verifying **regular services only**, with cargo disabled
and full T-080 remaining open until route-specific cargo minima/order support are verified.
TASKS.md remains the sole work queue. No subsequent task starts before this bounded slice
has verification, independent review, repairs/rechecks and canonical-document closeout.

Current bounded R3 run: `RUN-20261103T085327Z-57f4e09f`, T-080 / PR-43.
The existing `feat/t-080` source has been integrated without copying its pre-existing
research/specification baseline over the parent tree. The original forward migration is
preserved byte-for-byte; no historical migration was rewritten. DATA-14 now states the
implemented heavier-raw-weight rounding and exact-actual fallback explicitly. Sub-kg
values retain positive integer-gram precision without invented minimums or half-fares.

Initial independent review `d264fdd1-6723-4373-8d56-67733f212566` found no concrete
correctness/security defect in the approved regular path. Its two behavioral coverage gaps
were addressed with disposable-DB/offline-dispatch scenarios: legacy NULL-weight quote
confirmation, and effective rule A → B / future C selection while A remains frozen through
dispatch. Corrected final execution `ba24c71f4` passed typecheck; **58 files / 961 unit
checks**; **30 files / 444 disposable DB checks**; the secret-free Docker build/bundle
scan; and **85 browser checks / 1 intentional skip** across 390/1280 px, including
readiness outage/recovery. Product/test/foundation source stayed unchanged during every
check. These are local/synthetic-provider results, not live provider pricing proof.

Two added DB fixture defects were fixed without changing application/migration code.
Follow-up review gave the weight additions bounded visual PASS, and caught two receipt
grader defects (optimized Python bypass and omitted foundation SQL). Both were reproduced,
fixed, regression-tested and independently reviewed with no remaining issues. Final
commands were then re-executed with the corrected grader; old-runner passes and failures
remain preserved separately. Final ledger checks grade completed commands by their real
exit codes, command/log/runner hashes and unchanged source manifests; they do not claim
to rerun those suites. Final docs and all runtime artifacts are bound separately by the
delivery surface and fresh traceability. Four final captures with hashes/dimensions are
retained under `.pi/tasks/t080-verification/visual-final/`. Full boundary review and its
matching approval must be present in the run before PASS; this paragraph is not a
substitute for that gate. See [the T-080 report](docs/review/2026-11-02-t080-implementation-review.md).

The earlier [cross-project review](docs/review/2026-11-02-cross-project-improvement-review.md)
closed its bounded T-037 documentation run `RUN-20261102T204950Z-70286b58` **PASS**, with
final digest-bound independent approval. Its 6 files / 115 offline Geraicuan tests are
reference evidence, not GeraiExpress runtime or release proof. The stale T-054 envelope
was closed **BLOCKED** for a captured HEAD mismatch, preserving historical evidence.
Full T-037, full T-080, provider/counsel gates and release gates remain open. No commit,
push, deployment, live provider request, real customer data or existing DB access is
part of this integration. Other dirty research/specification edits remain preserved.

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
