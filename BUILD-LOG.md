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
Partner Secret with Partner ID `ongkirich`. A signed sandbox `POST /api/partner/v1/sellers/list`
answered 200 (no sellers). T-019's "sandbox gated on Mengantar's side" reading was wrong: the
Public API refused a Partner Secret used as a seller key. Corrected in the research notes,
STATUS and TASKS.

## 2026-10-14 — T-020 Mengantar Partner client and sandbox proof (DEL-1 stage 3)

Added `src/lib/mengantar/partner-api.ts` (signed POSTs; list, register, get key; sandbox origin
only; seller key returned to the caller for sealing; list strips names/emails/phones; provider
codes allowlisted, `Retry-After` and the 503 `sellerId` carried). Reuses the Public client's
bounded reader. Owner approved one sandbox seller (`ongkirich+gerai1@gmail.com`): registered
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

