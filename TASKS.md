# GeraiExpress — Execution Queue

Updated: 2026-10-27

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
| T-024 Real issuance: confirm creates a real queued operation and the server action dispatches it (pickup re-checked at Mengantar first); reopen after a definite refusal only; admin reconciliation and payment check through the dispatcher; cron sweep in a custom Worker entry (queued, stale/unknown, unpaid; throttled; certain refusals skipped); contact addresses keep the Mengantar area; status, failure and info texts | TD-3, DEC-010, PR-5, PR-6 | R3 | PASS | see BUILD-LOG T-024 |
| PERF-1 Cut dashboard latency on the preview: Worker placement `aws:ap-southeast-1`, local JWT claims check on GET/HEAD in middleware while keeping `getUser` on mutations, disable row-link prefetch, nav pending dot | NFR-4 | R3 | PASS, security-reviewed | unit 74, typecheck, full e2e (179), cf:build, check:bundle, worker smoke, deployed preview TTFB re-measured |

## Completed slice — Mengantar Sandbox completion, GeraiExpress public marketing & staging readiness

Owner decisions DEC-005 to DEC-010 are accepted. Domain and platform direction (2026-10-26):
launch `geraiexpress.com` as a clean standalone brand on the full Cloudflare Workers + Supabase
stack using the Mengantar Sandbox Partner & Public APIs, with zero legacy domain redirects or
legacy terminology.

| Task | Requirement | Risk | Result | Done-when evidence |
|---|---|---|---|---|
| T-025 COD shipments and two-pass COD fee pricing | PR-22, PR-4, PR-5, TD-3, DATA-2 | R3 | PASS, security-reviewed | `test:db` (115), `test:unit` (104), two-pass COD estimation, `codFee` included once in `customer_charge_idr`, `net_cost_idr` private, COD price check without false `price_mismatch`, full e2e (188) |
| T-026 Batch `pay-unpaid` recovery with full batch review | TD-3, PR-5, PR-9, IAM-1, DEC-008, DEC-010 | R3 | PASS, security-reviewed | `test:db` (`cod-and-payment.test.ts`), `test:unit` (`mengantar-dispatcher.test.ts`), `review_unpaid_batch` digest binding, foreign/unknown batch refusal, `tenant_admin`-only guard, timeout reconciliation |
| T-027 Mengantar Partner API sandbox seller onboarding in `/pengaturan` | PR-17, PR-18, PR-20, PR-26, DEC-006 | R3→R4 | PASS, security-reviewed | `test:db` (`partner-onboarding.test.ts`), `test:unit` (`mengantar-partner-onboarding.test.ts`), `PR-20` disclosure & agreement, `geraiexpress:tenant:<id>`, 200/409/503 recovery, Worker-sealed key |
| T-028 Audit hardening: cron handler & `tenantMengantar` tests, operator contact-archive guard | PR-10, PR-2, IAM-1, DEC-008 | R3 | PASS, security-reviewed | `test:unit` (`custom-worker.test.ts`, `mengantar-tenant.test.ts`), `test:db` (`contact-archive-and-demo-cleanup.test.ts`), `archive_contact` row-lock `tenant_admin` guard + revoked `archived_at` column update |
| T-029 Public marketing pages on `geraiexpress` (Komdigi-clean standalone brand) | PR-13, PR-21, PR-32, UI-1, UI-2 | R2 | PASS, reviewed | `/`, `/fitur`, `/simulasi`, `/cara-kerja`, `/hubungi-kami`, `marketing-rebrand.test.ts` (0 legacy brand matches), `marketing.spec.ts` across 390/768/1280 with 0 horizontal overflow |
| T-030 Preview & staging hardening (`geraiexpress.com`, Sandbox Worker bindings, security headers, demo cleanup) | DEL-1, ARCH-1, SEC-5, RATE-1 | R3 | PASS, security-reviewed | `middleware.test.ts` security headers, `cleanup_expired_demos` RPC + hourly cron, `wrangler.jsonc` `env.staging`, `cf:build`, `check:bundle`, `smoke:worker` |

### [x] T-025 — COD shipments and two-pass COD fee pricing
- **Primary requirement:** PR-22
- **Constraints:** PR-4, PR-5, TD-3, DATA-2, NFR-1, NFR-2, DEC-003
- **Risk Level:** R3
- **Allowed Paths:** `supabase/migrations/**`, `src/lib/mengantar/**`, `src/modules/shipments/**`, `src/app/(workspace)/pengiriman/**`, `tests/**`, `ARCHITECTURE.md`, `STATUS.md`, `TASKS.md`, `BUILD-LOG.md`
- **Depends On:** None
- **Done when:** `pnpm test:db`, `pnpm test:unit`, `pnpm typecheck`, `pnpm build`, `pnpm cf:build`, `pnpm check:bundle`, and Playwright e2e on 390/768/1280 pass with two-pass COD estimation (shipping tariff then COD fee on goods + shipping), customer charge including `codFee` once while seller net cost stays private, `unsupported_cod` filtering, COD order creation and price comparison (`estimatedPrice` vs `customer_charge_idr` with COD fee) without false `price_mismatch`, provider refusal text persisted on rejected operations, and cross-tenant denial.

### [x] T-026 — Batch `pay-unpaid` recovery with full batch review
- **Primary requirement:** TD-3
- **Constraints:** PR-5, PR-9, DATA-2, IAM-1, NFR-1, NFR-2, DEC-008, DEC-010
- **Risk Level:** R3
- **Allowed Paths:** `supabase/migrations/**`, `src/lib/mengantar/**`, `src/modules/shipments/**`, `src/app/(workspace)/pengiriman/**`, `tests/**`, `ARCHITECTURE.md`, `STATUS.md`, `TASKS.md`, `BUILD-LOG.md`
- **Depends On:** T-025
- **Done when:** `pnpm test:db`, `pnpm test:unit`, and Playwright e2e prove `/order/pay-unpaid` batch payment recovery with explicit `batch_id` and `courier` (discontinued Ninja refused), full batch membership and payable-amount review bound by digest before dispatch, refusal when a batch contains foreign or unknown orders, `tenant_admin`-only authorization (`operator` and cross-tenant denied), charged price capture when transitioning from unpaid to paid, and timeout reconciliation by `ORDER_ID`/reference without duplicate payment or order creation.

### [x] T-027 — Mengantar Partner API sandbox seller onboarding in `/pengaturan`
- **Primary requirement:** PR-17
- **Constraints:** PR-18, PR-20, PR-26, TD-7, DATA-4, TEN-3, IAM-3, SEC-3, PRIV-2, DEC-006
- **Risk Level:** R3
- **Allowed Paths:** `supabase/migrations/**`, `src/lib/mengantar/**`, `src/modules/credentials/**`, `src/modules/mengantar/**`, `src/app/(workspace)/pengaturan/**`, `src/app/admin/**`, `tests/**`, `ARCHITECTURE.md`, `STATUS.md`, `TASKS.md`, `BUILD-LOG.md`
- **Depends On:** None
- **Done when:** `pnpm test:db`, `pnpm test:unit`, and Playwright e2e on 390/768/1280 verify Partner API seller onboarding (`https://sandbox.mengantar.com/api/partner/v1/sellers`, `/sellers/list`, `/sellers/api-key`) in `/pengaturan` alongside BYOK, enforcing account-owner disclosure and affirmative agreement (`PR-20`), stable `geraiexpress:tenant:<tenant_id>` external ID, idempotent 200 repeat recovery, 503 `KEY_PROVISIONING_FAILED` retry recovery, 409 `EMAIL_ALREADY_REGISTERED` BYOK routing, sealed key storage with `CREDENTIAL_KEY`, `Lupa Password` first-login guidance, and `operator`/demo/cross-tenant denial.

### [x] T-028 — Audit hardening: cron handler & `tenantMengantar` tests, operator contact-archive guard
- **Primary requirement:** PR-10
- **Constraints:** PR-2, IAM-1, TD-3, NFR-1, DEC-008, DEC-010
- **Risk Level:** R3
- **Allowed Paths:** `supabase/migrations/**`, `custom-worker.ts`, `src/lib/mengantar/**`, `src/modules/contacts/**`, `src/app/(workspace)/kontak/**`, `tests/**`, `STATUS.md`, `TASKS.md`, `BUILD-LOG.md`
- **Depends On:** None
- **Done when:** `pnpm test:db`, `pnpm test:unit`, and Playwright e2e pass with dedicated unit tests for `custom-worker.ts` `scheduled` cron sweeps (`disabled`, `dispatch_sweep`, `stuck` counts) and `tenantMengantar` key opening/failure states, plus contact archive gated to `tenant_admin` in RPC/RLS with row-lock role re-check and `operator`/cross-tenant denial tests.

### [x] T-029 — Public marketing pages on `geraiexpress` (Komdigi-clean standalone brand)
- **Primary requirement:** PR-13
- **Constraints:** PR-21, UI-1, UI-2, NFR-3, NFR-4, DEC-002
- **Risk Level:** R2
- **Allowed Paths:** `src/app/**`, `src/components/**`, `public/**`, `tests/**`, `ARCHITECTURE.md`, `STATUS.md`, `TASKS.md`, `BUILD-LOG.md`
- **Depends On:** None
- **Done when:** Unauthenticated visitors on `/`, `/fitur`, `/simulasi`, `/cara-kerja`, and `/hubungi-kami` receive the GeraiExpress public marketing pages (signed-in users on `/` continue routing to their workspace per `PR-32`) with margin simulation, multi-courier showcase, and `/masuk` (demo) + `/daftar` CTAs; `tests/unit/marketing-rebrand.test.ts` passes with zero legacy brand matches in `src/` and `public/`; `pnpm typecheck`, `pnpm build`, `pnpm cf:build`, `pnpm check:bundle`, and Playwright e2e across 390/768/1280 pass with zero horizontal overflow.

### [x] T-030 — Preview & staging hardening (`geraiexpress.com` custom domain, Sandbox Worker bindings, security headers)
- **Primary requirement:** DEL-1
- **Constraints:** ARCH-1, SEC-5, RATE-1, PR-33, NFR-3, DEC-009
- **Risk Level:** R3
- **Allowed Paths:** `src/middleware.ts`, `wrangler.jsonc`, `scripts/**`, `infra/**`, `supabase/migrations/**`, `tests/**`, `RELEASE.md`, `OBSERVABILITY.md`, `ARCHITECTURE.md`, `STATUS.md`, `TASKS.md`, `BUILD-LOG.md`
- **Depends On:** T-027, T-029
- **Done when:** `pnpm test:unit`, `pnpm test:db`, `pnpm cf:build`, `pnpm check:bundle`, and `pnpm smoke:worker` verify `X-Frame-Options: DENY`, `Content-Security-Policy: frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, and HTTPS HSTS headers in `src/middleware.ts`, expired anonymous demo tenant/user cleanup RPC, and `wrangler.jsonc` staging/production environment configuration for `geraiexpress.com` with Mengantar Sandbox (`MENGANTAR_ENV="sandbox"`) ready for owner-approved deploy.

## Deferred (owner decision or external gate)

- Mengantar official label PDF (`POST /label-generation` / `GET /label-generation/{id}`, `PR-6` / `TD-4`): gated on Mengantar whitelisting the seller account (currently HTTP 403 `Not allowed` on sandbox).
- Mengantar signed status webhooks (`PR-12` / `TD-4`): requires a public webhook URL and the seller's callback secret configured in Mengantar.
- Production Partner API enablement (`ARCH-2` / `NFR-5`): requires Mengantar production Partner origin, approved static egress IPs (Cloudflare Gateway dedicated egress or approved relay), and provider Terms/Privacy document URLs/versions (`PR-20`).
- Live authentication email in production (`PR-33` / `DEC-009`): requires verified Cloudflare Email Sending domain and Turnstile production widget keys.
- Volumetric weight in quotes (`PR-4`): deferred until Mengantar's billable-weight rounding formula is confirmed.
- CSV bulk intake and operational export (`PR-11`, `PR-16`, `PR-14`).
