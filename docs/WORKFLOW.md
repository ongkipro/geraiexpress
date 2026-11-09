# GeraiExpress — Working Agreement (any device, any agent)

This is the repository's own procedure for changing code and proving it. It is device-independent. It does not replace
[AGENTS.md](../AGENTS.md) (repository rules), [STATUS.md](../STATUS.md) (current state and evidence) or
[TASKS.md](../TASKS.md) (the only work queue). Machine-specific facts (paths, ports, lock names, model routing) belong
in the device's own local profile, never here. Orientation first: [SYSTEM-MAP.md](SYSTEM-MAP.md).

## 1. Start a session

1. `git status` and `git log --oneline -5`; read the top block of `STATUS.md` and the task in `TASKS.md`.
2. Disk and executable checks beat prose. If a document disagrees with the code, fix the document in the same change.
3. Next.js here is not the version you remember: read `node_modules/next/dist/docs/` before writing framework code.
4. Never print or commit secrets. `.env.local`, `.env.container` and `infra/dev/*.env` are device-local; create them from
   `.env.example` and `infra/env/*.env.example`.

## 2. Language and style

- Documentation, code, comments and commit messages: English. Product UI and user-facing errors: Bahasa Indonesia.
- Commits are plain messages, no AI attribution trailer, noreply author. Stage only the files your task touched and read
  the staged diff before committing. Never `commit --amend` or force-push a published branch; amend only an unpushed
  commit that is yours.

## 3. Change discipline

- One task, one requirement. Reuse before adding; no speculative abstractions.
- **Migrations are forward-only.** Never edit a migration that any remote or deployed database has seen. A local,
  never-pushed migration may be corrected in place only after `git branch -r --contains <sha>` shows no remote holds it.
  Every new function goes into the right list of `tests/db/privileges.test.ts`; `EXPECTED_SCHEMA_VERSION` in
  `src/lib/schema-version.ts` must equal the newest migration file (a unit test enforces it).
- **Money:** unknown is not zero; apply COD and insurance exactly once; never import a historical fee as a default.
- **Provider calls:** write-ahead, then send, then record; an unknown result is read back, never replayed. A credential
  is resolved through the original operation's fence, not the tenant's current key.
- **Tenant scope:** a Server Action that takes an id verifies it belongs to the selected gerai before any RPC.
- **Every Server Action submit** uses `SubmitButton` (pending label, duplicate-click guard); destructive or money actions
  confirm in the shared dialog. `tests/unit/submit-button-usage.test.ts` pins this.
- Labels, errors and dialogs are Bahasa Indonesia with accessible names; UI work needs rendered evidence at 390, 768
  and 1280.

## 4. Verification ladder

| When | Run |
|---|---|
| Every change | `pnpm typecheck` and the focused unit file |
| DB or migration change | `node scripts/test-backend-isolated.mjs tests/db/<file>.test.ts` (use the full path; a bare word is treated as a pattern and also matches e2e specs) |
| New assertion | one cheap mutation that makes it fail, then revert |
| UI change | the focused e2e spec at 390 and 1280, and look at the screenshot |
| A milestone or release boundary | ONE full integrated run (below) |

`node scripts/test-backend-isolated.mjs --upgrade` proves the upgrade path on an older database;
`--browser --project=...` runs the e2e against the production image after `docker build`.

## 5. Integrated run (milestone gate)

1. Clean tracked tree, on the branch being released. Start a ledger run with the checks you declare up front
   (`delivery-ledger start ... --require-check typecheck --require-check unit --require-check db --require-check upgrade
   --require-check e2e`).
2. Run the gates **sequentially and fail-fast**: typecheck, unit, db, upgrade, full e2e on the three viewports,
   diff-hygiene, then `delivery-ledger check-boundary`. A later gate is reported NOT RUN, never PASS, after a failure.
3. **Read the gate result, not the exit code of the recording command.** A runner that checks only the exit of
   `delivery-ledger record` keeps going after a failed gate. Treat a gate as passed only when the ledger prints
   `RECORDED <gate>=PASS`.
4. Evidence goes to a fresh, immutable directory per run. Never overwrite a previous run's logs, never relabel
   evidence from another head, and record the real worker model, not a hard-coded label.
5. A run that fails is closed `FAIL` with the cause. Fix, then start a new run. A worker's own run that could not be
   proven is closed `BLOCKED`, never `PASS`. `finish` accepts only PASS, FAIL or BLOCKED.
6. Record the result in `STATUS.md` and `BUILD-LOG.md` after the gates, say plainly which commits were not themselves
   tested, then `delivery-ledger verify` (its exit code, not its summary text).
7. Do not edit `.delivery/runs/*.jsonl` or `.delivery/releases/*.json` by hand; their hashes are verified.

## 6. Review

- R3 and R4 changes (money, provider dispatch, auth, tenant isolation, migrations) need an independent read-only review
  by a different model than the implementer. Give the reviewer a diff artifact for the range; reviewers may not run git.
  A review that REJECTs is answered with fixes and a re-review of the delta, not an argument.
- A fix wave records which findings it fixed, which it skipped and why. Loosened test assertions are called out and
  justified, not hidden.
- Known gaps are written down in `STATUS.md`, not left implicit.

## 7. Parallel work (agents and worktrees)

- One writer per worktree. Create worktrees from a clean committed head
  (`git worktree add -b <branch> <path> <sha>`); the main tree must be clean before an automatic worktree admission.
- Give parallel writers disjoint paths and **different test locks**; two workers queued on one lock starve each other
  and time out. Brief every worker with a time box and "commit per item" so a timeout does not lose work.
- The integrating session owns the merge, the integrated run and the final claim. Verify a worker's claims on disk
  (counts, commands, exit codes) before repeating them.
- Throwaway helper scripts live outside the tree or are deleted before merging.

## 8. Publishing

- Push only when asked, only from a green head, only fast-forward. Before a push check the range for secrets, AI
  trailers, temporary files and a non-noreply author.
- A push to a branch that deploys, a deploy, DNS, a provider call with real credentials, or a destructive database
  action needs explicit approval for that exact action.

## 9. Known traps (each cost real time)

- A seed that reuses a unique value becomes a test defect the moment a unique index exists: give each seeded row its own.
- A shell-quoted nested template literal can produce a valid but wrong SQL string (`'${x}'` left unexpanded): print the
  generated statement for each branch before running an e2e.
- `tsc` does not catch a wrongly quoted literal inside a string.
- A docs-only edit that adds counts goes stale at the next migration or test; point to `STATUS.md` for current numbers.
- Screenshots and Mermaid: render the diagrams you edit (`mmdc` needs a Chrome executable; point it at an installed
  Chrome rather than downloading one).
