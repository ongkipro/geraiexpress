# Convert the legacy project into GeraiExpress, or continue GeraiExpress?

- Date: 2026-10-28
- Question (owner): instead of continuing this repository, rework the older sibling project (called "legacy" below; it runs on Coolify/Vultr with PostgreSQL, Drizzle and Better Auth) into GeraiExpress and perfect it.
- Method: two independent read-only lanes (feature inventory; architecture, security and conversion cost). Nothing was built, run, installed or called. Every figure below is read from files or git objects, or is the legacy repo's own claim, and is marked as such.
- Raw lane reports (they name the legacy project, so they are kept outside this repository): `~/Documents/work/notes/geraiexpress-legacy-comparison/lane-INV.md` and `lane-ARCH.md`.

## 1. Verdict

**Do not convert. Continue GeraiExpress, port selected legacy parts, and reuse the legacy Coolify ops kit for the egress gateway (DEC-011).** Lane confidence 0.75.

Conversion would be defensible only if the owner is ready to drop DEC-001 (Cloudflare + Supabase). Even then, provider, money and identity models each need an R4 rework, plus a database and brand re-baseline.

## 2. Correction: the checked-out legacy tree is not the real legacy product

| Fact | Evidence |
|---|---|
| The checkout is branch `feat/phase-12-admin-patterns` at `3e3ebf6` (2026-09-11), 22 pages, 29 tables, 38 migrations. | git status/log |
| `origin/main` is `0ab05ea` (2026-10-10): 58 commits ahead of the checkout, 43 pages, 78 migrations, 46 tables, 149 test files. | `git rev-list`, `ls-tree` |
| `origin/main` has been in **production** since 2026-10-10 (landing, tenant app and Super Admin on separate hosts), PostgreSQL migrated to 0077, on a shared Vultr VPS under Coolify. Live order issuance is still switched off there. | legacy RELEASE.md, BUILD-LOG.md |
| A newer ref adds off-server R2 backups with a proven restore. | `docs/ops-backup-r2` |
| Many gaps seen on the checkout (no sign-up, fixture-only orders, closed webhook, no MFA) are closed on `origin/main`. | legacy STATUS.md |

So any comparison must use `origin/main`; the checkout is stale.

## 3. Side by side

| Area | GeraiExpress (this repo) | Legacy `origin/main` |
|---|---|---|
| Stack | Next 16 + OpenNext Worker + Supabase (RLS bound to user JWT) | Next 16 + Postgres + Drizzle + Better Auth on Coolify; RLS identity set by the app through session settings |
| Deployed | Synthetic preview only; no production | Production since 2026-10-10 with runbook, ops image, R2 backups |
| Mengantar accounts | Partner API signing and seller registration; one seller per tenant; no shared account | Public API only; per-outlet key plus a **shared platform-default account**; no Partner code |
| Money | Provider `codFee` read from the estimate; no hard-coded percentage | 333 bps COD fee hard-coded in code and DB CHECKs; no cashback model |
| Identity | OTP-first registration with review, email-bound invitations, capability grants, Turnstile, per-visitor demo | One tenant per user, staff invitations cannot create accounts, single Super Admin, no Turnstile, one shared production demo |
| Live provider paths | Order create with reconciliation; pay-unpaid (wrong id, see review P0-2); no tracking or webhook | Live-proven order, cancel, pickup-time, status pull, webhook (closed by default), pay-unpaid with batch `_id` (dev only) |
| Finance and labels | None | Append-only ledger, settlement ingestion, thermal label with Code128, invoices, CSV export |
| Scheduler | 5-minute Worker sweep | None; recovery only when someone visits |
| Brand | Clean in `src/`, `public/` | Embedded in the database role, ledger enum, auth header, env flags, hosts (hundreds of occurrences) |

## 4. Why conversion loses

1. **Provider topology contradicts accepted decisions.** DEC-006 and DEC-012 require Partner-registered, one-seller-per-tenant accounts with no shared fallback. The legacy app has none of that and no Partner code at all.
2. **Money model contradicts DEC-003 and DEC-012.** A provider percentage is hard-coded in migrations; a provider fee change would make inserts fail until a migration ships [INFERENCE]. The two repos also disagree about whether the provider returns `codFee` (legacy fixture says 0; this repo's fixture has a non-zero value). The parameter name sent (`COD_AMOUNT`) probably explains it [INFERENCE]; one non-mutating sandbox estimate would settle it before any money logic is ported.
3. **Identity model contradicts DEC-007 and DEC-008.**
4. **Cost.** About 21 to 27 tasks, at least 7 at R4, plus superseding DEC-001, 005, 008, 009 and 010 and discarding the 31 completed tasks here as reference only. Porting costs about 10 to 14 tasks, mostly R2 to R3, on top of the open T-032..T-041.
5. **Database re-baseline.** Immutable ledger rows and a database role carry the legacy brand, so renaming needs a fresh database; production holds about 91 thousand rows, nearly all reference geography data (legacy BUILD-LOG, not verified here). The sibling domain is also reported as blocked by one ISP's DNS.
6. **Legacy issues you would inherit**: Next 16.3.3 in the advisory range (Server Actions DoS applies); a session-level advisory lock held on the shared 10-connection pool while the holder needs a second connection, which can stall all database access at about 10 concurrent submissions on one account [INFERENCE, not reproduced]; one `BETTER_AUTH_SECRET` serving sessions, TOTP encryption and HMAC; no credential key ring; no scheduler.

## 5. What the legacy project does better (port candidates)

| # | Piece | Fills this repo's gap | Risk |
|---|---|---|---|
| P1 | Settlement parsing in integer ten-thousandths of a rupiah, with sanitized live fixtures | COD payout reporting (deferred) | R3 |
| P2 | Append-only ledger design: grants, immutability trigger, source-event CHECKs, idempotent reversal (drop brand types and the hard-coded fee) | Finance (not built) | R3-R4 |
| P3 | Webhook verifier and parser; per-seller secret needed under the Partner model | Tracking (PR-12) | R3 |
| P4 | `DELETE /order` outcome semantics and `POST /time` pickup reservation | Cancel and pickup | R3-R4 |
| P5 | `pay-unpaid` contract using the batch `_id` and unknown-payment handling | Review P0-2 and P0-3 directly | R3 |
| P6 | Thermal masked label, Code128, immutable invoice | PR-6 (needs the Mengantar label-whitelisting decision) | R2-R3 |
| P7 | CSV export with formula-injection guard | PR-16 | R2 |
| P8 | Wilayah reference with trigram search | Area picker | R2 |
| P9 | Ops kit: digest-pinned non-root Docker image, ops target, Coolify runbook, R2 backup and restore proof | DEC-011 egress gateway (T-040) | R2 |
| P10 | PII-minimized platform read models (as `security_invoker` views) | Super Admin monitoring | R2 |

Do not port: the shared platform-default account, per-outlet credentials, the hard-coded 333 bps fee and CHECKs, app-asserted RLS identity, the shared production demo with a fixture password, the blocking advisory lock, the one-tenant-per-user rule.

## 6. Facts that favor conversion (stated fairly)

- It is deployed with a runbook, backups with a proven restore and a fixed egress address on the Vultr host. That already meets the Partner allowlist driver of DEC-011 without a gateway design [INFERENCE: host NAT; the address is shared with another project].
- Its live provider paths (order, cancel, time, pay-unpaid, status pull) were exercised on dev; this repo's are weaker (review P0-2, P0-3, drop-off only, no tracking).
- Finance, settlement, labels, invoices, CSV and geography data exist; here they are deferred.
- In places its auth is stronger: Super Admin session cap of 12 hours, `HttpOnly`/`Secure` host-only cookies, per-email and per-IP limits (review P1-9, P1-10 here).

These are what the port list captures, without importing the contradicting account, money and identity models.

## 7. Legacy production risks to act on whichever path is chosen

1. Next 16.3.3 in production is inside the advisory range (`>=16.0.0 <=16.4.0`); upgrade to a patched release.
2. The production demo tenant reportedly uses the local fixture password, and demo estimates and area searches still call Mengantar with the platform key. Whether the value is the documented one is unconfirmed [INFERENCE]. Change it or disable the demo login.
3. Mail does not send in production (placeholder key), so sign-up is blocked.
4. The shared platform-default Mengantar key is in production environment values.

## 8. Cross-effects on this repo's review

- The marketing tiers and "unbuilt features" flagged in review P0-4 were copied from the legacy landing page (tiers match line for line). Porting P3 to P7 makes part of that copy true; the numeric claims still need a decision (DEC-012).
- Port P5 informs T-033; port P9 informs T-040.

## 9. Recommended sequence

1. Keep the order in `TASKS.md`: T-032 first.
2. Add the port items as tasks after T-033 and T-040 (P5, P9 first, then P3, P2, P1, P6 to P8, P4, P10).
3. Before porting any money logic, run one non-mutating sandbox estimate to settle the `codFee` question.
4. Treat the legacy production risks in section 7 as a separate small workstream owned by the legacy repo.

## 10. Validation limits

No code was run in either repo. Legacy `origin/main` was read through a clean worktree (source and tests identical to the commit); test totals (1,938 claimed) were not reproduced. The legacy claim that new tenants cannot get a first member on the old checkout is inferred from code paths. The shared-pool deadlock, the fixture-password reuse and host-NAT egress are inferences. Local git refs may lag the remote; no fetch was done.
