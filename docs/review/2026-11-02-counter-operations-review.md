# Counter-operations contract review — 2026-11-02

Status: review evidence, not requirements. Requirements live in `docs/spec/`; the work queue is
`TASKS.md`. Where this note and those differ, they win.

Scope: the documentation pass of 2026-11-02 that turned the Indonesia market gap analysis into
development contracts after DEC-023 / CTX-44 (official Mengantar sub-partner; legal and commercial
items sync later and gate release and public claims, not development). No code, migration,
provider call or deployment was part of this pass.

Reviewed artifacts:

| Artifact | Change |
|---|---|
| `DECISIONS.md` | DEC-023 |
| `docs/spec/CONTEXT-RECORD.md` | CTX-44 |
| `docs/spec/02-PRD.md` | Market table, PR-38 to PR-46, status rows, open decisions, PR-36 amendment |
| `docs/spec/04-SYSTEM-ARCHITECTURE.md` | ARCH-6 apex row (`/lacak/*`) |
| `docs/spec/05-DATA-MODEL.md` | DATA-11 to DATA-15, masking-acceptance amendment to DATA-10 |
| `docs/spec/07-IAM-RBAC-ABAC.md` | Five IAM-1 rows (Proposed) |
| `docs/spec/12-SECURITY-ARCHITECTURE.md` | SEC-8 |
| `docs/spec/17-UX-FLOWS-SCREEN-CONTRACTS.md` | UX-17 to UX-20, UX-9 acceptance-gate row, UX-13 rows |
| `TASKS.md` | T-080 to T-087; Deferred corrections |
| `docs/research/geraiexpress-indonesia-market-gap-analysis.md` | Version 2 with five evidence lanes |

## Review rounds

| Round | Reviewer | Scope | Verdict | Evidence |
|---|---|---|---|---|
| 1 | evidence-auditor | Gap analysis v2 and PRD market rows against the five lane reports; five live source checks | PASS WITH FIXES (13 Medium, 9 Low; all applied) | [lanes/2026-11-02/evidence-audit.md](lanes/2026-11-02/evidence-audit.md) |
| 2a | reviewer (first attempt) | Whole diff | Timed out at 30 minutes with no findings | Not retained |
| 2b | reviewer A | Schema and code fit of DATA-11 to DATA-15, SEC-8, T-080 to T-087 | REVISE (8 P1, 7 P2) | [lanes/2026-11-02/schema-fit-review.md](lanes/2026-11-02/schema-fit-review.md) |
| 2c | reviewer B | Decisions, IAM and UX consistency | APPROVE WITH FIXES (10 P1, 5 P2) | [lanes/2026-11-02/decisions-ux-review.md](lanes/2026-11-02/decisions-ux-review.md) |
| 3 | reviewer (re-review) + Mengantar fact check | Fix verification, new contradictions, T-045 and Mengantar notes alignment | APPROVE WITH FIXES; 18/18 prior P1 resolved; 4 new P1 and 6 P2 applied; 11 Mengantar facts applied | See section "Round 3" |

## Important findings and their resolution

Severity follows the reviewers. "Where fixed" names the canonical owner of the corrected statement.

| ID | Severity | Finding | Risk if unfixed | Resolution | Where fixed |
|---|---|---|---|---|---|
| RV-01 | P1 | Counter payment prefilled the customer charge for COD shipments, whose shipping charge the courier already collects from the recipient | Shipping charged twice; breaks DEC-003 "counted once" | COD shows "Ditagih kurir (COD)", never prefilled or counted as cash; a COD counter record needs an explicit non-shipping reason (`cod_collected_by_courier`) | UX-17 (1), DATA-11, PR-38, T-082 |
| RV-02 | P1 | Public tracking page showed the gerai name for masked shipments | Masking (DEC-017/018) defeated on a public page | Gerai name only when masking is off; masked shows printed-sender initials only | UX-18 (3), DATA-12 projection, PR-40, T-085 |
| RV-03 | P1 | Pilot "spread" used recorded provider cost | Tenant admin could derive the provider discount (DEC-018, UX-12) | Earnings = customer charge − `private.gerai_cost_idr(...)`; provider net and percentage never leave the database | PR-45, UX-17 (6), DATA-11, T-087 |
| RV-04 | P1 | Host of `/lacak` undefined; PR-36 lets the apex serve only marketing routes; only the public audience strips cookies | Session cookies read or set on a public page; 404 or wrong indexing | `/lacak/*` apex-only, non-marketing, no cookie, `X-Robots-Tag: noindex` plus robots disallow, 404 elsewhere | PR-36 amendment, ARCH-6, SEC-8 (1), UX-18 (2), T-085 |
| RV-05 | P1 | "One active link, idempotent" conflicted with "token stored only as a hash" | Repeat share impossible or a second link per share | Token = base64url(HMAC-SHA256(`TRACKING_TOKEN_SECRET`, link_id)); only its SHA-256 stored | DATA-12, SEC-8 (1), T-085 |
| RV-06 | P1 | One estimate call carries one weight, but volumetric divisors differ per courier | Wrong billable weight for some couriers | Group couriers by distinct billable weight; one estimate per group; store the weight actually sent | DATA-14, T-080 |
| RV-07 | P1 | T-082 required `cash_periods`, created only in T-083, which depends on T-082 | Unbuildable dependency cycle | `cash_periods` table, open-period index and auto-open move into T-082; close, reopen and `/kas` stay in T-083 | DATA-11, T-082, T-083 |
| RV-08 | P1 | Payment allowed when the customer charge is NULL or the shipment can be reopened | `NULL` comparison passes silently; payment against a reopened draft | Requires confirmed state and non-NULL charge (`charge_unknown`); `expected_idr` NOT NULL; `reopen_shipment` refused while an active payment exists | DATA-11, T-082 |
| RV-09 | P1 | Allowed Paths missed the host matrix, nav frame, breadcrumbs, robots, config and print views | New routes answer 404; tasks fail their boundary check | Paths added per task; preamble requires host-matrix entries and privilege allowlist updates | TASKS T-080 to T-087 |
| RV-10 | P1 | New IAM-1 cells read as accepted although DEC-008 does not cover them | Unapproved grants treated as policy | All new cells marked "Proposed"; note under the table | IAM-1 |
| RV-11 | P1 | "Close own outlet day" while memberships are tenant-wide | Unenforceable rule | "Any outlet of the tenant (DEC-008)" | IAM-1, UX-17 (5) |
| RV-12 | P1 | Operators could see differences that IAM denied | Contradictory access rule | Per-record charge differences: admin only; cash-count variance of the period being closed: closer may see it | IAM-1, UX-17 (5) |
| RV-13 | P1 | PRD said PR-38 to PR-46 had no task while the status table listed T-080 to T-087 | Two current claims | "Proposed; development permitted by DEC-023 through T-080 to T-087; not accepted behavior" | PRD section preamble, open-decision row |
| RV-14 | P1 | Receipt contents fixed while receipt content is an open owner decision | Building an unapproved document | UX-17 (4) field list marked Proposal pending the decision; exclusions fixed by DEC-003/016 | UX-17 (4), PRD open row |
| RV-15 | P1 | Counter "Lunas" collided with the Mengantar "awaiting payment" state | Operator believes an unpaid provider order is settled | "Pelanggan: belum bayar / sudah bayar (Lunas)" shown apart from the provider state; acceptance check added | UX-17 (1), PR-38 |
| RV-16 | P2 | Declaration columns writable by client grant | `content_declared_by` spoofable | Written only inside `confirm_shipment` with `auth.uid()`; allowlist and callers updated | DATA-13, T-081 |
| RV-17 | P2 | New tables lacked RLS and grant statements | Tenant leak through PostgREST | RLS on, member SELECT, no direct write grants, security-definer RPCs; `tracking_links` has no `anon` privilege | DATA-11 to DATA-15, TASKS preamble |
| RV-18 | P2 | Tracking timeline source has only `kind` and free-text `detail` | Courier free text leaks personal data | Whitelisted `kind` → public status; `detail` never returned; structured `hub_city` and delivered/returned timestamps from T-045 | DATA-12, T-045 (Round 3) |
| RV-19 | P2 | Masking acceptance stored in `private` (unreadable) and print events lacked columns | Print view cannot read state; signature tests break | `masking_acceptance_for(courier)` RPC; nullable `acceptance_state`, `acknowledged`; missing row = unverified | DATA-10 amendment, T-084 |
| RV-20 | P2 | Hard-coded 6000 divisor in `private.simulated_tariffs`; new weight columns not nullable | Constant in code; old quotes misread as 0 | Simulator reads the rules; new columns nullable, NULL = not computed | DATA-14, T-080 |
| RV-21 | P2 | Working-day deadlines without a holiday calendar; promise wording untestable | Wrong deadlines; legal-sounding promises | Weekends excluded only, stated on screen; NULL when no rule; copy test for "dijamin" / amounts | UX-20 (3, 6), DATA-15, T-086 |
| RV-22 | P2 | UX-13 lacked the new money actions | Undefined pending and unknown behavior | Rows for Catat pembayaran, Batalkan catatan, Tutup/Buka ulang kas, Tutup kasus | UX-13 |
| RV-23 | P2 | Return note could be read as printed on the masked label | Real return address exposed on a masked parcel | "In the print view help text, not on the printout" | UX-9 gate row |

Evidence-audit fixes (round 1) corrected competitor counts, WhatsApp prevalence by population, review
population (mostly online sellers), Art 20 / 75 / 51 attribution, provisional severity for J5, J6
and J9, the PR-43 code pointer (dimensions are not sent to Mengantar) and testable PR-40 / PR-46
acceptance. Details: [evidence-audit.md](lanes/2026-11-02/evidence-audit.md).

## Executed checks

- `python3 ~/dotfiles/skills/local/development-spec-suite/scripts/check-traceability.py docs/spec --tasks TASKS.md`:
  `PASS files=16 declarations=256 tasks=61 findings=0` after rounds 1 and 2.
- Disk existence of every path and function the tasks reference (`private.is_member`,
  `private.gerai_cost_idr`, `src/app/robots.ts`, `src/lib/csv.ts`, `src/lib/config.ts`,
  `src/components/workspace-frame.tsx`, `src/components/app-header-crumbs.ts`,
  `scripts/check-client-bundle.mjs`, `infra/env/*.env.example`): present.
- Not executed: any build, test suite, migration or browser run (documentation-only pass).

## Remaining gates (unchanged by this review)

- Mengantar sync (DEC-023): partner terms, Art 77 resi QR versus the masked label, agent status,
  declaration wording, insurance on API orders, `LOST` webhook value.
- Owner decisions: receipt content, revenue model, acceptance of PR-38 to PR-46 and the Proposed
  IAM cells.
- T-045 (webhook and status) for live tracking, return events and the tracking expiry anchor.

## Round 3

Round 3 ran two independent read-only agents: a re-review of the fixes and a Mengantar fact check of
lane D against the repository notes. Reports: [re-review](lanes/2026-11-02/round3-re-review.md),
[Mengantar fact check](lanes/2026-11-02/round3-mengantar-fact-check.md).

**Re-review verdict: APPROVE WITH FIXES.** All 18 prior P1 findings (schema 1–8, decisions/UX 1–10)
are RESOLVED with file:line evidence. The fixes introduced 4 new P1 and 6 P2 gaps; all applied:

| ID | Severity | Finding | Resolution | Where fixed |
|---|---|---|---|---|
| RV-24 | P1 | T-045 never updated: wrong migration path (`supabase/migrations/**`), and DATA-12, DATA-14, DATA-15, T-085, T-086 rely on fields it did not promise | Paths corrected; Done-when amended: structured `provider_status` and `hub_city`, `delivered_at`, `returned_at`, `provider_weight_grams`, status whitelist incl. return/RTS, unknown/`LOST` stored verbatim as non-final, `detail` never public | TASKS T-045 |
| RV-25 | P1 | Pilot earnings counted the COD fee (pass-through) as gerai earnings | Earnings = normal tariff − gerai cost at quote time; COD fee and insurance excluded | PR-45, UX-17 (6), DATA-11, T-087 |
| RV-26 | P1 | "Masked shipment" undefined for the tracking page (masking is per label snapshot) | Masked = latest `label_snapshots.mask_sender`; no snapshot = hide gerai and sender (fail closed) | DATA-12, UX-18 (3), T-085 |
| RV-27 | P1 | Quote uses billable weight while the dispatcher sends actual weight (`dispatcher.ts` `weightGrams: p.weight_grams`) | Create-order sends the selected quote's billable weight, frozen at confirmation; test for no `price_mismatch` | DATA-14, T-080 |
| RV-28 | P2 | PR-39 said WIB-day periods; DATA-11 open-until-closed | Period may span midnight; T-083 test "payment after midnight joins the open period" | PR-39, T-083 |
| RV-29 | P2 | UX-18 hard-coded the production URL | `<SITE_ORIGIN>/lacak/<token>`; T-085 builds from configuration | UX-18 (2), T-085 |
| RV-30 | P2 | COD `expected_idr` row disagreed with acceptance; "non-shipping amount" created an unapproved extra charge | `expected_idr` = charge or 0 when COD; COD counter record refused; extra charge needs its own requirement | DATA-11, UX-17 (1) |
| RV-31 | P2 | `cash_period_events` lacked RLS statement | Access row covers all three tables; T-083 Done-when | DATA-11, T-083 |
| RV-32 | P2 | "Spread" in T-087 clashed with the PRD's provider-cost definition | Renamed "earnings" | T-087 |
| RV-33 | P2 | Stale PR-43 wording; PR-40 statement omitted gerai name; PR-36 amendment omitted internal host | Corrected | PR-43, PR-40, PR-36 |

**Mengantar fact check.** 11 CHANGED/NEW facts affected planned tasks; T-043 and T-045 had none of them.
Applied to the notes and tasks:

| ID | Fact (lane D) | Applied to |
|---|---|---|
| MF-01 | Delete Batch response fields; `totalBalanceRefund` and `errorMessages` only for lion, anteraja, pos, spx; other couriers and `DELETE /order` refund Unknown | Operations note §3.1–3.2, Q14; T-045 (c) |
| MF-02 | Web-UI "Lost (Paket Hilang)" final status; webhook value Unknown | Operations note §5.1, Q17; T-045 (b); T-086 |
| MF-03 | Seller can self-regenerate the API key (email OTP), replacing the Webhook Secret | Operations note §4.5; T-045 (d) |
| MF-04 | Per-courier pickup cut-offs and SLAs (help 5502313) | Operations note §2.3; T-043 amendment |
| MF-05 | Web pickup lead 2 h vs API 90 min | Operations note §2.1, Q9; T-043 amendment (configurable, default 120 min) |
| MF-06 | Volumetric divisors and 0.30 kg rounding (help 5387484) | Public API note; T-080 (already), DATA-14 |
| MF-07 | Maximum weights, cargo minimums, per-courier COD maxima, balance-settled weight differences, iDexpress < 0.5 kg | Operations note §8.5; T-080 |
| MF-08 | Return address only Java-to-Java for JNE, SiCepat, SAP; otherwise pickup address | Operations note §9; T-084 |
| MF-09 | Claim windows with unit, anchor and region | Operations note §14 (new); T-086 |
| MF-10 | Claim types, 14-day processing, exclusions, no claims API | Operations note §14; T-086 |
| MF-11 | COD fee = 3% + 11% VAT on the fee, no minimum (matches observed 4,995) | Public API note |

New task: **T-088 — Mengantar sync question pack** (non-code, DEC-023) consolidates every open provider
and legal question raised by this review into operations-note section 12, so the owner can run one sync.

Round 3 checks (executed 2026-11-02 after all edits): traceability `PASS files=16 declarations=257 tasks=62 findings=0`. No build, test or migration was run; this is a documentation-only pass.
