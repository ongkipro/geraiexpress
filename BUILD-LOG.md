# GeraiExpress — Build and Documentation History

## 2026-10-13 — Project documentation promotion and architecture

Owner request: move the existing GeraiExpress documents into the project and
organize its architecture (CTX-38). Created a standalone local Git repository
at ~/Projects/geraiexpress; branch main, no commit, stage, push or remote.

Native project-init promoted 17 staged specification/provenance files into
docs/spec. Two research notes were copied into docs/research. All 19 sources
were hash-checked before repository-only refinements and remain unchanged.
The source Documents copies are retained non-authoritative snapshots under the
planning-artifacts policy. docs/promotion-manifest.json records copy provenance.

Repaired project-local research links and clarified canonical authority. Added
ARCH-4's proposed code layout, system/trust diagram, module import boundaries,
execution paths and deployment ownership. Root ARCHITECTURE.md records only
observed repository components and identifies the unimplemented runtime.
Replaced generic bootstrap none/default placeholders with actual product
constraints in AGENTS, README, STATUS, DECISIONS and queue/release/health records.

Executed document checks:

- Specification validator: PASS, 15 specification Markdown files, 139 declarations,
  zero findings. Including root TASKS.md gives 16 checked files and zero active tasks.
- Independent integrity checks: 19 retained source hashes unchanged, 43 local
  Markdown links resolved, source JSON parsed and standalone Git root confirmed.
- Selected pricing content preserved exactly after the intentional relative-link
  rewrite. No fee, seller-ownership, collection or visual policy was silently changed.
- Independent content review by review_project_promotion: approved the promotion
  and architecture scope with no material findings; handoff metadata was finalized.

Verification corrections retained here: the first link check found old research
references to ../prd/geraiexpress; project copies were corrected to ../spec.
The next check compared pricing bytes without accounting for deliberate relative
link repair; the assertion was corrected to normalize only that known path change
and passed. Neither issue changed product prices or the original snapshots.

The native initializer used --no-install and truthfully recorded its generic
runtime-verification step BLOCKED. That historical bootstrap result is retained.
This subsequent documentation run has its own checks/review; no app dependency,
package manifest, source scaffold, schema, cloud resource, real account, provider
call, runtime/browser proof or deployment was created. Mermaid is text only.

Re-run document structure on this workstation:

```bash
python3 /data/ai/codex/skills/development-spec-suite/scripts/check-traceability.py docs/spec --stage research --tasks TASKS.md
```

Application implementation remains PLANNED. DEL-1 owns subsequent runtime/demo,
sandbox and pilot acceptance; the root TASKS.md remains the sole future queue.

## 2026-10-13/14 — DEL-1 local foundation and synthetic demo preview (T-001 … T-008)

Owner request: "jalankan development task by task dan sempurnakan, jangan lupa tinggalkan
footprint dan juga buat sistem map". Executed by Claude Code (claude-opus-5-5) as one
delivery-ledger run per task; every task had a separate independent review agent. No commit,
push, cloud resource, deployment, provider call or real data. Run evidence: `.delivery/runs/`.

### Decisions taken during implementation (engineering, not owner decisions)

- Adapter: `@opennextjs/cloudflare` 1.x (GA) instead of vinext (beta). Next.js 16.4.0 + OpenNext
  1.20.10 returned HTTP 500 in workerd (`Unexpected loadManifest(/.next/server/preview-props.json)`);
  pinned Next.js 16.3.8 (adapter peer floor), which passes. Recorded as a proposal for owner
  confirmation in STATUS.md, not in DECISIONS.md.
- pnpm's `minimumReleaseAge` policy rejected packages published within 24h; versions were pinned
  to older releases instead of relaxing the policy (wrangler 4.149.0, OpenNext 1.20.10, TS 6.0.3).
- Session refresh uses `middleware.ts` (edge-style) because OpenNext does not support Node
  middleware / `proxy.ts`. Verified in the Worker.
- Demo access = anonymous Supabase session + `start_demo()` creating a per-visitor demo tenant
  (IAM-4 session-local trial state). Public email signup is refused by the
  `before_user_created` hook; email confirmations are on.
- Only the publishable key is used; there is no service-role key anywhere in the app.

### What review and testing caught (and was fixed)

- T-001: `outline-none` removed keyboard focus from buttons; bundle scan missed JWT-format
  service-role keys (now decodes payloads); smoke script could hit a stale server.
- T-002 (security): an anonymous demo identity could become a password account with an
  unverified email, bypassing the signup gate — closed by enabling email confirmations, with a
  regression test; IAM-4 anonymous clause had no test (added and mutation-checked); same
  idempotency key with a different quote was silently accepted; raw 23505 text leaked.
- T-003: touch targets under 44px; sign-out was global; "Coba demo" silently signed out real
  users; tests missing for reset, forged tenant cookie and unknown email.
- `tailwind-merge` treated custom `text-body` sizes as colors and dropped `text-primary-foreground`
  (dark text on blue buttons) — UI-2 sizes now map onto Tailwind's standard size names.
- T-004: address insert errors were ignored on contact creation; archive lacked feedback and
  primary promotion. Unit test caught "1.5" cm parsed as 15.
- T-005: re-quoting duplicated services; contact save failures were swallowed and could leave
  orphans on stale revisions; create-draft errors were invisible.
- T-006: print layout kept the 264px sidebar column; fixed with `print:block`.
- `next dev` rewrites `AGENTS.md` when it detects an AI agent environment; the injected block was
  removed and the dev server is started with agent variables unset.

### Verification failures recorded honestly

- Worker e2e failed twice from interference with a reviewer's concurrent run (shared
  `test-results/` and a `db:reset` mid-run) and once from a real test race (a "Kontak tersimpan"
  notice from creation satisfied the edit assertion early). One message to a reviewer wrongly
  said the Worker run passed before it did; it was corrected in the same session.
- A one-off mobile e2e miss on "Siapkan label" did not reproduce in a 3× repeat (108/108).

### Executed checks (final state)

```bash
pnpm typecheck && pnpm test:unit            # 4 unit tests
pnpm db:reset && pnpm test:db               # 34 database tests via Data API/RPC
pnpm exec supabase db lint --level warning --fail-on warning
pnpm build && pnpm cf:build && pnpm check:bundle
pnpm smoke:worker                            # /healthz and /masuk in workerd
# with `wrangler dev` on :8787 serving the OpenNext build:
E2E_BASE_URL=http://127.0.0.1:8787 pnpm test:e2e   # 390/768/1280 projects
```

Open gates discovered: Supabase per-IP Auth limits behind Worker egress; verified-inbox
conversion of anonymous identities before invite-by-email; adapter choice. See ARCHITECTURE.md.

## 2026-10-14 — T-009 anonymous identity lock (PR-31 prerequisite)

Probe on the local stack: an anonymous session's `updateUser({ email })` succeeded and stored
`email_change`, so whoever controls that inbox could confirm it and turn the demo identity into
a permanent account with the same id. `enable_confirmations` only delayed it; the
`before_user_created` hook does not run for updates.

Fix: migration `20261014100000_anonymous_identity_lock.sql` adds a `BEFORE UPDATE` trigger on
`auth.users` that refuses, for anonymous rows, any change to email, email_change, phone,
phone_change or password and any clearing of `is_anonymous`. Auth writes `''` instead of NULL
for some of these columns, so comparisons coalesce. Supabase documents user triggers on
`auth.users`; locally `postgres` can create but not alter/drop it (mutation check used
`supabase_admin`).

Checks: `pnpm db:reset && pnpm test:db` (35 passed); db lint; mutation check (trigger disabled →
both new tests fail); review follow-up added direct-SQL refusals for every guarded column; full e2e on next dev and Worker (110 passed, 1 skipped each).

## 2026-10-14 — T-010 recovery is admin-only (DEC-008)

`reconcile_shipment` accepted any member. Migration `20261014110000_reconcile_admin_only.sql`
checks `tenant_admin` before any row lock (`admin_required`, 42501); the shipment page shows an
operator "Minta admin gerai memeriksa status operasi asli." instead of the button. `start_demo`
now makes the visitor `tenant_admin` of their own sample gerai (sole member), and existing demo
memberships are upgraded, so the recovery path remains demonstrable.

Checks: `pnpm db:reset && pnpm test:db` (37 passed); mutation check (role check removed →
operator test fails); typecheck; cf:build, bundle scan, worker smoke; full e2e on Worker and next
dev (113 passed, 1 skipped each), including the operator escalation view.

## 2026-10-14 — T-011 per-visitor Auth entry limits (RATE-1)

Supabase documents IP forwarding (`Sb-Forwarded-For`) for Auth rate limits only with a secret
API key; the app holds none by design, so every server-side Auth call would share the Worker's
egress bucket. Added Workers Rate Limiting bindings (`SIGN_IN_LIMITER` 10/60 s,
`DEMO_LIMITER` 5/60 s) keyed by `CF-Connecting-IP`, checked in `signInAction` and
`startDemoAction` before Supabase is called. Missing binding or IP fails closed when
`NODE_ENV=production` (the Worker) and is allowed in `next dev`.

Local behaviour verified with a scratch Worker: wrangler dev enforces the binding and passes a
client-supplied `cf-connecting-ip` through, and windows are wall-clock aligned. E2E therefore
gives each test a random private-range visitor IP (`tests/e2e/fixtures.ts`), and limit tests
start early in a window. The run was recorded under requirement NFR-3 by mistake; the
governing requirement is RATE-1.

Review follow-up: the first version keyed IPv6 by full address, so rotating inside a /64 bypassed
it (MAJOR); keys are now IPv4 per address and IPv6 per /64 (`src/lib/visitor-key.ts`, unit
tested with the fail-closed branch), the message says "jaringan ini" because addresses are
shared, and residuals (per-location counters, CGNAT griefing, unlimited refresh/reset) are
recorded in ARCHITECTURE.md.

Checks: typecheck; unit (8); mutation check (limiter forced to allow → both limit tests fail); cf:build,
bundle scan, worker smoke (bindings listed); full e2e on Worker and next dev, 119 passed and
1 skipped each.
