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

## 2026-10-14 — T-012 Super Admin foundation (PR-24, PR-15, PR-28)

Migration `20261014120000_platform_admin.sql`: `platform_grants` (capability array, revision,
revocation), `audit_events` (append-only by trigger, including truncate), and
`private.platform_capable(capability)`, which requires an active grant, the capability, a
non-anonymous identity and `aal2` in the JWT, all read on every call. RPCs: tenant directory
(non-demo, counts only), suspend/reactivate with reason and expected state, admin list,
grant/change and revoke with expected revision; writes lock the grant set and assert that an
access governor with a verified TOTP factor remains. TOTP enabled in `config.toml`; seed adds
two governors with fixture TOTP secrets, an audit/monitoring admin without a factor and
Gerai Uji C.

UI: `/verifikasi-2fa` (enrol with QR + manual key, or challenge; factor chosen server-side;
`MFA_LIMITER`), `/admin` (directory and lifecycle), `/admin/akses`, `/admin/audit`; non-holders
get 404; admins without tenant governance land on their first permitted page; sign-in now
routes through `/`, which sends a platform-only identity to `/admin`. Visual pass: destructive
lifecycle/revoke triggers were full-width grey blocks repeating long names; now compact
secondary controls with the target name for screen readers.

Review (CHANGES_REQUIRED, fixed): (1) MAJOR race: write RPCs checked authority before taking
the grant lock, so a governor revoked mid-call could re-grant themselves (reproduced by the
reviewer with two transactions); now lock first (FOR UPDATE on the grant set, FOR SHARE on the
caller's grant for lifecycle) and a psql two-transaction test proves refusal, mutation-checked.
(2) MAJOR doc overclaim: `MFA_LIMITER` does not bound direct Auth MFA calls; ARCHITECTURE now
records the brute-force residual and a remote gate. Minors: TOFU enrolment, factor unenrol/user
deletion outside the guard and the never-seed-remote warning documented; audit page now shows
actor, target, change and filters (PR-28) via `platform_audit`.

Observed: Supabase accepts the same TOTP code twice within its window (recorded as a residual).
Checks: `pnpm test:db` 46 passed; mutation checks (aal2 removed → denial test fails;
final-governor guard removed → guard test fails; check-before-lock → concurrency test fails); platform e2e 18 passed on next dev; build,
cf:build, bundle scan, worker smoke; full e2e on Worker and next dev (see `.delivery`).

## 2026-10-14 — T-013 registration and gerai application (PR-29, PR-30, PR-15)

Migration `20261014130000_registration.sql`: `private.settings.registration_open` (default
closed; the Auth hook allows real accounts only while open; governors toggle it with an audited
reason), `tenant_applications` (one open per identity, revisioned, partial drafts, own-read RLS),
applicant RPCs (save, submit, withdraw, `my_account_state`) requiring a verified non-anonymous
identity, and Super Admin RPCs (list, review with reason; approval provisions one active tenant,
outlet and `tenant_admin` membership; replays hit `stale_state`).

Found while building: anyone could `signUp` with another person's email and their own password;
the hook cannot tell that from an OTP signup and Auth gives OTP-created users a random hash too
(verified by probing). An insert-time guard was tried and dropped for that reason. Fix: a
`BEFORE UPDATE` trigger discards the password at the email's first confirmation, so only the
verified owner's later password works (test: attacker password refused after the owner
verifies; mutation-checked).

UI: `/daftar` (email → code; generic reply), `/daftar/kata-sandi`, `/daftar/gerai` (draft,
submit, withdraw, review states), `/admin/pengajuan` (status tabs, decisions with reason; after a
decision the page moves to the resulting tab with a confirmation, because the row leaves the
submitted list), registration switch on `/admin`. Root routing: no password → set password;
application → its page. Bahasa Indonesia OTP template (`supabase/templates/otp.html`), applied
after restarting the local stack. `OTP_LIMITER` 3/60 s per visitor.

Review (APPROVE with minors, all fixed): throttled-vs-sent replies leaked account existence
while closed (now one generic reply; the Auth API residual is documented); attacker-planted
`user_metadata` survived verification — clearing it in the trigger did not work because Auth
rewrote metadata from memory on the next update (observed), so the hook now refuses signups
with metadata; template comment corrected; applicants can no longer read `reviewed_by`;
self-decision refused. New tests: signup-code confirmation path, metadata refusal, single
membership after approval. `pnpm test:db` 55 passed.

E2E note: React resets a form after its action; the password test waits for the reset before
retyping (a human cannot hit this race).

## 2026-10-14 — T-014 staff invitations and member management (PR-31, PR-32, DEC-008)

Migration `20261014140000_invitations.sql`: `tenant_invitations` with RPC-only access; invite
(admin of a real tenant, lock then re-check, no duplicate pending, expired pending closed
first), revoke, list (only unexpired), `my_invitations` and `accept_invitation` (verified
invited email only; unknown and foreign ids look the same; issuer must still be an active
admin; tenant active; one membership). Member list, role change and deactivation with a
last-admin guard. The Auth hook also admits an email holding a pending invitation while
registration is closed. `reconcile_shipment` now re-checks the role after a share lock on the
caller's membership (T-010 follow-up).

UI: `/anggota` (admins of real gerai: members with role/deactivate, pending invitations,
invite with role and share-the-link guidance; nav item only for admins), `/undangan`
(accept), `/daftar` keeps code entry visible when closed for invited staff, `/masuk` links it,
root and password step route to `/undangan` when invitations exist.

Bugs found by the browser pass: role labels exported from a `"use client"` module were client
references in server pages (labels blank) — moved to `labels.ts`; expired invitations were
listed as pending — now filtered; the opened member panel pushed its trigger off the right edge.
E2E races fixed in tests (typing before hydration after client navigation).

Review (APPROVE, minors addressed): 20-pending cap per gerai, NULL role refused, invite and
expired-replacement audits carry the email, concurrent mutual demotion test added, invitation
existence via the Auth API recorded as a residual for T-016.

Checks: `pnpm test:db` 62 passed; mutation checks (role re-check after lock removed, issuer
check removed, last-admin guard removed → each targeted test fails); members + registration e2e
24 passed; full suites on both runtimes recorded in `.delivery`.

## 2026-10-14 — T-015 Mengantar credential storage (PR-18 storage, PR-26, SEC-3)

Design check against the canonical Partner study: the Partner Secret is a Worker secret binding
with no database projection, so the owner's idea of entering Mengantar credentials in Super
Admin was split: seller API keys (BYOK, DEC-006) are entered by the gerai's admin and sealed;
the Partner ID (not secret) is set in Super Admin; the Partner Secret is set with
`wrangler secret put` and Super Admin only shows whether it is present.

Migration `20261014150000_credentials.sql`: `private.seller_credentials` (ciphertext, IV, key
version, 4-char hint, monotonic version, one active), store/remove RPCs behind the locked
tenant-admin check (demo refused), member status projection, platform integration list and
Partner ID setting (audited). `src/lib/credential-crypto.ts` (AES-256-GCM, AAD tenant+version,
unit-tested incl. wrong tenant/version/key), `worker-secret.ts`, `/pengaturan` admin section,
`/admin/integrasi`. `pnpm dev:env` generates and keeps a local `CREDENTIAL_KEY` (umask 077).

Review (CHANGES_REQUIRED, fixed): MAJOR — `pnpm dev:env` had put `CREDENTIAL_KEY` in
`.env.local`; OpenNext bakes `.env*` into `.open-next/cloudflare/next-env.mjs` and mirrors it into
`process.env`, and `workerSecret()` fell back to `process.env`, so a production build made on a
dev machine without the real secret would have sealed with the laptop key and reported it as
installed. Now the key is only in `.dev.vars` (a Cloudflare binding, also under `next dev`), the
fallback is gone, `check:bundle` fails on baked secret names (it failed on the old build, passes
on the new one), and `dev:env` chmods both env files to 600 and validates a reused key. Minors:
removal/replacement now clears ciphertext and IV (constraint ties them to the active row),
removal message no longer overclaims, shorter hint for short keys, tests for suspended-gerai
admin and operator removal.

Fixed while testing: `to_jsonb(NULL)` is SQL NULL, so clearing the Partner ID violated NOT NULL.
Checks: unit 11, `pnpm test:db` 66 (mutation: store authority removed → denial test fails),
credentials + settings e2e 15 on next dev; full suites in `.delivery`.

## 2026-10-14 — T-016 Turnstile CAPTCHA on Auth entry points (SEC-5)

`[auth.captcha]` enabled (Turnstile; Cloudflare's documented always-pass test secret locally);
password sign-in, anonymous demo sign-in and OTP pass the widget token; DB test clients attach
the documented dummy token; `tests/db/captcha.test.ts` proves each entry point (incl. signUp) is
refused without one. Site key read at runtime from the `TURNSTILE_SITE_KEY` binding.

Found in the browser: (1) the e2e fixture sent a fake `CF-Connecting-IP` to every origin and
Cloudflare refused the Turnstile script (ERR_BLOCKED_BY_ORB) — the header is now added only for
the app's origin; (2) clicks before verification completed were swallowed: the verifying
frame overflows its box and covered the submit button (no event reached the document) — the
widget now sits below the button and uses `appearance: "interaction-only"`; (3) a disabled
submit button drops out of the Tab order — it now stays focusable with `aria-disabled` and
explains the wait. Scope note: CAPTCHA does not stop one anonymous session from triggering
email-change mail; recorded as an owner decision (mail architecture).

Review (CHANGES_REQUIRED, fixed): MAJOR — the Turnstile test secret was literal in
`config.toml`, so a `supabase config push` would have made a real project's CAPTCHA always pass;
the secret is now `env(GE_AUTH_CAPTCHA_SECRET)` from gitignored `supabase/.env`, written by
`pnpm db:start` (`scripts/supabase-local-env.sh`), verified by restarting the stack (GoTrue got
the value; captcha test passes), and the docs forbid `config push`. Minors: captcha failures now
say so (not "wrong password" / "code sent"), delivery outages (5xx) are reported, the test also
covers recovery and resend, the wait hint is a persistent live region, and every extra e2e
browser context gets its own visitor IP.

## 2026-10-14 — T-017 Auth email through the Worker's Send Email Hook (DEC-009)

The owner accepted the recommendation to close the T-016 residual with a Send Email Hook
(DEC-009; ARCH-3 updated). `POST /api/auth/send-email` verifies the Standard Webhooks signature
(WebCrypto HMAC, ±5 min), refuses anonymous identities and unused action types, renders
Bahasa Indonesia code mail, and delivers through `MAIL_TRANSPORT` (local Mailpit API only,
loopback-guarded; anything else fails closed). Supabase templates were removed (one source of
mail text). Local plumbing: `[auth.hook.send_email]` with the secret from gitignored
`supabase/.env` (generated by `pnpm db:start`), `pnpm dev:env` passes it and the Mailpit URL to
`.dev.vars`, and `pnpm dev:hook-relay` listens only on the docker0 address because the dev
servers bind 127.0.0.1.

Observed: a `supabase stop` piped to /dev/null had not actually restarted the stack, so the
first test still used the native mailer (sender `admin@email.com`); after a confirmed restart the
sender is `no-reply@geraiexpress.local` and the Worker logs `auth_mail_sent`. Anonymous email
change now logs `auth_mail_refused anonymous_identity` and Mailpit receives nothing. Disabling
the anonymous rule end to end still sent nothing (the payload has no deliverable address), so the
rule is mutation-checked in the unit test, where removing it fails.

Review (APPROVE with minors, fixed): hook decisions now answer HTTP 200 with an error object, the
shape Auth reads (verified: Auth logs "403: Email tidak dapat dikirim untuk akun ini." instead of a
generic failure) and that avoids hook retries re-sending delivered messages; an email change
without a current address is refused even if the anonymous flag were missing (e2e + unit);
replay inside the 5-minute window is recorded as a `// lazy:` ceiling (id store with the
production transport); null payload and `[::1]` loopback nits fixed. Mail-related e2e 30 passed on
both runtimes after the change; `pnpm test:db` 68.

## 2026-10-14 — T-018 preview on Cloudflare + Supabase (DEL-1 stage 2)

Owner authorized running Cloudflare and Supabase via CLI. Created Supabase project
`geraiexpress-preview` (ap-southeast-1) with a generated DB password kept only in the owner's
secrets store; `db push` applied 9 migrations (dry run first; no seed, so no fixture admins);
remote `db lint` clean. Remote Auth settings live in `infra/supabase-preview/supabase/config.toml`
and were applied with `config push --workdir` after reviewing the diff (anonymous sign-ins on,
both hooks, OTP length 6, aggregate-sized rate limits, site URL, GraphQL schema off). The API
refused `sms_sent = 0` (minimum 1). Worker deployed with `pnpm deploy:preview` (build without
`.env.local`, bundle check, `--env preview` with its own rate-limit namespaces and vars);
`CREDENTIAL_KEY` and `SEND_EMAIL_HOOK_SECRET` generated into the secrets store and put via stdin.

Verified: `pnpm smoke:preview` 6 passed at 390 and 1280 (demo through simulated issuance and
sample label; closed registration; protected pages); direct Auth probes against the project:
public signUp and OTP refused, anonymous sign-in allowed, anonymous email change refused by the
Worker hook over HTTPS, platform RPC refused. Intentionally off: Auth email transport, Auth
CAPTCHA (needs a real Turnstile widget), Mengantar, Super Admin.

Review (CHANGES_REQUIRED, fixed): STATUS.md and README still said nothing was deployed (status
authority now records the preview); RELEASE.md recorded the upload version instead of the
active one and suggested an untargeted rollback onto a version missing a secret (now names
versions and the rollback target); residuals recorded (direct anonymous sign-in bypasses the
Worker's demo limiter while CAPTCHA is off, no demo cleanup, no frame/HSTS headers, email rate
limit to re-check); `deploy-preview.sh` now holds every local `.env*` file, refuses a leftover
hold file, and aborts unless OpenNext baked an empty environment — redeployed with it (version
`dddc2184`, both secrets present, `.env.local` restored).

## 2026-10-14 — T-019 Mengantar Public API read client (DEL-1 stage 3)

Owner supplied two values and approved read-only production calls. Probes (no writes): the Partner
list route refused the pair with 401 `Invalid partner credentials`; the sandbox origin answers
403 `Not allowed` for every key, including invented keys and the key-agnostic area search, so
sandbox access is gated on Mengantar's side; the `API-…` value is the owner's production seller
key (pickup addresses, area search and estimate answered 200). Keys live only in the secrets store
(`GERAIEXPRESS_MENGANTAR_PROD_READ_KEY`, `GERAIEXPRESS_MENGANTAR_SANDBOX_SECRET`); captured
responses were checked for key echo before saving sanitized fixtures (area and tariff data only).

Added `src/lib/mengantar/public-api.ts`: fixed origins, key in the path but never in errors,
`redirect: "manual"` (3xx refused; see review below), 10 s timeout, 256 KiB streamed bound, `success:false` → `rejected`, 403 →
`not_allowed`. Estimates come from `courier=all`; only documented courier codes are offered and a
row is dropped when unsupported (or COD-uncovered when COD is requested), when
`estimatedPrice ≠ price + codFee`, or when the net cost exceeds the tariff (captured cargo/lite
rows break these). Evidence: `docs/research/geraiexpress-mengantar-public-api.md`.

Verified: unit 9 (mutation check: 7 guards removed one at a time, all killed after two tests were
strengthened — oversize bound and undocumented-courier allowlist had survived the first pass);
`test:contract` live against production 2 passed, skipped without a key, sandbox fails with
`not_allowed` as recorded. Not wired into quoting or UI (TASKS next candidate 3).

Review (CHANGES_REQUIRED, fixed): workerd rejects `redirect: "error"`, so every Worker call would
have failed as `unavailable` while Node tests passed — now `manual` with 3xx refused, and the
client was run inside local workerd (`wrangler dev`, invalid key: both calls reached Mengantar and
returned `not_allowed`). Also: a mid-read stream failure maps to `unavailable`; SiCepat
`unsupportedPickup`/`unsupportedOriginSicepat` drop the row; non-COD `courier=all` fixture added
with exact rows; ETA `-` is null; deterministic tie order; contract test only sends
`GERAIEXPRESS_MENGANTAR_*` variables; leak test covers stack/cause; full docs hash. Unit 11,
6 new mutants killed.

## 2026-10-14 — Mengantar sandbox credentials identified (after T-019)

The owner stated the sandbox needs no IP allowlist and identified the 43-character value as the
Partner Secret with the configured Partner ID (value omitted). A signed sandbox `POST /api/partner/v1/sellers/list`
answered 200 (no sellers). T-019's "sandbox gated on Mengantar's side" reading was wrong: the
Public API refused a Partner Secret used as a seller key. Corrected in the research notes,
STATUS and TASKS.

## 2026-10-14 — T-020 Mengantar Partner client and sandbox proof (DEL-1 stage 3)

Added `src/lib/mengantar/partner-api.ts` (signed POSTs; list, register, get key; sandbox origin
only; seller key returned to the caller for sealing; list strips names/emails/phones; provider
codes allowlisted, `Retry-After` and the 503 `sellerId` carried). Reuses the Public client's
bounded reader. The owner approved one sandbox seller (identity omitted): registered
201, repeat 200 with the same seller and key, get-key identical; key stored only in the secrets
store. Sandbox write proof with that key: pickup address created; JNE drop-off came back as
HTTP 200 `success: true` with the item in `status: "error"` (no ORDER_ID) — the order adapter
must judge items, not the envelope; anteraja refused drop-off; JT drop-off issued
`261014LJ9GP7` / `JO6844983511`; simulation moved it to ON DELIVERY and DELIVERED; label
generation 403 (account not whitelisted). The sandbox served Cloudflare 502 pages for minutes at
a time twice; the run waited for three consecutive healthy checks before retrying.

Verified: unit (Partner 9, mutation check 8/8 killed), typecheck, `pnpm test:contract` on the
sandbox 3 passed (Partner list, area search, estimate).

Review (CHANGES_REQUIRED, fixed): a missing or blank `Retry-After` had become 0 ("retry now"),
now null; a new (201) registration with a null key and a response without `alreadyRegistered` are
malformed; a bad list entry or count fails the page instead of being dropped (reconciliation must
not think a seller is unbound); pagination checked locally; declared oversize covered; sandbox row
in the Public research reworded. Unit 37 (Partner 10), 6 new guard mutants killed, sandbox
contract 3 passed again.

## 2026-10-14 — T-021 Mengantar order adapter (DEL-1 stage 3)

Owner accepted the recommendation to continue. Added `createOrder`, `findOrder` and
`findOrdersByReference` to the Public client (shared `send` with the existing bounds). A create
is judged on its single item: issued (paid, ORDER_ID, resi, our reference echoed), unpaid,
failed (error item without identity), rejected (4xx refusal with the provider's text), and
everything unclear — transport failure, 5xx, unreadable or inconsistent answers, a missing or
foreign reference — is `unknown_outcome`, never retried. Sandbox probes (owner-approved) showed
`destinationMark` round-trips, the documented `dateRange` filter does not work, and the `batch`
filter takes the batch code; reconciliation therefore scans newest-first pages per courier.

Verified: unit 49 (orders 12; mutation check 13 guards, all killed after two tests were added),
typecheck, live sandbox run: anteraja drop-off rejected with provider text, JT unpaid
`261014LKLL3E`, found by ORDER_ID and by reference, unknown reference → none.

Review (CHANGES_REQUIRED, fixed): the reference scan could have reported "not found" for an
existing order (stopped on a short page, trusted ordering, no clock margin) — it now reads until
an empty page or a row older than the attempt minus 10 minutes, and rows out of order are
`unknown_outcome`; sandbox confirmed newest-first ordering and honoured page sizes, and that
count/total are always 0. Only a plain 400 refusal is `rejected` (409/422/429 are unknown).
`failed` keeps the provider batch and record id. COD proven on the sandbox (`2610142JG95B`, COD
value = amount collected) and documented on the type. Unit 53 (orders 16), mutants for the new
guards killed, live reconciliation re-run on the sandbox.

## 2026-10-14 — T-022 account dispatcher core (DEC-010)

Owner accepted the design: results written only by the machine identity (Supabase secret key as
a Worker secret; `dispatch_*` executable by `service_role` only) and per-seller serialization as
a database rule (partial unique index: one real in-flight operation per tenant), Durable Objects
deferred. Migration `20261014160000_dispatcher.sql`: Mengantar pickup address/area ids on
outlets, recipient area id on shipments (draft content, guarded), operation result fields and
`provider_env`, `awaiting_payment`, and the claim / begin-reconcile / record commands. Record is
fenced by the attempt from in-flight, accepts truthful results from unknown, refuses "not
created" until the attempt is 5 minutes old, upgrades an unpaid order to issued only for the same
provider order, and replays identical final results. `dispatcher.ts` opens the sealed key in the
Worker, sends one order, records the judged outcome (never resends), and reconciles by reference
(duplicates or partial rows stay unknown; a sandbox operation is never looked up in production).
The adapter's reference rule now accepts shipment references (`GX…`) and order rows carry batch.

Verified: test:db 79 twice (the dispatcher's machine-only test first left outlets in fixture
tenant A and broke an invitations assertion; it now uses its own tenant and the leftovers were
removed), unit 62 (dispatcher 10; 9 mutants, two survived first — one guard was redundant and
removed, one test added), db lint, build, shipping e2e 42 on next dev (restarted with the hook
relay; both had stopped). Live: `tests/contract/dispatcher.live.test.ts` on the local DB with
the sandbox seller key sent `261014WXQFKT` (unpaid), reconciled a simulated lost answer to the
same order, and concluded "not created" for an attempt never sent.

Review (CHANGES_REQUIRED, fixed in the unapplied-elsewhere migration, local DB reset): the
operation now records the key version it was sent with and reconciliation gets that key only
while it is active (a rotation could otherwise search the new account and conclude "not
created", orphaning a real order); "not created" and provider-error-item conclusions can be
re-checked and are corrected to issued/unpaid with an `outcome_corrected` event when the order
turns up; claim locks the tenant and stays busy while an operation became unknown less than 5
minutes ago; a missing key refuses the claim and an unopenable key releases the operation back to
the queue (new `dispatch_release`, attempt-fenced) instead of failing the shipment; claim checks
the shipment is queued, real, and its quote matches the revision; local refusals use a typed
`InvalidOrderRequest`. Ceiling (per-tenant, not per-account serialization) recorded in DEC-010;
digest/area and `awaiting_payment` labels noted for T-024. test:db 84 (dispatcher 16), unit 63,
live sandbox 2 passed again (order sent and reconciled), shipping e2e 42.

## 2026-10-14 — T-023 live quotes and area pickers (DEL-1 stage 3)

Migration `20261014170000_live_quotes.sql`: `set_outlet_mengantar_pickup` (tenant admin of a real
gerai, audited), and service_role-only `machine_seller_key` and `record_live_quotes` (revision
guarded, replaces older quotes, net cost private, zero rows leave the draft unquoted). Worker:
`machineClient()` from the `SUPABASE_SECRET_KEY` binding, `tenantMengantar()` opens the tenant's
sealed key after `requireWorkspace` verified membership (`MENGANTAR_ENV` selects sandbox or
production; any missing piece fails closed). Settings reads the seller's saved pickup addresses
with the key (first real proof the key works) and the admin picks one; the server re-reads it
from Mengantar before saving. Intake for real gerai: recipient area search (`/api/mengantar/area`,
radio results; typing again clears the choice) and live quotes through the tenant key, anteraja
filtered (refuses drop-off). Live confirmation stays disabled with an explanation until T-024.
`pnpm dev:env` now writes `SUPABASE_SECRET_KEY` and `MENGANTAR_ENV=sandbox` into `.dev.vars` only.

Visual review of the live flow screenshots (390 and 1280) found raw courier codes (`spx`, `Sap`)
and provider ETA strings ("2 - 1 days", "4 HARI"): display now uses courier names and Indonesian
day ranges (`courierName`, `etaLabel`, unit-tested); the confirm dialog no longer says it will
create an order, and settings no longer says the key is unused.

Verified: test:db 88 (live quotes 4), unit 67, typecheck, db lint, build, cf:build,
check:bundle, worker smoke, opt-in `tests/e2e/live-mengantar.spec.ts` against the sandbox on
390/768/1280 (stores the sandbox seller key through the UI, picks the pickup, searches
"sukatani", quotes live, confirm locked, then restores outlet A and supersedes the key).

Review (APPROVE with minors, all applied): settings calls Mengantar only for tenant admins;
a replaced or removed seller key clears the outlet's Mengantar pickup (trigger on
`private.seller_credentials`; the old account's pickup must not be reused) and a pickup missing
from the seller's list is not "ready"; ETA truncated to the stored 40 characters and provider data
the database refuses shows "Data dari Mengantar tidak bisa dibaca" instead of a form error;
`record_live_quotes` checks formats before casting; the area route sends `no-store` on every
answer; 403 copy no longer blames only the key; comments corrected. Noted for T-024: dispatch
re-checks the pickup, saved contact addresses keep an area id. Known: `credentials.spec.ts`
stores a fake key, so the admin settings page calls the sandbox during e2e (assertions hold
whether the call fails or is refused). Re-verified: test:db 89, unit 67, db lint, build,
cf:build, check:bundle, worker smoke, settings/credentials/shipping e2e 57, live e2e 3; the
full e2e before the fixes: 176 passed, 4 skipped (the 3 opt-in live runs and one existing skip).


## 2026-10-14 — T-024 real issuance, reconciliation UI and cron sweep (TD-3, DEC-010)

Owner: continue, audit, refine, review. Scope kept to issuance; COD (two-pass fee) and API
pay-unpaid split to T-025 so COD is applied exactly once and payment keeps its batch review.

Migration `20261014180000_issuance.sql`: `confirm_shipment` creates a real queued operation
(refuses missing pickup, area, goods value or key; a simulated quote on a real shipment is
stale; digest now includes the area id); the one-create-per-shipment index excludes only
definite refusals (`private.definitely_not_created`), so `reopen_shipment` can return such a
shipment to draft while "not created"/error items keep blocking; `dispatch_due`,
`dispatch_begin_payment_check`, `last_checked_at` throttling; `dispatch_release` marks its time;
contact addresses keep `area_id`, cleared by a trigger when the area text changes. Dispatcher:
pickup re-check before sending (missing → `PICKUP_NOT_FOUND`, lookup failure → release),
`checkPayment`, `sweep`; `machine-deps.ts` builds deps from bindings for actions and cron.
Worker entry `custom-worker.ts` (verified pattern: opennext.js.org custom worker) with cron
`*/5`; the preview sets no crons. UI: confirm for connected gerai creates and pays a real order
(warning text), detail page per state (queued → "Kirim sekarang", awaiting payment → "Periksa
pembayaran", unknown → admin reconcile, definite refusal → "Ubah & coba lagi", other failures
→ do not recreate), Mengantar order id shown, real labels from the Mengantar app.

Found while verifying: the first cron runs in workerd claimed and released undeliverable fixture
operations on every run (now throttled 10 minutes, and certain refusals are not due); a hot
function patch did not apply, so the DB was reset instead of trusting it.

Verified: test:db 95 (issuance 6), unit, typecheck, db lint, live e2e against the sandbox
(1280 issued sandbox order `261014CE0FZ7`, unpaid → "Periksa pembayaran" → still unpaid; one
operation only), cron in local workerd (`/__scheduled`: sweeps of 13 then 3 — the remainder are
busy sellers retried by design; an unpaid order's check time advanced).

Review (CHANGES_REQUIRED) and the integration audit (owner request), all addressed in the
unapplied-elsewhere migration (local DB reset): payment checks key on the shipment's unpaid
state, so reconciled or corrected unpaid orders also get their resi; provider-error failures can
be re-checked by the admin and the sweep (hourly for 24 hours, like "not created"), and an admin
can close an unresolved failure after 30 minutes and a re-check (`close_failed_operation`,
reason audited, then reopenable; a late result for a closed operation is refused by design);
the charged price is stored and a difference from the customer charge becomes a
`price_mismatch` event; an operation queued for over 6 hours fails as `QUOTE_STALE` without
sending (reopenable); unknown reconciliation stops after 7 days and keeps `DUPLICATE_ORDERS`;
partial index for `dispatch_due`; `reopen_shipment` locks in the dispatcher's order; real
shipments cannot get sample labels; area missing at confirm says so; quotes use the shipment's
outlet; the cron logs `disabled`/`failed` and awaits the sweep; actions log `dispatch_action`;
seller keys are validated with the client's shape at storage; `check:bundle` refuses a baked
`SUPABASE_SECRET_KEY`; settings warn before replacing a key with open orders; STATUS, TASKS,
RELEASE (production gates) and OBSERVABILITY updated. A test-run outlet leak into fixture tenant
A was cleaned and the test changed to use a draft of outlet A.

Re-verified: test:db 100 (twice), unit 71, typecheck, db lint, operator/admin reconcile e2e
(3 viewports), live sandbox e2e (order `2610148AL7NW` unpaid; quote from the shipment's outlet).

Re-review approved; the re-audit closed the HIGH findings and left three MEDIUM. Two were fixed:
the price is recorded on every path (reconciled, corrected, payment upgrade), and
`dispatch_stuck_counts` (service_role) feeds `dispatch_sweep.stuck`. The third, an admin closing
a failure that later turns out to be a real order, is an accepted limit (it rests on the admin's
statement; a late result is refused and the operation is reopenable). A final review of that delta
(CHANGES_REQUIRED, then approved) fixed: a price difference was reported twice for an order created
unpaid and paid later (now once per price; mutation-checked); an unreadable price returns null and
logs `priceUnknown` instead of silently skipping the check; `stuck.queued` counts operations
queued over 6 hours that cannot be sent (key revoked, gerai inactive). The COD price comparison is
noted on T-025. Test isolation: the due-list test throttles earlier tests' operations so repeated
runs do not fill its 50-row page; issuance tests remove the shipments they add to fixture tenant A.

Local plumbing reminder: `pnpm test:db` needs `next dev -H 127.0.0.1 -p 3100` and the auth hook
relay (`AUTH_HOOK_RELAY_HOST=10.0.0.1 pnpm dev:hook-relay` when docker0 is down); without `-H`,
Next blocks 127.0.0.1 dev resources and e2e logins time out.

Final verification: test:db 103 (twice, and once from a fresh reset), unit 72, typecheck, db lint,
full e2e on next dev (179 passed, 4 opt-in skipped), build, cf:build, check:bundle PASS, worker
smoke PASS, cron in local workerd (log carries `priceUnknown` and `stuck.queued`). The opt-in live
sandbox e2e was not re-run after the final price follow-ups (database-only change, covered by DB
and unit tests).

## 2026-10-15 — PERF-1 dashboard latency on the preview (NFR-4)

Measured on the deployed preview from Indonesia (Playwright, demo session): every dashboard page
waited 0.55–0.9 s for the first byte (login page ~0.17 s warm). Causes: Indonesian traffic lands
in Cloudflare HKG while Supabase is in ap-southeast-1, and a page makes 4–5 sequential Supabase
calls (middleware `getUser`, loader `getUser`, memberships, outlets, page queries); list rows also
prefetched one dynamic render each (8 detail renders on the contact list alone).

Changes: preview placement hint `aws:ap-southeast-1` (Worker runs next to the database); the
middleware verifies GET/HEAD locally with `getClaims` (the preview has ES256 keys) and keeps
`getUser` for every other method, so a revoked session's cookies are still cleared before
RPC-only server actions (review finding; unit test `middleware.test.ts`, mutation-checked);
page loaders keep `getUser`. Row links in shipment, contact and draft lists do not prefetch; the
workspace nav shows a pending dot (`useLinkStatus`) on the clicked item. A route-level
`loading.tsx` was tried and removed: streaming made foreign-tenant `notFound()` answer 200 (17
isolation e2e failures).

Verified: unit 74, typecheck, full e2e on next dev (179 passed, 4 opt-in skipped; the specs run
before the final middleware edit re-ran: 86 passed), build, cf:build, check:bundle, worker smoke;
nav pending state screenshotted (dot visible while pending, no layout shift). Security review:
CHANGES_REQUIRED (revoked sessions on RPC-only actions), fixed, approved.

Deployed 2026-10-18 with owner approval: `supabase db push` (dry run first) applied the three
T-022..T-024 migrations (12 of 12), `pnpm deploy:preview` published version `f9bc88ad`;
responses carry `cf-placement: remote-SIN`. Re-measured with the same script, warm: document
TTFB 0.46–0.63 s per dashboard page (was 0.53–0.90 s), in-app navigation 0.49–0.61 s (was
0.65–0.70 s). The comparison understates the gain: during this run the client's traffic reached
Cloudflare in WAW/ARN (`/cdn-cgi/trace` loc=ID, colo=WAW; TCP connect ~0.19 s) instead of HKG at
baseline, so every request carried a far longer client leg.

## 2026-10-27 — T-025..T-030 COD, batch payment, Partner sandbox onboarding, audit hardening & GeraiExpress marketing

Executed in parallel across four implementation lanes under run `RUN-20261027T122627Z-42dca1d4`:

- **T-025 (COD shipments & two-pass COD fee pricing, PR-22)**: migration
  `20261027190000_cod_and_batch_payment.sql` adds `cod_fee_idr`, `cod_supported`, and
  `customer_charge_idr` (`normal_tariff_idr + cod_fee_idr`) on `shipment_quotes`, grants
  `update (is_cod)` on `shipments` while keeping `cod_amount_idr` and `customer_charge_idr`
  RPC-only, and updates `seed_shipment_quotes`, `record_live_quotes`, `confirm_shipment`, and
  `private.record_provider_price`. `estimateTwoPassCod` in `src/lib/mengantar/public-api.ts`
  evaluates pass 1 (`codAmount = goodsValueIdr`) to discover normal shipping tariffs and COD
  support, then runs pass 2 per distinct tariff (`codAmount = goodsValueIdr + tariff`) so the
  provider's COD fee is computed once on `goods + shipping` while private seller `net_cost_idr`
  remains isolated in `private.quote_costs`. `createOrderBody` sends `COD_AMOUNT: 0` for non-COD
  and `customerChargeIdr + goodsValueIdr` for COD, persists provider item error text on rejected
  orders, and compares `estimatedPrice` against `shipments.customer_charge_idr`.
- **T-026 (Batch `pay-unpaid` recovery, TD-3 / DEC-008 / DEC-010)**: `review_unpaid_batch`
  computes full local batch membership, total payable IDR, and a SHA-256 `batch_digest` for
  `tenant_admin` review; refuses discontinued `ninja` (`courier_discontinued`), mixed couriers,
  or cross-tenant batch collisions (`batch_scope_mismatch`). `dispatch_begin_batch_payment`
  (`service_role`) locks the tenant and all batch member shipments and verifies `p_batch_digest`.
  `payUnpaidShipmentBatch` in `src/lib/mengantar/dispatcher.ts` verifies 1-to-1 batch membership
  against Mengantar's `listOrdersByBatch` before calling `/order/pay-unpaid` once, and reconciles
  each member via `findOrder` on timeout/5xx without re-sending payment or creating a second order.
- **T-027 (Mengantar Partner API sandbox seller onboarding, PR-17 / PR-18 / PR-20 / DEC-006)**:
  migration `20261027210000_partner_seller_onboarding.sql` adds `private.tenant_mengantar_onboarding`
  with immutable `external_user_id = 'geraiexpress:tenant:' || tenant_id::text` and RPCs
  `begin_partner_seller_onboarding`, `complete_partner_seller_onboarding`,
  `record_partner_seller_onboarding_outcome`, and `partner_onboarding_status`.
  `src/lib/mengantar/partner-onboarding.ts` and `/pengaturan` orchestrate sandbox seller
  registration (`/api/partner/v1/sellers`) with explicit owner confirmation (`PR-20`), Worker-side
  AES-256-GCM sealing of the returned `apiKey`, idempotent 200 repeat completion, 503
  `KEY_PROVISIONING_FAILED` retry recovery via `/sellers/api-key`, 409 `EMAIL_ALREADY_REGISTERED`
  routing to manual BYOK, and first-login `Lupa Password` guidance.
- **T-028 & T-030 (Audit hardening, contact archive guard, demo cleanup, security headers & staging config)**:
  migration `20261027220000_contact_archive_and_demo_cleanup.sql` revokes direct `archived_at`
  updates on `public.contacts`, adds `public.archive_contact` with row-lock `tenant_admin`
  re-check, adds `public.cleanup_expired_demos` (`service_role` only, strictly scoped to
  `is_demo = true` / `is_anonymous = true`), and upgrades optimistic concurrency exceptions from
  SQLSTATE `40001` to `55000` (fixing PostgREST v14.18 `hasql-transaction` infinite retry loops on
  `40001`). `src/middleware.ts` adds `X-Frame-Options: DENY`, `Content-Security-Policy: frame-ancestors 'none'`,
  `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, and HTTPS
  `Strict-Transport-Security`. `wrangler.jsonc` adds `env.staging` (`geraiexpress-staging`,
  `MENGANTAR_ENV: "sandbox"`), and `custom-worker.ts` runs hourly demo cleanup alongside the
  5-minute dispatch sweep.
- **T-029 (Public marketing pages on `geraiexpress`, PR-13 & PR-32)**: anonymous visitors on `/`,
  `/fitur`, `/simulasi`, `/cara-kerja`, and `/hubungi-kami` receive the standalone GeraiExpress
  marketing experience (commission simulator, multi-courier overview, `/masuk` demo + `/daftar`
  CTAs) while signed-in users on `/` continue routing to their workspace per `PR-32`. The legacy brand name
  is absent from `src/` and `public/` (guarded by `tests/unit/marketing-rebrand.test.ts`); the earlier
  "zero across code, config, tests and operational docs" wording overstated the scope (see the
  2026-11-06 scope correction in TASKS.md T-029).

Verified: `pnpm typecheck`, `pnpm test:unit` (12 files, 104 tests), `supabase db lint`,
`pnpm test:db` (10 files, 115 tests), `pnpm build`, `pnpm cf:build`, `pnpm check:bundle` (64 files),
`pnpm smoke:worker`, `check-traceability.py` (16 files, 145 declarations, 6 tasks, 0 findings),
and Playwright `pnpm test:e2e` across `mobile-390`, `tablet-768`, and `desktop-1280` (188 passed,
4 opt-in live skipped). Independent security and code review (`218a8a7b`): `APPROVE`.
Deployed preview `c00e9c85-5cb6-47c8-946d-54fd60ca410a` and applied remote migrations 13–15 on
`jezxplwwmjogrmlixdcw`; `pnpm smoke:preview` 6/6 passed.

## 2026-10-27 — T-031 Holistic live-readiness audit & polish (`RUN-20261027T154818Z-a871bd43`)

Executed a full-repository live-readiness audit across SEO, Worker runtime, Supabase schema/RPCs,
security scan gates, release manifests, and E2E test coverage:

- **SEO indexation & crawlability**: `src/app/layout.tsx` sets `metadataBase: new URL("https://geraiexpress.com")`
  while keeping `robots: { index: false, follow: false }` as the workspace/admin default; public
  marketing pages (`/`, `/fitur`, `/simulasi`, `/cara-kerja`, `/hubungi-kami`) explicitly override
  `robots: { index: true, follow: true }` with canonical URLs and OpenGraph metadata; added
  `src/app/robots.ts` and `src/app/sitemap.ts`.
- **Hourly demo cleanup & Partner onboarding recovery**: `custom-worker.ts` `scheduled()` invokes
  `cleanup_expired_demos` on the hourly `0 * * * *` cron and logs `{"event":"demo_cleanup",...}`.
  Migration `20261027230000_production_readiness_polish.sql` adds partial index
  `provider_operations_batch_idx` on `public.provider_operations (provider_batch) where provider_batch is not null`
  and allows `record_partner_seller_onboarding_outcome` to transition failed initial registrations
  back to `'consent_recorded'`/`'not_connected'` instead of leaving rows in `'registration_pending'`.
- **UI & label polish**: `/admin/integrasi` renders `Akun Partner Mengantar` vs `Kunci sendiri (BYOK)`,
  and `/pengiriman/[id]/label` displays `COD — Tagih ke penerima: Rp...` (`data-testid="label-cod"`)
  when `is_cod` is true.
- **Playwright E2E & zero legacy footprint**: added E2E assertions for T-025 COD shipment flow,
  T-026 `batch-payment-review` (`tenant_admin` vs `operator`), T-027 Partner onboarding consent
  validation & operator hiding, and T-028 `Arsipkan kontak` role gating; scrubbed legacy brand references
  from the `docs/**` pages that made product claims. Scope correction (2026-11-06): this was NOT "0 matches across the
  entire repo"; reference citations to the earlier project remain by design in `BUILD-LOG.md`, `STATUS.md`,
  `docs/spec/10-*`, `docs/spec/17-*`, `docs/review/**` and the `.delivery/runs/` ledger.

## 2026-10-28 — Full review, documentation reconciliation, Next.js 16.4.3, local review gerai

No application source changed. Evidence and decisions are in `docs/review/2026-10-28-full-review.md`,
`docs/review/2026-10-28-legacy-project-comparison.md`, `docs/research/` (market and regulatory note,
Mengantar operations contract) and `DECISIONS.md` (DEC-005 raised, DEC-011 to DEC-018).

- **Review**: four read-only lanes (security, data isolation, provider and money, spec and UX) found one
  Critical (tenant admin can bind another tenant's Partner seller and retrieve its key), several High and
  Medium items; the work is queued as T-032..T-051 in `TASKS.md`. Findings are static reads unless stated.
- **Executed checks (2026-10-28)**: `pnpm typecheck` PASS; `pnpm test:unit` 102/102 (14 files);
  `pnpm test:db` 114/114 (13 files) with the Auth hook served by a running app and the hook relay;
  `supabase db lint` 1 warning (unused `v_onb`); `pnpm build`, `pnpm cf:build`, `pnpm check:bundle` PASS.
  Not run: Playwright e2e, live Mengantar contract tests, `delivery-ledger verify`, `production-gate`.
- **Next.js 16.4.3 and OpenNext 1.20.13** pins applied (advisories 10 to 7, the rest transitive build/dev
  tooling). `pnpm smoke:worker` exited 7 once while a second `wrangler dev` was already listening, so it is
  inconclusive, and the Worker e2e was cancelled; both must be re-run before DEC-005 counts the upgrade as landed.
- **Environment note**: `scripts/auth-hook-relay.mjs` finds the `docker0` address through
  `os.networkInterfaces()`, which does not list it on this host; `AUTH_HOOK_RELAY_HOST=10.0.0.1` works.
  DB tests that sign in by OTP fail with "Failed to reach hook" unless the relay and an app serving
  `/api/auth/send-email` are running (`AUTH_HOOK_TARGET` selects the app port).
- **Local review gerai**: `supabase/review-fixture.sql` (owner-approved 2026-10-28, DEC-018 item 7) adds the
  synthetic non-demo gerai "Gerai Demo Review (contoh)" with a tenant admin, an operator, one outlet, four
  contacts with five addresses and three simulated shipments (draft, issued, unknown). Verified: re-running is
  a no-op; both accounts sign in against the local Auth and see only their own tenant through the Data API
  (1 tenant, 4 contacts, 1 outlet, 3 shipments); `pnpm test:db` stays 114/114 with the fixture present. It is
  local-only, outside `seed.sql`, and refuses to run unless the local seed user exists (stopgap until T-035).
- **Documentation**: PRD, design pack, `ARCHITECTURE.md`, `CONTEXT-RECORD.md` (CTX-39..CTX-43) and the
  decision index were reconciled; the traceability check prints PASS (26 tasks, 195 declarations).
  `STATUS.md` still quotes the older 108 unit and 115 DB test counts and is corrected by T-037.

## 2026-10-28 — Development of T-032..T-051 in waves (uncommitted)

Workers built each task in its own git worktree on a shared local Supabase stack, one wave at a time; the
lead merged the results into the main working tree and owned `tests/db/privileges.test.ts`, the shared
allowlists and the decision record (DEC-019). Nothing is committed. Provider-facing behavior for batch payment,
Partner key regeneration and pickup was never run against the live provider.

**Waves and executed checks (as reported by each worker; counts are the worker's, at task time)**

- **Wave A: T-032, T-035, T-036, T-049.**
  - T-032: `pnpm typecheck`, `pnpm build`, unit 108/108, `tests/db` 119/119 (a first full run failed 12
    `issuance.test.ts` tests from shared-database contention and passed alone and on rerun). Fail-before: with the
    stored-id verification disabled 5 unit tests fail; the DB tests were not run against the old schema.
  - T-035: `tests/db/privileges.test.ts` 19/19, full `tests/db` 133. Fail-before: no reverted migration; a
    rolled-back control that grants PUBLIC execute back shows the probe sees exposure, and the catalog before the
    migration showed five `private` functions executable by anon and authenticated.
  - T-036: typecheck, build, check:bundle, unit 108, `tests/db` 114, marketing e2e 10/10 on desktop-1280 and
    mobile-390. Fail-before: the old copy matched the legacy-figure patterns on 20, 13 and 7 lines; the middleware
    test fails when the `X-Robots-Tag` line is disabled.
  - T-049: `tests/db` 132 (tenant-slug-reference 18/18), typecheck, build; one unit file failed only because
    `.open-next/worker.js` was not built in the fresh worktree. Fail-before: replacing the counter upsert by an
    unlocked read-then-write made both parallel-draft tests fail with `shipments_tenant_id_reference_key`
    violations; the locked upsert gave none (60 parallel demo drafts, 25 parallel real-tenant drafts).
- **Wave B: T-033, T-041, T-042, T-044.**
  - T-033: unit 125, `tests/db` 170/172 (the two failures were the lead-owned allowlist), typecheck, cf:build,
    build, check:bundle. Fail-before: sending the code instead of the object id fails 6 dispatcher unit tests;
    reverting "ambiguity stays blocking" in the migration fails 2 DB tests; a 12-round lock-order stress found no
    40P01. The live sandbox payment test exists but is skipped by default and was not run.
  - T-041: `gerai-discount.test.ts` 24/24, full `tests/db` 178 (+2 expected allowlist failures), unit 114, e2e
    6/6 and platform spec 12/12 on 1280 and 390. Fail-before: raising the ceiling by 100000 in the trigger fails 6
    DB tests.
  - T-042: unit 215, `tests/db` 156, e2e 53 passed, 1 failed (`auth-demo.spec.ts:74`, caused by T-049 repeating
    demo references, not by T-042), 1 skipped. Fail-before: disabling the 404 refusal fails 22 of 51 middleware
    tests; `httpOnly: false` fails 4 cookie tests.
  - T-044: unit 134, `tests/db` 311 passed with 2 expected allowlist failures, e2e 84 passed on 1280 and 390 (label
    spec 12/12), Chromium `page.pdf` gives exactly one page at 100x150 mm and 100x100 mm. Fail-before: using the
    pickup name as sender fails 2 unit tests; corrupting a Code128 pattern fails 2; removing the masking and
    WhatsApp checks from the migration fails 9 DB tests. The 768 px project was not run.
- **Reviews of waves A and B (read-only).** Security reviewer, wave A: no Critical or High; T-032, T-035 and
  T-049 approve with fixes (Medium: bindings written before T-032 are not re-verified; the allowlists matched
  names, not signatures). General reviewer, wave A: T-035, T-036, T-049 approve with fixes, with one High (T-049
  repeated demo references and broke the demo-isolation e2e) and Mediums on non-unique prefixes and the blocked
  keyword reaching a prefix. Security reviewer, wave B: T-033, T-042, T-044 approve with fixes, T-041 approve (all
  findings Low). General reviewer, wave B: T-033, T-042, T-044 approve with fixes; **T-041 reject** (the observed
  ceiling depended on a random courier row, old quotes were repriced, the provider percentage was never recorded);
  T-041 was reworked.
- **Wave C: T-034, T-038, T-047, T-051.**
  - T-034: unit 261, `tests/db` 226 passed + 5 allowlist failures (fixed in the lead-owned test), targeted DB 22/22,
    Playwright Partner onboarding 2/2 on 1280 and 390 plus a one-off check with synthetic document bindings
    (script and temporary env file deleted). Fail-before: reverting live validation fails the 100/101 draft test.
  - T-038: unit 292, `tests/db` 218, e2e auth-demo, registration and platform 30 passed on desktop-1280 only,
    build, cf:build, check:bundle. Fail-before: disabling the hook header gate fails the "body not read" test. Supabase
    429 handling is covered by fake errors only; no real Auth call was made.
  - T-047: unit 274, `tests/db` 231/233 (allowlist), invoice-export DB 15/15, e2e 6 on 1280, 5 on 390, 5 on 768.
    Fail-before: removing the idempotent-return line fails the idempotency and concurrency tests.
  - T-051: unit 251, `tests/db` 226/226, e2e 85 passed, 1 skipped on 1280 and 390. Fail-before: removing the contact
    trigger fails the contact-cap test, removing the `start_demo` lock line fails the race test, disabling the click
    guard shows two POSTs.
- **Wave D: T-043, T-039.**
  - T-043: unit 342, pickup DB 20/20, e2e `shipping.spec.ts` 38/38 on 1280 and 390; the fixtures are derived from the
    provider documentation. Fail-before: disabling the new guard in the pay-unpaid read-back fails its unit test.
  - T-039: unit 335, `tests/db` 243 passed + 2 expected allowlist failures, rotation DB 13/13, e2e credentials 16/16
    on 1280 and 390 with no provider call. Fail-before: removing the Worker BYOK check fails 4 unit tests, removing
    the fence's BYOK check fails the DB BYOK test.
- **Fix passes.** FixA (privileges, slug, payment locks): signature-based catalog, relkind and
  `serialization_failure` sweeps, non-demo-only slug lock, unique safe prefixes with an in-migration backfill,
  membership-before-tenant claim lock, two-minute busy window for `sent`/`unknown`, audited count mismatch;
  `tests/db` 253/253, unit 307. Fail-before: the old claim fails the deterministic deadlock test, the old
  `payment_busy` fails the busy-window test; the 25-round stress test did not reproduce the deadlock with the old
  claim (stress coverage only). FixB (discount, label, hosts): per-courier ceiling with a batch maximum, version in
  force at `quoted_at`, equality for `provider_observed`, missing Bahasa copy, barcode never clipped, unsaved preview
  hidden in print, shared host mode gated by `HOST_SHARED_MODE`, Bahasa 404, production build requires origins;
  `tests/db` 241/241, unit 315, e2e hosts and marketing all pass, discount and label 11 of 12 on both projects (the
  twelfth needed the lead's wording line, applied). Fail-before: the worst-case barcode e2e fails with the old layout.
- **Lead integration.** The lead owned `tests/db/privileges.test.ts`, the lead wired the contact-picker notice and
  `?kontak=` search in `pengiriman/[id]/page.tsx`, applied the label wording, made the isolation e2e compare tenant
  identity instead of reference text, and recorded DEC-019. Verified on the merged tree: `pnpm typecheck` clean,
  `pnpm test:unit` 411 tests in 22 files, `pnpm test:db` 318 tests in 23 files. Not re-run on the merged tree:
  build, cf:build, check:bundle, `smoke:worker`, any Worker e2e, the full Playwright suite.

**Process incidents**

- Relative-path edits that landed in the main tree and were restored: wave A T-036 (`src/middleware.ts`, reversed
  at once), wave B T-033 (`src/lib/mengantar/public-api.ts`, restored to its HEAD blob), wave D T-043
  (`public-api.ts`, restored from the worktree copy, byte-identical) and FixB (`tests/db/gerai-discount.test.ts`,
  restored byte-for-byte). All later edits used absolute worktree paths.
- `next dev` and `next build` rewrote the `AGENTS.md` heading in several worktrees; each worker reverted it.
- Early real sandbox calls: the first T-039 unit run did not stub `fetch` and made 3 to 5 real HTTPS calls to
  `sandbox.mengantar.com` with a FAKE Partner secret from its fixtures (answered UNAUTHORIZED; nothing was stored,
  no real secret involved); a global fetch stub was added and later runs could not reach the network.
- The T-044 worker stopped its own dev server with `pkill -f "next-server"`, a pattern broad enough to kill the
  shared app server on port 3110; it reported this to the lead and ran no further `pkill`.
- Parallel workers reset the shared database mid-run, which produced transient failures (PostgREST `PGRST002`,
  wrong credentials, missing grants); affected specs were re-run under a shared lock, and a readiness poll was added
  to the privileges test.
- The privileges catalog test is lead-owned, so every wave's DB run showed the same expected allowlist failures
  until the lead added each task's functions.

**Open after this entry**

- Superseded by the waves E/F entry below: T-050 and T-053 are now merged, including environment scope,
  key ring, discount recording, masking control and shipment pending/confirmation states.
- Owner-gated: supervised sandbox payment, key regeneration and pickup with response capture (T-048), Mengantar
  written answers, the courier test of the masked label, the pilot log, counsel review, the Terms and Privacy
  document URLs and versions, a real staging Supabase project, the wilayah decision.
- Code work remains in T-054 (Partner retry-after, owner TOTP recency, unpaid-batch lock order),
  T-055 (enforced script CSP/final runtime gate), T-056 (unknown-payment and ambiguous-reservation closes),
  T-057 (rewrap trigger/SQL consent/environment), T-058 (OTP verification state/CAPTCHA) and T-059
  (DB-suite flake/Worker expect-timeout policy). T-041/T-051 integration gaps are closed; the final-build
  full Worker e2e covered tablet-768 as well (STATUS.md). T-043 stays open for T-048 item (6)'s supervised capture.

## 2026-10-28 — Waves E and F merged; independent reviews and Worker-runtime findings

Observed on disk: migrations `20261028230000_environment_scope_key_ring.sql`,
`20261028240000_discount_recording_and_ui.sql`,
`20261028250000_reconcile_across_key_regeneration.sql` and
`20261028260000_pickup_known_time_ids.sql`, with their Worker/UI callers and tests. No deployment,
provider write, build or test was run by this documentation pass. Counts are recorded by the lead
in STATUS.md after the final run; the figures below are **worker-reported**, not final merged counts.

### Wave E — environment/key ring and shipment UI

- **T-050:** key-ring bindings `CREDENTIAL_KEYS` and `CREDENTIAL_KEY_CURRENT`; opening by stored
  encryption version; single-key v1 path; rewrap library and machine-only fenced/audited RPC;
  `provider_env` on credentials/onboarding; environment guard and build-only staging deploy script.
  Worker-reported checks: typecheck, build, cf:build and check:bundle passed; unit **429**;
  full DB **330 of 332 before the allowlist update**; removing the machine-key environment predicate
  failed two environment-scope tests. No e2e was run. The real `wrangler.jsonc` check failed as expected:
  preview and staging share a Supabase project. Owner must create separate staging; no rewrap trigger
  exists yet, and production must switch to ring bindings at first rotation.
- **T-053:** nullable provider-discount basis points recorded without changing `record_live_quotes`'s
  six-argument signature; tenant-admin-only cost/detail/settings views; reconcile-only payment panel;
  pending/duplicate-click states and confirmations; capability/aal2-guarded masking admin page.
  Worker-reported checks: typecheck, build, cf:build and check:bundle passed; unit **416**;
  discount DB **7/7**; full DB **323 of 325 before the allowlist update**; shipping, credentials,
  masking-admin and gerai-discount e2e **76/76** on desktop-1280 and mobile-390.
  Removing provider-first observation coalesce failed four of seven targeted DB tests.
  The worker reported the zero-count dispatcher change for the lead; the lead implemented it:
  complete per-order reads decide paid/rejected/unknown, with `payment_not_applied` when none paid.

### Independent waves C/D/E reviews — static, no Critical or High

Security verdicts: T-034, T-038, T-039 and T-050 approved with fixes; T-053, FixA, FixB and
the lead's zero-count branch approved. Mediums were pre-CAPTCHA account lockout, regeneration
stranding earlier operations, and a local refresh 429 deleting sessions. Lows covered onboarding
during unknown rotation, SQL consent/version and caller-environment gaps, rewrap downgrade,
the missing rewrap trigger and stale-check ordering.

General verdicts: T-043, T-047, T-051, shipment UI and lead edits approved with fixes; FixB
approved with a Low fix; local scripts approved. Mediums were contradictory pickup refusal copy,
read-back adopting a sibling/day's slot, missing pickup-intake coverage, stale documentation and
T-043 marked complete without supervised capture. Lows covered distinct release reasons, oversized
time-list pre-checks, audit labels, export language/paging, invoice COD wording, invalid-form
button locks, stale change-email errors, duplicate membership reads, operator payment guidance,
contact-search behavior and origin/build documentation.

### Wave F — applied fixes and worker checks

- **F1 security:** account-plus-visitor checks precede Auth; password account-wide budget follows
  Auth's CAPTCHA step, with a successful over-budget result signed out; code requests no longer
  spend an address-wide pre-CAPTCHA budget. Local refresh refusal is **503 + Retry-After 60**,
  retains the session and uses shared forwarding configuration; demo entry refuses retryable
  identity failure. Reconciliation uses an active same-environment Partner key after regeneration
  but never crosses BYOK/mode/environment; begin/complete block `rotation_unknown`; rewrap cannot
  downgrade; stale operations expire before key lookup; code errors follow their original email.
  Worker-reported: typecheck, build, cf:build and bundle passed; unit **458**; regeneration DB
  **10/10**; full DB **349/349 once**, after two other full runs flaked in cod-and-payment/issuance.
  The first attempt also found and fixed the worker's own stale-fence/rewrap ordering error.
  Auth-demo e2e: desktop **20 passed, 1 skipped**, mobile **21 passed**. Registration/members and
  the new change-email assertion were not run by F1 because the shared relay targeted the main Worker.
  Fail-before proofs reported: restoring 429 lost the auth-js session; removing the migration
  failed eight of ten regeneration tests.
- **F2 pickup/UI:** final shipment state wins over phase copy; read-back excludes sibling time ids
  and uses one date per row (UTC clock match, otherwise WIB); oversized lists count as reachable
  only for the pre-check, not reconciliation. Added distinct write-ahead messages, pickup-intake
  e2e and courier-filter unit coverage; invoice/export audit labels/filters and default snapshot
  suppression; `(created_at,id)` export keyset paging; Bahasa not-found; corrected invoice COD
  sentence; validation-aware submit locking; one membership query; operator escalation text;
  contact punctuation/phone normalization and selected-contact retention; production `appHref`
  fails without exported `APP_ORIGIN`. Both deploy scripts require that build variable.
  Worker-reported: unit **456**; full DB **340 of 341 before the allowlist update**; typecheck,
  build, cf:build and bundle passed, but unit/build checks preceded final small edits and were
  not repeated; typecheck passed again afterwards. The locked 390/1280 e2e run had **77 passed,
  1 skipped, 2 failed** (the new pickup test raced its own save); after polling was corrected,
  pickup intake and existing detail tests passed on both projects. Removing date/id-exclusion
  fixes failed the new unit cases; invalid-reason masking e2e failed without the button fix.

Lead-reported integration: the privilege allowlists were regenerated from the real database
catalog, not guessed from migration text; the differences matched workers' reported signature
changes. Disk now includes the environment-qualified credential writers/read,
`rewrap_seller_credential`, `platform_tenant_masking` and `dispatch_pickup_known_time_ids`.
F1's private `operation_credential` remains revoked from every API role. This records the
catalog update, not a passing final suite; final results belong to STATUS.md.

### Worker runtime — observed on the pre-wave-F production build only

Smoke first returned 404: production-build loopback access requires `HOST_SHARED_MODE=1`.
`scripts/dev-env.sh` now writes it and four local origins to `.dev.vars` (default Worker `:8787`,
`LOCAL_WORKER_ORIGIN` override); `scripts/worker-smoke.sh` passes `--var HOST_SHARED_MODE:1`.
Smoke then passed `/healthz` and `/masuk` with 200. `/anggota` also threw when its `APP_ORIGIN`
link was built without configuration: the production guard worked, and local origins were added.
Only `APP_ORIGIN` has current application link callers; the other three origin names are mapped
by the generic helper but do not have current callers, and marketing uses a fixed apex constant.

Lead-reported full desktop-1280 Playwright against `wrangler dev`, `E2E_PRODUCTION_BUILD=1`:
**137 passed, 2 skipped, 3 failed** (members). Server Actions took **2.6–6.4 seconds** in local
workerd, beyond the default five-second expect timeout; the revoke case passed with 20 seconds.
Separately, the Auth Send Email Hook relay targeted stale Node `:3110`, so the Worker received no
code mail. Retargeting `AUTH_HOOK_TARGET=http://127.0.0.1:8787` and using the 20-second expect
timeout produced **29 passed, 1 skipped** for members/registration/auth-demo on desktop.
Final-build Worker e2e is **recorded by the lead in STATUS.md**; this pre-F run is not final-build
or all-viewport proof. T-059 owns a config-only local-workerd expect-timeout policy.

### Process incidents and open unknowns

- Four earlier relative-path edits hit the main tree and were restored (details in the preceding
  entry). T-039's early unstubbed unit run made 3–5 real sandbox HTTPS calls with a fake secret
  (UNAUTHORIZED, no stored result/real secret); a global fetch stub fixed that test isolation.
- A worker's broad `pkill` stopped the shared app server once; the lead restarted it.
  Shared-database resets also disrupted unlocked runs; affected checks used a lock afterwards.
- T-050 and T-053 needed lead-approved edits outside their original paths; the lead integrated
  the shared shipment/settings changes. `next dev`/build rewrote `AGENTS.md` in worktrees and
  workers restored it. No such source/config changes were made by this documentation pass.
- **Unknown:** the two F1 full-suite cod-and-payment/issuance `account_busy` failures are unexplained.
  Isolated files and one full run passed; shared-state/order/timing is only a suspicion, not
  an established cause or proof of harmlessness. Repeat the whole serialized suite in CI (T-059).
- Still open: `reservation_ambiguous`/unknown-payment closes (T-056), SQL consent versions and
  reconcile `p_env` plus scheduled rewrap (T-057), unbound verify-email state and CAPTCHA-less
  OTP budget exhaustion (T-058), T-054/T-055, owner staging/provider/counsel gates.

### Final independent reviews of fix wave F (read-only; no Critical/High)

- **Fixed by the lead after review:** (1) `src/middleware.ts` now answers **503 + Retry-After 60** itself when
  the refresh was refused locally, instead of letting the request continue with expired cookies (downstream
  clients would have refreshed unthrottled); (2) the public copy "Label resi dicetak dari GeraiExpress" was
  reverted to the neutral "Versi ini melayani drop-off: paket diserahkan oleh gerai ke kurir. Resi tercatat di
  halaman kiriman." in `src/app/page.tsx` and `src/app/fitur/page.tsx` (courier acceptance unproven, DEC-017), and
  the marketing test asserts no "label resi dicetak" claim.
- **Open, queued in TASKS.md:** T-060 (a correct password beyond the account budget is still detectable through
  sign-out cookie headers; one visitor can spend the account-wide sign-in budget with ten CAPTCHA-solved
  misses per minute; a throwing limiter becomes a retryable fetch error and waits about 25 s; `authClient()`
  lacks `onRefusal`; whether Auth skips CAPTCHA for `sb_secret_` requests belongs to the forwarding proof);
  T-057 (`record_partner_seller_onboarding_outcome` can overwrite `rotation_unknown`); T-061 (the environment
  guard does not validate `APP_ORIGIN` of deployable environments; the top level is `""`); T-056 (pickup copy
  contradictions for a reserved phase with `PICKUP_TIME_INVALID`, `PICKUP_NOT_FOUND`, `QUOTE_STALE`,
  `CLOSED_NOT_CREATED`; a fresh reservation can adopt another shipment's slot before its owner stores the id).
- **Doc corrections:** read-back with no match records `not_created` (not `reservation_ambiguous`); the stale
  `marketing-data.ts` comment was fixed in source; tablet-768 is covered by the final-build full Worker e2e
  (STATUS.md: 142 passed / 2 skipped on each of desktop-1280, mobile-390 and tablet-768).

## 2026-10-29 — Hosting change (DEC-020) and Supabase versus plain PostgreSQL recommendation

- **Owner decision:** "gak jadi pakai vultr + coolify + cloudflare". Answers: runtime = self-hosted
  Docker + Node (`next start`) on a server the owner controls; scope = only the Worker hosting is dropped
  (Cloudflare Turnstile stays); Supabase question = asked for the assistant's recommendation (below).
  Recorded as DEC-020; DEC-011 and ADR-0001 are superseded (never built); DEC-005's adapter part is
  superseded; the former T-052 egress gateway is cancelled (a fixed server address makes it unnecessary);
  T-062 (runtime) and T-063 (production mail transport; Cloudflare Email Sending needs a Worker binding)
  are the new tasks. Nothing is provisioned.
- **Recommendation (Proposal, not a decision): keep Supabase now; do not move to plain PostgreSQL.**
  - Observed coupling (counted on disk 2026-10-29): 33 migrations; RLS policies and 57 `auth.uid()` uses
    in the migrations; 99 `.rpc(` calls in `src`; the database suite (351 tests) proves tenant isolation
    through real Supabase user sessions and PostgREST; Auth owns sessions, OTP, the Send Email Hook,
    TOTP/aal2 for the Super Admin, and the `pg_cron` demo cleanup runs inside the database.
    Plain PostgreSQL would mean building an auth service, an API layer in place of PostgREST/RPC,
    session and MFA handling, and re-proving isolation: a rewrite of the security core for no product gain.
  - What "big client because of Mengantar data" changes is operations, not the engine: backups with
    point-in-time recovery, restore drills, region and data-residency review (counsel; Unknown), access
    logging, and a separate project per environment (T-050). Those are needed under either choice.
  - Options: (A) Supabase Cloud, a paid plan with PITR, region near Indonesia: least work, fastest to
    production, but data sits with a foreign processor (counsel to confirm under the Indonesian
    personal-data law; Unknown); (B) self-hosted Supabase (Docker) on an owner-controlled server: same code
    and tests, data on the owner's infrastructure, but the owner runs about ten containers, backups,
    upgrades and Auth key rotation (a real operations load for a small team); (C) plain PostgreSQL with an
    own auth stack: rejected for now. Chosen path if the owner agrees: start on (A) for the pilot, keep
    every migration plain SQL (already true) so (B) stays a deployment change, and revisit when volume,
    residency advice or cost says so. Pricing, plan limits and current self-hosting guidance were NOT
    re-verified in this entry (Unknown: check the provider's current pages before choosing).

## 2026-10-29 — T-062 self-hosted Node runtime replaces Cloudflare Workers (DEC-020)

Built in a throwaway worktree, uncommitted. What changed: `output: "standalone"`, a multi-stage non-root
`Dockerfile` (Node 24.21 slim pinned by digest, corepack pnpm, bundle scan inside the build, `/healthz`
HEALTHCHECK), `.dockerignore` allow-list, `compose.yaml` (app, scheduler, Caddy proxy; only the proxy
publishes ports) with `compose.local.yaml` (plain-HTTP `proxy-local` on 127.0.0.1:8080, scheduler opt-in
through `GX_SCHEDULER=1`), `infra/proxy/Caddyfile` and `Caddyfile.local`, `infra/scheduler/scheduler.mjs`,
`infra/env/*.env.example`. Code: `src/lib/config.ts` (one reader, replaces `worker-secret.ts`),
`src/lib/client-address.ts` (X-Real-IP only, `TRUSTED_PROXY=1`, last value), `src/lib/limiter.ts`
(in-process fixed window, 10 000-key cap per limiter, fail closed when full), `src/lib/cron.ts` +
`src/lib/mengantar/scheduled.ts` + `src/app/api/internal/cron/[task]/route.ts` (ported `scheduled`
logic and log events), internal host scope in `src/lib/hosts.ts` (`*.workers.dev` no longer served).
Removed: `@opennextjs/cloudflare`, `wrangler` (lockfile -2066 lines), `open-next.config.ts`,
`custom-worker.ts`, `wrangler.jsonc`, `worker-smoke.sh`, `deploy-*.sh`, `tests/unit/custom-worker.test.ts`
(ported to `tests/unit/cron.test.ts`), the `deploy-staging.sh` test in `hosts.test.ts`.

Decisions: missing proxy address stays fail closed (no shared sentinel bucket); the middleware stays an
Edge-runtime `middleware.ts` (the build lists it as edge chunks), so only `REFRESH_LIMITER` is spent
there and a second table exists for it when Auth IP forwarding is on; `middleware` to `proxy` migration is
now possible and not done. Mailpit transport also accepts `host.docker.internal` (container to local stack).

Evidence (commands run from the worktree root): `pnpm install --frozen-lockfile` OK; `pnpm typecheck`
clean; `pnpm test:unit` 34 files at the time of the run, all tests passing (final count in the lead's
report); `pnpm build` produces `.next/standalone/server.js`; `pnpm check:bundle` PASS with 4 env secret
values checked against the build; `pnpm check:environments` PASS on the committed templates (with
`docker compose config`); `docker build` OK (first build 10 min, install layer cached afterwards); the
container ran healthy behind `proxy-local`: `/healthz` 200, `/masuk` 200, wrong host 404, `/api/internal`
404 through the proxy, and the scheduler container's first tick called dispatch with status 200 and the
app logged the same `dispatch_sweep` event as before. Real Caddy 2.11.2 harness against an echo backend:
a forged `X-Real-IP`, `X-Forwarded-For`, `Forwarded`, `CF-Connecting-IP`, `True-Client-IP` never reached
the upstream (it saw the TCP peer), `/api/internal` answered 404 in five spellings including encoded
and mixed case, the local profile turned a private peer's `X-Forwarded-For` into `X-Real-IP`.
Full `tests/db` through `/tmp/gx-db-verify.sh`: 347 of 351 passed with the scheduler container ticking
against the shared database; the 4 failures (3 in cod-and-payment: the known `account_busy`/timing
family, 1 in isolation: extra tenants visible) passed on an immediate rerun of both files (43/43) with
the scheduler stopped. Lesson: do not run the scheduler container while DB suites or e2e run.

## 2026-10-29 — T-062 runtime security review corrections

The second pass was built in `/home/ongki/Projects/.gx-wt/RuntimeFix`, uncommitted. Production proxy
ports now bind IPv4 explicitly; release requires A records only, no AAAA, until native IPv6 is proved
end to end. Private client addresses remain valid: rejecting them cannot recover an address lost by
Docker NAT and would deny legitimate LAN clients. The local proxy trusts only its pinned
`172.30.62.1/32` gateway, not sibling containers; e2e visitor addresses use TEST-NET ranges.

Limiter saturation evicts expired windows first, then the oldest non-exhausted live window; exhausted
windows are never evicted. All-exhausted tables fail closed. Account tables allow 100 000 keys, visitor
tables 10 000. `rate_limiter_saturated` is emitted at most once per minute per table, without keys.
Production Compose requires `GX_ENV_FILE`; local wrappers set their own local file. Config treats
whitespace-only values as unset, configured secrets must be at least 32 characters, and CRON_SECRET
is required in real environment files. Templates may contain only blank or placeholder secrets.

Every service has bounded Docker `local` logging (10 MB × 3) and a read-only root. Executable app code
is root-owned; only its cache is app-owned. Caddy uses tmpfs and persistent data/config volumes, dropping
all capabilities except NET_BIND_SERVICE. Cron deadlines abort both Supabase and provider fetches and
expire the in-process lock; an old completion cannot release a newer run's lock. The obsolete
`public/_headers` was removed and image builds support an empty public directory. Historical release
records remain, but Worker rollback/deploy recipes are no longer active instructions. The old hosted
preview still exists remotely: an owner must disable/delete it and rotate its secrets before cutover.
Accepted gaps are explicit: no inherited Cloudflare DDoS/WAF/bot protection, no rate-limit module in the
official Caddy image, a 1 MB request-body ceiling, one egress address seen by Supabase Auth while client
IP forwarding is off, and one-app-instance limiter correctness only.

Verification from that worktree:
- `pnpm install --frozen-lockfile`, `pnpm typecheck`: PASS.
- `pnpm test:unit`: 35 files, 575 passed, 0 failed; final runtime-file assertion rerun: 13 passed.
- `APP_ORIGIN=http://127.0.0.1:8080 pnpm build`, `pnpm check:bundle`: PASS; standalone output exists,
  38 client files and 4 local secret values scanned. `pnpm check:environments`: PASS.
- `docker build --build-arg APP_ORIGIN=http://127.0.0.1:8080 -t gx-runtime-fix:local .`: PASS.
  `GX_IMAGE=gx-runtime-fix:local COMPOSE_PROJECT_NAME=gxruntime KEEP=1 pnpm smoke:container`: 9/9 probes.
  `GX_ENV_FILE=.env.container docker compose --env-file .env.container config --no-env-resolution -q`:
  PASS; missing GX_ENV_FILE was separately refused. Offline production Caddy validation: PASS.
- Real Caddy echo harness: gateway-only TEST-NET override accepted, sibling IP spoof rejected,
  three internal-path spellings return 404, oversized body returns 413. Non-root image probe proves
  executable code is root-owned and unwritable while the cache is writable.
- `/tmp/gx-db-verify.sh`: 26 files, 351 passed, 0 failed, with the scheduler OFF and an owned email relay.
- Before each browser command, `/tmp/gx-db-verify.sh tests/db/isolation.test.ts`: 24 passed. Full suites
  used `flock /tmp/gx-db.lock env E2E_BASE_URL=http://127.0.0.1:8080 E2E_PRODUCTION_BUILD=1 pnpm exec
  playwright test --config=playwright.runtime-check.config.ts --project=<project>` and a temporary copy
  of the normal config with a 20-second expect timeout: desktop-1280 142 passed / 2 skipped / 0 failed;
  mobile-390 final run 142 passed / 2 skipped / 0 failed. Existing viewport/live-provider skips remain.
  The first mobile run was 141 passed / 2 skipped / 1 failed: invoice-export read the print-event count
  synchronously after observing a snapshot, although the action uses two consecutive RPCs. The test
  now polls the same exact event-count assertion; no assertion, privilege, or product behavior was removed.

No migrations, privileges-test changes, new dependencies, provider calls or deployment. Temporary
proxy harnesses and Playwright config were removed; the owned relay and Compose stack were stopped.

## 2026-10-28 — T-064 merged and T-065 owned auth core (DEC-021, uncommitted)

T-064 was developed in the worktree `/home/ongki/Projects/.gx-wt/PgFoundation` from a snapshot of this tree; the
main tree had not changed the files it touched, so its patch and new files were applied here as is. T-065 was
built directly in this tree: migration `20261029100000_auth_core.sql`, `src/lib/auth/**`, `tests/db/auth-core.test.ts`
and the port of the nine GoTrue-era DB tests onto `createAuth` (the `pending-auth` folder is gone). Three separate
workers wrote the primitives, the SQL-level tests and the service; the lead wrote the migration and verified.

Design points worth keeping: the signup gate runs inside `auth_issue_otp` (no user row or code before it passes);
codes carry a cumulative 20-guess hourly budget so asking for a new code never resets attempts; refresh tokens are
stored only as SHA-256 hashes, so a replay inside the 10-second window answers `recent_reuse` without a new token,
older reuse revokes the session; session lifetime is clamped in SQL (7 days, 12 hours for platform-grant holders);
`auth_mfa_verify` moves a session to `aal2` and replaces its refresh hash in one statement; banning or soft-deleting
a user revokes every session by trigger. A corrected defect: the first seed used standard base64 in its scrypt
fixtures, which the owned password verifier (base64url, matching the SQL regex) rejected; the seed now uses base64url.

Verification (lead, uncommitted tree): `pnpm typecheck` clean; `pnpm test:unit` 41 files / 746 tests;
`scripts/db-verify.sh` from a dropped database applies 35 migrations and passes `tests/db` 27 files / 410 tests.
Not run: browser e2e (the application does not use the auth module until T-066), the container image, any review.

## 2026-10-28 — T-066 application cutover to PostgREST and the owned auth (uncommitted)

The lead wrote the contract layer (`src/lib/db/**`, `src/lib/auth/instance.ts`, `src/proxy.ts`, `src/lib/db/refresh.ts`)
and four workers migrated the call sites, rewrote the auth actions, wrote the proxy/session tests and moved the
infrastructure; a fifth updated README, ARCHITECTURE, OBSERVABILITY and RELEASE.

Decisions: the middleware became `src/proxy.ts` (Next 16 runs it on Node, so it shares the auth module with the
Server Actions; Edge would have forbidden `node:crypto`); only the proxy rotates tokens, so a server component never
sets a cookie; a refused or inconclusive refresh answers 503 + Retry-After and keeps the cookies; the 10-second
`recent_reuse` answer carries no new refresh token, so the proxy sets only the access cookie; session audience for a
new session follows the host/route family, and SQL still caps platform-grant sessions at 12 hours. TOTP QR codes use the
MIT, dependency-free `qrcode-generator` (added deliberately: a QR encoder is not a few lines). `@supabase/postgrest-js`
moved to `dependencies`. CAPTCHA is enforced whenever `TURNSTILE_SECRET_KEY` is set; without it the stack must set
`AUTH_CAPTCHA_DISABLED=true`, which `check:environments` refuses outside the local environment.

Defects found by running the container e2e and fixed: the seeded Super Admin TOTP factors held placeholder text the
application could not open (every admin sign-in failed; `scripts/db-seed-totp.mjs` now seals the fixture secrets under the
stack's AUTH_SECRET, with a unit test that the application opens them); the e2e admin helper reused a TOTP time step the
replay guard had already accepted (it now picks a newer step); a discount spec measured touch targets while a dialog was
still fading (it waits for the dialog to close). `db/review-fixture.sql` was recreated by the Infra worker after the
untracked original was deleted; it matches the worktree copy apart from the local-database guard and the apply command.

Verification (lead, uncommitted tree): `pnpm typecheck` clean; `pnpm test:unit` 47 files / 817 tests;
`APP_ORIGIN=http://127.0.0.1:8080 pnpm build`, `pnpm check:bundle`, `pnpm check:environments`; `scripts/db-verify.sh` from a
dropped database twice (before and after the seed change): 35 migrations, `tests/db` 27 files / 410 tests; Docker build and
`pnpm smoke:container` 9/9; Playwright against the container, full suite: desktop-1280 142 passed / 1 failed / 2 skipped,
mobile-390 143 / 0 / 2, tablet-768 141 / 2 / 2. The three failures passed when rerun alone; cause unconfirmed (shared
in-process sign-in budgets on one fixture account are the suspect, T-059). Not run: a second app instance, a real
Turnstile widget, production Compose with a database host, any live Mengantar call, any independent review of the owned auth.

## 2026-10-28 — T-067 first review wave and fixes (uncommitted)

Two separate read-only agents reviewed the owned auth and the cutover (`security-reviewer` and `reviewer`); a third
worker rewrote docs/spec, DECISIONS.md and ADR-0002 to the current stack (spec traceability PASS, 16 files, 212
declarations, 41 tasks, 0 findings before and after); a fourth wired `auth_purge_expired` into the hourly cleanup and
found the e2e flake root cause.

Security review: 0 Critical, 0 High, 3 Medium, 4 Low (see TASKS.md T-067 for the list and what was accepted). The one
finding worth remembering: the database trusts JWT claims only, so a revoked session stayed usable for the token's
remaining life wherever the app skipped `currentUser()`; `dbServer()` now requires a live session and the cookie-less
scopes no longer forward `gx_at`. Second finding: the refresh table kept one previous hash, so two quick rotations
erased a stolen token's trace; migration `20261029110000_auth_hardening.sql` keeps every retired hash (cap 50), also
requires a live keep-session in `auth_set_password`, clamps an aal2 upgrade to 12 hours and allows one TOTP factor per
user. Timing: a >256-character password used to skip scrypt for known accounts; it now runs the dummy scrypt first.

E2E flake root cause (evidence in the worker report): `SIGN_IN_ACCOUNT_LIMITER` is account-wide (10 per 60 s, spent on
every sign-in including successful ones), and the specs signed `owner-a@` in 43 times and `admin@` in 12 times, with
clusters above 10 within a minute; two specs also lacked the per-test visitor address fixture. Fixed on the test side only
(distinct fixture accounts, the fixture import, a per-account window guard in `signIn`); production limits unchanged.

Verification (lead, uncommitted tree, after all fixes): `pnpm typecheck` clean; `pnpm test:unit` 49 files / 831 tests;
build, `check:bundle`, `check:environments`; `scripts/db-verify.sh` from a dropped database, 36 migrations, `tests/db`
27 files / 412 tests; image rebuilt, `smoke:container` 9/9; full Playwright against the container: desktop-1280,
mobile-390 and tablet-768 each 144 passed / 2 skipped / 0 failed. Not done: second review of the fixes, RELEASE.md backup
and restore drill and rotation gates, `scripts/db-backup.sh`.

## 2026-10-28 — T-067 second and third review wave, completion work (uncommitted, session paused)

Second review (`security-reviewer`) of the first fixes: 0 Critical/High, 1 Medium, 2 Low. The Medium was real: the 50-entry
cap on retired refresh hashes let a long-stolen token leave the history, after which its reuse answered `invalid` instead of
revoking the session. A count cap cannot work (a legitimate session rotates roughly a thousand times in seven days), so retired
hashes moved to `auth.retired_refresh_tokens` (migration `20261029120000`, primary-key lookup, cascade with the session).
The Low items: the GIN index did not serve `= any(array)` (gone with the array) and libpq query parameters could override the
`authenticator` identity in `PGRST_DB_URI` (`check-environments` now allows only `sslmode`, `sslrootcert`, `connect_timeout`,
`application_name`). A third review of the delta found one Medium (a concurrent refresh could append to the old column
between backfill and drop; the migration now locks `auth.sessions`; because that file was edited after its local apply, a
dropped database is needed once and `db-verify` does it) and one Low (a malformed `DATABASE_URL` could print the password
through the Node parser error; parser stderr is now discarded). The platform Server Action inventory found no unguarded action.

Completion work done in parallel: `scripts/db-backup.sh`, `scripts/db-restore-check.sh`, `scripts/reseal-totp.mjs`, RELEASE.md
gates 11 to 17 (drill executed locally: 560835-byte archive in 1 s, restore plus check 3 s, 31 table counts and 36 migration
checksums matched, scratch database dropped); T-061 origin validation; signed verify-state cookie (T-058); visitor-plus-account
limiter ceilings of 5 per 60 s, fire-and-forget mail with a transport readiness check, platform host guards (T-060, F-04 part 2,
F-05, TEN-6). A design note: rotating AUTH_SECRET makes every sealed TOTP secret unreadable unless re-sealed, which is why
`reseal-totp.mjs` exists and why RELEASE.md describes rotation as a stop-the-writers procedure.

Verification of the final tree (lead, uncommitted): `pnpm typecheck` clean; `pnpm test:unit` 51 files / 884 tests; build,
`check:bundle`, `check:environments` pass; `scripts/db-verify.sh` from a dropped database: 37 migrations, `tests/db` 27 files /
412 tests; image rebuilt, `smoke:container` PASS. Playwright against the container (the chain hit its 3600 s limit): desktop-1280
144 passed / 2 skipped / 0 failed; mobile-390 139 passed / 5 FAILED / 2 skipped (16.2 min, much slower than the 9 minutes of
earlier runs): `auth-demo.spec.ts` 160 (mobile navigation sheet), 197 (demo reset), 253 (demo entry limited per visitor, one
minute), `gerai-discount.spec.ts` 77 and `platform.spec.ts` 6 (both an unexpected URL, the Super Admin sign-in/TOTP path);
tablet-768 was interrupted by the timeout and has NO result; the final backup/restore drill output was never produced. The
container was stopped by hand afterwards. The failures are NOT investigated. Observations to start from: the earlier full
runs on this same code path were green on all three viewports before the verify-state cookie, the lower visitor-plus-account
ceilings (5 per 60 s) and the platform host guards landed, so those three changes are the first suspects (a 5-per-minute
visitor+account budget can trip specs that sign the same account in repeatedly from one visitor, and the Super Admin failures
look like sign-in being refused); the demo limiter spec taking a full minute points at a limiter, not at the UI. NEXT SESSION:
reseed, rerun the five failing specs alone on mobile-390, read the container log for `auth_rate_limited` and
`auth_unavailable` events, then rerun the three full viewports; T-058 and T-060 stay open until all three are green.


## 2026-10-29 — T-068 backend/database hardening and Vultr + Coolify

The owner authorized continuing repairs over the existing uncommitted implementation.
Retained PostgreSQL 17, PostgREST, RLS/RPCs and application auth; DEC-022 selects Vultr +
Coolify with an initial single app instance and persistent same-host PostgreSQL. The
standalone PostgREST query builder and immutable historical SQL remain; runtime Supabase
services/hooks/SDK are absent. Retired grants are revoked by a forward migration.

Implemented atomic first-password initialization and kept-session locking, migration
manifest integrity and session-level serialization, serialized local role provisioning,
SQL-backed readiness, explicit app environment variables, inert dotenv parsing and an
internal Coolify gateway with exact edge trust. Added regression tests and disposable
local DB/browser/proxy harnesses. Corrected four concurrency-test database targets.
Current source/release/security documents agree; historical claim metadata was normalized
without changing its decision/unknown qualifiers. Details and residual limits:
[backend audit](docs/review/2026-10-29-backend-audit.md).

Executed verification:

- Unit: 53 files / 898 tests PASS with env-file loading disabled; typecheck PASS.
- Full isolated DB suite (29 files, 416 cases): PASS via executed delivery-ledger command
  `node scripts/test-backend-isolated.mjs`, after the final role-provisioning lock fix.
- Upgrade from the preceding seeded schema: 5 files / 110 tests PASS, including auth,
  privileges, isolation, first-password concurrency and migration-runner integrity.
- Production image built: `sha256:5214ee12f37d0e4e2e0ca6721b658cdf2ef5ccd8d03803fa9e5c6aa6ec36bd9a`.
  Container readiness: 200 → stopped data API 503 → recovered 200.
- Targeted auth-demo, auth-mail, registration, platform and gerai-discount browser suites:
  mobile-390 41 PASS; desktop-1280 40 PASS / 1 intentional mobile-navigation skip. The
  previously failing five mobile flows passed. Full browser matrix/tablet not rerun here.
- Real Caddy Coolify probes PASS (trusted peer, spoofed headers, HTTPS scheme, forbidden
  internal/unknown hosts, body ceiling). Base/Coolify environment guards PASS.
- Production dependency audit: 0 advisories. Spec validator: 16 files / 213 declarations /
  42 tasks, 0 findings. Changed-file whitespace/shell syntax checks PASS.

Failed intermediate runs are not hidden: initial trust-auth fixture prevented a password
negative test; fixed with SCRAM credentials. Background DB concurrency tests targeted the
wrong default database; fixed explicit targets. Full-suite runs then exposed concurrent
local ALTER ROLE updates; fixed with a maintenance-DB transaction advisory lock. The first
rerun started before the exact patch landed and retained that failure; the frozen final
full suite passed. Upgrade110 independently passed the corrected runner. An experimental
unit CLI alias and missing browser test CAPTCHA site key were test-harness errors, corrected
before reporting success. Interrupted test-resource cleanup was repaired and only the
harness-owned leaked resources removed. No shared database or existing secret env was used.

Separate agent `security_review` reviewed the source delta, fix iterations and docs against
the original snapshot; no unresolved High/Medium remained in the inspected audit changes.
Final review binds to the ledger boundary digest. General password-change credential-version
binding remains a prerequisite before exposing recovery/change endpoints. Immutable migration
artifacts, single-instance rate limits and the named production recovery/mail/provider gates
remain explicit limits.

Initial run `RUN-20261028T200837Z-d5eb4b27` finished FAIL because concurrent external pickup
module/detail-page changes occurred outside its boundary (companion handover tests were
also preserved). They are not attributed to this audit. Verification run
`RUN-20261028T202348Z-04a72f5c` records fresh checks and final boundary review over the current
baseline; the independent reviewer also assessed the full original audit delta. The first
failure remains immutable. Final required checks are refreshed after this evidence update.
No stage, commit, push, cloud provisioning, remote DB mutation or deployment was performed.

## 2026-10-29 — T-069 dashboard UI v4 (uncommitted)

Owner direction: refine every page as a modern admin dashboard with shadcn/ui and an Apple-latest tone, informed by the earlier geraicuan product. Direction record: `docs/spec/10-DESIGN-SYSTEM-WHITELABEL.md` UI-7. Reference findings: the geraicuan UI (ADR-0001 of that product) rejected glassmorphism, gradients, card-in-card and 10-12px text and kept a single frame level, 40+ operator ergonomics, a stat strip, a five-step create flow with a summary rail, tables that become record cards and a thermal label engine; those were transferred, its cobalt blue and Inter were not (this product keeps its own blue and the system stack).

Method: the lead built the tokens (status tones, red destructive, 14px surface radius), 20 shadcn primitives and the shared `AppShell`, then four parallel slice agents (list/contacts/members, intake/detail, print/settings, Super Admin) and two more (account entry, public site) rebuilt the pages against one written contract, each viewing screenshots at 390/768/1280 and running its own e2e specs; the lead tuned the shared primitives from their reports (switch 48x28, overlays without blur, Alert tones, Select trigger 44px, Bahasa pagination) and the touch-target helper (hidden Radix mirror select, padded switch). A later slice built the T-056 close dialogs against the backend contract written by the backend session. Slices ran their e2e against one shared dev server and one database at the same time, which produced several failures that passed on rerun (shared fixture rows such as the gerai WhatsApp number, `test-results` cleared by a parallel run); the final run was serial.

Verification (lead): `pnpm typecheck` clean; `pnpm test:unit` 53 files / 908 tests. The local gxdb was behind (37 of 43 migrations), which made the registration password step fail ("Kata sandi belum bisa disimpan") in every slice's run until the backend session applied the migrations. Full serial Playwright against `next dev` on 127.0.0.1:3100 after that: 147 passed / 2 skipped / 1 failed on each of desktop-1280, mobile-390 and tablet-768 (12.5 minutes each); the failure was an invitation-card text assertion in `members.spec.ts:5` that the account-entry redesign changed on purpose; the test was updated and `members.spec.ts` then passed 12/12 across the three projects. The five specs that failed on mobile-390 in the earlier container run (menu sheet, demo reset, demo limit, platform sign-in, gerai-discount) all passed in this run; the cause of the earlier failures is still not proven (they ran 16 minutes against a container while other agents were working), so T-058 and T-060 are not closed by this run alone.

Not verified: production build and container image with the new UI, real print hardware, live Mengantar and Turnstile, the Super Admin overview with suspended or provisioning data, approve and reject of an application end to end. The public pages' independent visual review ended REVISE after five rounds on one finding (no owner photo slot; owner decision), so the design gate fails by design until a photo exists. Incident: the lead's edit to `pickup-status.ts` and the detail page during the Codex audit made that audit's first ledger run fail its boundary; the Codex session preserved and excluded those edits.

## 2026-10-29 — T-070 to T-077 follow-up wave (uncommitted)

Breakdown: `docs/review/2026-10-29-next-work-breakdown.md` (non-canonical view), contracts UX-14 and UX-15 in `docs/spec/17`, tasks T-070 to T-077 in TASKS.md. Done: T-070 (post-confirmation handoff: result strip with copyable resi, "Cetak label", "Buat pengiriman lagi", sticky action bar below 640px; nothing printable for unpaid, unknown or failed), T-072 (shared Select through `choice-select.tsx` with an e2e `chooseOption` helper, area picker as a keyboard combobox; handover radio cards and the list status filter stay native with reasons written beside them), T-073 (`tests/e2e/a11y.spec.ts`; six findings fixed: focus return after dialogs opened from plain buttons, sticky bar clipping at 320px, settings button overflow, stat-strip label spill, list reference truncation, unlabeled scroll region), T-074 (`scripts/size-report.mjs`; framework floor 168 KB gzip, detail and intake 249 KB; budgets in ARCHITECTURE.md), T-075 and T-056 (backend migrations `20261029190000` and `200000`, close dialogs hidden until the attempt is 30 minutes old, `/undangan` shows the inviter), T-077 (`platform-decisions.spec.ts`: approve, reject, suspended and provisioning overview, registration switch, audit details; fixtures removed after each run).

Process notes: backend work moved between three sessions (Codex until its usage limit, a short-lived backend task agent that was cancelled to avoid collision, then the Claude session in the sibling tmux pane); UI agents and the backend session ran concurrently against one machine (load average 12 to 21), which produced timing flakes that passed in isolation (for example `registration.spec.ts:122` failed once under load, then passed 3 of 3 alone). The serial final run below ran with all agents finished except the backend session's idle pane.

Verification (lead): `pnpm typecheck` clean; `pnpm test:unit` 53 files / 908 tests; `pnpm build` and `check:bundle` pass; full Playwright serial run against `next dev` on 127.0.0.1:3100, 167 tests per viewport: desktop-1280 164 passed / 3 skipped / 0 failed (15.0 min), mobile-390 163 / 4 / 0 (14.6 min), tablet-768 162 / 5 / 0 (13.9 min). The five mobile-390 specs that failed in the earlier container run passed here; their original cause is still not proven, so T-058 and T-060 stay open. Spec traceability PASS (16 files, 225 declarations, 51 tasks, 0 findings).

Not verified: container image and `smoke:container` with the new UI, real printer output, live Mengantar and Turnstile, LCP/INP. After this entry the owner approved T-071 and chose to leave T-076 UNVERIFIED for now; T-071 (`/pengiriman/cetak`, current-page selection, shared sender city for masked batches, per-shipment snapshot and print events) was built, reviewed by a separate `reviewer` agent across three rounds (1 High and 4 Mediums fixed, final verdict APPROVE), and verified with 917 unit tests, `label.spec.ts` 9/9 on all three viewports, `a11y.spec.ts` on all three viewports, `pnpm build` and `check:bundle`.

## 2026-10-29 — T-078 and T-079: Dashboard at `/` and the app header (uncommitted)

Trigger: owner feedback that the UI still felt too simple and had no dashboard page; then "dashboard default, without /beranda". Contract UX-16 in `docs/spec/17`. The dashboard is the default home `/` for a signed-in gerai user (tenant host and loopback/shared mode); an anonymous visitor on loopback and everyone on the apex still get the marketing home. The gerai shell moved into `src/components/workspace-frame.tsx` so `/` and `(workspace)/layout.tsx` share it. Landings (sign-in, demo start, invitation acceptance, gerai switch, `/akses`, `/pilih-gerai`, "Buka ruang kerja") go to `/`. Dashboard code is in `src/modules/dashboard/` (pure WIB aggregation with 11 unit tests, server-rendered SVG charts with data tables, regions behind Suspense); the header is `src/components/app-header*.tsx` plus `src/modules/shell/attention.ts` (one bounded count query).

Dev environment: `next dev` runs on 127.0.0.1:3100 with `DEV_EXTRA_HOSTS=100.127.67.86` and a raw TCP forwarder (`/tmp/tcp-forward.mjs`, not in the repository) exposes it on the Tailscale address, so tests keep using loopback while the owner browses over the tailnet. `APP_ORIGIN` is unset in that run, so absolute marketing links point at 127.0.0.1.

Verification (lead, uncommitted tree, `next dev` on a machine at load average 8 to 12): `pnpm typecheck` clean; `pnpm test:unit` 56 files / 933 tests. Full serial Playwright (181 tests per viewport): desktop-1280 170 passed / 4 skipped / 2 failed, mobile-390 168 / 6 / 2, tablet-768 163 / 7 / 6. Every failure was rerun alone: tablet 12 of 12 passed; shipping 220, 235, 871, label 436 and masking-admin passed on mobile-390 and tablet-768; on desktop-1280 shipping 220 and 235 failed once more in isolation and then passed in a combined rerun with `E2E_EXPECT_TIMEOUT_MS=10000`. Cause measured, not guessed: after sign-in the Dashboard landing took 2.4 to 4.6 s to commit in dev (4 timed runs), on the 5 s default expect limit. `playwright.config.ts` now reads an opt-in `E2E_EXPECT_TIMEOUT_MS` (default stays 5 s). With it, the affected specs (shipping, workspace-states, masking-admin, label, dashboard) passed 57/57 on mobile-390 and tablet-768; on desktop-1280 56 passed and `label.spec.ts:349` and `:374` failed in the combined run, then passed 9/9 when `label.spec.ts` ran alone. Those two mutate the gerai WhatsApp fixture; shared-fixture interference between specs is the suspect, not proven.

Not verified: a clean single serial run of the whole suite at the 10 s expect limit; `pnpm build`, `check:bundle` and the route size of `/` (the dev server owns `.next`); container image with the new UI; real printers. Known visual nits: in a demo workspace the label "contoh" repeats on every figure; "Buat pengiriman" appears in both the top bar and the page header; the shipment detail page keeps its own breadcrumb beside the header one.

## 2026-11-02 — T-037 bounded cross-project review before further development

Owner requested a fresh Geraicuan review and research screening before further GeraiExpress development, followed by review/audit, repairs, verification and canonical-document updates per task. Report: `docs/review/2026-11-02-cross-project-improvement-review.md`. This is a documentation-only R1 slice of T-037, not completion of its broader release-correction contract.

Baselines: GeraiExpress `f8746c6` with pre-existing research/spec changes preserved; Geraicuan local `origin/main` `0ab05ea`, inspected in the integration and brand worktrees. Both have unchanged tracked application source/tests/config at that commit; the primary Geraicuan checkout is stale (`3e3ebf6`) and was not used as the current reference. No remote fetch, current production probe, customer-data access or secret-file read occurred.

Findings: adapt webhook verification but replace its single platform-account identity with per-seller scope; never port the hard-coded 333-bps pricing policy; persist and reconcile original cancellation operations on unknown results; use the existing scheduler rather than admin-visit-driven status updates; distinguish staff handover facts from provider pickup scans; keep cancellation, refund, counter-payment void and earnings separate. Existing GeraiExpress label/invoice/CSV/dashboard helpers are reused instead of rebuilding them. Handover-proof/scan and quote-only prefill are proposals requiring canonical contracts/tasks, not silently authorized features. Fresh public Mengantar help/API fetches support the weight, signature, API pickup-lead and limited-refund observations; BI fetch/search failures mean QRIS figures/rates were not revalidated, and legal/provider acceptance remains owner/counsel gated.

Executed: selected Geraicuan tests using the installed project Vitest 4.1.11 in `geraicuan-brand`, with the real database variables removed and a synthetic loopback port-1 application URL: `pnpm test:integration` filtered to `mengantar-webhook`, `mengantar-settlement`, `provider-delivery-vocabulary`, `analytics-range`, `label-thermal` and `counter-quick-wins-t287`: **6 files / 115 tests PASS**, exit 0, 6.44 s (task `bf68dbf86`). HTTP transports are mocked and static renders use synthetic data; no real DB, provider, browser or hardware proof is implied. Earlier in this session GeraiExpress unit **56 files / 933 tests** and typecheck passed; traceability was **16 files / 257 declarations / 62 tasks / 0 findings**. No new regression test: observable application contract is unchanged.

Delivery: stale active envelope `RUN-20261028T204220Z-c1d101ad` closed **BLOCKED** because its captured HEAD differs from current HEAD; historical checks and implementation results are preserved, not revoked or relabelled PASS. New review run `RUN-20261102T204950Z-70286b58` owns only this report, STATUS and BUILD-LOG. Its required final checks are reference-evidence consistency and spec traceability, followed by boundary/integrity verification. The first boundary check failed on the generated `.pi/tasks` receipt/log for `bf68dbf86`, which are untracked rather than ignored. Preserve that failure; expand only their exact paths as DEL-1 verification evidence. The classifier raised effective risk from declared R1 to R2, requiring a separate read-only review before digest-bound approval. Separate read-only reviewer `0587a659-a5f3-40fb-9369-882b47a2a7a1` returned APPROVE / no issues found for this documentation slice and two receipts. The parent verified actual session metadata: `9router-fantastico` / `cx/gpt-6.1-sol`, reasoning high. The reviewer checked source claims/receipts, not runtime tests or live sources. Final metadata/digest binding remains required before run PASS; T-080 integration remains a separate R3 task. No feature code, migration, commit, push or deployment was performed.

## 2026-11-03 — T-080 regular-service integration and regression review (regular slice only)

Owner approved the bounded regular-service integration, with cargo disabled and full T-080 left open. Run `RUN-20261103T085327Z-57f4e09f` declares R3 / PR-43. Integrated 15 T-080 source/test files from the existing `feat/t-080` worktree, preserving the original new forward migration and all unrelated dirty research/specification work. No existing database is a migration target.

Initial independent read-only reviewer `d264fdd1-6723-4373-8d56-67733f212566` found no concrete correctness/security defect, but identified missing behavioral coverage of legacy NULL-weight dispatch and effective rule transitions. Added two disposable-DB/offline-dispatch regressions in the feature worktree before integration. They cover legacy confirmation/actual-weight fallback and latest effective rule B versus future C, while a valid A quote remains frozen through confirmation/dispatch. No new provider fee, minimum, half-fare, cargo route rule or stack dependency was invented.

Canonical DATA-14 now specifies rounding the heavier raw weight rather than taking the maximum of unrounded actual and rounded volume. Missing dimensions/unknown formula preserve exact actual grams and NULL volume; sub-kg values retain positive integer-gram precision. TASKS/PR-43/UX-19 and ARCHITECTURE carry the regular-only boundary.

The first two full DB iterations each passed 443/444 cases and exposed defects in the newly added legacy fixture: psql's `UPDATE 1` command tag contaminated a UUID, then an unrelated hard-coded Rp27,000 mock price disagreed with the legacy Rp9,000 charge and correctly triggered the existing mismatch guard. Fixed the fixture without weakening strict result/outbound-weight assertions or changing application/migration code. Focused corrected weight/privilege checks passed 42/42. Both failure logs are retained.

Follow-up independent review `3399952f-cc69-4745-aaa8-eb1b103c771b` accepted the source/canonical boundary and gave bounded visual PASS for the new weight rows/source links/reweigh warning at 390/1280. It found two P2 local receipt-grader defects: Python optimization removed assert-based validation, and `db/foundation` was omitted from the source manifest. Reproduced both before repair; explicit failures and foundation coverage pass two runnable regression methods, including optimized-Python tamper cases. Repair reviewer `2957899e-9617-4acf-90f0-5ce0656fe7b7` found no issues. A disconnected prior review yielded no verdict and was retried once on the same route. Old-runner passes are preserved separately, not relabelled as corrected evidence.

Final corrected-runner task `ba24c71f4` exited 0: typecheck; **58 files / 961 unit tests**; **30 files / 444 disposable DB tests**; Docker production image and client-bundle scan; **85 browser tests PASS / 1 intentional skip** across 390 and 1280, including real isolated readiness outage/recovery; receipt regressions PASS. Product/test/foundation manifests stayed unchanged during every command. Logs/JSON receipts and four final PNG captures with hashes/dimensions are retained in `.pi/tasks/t080-verification/`. Ledger executable graders validate the actual completed commands and unchanged source; they do not claim another suite execution. These are local consistency receipts, not independent tamper-resistant attestations. Fresh traceability and the full boundary bind final docs/runtime artifacts; matching final independent digest approval is required before run PASS and is owned by that run. See the T-080 report and STATUS.md. Full T-080 remains open for cargo minima/order support; T-045 reweigh ingestion and release/provider gates remain open. No commit, push, deploy, live provider request, secret-file read, real customer data or existing DB access.

## 2026-11-03 — T-080 cargo public-contract research and sandbox gate

Owner requested cargo analysis/review, external research and API study before implementation. Run `RUN-20261103T104120Z-26594853` owns a bounded documentation/evidence slice (declared R2; boundary-classified effective R3); the verified regular source and historical migrations are unchanged. Fresh official production/sandbox docs explicitly document base courier + `orders[].cargo: true` for JNE, SiCepat, Sap and iDexpress. The historical cargo order-mapping uncertainty is resolved at the documentation level, not by authenticated execution; the existing defensive cargo exclusion is not itself a defect. SAP Lite is not enabled by that fact.

Fetched four unauthenticated public tariff responses on the provider documentation's example area pair: 3PL at 1/10 kg and public estimates at 10 kg without COD/with COD_AMOUNT=100000. All JSON envelopes have success=true; numeric HTTP status was not exposed by the tool and is not claimed. Route minima were JNE10/SiCepat10/SAP5/IDX10 kg. Cargo-specific prices/net fields differ from generic regular fields; COD generic fee3329 versus cargo total-minus-price3330 remains unresolved rather than importing a rounding tolerance or fee percentage. Help5502313 (updated2026-09-24) identifies JTR10–30/Gokil10–50/IDX10–70 as minimum/maximum pairs, not regional minimum ranges; SAP alone has the detailed regional minima. A new forward configuration correction is required, never a rewrite of the verified regular migration. The secondary curated docs at d97821c do not override current primary evidence or supply a generic 100 kg cargo maximum/1 kg floor.

Canonical findings and implementation impact are appended to `docs/research/geraiexpress-mengantar-public-api.md`; raw public replies, exact URLs, official excerpts and hashes are under `docs/research/evidence/2026-11-03/mengantar-cargo/`. No app regression test is added in this research-only slice because executable application behavior is unchanged. Evidence consistency and traceability are the bounded checks. Next gate is explicit approval to use the existing sandbox seller credential via secrets-env, make bounded seller estimates/pickup-reference checks and at most one supported synthetic non-COD cargo order plus read-back. No credential/env contents, authenticated account/customer records, order write, payment, top-up, delete, production mutation, commit, push or deploy was used or authorized by the public research. Cargo and full T-080 remain open.

## 2026-11-03 — GeraiExpress dev and staged non-COD cargo transport

Owner requested GeraiExpress dev, then renewed Mengantar documentation review and implementation. The existing process on127.0.0.1:3099 has cwd `/home/ongki/Projects/99ribu`; it was not stopped, rebound or edited. GeraiExpress dev started from its own checkout on the private tailnet address on port 3100 with process-local host/origin settings. Native browser URL/title/snapshot verified the GeraiExpress public landing page. An attempted env-file presence check was blocked by the safety tool and was not bypassed; no env generation, stack reset/migration, provider credential injection or authenticated provider call was part of the dev start. Browser open initially reported an ambiguous daemon response; URL inspection confirmed it had navigated, and the subsequent title/snapshot succeeded without repeating navigation.

R3 run `RUN-20261103T114322Z-9ac39bc7` prepares explicit non-COD cargo transport in the existing feat/t-080 worktree. Cargo-specific prices/net/discount/ETA and route minimum are validated, courier-plus-class identity prevents weight/COD group collisions, and stale route-minimum evidence cannot pass as verified configuration. Creation sends base courier plus item-level cargo Boolean, refuses unsupported input locally and keeps wrong/missing mode echo or unreadable/contradictory prices UNKNOWN with no retry. Read-back preserves Boolean mode when present; absence/malformed mode is not silently regular. All cargo COD stays blocked; no guessed tolerance or fee percentage. Real shipment actions still supply regular services only. No UI/DB schema/historical migration/dispatcher activation/credential binding change is included.

The initial new cargo suite failed19/35 before implementation (16 cases already passed due to legacy fail-closed behavior). Public response fixtures are shape evidence, not account terms. The first focused run passed82/83, failing only because the old exact-shape read-back expected no cargo field where the provider fixture carries false; its assertion now explicitly retains/checks false. The run stopped before typecheck. A requirement-linked R3 scope expansion covers that existing test with unit/typecheck checks required. Seven source/test/fixture files are integrated and both red/failure logs retained under `.pi/tasks/cargo-transport/`; final main typecheck and full unit checks actually exited0 using GX_TEST_ENV_FILE=/dev/null: 59 files/1004 tests PASS. Source remained unchanged during final execution; main LSP reported zero diagnostics on all five edited TS files. Final logs are typecheck.log/unit.log in that artifact directory. Final independent review/digest acceptance must bind the unchanged surface in RUN-20261103T114322Z-9ac39bc7, not this summary; no production build, DB suite, E2E rerun or changed-UI proof is claimed for this slice. Existing Partner routes/signing/onboarding are reused after fresh public-doc comparison. The current client deliberately discards callbackSecret under PR-19; webhook readiness/persistence remains a separately accepted T-045 concern, not an implemented result of this cargo slice. First source/docs review08a3ffe1 approved with no findings, but the first finish attempt was denied for stale mandatory direct-record typecheck/unit evidence after docs/runtime updates; no completion was claimed. Direct pass logs are preserved in pre-receipt-pass. An isolated byte-identical copy of the already-reviewed regular-slice receipt runner/regressions was reused under cargo-transport (2 regression methods PASS, including real optimized-Python negatives and foundation invalidation). Fresh executionb9fc7fadb actually reran typecheck and full unit: both exit0, 59 files/1004 tests PASS, identical before/after product/test/foundation manifests. Final JSON/log receipts are in cargo-transport; executable final grading validates completed commands and never claims to rerun tests or provide external attestation. The original regular receipts stay untouched. Final docs/runtime artifacts and final independent approval remain bound by traceability and the new delivery digest. Canonical STATUS/TASKS/architecture/research/review records retain the same disabled-cargo/account-attribution gate. No commit, push, deploy, authenticated provider operation, real customer data or existing DB mutation.

## 2026-11-05 — Checkpoint before machine maintenance

Post-wave-3 hardening: T-104, T-105, T-106, T-108 merged locally (HEAD `8e3a643`, unpushed). T-109 approved
but its ledger finish was refused as stale and a chained command committed `0ed9f41` and began a merge
into the main checkout; the merge is unresolved and `git merge --abort` needs the owner. T-055, T-107,
T-110 (after review P1 fix) and T-111b gates were still running in background scripts; logs under
`/data/tmp/{t055,t107,t110,t111}`. Full resume plan in STATUS.md "CHECKPOINT 2026-11-05".


## 2026-11-06 — T-109 merged (DB follow-ups)

T-109 carried from `0ed9f41` onto the integrated head `8e3a643` as T-109b (the original run closed BLOCKED when HEAD
moved). Review GPT-6.1 Sol approved with two P2: `/healthz` now maps PostgREST 404 PGRST202 (the database predates
`schema_version`) to `schema_behind`, and the architecture diagram no longer claims a `service_role` table grant;
both with regression tests. Gates on the final surface: typecheck, unit, DB and upgrade PASS. The full e2e ran at
load 14-18 right after a Docker daemon restart and failed 16/480 (sign-in landing back on `/masuk`, Server Action
answers arriving after 5 s assertions). The 16 alone, in their failing viewports, at load 6-10: 17/17 PASS, with no
statement/lock timeout (57014/55P03) in the captured DB logs, so the failures are attributed to load, not to the new
role timeouts. A partial run is not recorded as `e2e`; the run closed BLOCKED and the full e2e is re-proved on the
M1 integrated head before any push. Merge `075cc85`.

## 2026-11-06 — T-110 merged (Partner quota + restore fence); M1 assembled

T-110 carried from base `b3a6129` onto the head with T-109 (`075cc85`); `EXPECTED_SCHEMA_VERSION` raised to
`20261105200000`. GPT-6.1 Sol review: REQUEST_CHANGES (gate runner masked failures; quota clock read before the lock;
HTTP 429 back-off depended on the body) -> fixed with regression tests -> APPROVE. On the carried head the DB suite
failed one test: the lock-boundary regression held the partner advisory lock ~15 s, and T-109's `service_role`
`lock_timeout` (10 s) cancelled the waiting reservation (55P03). The product already treats that RPC error as a
denial (fail closed); the test now waits under 10 s. Then typecheck, unit, DB 609/609 and upgrade 609/609 PASS.
Merge `ee7aebf`. M1 = T-109 + T-110 is integrated under the M1 contract: the single full e2e on this head decides
the push.

## 2026-11-06 — M1 pushed; M2 assembled (T-055, T-107, T-111)

M1 (T-109 + T-110) was pushed as `f89f3ed` only after a fresh integration run on that exact head passed typecheck,
unit, DB, upgrade and the full e2e (469/0/11). M2 tasks were carried onto it one at a time, each with focused specs:
T-055's browser-enforcement test first failed because 'strict-dynamic' trusts script elements created by trusted
script, so the probes are now parser-inserted into the real response; T-107 needed three review rounds (pending
state lost when a confirmation dialog closes and reopens, raw submits, a per-file usage test); T-111 was re-proved
on the final head with an offline install. The single full e2e on the M2 head decides the M2 push.

## 2026-11-06 — M3 pushed; T-062 closed; public-repository secret check

INT-M3 ran the full Playwright suite on all three viewports against the production container for the first time
since the runtime moved to Node (721 passed, 0 failed, 26 skipped; 249 per viewport) together with typecheck, unit,
DB and upgrade, on `ba5e1e4`; M3 (T-112 and the T-058/T-060 closure) was pushed on that evidence and it closed T-062's
last clause. The owner asked to make sure the repository is public: it already is. Before relying on that, every
revision was scanned for committed sensitive filenames and high-signal secret patterns, with a planted-fake control
repository proving the patterns fire; nothing was found. The owner chose geraiexpress.com as the domain, which the
host defaults already use; the production mail provider remains the owner's choice (T-063).

## 2026-11-06 — T-059: repeated DB suite, account_busy disposition

The repository has no CI, so with the owner's agreement T-059 became a repeated local proof: the entire serialized DB
suite ran 5 times, each from a fresh isolated PostgreSQL + PostgREST created by `scripts/test-backend-isolated.mjs`
(no shared database, no scheduler, no retries). All 5 passed 609/609 with no cod-and-payment or issuance failure; with
the other full DB and upgrade runs of the day that is 13 consecutive passes. The two `account_busy` failures of
2026-10-29 were never reproduced in isolation; every recorded occurrence came from a run sharing the local database
with a ticking scheduler, so the cause is bounded to that interference, which the isolated runner removes.

## 2026-11-06 — M5: T-115 lock-order fix, T-114 local staging prep, INT-M5

T-115 removed a deadlock between `reconcile_shipment` and the admin closes: the old body locked shipment -> memberships
-> operation, the closes operation -> shipment -> memberships. The forward-only migration `20261106110000` takes the
operation row first; the member recheck after the shipment wait and the membership-locked admin check stay. RED on the
old code: PostgreSQL `deadlock detected` in a two-connection schedule gated on observed lock waits. Reviewer-fable also
showed the old body cycled with `lock_real_operation` (dispatch on a real operation); the same order removes it.
INT-M5 (`RUN-20261106T155227Z-d6a2a53f`, head `aa5fad1`) passed typecheck, unit 1500, db 625, upgrade 625 and e2e on
three viewports 723/0/27; pushed `fdc34ad..aa5fad1`. T-114 prepared the staging runbook locally; deployment waits on the
server/DNS, SMTP and backup-target inputs.
