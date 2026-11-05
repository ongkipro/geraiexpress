# GeraiExpress — Specification Pack Index

- Status: Reviewed specification pack. Requirements are Proposed or Accepted per their own Status line; owner decisions are indexed in `DECISIONS.md` (DEC-001 to DEC-023 as of 2026-11-02). The application is implemented locally on the self-hosted Node.js container + PostgreSQL 17 + PostgREST + application-owned auth stack (T-062, T-064..T-066; T-067 security review open); `ARCHITECTURE.md` records what exists and `04-SYSTEM-ARCHITECTURE.md` owns the target.
- Owner: Paduka Ongki
- Updated: 2026-11-02
- Location: Canonical repository specification at `docs/spec/`; promoted on 2026-10-13. Original staging is a retained non-authoritative snapshot.

GeraiExpress is a multi-tenant shipping-counter product for offline gerai and
physical expedition counters, running as a self-hosted Node.js container on plain
PostgreSQL 17 behind PostgREST with an application-owned auth module (DEC-020,
DEC-021, ADR-0002; superseding the initial Cloudflare Workers + Supabase stack of
DEC-001 while retaining Cloudflare Turnstile as the CAPTCHA), built on the Mengantar courier aggregator
and the relevant LegacyReference workflows. This pack records the requirements, the
target design and the reuse analysis; it does not by itself prove that anything is built.
What is built and proved is recorded in the root `ARCHITECTURE.md`.

## Authority order

When documents disagree, use this order (Decision, repository rules in `AGENTS.md`,
2026-10-28): repository disk and executed checks, then `ARCHITECTURE.md` (what is built),
then `DECISIONS.md` and the context record (owner decisions; CTX-39 to CTX-43 and
DEC-011 to DEC-023 were added from 2026-10-28 to 2026-11-02), then the older prose in this pack. The sole
work queue is `TASKS.md`; `STATUS.md` owns workflow state; documents under `docs/review/`
are review evidence, not requirements. A statement about the target is a Decision or a
Proposal, and a statement about the code is Observed with a file pointer; an
unanswered question is Unknown. A decision recorded after this pack was first written wins over its older text, and the older text is amended or marked superseded with a change-history note instead of being left as a second claim.

## Read in this order

| Document | Canonical responsibility |
|---|---|
| [Decision index](../../DECISIONS.md) | Accepted owner decisions DEC-001 to DEC-023; the canonical index for decisions |
| [Context record](CONTEXT-RECORD.md) | User intent, evidence, owner-held decisions, applicability, and verification history; CTX-44 (official Mengantar sub-partner, development first, DEC-023) is the newest |
| [Implemented architecture](../../ARCHITECTURE.md) | What the code on disk does and which checks proved it; never the target |
| [Product requirements](02-PRD.md) | Product direction, intended users, gerai operating needs, goals, scope ordering, requirements and open policies |
| [Technical design and reuse matrix](03-TECHNICAL-DESIGN.md) | Exact reference modules, extract/adapt/rebuild/conditional dispositions, provider orchestration and target checks |
| [Runtime architecture](04-SYSTEM-ARCHITECTURE.md) | Target components and trust/runtime boundaries; self-hosted Node deployment and PostgreSQL/PostgREST data boundary (ARCH-5) and host topology with the environment matrix (ARCH-6) |
| [Data model](05-DATA-MODEL.md) | Logical entities, snapshots, state dimensions, ownership and provider-account identity; seller-binding integrity, tenant slug and shipment reference, discount terms, masked-label snapshot (DATA-4, DATA-8 to DATA-10); counter payments and cash periods, tracking links, content declaration, billable-weight rules, cases (DATA-11 to DATA-15) |
| [Tenant isolation](06-TENANT-ISOLATION.md) | Direct Data API/RPC and asynchronous scope enforcement; machine-attested seller binding and host scope (TEN-3, TEN-6) |
| [Identity and permissions](07-IAM-RBAC-ABAC.md) | Candidate role matrix and atomic governance |
| [Presentation and branding](10-DESIGN-SYSTEM-WHITELABEL.md) | shadcn/ui + Apple-inspired tokens, components, responsive state/accessibility, brand boundaries, local label sheet and error pages (UI-6) |
| [Shipping money](11-BILLING-PAYMENTS.md) | Payer/collection responsibilities, the first-release discount model with no platform fee (BILL-3), financial authorization and reconciliation boundaries |
| [Security](12-SECURITY-ARCHITECTURE.md) | Command/credential/tracking trust controls; session cookies, host separation, webhook host and Auth ingress (SEC-6); secret handling and key ring (SEC-7); public tracking surface (SEC-8) |
| [Privacy](13-COMPLIANCE-PRIVACY.md) | Personal-data purposes and unresolved lifecycle/processing decisions |
| [Delivery and recovery](15-DEVOPS-CICD-MIGRATIONS.md) | Demo/sandbox/pilot release gates, environment separation and host cutover (DEL-2), schema compatibility and restoration without duplicate external effects |
| [Operational signals and limits](16-OBSERVABILITY-RATE-LIMITING.md) | Observable journey outcomes, private telemetry, response ownership, actual-account quotas, Auth ingress limits (RATE-2) and signals promised versus implemented (OBS-2) |
| [UX flows](17-UX-FLOWS-SCREEN-CONTRACTS.md) | Screen jobs, primary actions, state/recovery and browser acceptance; masking, pickup, entry points, discount assignment and money-action states (UX-9 to UX-13); counter money, share resi and public tracking, intake declaration and billable weight, returns and claims (UX-17 to UX-20) |
| [Complete Mengantar Partner breakdown](../research/geraiexpress-mengantar-partner-api.md) | Four endpoint contracts, signing, all error codes, seller lifecycle, production egress and verification gates |
| [Indonesia market gap analysis, 2026-11-02](../research/geraiexpress-indonesia-market-gap-analysis.md) | Version 2 with five evidence lanes: competitors, Play reviews, public tracking privacy, Mengantar current facts, Permenkomdigi 8 and 15/2025, tax, operator voice; source of Proposed PR-38 to PR-46 |
| [LegacyReference pricing study](../research/geraiexpress-reference-pricing-review.md) | Customer/provider prices, collection modes, legacy formulas, visibility gaps, example and bounded checks |
| [Official source records](sources.json) | Vendor retrieval provenance and review triggers |
| [Reference scan and executed check](reference-scan.json) | Reference revision/dirty scope, source hashes, and bounded test result |
| [Counter-operations contract review, 2026-11-02](../review/2026-11-02-counter-operations-review.md) | Findings RV-01 to RV-33 and Mengantar facts MF-01 to MF-11 on PR-38 to PR-46 contracts and their resolution; evidence, not requirements |
| [Full review, 2026-10-28](../review/2026-10-28-full-review.md) | Findings P0 to P3, executed gates and owner follow-up; evidence, not requirements |

## What the review changes

Small validation/formatting/filter functions are extraction candidates. Contact,
snapshot, queue/recovery, membership-governance, audit, and UI composition
patterns transfer with adaptation. Application-owned auth (`src/lib/auth/**`, `db/migrations/20261029100000_auth_core.sql`), PostgreSQL/PostgREST RLS, server commands, provider
wire transport, account coordination and signed tracking need their own
implementation and proof; the dropshipper mapping and the provider PDF are deferred
(DEC-013, DEC-017).

The original checkout is older: its issuance is fixture-backed and its webhook
returns 404. Worktree discovery found an advanced clean checkout with gated live
transport, a signed webhook, and substantially improved operations. That checkout
is the preferred code candidate; successful live creation/current webhook delivery
remain unproved, provider dropshipper identity is still omitted, and shipping
labels remain locally rendered. TD-1 distinguishes the two sources explicitly.

The advanced scan also adds optional readable shipment numbers, quick rate
checks, logo/gerai settings, customer invoice, batch print, and handover-pattern
candidates. These are documented without inheriting monetary or label policies.

## Current recommended direction

Next.js App Router + shadcn/ui for the operator application in a self-hosted Node.js
container (`next start` standalone output, DEC-020, T-062); plain PostgreSQL 17 behind
PostgREST (`@supabase/postgrest-js` as a stand-alone HTTP-to-SQL query builder) plus an
application-owned auth module (`src/lib/auth/**`, `db/migrations/20261029100000_auth_core.sql`,
DEC-021, ADR-0002, T-064..T-066; T-067 security review open) for identity and tenant data.
Cloudflare Turnstile remains the CAPTCHA widget. Decision (DEC-005): exact Next.js pins
(Next.js 16.4.5 since T-102) remain; the earlier Cloudflare Workers / `@opennextjs/cloudflare` adapter
and the Supabase GoTrue / CLI stack (recorded as historical context in CTX-7, CTX-8 and
CTX-20) are superseded by DEC-020 and DEC-021. The earlier React/Vite proposal is superseded.

Partner API is the seller/key control plane. Public API remains the shipping
data plane. Decision (DEC-006, accepted 2026-10-14): one tenant business owns exactly
one Mengantar seller (Partner-created, or BYOK for an existing account the verified
owner controls); outlets map to that seller; there is no central platform seller or
silent fallback. Decision (DEC-012): the Partner account is GeraiExpress's own.
Contacts and staff do not automatically become sellers; PR-17 through PR-20 add
durable onboarding, owner agreement/access, and key/callback recovery (PR-19
scheduled by DEC-013).

The user-selected presentation uses a single blue action accent, white/parchment
surfaces, system typography, prescribed radii, no decorative gradients, and
imagery-only shadows. UI-1 through UI-3 adapt this to efficient operator forms,
tables, validation and recovery, with no rendered UI claim.

**Production Partner gate:** Mengantar enforces source-IP allowlisting on production.
Decision (DEC-020, owner; superseding DEC-011 and ADR-0001): the application runs on a
self-hosted server the owner controls, and that server's fixed IPv4 address is the
address registered on Mengantar's Partner API allowed-IP list; no separate Vultr/Coolify
egress gateway is built. The earlier Cloudflare VPC/Gateway dedicated-egress route and
the hybrid gateway design (T-040) remain historical design records. ARCH-2 and ARCH-5 own
the production egress requirement and operational boundaries.

The first usable preview includes the demo login requested in CTX-21: a dedicated
sample workspace, seeded contacts/shipments, simulated shipping and sample labels.
PR-21, IAM-4 and UX-3 own this contract. Observed: the demo entry ("Coba demo" on
`/masuk`) and a synthetic-data preview exist (ARCHITECTURE.md "Identity", "Preview");
demo credentials stay out of this specification.

## Product direction and gerai needs

Decision (CTX-39, owner statement 2026-10-28): the first target is the offline gerai or
physical expedition counter, replacing a conventional single-courier counter with one
dashboard that offers every supported courier; the owner runs the first pilot gerai.
About 50 tenants is a planning figure (Assumption), not a commitment. Pickup with
provider time reservation and the masked local label are launch scope (PR-5, PR-34).

The PRD now explains the intended shipping-counter product, owner/staff/customer
jobs, goals and observable checks, a needs-to-requirements coverage matrix, and
initial versus later scope. UX-4 ties these to start-of-work, intake, service
selection, original-order recovery, reprint and staff-change behavior. This is a
user/reference-informed proposal, not market validation or a measured outlet trial.

Customer charge, seller provider cost, COD funds, revenue and physical custody
are distinct. Receipt/cashier, markup, settlement, handover, cancellation and
batch features remain conditional until their policy/acceptance is selected.
The planned demo can be evaluated without pretending those domains or live
provider operations have already been implemented.

LegacyReference historical pricing remains in CTX-24 through CTX-26 and the study.
The owner clarified the selected GeraiExpress policy in CTX-27/CTX-28:
**customer/resi uses normal Mengantar tariff before seller discount; seller cost
uses the verified net tariff under its assigned discount**, with applicable
COD fee and insurance counted once. PR-22/PR-23 separate retail/net amounts,
scoped discount assignment and actual provider activation. Historic cost-based
COD Ongkir is not the GeraiExpress customer price. Current rates/inclusion,
provider discount activation and customer-goods obligations still
require proof. Decision (DEC-016, CTX-42): for the first release the sender pays the
full normal tariff, the gerai receives a Super Admin-assigned discount stored as
configuration (BILL-3, DATA-9), and no platform fee or platform ledger exists; the
owner's starting terms (provider 30%, gerai 20%) are owner-stated and unverified, and
no percentage may appear on public pages until Mengantar confirms it in writing.

## Super Admin coverage

Super Admin is the existing platform-administrator role, now specified as its
own guarded workspace: tenant directory/configured registration review,
lifecycle, negotiated discounts, seller/integration readiness, operational health,
safe original-operation recovery, platform access governance and append-only
audit. Read the Super Admin section in the PRD, PR-15/PR-23 through PR-28,
IAM-7/TEN-4 and UX-6/UI-4. Source patterns are selectively traced in TD-10.

Second-factor/current-grant checks, direct PostgREST/RPC boundaries and minimal
platform projections are Observed in the implementation for the platform pages
(`/admin`, `/admin/pengajuan`, `/admin/integrasi`, `/admin/diskon`, `/admin/tenant/[id]`,
`/admin/akses`, `/admin/audit`, TOTP `aal2` via `src/lib/auth/totp.ts` and `private.platform_capable`;
ARCHITECTURE.md "Super Admin"); platform health monitoring (PR-25) and cross-tenant recovery (PR-27)
are not built. Decision (DEC-007, DEC-008): manual approval during the pilot, the Super Admin
bootstrap identity and a second recovery administrator. Exact platform capability grants for
discounts, support PII access and alert/retention policy remain owner decisions. Decision
(DEC-015): the workspace is served only from `owner.geraiexpress.com`. No account/secret/deploy
or broad tenant-data access was granted.

## Readiness limits

Still open (owner-held or gated): personal-data lifecycle and Terms/Privacy documents,
the self-hosted server provider/region and fixed IPv4, production PostgreSQL hosting
(same server or managed PostgreSQL) with backup/PITR proof and the T-067 independent
security review of the owned auth module, deployment and release criteria, the
Mengantar written answers on discounts (CTX-42), the masking misuse activation wording
(counsel, T-048), and volume and operational targets. CTX-41 items 11 to 17 were accepted by the owner on
2026-10-28 and are no longer open. Recommendations do not convert an unanswered choice
into approval, and accepted policy does not by itself authorize provisioning,
deployment or live provider calls. Requirements keep their own Status line; the work
queue is `TASKS.md` and this pack contains no competing implementation queue.

The selected reference pure-logic checks do not prove database/UI/container/provider
behavior; executed evidence is in `ARCHITECTURE.md`, `STATUS.md` and the review report.

## Registration coverage and remaining release gates

PR-29 through PR-33 complete the proposed real-user registration contract.
Read the registration diagram, screen states and first-resi checklist in UX-7;
UX-8 covers invited staff, returning users, password recovery and workspace routing.
TD-11/DATA-7/TEN-5/IAM-8/SEC-5/PRIV-3 specify transactions, direct API permissions,
native identity and private data boundaries. UI-5 applies the existing visual system.

Recommended path: verify email → complete account → submit gerai application
→ manual Super Admin approval during the pilot → explicit new/BYOK Mengantar
connection → verify pickup/pricing/collection capabilities → first resi. Decision
(DEC-007): email-first verification, manual approval during the pilot, and staff join
only by single-use invitation; Observed: registration, invitations and review are
implemented locally (ARCHITECTURE.md "Registration", "Staff and roles"). Staff
invitation grants only an accepted role in an existing tenant; it does not
register another business or seller. Existing identities can hold several explicit
tenant memberships without sharing their provider accounts.

History: ARCH-3 originally proposed Supabase custom SMTP → Cloudflare Email Sending SMTP,
and DEC-009 replaced that with a Worker-served Supabase Send Email Hook. Current mechanism
(DEC-020, DEC-021, ADR-0002, T-066): the Send Email Hook route and `SEND_EMAIL_HOOK_SECRET`
are removed; `public.auth_issue_otp` enforces the registration gate and refuses anonymous
identities in SQL before any code row exists, `src/lib/auth-mail.ts` (`renderCodeMail`)
renders the 6-digit Bahasa Indonesia code mail, and `src/lib/mail-transport.ts` delivers it
directly (Mailpit locally; production mail fails closed until the owner selects a sending
domain and provider in T-063). Own password recovery (PR-32) is scheduled with the mail
gate (DEC-013).

The initial registration specification avoided adding a second PRD, execution queue,
payment gateway or deployment provider; on 2026-10-29 the owner directed (DEC-021, ADR-0002)
that Supabase Auth be replaced by the application-owned auth module built in T-064..T-066
(pending T-067 independent security review).
Still required before real release: selected onboarding/member policies, real
application/provider policy documents, accepted data lifecycle, verified account/
network/mail/runtime capabilities, current pricing/PDF proof, executable RLS/auth/
provider checks and rendered browser evidence. Research-stage document validation
does not establish planning/ready/verified-stage or production completeness.


## Latest semantic audit

The completeness audit corrected draft-versus-submit effects, immutable review
revisions, returning-user OTP routing, session-completion authority, invitation
replay after membership removal and surviving platform access governance.
CTX-9 was first recorded as a proposal; the owner accepted it on 2026-10-14 as DEC-006
(one tenant business owns one Mengantar seller). DATA-2/DATA-5 now distinguish whole-IDR
customer charges from exact provider decimal evidence, and DATA-3 and DATA-4 match the
tenant-owned account model and its integrity rules.

TD-3 makes unpaid recovery a reviewed original-batch payment operation. TD-4
specifies existing-generation GET renewal, shared Print quota and format limits.
TD-9 supplies prospective synthetic pricing vectors without inheriting a fee
percentage. The pricing study now labels old cost-based COD Ongkir as historical.
Shipping-money, release/restore and operational-signal owners are linked above.
The context record owns executed verification and remaining applicability gates.


## Project-local architecture

This pack is now canonical inside the GeraiExpress repository. ARCH-4 in
[Runtime architecture](04-SYSTEM-ARCHITECTURE.md) owns the proposed module layout,
trust diagram, deployment matrix and primary execution paths. Root
[ARCHITECTURE.md](../../ARCHITECTURE.md) records actual implementation; root
[STATUS.md](../../STATUS.md) owns current handoff. Project-local provider/reuse
research is in [docs/research](../research/geraiexpress-mengantar-partner-api.md).
Historical statements about staging/no repository in prior review evidence
remain historical observations, not current project status.
