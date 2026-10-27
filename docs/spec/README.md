# GeraiExpress — Reviewed Planning Draft

- Status: Reviewed planning draft incorporating Partner API and the user-selected visual direction; implementation readiness remains conditional.
- Owner: Paduka Ongki
- Updated: 2026-10-13
- Location: Canonical repository specification at `docs/spec/`; promoted on 2026-10-13. Original staging is a retained non-authoritative snapshot.

GeraiExpress is a Cloudflare + Supabase shipping-outlet product using Mengantar
and the relevant LegacyReference workflows. This pack incorporates a read-only source
review, identifies what can be reused, and separates old application behavior
from current provider capabilities. It does not claim an application was built.

## Read in this order

| Document | Canonical responsibility |
|---|---|
| [Context record](CONTEXT-RECORD.md) | User intent, evidence, owner-held decisions, applicability, and verification history |
| [Product requirements](02-PRD.md) | Product direction, intended users, gerai operating needs, goals, scope ordering, requirements and open policies |
| [Technical design and reuse matrix](03-TECHNICAL-DESIGN.md) | Exact reference modules, extract/adapt/rebuild/conditional dispositions, provider orchestration and target checks |
| [Runtime architecture](04-SYSTEM-ARCHITECTURE.md) | Proposed components and trust/runtime boundaries |
| [Data model](05-DATA-MODEL.md) | Logical entities, snapshots, state dimensions, ownership and provider-account identity |
| [Tenant isolation](06-TENANT-ISOLATION.md) | Direct Data API/RPC and asynchronous scope enforcement |
| [Identity and permissions](07-IAM-RBAC-ABAC.md) | Candidate role matrix and atomic governance |
| [Presentation and branding](10-DESIGN-SYSTEM-WHITELABEL.md) | shadcn/ui + Apple-inspired tokens, components, responsive state/accessibility and brand boundaries |
| [Shipping money](11-BILLING-PAYMENTS.md) | Payer/collection responsibilities, financial authorization and reconciliation boundaries |
| [Security](12-SECURITY-ARCHITECTURE.md) | Command/credential/tracking trust controls and prospective proofs |
| [Privacy](13-COMPLIANCE-PRIVACY.md) | Personal-data purposes and unresolved lifecycle/processing decisions |
| [Delivery and recovery](15-DEVOPS-CICD-MIGRATIONS.md) | Demo/sandbox/pilot release gates, schema compatibility and restoration without duplicate external effects |
| [Operational signals and limits](16-OBSERVABILITY-RATE-LIMITING.md) | Observable journey outcomes, private telemetry, response ownership, actual-account quotas and retry safety |
| [UX flows](17-UX-FLOWS-SCREEN-CONTRACTS.md) | Screen jobs, primary actions, state/recovery and browser acceptance |
| [Complete Mengantar Partner breakdown](../research/geraiexpress-mengantar-partner-api.md) | Four endpoint contracts, signing, all error codes, seller lifecycle, production egress and verification gates |
| [LegacyReference pricing study](../research/geraiexpress-reference-pricing-review.md) | Customer/provider prices, collection modes, legacy formulas, visibility gaps, example and bounded checks |
| [Official source records](sources.json) | Vendor retrieval provenance and review triggers |
| [Reference scan and executed check](reference-scan.json) | Reference revision/dirty scope, source hashes, and bounded test result |

## What the review changes

Small validation/formatting/filter functions are extraction candidates. Contact,
snapshot, queue/recovery, membership-governance, audit, and UI composition
patterns transfer with adaptation. Supabase auth/RLS, Worker commands, provider
wire transport, account coordination, dropshipper mapping, provider PDF, and
signed tracking need their own implementation and proof.

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

Next.js App Router + shadcn/ui for the operator application on Cloudflare
Workers; Supabase Auth/PostgreSQL/RLS for identity and tenant data. CTX-20
records alternatives and the required runtime compatibility check; Cloudflare's
currently recommended vinext path is beta. The earlier React/Vite proposal is
superseded, not an installed framework.

Partner API is the seller/key control plane. Public API remains the shipping
data plane. Recommend a dedicated seller per tenant business, multiple outlets
through verified pickup mappings, and BYOK for existing accounts. Contacts and
staff do not automatically become sellers; PR-17 through PR-20 add durable
onboarding, owner agreement/access, and key/callback recovery.

The user-selected presentation uses a single blue action accent, white/parchment
surfaces, system typography, prescribed radii, no decorative gradients, and
imagery-only shadows. UI-1 through UI-3 adapt this to efficient operator forms,
tables, validation and recovery, with no rendered UI claim.

**Production Partner gate:** Mengantar enforces source-IP allowlisting.
A Cloudflare VPC/Gateway dedicated-egress route is a proposed solution requiring
Zero Trust Enterprise entitlement and provider-approved primary/failover IPs.
No ordinary Worker or Supabase Function static-IP guarantee is assumed.
ARCH-2 owns the required network proof and availability decision.

The first usable preview must include the demo login requested in CTX-21:
a dedicated sample workspace, seeded contacts/shipments, simulated shipping and
sample labels, plus working login instructions. PR-21, IAM-4 and UX-3 own this
contract. No demo account or password has been provisioned in this planning phase.

## Product direction and gerai needs

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
provider discount activation, PDF output and customer-goods obligations still
require proof; application monetization is a separate decision.

## Super Admin coverage

Super Admin is the existing platform-administrator role, now specified as its
own guarded workspace: tenant directory/configured registration review,
lifecycle, negotiated discounts, seller/integration readiness, operational health,
safe original-operation recovery, platform access governance and append-only
audit. Read the Super Admin section in the PRD, PR-15/PR-23 through PR-28,
IAM-7/TEN-4 and UX-6/UI-4. Source patterns are selectively traced in TD-10.

Second-factor/current-grant checks, direct Data API/RPC boundaries and minimal
platform projections are proposed target controls, not a running admin login.
Manual approval requirement, initial bootstrap/recovery identity, exact platform
capability grants, support PII access and alert/retention policy remain explicit
owner decisions. No account/secret/deploy or broad tenant-data access was granted.

## Readiness limits

The precise provider account-owner mapping, tenant/outlet cardinality, member policy, official
label branding, monetary scope, personal-data lifecycle, cloud accounts/regions,
and deployment criteria remain owner-held decisions. Recommendations do not
convert an unanswered choice into approval. Required implementation contracts
remain Proposed and there is no competing implementation queue in this pack.

No cloud resource, app code, migration, customer-data copy, authenticated provider
call, deployment, commit, or push is part of this documentation task. The selected
reference pure-logic checks do not prove database/UI/Workers/provider behavior.

## Registration coverage and remaining release gates

PR-29 through PR-33 complete the proposed real-user registration contract.
Read the registration diagram, screen states and first-resi checklist in UX-7;
UX-8 covers invited staff, returning users, password recovery and workspace routing.
TD-11/DATA-7/TEN-5/IAM-8/SEC-5/PRIV-3 specify transactions, direct API permissions,
native identity and private data boundaries. UI-5 applies the existing visual system.

Recommended path: verify email → complete account → submit gerai application
→ selected activation policy → explicit new/BYOK Mengantar connection → verify
pickup/pricing/collection/label capabilities → first resi. Manual Super Admin
approval and email-first UX are proposals pending selection, not implemented facts.
Staff invitation grants only an accepted role in an existing tenant; it does not
register another business or seller. Existing identities can hold several explicit
tenant memberships without sharing their provider accounts.

ARCH-3 proposes Supabase custom SMTP → Cloudflare Email Sending SMTP to keep
authentication email within the selected stack. Current official SMTP support was
verified in documentation; actual plan/domain/TLS/delivery and beta acceptance
remain release gates. Public signup cannot depend on the restricted test mailer.

This update fills registration contracts without adding a second PRD, execution
queue, custom Auth implementation, payment gateway or new deployment provider.
Still required before real release: selected onboarding/member policies, real
application/provider policy documents, accepted data lifecycle, verified account/
network/mail/runtime capabilities, current pricing/PDF proof, executable RLS/auth/
provider checks and rendered browser evidence. Research-stage document validation
does not establish planning/ready/verified-stage or production completeness.


## Latest semantic audit

The completeness audit corrected draft-versus-submit effects, immutable review
revisions, returning-user OTP routing, session-completion authority, invitation
replay after membership removal and surviving platform access governance.
CTX-9 is explicitly a proposal; its former Decision classification did not have
owner acceptance. DATA-2/DATA-5 now distinguish whole-IDR customer charges from
exact provider decimal evidence, and DATA-3 matches the proposed tenant-owned
account model.

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
