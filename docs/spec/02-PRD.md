# GeraiExpress — Product Draft

- Status: Reviewed planning draft; requirements below remain Proposed until product decisions are resolved.
- Owner: Paduka Ongki
- Updated: 2026-10-13
- Context: `CONTEXT-RECORD.md` is the current decision and evidence owner.
- Execution: No implementation task is marked complete by this document.
- Review basis: Original and advanced LegacyReference worktree scans, bounded local tests, and current vendor documentation; CTX-11 through CTX-15.

## Product and outcome

GeraiExpress lets a shipping outlet serve multiple customer senders, compare
Mengantar courier services, issue shipments, and print the corresponding labels.
Different outlet businesses work in isolated tenants with their own brand and
users. Reusable sender and recipient contacts reduce repeated entry.

LegacyReference is the reference for product workflows. Cloudflare and Supabase are
the requested new infrastructure direction (CTX-1 through CTX-4).

## Product direction and intended users

Direction: a branded, multi-tenant shipping-counter workspace where an outlet
can serve many customer senders through Mengantar. The primary job is to accept
correct shipment details, choose a valid service, obtain an authoritative resi,
print its label, and retain enough context to answer the customer's next visit.
Sources: CTX-1 through CTX-3 and CTX-22; proposed operating frame CTX-23.

A tenant is the business boundary. Its users work in permitted outlets under
that business's identity. Recommend one Mengantar seller per tenant business,
with verified outlet pickup mappings; existing sellers connect their own key.
Customer contacts and staff memberships remain separate from that seller's
ownership. Exact owner/cardinality/role policy remains CTX-9 and IAM-1.

| Actor | Job and trigger | Successful outcome | Evidence / uncertainty |
|---|---|---|---|
| Counter operator | A customer brings shipment details or returns to ask about an existing resi | Find/reuse contacts, compare services, confirm a shipment, print or recover the existing order | User-requested job and reference workflows; staffing, throughput and time pressure not measured |
| Gerai owner / tenant administrator | Set up the business, provider access, pickup and staff; resolve escalated failures | A usable authorized outlet with clear capability/readiness and controlled staff access | Candidate role from IAM-1; exact authority and outlet assignments need selection |
| Customer sender / recipient | Supply party details or request shipment information through the counter | Correct identity/destination and a traceable shipment within the gerai's permitted workflow | User-requested contacts; no customer login or self-service portal requirement established |
| Super Admin / platform administrator | Govern tenants, assigned discounts, provider readiness, monitoring and exceptions | Explicitly authorized platform decisions, safe recovery and audit | PR-15, PR-23 through PR-28; no automatic tenant impersonation or customer-directory access |
| Initial reviewer | Try the first preview without creating a real seller account | Demo login and a complete simulated counter flow | Explicit user request in CTX-21; PR-21 |

The initial operating context is Indonesian domestic shipping through Mengantar,
with proposed Bahasa Indonesia UI, `id-ID` money formatting and explicit WIB
period labels. Desktop counter use with a printer is a proposed primary setup;
phone/tablet access must satisfy NFR-4. Actual printer models, label formats,
scanner/scale integrations, connection quality and browser support must be
validated in the pilot. Country, hardware and scale assumptions do not create
new provider capabilities or legal claims.

## Problem, goals and evaluation

The user identified a sender-identity mismatch: a seller-centric integration can
show the seller where the counter needs a customer's sender identity. Repeated
sender/recipient entry is also addressed by the requested saved-contact feature.
The reference supplies useful workflows but has a different auth/data/runtime
stack; selective reuse must preserve correct tenant and account authority.
No customer interviews, market-size findings, measured demand or operational
performance baseline are claimed by this draft.

| Goal | Requirement coverage | Observable evaluation |
|---|---|---|
| Complete the primary counter job | PR-2 through PR-9 | Demo walkthrough, then an authorized sandbox pilot: contact → draft → quote → confirmation → provider AWB → supported label |
| Preserve the right sender and pickup identity | PR-3, PR-7 | Returned shipment/label contains the supported customer name/phone and chosen gerai pickup; contact edits do not alter historical output |
| Keep businesses and staff authority scoped | PR-1, PR-10, PR-13; NFR-1 | Same-tenant permitted actions pass and foreign/revoked/direct-API actions fail |
| Make interruptions recoverable | PR-5, PR-6, PR-12; NFR-2 | Double confirmation, timeout, unpaid order, stale quote and expired-label scenarios preserve one original operation and a usable next action |
| Make onboarding and the first evaluation usable | PR-8, PR-17 through PR-21, PR-29 through PR-33 | New/existing seller paths and demo entry have truthful readiness and no credential exposure or unconfirmed provider effect |
| Keep work usable at the counter | PR-9; NFR-4; UI-1 through UI-3 | Primary keyboard/touch journeys pass at the required viewports with long data, failure states and retained entered values |
| Govern and operate the platform with bounded authority | PR-15, PR-23 through PR-28; TEN-4, IAM-7 | Platform access denial, tenant/discount review, scoped health, original-operation recovery and truthful audit checks pass without widening customer access |

Business improvement measures for a pilot are intake completion time, repeated
contact-entry effort, exception-resolution effort and print readiness. Baseline,
target, sample size and evaluation period are unknown; the product owner selects
them after observing an outlet trial. These are proposed evaluation measures,
not a promise of speed/revenue or an accepted analytics instrumentation feature.
Account-specific capabilities and correctness checks must pass before live use.

## Gerai needs and requirement coverage

The table separates requested needs, source-observed patterns and proposed
follow-up scope. Every initial behavior points to an existing product contract;
source presence alone does not accept an optional feature.

| Operating need | Required behavior / limit | Scope and owner |
|---|---|---|
| Begin work in the correct gerai | Visible tenant/outlet, current membership and setup readiness | Initial recommendation; PR-1, PR-8, PR-13 |
| Serve a returning sender or repeat destination | Search/select saved contacts and addresses; intentionally save new ones | Requested; PR-2, PR-7 |
| Quote before creating the shipment | Valid route/parcel input and current seller-specific services; preserve intake on errors | Requested shipping flow; PR-4, PR-9 |
| Put customer identity on the shipment | Resolve permitted provider dropshipper name/phone while keeping verified gerai pickup | Requested; PR-3; arbitrary customer-address or logo replacement is not established |
| Enter a correct parcel | Name/content, weight/dimensions and provider-required declared data; validate units and bounds at the backend | Existing draft/quote/issue contracts; PR-4, PR-5, DATA-2; exact account-specific payload verified during integration |
| Issue once and recover interruptions | Explicit review, one durable operation, recovery of original unknown/unpaid order | Requested core flow; PR-5, NFR-2 |
| Print and reprint the right label | Provider AWB/permissions, generation progress, authorized private label and historical snapshots | Requested; PR-6, PR-7; printer/media fit is pilot evidence |
| Find a shipment while helping a customer | Search/filter queue and inspect status/history/next valid action | Initial recommendation; PR-9, PR-12; no broad cross-tenant provider search |
| Work with more than one staff member | Explicit memberships/roles, current authority, conflict handling and actor audit | Requested multi-user direction; PR-1, PR-10; staffing/assignment policy pending |
| Operate under the gerai's identity | Validated app name/logo and visible outlet context | Requested; PR-13; custom official-label layout and customer receipt need separate acceptance |
| See what needs attention during the day | Unknown/unpaid/label-failure worklist first; scoped count/time basis and refresh | Queue PR-9 first; overview PR-14 proposed after shipping pilot |
| Keep a record of customer charges and receipts | Separate selected normal customer tariff, discounted provider cost, fee/insurance and payment status | PR-22/PR-23 select pricing; receipt/cashier/extra markup/ledger remain conditional |
| Pass parcels to a courier and handle cancellations | Explicit local custody/handover versus verified courier events; state-valid cancellation | Advanced-reference candidates under TD-1; separate acceptance, permissions and recovery needed |
| Process larger repeat batches | CSV preview, selected-row confirmation, scoped export and batch-print behavior | Later candidates PR-11, PR-16 and TD-1; volume/limits not inherited automatically |
| Try the application on first delivery | Working demo access, synthetic contacts/shipments and simulated labels | Requested; PR-21, IAM-4, UX-3 |

### Money and custody distinctions

| Concept | Authority / unresolved policy |
|---|---|
| Mengantar quote and order funding | Seller-specific provider amounts/account; confirm the actual payable operation and balance path in sandbox |
| Price charged to the customer | Selected normal Mengantar tariff before seller discount, plus applicable verified fee/insurance exactly once; CTX-28 and PR-22. Extra markup/payment/receipt workflows need separate acceptance. |
| COD value and settlement | Money collected under provider rules; it is not automatically gerai revenue or proof of customer payment to the counter |
| Gerai revenue or profit | Requires accepted price/cost/fee/tax/refund definitions; do not derive a profit KPI from provider balance or shipment count |
| Parcel handed over at the counter / to a courier | Local custody state; a printed label or local handover does not establish provider pickup or delivery |

## Initial scope and staged candidates

The recommended first preview includes demo access and the core counter screens:
login/scope, contact reuse, one-page intake/quote/review, shipment queue/detail,
simulated recovery/label access, and settings readiness. The paired restricted
Super Admin preview uses isolated synthetic platform fixtures for tenant,
readiness/discount, exception and audit screens; the shared operator demo gains
no platform permission. Demo fixtures are not proof of live issuance. Live pilot enablement adds verified Supabase isolation,
real seller onboarding/BYOK, provider sender/order/label proof and an approved
production egress path when Partner production is used.

The complete create-resi flow and its failure cases precede optional finance,
bulk operations, richer reports and additional integrations. The existing
scope-ordering table below owns delivery ordering; exact milestones, budget,
release dates and workload targets remain owner decisions.

The following are **outside the current proposed initial delivery**, subject to
explicit later scope selection rather than permanent rejection: a customer
self-service portal, a second shipping aggregator, a custom public API, custom
domains, subscription billing, full cashier/accounting/COD settlement, automated
old-data migration, and direct printer/scale/scanner hardware integrations.
Customer receipts, scan handover, cancellation and batch printing remain useful
LegacyReference candidates under TD-1, with their own policy/acceptance before exposure.

## Core distinctions

| Object | Meaning |
|---|---|
| Tenant | Business access boundary; proposed to own its brand, users, outlets, contacts, and shipments. |
| Outlet | Physical operating location and pickup configuration; proposed to allow multiple outlets per tenant, pending owner confirmation. |
| User | A person who signs in and has explicit membership/permissions. |
| Contact | A saved sender and/or recipient; saving a contact does not create a user. |
| Sender | Customer identity attached to one shipment; distinct from the physical pickup address. |
| Recipient | Destination party and provider-resolved destination area. |
| Provider account | Mengantar seller owns orders, balance, rates and provider masters. Proposed one seller per tenant business, plus existing-account BYOK; exact owner/outlet mapping is CTX-9. |
| Shipping label | Courier/provider-authoritative AWB and routing document. |
| Customer receipt | Outlet-branded proof of the customer transaction; need and content remain an owner decision. |

## Selected pricing direction — normal customer tariff, discounted seller cost

The product owner selected this policy in CTX-27 and CTX-28. The
[LegacyReference pricing study](../research/geraiexpress-reference-pricing-review.md)
remains source evidence; its historical COD Ongkir break-even and percentages
do not override the current GeraiExpress decision.

| Price / audience | Selected behavior |
|---|---|
| Customer and resi shipping | Actual Mengantar **normal shipping tariff before seller discount**, matched to the chosen route, parcel, courier and service/tier |
| Seller/gerai cost paid to Mengantar | Actual applicable net cost under its assigned/activated discount; private to authorized financial/admin access |
| Discount given to a seller/gerai | A scoped, versioned commercial assignment; must match verified provider billing or remain pending/mismatched, not falsely applied |
| Customer COD fee | Applicable verified Mengantar fee/base/minimum/rounding; add it only where not already included, with the accepted payer/collection method |
| Seller COD fee | Actual provider deduction and any independently verified fee discount; do not assume the shipping discount also applies to this fee |
| Customer and seller insurance | Applicable verified coverage/premium and payer; no invented percentage, unsupported automatic coverage, or silent omission of a required premium |
| Gerai extra markup/admin/packing | No additional discretionary amount is selected by this instruction; any later addition needs its own accepted requirement |
| Platform subscription/commission | Still a separate business decision; no entitlement established by the four Partner routes |

Let `R` be normal shipping, `N` verified net shipping after the seller discount,
`Fc`/`Fp` customer/provider COD fee components, and `Ic`/`Ip` customer/provider
insurance components. The conceptual totals are:

```text
Customer shipping-related charge = R + applicable Fc + applicable Ic
Seller/provider cost             = N + applicable Fp + applicable Ip
Shipping-related spread          = customer charge − verified provider cost
```

Each applicable component is counted once; fee-inclusive amounts must first be
mapped to their actual components. By default use the same verified provider
COD fee/premium for the customer where charged, unless an independently
supported fee/insurance agreement establishes a different amount. A shipping
discount alone does not discount COD fees or insurance. These formulas describe
a separation of quantities, not a new universal provider rate or profit claim.

For Full COD, courier collection includes goods and the normal retail
shipping-related components assigned to courier collection. For COD Ongkir,
goods collection is zero but the **normal retail shipping basis remains R**;
it must not fall to N merely because the old reference used cost break-even.
Goods value may still be needed to price insurance even when the courier does
not collect it. Confirm whether each insurance/fee item is collected by the
courier, paid at the counter or absorbed under an accepted agreement; never
collect the same item twice or add insurance to a provider COD field without
contract support. If a fee depends on final collection, use the current verified
provider calculation rather than a hardcoded historical 333-bps gross-up.

Use account-aware Mengantar quotes for seller-specific pricing. The reviewed
Public documentation distinguishes account-aware estimates from a flat public
estimate route and raw 3PL rates; do not substitute either without entitlement
and matching-contract proof. Map customer normal shipping separately from
fee-inclusive estimated totals and net settlement fields. No customer value is
chosen by taking the lowest response field.

The initial price shown is a timestamped quote. Revalidate changed parcel,
route, service, account or applicable discount before confirmation; price
changes before submission require a new review. If the provider reports a
changed actual amount after submission, preserve the original order and both
quoted/actual facts for reconciliation, not a blind re-creation or an invented
promise that an external charge was rolled back.

Discount administration is PR-23. The reviewed Partner API has no seller-rate
mutation endpoint; changing an app setting alone cannot alter Mengantar's
actual debit. Obtain the provider-approved activation path/commercial terms and
verify resulting net quotes/billing before marking an assigned discount active.

Normal tariff and approved customer totals must appear on customer/resi output
without exposing net cost or assigned discount. Verify this on actual provider
PDFs/templates; do not silently print discounted cost or replace courier routing
with an unapproved label. Sender/customer goods proceeds, withdrawals, settlement
and returns remain separate accepted financial responsibilities when Full COD
is enabled. Application monetization is not decided by this pricing instruction.

## Stack and presentation direction

Recommend Next.js App Router + TypeScript + shadcn/ui for the authenticated
application, deployed on Cloudflare Workers through a verified adapter/runtime.
CTX-20 and ARCH-1 compare Next.js, Astro, and the earlier React/Vite proposal;
Cloudflare's currently recommended vinext route is beta and needs a scoped
compatibility check. Supabase supplies Auth/PostgreSQL/RLS. No Vercel or VPS is
required by the design. Partner production egress has an Enterprise dependency
under ARCH-2; ordinary hosting alone does not satisfy it.

UI-1 through UI-3 translate the user-supplied Apple reference into blue/neutral
semantic tokens, native typography, clear action hierarchy, restrained surfaces,
and practical operator density. This selects the visual direction, not an
implemented screen or a claim about Apple website internals.

## Scope ordering after reference review

The ordering below is a recommendation, not an accepted commercial or release policy.

| Delivery slice | Proposed content | Gate |
|---|---|---|
| Foundation | Tenant/user membership, restricted Super Admin access/business directory, initial demo workspace, seller onboarding/BYOK, agreement, outlet readiness, contacts and drafts | Tenant/account-owner policy, Partner access/egress plan, isolated database proof |
| Shipping pilot | Public API areas, quotes, sender mapping, explicit issuance/recovery and provider PDF | Durable seller/key binding, permissions, current sandbox contract, per-seller coordination |
| Operational completeness | Shipment queue/detail, tracking, print history, daily overview/brand, Super Admin monitoring/discount-readiness/recovery/audit | Each primary action has backend enforcement and observed evidence |
| Later candidates from LegacyReference | CSV import/export, richer analytics, extended platform reports, RTS, finance | Explicit requirement acceptance and domain-specific contracts |

Finance/COD fee percentages, tax policy, tenant pricing, free/unlimited plans,
old retention periods, custom domains, and automatic migration are not inherited
from LegacyReference by copying its source. An observed feature can be a reuse
candidate without becoming a promised initial-release requirement.

## Proposed actors

IAM-1 owns the candidate permission matrix. Super Admin (the platform administrator) manages tenant
lifecycle and explicit platform capabilities; tenant administrator configures an owned workspace and staff;
operator performs permitted daily shipping/contact work; a machine worker
processes an already-authorized operation. Senders and recipients are contact
data subjects, not automatically registered users. Support impersonation has no
default permission. Owner decisions are still required before IAM implementation.

## Super Admin direction and operating needs

**Super Admin** is the UI/product label for the existing **platform
administrator**. Tenant Admin is the gerai owner/admin; Operator is counter
staff. Platform pricing/integration/recovery permissions are capabilities of
an explicitly authorized platform principal, not automatic tenant membership.
This scope is proposed under CTX-29/CTX-30; no GeraiExpress admin account or
screen is implemented.

| Need / workspace | Decision and main action | Required boundary / owner |
|---|---|---|
| Restricted access | Dedicated Super Admin entry, active platform grant and second-factor verification; manage approved platform staff access | PR-24, IAM-7; public signup/demo/tenant roles cannot promote themselves |
| Tenant/gerai directory | Search/filter status; open business profile, owner contact, outlet/member counts and readiness; create or change permitted lifecycle | PR-15; minimal business details, audited action, no customer directory by default |
| Registration review | Inspect setup/verification and approve/reject with a reason when manual review is enabled | PR-15; review requirement itself remains owner policy; a reviewed app tenant is not an automatically verified Mengantar seller |
| Seller/Mengantar readiness | Identify partner-created versus BYOK, pending/unknown onboarding, provider account restriction, sender/PDF/webhook readiness and safe credential status | PR-26, PR-17 through PR-20; no raw key/secret, provider dashboard impersonation or automatic account recreation |
| Diskon gerai | Assign versioned negotiated terms, inspect provider activation/mismatch and net quote | PR-23, IAM-6; normal customer/resi tariff stays unchanged; no invented upstream discount endpoint |
| Platform monitoring | Find affected tenants, current queues/unknown/unpaid/label failures, recent provider failures, stale tracking and quota/egress issues | PR-25; scoped minimal projections, explicit period/snapshot and freshness |
| Controlled recovery | Inspect durable operation timeline, request safe status reconciliation or resume a provably safe recorded handoff | PR-27; no blind create-order retry, payment, balance withdrawal, or arbitrary status/price edits |
| Integration settings | Inspect Partner environment, configured origin, enablement, allowed egress, capability/secret-version readiness and scheduled limits | PR-26; actual secrets/cloud changes use their approved operational channel, not plaintext web settings |
| Audit trail | Search actor/action/tenant/period/outcome/reason and before/after versions | PR-28; append-only, credential/PII-minimal, no browser delete/edit |
| Financial oversight | Inspect only explicitly permitted commercial/net-cost data needed for discount verification | PR-22/PR-23; platform commission, goods revenue, tenant payout/withdrawal and profit dashboards require separate financial scope |

### Monitoring definitions

| Signal | Basis / interpretation | Next decision |
|---|---|---|
| Active/suspended/pending tenants | Current lifecycle snapshot at displayed read time; not a period shipment count | Open relevant tenant/review queue |
| Resi issued in the selected period | Unique local shipments with provider-authoritative AWB and issued timestamp in the selected WIB interval; demo excluded | Filter by tenant/courier and compare the same cohort |
| Queued/in-flight/unknown/unpaid operations | Current outstanding durable state, age and affected tenant count | Inspect original operation, readiness or required tenant action |
| Provider failures | Failed attempts in the labelled period with denominator/basis if a rate is shown; not a promise of final failed shipments | Inspect safe code, recent occurrence and correlated operations |
| Labels/tracking requiring attention | Existing label jobs or observations with failed/stale/unknown state; selected thresholds explicit | Reconcile/poll the existing reference within account limits |
| Partner quota/egress/discount readiness | Latest observed/local-control status and time; estimated local usage is labelled separately from provider response headers | Defer allowed work or resolve approved configuration/provider activation |

Do not sum attempts, shipments and current exceptions into one misleading total.
No "platform revenue" is derived from COD principal or the difference between
normal and discounted tariff without an accepted commercial/financial contract.
Alert thresholds and response targets are not copied from LegacyReference defaults.

### Proposed Super Admin journeys

1. Sign in through the Super Admin entry; complete required factor verification
   and load current platform capabilities. An ordinary tenant session is denied.
2. Start with work needing attention, then tenant/readiness summary and a
   paginated detail list. Filters carry explicit global or selected-tenant scope.
3. For onboarding, inspect the business record and app/provider readiness. If
   manual review is enabled, record a reasoned decision; existing provider
   creation/recovery stays tied to the same seller operation.
4. For pricing, select the tenant/seller, review terms and effective version,
   save the assignment and verify provider activation/net cost. Customer normal
   tariff never changes merely because the seller discount changes.
5. For an exception, inspect its original operation and attempts, perform only
   a permitted safe reconciliation/resume, and show durable pending/result state.
6. For suspension/reactivation, explain the effect and record a reason. Block
   new work as selected while recording already-dispatched outcomes truthfully;
   a local suspension does not ban/delete a Mengantar account.
7. Review the resulting audit event. Grant/revoke platform access through its
   governed flow; preserve the final active administrator and recovery path.

No Super Admin function needs a separate hosting stack or custom domain for
its initial design. Use the same Next.js/Workers/Supabase application with a
separately guarded platform workspace. Notifications, ticketing, impersonation,
bulk destructive changes, custom domains and platform-wide customer exports
are conditional future features, not implied by this completeness review.

## Proposed first-use journey

The first preview offers the separate demo entry in PR-21. Demo access uses
synthetic data and simulated shipping; it does not register a real gerai or seller.
UX-7 owns the complete real-account journey and UX-8 owns staff/recovery paths.

1. Choose **Register a gerai**, **Sign in**, **Accept staff invitation**, or
   **Try demo**. An existing authenticated user resumes their own onboarding or
   selects an existing membership; a login does not create another tenant.
2. Recommended registration: enter a real email, review the application's
   own policy notices, request a native Supabase email code, and verify it.
   Only then choose a password for a new account. This email-first proposal
   avoids attaching a third party's chosen password to an unverified inbox.
   Previously completed app accounts keep their credentials unless they use
   account recovery. Supabase identity creation is not seller creation.
3. Complete owner/business information and the initial outlet setup. Submit
   an explicit versioned application. The backend atomically creates one
   pending tenant, first administrator membership, initial outlet and audit
   record, or returns the existing result for that submission. Auth and email
   operations are outside that database transaction and recover independently.
4. Recommended pilot policy: Super Admin reviews and approves, requests
   corrections, or rejects with a safe reason. The owner can view pending status
   and edit only a draft or changes-requested application under DATA-7; the
   submitted review revision is immutable. Pending owners cannot issue shipments. Manual review
   remains a proposal; if automatic activation is selected, record the applied
   policy/version and apply the same identity/data checks without a fictitious
   review. Neither branch creates or approves a Mengantar account automatically.
5. Once the tenant is active, its authorized administrator chooses **Create a
   Mengantar seller** or **Connect an existing seller**. Confirm the real
   account owner and the separate provider agreement. PR-17 through PR-20
   govern durable Partner creation, existing-account BYOK and recovery.
6. Configure the actual pickup, customer sender mapping, supported services,
   normal retail/net seller pricing, COD/insurance if enabled, and official
   label permission. Display capability-specific readiness and the remaining
   setup action. A connected key, tenant approval or assigned discount alone
   is not evidence that live shipping/printing is ready.
7. The operator selects an allowed tenant/outlet and completes one-page intake
   → current quote → explicit review → submit → authoritative provider AWB
   → supported label. Customer charges use normal Mengantar tariff under
   CTX-28; private seller cost follows the verified discount contract.

When a customer sender differs from the seller, resolve its enabled dropshipper
mapping in that provider account. Saving a contact never registers a seller or
silently writes a provider master. Pickup remains the physical pickup origin.

### Registration information and ownership

| Stage | Required information / action | Boundary |
|---|---|---|
| Email verification | Real accessible email; application notice/required Terms acceptance | No password, tenant role, business approval or Mengantar agreement inferred from sending a code |
| Account completion | Initial/partial app identity explicitly sets or replaces its own password after fresh inbox proof | Supabase owns credentials; trusted completion/session guard follows TD-11; previously completed accounts keep their credentials or use explicit recovery |
| Gerai application | Business name, owner display name, business contact phone, first outlet name; confirm applicant authority | Server validates lengths/characters, contact shape and revisions; no API key, bank account, identity document or customer data requested here |
| Outlet readiness | Pickup address and verified provider area IDs; accepted operational/brand settings | Address can be completed during setup, but must be valid before quoting/issuing; local name is not a provider pickup ID |
| Seller connection | Confirmed seller owner/name/email/mobile, connection mode and actual provider policy agreement | Reusing verified app email is a proposed default; another owner requires a selected authority/verification method before dispatch |

Shipment prefix, paid-plan selection, top-up, bank/KYC collection and marketing
permission are not prerequisites to registering a gerai. Their reference presence
does not add accepted scope. Application policy acceptance and privacy notice
presentation remain distinct from optional marketing consent and later Mengantar
agreement. Use real policy documents, not invented legal URLs or a single bundled
provider checkbox.

### Independent registration states

| Dimension | Proposed states / meaning |
|---|---|
| Identity | Code requested, verified session, account completion, recovery required; Auth is authoritative |
| Application | Setup draft, submitted, changes requested, approved, rejected, withdrawn; versioned business decision |
| Tenant lifecycle | Provisioning, active, suspended, archived; controls tenant access, independently of application/provider status |
| Provider connection | Unconnected, registration pending/unknown, BYOK verification, connected, restricted; DATA-4 owns exact contract |
| Operational readiness | Per-capability ready/blocked/unverified with reason; never inferred from a single green account flag |

Pending owners receive only their own setup/status projection and permitted setup
commands. Approval can activate the tenant without making it shipping-ready.
Later suspension does not rewrite an earlier approval or delete the seller.
An approved application's immutable business revision remains review evidence;
subsequent settings edits use their own authorization/history.

## Functional requirements

### PR-1 — Tenant workspace access
- Status: Proposed
- Owner: Paduka Ongki
- Source: CTX-1, CTX-2.
- Statement: When a user opens an operational workspace, the system shall permit only tenants and outlets authorized by that user's current membership.
- Acceptance: Given users in two different tenants, When either opens, searches, exports, or mutates the other's data, Then access is denied without revealing the other tenant's records; the same permitted operations succeed within their own scope.
- Constraints: TEN-1, TEN-2, IAM-1; tenant selection is not authorization.
- Evidence: Pending implementation verification.

### PR-2 — Save and reuse contacts
- Status: Proposed
- Owner: Paduka Ongki
- Source: CTX-3.
- Statement: When a permitted user saves a sender or recipient, the system shall store a tenant-owned contact with name, phone, and address information and allow selection for a later shipment.
- Acceptance: Given a saved contact in tenant A, When an authorized A user creates another shipment, Then its contact information can prefill the appropriate party; tenant B cannot discover or select that contact.
- Constraints: DATA-1, DATA-2, PRIV-1, TEN-1. Shared phone numbers must not force unrelated people into one record. Roles and retention remain product decisions.
- Evidence: Pending implementation verification.

### PR-3 — Distinguish customer sender from pickup
- Status: Proposed
- Owner: Paduka Ongki
- Source: CTX-2, CTX-5.
- Statement: When a customer is the shipment sender, the system shall submit that customer's supported sender identity through a provider-account-owned dropshipper mapping while preserving the selected outlet pickup address.
- Acceptance: Given an enabled account and valid customer dropshipper master, When a supported shipment is submitted in the sandbox, Then the returned shipment and provider label contain the documented sender name/phone and keep the selected pickup address; a following ordinary shipment does not inherit the customer's identity.
- Constraints: TD-2, DATA-3, TEN-2. Re-resolve mappings after provider-account replacement or relevant contact changes; arbitrary sender-address/layout support is not established.
- Evidence: Documentation only; account-specific sandbox proof pending.

### PR-4 — Compare available courier services
- Status: Proposed
- Owner: Paduka Ongki
- Source: CTX-2, CTX-4.
- Statement: When valid pickup, destination, and parcel details are present, the system shall obtain account-appropriate Mengantar estimates and allow selection only from currently supported services.
- Acceptance: Given a documented unsupported route or unavailable COD service, When estimates are displayed, Then the unsupported option cannot be submitted; a valid available service retains its provider identity and quoted amounts for review.
- Constraints: TD-2, DATA-2. Provider account and origin authority must be current. Do not hardcode historical courier availability, discounts, or fees.
- Evidence: Pending implementation verification.

### PR-5 — Issue and recover a shipment
- Status: Proposed
- Owner: Paduka Ongki
- Source: CTX-2, CTX-4, CTX-9.
- Statement: When an authorized user confirms a shipment, the system shall validate the current account, scope, quote, sender, destination, and parcel data and record provider submission and recovery state without creating duplicate orders.
- Acceptance: Given a timed-out submission, When the user returns or retries, Then the shipment enters reconciliation rather than blind re-creation; given an existing unpaid order, Then payment recovery targets that order and printing stays unavailable until an authoritative AWB exists.
- Constraints: TD-3, TEN-2, SEC-1. Provider-account owner/cardinality must be selected under CTX-9; the recommendation is tenant-owned sellers with BYOK. A local idempotency key alone does not prove provider idempotency.
- Evidence: Pending implementation and sandbox verification.

### PR-6 — Obtain and print shipping labels
- Status: Proposed
- Owner: Paduka Ongki
- Source: CTX-2, CTX-6.
- Statement: When a scoped shipment has an authoritative AWB and the provider account has label access, the system shall request its supported label format, track generation state, and permit authorized printing.
- Acceptance: Given a paid, scoped shipment and whitelisted account, When label generation completes, Then the authorized user can print its provider-issued AWB and routing data; missing access, unpaid orders, generation failure, and expired downloads show an explicit recovery state.
- Constraints: TD-4, TEN-2, PRIV-1. No invented AWB, account-crossing generation ID, silent print-success claim, or unverified re-layout. Tenant logo customization remains unresolved.
- Evidence: Pending implementation and label verification.

### PR-7 — Preserve shipment party snapshots
- Status: Proposed
- Owner: Paduka Ongki
- Source: CTX-2, CTX-3.
- Statement: When a shipment is submitted, the system shall preserve the sender, recipient, pickup, provider-account reference, and provider identities used for that submission.
- Acceptance: Given a submitted shipment, When a source contact or outlet setting is edited, Then the recorded shipment and reprint continue to reflect the original submitted data.
- Constraints: DATA-2, PRIV-1. Privacy and correction rules must distinguish reusable master records from transaction history.
- Evidence: Pending implementation verification.

### PR-8 — Outlet readiness and provider configuration
- Status: Proposed
- Owner: Paduka Ongki
- Source: CTX-4, CTX-9, CTX-11.
- Statement: When a tenant administrator configures an outlet, the system shall show whether its account binding, pickup/area pair, sender capability, and label access are ready for the requested operation.
- Acceptance: Given an incomplete or replaced account configuration, When an operator attempts an affected operation, Then the system blocks it with a scoped setup path and does not mix old account IDs or silently switch the funding account.
- Constraints: TD-2, DATA-3, IAM-1, SEC-1. No silent central-account fallback; separate connection, shipping, sender, label, and webhook readiness. PR-17, PR-18, PR-19 apply.
- Evidence: Pending implementation verification.

### PR-9 — Actionable shipment queue and detail
- Status: Proposed
- Owner: Paduka Ongki
- Source: CTX-2, CTX-11.
- Statement: When an authorized operator opens shipments, the system shall provide scoped search/filter/pagination and a detail workspace with the next valid action for the current state.
- Acceptance: Given draft, queued, unknown, unpaid, issued, and failed shipments, When their detail is opened, Then state-appropriate guidance and actions are available and forbidden transitions cannot execute through direct requests.
- Constraints: UX-1, DATA-2, TEN-1, IAM-1. Filter/view state does not broaden access.
- Evidence: Pending implementation and browser verification.

### PR-10 — Govern tenant membership
- Status: Proposed
- Owner: Paduka Ongki
- Source: CTX-1, CTX-11.
- Statement: When a tenant administrator changes staff access, the system shall validate the permitted invitation, role, and deactivation action and preserve an administrable tenant.
- Acceptance: Given concurrent attempts to deactivate the final active administrators, When both are processed, Then at least one authorized administrator remains and duplicate submissions do not create duplicate membership side effects.
- Constraints: IAM-1, IAM-2, TEN-1. Supabase identity provisioning is distinct from application membership; PR-31 specifies proposed invitation acceptance; roles, outlet scope and expiry require owner confirmation.
- Evidence: Pending implementation verification.

### PR-11 — Preview CSV intake before draft creation
- Status: Proposed; later candidate
- Owner: Paduka Ongki
- Source: CTX-11.
- Statement: When a permitted user uploads a supported shipment CSV, the system shall show row-specific validation and destination ambiguity and create drafts only from explicitly selected valid preview rows.
- Acceptance: Given valid, invalid, ambiguous, expired, and tampered rows, When confirmed, Then only valid authorized rows create drafts exactly once; creating drafts does not issue provider orders.
- Constraints: TD-5, TEN-1, SEC-1. Existing row/byte/query limits are reference values, not silently accepted product limits.
- Evidence: Pending implementation verification; existing bulk test definitions were inspected, not executed.

### PR-12 — Update tracking from an authenticated provider source
- Status: Proposed
- Owner: Paduka Ongki
- Source: CTX-13.
- Statement: When a provider status is received or polled, the system shall resolve the account-owned order and update its tenant-owned shipment only through a valid, idempotent transition.
- Acceptance: Given a valid update plus duplicate, stale, forged, and different-account variants, When processed, Then only the authorized transition changes the mapped shipment; arrival order alone cannot regress delivery state.
- Constraints: TD-4, TEN-2, SEC-2, DATA-2. Provider access and sanitized capture must be verified before enabling ingestion.
- Evidence: Documentation only; no live webhook or tracking result was captured.

### PR-13 — Tenant identity and brand
- Status: Proposed
- Owner: Paduka Ongki
- Source: CTX-2.
- Statement: When a user operates in an authorized workspace, the system shall show the current tenant/outlet identity and its approved application branding without changing provider routing authority.
- Acceptance: Given two tenants, When workspace scope changes, Then the visible brand and scoped data change together; old-tenant requests/results do not appear in the new workspace and provider-generated labels retain authoritative routing information.
- Constraints: UI-1, TEN-1. Custom logos on official labels, custom domains, and a branded customer receipt require separate decisions.
- Evidence: Pending implementation and browser verification.

### PR-14 — Daily operational overview
- Status: Proposed; recommended after shipping pilot
- Owner: Paduka Ongki
- Source: CTX-11.
- Statement: When a permitted user opens the overview, the system shall distinguish work requiring action now from period-based shipment activity and show the data timestamp.
- Acceptance: Given a period crossing local midnight and a stale result, When overview and shipment filters are compared, Then they use the same selected timezone and event basis, show the same scoped count, and present a refresh path without claiming stale data is current.
- Constraints: UX-1, TD-6, TEN-1. Financial revenue, net margin, and COD-settlement metrics remain outside this contract until their policies are accepted.
- Evidence: Reference date/filter/freshness subset passed; GeraiExpress data/UI verification pending.

### PR-15 — Tenant lifecycle administration
- Status: Proposed
- Owner: Paduka Ongki
- Source: CTX-11, CTX-29, CTX-30.
- Statement: When a permitted Super Admin opens tenant administration, the system shall provide a scoped business directory/detail and readiness state; each configured review/lifecycle decision shall require current authority, a reason, guarded transition and audit with its enforced effect on new queued work.
- Acceptance: Given a suspended tenant with a queued provider operation, When that operation is claimed, Then it cannot issue a new order; tenant administrators cannot perform the platform action by calling its backend directly.
- Constraints: IAM-2, TEN-1, TEN-2, DATA-7. Initial activation requires an approved application/current policy outcome; lifecycle administration cannot bypass pending/rejected/withdrawn review. Later reactivation preserves valid initial approval. Suspension must not discard the authoritative outcome of an already-submitted operation or make necessary recovery impossible.
- Evidence: Pending implementation verification.

### PR-16 — Safe operational export
- Status: Proposed; later candidate
- Owner: Paduka Ongki
- Source: CTX-11.
- Statement: When a permitted user requests an operational export, the system shall apply the same scope and accepted filters as its corresponding list and encode cells safely for spreadsheets.
- Acceptance: Given tenant A filters and a formula-prefixed text value, When exported, Then tenant B rows are absent, the chosen event/date basis is preserved, and the value cannot execute as a spreadsheet formula.
- Constraints: TD-5, PRIV-1, TEN-1. Contact/PII export permissions and retention remain unresolved; no public download URL.
- Evidence: Pending implementation verification.

### PR-17 — Partner-created tenant seller onboarding
- Status: Proposed
- Owner: Paduka Ongki
- Source: CTX-16, CTX-17, CTX-9.
- Statement: When an authorized tenant administrator confirms new seller onboarding with required agreement and valid owner details, the system shall register the mapped tenant business using a backend-owned stable externalUserId and durably bind the returned seller and encrypted key.
- Acceptance: Given concurrent confirmations, timeout after creation, a 503 key-provisioning failure, or an exhausted daily quota, When onboarding resumes, Then the same external ID resolves one seller and truthful pending/recovery state; a null/disabled key never becomes ready. Saving a contact or adding staff does not register a seller.
- Constraints: PR-20, PR-30, TD-7, DATA-4, TEN-3, NFR-5; registration is separate from shipping/label readiness and must not act as a profile update.
- Evidence: All Partner sections reviewed; real onboarding and recovery untested.

### PR-18 — Connect an existing Mengantar account
- Status: Proposed
- Owner: Paduka Ongki
- Source: CTX-16, CTX-17.
- Statement: When an authorized tenant administrator chooses an existing account or registration returns EMAIL_ALREADY_REGISTERED, the system shall offer protected BYOK connection with validated account authority and independent capability checks.
- Acceptance: Given an existing-email refusal, When the user connects their own key, Then no account is recreated or claimed as partner-owned, the key is stored privately without readback, and other tenants cannot use it or invoke Partner retrieval/rotation for it.
- Constraints: DATA-3, DATA-4, TEN-3, IAM-3, SEC-3. A copied key alone does not prove tenant ownership; select and verify the binding policy before enablement.
- Evidence: Documented provider path; actual account-identity verification contract pending.

### PR-19 — Recover and rotate seller credentials safely
- Status: Proposed
- Owner: Paduka Ongki
- Source: CTX-17.
- Statement: When a permitted administrator recovers or rotates a managed seller key, the system shall coordinate against that seller, journal the operation, persist encrypted key/callback changes, and fence new dispatch until credential state is known.
- Acceptance: Given rotation during queued/in-flight work or a lost response, When recovery runs, Then no second order or blind second rotation occurs, current-key retrieval is bounded/audited, and webhook readiness remains blocked if its new callback secret is unknown; provider-disabled keys are not reactivated.
- Constraints: TD-8, DATA-4, IAM-3, SEC-3, TEN-2. BYOK rotation occurs in Mengantar followed by protected local replacement; Partner key retrieval does not return callbackSecret.
- Evidence: Vendor contract and failure analysis; runtime proof pending.

### PR-20 — Account-owner disclosure, agreement, and seller access
- Status: Proposed
- Owner: Paduka Ongki
- Source: CTX-17.
- Statement: Before new seller creation, the system shall explain the account and COD ownership relationship, capture affirmative agreement to the applicable Mengantar Terms and Privacy documents, and show the registered owner how to access Mengantar through Lupa Password.
- Acceptance: Given absent agreement, an email that fails the selected owner-confirmation/verification policy or is a known placeholder, or unavailable provider-policy documents, When registration is attempted, Then no seller is created; accepted onboarding records actor, tenant, owner, document versions, and time without requesting a Mengantar password or promising unverified payouts.
- Constraints: PRIV-2, DATA-4, UX-2; exact provider policy URLs/versions and retention must be selected before enablement.
- Evidence: Provider onboarding obligations reviewed; no legal-compliance conclusion or real consent captured.

### PR-21 — Demo login in the initial delivery
- Status: Proposed
- Owner: Paduka Ongki
- Source: CTX-21.
- Statement: When the first usable application preview is delivered, the system shall provide a ready-to-use demo account and a discoverable login entry with a seeded demo tenant, outlet, sender/recipient contacts, and example shipments.
- Acceptance: Given the documented demo access, When a reviewer logs in without creating a real business account, Then they can explore the queue, reuse example contacts, and complete a simulated draft → estimate → confirmation → sample-label flow; demo requests cannot access real tenant data, register a Mengantar seller, invoke live shipping/payment, change provider credentials, or invite staff.
- Constraints: IAM-4, UX-3, TEN-1, NFR-4. Demo prices/statuses and sample labels must be visibly identified as examples; demo activity is excluded from real operational metrics. Supply working access instructions with the preview, without putting actual passwords or provider keys in this specification.
- Evidence: User request recorded; no demo identity, credentials, seed or application login exists yet.

### PR-22 — Authoritative prices and private cost separation
- Status: Proposed
- Owner: Paduka Ongki
- Source: CTX-24, CTX-25, CTX-26, CTX-27, CTX-28.
- Statement: When a supported service is reviewed or confirmed, the system shall use the verified normal Mengantar tariff before seller discount for the customer/resi, retain the separately verified discounted seller cost, include applicable COD fee/insurance once according to the actual contract, and preserve role-projected confirmed price facts.
- Acceptance: Given the same normal tariff with two authorized seller discounts, When quoted/confirmed/reprinted, Then customer normal shipping remains the same while private net cost reflects each verified assignment; COD Ongkir also uses the normal basis. Fee-inclusive/exclusive and optional/required insurance cases count each applicable charge once; stale/tampered/missing-authority cases preserve the draft or reconcile the original submitted order, and operator payloads/label output do not expose private net cost/discount.
- Constraints: TD-9, DATA-5, IAM-5, UX-5, PR-4, PR-5, PR-7, NFR-3. Historical 333-bps/VAT/discount assumptions, free app access and new gerai markup are not accepted current policy; CTX-28 selects normal-versus-net policy; actual fee/discount/insurance activation and customer-goods obligations require proof. Provider PDF financial privacy needs separate content verification under PR-6.
- Evidence: Reference pricing study and bounded local checks only; no GeraiExpress price implementation or current-account contract test.

### PR-23 — Assigned seller discounts and verified upstream cost
- Status: Proposed
- Owner: Paduka Ongki
- Source: CTX-27, CTX-28.
- Statement: When an authorized platform pricing administrator assigns negotiated discount terms to a tenant seller, the system shall version/audit their scope and effective period, keep customer normal tariff unchanged, and mark them applied only when the provider-approved activation and account-specific net pricing are verified.
- Acceptance: Given pending, active, expired, changed and mismatched assignments, When a quote/confirmation runs, Then the system uses the applicable verified version or shows a hold/revalidation state; editing a local discount cannot falsely alter a Mengantar bill, overwrite historical prices, grant cross-tenant access or allow an operator to set its own terms.
- Constraints: PR-22, TD-9, DATA-5, IAM-6, TEN-1. The four reviewed Partner routes do not manage discount rates; agreement scope, activation method and fee/insurance eligibility need provider verification. No arbitrary local subsidy or commission is created.
- Evidence: Selected product direction; no discount assignment UI/schema, provider change or live billing proof exists.

### PR-24 — Restricted Super Admin access and governance
- Status: Proposed
- Owner: Paduka Ongki
- Source: CTX-29, CTX-30.
- Statement: When a user enters a platform workspace or invokes its command, the system shall require an active server-owned platform grant, the relevant capability and verified second-factor session, with governed platform-role provisioning/revocation.
- Acceptance: Given anonymous, tenant, demo, self-promoted metadata, revoked-platform and incomplete-factor sessions, When platform routes or direct Data API/RPC commands are invoked, Then protected access is denied; a permitted current principal succeeds, and concurrent final-admin removal cannot leave the platform unadministrable.
- Constraints: IAM-7, TEN-4, SEC-4, NFR-1. Bootstrap/recovery identity and grant policy need owner selection; no public Super Admin signup or shared production demo role.
- Evidence: Reference access pattern and current Supabase MFA documentation; no GeraiExpress auth/grant exists.

### PR-25 — Actionable platform health and usage
- Status: Proposed
- Owner: Paduka Ongki
- Source: CTX-29, CTX-30.
- Statement: When an authorized Super Admin opens platform monitoring, the system shall show correctly scoped current exceptions, period-based usage and provider readiness with explicit definitions, time basis and freshness.
- Acceptance: Given two tenants, a WIB period boundary, pending/unknown/unpaid/label failures and stale/partial data, When filters and detail are opened, Then the displayed counts share their named basis, all affected scopes remain visible and no stale/failed response is presented as a healthy zero or private customer payload.
- Constraints: TD-10, DATA-6, TEN-4, UX-6, UI-4. Thresholds/SLAs and financial metrics are not inherited or invented.
- Evidence: Reference monitoring source reviewed; target query/browser checks pending.

### PR-26 — Safe platform integration and seller readiness
- Status: Proposed
- Owner: Paduka Ongki
- Source: CTX-17, CTX-18, CTX-29, CTX-30.
- Statement: When a permitted Super Admin inspects integrations or a tenant seller, the system shall distinguish application lifecycle, connection mode, durable onboarding, provider restriction, current capabilities and platform configuration readiness without exposing secret values.
- Acceptance: Given managed/BYOK, partial registration, disabled key, missing label/insurance/webhook permission, quota wait or egress failure, When reviewed, Then the correct safe status and scoped next action appears without creating another seller, granting a nonexistent capability or claiming a local setting changed Mengantar billing/access.
- Constraints: PR-17 through PR-20, PR-23, TD-7, TD-8, ARCH-2, IAM-7, TEN-4. Credential actions require their separate existing permission/confirmation; no arbitrary API console.
- Evidence: Current vendor and reference boundaries; no live account/configuration action executed.

### PR-27 — Controlled operational reconciliation
- Status: Proposed
- Owner: Paduka Ongki
- Source: CTX-29, CTX-30.
- Statement: When an authorized Super Admin investigates an operational exception, the system shall expose its safe durable timeline and permit only eligible scoped reconciliation or resumption of the original recorded operation.
- Acceptance: Given duplicate recovery, stale authority, suspended tenant, unknown provider outcome and an already-paid/issued order, When recovery is requested, Then one guarded recovery records a truthful result or reasoned denial; it cannot issue/pay again, switch funding accounts, overwrite confirmed prices or discard an in-flight outcome.
- Constraints: TD-3, TD-8, TD-10, TEN-2, TEN-4, IAM-7. Viewing an exception grants no new spending/withdrawal or tenant impersonation authority.
- Evidence: Recovery patterns inspected; target failure-injection checks pending.

### PR-28 — Platform audit and decision history
- Status: Proposed
- Owner: Paduka Ongki
- Source: CTX-29, CTX-30.
- Statement: When a platform decision or sensitive investigation/recovery occurs, the system shall record an append-only, access-controlled event with actor, target scope, action, reason/outcome, relevant versions and correlation, and expose filtered history to authorized Super Admins.
- Acceptance: Tenant/review/discount/access/recovery decisions appear once with their actual outcome; event modification/deletion and unauthorized direct reads are denied, and canary credentials/customer payloads never enter the audit output. A pending external effect is not labelled completed merely because a request was accepted.
- Constraints: DATA-6, IAM-7, TEN-4, SEC-4, PRIV-1. Audit retention/export and support PII-access policy remain owner decisions.
- Evidence: Reference audit pattern; GeraiExpress audit storage/browser proof pending.

### PR-29 — Verified application registration
- Status: Proposed
- Owner: Paduka Ongki
- Source: CTX-31, CTX-33, CTX-34.
- Statement: When a person registers, the system shall verify inbox control through native Supabase Auth before granting application setup authority, distinguish new and returning identities, and keep credentials, application agreement and provider agreement separate.
- Acceptance: Given a new, existing, unverified, mistyped or attacker-submitted email, When registration or verification is attempted, Then generic public feedback preserves account privacy, invalid/expired codes grant nothing, and only the verified person can complete their own account without inheriting an attacker-chosen password or role.
- Constraints: IAM-8, SEC-5, PRIV-3, UX-7, PR-33. Email-first UX is recommended, not a selected human decision.
- Evidence: Official native features and source patterns reviewed; no Auth runtime check executed.
- Change history: 2026-10-13 — Added in the registration and documentation-completeness review.

### PR-30 — Resumable gerai application and activation
- Status: Proposed
- Owner: Paduka Ongki
- Source: CTX-31, CTX-32, CTX-34.
- Statement: When a verified applicant submits a gerai application, the system shall create or resume its tenant, initial outlet and administrator binding once, expose the current review/setup state, and apply the selected activation policy before seller connection or operational effects.
- Acceptance: Given duplicate submission, interrupted persistence, an existing application, requested corrections or concurrent review, When resumed, Then one versioned result and membership are preserved, stale decisions conflict safely, pending/rejected applicants see only their allowed status, and no Mengantar account or order is created by approval.
- Constraints: PR-15, PR-17, TD-11, DATA-7, TEN-5, IAM-8, UX-7. Manual review and additional-business rules remain proposed.
- Evidence: Registration source traced; target transaction, concurrency and policy tests pending.
- Change history: 2026-10-13 — Added in the registration and documentation-completeness review.

### PR-31 — Explicit staff invitation acceptance
- Status: Proposed
- Owner: Paduka Ongki
- Source: CTX-31, CTX-34; PR-10.
- Statement: When an authorized administrator invites staff, the system shall keep a pending tenant/role/outlet-scoped invitation until the intended verified identity explicitly accepts a current invitation, independently of Auth user creation or email delivery.
- Acceptance: Given a new or existing user, wrong email, expired/revoked invite, changed issuer authority or concurrent acceptance, When the invitation is used, Then only the intended active scope is granted once, rejected attempts disclose no foreign business data, and no extra tenant or seller is provisioned.
- Constraints: IAM-2, IAM-8, DATA-7, TEN-5, SEC-5, UX-8. Invite roles/outlets and lifetime require acceptance before implementation.
- Evidence: Interaction and authorization contract only; no invitation issued.
- Change history: 2026-10-13 — Added in the registration and documentation-completeness review.

### PR-32 — Account recovery and correct post-login destination
- Status: Proposed
- Owner: Paduka Ongki
- Source: CTX-31, CTX-33, CTX-34.
- Statement: When authentication completes or a user recovers access, the system shall route from current verified identity, own onboarding and memberships to the next permitted action, preserving tenant/provider history and keeping GeraiExpress password recovery separate from Mengantar access.
- Acceptance: Given no membership, multiple memberships, pending review, suspension, a different logged-in account or password recovery, When the user continues, Then the correct scoped chooser/status/workspace is shown, session expiry can resume safely, and no verification, email change or password reset creates platform authority or changes seller ownership.
- Constraints: IAM-8, TEN-5, SEC-5, UX-8, PR-20, PR-24. Owner transfer/factor recovery requires its separate accepted policy.
- Evidence: Native recovery documentation reviewed; no browser/session scenario executed.
- Change history: 2026-10-13 — Added in the registration and documentation-completeness review.

### PR-33 — Reliable in-stack authentication email
- Status: Proposed
- Owner: Engineering owner
- Source: CTX-35; SRC-SUPABASE-AUTH-SMTP, SRC-CF-EMAIL-SMTP in `sources.json`.
- Statement: Before public real-account registration, the system shall have a verified Cloudflare + Supabase authentication-mail path, safe resend/verification controls and truthful delivery failure recovery without treating sending acceptance as inbox verification.
- Acceptance: Given configured test and release environments, When signup code, recovery and supported account-change messages are exercised, Then controlled inboxes receive the expected messages, wrong/expired credentials remain denied, suppression/outage/quotas have safe recovery, and mail/Auth secrets never appear in browser, logs or saved specification.
- Constraints: ARCH-3, SEC-5, PRIV-3, UX-7, UX-8. Native custom SMTP is the candidate; actual account eligibility and delivery remain gates.
- Evidence: Separate vendor features documented; combined service unprovisioned and untested.
- Change history: 2026-10-13 — Added in the registration and documentation-completeness review.


## Non-functional acceptance proposals

### NFR-1 — Isolation proof
- Status: Proposed
- Owner: Engineering owner
- Source: CTX-1, CTX-11.
- Statement: Every implemented tenant-owned read/write/search/export/label/job path shall have a same-tenant success and cross-tenant denial check, including direct Supabase Data API and RPC access.
- Acceptance: An isolated two-tenant suite passes with authenticated, anonymous, suspended, revoked, and different-account cases; guessed IDs cannot disclose protected records.
- Constraints: TEN-1, TEN-2, IAM-1, SEC-1.
- Evidence: Pending GeraiExpress database and request checks.

### NFR-2 — Duplicate and interrupted operation recovery
- Status: Proposed
- Owner: Engineering owner
- Source: CTX-11, CTX-13.
- Statement: Replayed commands and interrupted provider operations shall not cause a second order or silently lose a known provider outcome.
- Acceptance: Concurrent submit, duplicate delivery, process restart, and timeout-after-provider-acceptance scenarios preserve one logical attempt and enter explicit reconciliation when outcome cannot be proved.
- Constraints: TD-3, DATA-2.
- Evidence: Pending failure-injection checks on the selected runtime.

### NFR-3 — Private operational payloads
- Status: Proposed
- Owner: Engineering owner
- Source: CTX-3, CTX-11.
- Statement: Operational output shall contain no provider credential/path, auth secret, or unnecessary contact detail, and protected responses shall not be publicly cached.
- Acceptance: Canary credentials are absent from logs, errors, traces, browser bundles, and anonymous access; phone/customer values are absent from unauthorized or policy-suppressed payloads while the selected authorized operational display/detail/print policy still works.
- Constraints: SEC-1, PRIV-1, TEN-2.
- Evidence: Pending runtime checks.

### NFR-4 — Operator browser proof
- Status: Proposed
- Owner: Engineering owner
- Source: CTX-11.
- Statement: Each delivered primary workflow shall be keyboard-operable with labelled inputs, visible validation/pending/recovery states, and a usable layout at 390px, 768px, and 1280px.
- Acceptance: Browser journeys pass at those viewports without document overflow greater than 1px or inaccessible primary actions; wide tables may scroll in a labelled local region.
- Constraints: UX-1, UI-1.
- Evidence: Pending GeraiExpress browser evidence; old static-render tests are not browser proof.

### NFR-5 — Partner network, quota, and protocol readiness
- Status: Proposed
- Owner: Engineering owner
- Source: CTX-17, CTX-18.
- Statement: Partner calls shall use exact-byte endpoint-bound signatures, durable partner-wide scheduling, and an approved production egress path, with isolated seller shipping quotas and redacted telemetry.
- Acceptance: Offline signature vectors and tampering negatives pass; concurrent instances honor provider Retry-After/request limits and WIB daily reset; production primary/failover addresses are accepted by Mengantar and an unavailable approved route cannot fall back to ordinary egress.
- Constraints: ARCH-2, TD-7, SEC-3; initial limits 60 requests/minute and 1,000 new sellers/day are configurable provider entitlements, not a product sales guarantee.
- Evidence: Protocol and documentation checked; production network/quotas untested.

## Operational state boundaries

Drafts are editable. An estimate is not a submitted order. A queued or unknown
submission does not authorize another create-order request. An unpaid provider
order is an existing order without an issued AWB. Label generation has its own
pending, processing, completed, and failed state, separate from delivery status.
A browser print dialog does not prove that a physical label was printed.

## Access and data guardrails

- Every tenant-owned record and operation must have validated tenant scope, including contacts, addresses, sender mappings, shipment snapshots, provider job references, search, exports, and print history.
- Supabase user-context queries must enforce current membership through RLS. Routine tenant operations must not run as a secret/service role that bypasses RLS.
- Mengantar credentials and credential-bearing URL paths stay on the trusted backend and out of browser bundles, logs, traces, and errors.
- Shared provider accounts do not authorize cross-tenant access to provider-wide sender search, orders, labels, or wallet details.
- Sender and recipient names, phones, addresses, and label documents are private operational data; do not place them in analytics events or public storage by default.
- No remote provisioning, customer-data migration, or provider write is implied by drafting this specification.

## Recommended pilot baseline and capability gates

This table makes pending policy choices concrete for review; it does not convert
recommendations into owner decisions. CTX-28 pricing and CTX-19 visual direction
remain selected. The detailed open-question register below retains accountability.

| Area | Recommended baseline | If evidence/selection is missing |
|---|---|---|
| Ownership | One business tenant with its own actual seller, multiple verified outlets, explicit BYOK for an existing seller; CTX-9 | Seller provisioning/account schema remains gated; contacts and simulated demo can be specified independently |
| Registration | Email-first native verification and manual pilot business review; CTX-34/DATA-7 | No automatic activation by assumption; application transitions remain the reviewable proposal |
| Member access | IAM-1 role matrix, current explicit tenant/outlet assignments and governed invitations | No user-selected roles or implicit access to a new outlet |
| Money | Normal retail/customer price and verified net seller cost; BILL-1/BILL-2 | Unknown fee, payer or activation blocks affected dispatch, never becomes zero or local discount fiction |
| Custom resi | Customer sender identity with real pickup preserved; normal tariff and approved gerai branding on supported provider output | No claim of arbitrary sender address/logo/price override; affected label capability stays unproved |
| Delivery | Working isolated demo → sandbox evidence → bounded authorized pilot; DEL-1 | A simulated preview cannot be presented as working live integration |
| Operations | Named responders, explicit limit configuration and restore drill under OBS-1/RATE-1/DR-1 | No production readiness claim without signal delivery and safe recovery proof |

## Risks and open questions

| Question | Owner | Due gate |
|---|---|---|
| CTX-9: confirm account owner for one seller per tenant business, multiple-outlet mapping, and BYOK owner-verification policy | Paduka Ongki | Before seller/account schema and provisioning |
| Partner agreement, production origin, Terms/Privacy URLs/versions, IP allowlist and entitlement to dedicated egress | Integration owner | Before real onboarding; production networking before live enablement |
| Next.js Workers adapter/version compatibility and beta risk acceptance | Engineering owner | Before runtime selection/scaffolding; ARCH-1 |
| Callback-secret recovery procedure after a lost rotation response | Integration owner | Before enabling managed rotation/webhooks |
| Does one tenant own multiple outlets; which user roles may manage contacts, issue, reprint, and configure the provider? | Paduka Ongki | Before tenant/IAM schema implementation |
| Select CTX-34 email-first signup and manual review versus automatic tenant activation; initial Super Admin bootstrap/recovery owner and capability grants | Paduka Ongki | Before platform onboarding/auth implementation |
| Select invite lifetime/roles/outlet scope, additional-business rules, rejection/resubmission and ownership transfer policy | Paduka Ongki | Before registration/invitation implementation; PR-30/PR-31 |
| Confirm sender domain, Cloudflare Email Sending entitlement/beta acceptance, Supabase SMTP implicit-TLS compatibility and controlled-inbox delivery | Engineering owner | Before public real-account registration; ARCH-3 |
| Select application Terms/Privacy documents, notice versions and uncompleted registration/invitation retention | Paduka Ongki | Before accepting real signup data; PRIV-3 |
| Which support investigations may expose customer data or authorize money/credential actions beyond the default platform projection? | Paduka Ongki | Before support access or exceptional recovery |
| Which exact tenant branding must appear in the app, official label, or customer receipt? | Paduka Ongki | Before label/receipt design |
| Which intended accounts have Dropshipper enabled, sandbox access, and labelGeneration permission? | Integration owner | Before account-specific integration verification |
| Confirm receipt/cashier, COD enablement, deposits, settlement/refunds and finance scope; normal customer tariff versus discounted seller cost is selected in CTX-28 | Paduka Ongki | Before monetary workflows |
| COD Ongkir uses normal retail shipping under CTX-28; define the actual collection/fee/insurance rule and who receives/pays customer goods proceeds under Full COD | Paduka Ongki | Before enabling that collection mode |
| Provider-approved discount assignment/activation, tenant/service eligibility, effective dates and actual net billing match | Integration owner | Before marking an assigned discount active |
| Confirm internal cost/discount/payout visibility and whether the provider PDF meets the selected customer-document policy | Paduka Ongki | Before pricing DTO/document acceptance |
| Current per-account/service fee base/inclusion, minimums, rounding, insurance and actual-deduction semantics | Integration owner | Before real charge calculation |
| GeraiExpress free versus paid/commission model; no rate inherited from LegacyReference or assumed from Partner API | Paduka Ongki | Before commercial offers |
| What are contact retention, archive/delete, export, and support-access policies? | Paduka Ongki | Before personal-data lifecycle implementation |
| Which cloud accounts, region, domains, expected counter volume, staffing/concurrency, printers and label media apply? | Paduka Ongki | Before infrastructure provisioning, hardware acceptance or performance commitments |
| Select pilot outlet, baseline/target and observation period for counter workflow evaluation | Paduka Ongki | Before business-improvement claims |
| Name operational responders; select signal/audit retention, alert/retry budgets and recovery-point/time targets with actual backup entitlements | Paduka Ongki + Engineering owner | Before production pilot; DEL-1, DR-1, OBS-1, RATE-1 |
| CTX-10: recheck current reachability and official status of the hostnames in the dated ISP DNS record | Paduka Ongki | Before treating migration as a remedy |

## Contradictions resolved by this review

| Previous ambiguity or reference mismatch | Resolution in this draft | Remaining evidence |
|---|---|---|
| The first checkout was assumed to represent every LegacyReference worktree | CTX-14 selects the clean advanced checkout as the preferred adaptation candidate and bounds old findings to their source | Pinned checkout/digests and target-runtime checks |
| Provider create DTO looks like a proven live integration | TD-2 prefers the advanced nested builder/live HTTP adapter over the old flat fixture DTO, but adds provider customer identity and requires current evidence | Sanitized sandbox creation and account binding |
| A webhook is either absent or automatically live because its route exists | TD-4 distinguishes the old 404-only route from the advanced signed but gated handler and its documented gaps | Account-specific signed capture and replay/tenant tests |
| Existing HTML label implies courier-approved branding | PR-6 uses supported provider PDF; local branded receipt is a separate unselected option | Label permission, courier scan/routing proof, logo capability |
| Reusing the old tenant wrapper preserves RLS automatically | TEN-1 specifies Supabase-auth identity and direct Data API/RPC denial | New RLS and grant tests |
| One account dispatcher or queue implies exactly-once ordering | TD-3 requires durable in-flight state, idempotency, reconciliation, and account grouping | Concurrent tenants, restart, replay, and unknown-outcome tests |
| Old dashboard implementations define correct metrics | TD-6 uses definitions as candidates and explicitly avoids importing the reference's documented drift | Query/list/export parity and accepted business definitions |
| Saving a sender or changing local label masking changes Mengantar identity | PR-2 is local persistence; PR-3 requires a separate authorized provider-master mapping and submission; advanced local masking omits provider dropshipper | Provider-account-scoped mapping and returned label test |
| All contacts must inherit the old list-masking behavior | The advanced reference allows complete phones inside authorized operations; GeraiExpress display permissions remain an explicit policy decision | Authorized display and unauthorized/direct-payload denial checks |
| Reference labels, retention, COD fees, and free-plan decisions carry over | Those policies remain owner-held decisions | Explicit scope and policy selection |
| Partner API replaces shipping or makes every customer a seller | PR-17 binds the tenant business; Public API still issues shipments and contacts remain separate | Account-owner/cardinality and real sandbox contract |
| A returned key makes every capability ready | PR-8 separates connection, order, dropshipper, PDF and webhook readiness | Per-account capability and label proof |
| Get key is harmless and rotation can be blindly retried | PR-19 records provisioning/rotation effects and lost callback-secret recovery | Failure-injection and provider recovery procedure |
| Cloudflare hosting automatically meets provider IP allowlisting | NFR-5 and ARCH-2 require dedicated approved egress including failover | Entitlement and actual production-path proof |
| App registration, tenant approval and seller creation were collapsed into one first-use step | PR-29 through PR-33 and UX-7/UX-8 separate verified identity, versioned application/activation, staff invitation and explicit provider connection | Auth/transaction/browser/mail proof and owner policy selection |
| A confirmation click or sent email automatically grants tenant access | Native email verification establishes identity only; TEN-5 and IAM-8 still require the current scoped application/membership | Direct API/RPC denial and identity/recovery tests |
| Apple styling implies sparse shipping tables or absent error states | UI-1 through UI-3 retain form/table usability and accessibility | Rendered browser and token-contrast evidence |

## Verification and next handoff

Reference inspection, a bounded reference pure-logic test subset, and document
checks have executed. No GeraiExpress application build, database policy test,
authenticated provider request, label print, or deployment result exists.
The related draft contracts record reusable behavior and target-runtime gaps.
Resolve the affected decisions and accept requirements before creating the one
root execution queue with runnable positive and cross-tenant negative checks.
User authorization to create the project is recorded in CTX-1; unresolved
business decisions must not be replaced with assumed answers.

Additional advanced-source candidates are readable local shipment/contact
references, quick tariff checking, gerai logo/profile, customer invoice snapshots,
batch print, scanned handover, and state-valid cancellation. TD-1 owns their
source/disposition; they do not become promised features or money/label policies
merely because their source exists.
