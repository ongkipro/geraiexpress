# GeraiExpress — Full Review and Validation Report

- Date: 2026-10-28
- Snapshot: HEAD `5f85d86`, clean working tree at intake (`git status` empty; 16 migrations tracked)
- Declared state (STATUS.md): `AWAITING_DEPLOY_APPROVAL`, T-001..T-031 done
- Method: four independent read-only review lanes run in parallel, plus executed gates run by the lead.
  Critical findings were re-verified on disk by the lead (see section 4).
- Lane reports with full evidence, file:line and verification steps: `docs/review/lanes/`
  (`SEC-security.md`, `DIL-data-isolation.md`, `BIZ-provider-money.md`, `SUP-spec-ux-process.md`).

## 1. Verdict

**Not ready for deploy approval.** Local engineering quality is high (types, 102 unit and 114 DB tests green,
RLS on every table, strong crypto and transport hygiene), but there is one cross-tenant account-takeover path,
one money-path request that cannot work against the provider contract, and a public marketing site that
publishes unapproved commercial claims. The recorded verification for T-031 also does not match the ledger.

| Lane | Critical | High | Medium | Low |
|---|---|---|---|---|
| SEC security | 1 | 1 | 7 | 7 |
| DIL data isolation | 1 | 1 | 10 | 11 |
| BIZ provider/money | 1 | 4 | 2 | 0 |
| SUP spec/UX/process | 1 | 3 | 14 | 6 |
| Lead (gates) | 0 | 1 | 1 | 0 |

Raw counts include duplicates: the one Critical was reported by all four lanes, and several Medium items overlap
(section 3 merges them). After merging: 1 Critical, 9 High (P0-2..P0-6, P1-1..P1-4), then the Medium and Low items listed below.

## 2. Gates executed by the lead

| Gate | Result | Notes |
|---|---|---|
| `pnpm typecheck` | PASS | |
| `pnpm test:unit` | PASS 102/102 (14 files) | STATUS.md claims 108 |
| `pnpm test:db` | PASS 114/114 (13 files) | STATUS.md claims 115. First run failed 11 tests, all `Failed to reach hook`: Auth Send Email Hook relay was not running (environment precondition, not a code defect). After starting a production server and the relay, 114/114 pass |
| `supabase db lint --local` | PASS, 1 warning | unused variable `v_onb` in `complete_partner_seller_onboarding` |
| `pnpm build` | PASS | warns: `middleware` convention deprecated in Next 16, use `proxy` |
| `pnpm check:bundle` | PASS | 64 files. Lane SEC-16 notes the check has blind spots |
| `pnpm audit --prod` | **10 advisories (2 critical, 5 high, 3 moderate)** | see GATE-01 |
| Not executed | e2e (Playwright), `cf:build`, `smoke:worker`, live Mengantar contract tests, `delivery-ledger verify`, `production-gate` | would need sandbox credentials, a Worker runtime, or owner approval |

Environment notes found while running gates (not product defects):
- `scripts/auth-hook-relay.mjs` auto-detects the `docker0` address via `os.networkInterfaces()`. On this host Node does not list `docker0`
  (the interface exists, `10.0.0.1`), so the relay exits. `AUTH_HOOK_RELAY_HOST=10.0.0.1` works. Tests under `tests/db` that sign in by OTP silently depend on this relay.
- Port 3100 was occupied by another project's server, so the hook target was moved with `AUTH_HOOK_TARGET`.

## 3. Findings (deduplicated, prioritized)

IDs in brackets are lane IDs; the same issue reported by several lanes is merged.

### P0 — Block deploy / fix before any further Partner onboarding use

**P0-1 [Critical] Any tenant admin can take over another tenant's Mengantar seller account**
[SEC-01 = DIL-01 = BIZ-01 = SUP-01]
- `record_partner_seller_onboarding_outcome` and `complete_partner_seller_onboarding` are `security definer`, granted to `authenticated`
  (`20261027210000_partner_seller_onboarding.sql:333-345`), gated only by tenant-admin role, and write a caller-supplied
  `partner_seller_id` (format check only; `20261027230000_production_readiness_polish.sql:45`, onboarding.sql:209). `partner_seller_id` is not unique.
- `onboardPartnerSeller` (`src/lib/mengantar/partner-onboarding.ts:141-144`) then calls `getSellerApiKey(storedId)` with the platform Partner secret and seals the returned key for the caller's tenant. No `externalUserId` ownership check; `listSellers` is never used.
- Victim seller ids are readable by every member of the victim tenant (`partner_onboarding_status`, `/pengaturan`, audit detail).
- Impact: quote, issue and pay-unpaid against the victim's Mengantar balance; read victim pickup addresses. Violates TEN-3, IAM-3, DATA-4, SEC-1/SEC-3, DEC-006. Reachable today wherever Partner onboarding is on (sandbox/`env.staging`). The existing DB test performs this client-side write as normal behavior (`tests/db/partner-onboarding.test.ts:126-153`).
- Fix: (1) revoke both RPCs from `authenticated`, grant to `service_role`, call through `machineClient()` after the user-session admin check; (2) partial unique index on `partner_seller_id` plus write-once trigger; (3) before `getSellerApiKey`, require `listSellers({externalUserId})` to return exactly the stored id, or always use idempotent `registerSeller` with the server-derived external id; (4) restrict seller id/owner details in `partner_onboarding_status` to admins.
- Verify: DB test that tenant B admin calling either RPC with tenant A's seller id gets 42501; unit test that a mismatching `listSellers` never reaches `sellers/api-key`; two-tenant sandbox e2e.

**P0-2 [High] `pay-unpaid` sends the batch display code, provider requires the batch object `_id`** [BIZ-02] — verified
- `payUnpaidBatch` (`public-api.ts:248-252`) sends `batch_id: <code>` and validates with `BATCH_ID = /^[A-Z0-9]{6,24}$/` (`:391`).
  Fixture `order-create-jt-unpaid.json` shows `batch: "26101416827JYE"` and `batch_id: "6acf476a6b00a9b494ff04b8"`. A real object id (lowercase hex) fails the regex and throws `InvalidOrderRequest`; the unit test asserts the wrong code-valued body (`tests/unit/mengantar-orders.test.ts:308-310`).
- Fix: carry batch code and batch object id as separate typed fields end to end (parse, persist in `provider_operations`, claim, pay). GET filter keeps using the code; POST uses the id. Validate the id shape (24 hex).
- Verify: fixture test where code and id differ and the fake rejects code-valued payment; one supervised sandbox payment.

**P0-3 [High] Ambiguous payment results are released for replay** [BIZ-05]
- After timeout/5xx/unknown from `payUnpaidBatch`, `release()` unconditionally clears `payment_in_flight_at` (`dispatcher.ts:284-317`; cod migration `:767-770,795-825`). No durable payment attempt with unknown outcome exists, so a second click or lease expiry can send a second `pay-unpaid`. Breaks the "no blind replay" invariant outside a single invocation.
- Fix: persist the original payment attempt with explicit `unknown`, route to reconcile-only, allow a new payment only on authoritative proof of no effect; fence claims per attempt.
- Verify: lost-response simulation plus second action after lease expiry produces exactly one POST.

**P0-4 [High] Public marketing publishes unapproved commercial terms and unbuilt features** [SUP-02, SUP-03]
- Pages `/`, `/fitur`, `/simulasi`, `/cara-kerja` publish commission tiers 20-25 %, 3.33 % COD fee, insurance and payout rules, "Gratis", a Mengantar partnership, pickup scheduling, label/receipt printing, WhatsApp resi, automatic tracking, COD payout reports/CSV. None is approved (PRD:809 open decision, PR-22/PR-23, AGENTS.md "never import a historical fee percentage") or implemented (drop-off only, real labels not issued, no tracking). Marketing unit/e2e tests lock the numbers in.
- Fix: remove numeric claims or unpublish `/simulasi` until a DEC records source, date and approval; rewrite copy to implemented scope; derive courier lists from `OFFERED_COURIERS`.

**P0-5 [High] Recorded T-031 verification does not match the ledger** [SUP-04, SUP-05]
- STATUS claims a full verification and `AWAITING_DEPLOY_APPROVAL`; ledger shows the only broad e2e run exited 1, later reruns were filtered (12 tests + marketing), `security-check`/`release-manifest`/`rollback-check` named in T-031 never ran, `requiredChecks` is `[]`, and the R4 review was approved 18 s after the boundary check by a reviewer on the same model as the implementer.
  No per-task runs exist for T-026..T-030, and T-030 was credited with an hourly cleanup that did not exist at its commit.
- Fix: run and record full `pnpm test:e2e` and the three gates; set STATUS back to `VERIFYING` until they pass; correct STATUS/TASKS provenance text. `.delivery/current.json` `observedHead` (`f059a9a`) is also behind `Independent-Review-Head` (`59d1299`).

**P0-6 [High] Next.js 16.3.8 is inside advisory range `>=16.0.0 <=16.4.0`** [lead, GATE-01]
- `pnpm audit`: critical RCE via image optimization (SVG) and via `use cache`, high DoS in App Router Server Actions; patched `>=16.4.1`. The app uses Server Actions heavily. No `use cache` in `src/` and no image configuration, so the RCE paths look unreachable [INFERENCE, not tested]; the Server Actions DoS applies. Other advisories are transitive through `@opennextjs/cloudflare` (undici, glob, body-parser; mostly build/dev-time).
- Decision needed: DEC-005 pins Next 16.3.8. Proposed: bump to a patched Next and re-run the full gate set; record the change in DECISIONS.md.

### P1 — Fix before real gerai traffic

| ID | Sev | Finding | Source |
|---|---|---|---|
| P1-1 | High | Auth traffic through the Worker shares one Supabase per-IP rate-limit budget; ~6 IPs can lock out sign-in/OTP for all tenants, and 429s render as "wrong credentials". Forward client IP (`Sb-Forwarded-For`) from an Auth-only client or raise limits; map 429 to "too many attempts" and log | SEC-02 |
| P1-2 | High | `alter default privileges ... in schema public revoke execute` does nothing for PUBLIC; every new function is anon-executable unless revoked by hand. No live exposure today (every function carries an explicit revoke) but one missed revoke ships an exposed `security definer` RPC. Add a global default-privilege revoke and a `pg_proc` catalog test | DIL-02 |
| P1-3 | High | Queued dispatch sends the current outlet pickup, not the quoted/confirmed origin; pickup change does not invalidate quotes | BIZ-04 |
| P1-4 | High (BIZ) / Med (DIL, SEC) | Partner completion encrypts under version from `begin` with no expected-version check at `complete`; double-submit or concurrent BYOK save stores an undecryptable key while status shows "connected". Mirror `store_seller_credential`'s `p_expected_version` | BIZ-03, DIL-03, SEC-15 |
| P1-5 | Med | Batch payment spends balance as `service_role` with no actor/audit row | DIL-06 |
| P1-6 | Med | Recovery action bypasses affirmative consent and can create a seller; retried `begin` overwrites original consent/owner data | BIZ-07, DIL-04 |
| P1-7 | Med | Consent stores client-posted placeholder document versions, no links to documents | SUP-11, SEC-14 |
| P1-8 | Med | Live recipient limits (name 100, address 300, phone shape) narrower than draft/DB (120/500/8-15); confirmed orders fail at dispatch with a generic error | BIZ-06 |
| P1-9 | Med | Brute-force limits keyed only by IP (IPv6 /64), none per account/MFA; email OTP valid 1 h | SEC-03 |
| P1-10 | Med | Session cookies not `HttpOnly`/`Secure`, 400-day lifetime; CSP covers only `frame-ancestors` | SEC-04, SEC-10 |
| P1-11 | Med | Partner `retry_after`/restricted state recorded but wiped by next `begin`; no per-tenant/partner-wide limiter on 60 req/min shared budget | SEC-05 |
| P1-12 | Med | `env.staging` shares the preview Supabase project (Auth captcha off, hook points at preview); no `deploy:staging` guard | SEC-07, SUP-07, DIL-23 |
| P1-13 | Med | Seller binding/credentials not scoped by provider environment (sandbox keys reused after switch to production) | DIL-05 |
| P1-14 | Med | `CREDENTIAL_KEY` has no key ring; `key_version` ignored on decrypt; rotation breaks all tenants | SEC-08 |
| P1-15 | Med | Demo anonymous sessions have no write quotas via Data API; cleanup only runs where live Mengantar secrets are bound (preview never cleans) | DIL-07, SEC-09, DIL-19 |
| P1-16 | Med | RELEASE.md inconsistent: `Environment: production`, rollback ref equals base, rollback command targets wrong version and omits token-unset guard, non-resolvable `Backup-Proof`, `.delivery/releases/` empty | SUP-06 |
| P1-17 | Med | Preview/staging pages are indexable with canonicals/sitemap to unprovisioned `geraiexpress.com` | SUP-15 |

### P2 — Quality, performance, UX

- Performance (inferred, not measured): RLS predicates call two `security definer` functions per row (use `tenant_id in (select private.my_tenant_ids())`), missing hot-path indexes (`shipments(tenant_id, updated_at desc)`, `contact_addresses(tenant_id, contact_id)`, `provider_operations(tenant_id, shipment_id, created_at desc)`, `label_jobs`), 5-minute sweep scans all historical succeeded/failed operations [DIL-08, DIL-09, DIL-10].
- Source of truth drift: Super Admin "Partner ID" setting is never read, Partner Secret badge differs from what signs, hard-coded `"ongkirich"` default [SEC-06, SUP-12]. Migration source retains 25 `'40001'` literals that production rewrote to `55000` at runtime; add a catalog test [DIL-11]. Hourly cleanup depends on `*/5` cron plus `scheduledTime % 3_600_000`, only the unconfigured `0 * * * *` path is tested [SUP-17].
- Quote inputs: intake form collects dimensions that live quotes silently drop [SUP-08].
- UX: no pending/duplicate-click state or confirmation on "Bayar batch", "Kirim sekarang", "Hapus kunci" [SUP-13]; no gerai switcher for multi-membership users [SUP-14]; English Next.js default 404/error pages, English "Close" labels [SUP-16]; registration code step lacks resend/change-email [SUP-20]; closed-registration CTA dead end [SUP-19]; no e2e for recovery and Partner states [SUP-18].
- Test gaps: no catalog privilege sweep, COD "on confirm" test never calls `confirm_shipment`, no user-denial tests for service-role RPCs, no credential-version concurrency test [DIL-12].
- Spec hygiene: PRD still "Proposed" after DEC-005..010, PR-3 dropshipper, PR-19, PR-32 recovery and insurance have neither task nor deferral, T-028/T-029 mapped to wrong PRs, traceability check counts only 7 tasks [SUP-09]. Appendix A of `SUP-spec-ux-process.md` has the full PR-1..33 traceability table.
- Evidence integrity: legacy-brand scrub rewrote verbatim quotes and source paths in `CONTEXT-RECORD.md` / `reference-scan.json`; "zero references in the entire repo" is false because the immutable ledger keeps the term [SUP-10].

### P3 — Low

Hardening: unbounded Send Email Hook body read, reflected `detail` URL text in error UI, null expected revision disables stale checks (use `is distinct from`), bundle-check blind spots, tracing not pinned off while seller keys appear in outbound URL paths, seed.sql has no environment guard, `auth.users` FK without `ON DELETE` blocks erasure, invitee emails in append-only audit, concurrent `start_demo`, 24-bit reference suffix collisions, `.env.example` lists secrets that must never be in `.env*`, token/typography drift on marketing surfaces, stale status numbers in docs, unlabeled horizontal-scroll region at 768 px, 300-contact picker cap. Details in lane reports.

## 4. Verification of the critical finding (lead, on disk)

- `20261027210000_partner_seller_onboarding.sql:340-345` grants `record_partner_seller_onboarding_outcome` and `complete_partner_seller_onboarding` to `authenticated`. Confirmed.
- `20261027230000_production_readiness_polish.sql:45`: `partner_seller_id = coalesce(p_seller_id, partner_seller_id)` with only a regex check on `p_seller_id` (`:39`). Confirmed.
- `partner-onboarding.ts:141-144`: `if (partnerSellerId) { apiKey = await partner.getSellerApiKey(partnerSellerId) }` with no ownership check. Confirmed.
- Not executed: the exploit itself (no sandbox call made; would need an authorised two-tenant test).

Also confirmed by the lead: BIZ-02 regex/fixture mismatch, cron configuration (`wrangler.jsonc:19,53` only `*/5 * * * *`), unit/DB test counts, advisory ranges.

Lane claims **not** confirmed: SEC lane inferred migrations 15 and 16 might be untracked from the raw index. `git status` is clean and `git ls-files supabase/migrations` returns 16 files, so this is false.

## 5. Sound (cross-lane)

RLS enabled on all public tables with column-scoped writes; same-tenant composite FKs; every `security definer` function pins `search_path`; tenant scope derived from `auth.uid()`/JWT, not parameters; money stored as whole rupiah with net cost private and unknown kept NULL; durable idempotency and one in-flight order per seller; reconciliation checks environment and credential version; AES-GCM seals use fresh 96-bit IV with tenant+version AAD; fixed-origin provider clients with redirect refusal, timeouts and 256 KiB read cap; Send Email Hook verifies HMAC with a constant-time compare and refuses anonymous users; no open redirects, no `dangerouslySetInnerHTML`; Super Admin re-checks aal2 and grant under lock; Server Actions CSRF via Next origin check; secret files gitignored and untracked; workspace UI tokens and focus/reduced-motion rules match UI-2; demo and simulation labelling consistent.

## 6. Remediation roadmap

| Wave | Contents | Gate to exit |
|---|---|---|
| 0 (now) | P0-1 seller binding fix + DB/unit/e2e tests; stop using Partner onboarding on shared environments until fixed | new two-tenant tests fail before and pass after; `test:db` green |
| 1 | P0-2, P0-3, P1-3, P1-4 (money and credential correctness); P0-6 Next bump; P1-2 default privileges + catalog test | unit/db + one supervised sandbox payment |
| 2 | P0-4 marketing copy to implemented scope; P0-5 re-verify T-031 (full e2e, named gates, correct STATUS/RELEASE); P1-16, P1-17 | full `pnpm test:e2e` at reviewed head, `delivery-ledger verify` |
| 3 | Auth hardening P1-1, P1-9, P1-10, P1-11; staging separation P1-12/13; key ring P1-14; demo quotas P1-15 | rate-limit flood test, cookie flags e2e |
| 4 | P2 performance (indexes, RLS predicate), UX states, spec reconciliation, test gaps | `EXPLAIN` before/after, e2e at 390/768/1280 |

Decisions needed from the owner: (1) Next.js bump versus DEC-005 pin; (2) which marketing claims, if any, are approved and their provider source; (3) separate Supabase project for staging; (4) whether the PRD gaps (PR-3 dropshipper, PR-19, PR-32, insurance) are deferred or scheduled; (5) migration `middleware` to `proxy` only after OpenNext Cloudflare support is confirmed.

## 7. Validation limits

All lane findings are static reads unless stated. Not run in the original review: Playwright e2e, Worker runtime (`cf:build`, workerd smoke), live Mengantar contract tests, `delivery-ledger verify`, `production-gate`, EXPLAIN/performance measurements, hosted Supabase/Cloudflare settings. Performance numbers are inferences. No provider call, deploy, push or commit was made during this review. Follow-up runs are listed in section 8.

## 8. Owner decisions (2026-10-28) and corrections

Recorded in `DECISIONS.md` (DEC-005 raised, DEC-011 to DEC-013 added). Work queue: `TASKS.md` T-032..T-041.

| Question | Owner answer | Recorded as | Reviewer assessment |
|---|---|---|---|
| 1. Next.js bump versus pin | Upgrade | DEC-005: Next 16.4.3, OpenNext 1.20.13 | Correct. Critical advisories gone (10 to 7, remaining are build/dev transitive: OpenNext, miniflare, dotenvx). See "Upgrade status" below |
| 2. Marketing claims | Partner account is GeraiExpress's; cashback set by Super Admin | DEC-012, T-036, T-041 | Direction fine, with conditions below |
| 3. Staging separation | Vultr + Coolify, then hybrid with Cloudflare | DEC-011, T-040 | Reasonable, with conditions below |
| 4. Deferred requirements | Reviewer recommendation | DEC-013 | PR-19 and PR-32 scheduled, PR-3 and insurance deferred |

### Where the decisions need correcting or tightening

1. **Hybrid hosting is justified by one fact, not by general preference.** The Partner API refuses addresses outside the allowed IP list on production (the sandbox may not enforce it), and Cloudflare Workers have no stable egress address. That is a gateway requirement, not a reason to move the app. Risks if scope grows: every workload moved to Vultr adds patching, backup, monitoring and an on-call burden for a small team; a single VPS is a single point of failure for all provider calls. Recommendation: start with the smallest move (an egress gateway, optionally the sweep scheduler), keep Supabase hosted separately until there is a reason, and decide the rest in the T-040 ADR. Not urgent for sandbox; it is a go-live gate.
2. **The gateway must be a defined trust boundary, otherwise it is only a proxy with a fixed IP.** Decide who holds `CREDENTIAL_KEY` and the Partner Secret (preferred: the gateway, so the Worker never sees provider secrets), how Worker requests are authenticated and replay-protected, and that a gateway outage leads to reconciliation, never to a resend (DEC-010). Do not expose the Coolify control panel publicly; keep it on the private network (Tailscale is already present on this workstation) and restrict SSH.
3. **"Cashback is set by the Super Admin" does not follow from the Mengantar Partner API.** The Partner documentation exposes registration, listing, key fetch and key regeneration only; sellers ship "at that seller's rates". Nothing in the API says GeraiExpress receives a discount, rebate or revenue share. So the cashback value cannot be verified from the provider side, and, if GeraiExpress funds it itself, it needs its own settlement and accounting model that `docs/spec/11-BILLING-PAYMENTS.md` does not yet define. Conditions recorded in DEC-012: no default value, written Mengantar terms before PR-23 ships, no percentage on public pages meanwhile. When T-041 is planned, each configured value should carry an effective date, a source reference and an audit trail.
4. **The existing tenant-isolation hole (P0-1) is independent of these decisions and has priority.** All tenants register under one Partner ID, so the Partner API's own "SELLER_NOT_FOUND for sellers you did not register" check does not separate tenants from each other. Only GeraiExpress can enforce that boundary (T-032).
5. **A Partner Secret was pasted in the review conversation.** It is not written to the repository, docs or memory (DEC-012 states secrets are Worker secrets only). Treat it as exposed to anyone who can read that conversation. If it is a sandbox-only secret the risk is limited; ask Mengantar to rotate it before production, and use a different secret and, preferably, a company mailbox as the Partner contact instead of a personal Gmail.

### Upgrade status (Next.js 16.4.3, OpenNext 1.20.13)

Executed after the pins were applied: `pnpm typecheck` PASS; `pnpm test:unit` 102/102; `pnpm build` PASS (the `middleware` deprecation warning remains); `pnpm check:bundle` PASS; `pnpm cf:build` PASS; `pnpm test:db` 114/114 with the Auth hook served by the new Worker build under `wrangler dev`; `pnpm audit --prod` 7 advisories, all transitive build/dev tooling.

Not yet established, and required by DEC-005 before the upgrade counts as landed: `pnpm smoke:worker` (one run exited 7 while a second `wrangler dev` was already running on this machine, so it is inconclusive, not a confirmed failure) and the full Worker e2e (started, then cancelled at the owner's request to focus on documentation). Re-run both with nothing else listening, then record the result in BUILD-LOG.md and STATUS.md.

### Document changes made in this follow-up

`DECISIONS.md` (DEC-005 raised; DEC-011, DEC-012, DEC-013 added), `TASKS.md` (T-032..T-041 and deferred items), this section. `package.json` and `pnpm-lock.yaml` carry the dependency pins above. `STATUS.md` was deliberately left unchanged: its state change belongs to T-037 after the gates pass.
