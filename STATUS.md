# GeraiExpress — Status

Updated: 2026-11-05
Status: Active
State: INTEGRATING
Review-Risk: R3
Primary-Worker: pi-parent-01a1a300
Independent-Review: wave 3 source runs T-084, T-086, T-087 and T-102 closed PASS after independent GPT-6.1 Sol R3 digest approvals (T-084 9f57d07f, T-086 a997d52b, T-087 6866779d, T-102 3f723e5f). This does not close provider, legal or release gates.
Independent-Reviewer: separate reviewer per run (T-084 9f57d07f, T-086 a997d52b, T-087 6866779d, T-102 3f723e5f)
Independent-Review-Head: merges 3202184 (T-102), b16edc6 (T-084), 35f3f13 (T-087), 844f2ca (T-086) on feat/counter-ops-2026-11; this handoff is a separate docs-only run.

## CHECKPOINT 2026-11-05 ~23:55 WIB (machine maintenance; session may be force-closed)

> **M1 CONTRACT (supervisor, 2026-11-06; do not forget):** T-109 and T-110 are integrated under BLOCKED/pending
> runs; their e2e evidence is the single full e2e on the M1 head. If that e2e is not green, the M1 head must not be
> pushed and the failing change is reverted on the branch. No e2e PASS is recorded from the isolate run (it is
> `e2e-isolate` only). Recorded verbatim in the INT-M1 ledger job by `.gx-wt/gx-integration.sh`.
> **M1 push gate (supervisor #2):** exactly one push for M1, only after (a) INT-M1 records typecheck, unit, db,
> upgrade and the full e2e, each fresh on the M1 head, all PASS, and (b) the GPT reviews of T-110, T-055 and T-107
> are APPROVE (T-110 8cd4182a APPROVE, T-055 ab03c9bb APPROVE, T-107 first review `30401488` started 2026-11-06).
> T-107 review `30401488` REQUEST_CHANGES (P1 pending lost when the confirm dialog closes/reopens; P1 pricing and
> logo raw submits exempted; P2 usage test per file, missed variants) -> fixed in .gx-wt/T-107 (trigger disabled +
> aria-busy from pending held outside the dialog; SubmitButton `pending` prop for form= buttons; per-button test with
> 8/6 negative/positive fixtures; members.spec held-request regression); unit 1365 PASS, typecheck clean; round 2
> `27416f90` REQUEST_CHANGES (P1 account-menu raw submit exempted; P2 expression action + method=get, spacing) ->
> fixed (menu item renders SubmitButton; exemption removed; expression actions checked first; 2 new negative
> fixtures); round 3 of 3 sent. Related specs for T-107 now also a11y, workspace-states, gerai-discount, gerai-logo.
> Carry patch regenerated (30 files). Round 3 `1b49a7cb` APPROVE (cx/gpt-6.1-sol). T-107 review gate met.
> T-110c (carried onto `075cc85`, run in .gx-wt/T-110c): typecheck/unit PASS; db and upgrade FAIL in exactly one
> test (608/609), the round-2 lock-boundary regression: 55P03 lock timeout. Real interaction, not flake: T-109's
> service_role lock_timeout 10 s counts advisory-lock waits; the test held the lock ~15 s. Product side is correct
> (RPC error = denial, fail closed). Test-only fix: wait <= ~5 s across the boundary. Gates r2 `b29f726f1`; review
> round 3 (final) `c4340bd0` APPROVE (schema version 200000, allowlist merge verified).
> Not part of M1: T-112 (label page null quote id, TASKS.md), fixed after M1 lands.

**Resume 2026-11-06 ~02:50 WIB.** Owner aborted the merge (HEAD `8e3a643`, no MERGE_HEAD). T-109 run
`RUN-20261105T133400Z-73f0fd4b` closed BLOCKED (HEAD moved). T-109b worktree `.gx-wt/T-109b`
(branch `feat/t-109b-db-followups` from `8e3a643`) carries the `b3a6129..0ed9f41` diff, TASKS.md resolved by
keeping T-106 and T-109; run `RUN-20261105T194809Z-14aab50f`, gates `.gx-wt/t109b-gates.sh` (heavy-run),
logs `/data/tmp/t109b/`. T-110 privileges allowlist sort fixed (`platform_mark_restore_check_unknown` before
`platform_masking_acceptance`); gates `.gx-wt/t110-gates.sh` rewritten to heavy-run, log `/data/tmp/t110-gates3.log`.
Gate scripts still on the private flock: t055-final, t107-shots, t111-gates (convert before rerun).
T-111b run `RUN-20261105T163004Z-80cb8a0b` finished PASS, but its proof binds `8e3a643`. Before merging it
(last in order), carry `package.json`/`pnpm-lock.yaml`/doc edits onto the final integrated head in a fresh run
and re-run at least typecheck and unit there (heavy-run); no merge on the `8e3a643` proof (supervisor, 2026-11-06).
Merge rule (supervisor, 2026-11-06): `delivery-ledger finish` runs alone; check that it exited 0 and printed
`FINISHED ... result=PASS`; commit and merge are separate later steps, never chained after finish (cause of the
accidental T-109 merge). One gx gate set at a time; no push until the owner says so.
Review rule (owner, 2026-11-06): every task gets one independent review before `finish`/merge by the `reviewer`
subagent (GPT-6.1 Sol high via settings override; implementer is Opus 5.5). Pass no model; never an Opus reviewer.
Review packet (owner): bounded, not the repo: task contract, the diff or patch path, gate results already run,
and 3-6 specific risks; ask for APPROVE/REQUEST_CHANGES with file:line findings.
Findings (owner): fix each with a regression test, then resume the SAME reviewer run for a focused re-check of
only the changed parts; after 3 rounds without APPROVE, stop and report to the owner.
Review scope (owner): doc-only/notes-only commits need no reviewer; code, migrations, tests and gate scripts do
(the new `.gx-wt/gx-gates.sh` rides in the T-110 review packet).
Gate runner: `.gx-wt/gx-gates.sh <T> <worktree> <logdir> <checks...>` (heavy-run only); t055-final/t107-shots/
t110-gates/t111-gates wrap it. T-055 (9 behind), T-107 (6), T-110 (2) get carried onto the integrated head like T-109b.
T-109b review: reviewer run `64271555` APPROVE + 2 P2 (healthz PGRST202 -> schema_behind with 2 regression
tests; ARCHITECTURE.md:351 diagram); round 2 `2a291531` APPROVE (cx/gpt-6.1-sol high). Full gates rerun after the
fix: task `b02e39811`, log `/data/tmp/t109b-gates2.log`. T-110 carry patch ready: `/data/tmp/t110/t110-carry.patch`.
T-109b gates r2: typecheck/unit PASS; db FAIL 03:04 ("Disposable PostgreSQL did not start", load ~18) and upgrade
FAIL 03:12:26 (`docker network create` during the docker-ce 29.9.3 daemon restart): environmental, no test ran.
Rerun db+upgrade once on the same surface after e2e finishes.
CORRECTION (supervisor): the r2 full e2e is a FAIL, not a pass and not proven flaky: 16 failed / 453 passed / 11
skipped, 03:16-04:04 at load 14-18 after the 03:12 Docker restart. Kinds: URL mismatch 8 (7x sign-in lands back on
/masuk, 1x shipment stays on /pengiriman/baru), element not found 6, not visible 4, text mismatch 3; common shape =
a Server Action / form POST whose answer never applied (save toasts "disimpan" absent, discount stays at version 1,
print count 0, contact save stuck on "Menyimpan…"). Plausible T-109 link to rule out: new role timeouts (anon
5 s / authenticated 15 s statement, 3 s / 5 s lock) cancelling slow statements under load (57014/55P03) where the
UI shows no error. Not yet ruled out: no DB/app container logs were kept for r2. Evidence plan: r3 re-runs the 8
specs at normal load with a read-only log tap on its own containers (`/data/tmp/geraiexpress/t109b-r3-logs/`);
r2 artefacts saved to `/data/tmp/geraiexpress/t109b-r2-results/`. Decision rule: r3 green AND no 57014/55P03 in the
tapped logs -> environmental, recorded with that evidence; any failure or any timeout error -> T-109 regression,
fixed before finish. Either way the full e2e repeats on the M1 integrated head.
Triage step (supervisor #1/#2, 04:35): gerai-discount:196 is NOT a version/fixture bug: fresh tenant per test; the
trace shows the 2nd save POST answered after 4.45 s server wait (4.9 s total) and the 5 s assertion expired ~0.3 s
later, so the old "Versi 1" notice was still shown; why one RPC took 4.45 s is unproven (CPU vs lock wait).
r3 (8 whole specs) cancelled before it ran (it was still waiting for a slot); db/upgrade from r3 PASS stay
recorded. Replaced by `/data/tmp/geraiexpress/t109b-isolate.sh`: the 16 failed tests only, each in its failing
viewport (13 mobile-390, 3 desktop-1280), one heavy-run job with both locks, started only when no other heavy job
holds a slot and load < 6, with server logs + load captured in `/data/tmp/geraiexpress/t109b-isolate/`; recorded
as `e2e-isolate` so the full-run `e2e` FAIL is not overwritten. Reading: fails alone -> real; passes alone ->
order/data or load dependence, to be settled by the M1 full e2e. Runner swapped to the next version (bundle-scan,
e2e-repeat); gx-gates-test PASS.
Order (supervisor #3): isolate-16 result first, then the single full e2e on the integrated head. A partial run
(isolate, rerun, related specs) is never recorded as `e2e`. Consequence: T-109b's declared `e2e` can only turn
PASS from a full run, so T-109 cannot finish PASS on its own run; it closes BLOCKED ("full e2e FAIL r2; settled on
the integrated head") and is merged on the strength of the M1 integration run (full e2e + typecheck/unit/db/upgrade
fresh on the merged head) plus its own typecheck/unit/db/upgrade PASS and the APPROVE reviews.
Integration-first (supervisor, 2026-11-06): per-task gates = typecheck, unit, db, upgrade; no full e2e per task;
UI/HTTP tasks run only related specs via `gx-gates.sh ... e2e-related:<spec,...>` (both locks; spec list is in
the ledger command). One full e2e on the final integrated head. T-109b's full e2e (started before this rule) is
allowed to finish. Fresh T-110/T-055/T-107 runs drop `e2e` from --require-check.
Reviews 2026-11-06: T-055 `6dae5ad5` REQUEST_CHANGES P1 (no enforcement negative control) -> added inline
no-nonce/wrong-nonce/matching-nonce test to tests/e2e/csp.spec.ts; round 2 `ab03c9bb`. T-110 `d4f963b2`
REQUEST_CHANGES: P1 gx-gates.sh masked failures (fixed, rc + `.gx-wt/gx-gates-test.sh` PASS), P2 quota window
clock read before lock (fixed + two-connection DB test), P2 HTTP 429 back-off independent of body (fixed + 3 unit
cases, 16/16); round 2 `8cd4182a`. T-107 visual verdict (8 shots 390/1280): PASS — destructive dialogs readable,
red primary + neutral cancel, focus-safe close button, no overflow; P3 note: confirm labels vary in form
("Cabut undangan" vs "Ya, cabut tautan"/"Ya, batalkan pengajuan"), left as is.
Round 2: T-055 `ab03c9bb` APPROVE; T-110 `8cd4182a` APPROVE (both: gates on the fixed surface still pending).
T-109b full e2e (r2, 03:19-03:54, load up to ~18): 453 passed / 16 failed / 11 skipped across 8 specs; failures
are sign-in landing back on /masuk and a contact save stuck on "Menyimpan…" (POST never answered), mobile-390
heavy, the same specs passing in the other viewport; no 57014/lock-timeout in the log. Treated as load until
proven otherwise: r3 `.gx-wt/t109b-r3.sh` = db + upgrade + re-run of exactly those 8 specs (`e2e-rerun`, both
viewports, recorded as `e2e` with the spec list in the command). Full log kept: `/data/tmp/t109b/e2e-full-r2-16fail.log`.
If any of them fails again at normal load, it is investigated as a T-109 regression (statement timeouts).
Required-check rule (supervisor #3): an `e2e` already declared on a run is never dropped. The existing T-110
(`008542fb`), T-055 (`7d541fde`) and T-107 (`7d6d1885`) runs all declare `e2e` and sit on old bases (b3a6129,
ab3191c, cf98a4a); they close BLOCKED with reason "base moved; carried onto the integrated head" (HEAD must stay
fixed in a run), never PASS without e2e. The fresh carry runs declare: T-110 typecheck/unit/db/upgrade (no UI);
T-055 typecheck/unit + `e2e-related` (csp, auth-demo, customer-data, gerai-logo, platform-not-found specs);
T-107 typecheck/unit + `e2e-related` (the dialog specs: members, tracking-share, registration, contacts). Each
carried TASKS.md entry gets "Verification: focused specs per run; full e2e on the integrated head".
T-109b keeps its declared `e2e`: evidence = full run r2 (453/16/11) + r3 re-run of the 8 failed specs recorded as
`e2e` with the spec list in the command; the finish detail states this, and the integrated-head full e2e repeats it.
Prepared while r3 runs (supervisor #4): carry patches vs each task's own base — `/data/tmp/t110/t110-carry.patch`
(21 files, incl. round-2 fixes), `/data/tmp/t055/t055-carry.patch` (21), `/data/tmp/t107/t107-carry.patch` (28);
dry-run onto `8e3a643`: T-055 clean, T-107/T-110 conflict only in TASKS.md. Overlaps: T-110 vs T-109b in docs +
`tests/db/privileges.test.ts`; T-055 vs T-107 in `tests/e2e/auth-demo.spec.ts`. Reviewer packets and the heavy
queue order: `/data/tmp/gx-packets/` (README.md, queue-plan.md). Runner with `bundle-scan`/`e2e-repeat:` checks
staged as `.gx-wt/gx-gates.next.sh` (swapped in only when no gate is running).
Task chains (supervisor #2): `.gx-wt/gx-task-chain.sh <T-110|T-055|T-107|T-111b>` = one background command per
task: `gx-carry.sh` (close old run BLOCKED, worktree `<T>c` on the current head, fresh run, 3-way carry, TASKS.md
keep-both) -> fix-up (T-110: EXPECTED_SCHEMA_VERSION 20261105200000; T-111: offline pnpm install) -> gates. It
never finishes/commits/merges. Dry-run: T-110 patch on top of T-109 merges clean (privileges allowlist correct).
T-109b: `b5e53ac31` waits for r3, swaps the runner, runs check-boundary, stops ("READY").
After each merged task (owner, 2026-11-06): remove only this terminal's dangling images (the superseded
`geraiexpress:audit-local` IDs, via `docker rmi`; `docker image prune -f` is machine-wide, so not used bare);
`git worktree remove` the task's throwaway worktree (branch stays); new scratch only under `/data/tmp/geraiexpress/`.
Plan (supervisor #2): T-109, T-110, T-055, T-107, T-111b each: typecheck/unit/db/upgrade + GPT review + finish,
merged separately into `feat/counter-ops-2026-11`; then ONE full e2e on the integrated head as evidence for all
(recorded in a docs/integration run). T-109b's running full e2e, if green, stays T-109's evidence (not killed).
Stop point: after T-109, T-110 and T-055 are merged, STOP and report to the owner (merged hashes, remaining
queue, what a push of `feat/counter-ops-2026-11` would contain: `git log origin/feat/counter-ops-2026-11..HEAD`).
After each merge: append one line below (task, merge hash, gates, review) and refresh `/data/tmp/gx-resume/`.

Queue mode (owner, 2026-11-06): run T-109, T-110, T-055, T-107, T-111b, then the next open TASKS.md items end to
end without stopping; stop only for push/deploy, production write, deleting non-test data, a secret, or a
user-visible product decision. Local commits use the noreply identity, no AI trailers.

Open for the owner (batched; reported at a real blocker or end of queue):
- RESOLVED: push of `feat/counter-ops-2026-11` (owner "commit dan push jika perlu"): M1 f89f3ed and M2 4d86c48 pushed
  after verified integration runs; merge to `main` and production deploy stay forbidden until you say so.
- RESOLVED: T-110 re-review by the standing `reviewer` (GPT-6.1 Sol), APPROVE after 3 rounds.
- T-063 production mail: sending domain decided by the owner (2026-11-06): geraiexpress.com. Still open: the provider
  (SMTP or a named HTTPS API) and the from address (proposed no-reply@geraiexpress.com); DNS SPF/DKIM/DMARC and provider
  credentials are owner actions. Code side is ready to add one
  provider-neutral SMTP transport behind MAIL_TRANSPORT that stays disabled until configured; production fails closed
  today. The task's "Send Email Hook / signature" clause is obsolete (hook removed with T-062) and should be dropped.
- T-059 asks for a CI repeat of the DB suite in `.github/workflows`; this repo has no CI. Decide: add GitHub Actions
  CI (separate setup, runner and secrets policy), or restate T-059 as a repeated local isolated-suite proof.
- T-043 pickup and T-080 cargo: supervised Mengantar sandbox runs (T-048) needed for the real `POST/GET /time`
  shapes and cargo route minima; T-045 webhooks need the seller-side Webhook URL. All need your sandbox approval.
- T-037: its release checks name `smoke:worker` (Worker runtime, replaced by the container in T-062); restate to
  `smoke:container` and the INT-M runs, then it can close against a release candidate.
- Housekeeping you may run: `/data/tmp/gx-cleanup-owner.sh` (~1.4 GB of ignored build/test output and a merged
  worktree's node_modules); `git prune` for the gc.log warning; stashes `t111`, `t105-wip` already applied.

Push (owner "commit dan push jika perlu", via supervisor, 2026-11-06): only `feat/counter-ops-2026-11`. Checked:
upstream origin/feat/counter-ops-2026-11; remote heads are only that branch and `main`; no `.github/` workflows;
RELEASE.md Status NOT_RELEASED, no Node container deployed, Coolify not provisioned, so a feature-branch push
deploys nothing. Pushed `e87e10a..8e3a643` (T-104, T-108, T-105, T-106; noreply identity, no AI trailers).
Push rule (supervisor #2): push only a verified integrated head, once per milestone: M1 = T-109 + T-110, M2 = T-055 +
T-107 + T-111b. Per milestone: merges -> docs-only handoff commit -> `.gx-wt/gx-integration.sh INT-M<n>` (fresh
main-repo ledger run on that exact head: typecheck, unit, db, upgrade, ONE full e2e, both viewports) -> finish PASS
-> commit nothing further -> push. No push mid-chain or on stale evidence; the `8e3a643` push above was before this
rule (its tasks each carried their own executed gates + e2e on their runs).
Forbidden until the owner says so explicitly: merging into `main`, any production deploy. Push = plain, never force.
Merge log (2026-11-06, `feat/counter-ops-2026-11`; pushed through `8e3a643`):
- T-109: commit `46911cb`, merge `075cc85` (unpushed; M1; INTERIM integration state under the M1 contract above,
  not T-109's final proof). Run `RUN-20261105T194809Z-14aab50f` BLOCKED by rule:
  typecheck/unit/db/upgrade PASS; full e2e r2 FAIL 16/480 at load 14-18; isolate-16 at load 6-10 17/17 PASS
  (`e2e-isolate`), no 57014/55P03 in tapped DB logs -> environmental (load), not T-109; the full e2e is re-proved
  on the M1 head. Reviews GPT-6.1 Sol 64271555 APPROVE (+2 P2 fixed), 2a291531 APPROVE.
- T-110: commit `517b45a`, merge `ee7aebf` (unpushed; M1; INTERIM under the M1 contract). Run
  `RUN-20261105T220407Z-df4814db` PASS on its own declared checks: typecheck, unit, db 609/609, upgrade 609/609
  (after the test-only lock-boundary fix), review-boundary APPROVED c4340bd0. Docs handoff `a51b9f4` precedes it.
  Next: INT-M1 (`.gx-wt/gx-integration.sh INT-M1`) on the M1 head, then the single M1 push if all green.
- M1 PUSHED `8e3a643..f89f3ed` after INT-M1 #2 `RUN-20261106T001739Z-409d991c` PASS on f89f3ed: typecheck, unit,
  db, upgrade, FULL e2e 469 passed / 0 failed / 11 skipped, diff-hygiene, boundary PASS (M1 contract satisfied).
  INT-M1 #1 `d4e52e0a` had the same green gates but closed BLOCKED: its boundary baseline held 455 untracked .pi/
  harness files (now in .git/info/exclude). Run files recorded in `0f5c243`.
- T-055: commit `85291d8`, merge `12eb37c` (M2). Run `RUN-20261105T234857Z-e19a41ae` PASS: typecheck, unit,
  docker-build, bundle-scan, related specs 84, repeat x4 168. Negative control is parser-inserted ('strict-dynamic'
  trusts DOM-inserted scripts by design; the DOM version failed 10/10 and was replaced). Reviews 6dae5ad5 ->
  ab03c9bb -> 9a28f2e6 APPROVE.
- T-107: commit `aa2b929`, merge `23d4b5f` (M2). Run `RUN-20261106T013933Z-8bb3ed9f` PASS: typecheck, unit,
  related specs 140 (incl. the held-request close/reopen regression); R3 by path (receipt-sheet pending label only;
  auth-demo spec). Reviews 30401488 -> 27416f90 -> 1b49a7cb APPROVE; visual verdict PASS.
- T-111: commit `1004b21`, merge `b3f6975` (M2). Run `RUN-20261106T014950Z-4e7fa208` PASS on the final head
  23d4b5f: offline install, typecheck, unit, docker build stage; review 03ba0d69 APPROVE. Main node_modules
  reinstalled offline from the merged lockfile (lucide-react 1.68.0, postgrest-js 2.119.0).
  Next: INT-M2 (`gx-integration.sh INT-M2`) on the M2 head; single M2 push only on its PASS finish.
- M2 PUSHED `f89f3ed..4d86c48` after INT-M2 `RUN-20261106T015618Z-bbf48404` PASS on 4d86c48: typecheck, unit, db,
  upgrade, FULL e2e 487 passed / 0 failed / 11 skipped, diff-hygiene, boundary PASS (M2 contract satisfied).
- T-112: commit `8c4653b`, merge `7cacd19` (unpushed; next milestone). Run `RUN-20261106T024553Z-8ab86b89` PASS:
  RED check (unfixed page made the gate fail with 70 uuid-null errors), fixed: typecheck, unit, label + gerai-logo 46
  passed, 0 uuid-null errors with the runner's own canary-proven PostgreSQL log (GX_PG_LOG). Reviews d3f33228 ->
  293477a2 -> d88aad39 APPROVE.
- T-058 + T-060 closed: code from 2026-10-28; their open e2e item proven by INT-M2 (390/1280) and
  `RUN-20261106T030530Z-41231083` tablet-768 (29 passed).
- TASKS.md checkbox sync: T-055, T-058, T-060, T-104..T-111 marked [x] with their evidence line.
- M3 PUSHED `4d86c48..ba5e1e4` after INT-M3 `RUN-20261106T031040Z-96b35408` PASS on ba5e1e4: typecheck, unit, db,
  upgrade, FULL e2e on three viewports 721 passed / 0 failed / 26 skipped (249 per viewport), diff-hygiene, boundary.
- T-062 closed on that evidence (every other clause verified by read-only audit 683ee8c9).
- Repository visibility (owner request 2026-11-06 "pastikan repo public"): `ongkipro/geraiexpress` is PUBLIC (gh). Secret
  check before relying on it: no sensitive filename ever committed in 236 commits; no high-signal secret pattern in any
  revision (control repo with two planted fakes: 2/2 caught). gitleaks itself could not run (mise failed to load it).

Current task: integrating the post-wave-3 hardening set (T-104..T-111, T-055) onto
`feat/counter-ops-2026-11`. Remote is at `e87e10a` (T-103). Nothing after that is pushed.

**Repo state needing action first.** `~/Projects/geraiexpress` is IN THE MIDDLE OF A MERGE of
`feat/t-109-db-followups` (conflicts in `TASKS.md` and `.delivery/current.json`, staged T-109 files).
It started by mistake: the T-109 ledger `finish` was refused (typecheck/unit/db/upgrade stale after
late doc edits) but a chained command still committed `0ed9f41` on the T-109 branch and began the merge.
`git merge --abort` is blocked by the safety net and needs the owner. Recommended: owner runs
`git merge --abort` in `~/Projects/geraiexpress` (back to `8e3a643`), then resume below.

Done and merged locally on `feat/counter-ops-2026-11` (local HEAD `8e3a643`, not pushed):
- T-104 DB hardening (`438f449`, merge `cf98a4a`), approval GPT-6.1 Sol fd308ef5; migration `20261105180000`.
- T-108 local fixture (`7ec987d`, merge `425f6b3`), approval 752215bb; applied to local gxdb after backup
  `/data/backups/geraiexpress/gxdb-before-t108-20261105T131303Z.dump` (+ .sha256).
- T-105 backend/ops (`16addcb`, merge `b3a6129`), approval GPT-6.1 Sol cdeef478.
- T-106 cleanup + system map (`b1421fc`, merge `8e3a643`), approval Sonnet 5.5 db2505e3 (README P2
  `tenants/, tracking/` applied in the merge resolution).
- Local gxdb: 63 migrations through `20261105180000` + fixture; backups in `/data/backups/geraiexpress/`.

In flight (worktrees under `~/Projects/.gx-wt/`; background gate scripts may still be running):
- T-055 enforced nonce CSP (`T-055`, run `RUN-20261105T121726Z-7d541fde`): fixes for not-found
  (`force-dynamic` in `src/app/not-found.tsx`) and label/batch workbench readiness markers done;
  recheck 202/202. Final gate `.gx-wt/t055-final.sh` IN PROGRESS, logs `/data/tmp/t055/`
  (`unit.log`, `e2e.log`) and `/data/tmp/t055-final.log`. Then: boundary, independent review, finish.
- T-107 button/UI audit (`T-107`, run `RUN-20261105T143659Z-7d6d1885`): e2e 471/0 PASS before adding
  dialog screenshots; gate `.gx-wt/t107-shots.sh` in progress, logs `/data/tmp/t107/`, `/data/tmp/t107-gates3.log`.
  Then: open `test-results/*/dialog-*-{390,1280}.png`, visual verdict, independent review.
- T-109 DB follow-ups (`T-109`, run `RUN-20261105T133400Z-73f0fd4b`, commit `0ed9f41`): migration
  `20261105190000` (per-role timeouts, `schema_version()` readiness, `machine_rewrap_candidates`, drops
  two dead functions + five `auth.users` columns). All gates passed before the final doc edits
  (unit 1429, DB 594, upgrade 594, e2e 469/0); final-digest APPROVE GPT-6.1 Sol 9fae8647 recorded, but
  `finish` was refused as stale and HEAD has since moved (commit). Expected: close BLOCKED, fresh run
  with `--accept-dirty`/same surface, re-run typecheck/unit/db/upgrade, re-review (doc-only delta), finish, merge.
- T-110 Partner quota + restore fence (`T-110`, run `RUN-20261105T133400Z-008542fb`, migration
  `20261105200000`): Fable review CHANGES_REQUIRED (P1 restore provenance in reconcile + 4 P2) FIXED by
  worker; gate `.gx-wt/t110-gates.sh` re-running, logs `/data/tmp/t110/`, `/data/tmp/t110-gates2.log`.
  Then: Fable re-review, finish. On merge bump `src/lib/schema-version.ts` EXPECTED to `20261105200000`.
- T-111 deps bump on integrated head (`T-111b`, run `RUN-20261105T163004Z-80cb8a0b`): lucide-react 1.68.0,
  postgrest-js 2.119.0; earlier e2e failures were flakes (recheck 84/84). Gate `.gx-wt/t111-gates.sh`
  running, logs `/data/tmp/t111/`, `/data/tmp/t111-gates2.log`. Old `T-111` worktree run closed BLOCKED.

Unverified: T-055/T-107/T-110/T-111b final gates; T-110 DB tests after the P1 fix; real Turnstile under
the enforced CSP (stand-in only); production Partner entitlement (T-110 limits are placeholders).

Open decisions for the owner: (1) `git merge --abort` in the main repo (above); (2) commit of the
dotfiles `delivery-ledger` fix (expansions follow the latest verification; boundary FAIL on a latest
FAIL; 2 regression tests + mutation proof, suite PASS) — not committed; (3) `git prune`/gc.log warning
in the main repo; (4) stashes left in `.gx-wt/T-105` (`t105-wip`) and `.gx-wt/T-111` (`t111`), already applied.

Resume commands:
- `cd ~/Projects/geraiexpress && git status` (expect clean at `8e3a643` after the owner's abort).
- Gate logs: `tail /data/tmp/{t055-final,t107-gates3,t110-gates2,t111-gates2}.log`.
- Ledger per worktree: `cd ~/Projects/.gx-wt/<T> && delivery-ledger status && delivery-ledger check-boundary`.
- After all approvals: merge order T-109, T-110 (bump EXPECTED_SCHEMA_VERSION), T-055, T-107, T-111b;
  integrated gates; docs-only handoff (mark T-104..T-111 and T-055 `[x]`, T-103 Allowed Paths P2); push
  `feat/counter-ops-2026-11` only; backup gxdb then `pnpm db:up` for `190000`/`200000`.

## T-103 Local gxdb reset guard (local tooling)

After the wave 3 push the parent applied migrations 20261105120000–170000 to the local `gxdb` (backup
`/data/backups/geraiexpress/gxdb-before-wave3-20261105T071055Z.dump`, SHA-256 in `.sha256`), then ran
`pnpm db:verify` as a check without reading it; it reset and reseeded `gxdb`. Recovered with owner
approval: drop/create from template0, `pg_restore --single-transaction` of that backup,
`db:restore-check` (38 tables row counts MATCH, 56 migration checksums MATCH), `pnpm db:up` (6 migrations
applied, checksums equal the files), catalogue reload `changed=0` (79,391 rows), PostgREST 200. The
`--reset` path now requires `GX_CONFIRM_RESET=<database>`.
The T-103 full DB gate also exposed a latent test false positive: the net-cost sentinel 13579 matched
`created_at` microseconds as a JSON substring in `tests/db/masked-label.test.ts`. Sentinel checks in
that file and `tests/db/invoice-export.test.ts` now use `containsAmount` (JSON numbers, or digit runs
in strings not adjacent to other digits; timestamp and UUID strings are skipped; unit-tested controls). The first T-103 run closed BLOCKED (the
ledger rejects scope expansions after any historical FAIL; dotfiles follow-up), and a fresh run
carries the same surface. The ledger also reported one boundary PASS while a just-recorded check had
FAILED; that boundary was not used (dotfiles follow-up).

## Wave 3 and T-102: T-084, T-087, T-086, framework upgrade (PASS; integrated, not deployed)

Four worktrees, one passing ledger run each, migrations 20261105150000 (masking acceptance),
20261105160000 (pilot report) and 20261105170000 (return and claim cases); each passed its own gates
and an independent GPT-6.1 Sol R3 digest review. Merged in order T-102 (3202184), T-084 (b16edc6),
T-087 (35f3f13), T-086 (844f2ca); doc, host-matrix, nav and crumb conflicts kept both sides.
- T-102: Next 16.4.5, React 19.3.1, TypeScript 7.0.2, Tailwind 4.3.4, Vitest 5.1.0, Playwright
  1.64.1 and the UI toolchain, exact pins; lucide-react 1.68.0 held by the 24 h release-age policy.
  The first full e2e run (the per-task gates had only run related specs) exposed a pre-existing
  WCAG 2.4.11 failure, proved identical on the pre-upgrade base 05445a2: the intake "Ringkasan
  biaya" sticky bar covered focused fields on mobile; fixed with a shared scroll-padding hook. One
  gerai-logo batch timeout in that run did not reproduce (48/48 on a x3 repeat). The reviewer had
  no network tool, so compatibility rests on packaged exports, usage and the gates, not release notes.
- T-084: review P1 (the "Resi + invoice" masked print path lacked the return-destination note)
  fixed with e2e for unverified, verified and unmasked labels; visual PASS at 390/1280.
- T-087: review P1 (the 390 report was a horizontally scrolled table, UI-7) fixed with record cards;
  the parent moved the breakpoint to `lg` after a 768 screenshot showed the shell still clipped the
  table; visual PASS at 390/768/1280.
- T-086: approved first pass; its P2 (ARCHITECTURE wording on the one-open-case index) fixed here.
Integrated verification on 844f2ca (logs `/data/tmp/wave3/int/`): typecheck, 1,344 unit, 578 full
DB, 578 upgrade-replay DB (full suite, replaying from the schema before migration 20261029130000), environment check, image build,
469 e2e at 390/1280 with the full suite (11 skipped by design), build stage and client bundle scan.
Not done: courier acceptance evidence (T-048), live statuses/return events (T-045), deploy.

## Wave 2: T-095, T-083, T-085 (PASS; integrated, not deployed)

Three parallel worktrees, one passing ledger run each, migrations 20261105120000 (resi format lock),
20261105130000 (cash period close) and 20261105140000 (tracking links); each passed its own gates and
an independent GPT-6.1 Sol R3 digest review before merging in order T-095 (ffbb72f), T-083 (68d0b36),
T-085 (e3d4de9).
- T-095: review P1 (a 40-character AWB clipped on the 10x5 slip) fixed with wrapping/shrinking and a
  maximum-length print regression; visual PASS at 390/1280.
- T-083: parent found raw/duplicate user-id prefixes for staff on /kas in the reviewer's screenshots;
  members now read "Petugas 1 (Anda)" / "Petugas 2" and the close line "oleh Anda"; no UUIDs shown.
- T-085: review found two P1s, both fixed with DB regressions: a member could republish a revoked
  token's hash under a new generation (now a private hash registry; retired hashes never activate),
  and a cross-shipment race between hash check and activation (now an atomic insert-first reservation
  with a locked owner check; two-connection test). Malformed tokens never match; the 404 is one
  constant styled page. The first ledger run closed BLOCKED because `delivery-ledger` refuses any
  historical FAIL for scope-expanded paths even after a later PASS; a fresh run carried the same
  surface. That rule differs from the documented "resolved, not unblemished" policy: a dotfiles
  follow-up, not changed here.
Integrated verification (RUN-20261105T032827Z-a76cd8bc): typecheck, 1,237 unit, 551 full DB,
108 upgrade-replay DB tests over the affected files, 202 e2e at 390/1280 (2 skipped by design),
ledger verify. Logs `/data/tmp/wave2/int/`.

## T-101 Whole-repo review remediation (PASS; committed, not deployed)

Run `RUN-20261104T213403Z-eb091d80` (R3) on `feat/counter-ops-2026-11` after the T-082/T-096/T-100
integration. Three independent read-only reviews (database 58a1c4ad, application/security 7578a80b,
contracts/docs 2890e8da) found six P1 and several P2 issues; the integration handoff run
RUN-20261104T211915Z-75a6e643 was closed BLOCKED before its gates in favour of this run.
- Database, forward migration `20261105110000_review_hardening.sql` (no applied migration edited):
  `service_role` loses its default-privilege access to `counter_payments`/`cash_periods`; the payment ->
  cash-period FK is NO ACTION, so a period with history cannot be deleted alone (owner cascades remain);
  `void_counter_payment` locks the shipment before membership (no inversion with batch authorization);
  `record_live_quotes` skips COD rows with a missing/null fee instead of storing 0; cargo range CHECK
  requires known endpoints; nine required-revision RPCs use `is distinct from` (NULL no longer bypasses).
  Recreated stale guards raise 55000, never 40001 (PostgREST retries 40001; DIL-11). `pg_trgm` + GIN on
  `mengantar_areas.search` with an indexable longest-token predicate (EXPLAIN test).
- Application: single-label print verifies the shipment belongs to the selected tenant and scopes the
  snapshot read; full runtime validation of label Server Action payloads; unknown print outcomes block
  resubmission and offer reload; selecting a recipient without an address clears the old destination;
  the area route limits only live Mengantar fallback (30/60 s per tenant, 429 + Retry-After); payment
  field errors are linked through `aria-describedby`.
- Docs: RELEASE gate 11 (pending migrations, approval-gated `npm run db:areas`, `init: true` recreate),
  OBSERVABILITY (hourly credential rewrap and auth purge; no area-fallback/receipt telemetry yet),
  ARCHITECTURE system map/ER/routes/residuals, PRD/UX/DATA-10/11/14 status, DEC-026 wording, T-092 closed.
- Test fixes found by the gates: unit tests now import through relative paths (no Vitest alias);
  a prefix assertion no longer assumes `TOKO` is free in a shared suite; the T-070 "no print" check
  targets label/resi links, because the T-082 receipt is allowed for confirmed and COD shipments.
Run closed PASS with independent R3 approval c28062b3 (digest 7b0e4018); commit 0fd1be5.
Final executed ledger gates on this surface: typecheck, 1,180 unit, 534 full DB, 176 upgrade-replay
DB tests (12 affected files), 133 e2e at 390/1280 (one desktop-only keyboard test skipped on mobile by
design), diff hygiene. Logs `/data/tmp/t101/`. Not deployed; production migrations and catalogue loads
remain separate approval-gated release steps.
Local dev database (owner-approved 2026-11-05): backups `/data/backups/geraiexpress/gxdb-before-t100-20261104T210931Z.dump`
and `gxdb-before-t101-20261105T004603Z.dump` (SHA-256 files beside them); `pnpm db:up` recreated
`gxdb-postgres-1` with `init: true` (PID 1 `docker-init`, volume kept) and applied the five pending
migrations (56 total). `npm run db:areas` loaded 79,391 areas (`mengantar-2026-10-30-79391`); a repeat
load reported `changed=0`. Member-RPC timings on gxdb: 2-5 ms for postal, kelurahan, kota and
multi-word queries; about 17 ms for the broad `bogor barat` (30 of many matches, sorted).

## T-100 Local Mengantar area catalogue (verified; integrated, not deployed)

Run `RUN-20261104T194904Z-1ff1e869` closed PASS (R3 approval 1ff03b98); commit 172113f, merged 45d7534; not deployed.
Owner request 2026-11-05: kelurahan/kecamatan/kota/kode pos locally, from Mengantar or the owner's
99ribu project. `data/mengantar/areas-2026-10-30.json.gz` is the 99ribu read-only Mengantar
`/address/search` harvest copied unchanged (SHA-256 f1712dc0...2e02, 79,391 rows, Mengantar area ids;
~435 Kepmendagri districts unmatched). Migration `20261105100000` adds `public.mengantar_areas` (no API
table grants) and member-only `search_mengantar_areas` (3-60 chars, 1-30 rows, every word must match;
postal, kelurahan, kecamatan, kota ranking). `npm run db:areas` validates the whole file, upserts in
1,000-row transactions and never deletes. `/api/mengantar/area` reads the catalogue first; only a miss
in a connected non-demo gerai uses the live Mengantar search. Demo intake keeps free-text fields.
Evidence: typecheck, 1,085 unit, focused DB 50 fresh + 50 upgrade (including a real loader run), 4 e2e
at 390/1280 PASS (`/data/tmp/t100/`); screenshots opened; review 7ba0eaff code OK, visual PASS, one P2
architecture inventory contradiction fixed. After review: schema-reload notify and typed-separator
normalisation added (re-verified by the final gates). Loading the dev `gxdb` catalogue is owner-approved
(2026-11-05: "ya lanjutkan masukan ke katalog"); retained/production loads and refreshes still need approval.
## T-096 Gerai logo upload (verified; integrated, not deployed)

Run `RUN-20261104T161806Z-137154a5` closed PASS (R3 approval 708b2380); commit 6740ce0, merged b41b7df; based on T-094 `f020c09`;
T-094 has since merged/pushed as `c91927a` (handoff `db71536`).
Data model (DATA-10) and ARCHITECTURE now record the logo storage, INSERT capture and read path.
Implemented tenant-admin-only versioned logo replacement/removal with optimistic revisions and audit,
server/DB PNG/JPEG/WebP signature and MIME checks, 204,800-byte maximum, private PostgreSQL storage,
scoped individual/batch preview and immutable snapshot logo bytes/revision. Gerai name remains visible
if an unmasked image cannot render. No provider calls, storage service or new dependency were added.
Executed: typecheck PASS, unit 1,036 PASS, full isolated DB 483 PASS. Initial browser gate: 26 PASS,
2 FAIL, both settings corrupt-image feedback. The SSR image could fail before hydration attaches onError;
refs now reconcile complete images with naturalWidth=0 while retaining onError for subsequent failure.
A deterministic delayed-hydration regression and visible synthetic 96x24 logo fixtures were added.
Post-fix typecheck, 1,036 unit and all 30 logo/label browser tests PASS at 390/1280. Logs:
`/data/tmp/t096/{unit-postfix,browser-postfix}.log`; refreshed PNG/PDF captures: `test-results/gerai-logo-*`.
Parent opened narrow settings, narrow 10x10 batch and wide 10x15 batch captures: synthetic GE/GX marks
are visible and contained, name and barcode stay unobscured. Initial evidence remains preserved at
`/data/tmp/t096/render-first/`. Independent source review found no P0-P2 defect before the hydration
repair; bounded source/visual re-review e6f87ba4 reports code OK, visual OK for narrow/wide saved
settings and both batch sizes (including masked reprint), with no reachable P0-P2 defect found.
Runtime and inspected rendering gaps are closed; this is not unconditional task-completion approval.
Owner decision 2026-11-05 ("label paket juga dong") is implemented: masked and unmasked parcels show
the frozen logo or gerai-name fallback; masked parcels still exclude gerai WhatsApp/contact and keep
confirmed sender fields. DEC-017 and PR-34 record the amendment. Delta verification: typecheck,
1,038 unit, 37 focused gerai-logo/privilege DB and 34 browser tests PASS at 390/1280. Logs:
`/data/tmp/t096/masked-{unit,db-focused,browser}.log`. Independent review e32ca8ad opened 12 masked
individual/batch captures and reports code OK, visual OK, no findings. T-095's 10x5 customer slip is not built/proved;
GeraiIdentity and snapshot logo data provide its seam. No physical-printer or courier acceptance proof.

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
Next: T-096 logo → T-095 resi formats; T-084 after T-094 (same label RPCs). T-082 and T-096 are verified local worktree implementations, not merged: owner receipt-content and masked-label branding decisions remain open. T-099 source is integrated; handoff verification follows.

## T-099 DB test lifecycle (source PASS, integrated; not deployed)

Run `RUN-20261104T132445Z-6016ac5f` closed PASS and verified; implementation `8b092c5`, merged as
`209c1c5` into `feat/counter-ops-2026-11`. Both parents' 51 existing run/release paths were preserved,
and delivery-ledger verify passed after conflict resolution. Only STATUS.md and the generated current
projection conflicted; no source conflict or modification occurred. Separate documentation/integration
handoff: `RUN-20261104T174014Z-efb3143a`. Push target is `origin/feat/counter-ops-2026-11`; no deployment
or existing development database recreation is part of this work.
The initial normal-test-only patch was rejected by independent review: blocking fixture SQL, late fixture
continuations and lost container-session ownership remained reachable. The repaired implementation uses
asynchronous optional helper I/O, cancellation-bound fetch, per-test ownership, a durable closed startup
gate, container-side process bounds and independent bounded cleanup. Existing assertions and test budgets
are unchanged. Normal isolated file: 12 PASS; full isolated DB: 470 PASS; typecheck PASS. The added permanent
HTTP transport regression passed 2 tests, proving pre/post-fetch cancellation and no follow-up dispatch,
not server transaction completion. Executed logs and probe instrumentation: `/data/tmp/t099/`.
Forced startup-delay, late-encryption and host-delay probes observed no late backend/fixture; stronger
pre-admission proof additionally observed container resumption and closed-gate exit 125.
Resolved failure evidence: admitted-process proof v2/v3 failed real teardown: initial cleanup psql exits 0, final cleanup psql
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
Final source-bound ledger checks all PASS: typecheck, 6 cancellation/preflight unit tests, 470 full DB
tests, compose validation without environment resolution, diff hygiene, and the guarded-source admitted
proof v6. The latter retains the original intentional 15-second test timeout, successful group kill and
both cleanup exits 0, zero-leak observation for 25 seconds, no delayed resumption, and no PostgreSQL
recovery from the matching kill-request timestamp onward. Evidence: `/data/tmp/t099/final-{unit,db}.log`
and `admitted-connect18-v6-guard-{events.jsonl,driver.log}`. Reviewer 185798e0 independently APPROVED
boundary event e0f4cd7e845648778444a3c6c2185e03 / digest f73c23dfa0b6a6a95138d303ea129aa9fcc66aab0457b16cd27c9ce4cdbef257.
T-099 implementation acceptance is complete. Post-merge typecheck, unit and full DB gates are required
by the separate handoff run; that run's executed evidence records their outcome without changing the
closed source-run surface. Pi runtime artifacts are retained untracked and excluded only through a
temporary Git exclusion file during handoff verification; no user ignore configuration was changed.

## T-082 Counter payment and receipts (verified; integrated, not deployed)

Run `RUN-20261104T132645Z-49fd8a7a` closed PASS (R3 approval decba79d); commit 37314c1, merged ad326cb; not deployed.
Implemented record/void, one active payment, auto-open cash period, COD refusal, admin-only difference
reads, 58/80 mm receipts, WhatsApp text and append-only print history (`label_print_events.kind`).
Owner decision 2026-11-05 ("ya boleh kau sempurnakan", DEC-026): customer receipts and WhatsApp text
show no staff line (internal staff/audit unchanged), add `No. pembayaran` (PAY- + 8 hex) and the frozen
outlet; non-COD identity is frozen at payment, COD identity at the first receipt print. The 5-argument
`record_receipt_print` compares the preview identity and refuses a stale preview (Bahasa reload message,
no `window.print`); reprints copy the first identity. Evidence after DEC-026: typecheck, 1,046 unit,
491 full DB and 24 browser tests at 390/768/1280 PASS (`/data/tmp/t082/receipt-decision-*.log`); review
bbea32fe code PASS and visual PASS on six receipt captures. Combined-migration review 24472b96 found the
T-094 -> T-082 -> T-096 sequence compatible; its P2 (closed cash period accepted a NULL variance) is
fixed in this unmerged migration with a DB regression. Final surface-bound ledger gates and integration
follow; preserve T-094's 7-argument label-snapshot RPC, the `kind = 'label'` history filter and T-099's
cancellable test helpers. Window printing is stubbed; no physical-printer proof exists.

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
