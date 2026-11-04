# GeraiExpress — Product Draft


> Current hosting amendment (DEC-022, owner, 2026-10-29): Vultr + Coolify runs the Node application and PostgreSQL 17 + PostgREST. `compose.coolify.yaml` is the Coolify entrypoint; public TLS belongs to Coolify, with the internal Caddy gateway on 8080. Same-host PostgreSQL is the initial target; off-host recovery and real production verification remain release gates. This supersedes DEC-020 wording that excluded Vultr/Coolify; Workers and Supabase remain retired from the local runtime.

- Status: Reconciled implementation evidence from 2026-10-28, with runtime and data/auth status amended 2026-10-29 for Decisions DEC-020 and DEC-021 (ADR-0002, owner). Observed: the local product foundation and sandbox issuance remain; merged self-hosted Node-container code (T-062) and the plain PostgreSQL 17 + PostgREST + application-owned auth cutover (T-064..T-066) replace Cloudflare Workers and Supabase in the working tree, while the T-067 independent security review, PostgreSQL backup/PITR gates and production gates remain open.
- Owner: Paduka Ongki
- Updated: 2026-11-02
- Context: `CONTEXT-RECORD.md` is the current decision and evidence owner (CTX-39 to CTX-44 and DEC-011 to DEC-023 were added from 2026-10-28 to 2026-11-02). Authority order when sources disagree: repository disk and executed checks, then `ARCHITECTURE.md` (what is built), then `DECISIONS.md` and `CONTEXT-RECORD.md`, then older prose in this file.
- Execution: `TASKS.md` is the sole work queue; this document does not mark any task complete.
- Review basis: Original and advanced LegacyReference worktree scans, bounded local tests, and current vendor documentation (CTX-11 through CTX-15); the 2026-10-28 full review (`docs/review/2026-10-28-full-review.md`) with its traceability appendix, and the 2026-10-28 legacy-project comparison (`docs/review/2026-10-28-legacy-project-comparison.md`).
- Hosting and data/auth status: Decisions DEC-020 and DEC-021 (ADR-0002, owner) supersede the older Cloudflare Workers/OpenNext, Vultr/Coolify and Supabase/GoTrue/Send Email Hook descriptions in this PRD, not the product requirements. Observed merged implementation: `Dockerfile`, `compose.yaml`, `compose.db.yaml`, `infra/`, `db/foundation/`, `db/migrations/`, `src/lib/db/**`, `src/lib/auth/**`, `src/proxy.ts`, `src/lib/config.ts`, `client-address.ts`, `limiter.ts` and `cron.ts`; current runtime and data/auth mechanics belong to ARCH-1, ARCH-3, ARCH-5, SEC-5, SEC-6 and DEL-2. Plain PostgreSQL 17 + PostgREST + application-owned auth replace Supabase; Cloudflare Turnstile stays as the CAPTCHA. The Send Email Hook is removed and the app renders/sends code mail directly (`src/lib/auth-mail.ts`, `src/lib/mail-transport.ts`: Mailpit locally; production transport is Proposal, unbuilt, T-063). Old Worker and Supabase checks and preview references are historical, not current container/PostgreSQL or production evidence.

## Product and outcome

GeraiExpress lets a shipping outlet serve multiple customer senders, compare
Mengantar courier services, issue shipments, and print the corresponding labels.
Different outlet businesses work in isolated tenants with their own brand and
users. Reusable sender and recipient contacts reduce repeated entry.

LegacyReference is the reference for product workflows; GeraiExpress stays the
foundation and the legacy product is not converted (DEC-014). Self-hosted Node.js
containers (DEC-020, T-062) with plain PostgreSQL 17 behind PostgREST and an
application-owned auth module (DEC-021, ADR-0002, T-064..T-066) are the accepted
infrastructure (superseding the initial Cloudflare + Supabase stack of DEC-001 and the
withdrawn Vultr/Coolify hybrid gateway of DEC-011; Cloudflare Turnstile remains the CAPTCHA).

## Product direction and intended users

Direction: a branded, multi-tenant shipping-counter workspace where an outlet
can serve many customer senders through Mengantar. The primary job is to accept
correct shipment details, choose a valid service, obtain an authoritative resi,
print its label, and retain enough context to answer the customer's next visit.
Sources: CTX-1 through CTX-3, CTX-22 and CTX-39; the operating frame CTX-23 remains a proposal except where CTX-39 decides.

A tenant is the business boundary. Its users work in permitted outlets under
that business's identity. Decision (DEC-006): one tenant business owns exactly
one Mengantar seller, either created under GeraiExpress's Partner account or an
existing seller whose key the verified owner proves they control, with verified
outlet pickup mappings; several outlets map to that seller. Customer contacts and
staff memberships remain separate from that seller's ownership. Roles follow
IAM-1 as resolved in DEC-008.

| Actor | Job and trigger | Successful outcome | Evidence / uncertainty |
|---|---|---|---|
| Counter operator | A customer brings shipment details or returns to ask about an existing resi | Find/reuse contacts, compare services, confirm a shipment, print or recover the existing order | User-requested job and reference workflows; staffing, throughput and time pressure not measured |
| Gerai owner / tenant administrator | Set up the business, provider access, pickup and staff; resolve escalated failures | A usable authorized outlet with clear capability/readiness and controlled staff access | Role matrix resolved in DEC-008 (tenant-wide memberships in the pilot); the owner runs the first pilot gerai (CTX-39) |
| Customer sender / recipient | Supply party details or request shipment information through the counter | Correct identity/destination and a traceable shipment within the gerai's permitted workflow | User-requested contacts; no customer login or self-service portal requirement established |
| Super Admin / platform administrator | Govern tenants, assigned discounts, provider readiness, monitoring and exceptions | Explicitly authorized platform decisions, safe recovery and audit | PR-15, PR-23 through PR-28, PR-36; served only from the owner host (DEC-015); no automatic tenant impersonation or customer-directory access |
| Initial reviewer | Try the first preview without creating a real seller account | Demo login and a complete simulated counter flow | Explicit user request in CTX-21; PR-21 |

The initial operating context is Indonesian domestic shipping through Mengantar,
with a Bahasa Indonesia UI (repository rule in AGENTS.md), proposed `id-ID` money formatting and explicit WIB
period labels. Desktop counter use with a printer is a proposed primary setup;
phone/tablet access must satisfy NFR-4. Actual printer models, label formats,
scanner/scale integrations, connection quality and browser support must be
validated in the pilot. Country, hardware and scale assumptions do not create
new provider capabilities or legal claims.

## Market and users

This section records only what the owner decided, what is assumed and what is
unknown. It states no market-size, competitor, demand or regulatory fact; each
of those needs a cited source. Evidence lives in two research notes that the owner
reviews before any claim here changes: the
[market and regulatory research](../research/geraiexpress-market-and-regulatory-research.md)
(2026-10-28: segments, competitor offers, Mengantar discount mechanics, masking,
UU PDP, PSE, pickup reality) and the
[Indonesia market gap analysis](../research/geraiexpress-indonesia-market-gap-analysis.md)
(2026-11-02: competitor feature matrix, counter jobs versus the build,
Permenkomdigi 8/2025 and 15/2025 duties, unit economics and PR-38 to PR-46; version 2
integrates five research lanes kept under `docs/research/evidence/2026-11-02/`).

| Label | Statement | Source |
|---|---|---|
| Decision | The first target is the offline gerai or physical expedition counter. The product is one dashboard through which a gerai offers every supported courier, replacing a conventional single-courier counter | CTX-39 |
| Decision | GeraiExpress owns the Mengantar Partner account and registers one seller per tenant; the sender pays the full normal tariff, the gerai receives a Super Admin-assigned discount, and no platform fee is collected in the first release | CTX-39, DEC-006, DEC-012, DEC-016 |
| Decision | Pickup with provider time reservation and a locally printed masked resi are the priority differentiators ahead of reporting or finance extras | CTX-39, DEC-017 |
| Decision | The owner runs the first pilot gerai | CTX-39 |
| Assumption | About 50 tenants is a planning figure, not a commitment; the Partner limits of 1,000 registrations per day and 60 requests per minute shared are assumed not to constrain that scale | CTX-39 |
| Unknown | Demand, willingness to pay, how many gerai would switch from a conventional counter, counter throughput, staffing and competitor positioning: no customer interview, survey or measurement exists | Statement under "Problem, goals and evaluation" |
| Unknown | Who the pilot gerai is (entity, location, go-live date), its shipment volume and the commercial timing | CTX-39 (confidence Low for volume, timing and commercial terms) |
| Unknown | Number of independent multi-courier gerai, parcels per gerai per day and counter margins: no official source exists; national e-commerce growth (e-Conomy SEA 2025, projected US$71 billion GMV) is a tailwind, not segment demand | Gap analysis section 3.1 |
| Observed | Of 14 aggregator or seller tools and 10 courier programs reviewed, about 12 aggregator-style and 8 courier programs recruit counters, mostly free to join, with headline earnings of 20% to 40% (Lion and SAPX courier programs 20% to 35%; some programs lower, e.g. KirimAja SubConsole 10%); multi-courier booking, pickup, COD and in-app tracking are table stakes; counter receipt, branded label and multi-branch dashboards are rare, and customer WhatsApp notification is rare among counter programs though common in seller aggregators; cash or shift close, per-cashier receipts and explicit duplicate-resi protection were not seen on the public surfaces read; no counter vendor advertises sender masking | Gap analysis section 3.2 (vendor self-description only) |
| Observed | In 177 negative Play reviews across 11 agent and seller-aggregator apps (reviewers mostly online sellers, not counter-specific), the leading complaints are balance and payout access (37), slow support (31), app errors (31), KYC friction (30), COD, return and claim problems (24) and scam WhatsApp messages to COD recipients (12); commission cuts were never mentioned (keyword coding, directional only) | Gap analysis section 3.3 |
| Observed | Outside Jawa-Bali most courier orders are placed offline (BPS VPEK-2024, firm-level averages for medium and large firms); QRIS reached 44.86 million merchants, 96.68% UMKM, by June 2026 and carries 0% MDR up to Rp100,000 from 1 October 2026 (BI text retrieved indirectly; one BI value contradiction recorded) | Gap analysis section 3.1 |
| Observed | Permenkomdigi 8/2025 places insurance-information, prohibited-goods, return (with the cost charged to the sender, Art 20), compensation (up to 10x the shipping fee), four-month shipping-data and resi-QR duties on licensed postal operators, with agents liable to the operator (Art 75); Art 77 requires the resi QR to carry sender and recipient names and addresses; Permenkomdigi 15/2025 defines KBLI 53202 courier agents (scale, computer and printer, written agreement with a postal operator); whether a gerai on a Mengantar seller account is such an agent is Unknown (counsel) | Gap analysis section 6 |
| Inference | Under DEC-016 and Mengantar's documented 20% default the platform earns nothing per shipment and cannot match the 25% that several competitors advertise; a revenue model is an open owner decision | Gap analysis section 5 |
| Unknown | Whether couriers, Mengantar and recipients accept a locally printed masked label | PR-34; pilot scan |

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
| Complete the primary counter job | PR-2 through PR-9, PR-34 | Demo walkthrough, then an authorized sandbox pilot: contact → draft → quote → confirmation → provider AWB → local masked label |
| Preserve the right sender and pickup identity | PR-3, PR-7, PR-34 | The printed label shows the sender identity chosen by the masking switch and carries the AWB barcode; the real pickup stays on the shipment detail; contact edits do not alter historical output |
| Keep businesses and staff authority scoped | PR-1, PR-10, PR-13; NFR-1 | Same-tenant permitted actions pass and foreign/revoked/direct-API actions fail |
| Make interruptions recoverable | PR-5, PR-6, PR-12; NFR-2 | Double confirmation, timeout, unpaid order, stale quote and expired-label scenarios preserve one original operation and a usable next action |
| Make onboarding and the first evaluation usable | PR-8, PR-17 through PR-21, PR-29 through PR-33 | New/existing seller paths and demo entry have truthful readiness and no credential exposure or unconfirmed provider effect |
| Keep work usable at the counter | PR-9; NFR-4; UI-1 through UI-3 | Primary keyboard/touch journeys pass at the required viewports with long data, failure states and retained entered values |
| Govern and operate the platform with bounded authority | PR-15, PR-23 through PR-28; TEN-4, IAM-7 | Platform access denial, tenant/discount review, scoped health, original-operation recovery and truthful audit checks pass without widening customer access |
| Price the sender and the gerai truthfully | PR-22, PR-23, PR-35 | The sender is charged the full normal tariff; the gerai discount is configuration that cannot exceed the provider-observed discount; no unapproved percentage or claim is public |
| Serve each audience on its own host | PR-36, PR-37 | Each host answers only its own routes, session cookies stay host-only, shipment references are unique within a tenant |

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
| Put customer identity on the shipment | Print the identity the gerai chooses on a local masked label while the real pickup stays on the shipment | Requested (CTX-39, DEC-017); PR-3, PR-34; no provider dropshipper and no arbitrary customer-address or logo replacement |
| Enter a correct parcel | Name/content, weight/dimensions and provider-required declared data; validate units and bounds at the backend | Existing draft/quote/issue contracts; PR-4, PR-5, DATA-2; exact account-specific payload verified during integration |
| Issue once and recover interruptions | Explicit review, one durable operation, recovery of original unknown/unpaid order | Requested core flow; PR-5, NFR-2 |
| Offer drop-off or pickup | The gerai chooses per shipment; pickup reserves the provider time slot before the order is created | Decision CTX-39 launch scope; PR-5, T-043 |
| Print and reprint the right label | Authoritative AWB, local label 10x15 cm (10x10 cm option) with a Code128 barcode, immutable snapshot and append-only print history | Requested; PR-6, PR-7, PR-34; printer/media fit is pilot evidence |
| Find a shipment while helping a customer | Search/filter queue and inspect status/history/next valid action | Initial recommendation; PR-9, PR-12; no broad cross-tenant provider search |
| Work with more than one staff member | Explicit memberships/roles, current authority, conflict handling and actor audit | Requested multi-user direction; PR-1, PR-10; roles per DEC-008, outlet-level assignment deferred |
| Operate under the gerai's identity | Validated app name/logo and visible outlet context | Requested; PR-13; the identity on the printed label is PR-34; customer receipt and invoice content need separate acceptance |
| See what needs attention during the day | Unknown/unpaid/label-failure worklist first; scoped count/time basis and refresh | Queue PR-9; first overview form built as the gerai Dashboard (PR-14, T-078, UX-16) |
| Keep a record of customer charges and receipts | Separate selected normal customer tariff, gerai discount configuration, fee/insurance and payment status | PR-22/PR-23 select pricing; receipt/cashier/extra markup/ledger remain conditional; no platform ledger in the first release (DEC-016) |
| Pass parcels to a courier and handle cancellations | Verified courier events and state-valid cancellation; explicit local custody/handover | Cancellation and tracking scheduled as PR-12 (T-045, DEC-014); custody/handover remains a candidate under TD-1 |
| Process larger repeat batches | CSV preview, selected-row confirmation, scoped export and batch-print behavior | CSV export scheduled as PR-16 (T-047); CSV intake PR-11 and batch print remain later candidates under TD-1; volume/limits not inherited automatically |
| Try the application on first delivery | Working demo access, synthetic contacts/shipments and simulated labels | Requested; PR-21, IAM-4, UX-3 |

### Money and custody distinctions

| Concept | Authority / unresolved policy |
|---|---|
| Mengantar quote and order funding | Seller-specific provider amounts/account; confirm the actual payable operation and balance path in sandbox |
| Price charged to the customer | The sender pays the selected normal Mengantar tariff before any seller discount, plus applicable verified fee/insurance exactly once (CTX-28, DEC-016, PR-22). Extra markup/payment/receipt workflows need separate acceptance. |
| Gerai discount and platform remainder | Decision (DEC-016): the gerai discount is Super Admin configuration (PR-23); the platform remainder is derived, an estimate until provider-verified, and not collected in the first release. How the remainder would reach the platform is Unknown (CTX-42) |
| COD value and settlement | Money collected under provider rules; it is not automatically gerai revenue or proof of customer payment to the counter |
| Gerai revenue or profit | Requires accepted price/cost/fee/tax/refund definitions; do not derive a profit KPI from provider balance or shipment count |
| Parcel handed over at the counter / to a courier | Local custody state; a printed label or local handover does not establish provider pickup or delivery |

## Initial scope and staged candidates

The recommended first preview includes demo access and the core counter screens:
login/scope, contact reuse, one-page intake/quote/review, shipment queue/detail,
simulated recovery/label access, and settings readiness. The paired restricted
Super Admin preview uses isolated synthetic platform fixtures for tenant,
readiness/discount, exception and audit screens; the shared operator demo gains
no platform permission. Demo fixtures are not proof of live issuance. Live pilot
enablement adds verified PostgreSQL/PostgREST RLS isolation, real seller onboarding/BYOK, provider
order proof, the local masked label (PR-34) with a pilot scan, provider pickup time
reservation (PR-5) and an approved production egress path when Partner production
is used. Decision (CTX-39): pickup and the masked label are launch scope.

The complete create-resi flow and its failure cases precede optional finance,
bulk operations, richer reports and additional integrations. The existing
scope-ordering table below owns delivery ordering; exact milestones, budget,
release dates and workload targets remain owner decisions.

The following are **outside the current proposed initial delivery**, subject to
explicit later scope selection rather than permanent rejection: a customer
self-service portal, a second shipping aggregator, a custom public API, custom
domains, subscription billing, full cashier/accounting/COD settlement, automated
old-data migration, and direct printer/scale/scanner hardware integrations.
Cancellation (PR-12, T-045), the invoice snapshot and CSV export (PR-16, T-047) are
now scheduled under DEC-014. Customer-receipt content, scan handover and batch
printing remain LegacyReference candidates under TD-1, with their own
policy/acceptance before exposure.

## Core distinctions

| Object | Meaning |
|---|---|
| Tenant | Business access boundary; proposed to own its brand, users, outlets, contacts, and shipments. |
| Outlet | Physical operating location and pickup configuration; one tenant may have several outlets, all mapped to the tenant's single seller (DEC-006). |
| User | A person who signs in and has explicit membership/permissions. |
| Contact | A saved sender and/or recipient; saving a contact does not create a user. |
| Sender | Customer identity attached to one shipment; distinct from the physical pickup address. |
| Recipient | Destination party and provider-resolved destination area. |
| Provider account | Mengantar seller owns orders, balance, rates and provider masters. Decision (DEC-006): one seller per tenant business, Partner-created or BYOK for an existing seller the verified owner proves they control; several outlets map to it. |
| Shipping label | The AWB and routing are provider-authoritative. The printed label is a local GeraiExpress document carrying the AWB as a Code128 barcode (DEC-017); the provider PDF is an optional, whitelist-gated later source. |
| Customer receipt | Outlet-branded proof of the customer transaction; need and content remain an owner decision. |
| Tenant slug | Immutable, unique, lower-case identifier for display, reference prefixes and support lookups; never authorization (CTX-41, PR-37). |
| Gerai discount | Super Admin-assigned configuration in basis points with effective date, source reference, status and audit (DEC-016, PR-23). |

## Selected pricing direction — normal customer tariff, discounted seller cost

The product owner selected this policy in CTX-27 and CTX-28 and amended it on
2026-10-28 in CTX-42 and DEC-016: the sender pays the full normal tariff, the
gerai gets a configured discount, and no platform fee is collected in the first
release. The
[LegacyReference pricing study](../research/geraiexpress-reference-pricing-review.md)
remains source evidence; its historical COD Ongkir break-even and percentages
do not override the current GeraiExpress decision.

| Price / audience | Selected behavior |
|---|---|
| Customer and resi shipping | Actual Mengantar **normal shipping tariff before seller discount**, matched to the chosen route, parcel, courier and service/tier |
| Seller/gerai cost paid to Mengantar | Actual applicable net cost under its assigned/activated discount; private to authorized financial/admin access |
| Discount given to a gerai | Super Admin configuration (DEC-016): integer basis points, effective date, source reference, status owner-stated / provider-observed / provider-verified, and an audit record with the actor; never above the provider-observed discount; must match verified provider billing or remain pending/mismatched, not falsely applied |
| Customer COD fee | Applicable verified Mengantar fee/base/minimum/rounding; add it only where not already included, with the accepted payer/collection method |
| Seller COD fee | Actual provider deduction and any independently verified fee discount; do not assume the shipping discount also applies to this fee |
| Customer and seller insurance | Applicable verified coverage/premium and payer; no invented percentage, unsupported automatic coverage, or silent omission of a required premium |
| Gerai extra markup/admin/packing | No additional discretionary amount is selected by this instruction; any later addition needs its own accepted requirement |
| Platform fee / commission | Decision (DEC-016): no separate platform fee is collected from the gerai and no platform ledger is built in the first release. The platform remainder is derived and shown only as an estimate. Whether Mengantar pays the platform or the gerai would have to pay it is Unknown (CTX-42); no entitlement is established by the four Partner routes |

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

### Gerai discount and platform remainder (DEC-016, CTX-42)

Let `p` be the provider discount observed in an estimate (`discountPercent`,
unknown when absent) and `g` the gerai discount assigned by the Super Admin, both
in integer basis points. The model separates three quantities:

```text
Sender price       = R (full normal tariff) + applicable fee/insurance, each once
Gerai discount     = g, configured, never above p when p is known
Platform remainder = p − g, derived, never typed, an estimate until provider-verified
```

Decision (DEC-016): the sender pays the full normal tariff `R`. The gerai-facing
cost estimate derives from `g`; the provider's actual debit of the seller balance
(`N`) stays separately recorded, so a difference stays visible instead of being
hidden. No percentage is a constant in code or a default imported from history
(DEC-003, DEC-012).

Decision (owner-stated starting terms, unverified): provider 30%, gerai 20% and a
platform remainder of 10 points, that is 3000, 2000 and 1000 basis points. They
may change and keep the status owner-stated until Mengantar confirms them in
writing.

Observed (CTX-42; Mengantar help page and estimate documentation, read
2026-10-28): published volume steps start at 20% and reach 30% only above the
10,000 step, and the page states neither unit nor period; the sandbox estimate
example returns `discountPercent` 20 and `discountExtraPercent` 0. Nothing read
states that a partner-registered seller starts at 30%, that a partner can set a
per-seller discount, that a partner's sellers are pooled for volume, or that
Mengantar pays a partner anything. Evidence that fits the owner's 30% was not
found; evidence that fits 20% for a new seller was.

Unknown: with about 50 small sellers each on its own volume step, the platform
remainder may be 0 points. If the provider charges the seller 30% while the gerai
is promised 20%, the 10 points need a collection path the first release does not
have, or a Mengantar payment that is not documented (CTX-42). Public pages show
no percentage until the terms are provider-verified (PR-35).

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
actual debit. Obtain the provider-approved activation path/commercial terms
(the written Mengantar answers are an open decision) and verify resulting net
quotes/billing before marking an assigned discount provider-verified.

Normal tariff and approved customer totals must appear on customer/resi output
without exposing net cost or assigned discount. Verify this on the local masked
label and any customer-facing output (the provider PDF is not the label source,
DEC-017); do not silently print discounted cost. Sender/customer goods proceeds,
withdrawals, settlement and returns remain separate accepted financial
responsibilities when Full COD is enabled. Application monetization is limited by
DEC-016: no platform fee is collected in the first release.

## Stack and presentation direction

Decision (DEC-005, DEC-020, DEC-021, ADR-0002): Next.js App Router + TypeScript +
shadcn/ui for the authenticated application, running as a self-hosted Node.js standalone
container (`Dockerfile`, `compose.yaml`, T-062) with exact Next.js pins (Next.js 16.4.3).
Plain PostgreSQL 17 behind PostgREST (`@supabase/postgrest-js` as a stand-alone query
builder) and an application-owned auth module (`src/lib/auth/**`, `db/migrations/20261029100000_auth_core.sql`,
T-064..T-066; T-067 review open) supply authentication, PostgreSQL constraints, RLS and
RPC execution, replacing Supabase and GoTrue; Cloudflare Turnstile stays as the CAPTCHA.
The earlier Cloudflare Workers / `@opennextjs/cloudflare` adapter path (DEC-005) and the
hybrid Vultr/Coolify egress gateway direction (DEC-011, T-040) were withdrawn by DEC-020:
the self-hosted server's own fixed IPv4 address is the address registered on Mengantar's
production allowed-IP list (ARCH-2, ARCH-5).

UI-1 through UI-3 translate the user-supplied Apple reference into blue/neutral
semantic tokens, native typography, clear action hierarchy, restrained surfaces,
and practical operator density. This selects the visual direction, not an
implemented screen or a claim about Apple website internals.

## Scope ordering after reference review

The ordering below is the original recommendation, not an accepted commercial or release policy; the executable order is TASKS.md. Observed 2026-10-28: the foundation slice and the sandbox part of the shipping pilot are built; pickup, the masked label, tracking and the discount workspace are still pending.

| Delivery slice | Proposed content | Gate |
|---|---|---|
| Foundation | Tenant/user membership, restricted Super Admin access/business directory, initial demo workspace, seller onboarding/BYOK, agreement, outlet readiness, contacts and drafts | Tenant/account-owner policy, Partner access/egress plan, isolated database proof |
| Shipping pilot | Public API areas, quotes, explicit issuance/recovery, pickup with time reservation and the local masked label (the provider PDF and sender mapping are no longer required, DEC-017) | Durable seller/key binding, permissions, current sandbox contract, per-seller coordination |
| Operational completeness | Shipment queue/detail, tracking, print history, daily overview/brand, Super Admin monitoring/discount-readiness/recovery/audit | Each primary action has backend enforcement and observed evidence |
| Later candidates from LegacyReference | CSV import, richer analytics, extended platform reports, RTS; CSV export and the invoice are scheduled under DEC-014 (T-047); finance and the platform-share ledger are not planned for the first release (DEC-016) | Explicit requirement acceptance and domain-specific contracts |

Finance/COD fee percentages, tax policy, tenant pricing, free/unlimited plans,
old retention periods, custom domains, and automatic migration are not inherited
from LegacyReference by copying its source. An observed feature can be a reuse
candidate without becoming a promised initial-release requirement.

## Actors

IAM-1 owns the permission matrix, resolved by DEC-008 (operator and tenant_admin
roles; pilot memberships are tenant-wide). Super Admin (the platform administrator) manages tenant
lifecycle and explicit platform capabilities; tenant administrator configures an owned workspace and staff;
operator performs permitted daily shipping/contact work; a machine worker
processes an already-authorized operation. Senders and recipients are contact
data subjects, not automatically registered users. Support impersonation has no
default permission.

## Super Admin direction and operating needs

**Super Admin** is the UI/product label for the existing **platform
administrator**. Tenant Admin is the gerai owner/admin; Operator is counter
staff. Platform pricing/integration/recovery permissions are capabilities of
an explicitly authorized platform principal, not automatic tenant membership.
This scope follows CTX-29/CTX-30. Observed (ARCHITECTURE.md, 2026-10-29): the
tenant directory and lifecycle, platform access governance with application-owned TOTP (`aal2`),
audit, application review, integration readiness, the discount workspace (PR-23, T-041/T-053)
and tenant masking control (PR-34, T-053) exist locally; platform health monitoring (PR-25) and
cross-tenant recovery (PR-27) do not. Decision (DEC-015): the workspace is served only from
`owner.geraiexpress.com` (PR-36; enforced in `src/lib/hosts.ts` and `src/proxy.ts`).

| Need / workspace | Decision and main action | Required boundary / owner |
|---|---|---|
| Restricted access | Dedicated Super Admin entry, active platform grant and second-factor verification; manage approved platform staff access | PR-24, PR-36, IAM-7; served only from the owner host; public signup/demo/tenant roles cannot promote themselves |
| Tenant/gerai directory | Search/filter status; open business profile, owner contact, outlet/member counts and readiness; create or change permitted lifecycle | PR-15; minimal business details, audited action, no customer directory by default |
| Registration review | Inspect setup/verification and approve/reject with a reason; manual review is the pilot policy (DEC-007) | PR-15; a reviewed app tenant is not an automatically verified Mengantar seller |
| Seller/Mengantar readiness | Identify partner-created versus BYOK, pending/unknown onboarding, provider account restriction, label/webhook readiness and safe credential status | PR-26, PR-17 through PR-20; provider dropshipper and PDF capability are not required (DEC-017); no raw key/secret, provider dashboard impersonation or automatic account recreation |
| Diskon gerai | Assign the gerai discount per tenant (basis points, effective date, source reference, status), see the derived platform remainder estimate, the provider-observed discount and the variance between assigned and observed (neither collected nor subsidized), inspect provider activation/mismatch | PR-23, IAM-6, UX-12; normal customer/resi tariff stays unchanged; blocked above the provider-observed discount; no invented upstream discount endpoint |
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

The Super Admin workspace is the same Next.js/Node/PostgreSQL application with a
separately guarded platform workspace, served only from its own host
(DEC-015, PR-36); it needs no separate application stack. Notifications, ticketing,
impersonation, bulk destructive changes, per-tenant custom domains and
platform-wide customer exports are conditional future features, not implied by
this completeness review.

## First-use journey (decisions DEC-006 to DEC-008 applied)

The first preview offers the separate demo entry in PR-21. Demo access uses
synthetic data and simulated shipping; it does not register a real gerai or seller.
UX-7 owns the complete real-account journey and UX-8 owns staff/recovery paths.

1. Choose **Register a gerai**, **Sign in**, **Accept staff invitation**, or
   **Try demo**. An existing authenticated user resumes their own onboarding or
   selects an existing membership; a login does not create another tenant.
2. Registration (DEC-007, DEC-021): enter a real email, review the application's
   own policy notices, request a 6-digit email code from the application-owned auth
   module (`public.auth_issue_otp` + `src/lib/auth-mail.ts`, formerly Supabase OTP), and verify it.
   Only then choose a password for a new account. This email-first rule
   avoids attaching a third party's chosen password to an unverified inbox.
   Previously completed app accounts keep their credentials unless they use
   account recovery. Identity creation (`auth.users`) is not seller creation.
3. Complete owner/business information and the initial outlet setup. Submit
   an explicit versioned application. The backend atomically creates one
   pending tenant, first administrator membership, initial outlet and audit
   record, or returns the existing result for that submission. Auth and email
   operations are outside that database transaction and recover independently.
4. Pilot policy (DEC-007): Super Admin reviews and approves, requests
   corrections, or rejects with a safe reason. The owner can view pending status
   and edit only a draft or changes-requested application under DATA-7; the
   submitted review revision is immutable. Pending owners cannot issue shipments.
   Automatic activation after the pilot remains a proposal; if it is selected,
   record the applied policy/version and apply the same identity/data checks
   without a fictitious review. Neither branch creates or approves a Mengantar
   account automatically.
5. Once the tenant is active, its authorized administrator chooses **Create a
   Mengantar seller** or **Connect an existing seller**. Confirm the real
   account owner and the separate provider agreement. PR-17 through PR-20
   govern durable Partner creation, existing-account BYOK and recovery.
6. Configure the actual pickup, label masking settings (PR-34), supported services,
   normal retail/net seller pricing, and COD if enabled (insurance is deferred,
   DEC-013). Display capability-specific readiness and the remaining
   setup action. A connected key, tenant approval or assigned discount alone
   is not evidence that live shipping/printing is ready.
7. The operator selects an allowed tenant/outlet and completes one-page intake
   → current quote → explicit review → drop-off or pickup → submit → authoritative
   provider AWB → local masked label. The sender is charged the full normal
   Mengantar tariff (CTX-28, DEC-016); private seller cost follows the provider estimate.

When a customer sender differs from the gerai, the operator chooses the label
identity with the masking switch (PR-34); no provider dropshipper mapping is
submitted (DEC-017). Saving a contact never registers a seller or silently
writes a provider master. Pickup remains the physical pickup origin.

### Registration information and ownership

| Stage | Required information / action | Boundary |
|---|---|---|
| Email verification | Real accessible email; application notice/required Terms acceptance | No password, tenant role, business approval or Mengantar agreement inferred from sending a code |
| Account completion | Initial/partial app identity explicitly sets or replaces its own password after fresh inbox proof | The application-owned auth module (`src/lib/auth/**`, `auth.users`, ADR-0002; formerly Supabase Auth) owns credentials; trusted completion/session guard follows TD-11; previously completed accounts keep their credentials or use explicit recovery |
| Gerai application | Business name, owner display name, business contact phone, first outlet name; confirm applicant authority | Server validates lengths/characters, contact shape and revisions; no API key, bank account, identity document or customer data requested here |
| Outlet readiness | Pickup address and verified provider area IDs; accepted operational/brand settings | Address can be completed during setup, but must be valid before quoting/issuing; local name is not a provider pickup ID |
| Seller connection | Confirmed seller owner/name/email/mobile, connection mode and actual provider policy agreement | Reusing verified app email is a proposed default; another owner requires a selected authority/verification method before dispatch |

Shipment-reference prefix (assigned at activation, PR-37), paid-plan selection, top-up, bank/KYC collection and marketing
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

## Implementation status by requirement

Observed status amendment (2026-10-29, DEC-020, DEC-021). Sources: merged `Dockerfile`,
`compose.yaml`, `compose.db.yaml`, `infra/`, `db/foundation/`, `db/migrations/20261029100000_auth_core.sql`,
`src/lib/db/**`, `src/lib/auth/**`, `src/proxy.ts`, runtime helpers and BUILD-LOG.md. Earlier Worker
and GoTrue/Supabase results remain historical observations recorded in STATUS.md. T-064..T-066 are
built locally in the working tree; T-067 (independent security review of the owned auth and PostgreSQL
backup/PITR release gates) and production DNS/TLS/allow-list/mail readiness remain open. Final merged
verification and counts remain the lead's responsibility in STATUS.md.

Legend for the State column:

- Implemented: built and checked locally, and against the Mengantar sandbox where a provider is involved. Nothing is in production; the deployed preview holds synthetic data only.
- Partial: part of the statement is built or the acceptance is not yet met; the evidence pointer names the gap.
- Not implemented: not built.
- Deferred: the owner or an external gate defers it, and it is listed as Deferred in TASKS.md.

The Status line of each requirement is a separate lifecycle: Accepted means
`DECISIONS.md` records the owner's decision (named in brackets); Proposed means no
individual owner decision exists; Amended means the statement changed on the date
shown. Task references: `T-025` and later are task blocks in TASKS.md. Earlier
tasks are table rows there and are written here as bare numbers (for example 003,
003b, 024) because the traceability validator resolves only task blocks.

### Decisions resolved after the first draft

| Decision | Effect on this PRD |
|---|---|
| DEC-001, DEC-002 | shadcn/ui and Turnstile remain; DEC-020 replaces Cloudflare runtime hosting with a self-hosted Node container, and DEC-021 (ADR-0002) replaces Supabase with PostgreSQL 17 + PostgREST + application-owned auth |
| DEC-003 | Sender pays the normal tariff, seller cost stays private, COD and insurance counted once (PR-22, PR-23) |
| DEC-004 | This file is the canonical PRD of the project |
| DEC-005 | Exact Next.js pins remain; Workers/OpenNext adapter choice and its runtime gate are superseded by DEC-020 |
| DEC-006 | One seller per tenant business, several outlets, no central seller; closes CTX-9 (PR-17 to PR-20) |
| DEC-007 | Email-first registration, resumable application, manual approval in the pilot, 7-day email-bound invitations, one application per additional business (PR-10, PR-29 to PR-32) |
| DEC-008 | Role matrix resolved, tenant-wide pilot memberships, Super Admin bootstrap (PR-10, PR-24) |
| DEC-009 | In-stack Bahasa auth mail with anonymous-identity refusal; DEC-021 (T-066) removes the Supabase Send Email Hook and sends code mail directly from the Node app (`src/lib/auth-mail.ts`, `src/lib/mail-transport.ts`: Mailpit locally, fail-closed in production until T-063) |
| DEC-010 | First form of the account dispatcher: machine identity and per-tenant database serialization (PR-5, NFR-2) |
| DEC-011 | Withdrawn by DEC-020; the gateway task was cancelled before implementation, and T-040/ADR-0001 remain historical design evidence |
| DEC-012 | The Partner account is GeraiExpress's own; the discount is configuration; no percentage on public pages until provider-verified |
| DEC-013 | PR-19 and PR-32 recovery scheduled; PR-3 dropshipper and insurance deferred |
| DEC-014 | Selected legacy parts are ported as new modules: pickup, cancel, webhook and tracking, masked label and invoice, CSV export, wilayah reference (T-043 to T-047) |
| DEC-015 | Hosts: owner., app. and apex (PR-36) |
| DEC-016 | Pricing model: sender pays the full normal tariff, gerai gets a configured discount, no platform fee (PR-22, PR-23) |
| DEC-017 | Local masked label with Code128 barcode; no provider dropshipper; no dependence on the provider PDF (PR-3, PR-6, PR-34) |
| DEC-020 | Decision (owner): self-hosted Node container, fixed server IPv4 for Mengantar, Turnstile retained (T-062 built locally; Supabase retention clause superseded by DEC-021) |
| DEC-021 | Decision (owner, ADR-0002): plain PostgreSQL 17 + PostgREST + application-owned auth replace Supabase (T-064..T-066 built locally; T-067 independent security review and PostgreSQL backup/PITR gates open) |

### Status table

| Requirement | State | Owning task | Evidence pointer |
|---|---|---|---|
| PR-1 · Tenant workspace access | Implemented | 002, 003, 003b, T-051 | tests/db isolation; e2e forged cookie and two memberships; the in-session gerai switcher is built (T-051, tests/e2e workspace-states) |
| PR-2 · Contacts | Implemented | 004, T-028 | tests/e2e contacts; tests/db contact-archive; T-028 lists PR-10 as primary |
| PR-3 · Customer sender versus pickup | Partial | T-044 (identity via PR-34); 023 only selected the pickup | order body sends no sender or dropshipper (met); local label identity built (T-044); courier acceptance unproven (T-048); provider dropshipper deferred (DEC-013, DEC-017) |
| PR-4 · Compare services | Implemented | 005, 008, 019, 023, T-025, T-034 | tests/unit public-api; tests/db live quotes and quote-origin; gap: dimensions not sent (the form says so for live gerai), volumetric weight deferred |
| PR-5 · Issue and recover | Partial | 005, 021, 022, 024, T-025, T-026, T-033, T-034, T-039, T-043, T-053, T-056 | attempts/frozen origin/pickup built; sent/unknown is reconcile-only, zero-count answers use per-order reads and Partner operations reconcile across regeneration; supervised payment/pickup capture and admin closes remain open |
| PR-6 · Labels | Partial | 006 (sample), T-044, T-047 | local masked label from an immutable snapshot plus invoice built (Chromium print-to-PDF only); courier acceptance unproven (T-048); provider PDF deferred (HTTP 403) |
| PR-7 · Party snapshots | Implemented | 005 | confirm_shipment snapshot; tests/db shipment-flow |
| PR-8 · Outlet readiness | Implemented | 007, 015, 023, T-044 | e2e settings and credentials; the sender and label rows were re-labelled by T-044 |
| PR-9 · Queue and detail | Implemented | 003, 024 | e2e shipping and auth-demo; gaps: pending states, recovery e2e |
| PR-10 · Membership governance | Implemented | 014 | tests/db invitations; e2e members; T-028 is mapped here in error |
| PR-11 · CSV intake | Deferred | none | TASKS.md Deferred list |
| PR-12 · Tracking, webhook, cancel | Not implemented | T-045 | /pengaturan shows tracking not enabled; webhook gated by a public URL and the callback secret |
| PR-13 · Tenant identity and brand | Partial | 003 | gerai and outlet names only, no logo; T-029 belongs to PR-35 |
| PR-14 · Daily overview | Partial | T-078 | gerai Dashboard at `/` (UX-16): attention list, today's counts against yesterday, 7/14/30-day trend in WIB, status split and courier ranking from the gerai's own shipments; the stale-data refresh path and the overview-versus-filter parity check of the acceptance are not yet proven |
| PR-15 · Tenant lifecycle | Implemented | 012, 013 | tests/db platform and registration; e2e platform |
| PR-16 · Safe export | Partial | T-047 | CSV export (tenant admin, 10000-row cap, formula guard, audited) and invoice snapshots built; wilayah reference deferred (owner decision) |
| PR-17 · Partner seller onboarding | Partial | 020, T-027, T-032, T-034 | sandbox works; the binding is machine-attested since T-032; gaps: pre-T-032 bindings not re-verified, retry_after wiped by begin (T-054), no environment scope (T-050) |
| PR-18 · Existing account (BYOK) | Partial | 015, T-027, T-032 | sealed storage tested; the cross-tenant clause holds for new writes since T-032; BYOK key ownership not verified against Mengantar |
| PR-19 · Key recovery and rotation | Partial | T-039 | fetch, regenerate with a pre-call fence, rotation_unknown recovery and stop states built and tested locally; no supervised sandbox regeneration (T-048); operators see no paused-key panel |
| PR-20 · Disclosure and consent | Partial | T-027, T-034 | document links and server-held versions built; the real URLs and version labels are owner-held, so onboarding stays blocked until the four bindings are set |
| PR-21 · Demo login | Implemented | 003, 009, 010, 011, 018, T-051 | e2e auth-demo; preview smoke; demo quotas and cleanup (tests/db demo-quotas) |
| PR-22 · Prices and private cost | Partial | T-025, T-041, T-053 | normal tariff plus COD fee once; nullable provider percentage recorded; tenant-admin-only gerai-cost estimate rendered; insurance deferred (DEC-013) |
| PR-23 · Gerai discount | Partial | T-041, T-053 | terms/ceiling/quote-time version and admin/settings/detail views built; provider percentage stored with NULL distinct from zero; written provider terms and environment-scoped assignments remain unproved |
| PR-24 · Super Admin access | Implemented | 012, T-042 | tests/db platform; e2e platform; owner host separation built (T-042) and not deployed; TOTP recency open (T-054) |
| PR-25 · Platform health | Not implemented | none (no task, no deferral entry) | ARCHITECTURE.md Not implemented |
| PR-26 · Integration readiness | Partial | 015, T-027, T-031 | admin/integrasi built; Partner ID setting is not read by onboarding |
| PR-27 · Super Admin recovery | Not implemented | none (no task, no deferral entry) | only tenant-administrator reconcile exists |
| PR-28 · Platform audit | Implemented | 012 | tests/db platform; e2e platform |
| PR-29 · Verified registration | Implemented | 013, 016, 017, T-051 | tests/db registration; e2e registration; "Kirim ulang kode" and "Ganti email" built (T-051) |
| PR-30 · Application and activation | Implemented | 013 | tests/db registration; e2e registration |
| PR-31 · Staff invitation | Implemented | 009, 014 | tests/db invitations; e2e members |
| PR-32 · Recovery and routing | Partial | 003, 013 | routing built; password recovery scheduled with no task (DEC-013) |
| PR-33 · Authentication email | Partial | 016, 017, T-030, T-063, T-065, T-066 | SQL signup/anonymous gate in `auth_issue_otp` plus direct Bahasa code mail (`renderCodeMail`, `mail-transport.ts`; Send Email Hook removed in T-066); local Mailpit only, production provider/transport unbuilt and failing closed (T-063) |
| PR-34 · Masking switch and label content | Partial | T-044, T-053 | local label and capability/aal2-guarded masking built; activation statement/courier test remain T-048; former three-viewport Worker e2e is historical |
| PR-35 · Public marketing claims | Implemented | T-036 (pages built by T-029, T-031) | approved-claims copy, derived couriers, noindex on non-apex hosts (tests/unit marketing-rebrand and proxy); the pages do not yet describe pickup or the local label |
| PR-36 · Host topology | Partial | T-042, T-055, T-062, T-066 | `src/lib/hosts.ts`, `src/proxy.ts`, `src/lib/db/cookies.ts` (`gx_at`/`gx_rt`) and Caddy templates built; DNS/TLS, cross-host Server Actions and production host cutover remain unproved |
| PR-37 · Tenant slug and reference | Implemented | T-049 | slug, prefix and counter built and tested locally; the prefix is assigned at approval by a trigger |
| PR-38 · Counter payment and receipt | Not implemented | Proposed; contract UX-17, DATA-11; T-082 | gap analysis J5; `invoice-content.ts` states the invoice is not a receipt |
| PR-39 · Shift and day close | Not implemented | Proposed; contract UX-17, DATA-11; T-083 | gap analysis J6 |
| PR-40 · Resi message and tracking link | Not implemented | Proposed; contract UX-18, DATA-12, SEC-8; T-085 (needs T-045) | gap analysis J9/J10; only `wa.me` link is marketing |
| PR-41 · Content declaration | Not implemented | Proposed; contract UX-19, DATA-13; T-081 | gap analysis J3; Permenkomdigi 8/2025 Art 22 |
| PR-42 · Insurance offer | Not implemented (insurance Deferred, DEC-013) | none (Proposed) | gap analysis J4; Permenkomdigi 8/2025 Art 27 |
| PR-43 · Measured and billable weight | Not implemented | Proposed; contract UX-19, DATA-14; T-080 | gap analysis J2; Mengantar formula published; scheduled as T-080 |
| PR-44 · Return and claim cases | Not implemented | Proposed; contract UX-20, DATA-15; T-086 (needs T-045) | gap analysis J11/J12 |
| PR-45 · Pilot measurement and earnings | Not implemented | Proposed; contract UX-17; T-087 | gap analysis J13; PRD evaluation measures have no instrument |
| PR-46 · Masked-label acceptance gate | Not implemented | Proposed; contract UX-9 (amended); T-084 (T-048 evidence) | gap analysis section 6 (Art 77); Mengantar Java-only return address |
| NFR-1 · Isolation proof | Partial | 002, T-032, T-035, T-064, T-065 | `tests/db` (27 files / 410 tests against PostgreSQL 17 + PostgREST); seller binding closed; signature-based catalog test includes the 14 `auth_*` machine functions; local database only |
| NFR-2 · Duplicate and interrupted operations | Partial | 005, 022, 024, T-026, T-033, T-043 | dispatcher tests; payment replay closed locally by the attempt table; live behavior unproven |
| NFR-3 · Private payloads | Implemented | 001, 015, T-030, T-038, T-066 | client-bundle scan (including `AUTH_JWT_SECRET`, `AUTH_SECRET`, `SERVICE_ROLE_JWT`); no-store `src/proxy.ts`; HttpOnly `gx_at`/`gx_rt` cookies, CSP base policy and account limiters (T-038, T-066); the script CSP is Report-Only |
| NFR-4 · Operator browser proof | Partial | 003 to 007, PERF-1, T-066 | container Playwright e2e across 390/768/1280 (STATUS.md); several recovery states lack browser proof |
| NFR-5 · Partner network | Partial | 020, T-040, T-062 | signing vectors are historical test evidence; DEC-020 replaces gateway design with the server's fixed IPv4; actual production address/allow-list proof remains open |

### Mapping corrections found by the review (2026-10-28)

| Error found | Correction in this PRD | Remaining action in TASKS.md |
|---|---|---|
| T-028 (contact-archive guard, cron and credential tests) is mapped to PR-10 | The contact-archive guard belongs to PR-2 and IAM-1; PR-10 is delivered by task 014 | Change the primary requirement of T-028 to PR-2 |
| T-029 (public marketing pages) is mapped to PR-13 | Public marketing is PR-35; PR-13 is tenant identity; PR-32 is touched only by the signed-in `/` routing | Change the primary requirement of T-029 to PR-35 |
| T-036 (public marketing correction) is mapped to PR-22 | The requirement is PR-35 | Change the primary requirement of T-036 to PR-35; PR-22 stays a constraint |
| Task 023 claims PR-3 | Task 023 selects the outlet pickup and recipient area; sender identity is PR-34 | Remove PR-3 from the task 023 row; T-044 carries PR-3 and PR-34 |
| PR-3 dropshipper, insurance, PR-19 and PR-32 password recovery had no task or deferral | DEC-013 defers PR-3 dropshipper and insurance and schedules PR-32 recovery; PR-19 is T-039 | None; the TASKS.md Deferred list already carries them |
| PR-25 and PR-27 appear only in ARCHITECTURE.md | They stay Proposed and not implemented | Add a task or a Deferred entry for each |
| PR-20 document links and server-held versions have no owning task | PR-20 is marked Partial | Done: T-034 carries the links and the server-held versions |
| PR-37 slug and shipment-reference work has no task | PR-37 added | Done: T-049 carries it; T-042 covers hosts only |
| PR-16 is both T-047 and a Deferred entry | PR-16 is shown as partial after T-047 | The Deferred list keeps only the wilayah dataset and the bulk intake and overview items |
| DEC-014 names T-042 to T-047 while T-042 is host topology (DEC-015) | The decision table here lists T-043 to T-047 | Correct the wording of DEC-014 |

## Functional requirements

### PR-1 — Tenant workspace access
- Status: Proposed (no individual decision record); built under CTX-1
- Owner: Paduka Ongki
- Source: CTX-1, CTX-2.
- Statement: When a user opens an operational workspace, the system shall permit only tenants and outlets authorized by that user's current membership.
- Acceptance: Given users in two different tenants, When either opens, searches, exports, or mutates the other's data, Then access is denied without revealing the other tenant's records; the same permitted operations succeed within their own scope.
- Constraints: TEN-1, TEN-2, IAM-1; tenant selection is not authorization.
- Evidence: Observed local same-tenant/cross-tenant DB and forged-cookie/two-membership browser coverage; T-051 adds "Ganti gerai" and `/pilih-gerai` without signing out. F2 reuses the verified workspace's membership count rather than querying it again. Unsaved-input switch confirmation remains unbuilt (UX-11).

### PR-2 — Save and reuse contacts
- Status: Proposed (no individual decision record); built under CTX-3, archive guard per DEC-008
- Owner: Paduka Ongki
- Source: CTX-3.
- Statement: When a permitted user saves a sender or recipient, the system shall store a tenant-owned contact with name, phone, and address information and allow selection for a later shipment.
- Acceptance: Given a saved contact in tenant A, When an authorized A user creates another shipment, Then its contact information can prefill the appropriate party; tenant B cannot discover or select that contact.
- Constraints: DATA-1, DATA-2, PRIV-1, TEN-1. Shared phone numbers must not force unrelated people into one record. Roles are fixed by DEC-008 (operators create and update contacts and addresses; only tenant administrators archive a contact); retention remains an open owner decision.
- Evidence: Observed contacts DB/e2e coverage and tenant-admin archive guard. T-051/lead integration adds the 300-contact truncation notice and name/phone search; F2 preserves ordinary punctuation, normalizes +62/62/dashed phones and keeps an unsaved selected contact in the list (contact-search unit and shipping e2e, worker-reported).

### PR-3 — Distinguish customer sender from pickup
- Status: Amended 2026-10-28 (DEC-017, CTX-39); provider dropshipper mapping Deferred (DEC-013)
- Owner: Paduka Ongki
- Source: CTX-2, CTX-5, CTX-39; DEC-013, DEC-017.
- Statement: When a customer is the shipment sender, the system shall keep the selected outlet pickup address as the provider pickup origin, shall not print the Mengantar pickup name as the sender by default, and shall carry the customer-facing sender identity on the local label under PR-34, without submitting a provider dropshipper mapping.
- Acceptance: Given a shipment for a customer sender, When it is submitted in the sandbox, Then the provider order keeps the selected pickup address, no dropshipper master or dropshipper field is sent, and the printed label shows the identity selected by the PR-34 switch; a following ordinary shipment does not inherit the customer's identity.
- Constraints: PR-2, PR-34, TD-2, DATA-3, TEN-2, DEC-013, DEC-017. Provider-account dropshipper mapping (the earlier statement of this requirement) is Deferred behind the supervised production order gate and is not inferred; reopening it needs a new owner decision. Arbitrary sender-address or layout support on the provider side is not established.
- Evidence: Observed (2026-10-28): the create-order body still sends no sender or dropshipper field (`src/lib/mengantar/public-api.ts`), so the provider pickup part is met; the local-label identity is built (T-044): the gerai identity or the operator-entered masked sender is printed from an immutable snapshot and the Mengantar pickup name is never the default sender (`src/lib/label-content.ts`; tests/unit code128, tests/db masked-label, tests/e2e label). Not met: no courier has accepted a locally printed label (T-048). Decision DEC-017 records the replacement.
- Change history: 2026-10-28 — Statement and acceptance replaced per DEC-017 and DEC-013: provider dropshipper submission and its account-specific sandbox proof removed; local masked identity moved to PR-34.

### PR-4 — Compare available courier services
- Status: Proposed (no individual decision record); built under CTX-2, CTX-4
- Owner: Paduka Ongki
- Source: CTX-2, CTX-4.
- Statement: When valid pickup, destination, and parcel details are present, the system shall obtain account-appropriate Mengantar estimates and allow selection only from currently supported services.
- Acceptance: Given a documented unsupported route or unavailable COD service, When estimates are displayed, Then the unsupported option cannot be submitted; a valid available service retains its provider identity and quoted amounts for review.
- Constraints: TD-2, DATA-2. Provider account and origin authority must be current. Do not hardcode historical courier availability, discounts, or fees. Observed gap: live estimates send actual weight only and the intake dimensions are collected but not sent (review finding SUP-08); the intake form now says so for live gerai (T-051); volumetric weight is Deferred until Mengantar's billable-weight rule is confirmed (TASKS.md Deferred).
- Evidence: Observed: tests/unit public-api parsing and two-pass COD, tests/db live-quote cases, e2e shipping on simulated quotes and an opt-in live sandbox e2e (ARCHITECTURE.md "Shipments & COD"; tasks 019, 023, T-025). Observed (2026-10-28, T-034): a quote carries its origin (`record_live_quotes` takes the provider pickup address and area ids), a pickup change expires unconfirmed quotes, and live recipient limits (name 100, address 300, provider phone rule) are Bahasa field errors (tests/db quote-origin, tests/unit draft).

### PR-5 — Issue and recover a shipment
- Status: Amended 2026-10-28 (CTX-39 launch scope, DEC-014); drop-off and pickup built locally; payment and pickup unproven against the provider
- Owner: Paduka Ongki
- Source: CTX-2, CTX-4, CTX-9, CTX-39; DEC-006, DEC-010, DEC-014.
- Statement: When an authorized user confirms a shipment, the system shall validate the current account, scope, quote, sender, destination, and parcel data, let the gerai choose drop-off or pickup for that shipment, reserve the provider pickup time slot before creating a pickup order, and record provider submission and recovery state without creating duplicate orders or repeating a reservation or order blindly.
- Acceptance: Given a timed-out submission, When the user returns or retries, Then the shipment enters reconciliation rather than blind re-creation; given an existing unpaid order, Then payment recovery targets that order and printing stays unavailable until an authoritative AWB exists. Given a pickup shipment whose time reservation or create response is lost, When the user returns or retries, Then the original operation is reconciled and no second reservation or order is sent; given a drop-off shipment, Then the existing drop-off behavior is unchanged; given a confirmed shipment, Then the pickup identity frozen at confirmation is the one dispatched (T-034).
- Constraints: TD-3, TEN-2, SEC-1, DEC-010. Provider-account owner/cardinality is one seller per tenant (DEC-006). A local idempotency key alone does not prove provider idempotency. A reservation is not an order. The verified `POST /time` and `GET /time` request and response shapes must come from a sandbox capture recorded in the research notes before pickup is enabled (T-043); until then they are Unknown.
- Evidence: Observed local drop-off/COD/attempt/frozen-origin/pickup coverage in dispatcher/orders, DB issuance/quote-origin/pickup and shipping e2e; earlier sandbox drop-off reached DELIVERED. T-053 adds sent/unknown reconcile-only UI and per-order zero-count judgment; F1 permits recovery through the active same-environment Partner key after regeneration; F2 fixes final-state pickup copy, excludes sibling time ids, uses one date per row and adds pickup-intake/courier-filter tests. Worker-reported checks are in TASKS/BUILD-LOG, not final merged evidence. Not met: no supervised sandbox payment/pickup capture (T-048 item (6)); shapes and slot ownership remain unverified, and persistent unknown-payment/ambiguous-reservation admin exits remain T-056.
- Change history: 2026-10-28 — Pickup with provider time reservation added as launch scope (CTX-39, T-043); drop-off and no-blind-retry retained.

### PR-6 — Obtain and print shipping labels
- Status: Amended 2026-10-28 (DEC-017, DEC-014); provider PDF label Deferred
- Owner: Paduka Ongki
- Source: CTX-2, CTX-6, CTX-39; DEC-014, DEC-017.
- Statement: When a scoped shipment has an authoritative AWB, the system shall produce a local label (10x15 cm by default, 10x10 cm as an option) that carries the AWB as a Code128 barcode, keep an immutable snapshot of what was printed with an append-only print history, and permit authorized printing; it shall not depend on the provider PDF label.
- Acceptance: Given a real shipment with an authoritative AWB, When the label is rendered, Then decoding its barcode returns exactly that AWB, the size matches the selected option, and no provider label call or dropshipper call is made; given a later edit of the source contact or outlet, Then reprinting reproduces the stored snapshot and the print is added to the history; given a missing AWB, an unpaid order or an unknown outcome, Then the label is unavailable with an explicit recovery state; a browser print dialog is not reported as proof of physical printing.
- Constraints: PR-34, PR-7, TD-4, TEN-2, PRIV-1, DEC-017. The provider PDF (`POST /label-generation`) stays an optional later source gated on Mengantar whitelisting the seller account (HTTP 403 observed on the sandbox, TASKS.md Deferred); no invented AWB, account-crossing generation ID or silent print-success claim. Whether couriers accept a locally printed label is Unknown until a pilot scan.
- Evidence: Observed (2026-10-28): a watermarked sample label for simulated shipments; for real shipments with an AWB a local label renders from an immutable `label_snapshots` row at 10x15 cm (default) or 10x10 cm with a Code128-B barcode that decodes to the AWB, each print is appended to `label_print_events`, no provider call is made and the unsaved preview does not print (T-044; tests/unit code128, tests/db masked-label, tests/e2e label on 390 and 1280; Chromium print-to-PDF gives one page at 100x150 mm and 100x100 mm). Not met: no physical printer and no courier scan evidence (T-048); the 768 px viewport was not run for the label specs.
- Change history: 2026-10-28 — Statement and acceptance replaced per DEC-017: local masked label with Code128 barcode instead of the provider PDF; the PDF label is no longer required.

### PR-7 — Preserve shipment party snapshots
- Status: Proposed (no individual decision record); built under CTX-2, CTX-3
- Owner: Paduka Ongki
- Source: CTX-2, CTX-3.
- Statement: When a shipment is submitted, the system shall preserve the sender, recipient, pickup, provider-account reference, and provider identities used for that submission.
- Acceptance: Given a submitted shipment, When a source contact or outlet setting is edited, Then the recorded shipment and reprint continue to reflect the original submitted data.
- Constraints: DATA-2, PRIV-1. Privacy and correction rules must distinguish reusable master records from transaction history. The printed label identity is snapshotted under PR-6 and PR-34.
- Evidence: Observed: confirm_shipment stores the snapshot and the detail page shows it as frozen; covered by tests/db shipment-flow and dispatcher suites and e2e shipping (ARCHITECTURE.md "Shipments & COD").

### PR-8 — Outlet readiness and provider configuration
- Status: Proposed (no individual decision record); built under CTX-4, CTX-9, CTX-11
- Owner: Paduka Ongki
- Source: CTX-4, CTX-9, CTX-11.
- Statement: When a tenant administrator configures an outlet, the system shall show whether its account binding, pickup/area pair and local label settings are ready for the requested operation, and whether any optional provider capability in use (provider label access) is available.
- Acceptance: Given an incomplete or replaced account configuration, When an operator attempts an affected operation, Then the system blocks it with a scoped setup path and does not mix old account IDs or silently switch the funding account.
- Constraints: TD-2, DATA-3, IAM-1, SEC-1. No silent central-account fallback; separate connection, shipping, label and webhook readiness. Provider sender (dropshipper) capability is not required while PR-3 is deferred. PR-17, PR-18, PR-19 apply.
- Evidence: Observed: /pengaturan shows per-capability state and Partner or BYOK connection status (tests/e2e settings and credentials); sender, label and tracking rows are shown as unverified or blocked and must be re-labelled when T-044 lands.

### PR-9 — Actionable shipment queue and detail
- Status: Proposed (no individual decision record); built under CTX-2, CTX-11
- Owner: Paduka Ongki
- Source: CTX-2, CTX-11.
- Statement: When an authorized operator opens shipments, the system shall provide scoped search/filter/pagination and a detail workspace with the next valid action for the current state.
- Acceptance: Given draft, queued, unknown, unpaid, issued, and failed shipments, When their detail is opened, Then state-appropriate guidance and actions are available and forbidden transitions cannot execute through direct requests.
- Constraints: UX-1, DATA-2, TEN-1, IAM-1. Filter/view state does not broaden access.
- Evidence: Observed scoped queue/search/paging/detail and worker-reported shipping/auth-demo e2e. T-053 wires money/provider pending/duplicate-click guards, batch/key-removal confirmations and reconcile-only attempts; F2 fixes invalid-form submit locking and operator escalation text. Admin closes remain open (T-056). The former three-viewport Worker run in STATUS.md is historical; Decision (DEC-020, owner) requires final-container evidence, not reuse of that runtime result.

### PR-10 — Govern tenant membership
- Status: Accepted (DEC-007, DEC-008)
- Owner: Paduka Ongki
- Source: CTX-1, CTX-11.
- Statement: When a tenant administrator changes staff access, the system shall validate the permitted invitation, role, and deactivation action and preserve an administrable tenant.
- Acceptance: Given concurrent attempts to deactivate the final active administrators, When both are processed, Then at least one authorized administrator remains and duplicate submissions do not create duplicate membership side effects.
- Constraints: IAM-1, IAM-2, TEN-1. Identity provisioning (`auth.users`) is distinct from application membership; PR-31 specifies invitation acceptance. Resolved by DEC-007 and DEC-008: invitations are single-use, email-bound, 7-day and revocable; the inviter fixes the role; pilot memberships are tenant-wide and per-outlet assignment is deferred; a tenant always keeps one active administrator.
- Evidence: Observed: tests/db invitations (issuer check, last-admin guard, role re-check after lock) and tests/e2e members (ARCHITECTURE.md "Staff and roles"; task 014). TASKS T-028 lists this requirement as primary although it delivers the contact-archive guard (PR-2).
- Change history: 2026-10-28 — Open policy items closed by DEC-007 and DEC-008.

### PR-11 — Preview CSV intake before draft creation
- Status: Proposed; later candidate; Deferred (TASKS.md Deferred list, no task)
- Owner: Paduka Ongki
- Source: CTX-11.
- Statement: When a permitted user uploads a supported shipment CSV, the system shall show row-specific validation and destination ambiguity and create drafts only from explicitly selected valid preview rows.
- Acceptance: Given valid, invalid, ambiguous, expired, and tampered rows, When confirmed, Then only valid authorized rows create drafts exactly once; creating drafts does not issue provider orders.
- Constraints: TD-5, TEN-1, SEC-1. Existing row/byte/query limits are reference values, not silently accepted product limits.
- Evidence: Pending implementation verification; existing bulk test definitions were inspected, not executed.

### PR-12 — Update tracking from an authenticated provider source
- Status: Proposed; scheduled (DEC-014, T-045); signed webhook Deferred behind a public webhook URL
- Owner: Paduka Ongki
- Source: CTX-13; DEC-014.
- Statement: When a provider status is received through a signed webhook or pulled to cover a missed webhook, the system shall resolve the account-owned order and update its tenant-owned shipment only through a valid, idempotent transition; when an authorized user cancels an order, the system shall request the provider cancellation and record its outcome, including an unknown outcome, without retrying blindly.
- Acceptance: Given a valid update plus duplicate, stale, forged, and different-account variants, When processed, Then only the authorized transition changes the mapped shipment; arrival order alone cannot regress delivery state. Given a webhook whose HMAC over timestamp and body fails, whose body exceeds the size cap or whose timestamp is outside the replay window, Then it is refused without a state change. Given a cancel request with an unknown provider outcome, When the user returns, Then the shipment shows a reconcile state and no second cancel is sent until the original is reconciled (DEC-010); given a refused or already-final order, Then the shipment is not shown as cancelled.
- Constraints: TD-4, TEN-2, SEC-2, DATA-2, PR-36, DEC-010. The seller callback secret is held per tenant under the Partner model and never shown; the webhook is served from its own cookie-less host (CTX-41). Provider access and sanitized capture must be verified before enabling ingestion; how the callback secret interacts with key regeneration (PR-19) is Unknown until a sandbox capture.
- Evidence: Documentation only; no live webhook, tracking or cancel result was captured. Observed: /pengaturan shows tracking as not yet enabled (review static read 2026-10-28). Deferred gate in TASKS.md: a public webhook URL and the seller callback secret configured in Mengantar.
- Change history: 2026-10-28 — Webhook, status pull and order cancellation scoped to T-045 (DEC-014); per-tenant callback secret and webhook host added.

### PR-13 — Tenant identity and brand
- Status: Proposed (no individual decision record); built in part under CTX-2
- Owner: Paduka Ongki
- Source: CTX-2.
- Statement: When a user operates in an authorized workspace, the system shall show the current tenant/outlet identity and its approved application branding without changing provider routing authority.
- Acceptance: Given two tenants, When workspace scope changes, Then the visible brand and scoped data change together; old-tenant requests/results do not appear in the new workspace and provider-generated labels retain authoritative routing information.
- Constraints: UI-1, TEN-1. Custom logos on official labels, custom domains, and a branded customer receipt require separate decisions; the gerai identity on the printed label is governed by PR-34.
- Evidence: Observed: the workspace shows the current gerai and outlet names (tests/e2e auth-demo); there is no logo or branding setting. TASKS T-029 lists this requirement for the public marketing pages, which belong to PR-35.

### PR-14 — Daily operational overview
- Status: Proposed; first form built as the gerai Dashboard (T-078, UX-16); the parity and stale-data acceptance remain open
- Owner: Paduka Ongki
- Source: CTX-11.
- Statement: When a permitted user opens the overview, the system shall distinguish work requiring action now from period-based shipment activity and show the data timestamp.
- Acceptance: Given a period crossing local midnight and a stale result, When overview and shipment filters are compared, Then they use the same selected timezone and event basis, show the same scoped count, and present a refresh path without claiming stale data is current.
- Constraints: UX-1, TD-6, TEN-1. Financial revenue, net margin, and COD-settlement metrics remain outside this contract until their policies are accepted.
- Evidence: Observed: the gerai Dashboard at `/` (T-078, UX-16) shows attention, today's counts, trends, status split and courier ranking in WIB; the overview-versus-filter parity and stale-data refresh acceptance are not yet proven.

### PR-15 — Tenant lifecycle administration
- Status: Proposed (manual review during the pilot chosen by DEC-007); built under CTX-29, CTX-30
- Owner: Paduka Ongki
- Source: CTX-11, CTX-29, CTX-30.
- Statement: When a permitted Super Admin opens tenant administration, the system shall provide a scoped business directory/detail and readiness state; each configured review/lifecycle decision shall require current authority, a reason, guarded transition and audit with its enforced effect on new queued work.
- Acceptance: Given a suspended tenant with a queued provider operation, When that operation is claimed, Then it cannot issue a new order; tenant administrators cannot perform the platform action by calling its backend directly.
- Constraints: IAM-2, TEN-1, TEN-2, DATA-7. Initial activation requires an approved application/current policy outcome; lifecycle administration cannot bypass pending/rejected/withdrawn review. Later reactivation preserves valid initial approval. Suspension must not discard the authoritative outcome of an already-submitted operation or make necessary recovery impossible.
- Evidence: Observed: tenant directory, suspend/reactivate with reason and application review (tests/db platform and registration, tests/e2e platform; tasks 012, 013).

### PR-16 — Safe operational export
- Status: Proposed; later candidate; CSV export and invoice snapshots built in T-047 (DEC-014); wilayah reference deferred
- Owner: Paduka Ongki
- Source: CTX-11.
- Statement: When a permitted user requests an operational export, the system shall apply the same scope and accepted filters as its corresponding list and encode cells safely for spreadsheets.
- Acceptance: Given tenant A filters and a formula-prefixed text value, When exported, Then tenant B rows are absent, the chosen event/date basis is preserved, and the value cannot execute as a spreadsheet formula.
- Constraints: TD-5, PRIV-1, TEN-1. Contact/PII export permissions and retention remain unresolved; no public download URL. T-047 sets the first form: tenant-admin only, a row cap and a formula-injection guard. An immutable invoice snapshot and a combined "Cetak resi + invoice" print are also listed in T-047 without a requirement of their own; receipt and invoice content remains an owner decision.
- Evidence: Observed (2026-10-28): `/pengiriman/export.csv` is tenant-admin only through the user's own session and RLS, capped at 10000 rows with `X-Export-*` headers, 15 sender-facing columns, a formula-injection guard, BOM, `no-store`, and audited by `record_export` before any byte is sent; `invoice_snapshots` are append-only with a `<PREFIX>-INV-<yymmdd>-<seq>` counter (T-047; tests/unit csv, tests/db invoice-export, tests/e2e invoice-export on 390, 768 and 1280). Not met: the wilayah reference is not imported (deferred, owner decision); the date basis is creation time; invoice content and retention are owner decisions.

### PR-17 — Partner-created tenant seller onboarding
- Status: Accepted (DEC-006); sandbox built, binding defect closed in the working tree (T-032, T-034); production onboarding not enabled
- Owner: Paduka Ongki
- Source: CTX-16, CTX-17, CTX-9.
- Statement: When an authorized tenant administrator confirms new seller onboarding with required agreement and valid owner details, the system shall register the mapped tenant business using a backend-owned stable externalUserId and durably bind the returned seller and encrypted key.
- Acceptance: Given concurrent confirmations, timeout after creation, a 503 key-provisioning failure, or an exhausted daily quota, When onboarding resumes, Then the same external ID resolves one seller and truthful pending/recovery state; a null/disabled key never becomes ready. Saving a contact or adding staff does not register a seller.
- Constraints: PR-20, PR-30, TD-7, DATA-4, TEN-3, NFR-5; registration is separate from shipping/label readiness and must not act as a profile update.
- Evidence: Historical local/sandbox checks cover Partner signing, registration, stable repeat, provisioning recovery, BYOK routing and machine-attested seller binding (T-032; TASKS/BUILD-LOG). The server-side verification logic remains in `src/lib/mengantar/partner-onboarding.ts`, now on Node under DEC-020; the old Worker tests are not container evidence. Expected-version completion remains T-034; pre-T-032 bindings still need verification and Partner retry-window enforcement remains T-054. Production onboarding is not enabled by this runtime change.

### PR-18 — Connect an existing Mengantar account
- Status: Accepted (DEC-006)
- Owner: Paduka Ongki
- Source: CTX-16, CTX-17.
- Statement: When an authorized tenant administrator chooses an existing account or registration returns EMAIL_ALREADY_REGISTERED, the system shall offer protected BYOK connection with validated account authority and independent capability checks.
- Acceptance: Given an existing-email refusal, When the user connects their own key, Then no account is recreated or claimed as partner-owned, the key is stored privately without readback, and other tenants cannot use it or invoke Partner retrieval/rotation for it.
- Constraints: DATA-3, DATA-4, TEN-3, IAM-3, SEC-3. A copied key alone does not prove tenant ownership; select and verify the binding policy before enablement.
- Evidence: Historical tests cover sealed BYOK storage with no plaintext readback and operator/foreign-tenant denial (task 015, T-027). T-032's seller-binding and list-before-key boundary is server-side, not a Worker hosting requirement; it is retained under DEC-020. Pre-T-032 bindings and provider key-ownership verification remain unproved; no new container or provider check is claimed here.

### PR-19 — Recover and rotate seller credentials safely
- Status: Accepted (DEC-013, scheduled); built locally (T-039); live regeneration not performed
- Owner: Paduka Ongki
- Source: CTX-17.
- Statement: When a permitted administrator recovers or rotates a managed seller key, the system shall coordinate against that seller, journal the operation, persist encrypted key/callback changes, and fence new dispatch until credential state is known.
- Acceptance: Given rotation during queued/in-flight work or a lost response, When recovery runs, Then no second order or blind second rotation occurs, current-key retrieval is bounded/audited, and webhook readiness remains blocked if its new callback secret is unknown; provider-disabled keys are not reactivated.
- Constraints: TD-8, DATA-4, IAM-3, SEC-3, TEN-2, DEC-013. Uses Partner sellers/api-key and sellers/api-key/regenerate with an expected-version fence (T-039). BYOK rotation occurs in Mengantar followed by protected local replacement; Partner key retrieval does not return callbackSecret (vendor documentation); a stop state (API_KEY_DISABLED, SELLER_DEACTIVATED) is never reactivated. The application server ignores callbackSecret in T-039 while the per-tenant webhook secret is handled under PR-12, so how a regenerated key and the callback secret interact is Unknown until captured.
- Evidence: Observed (2026-10-28, local): fetch and regenerate with the expected-version fence; the fence supersedes the active Partner key before the regenerate call; a lost response becomes `rotation_unknown` and recovery uses `sellers/api-key` (get) without a second regenerate; `API_KEY_DISABLED` and `SELLER_DEACTIVATED` set `provider_restricted` with no retry; BYOK is never touched; `callbackSecret` is ignored; audit `credential.partner_regenerated`, `credential.partner_recovered`, `credential.partner_rotation_unknown` and `credential.partner_rotation_refused` (tests/unit partner-key-rotation, tests/db partner-key-rotation, tests/e2e credentials on 390 and 1280, no provider call). Not met: no supervised sandbox regeneration (T-048), so the regenerate response shape and the key and callback interaction stay Unknown; operators see no paused-key panel; a 429 `Retry-After` before the fence is not stored (T-054).
- Change history: 2026-10-28 — Scheduled by DEC-013; task T-039 added; built locally the same day, live call owner-gated.

### PR-20 — Account-owner disclosure, agreement, and seller access
- Status: Accepted (DEC-006); built locally (T-034); production document gate open
- Owner: Paduka Ongki
- Source: CTX-17.
- Statement: Before new seller creation, the system shall explain the account and COD ownership relationship, capture affirmative agreement to the applicable Mengantar Terms and Privacy documents, and show the registered owner how to access Mengantar through Lupa Password.
- Acceptance: Given absent agreement, an email that fails the selected owner-confirmation/verification policy or is a known placeholder, or unavailable provider-policy documents, When registration is attempted, Then no seller is created; accepted onboarding records actor, tenant, owner, document versions, and time without requesting a Mengantar password or promising unverified payouts.
- Constraints: PRIV-2, DATA-4, UX-2; exact provider policy URLs/versions and retention must be selected before enablement.
- Evidence: Observed (2026-10-28): the consent step shows the Terms and Privacy links and records document versions held by the server from the bindings `PARTNER_TERMS_VERSION`, `PARTNER_PRIVACY_VERSION`, `PARTNER_TERMS_URL` and `PARTNER_PRIVACY_URL`; a version posted by the browser is ignored; with a binding unset onboarding returns `configuration_blocked` before any Partner call and the submit button is disabled (T-034; tests/unit mengantar-partner-onboarding, tests/db partner-onboarding, tests/e2e credentials). Open: the real policy URLs and version labels are owner-held; no legal-compliance conclusion or real consent was captured.

### PR-21 — Demo login in the initial delivery
- Status: Proposed (explicit user request CTX-21); built
- Owner: Paduka Ongki
- Source: CTX-21.
- Statement: When the first usable application preview is delivered, the system shall provide a ready-to-use demo account and a discoverable login entry with a seeded demo tenant, outlet, sender/recipient contacts, and example shipments.
- Acceptance: Given the documented demo access, When a reviewer logs in without creating a real business account, Then they can explore the queue, reuse example contacts, and complete a simulated draft → estimate → confirmation → sample-label flow; demo requests cannot access real tenant data, register a Mengantar seller, invoke live shipping/payment, change provider credentials, or invite staff.
- Constraints: IAM-4, UX-3, TEN-1, NFR-4. Demo prices/statuses and sample labels must be visibly identified as examples; demo activity is excluded from real operational metrics. Supply working access instructions with the preview, without putting actual passwords or provider keys in this specification.
- Evidence: Existing local demo evidence covers isolated synthetic tenants, seeded contacts/shipments and demo-only identity (tasks 003, 009, 010, 011, 018). The old synthetic Worker preview in RELEASE.md is historical; retirement/secret rotation remain owner-gated. Observed merged source: database demo quotas/cleanup in `20261028180000_demo_quotas_and_cleanup.sql`, hourly Node scheduler cleanup in `src/lib/mengantar/scheduled.ts`, and `tests/unit/cron.test.ts` replacing the old entry-point test. The database pg_cron path is conditional on extension availability. This is source evidence, not proof of remote cleanup or final-container journeys; demo credentials stay out of this specification.

### PR-22 — Authoritative prices and private cost separation
- Status: Accepted (DEC-003); amended 2026-10-28 (DEC-016, CTX-42)
- Owner: Paduka Ongki
- Source: CTX-24, CTX-25, CTX-26, CTX-27, CTX-28, CTX-39, CTX-42; DEC-003, DEC-016.
- Statement: When a supported service is reviewed or confirmed, the system shall charge the sender the full verified normal Mengantar tariff before any seller or gerai discount, retain the separately verified provider cost privately, include applicable COD fee/insurance once according to the actual contract, preserve role-projected confirmed price facts, keep an unknown provider value unknown rather than zero, and collect no platform fee from the gerai.
- Acceptance: Given the same normal tariff with two different gerai discount assignments, When quoted, confirmed and reprinted, Then the sender's normal shipping amount remains the same while the gerai-facing cost estimate follows each assigned discount and the private provider cost follows the provider estimate; COD Ongkir also uses the normal basis. Fee-inclusive/exclusive and optional/required insurance cases count each applicable charge once; an absent provider discount, fee or insurance value is stored and displayed as unknown, never as zero; stale/tampered/missing-authority cases preserve the draft or reconcile the original submitted order, and operator payloads/label output do not expose private net cost or discount.
- Constraints: TD-9, DATA-5, IAM-5, UX-5, PR-4, PR-5, PR-7, PR-23, NFR-3, DEC-016. Historical 333-bps/VAT/discount assumptions, free app access and new gerai markup are not accepted current policy; actual fee/discount/insurance activation and customer-goods obligations require proof. Insurance and goods-value rules stay Deferred (DEC-013) and are not inferred. No percentage appears on public pages until provider-verified (PR-35).
- Evidence: Observed normal tariff plus once-only COD fee and two-pass estimation, with net cost private. T-041's quote-time terms lookup returns NULL for unknown cost; T-053 records nullable provider-discount bps and renders "Biaya gerai (estimasi)" only to tenant admins on non-demo real shipment detail, with assigned terms in settings, never private cost/discount on operator, label, invoice or CSV surfaces. Worker-reported tests: discount-recording/gerai-discount DB, public-api/pricing-display unit, gerai-discount/shipping e2e. Insurance remains unbuilt; provider verification is not inferred from local UI.
- Change history: 2026-10-28 — Amended per DEC-016: sender pays the full normal tariff, the gerai discount is configuration under PR-23, no platform fee, unknown stays unknown.

### PR-23 — Assigned seller discounts and verified upstream cost
- Status: Accepted (DEC-003, DEC-012, DEC-016; rounding DEC-018); terms, provider-percentage recording and tenant/admin UI built locally (T-041, T-053); provider terms and environment-scoped assignments remain unverified
- Owner: Paduka Ongki
- Source: CTX-27, CTX-28, CTX-39, CTX-42; DEC-012, DEC-016.
- Statement: When an authorized Super Admin assigns a gerai discount to a tenant (per seller; each tenant has its own Mengantar seller account, so each has its own assignment), the system shall store it as configuration in integer basis points with an effective date, a source reference, a status (owner-stated, provider-observed or provider-verified) and an audit record naming the actor; derive the platform remainder as the provider discount minus the gerai discount without ever accepting it as typed input; record the provider discountPercent observed in each estimate; show the Super Admin the variance between the assigned and the provider-observed discount; refuse a gerai discount above the provider-observed discount; derive every rupiah amount from basis points with integer arithmetic and the discount rounded down; and keep the sender's price at the normal tariff.
- Acceptance: Given the owner-stated starting terms (provider 3000, gerai 2000 basis points), When saved, Then the remainder is derived as 1000, shown as an estimate, and the status stays owner-stated until the provider terms are verified; given a gerai discount above the observed provider discount, Then the database refuses it and a test proves it; given an estimate without a discount value, Then the observed value is stored as unknown, not zero; given a changed or expired assignment, Then historical prices are not overwritten and a quote after the effective date uses the applicable version or shows a hold; a local edit cannot alter a Mengantar bill, grant cross-tenant access or let an operator or tenant administrator set a discount.
- Constraints: PR-22, TD-9, DATA-5, IAM-6, TEN-1, DEC-012, DEC-016. No constant in code and no historical number as a default (DEC-003, DEC-012). The reviewed Partner routes manage no discount rate, so a local value cannot change the provider's debit; no platform fee is collected and no platform ledger exists in the first release. When no observed provider discount exists, whether a gerai discount may apply is Unknown; Proposal: hold it as pending rather than apply it. Decision (owner-delegated default, DEC-018, 2026-10-28): the discount is assigned per tenant by the Super Admin; the assigned value is the cost basis shown to the gerai and the amount the Super Admin is accountable for, while Mengantar's actual debit follows the seller account's own rate (the quote's `estimatedSpecialPrice` basis, BILL-3); the variance between assigned and provider-observed discount is shown to the Super Admin and is neither collected nor subsidized; with no platform fee and no collection path the platform earns nothing from the discount in the first release; the remainder is 0 or Unknown until Mengantar answers (T-048). Decision (DEC-018): rupiah amounts derived from basis points use integer arithmetic and round the discount amount down to whole rupiah, so the derived gerai cost never understates the provider-observed cost; an unknown input yields NULL, never 0 (test vector in DATA-9). The written Mengantar answers listed under the open decisions are required before any value is provider-verified.
- Evidence: Decision DEC-016 and source facts in CTX-42 remain unverified commercial terms. Observed local terms/ceiling/quote-time versioning and `/admin/diskon` screens (T-041); T-053 migration `20261028240000_discount_recording_and_ui.sql` records valid `discountPercent` as nullable integer bps, distinguishes absent/invalid from zero, ignores `discountExtraPercent` and prefers provider bps over the amount-derived ceil observation. Latest real-batch maximum caps assignments; per-quote effective discount is least(assigned, observed); the cost/settings views are tenant-admin-only. Worker-reported discount-recording/gerai-discount DB, parser unit and gerai-discount e2e cover those paths. Terms themselves have no `provider_env` (T-050 did not add it); written Mengantar verification and actual activation remain T-048.
- Change history: 2026-10-28 — Amended per DEC-016 and CTX-42: basis-point configuration with effective date, source and status; derived remainder; block above the provider-observed discount; observed percentage recorded per estimate; no platform fee in the first release.
- Change history: 2026-10-28 — Owner-delegated defaults (DEC-018): per-tenant assignment, variance panel, discount meaning (BILL-3) and the round-down rule decided; the rounding Unknown is closed.

### PR-24 — Restricted Super Admin access and governance
- Status: Accepted (DEC-008 bootstrap and recovery); built
- Owner: Paduka Ongki
- Source: CTX-29, CTX-30.
- Statement: When a user enters a platform workspace or invokes its command, the system shall require an active server-owned platform grant, the relevant capability and verified second-factor session, with governed platform-role provisioning/revocation.
- Acceptance: Given anonymous, tenant, demo, self-promoted metadata, revoked-platform and incomplete-factor sessions, When platform routes or direct Data API/RPC commands are invoked, Then protected access is denied; a permitted current principal succeeds, and concurrent final-admin removal cannot leave the platform unadministrable.
- Constraints: IAM-7, TEN-4, SEC-4, NFR-1, PR-36. Bootstrap per DEC-008 and DEC-021 (ADR-0002): the owner's verified identity with application-owned TOTP (`aal2`, `src/lib/auth/totp.ts` and `auth.sessions`; formerly Supabase TOTP) plus one second recovery administrator; no public promotion path, no public Super Admin signup or shared production demo role. The production bootstrap is a remote write the owner has not yet run; the workspace is served only from the owner host (DEC-015).
- Evidence: Observed: platform grants, an `aal2` check on every call (`private.platform_capable`), tenant directory, grant governance with a final-governor guard, append-only audit, and app-owned TOTP enrollment/verification with sealed secrets and step-replay guard (`tests/db/auth-core.test.ts`, `tests/db/platform.test.ts`, `tests/e2e/platform.spec.ts`; task 012, T-065, T-066). T-067 security review and T-054 TOTP recency remain open.

### PR-25 — Actionable platform health and usage
- Status: Proposed; Not implemented, no task and no deferral entry
- Owner: Paduka Ongki
- Source: CTX-29, CTX-30.
- Statement: When an authorized Super Admin opens platform monitoring, the system shall show correctly scoped current exceptions, period-based usage and provider readiness with explicit definitions, time basis and freshness.
- Acceptance: Given two tenants, a WIB period boundary, pending/unknown/unpaid/label failures and stale/partial data, When filters and detail are opened, Then the displayed counts share their named basis, all affected scopes remain visible and no stale/failed response is presented as a healthy zero or private customer payload.
- Constraints: TD-10, DATA-6, TEN-4, UX-6, UI-4. Thresholds/SLAs and financial metrics are not inherited or invented.
- Evidence: Reference monitoring source reviewed; target query/browser checks pending. ARCHITECTURE.md lists it as not implemented; TASKS.md has no task or deferral for it.

### PR-26 — Safe platform integration and seller readiness
- Status: Proposed (no individual decision record); built in part
- Owner: Paduka Ongki
- Source: CTX-17, CTX-18, CTX-29, CTX-30.
- Statement: When a permitted Super Admin inspects integrations or a tenant seller, the system shall distinguish application lifecycle, connection mode, durable onboarding, provider restriction, current capabilities and platform configuration readiness without exposing secret values.
- Acceptance: Given managed/BYOK, partial registration, disabled key, missing label/insurance/webhook permission, quota wait or egress failure, When reviewed, Then the correct safe status and scoped next action appears without creating another seller, granting a nonexistent capability or claiming a local setting changed Mengantar billing/access.
- Constraints: PR-17 through PR-20, PR-23, TD-7, TD-8, ARCH-2, IAM-7, TEN-4. Credential actions require their separate existing permission/confirmation; no arbitrary API console.
- Evidence: Observed: /admin/integrasi shows Partner and BYOK modes, Partner Secret readiness and seller bindings (tests/db credentials, e2e credentials; task 015, T-031). Gap: the audited Partner ID setting is not read by onboarding, and the readiness badge checks a different secret name than the one that signs (review finding SUP-12).

### PR-27 — Controlled operational reconciliation
- Status: Proposed; Not implemented, no task and no deferral entry
- Owner: Paduka Ongki
- Source: CTX-29, CTX-30.
- Statement: When an authorized Super Admin investigates an operational exception, the system shall expose its safe durable timeline and permit only eligible scoped reconciliation or resumption of the original recorded operation.
- Acceptance: Given duplicate recovery, stale authority, suspended tenant, unknown provider outcome and an already-paid/issued order, When recovery is requested, Then one guarded recovery records a truthful result or reasoned denial; it cannot issue/pay again, switch funding accounts, overwrite confirmed prices or discard an in-flight outcome.
- Constraints: TD-3, TD-8, TD-10, TEN-2, TEN-4, IAM-7. Viewing an exception grants no new spending/withdrawal or tenant impersonation authority.
- Evidence: Recovery patterns inspected; target failure-injection checks pending. Observed: only tenant-administrator reconciliation exists (ARCHITECTURE.md "Not implemented"); TASKS.md has no task or deferral for the Super Admin form.

### PR-28 — Platform audit and decision history
- Status: Proposed (no individual decision record); built
- Owner: Paduka Ongki
- Source: CTX-29, CTX-30.
- Statement: When a platform decision or sensitive investigation/recovery occurs, the system shall record an append-only, access-controlled event with actor, target scope, action, reason/outcome, relevant versions and correlation, and expose filtered history to authorized Super Admins.
- Acceptance: Tenant/review/discount/access/recovery decisions appear once with their actual outcome; event modification/deletion and unauthorized direct reads are denied, and canary credentials/customer payloads never enter the audit output. A pending external effect is not labelled completed merely because a request was accepted.
- Constraints: DATA-6, IAM-7, TEN-4, SEC-4, PRIV-1. Audit retention/export and support PII-access policy remain owner decisions.
- Evidence: Observed: append-only audit_events with a filtered projection; update, delete and truncate are refused (tests/db platform, e2e platform; task 012). Audit retention/export remains an owner decision.

### PR-29 — Verified application registration
- Status: Accepted (DEC-007); built locally, production mail gated
- Owner: Paduka Ongki
- Source: CTX-31, CTX-33, CTX-34.
- Statement: When a person registers, the system shall verify inbox control through the application-owned authentication module (DEC-021, ADR-0002; formerly Supabase Auth) before granting application setup authority, distinguish new and returning identities, and keep credentials, application agreement and provider agreement separate.
- Acceptance: Given a new, existing, unverified, mistyped or attacker-submitted email, When registration or verification is attempted, Then generic public feedback preserves account privacy, invalid/expired codes grant nothing, and only the verified person can complete their own account without inheriting an attacker-chosen password or role.
- Constraints: IAM-8, SEC-5, PRIV-3, UX-7, PR-33. Email-first OTP with the password set after inbox control is selected by DEC-007; DEC-021 (ADR-0002) implements this in `src/lib/auth/**` and `db/migrations/20261029100000_auth_core.sql`.
- Evidence: Observed `/daftar` code request/verification (`requestEmailCode`, `verifyEmailCode`), password-after-proof (`setPassword`, plus the `discard_pre_verification_password` trigger), generic replies, app-verified Turnstile on both code request and code verification (`src/lib/auth/service.ts:173-222`), and visitor/account-plus-visitor limits. T-051 adds resend/change-email; F1 scopes old-code errors to their email. Verify-email address remains client-held form state without a server-signed binding (T-058); production mail remains gated by T-063 and T-067 review is open.
- Change history: 2026-10-13 — Added in the registration and documentation-completeness review.
- Change history: 2026-10-28 — Email-first UX confirmed by DEC-007; evidence updated.
- Change history: 2026-10-29 — Amended for DEC-021 (ADR-0002, T-065/T-066): application-owned auth replaces Supabase Auth, and Turnstile is verified before both OTP request and OTP verification.

### PR-30 — Resumable gerai application and activation
- Status: Accepted (DEC-007); built
- Owner: Paduka Ongki
- Source: CTX-31, CTX-32, CTX-34.
- Statement: When a verified applicant submits a gerai application, the system shall create or resume its tenant, initial outlet and administrator binding once, expose the current review/setup state, and apply the selected activation policy before seller connection or operational effects.
- Acceptance: Given duplicate submission, interrupted persistence, an existing application, requested corrections or concurrent review, When resumed, Then one versioned result and membership are preserved, stale decisions conflict safely, pending/rejected applicants see only their allowed status, and no Mengantar account or order is created by approval.
- Constraints: PR-15, PR-17, TD-11, DATA-7, TEN-5, IAM-8, UX-7. DEC-007 selects manual Super Admin approval during the pilot and a separate application and review for each additional business started by the same identity; automatic activation after the pilot remains a Proposal. Decision (2026-10-28, PR-34): approval initializes the tenant-level field `contact_whatsapp` from the application's business contact phone; normalization, backfill and editing authority are specified in PR-34.
- Evidence: Observed: one open application per identity, revisioned drafts, approve/request changes/reject with a reason, and approval creates one active tenant, outlet and administrator membership and no seller (tests/db registration, e2e registration; task 013).
- Change history: 2026-10-13 — Added in the registration and documentation-completeness review.
- Change history: 2026-10-28 — Manual review and additional-business rules fixed by DEC-007.
- Change history: 2026-10-28 — Approval initializes the tenant's `contact_whatsapp` from the business contact phone (PR-34).

### PR-31 — Explicit staff invitation acceptance
- Status: Accepted (DEC-007, DEC-008); built
- Owner: Paduka Ongki
- Source: CTX-31, CTX-34; PR-10.
- Statement: When an authorized administrator invites staff, the system shall keep a pending tenant/role/outlet-scoped invitation until the intended verified identity explicitly accepts a current invitation, independently of Auth user creation or email delivery.
- Acceptance: Given a new or existing user, wrong email, expired/revoked invite, changed issuer authority or concurrent acceptance, When the invitation is used, Then only the intended active scope is granted once, rejected attempts disclose no foreign business data, and no extra tenant or seller is provisioned.
- Constraints: IAM-2, IAM-8, DATA-7, TEN-5, SEC-5, UX-8. DEC-007 fixes the lifetime at 7 days, single-use and bound to the invited email, with the role fixed by the inviter; DEC-008 makes pilot memberships tenant-wide.
- Evidence: Observed: tests/db invitations (wrong email, expired, revoked, concurrent accept, issuer no longer an administrator) and tests/e2e members (tasks 009, 014). Invitation mail is not sent by the app yet: the administrator shares the sign-in link and the invitee verifies by code (ARCHITECTURE.md "Not implemented").
- Change history: 2026-10-13 — Added in the registration and documentation-completeness review.
- Change history: 2026-10-28 — Invite lifetime, roles and outlet scope closed by DEC-007 and DEC-008.

### PR-32 — Account recovery and correct post-login destination
- Status: Accepted (DEC-007 routing; DEC-013 password recovery scheduled with the production mail gate)
- Owner: Paduka Ongki
- Source: CTX-31, CTX-33, CTX-34.
- Statement: When authentication completes or a user recovers access, the system shall route from current verified identity, own onboarding and memberships to the next permitted action, preserving tenant/provider history and keeping GeraiExpress password recovery separate from Mengantar access.
- Acceptance: Given no membership, multiple memberships, pending review, suspension, a different logged-in account or password recovery, When the user continues, Then the correct scoped chooser/status/workspace is shown, session expiry can resume safely, and no verification, email change or password reset creates platform authority or changes seller ownership.
- Constraints: IAM-8, TEN-5, SEC-5, UX-8, PR-20, PR-24, DEC-013. Owner transfer and factor recovery require their own accepted policy (open). GeraiExpress password recovery is scheduled with the production mail gate and has no task yet.
- Evidence: Observed: post-login routing by session, membership and application state, and the gerai chooser (tests/e2e registration and members; tasks 003, 013; T-029 touches only the signed-in `/` routing). Not built: GeraiExpress password recovery (ARCHITECTURE.md "Not implemented"); no task owns it.
- Change history: 2026-10-13 — Added in the registration and documentation-completeness review.
- Change history: 2026-10-28 — Password recovery scheduled by DEC-013.

### PR-33 — Reliable in-stack authentication email
- Status: Accepted (DEC-009); Send Email Hook mechanism superseded by DEC-021 (ADR-0002, T-066)
- Owner: Engineering owner
- Source: CTX-35; DEC-009, DEC-020, DEC-021; `src/lib/auth-mail.ts`, `src/lib/mail-transport.ts`, `db/migrations/20261029100000_auth_core.sql`.
- Statement: Before public real-account registration, the system shall deliver authentication email directly from the application server through a verified transport after SQL has enforced the registration gate and refused anonymous identities, with safe resend/verification controls and truthful delivery failure recovery, and shall not treat sending acceptance as inbox verification.
- Acceptance: Given configured test and release environments, When signup code, recovery and supported account-change messages are exercised, Then controlled inboxes receive the expected messages, wrong/expired credentials remain denied, an anonymous identity or closed-registration uninvited address creates no code and sends nothing, suppression/outage/quotas have safe recovery, and mail/Auth secrets never appear in browser, logs or saved specification.
- Constraints: ARCH-3, SEC-5, PRIV-3, UX-7, UX-8, DEC-009, DEC-020, DEC-021. History: DEC-009 originally replaced native custom SMTP with a Worker-served Supabase Send Email Hook; DEC-021 (ADR-0002, T-066) removes Supabase and the Send Email Hook route (`/api/auth/send-email` and `SEND_EMAIL_HOOK_SECRET`), moves the signup gate and anonymous-identity refusal into `public.auth_issue_otp`, renders Bahasa Indonesia 6-digit code mail in `src/lib/auth-mail.ts` (`renderCodeMail`), and delivers through `src/lib/mail-transport.ts` (Mailpit locally; production fails closed until the owner selects a provider and sending domain in T-063).
- Evidence: Observed: `auth_issue_otp` gate and anonymous refusal (`tests/db/auth-core.test.ts`), Bahasa Indonesia code mail (`tests/unit/auth-mail.test.ts`), local Mailpit transport (`src/lib/mail-transport.ts`) and browser registration/invitation flows (`tests/e2e/registration.spec.ts`, `members.spec.ts`; T-065, T-066); production transport fails closed (`MailNotConfigured`, logged as `auth_mail_failed`) and real delivery is unproven (T-063).
- Change history: 2026-10-13 — Added in the registration and documentation-completeness review.
- Change history: 2026-10-28 — Native custom SMTP candidate superseded by DEC-009 (Worker Send Email Hook), placed on the hooks host by DEC-018.
- Change history: 2026-10-29 — Amended for DEC-021 (ADR-0002, T-066): Send Email Hook removed; SQL `auth_issue_otp` gates issuance and the app sends code mail directly through `src/lib/mail-transport.ts`.

### PR-34 — Sender masking switch and local label content
- Status: Accepted (DEC-017; misuse policy DEC-018); local label and masking admin control built (T-044, T-053); courier acceptance, activation statement and full viewport evidence open
- Owner: Paduka Ongki
- Source: CTX-39, DEC-017; the legacy product's requirement 71 and decisions D-14 and D-30 as recorded in CTX-39.
- Statement: When an operator prints the label of a shipment that has an authoritative AWB, the system shall offer the switch "Gunakan masking pengirim": with it off, the label shows the gerai's own name, WhatsApp number and pickup address as the sender; with it on, the label shows the shipment's sender name, phone, optional street and area, pre-filled from the shipment and confirmed or edited by the operator (DEC-025); in both cases the Mengantar pickup name shall not be printed as the sender by default and no provider dropshipper mapping shall be submitted.
- Parcel branding decision (owner, 2026-11-05, "label paket juga dong", T-096): both masked and unmasked parcel labels show the gerai logo as a size-bounded image when present, with the gerai name as a legible fallback, separately from the printed sender fields. Masking still excludes the gerai WhatsApp/contact, including contact links, and does not change the operator-confirmed sender name, phone, street or area. The logo/name must not obscure sender, recipient or barcode content. Individual and batch previews, first prints and reprints follow the same rule for both 10x15 and 10x10 parcel formats. The first snapshot freezes the logo bytes/version (or removal revision) and the gerai name; replacing/removing a logo or renaming the gerai never changes an existing snapshot. This decision concerns parcel branding only: public tracking privacy is unchanged, and the separate 10x5 slip remains T-095 scope.
- Acceptance: Given a real shipment with the switch off, When the label is rendered, Then it shows the gerai name, WhatsApp number and pickup address and does not show the Mengantar pickup name as the sender; given the switch on with a sender name, phone, area and optional street confirmed, Then the label shows exactly those sender fields within their limits (DEC-025) and not the gerai pickup address as the sender; given either setting, Then the barcode decodes to the AWB, the size is 10x15 cm by default with a 10x10 cm option, the real pickup address stays visible on the shipment detail for returns, the printed content is stored as an immutable snapshot with an append-only print history, and no provider dropshipper or provider label request is made; given a tenant administrator, When they edit the gerai WhatsApp number in settings, Then a valid number is saved through the audited command and an invalid one is refused with a Bahasa message; given an operator or a direct browser write of the column, Then the change is refused; given an empty gerai WhatsApp number, When the operator prints with the switch off, Then printing is blocked with a prompt to a tenant administrator and no blank label is produced; browser and print-preview checks pass at 390, 768 and 1280 px.
- Constraints: PR-3, PR-6, PR-7, PR-22, PR-30, TD-4, PRIV-1, NFR-3, NFR-4, DEC-017. Recipient name, phone and address, courier and service, weight and the COD collection instruction are printed because the courier and recipient need them: this content beyond the sender fields is a Proposal to confirm against the legacy label and a pilot scan. Decision (owner-delegated default, DEC-018): with the switch on, printing requires all three operator-entered sender fields. The label shows no private net cost or discount (PR-22). Decision (owner-selected "like the legacy project", 2026-10-28; source and editing authority): the gerai WhatsApp number is a tenant-level field `contact_whatsapp`, initialized at approval from the application's business contact phone (PR-30) and editable only by a tenant administrator through an audited command, never by the browser writing the column directly; the gerai name comes from the tenant and the pickup address from the outlet; if the field is empty the masked label print is blocked with a prompt to a tenant administrator and is never printed blank; demo tenants use a clearly synthetic number. Proposal (until the migration task is accepted): the value is stored in the canonical form `0` plus the Indonesian national number, so a leading `+62` or `62` becomes `0`, and validated against `^0[2-9][0-9]{7,11}$`; existing approved tenants are backfilled from their application when it validates and otherwise stay empty. Observed (2026-10-28): the legacy project captures the gerai WhatsApp at registration into a tenant-level field and lets only the tenant administrator edit it in settings through a dedicated audited function; in this repository the application already stores `contact_phone` (`supabase/migrations/20261014130000_registration.sql`), approval copies only name, pickup address and pickup area to the outlet, and neither `tenants` nor `outlets` has a WhatsApp column. Unknown: whether couriers accept the locally printed label. The true sender and the pickup stay stored with every shipment.
- Misuse policy (Decision, owner-delegated default, DEC-018, 2026-10-28; the tenant-level flag, the screens and the data fields are Proposal mechanics; wording of the accepted statement belongs to counsel, T-048): masking is a per-shipment choice and is off by default; with it on, the operator must enter all three sender fields; the label snapshot stores the true tenant identity and the pickup identity next to the printed sender and keeps them for the audit retention period (DATA-10; the period itself is Unknown, T-048); the real pickup address always stays visible in the shipment detail; at activation the tenant administrator accepts a statement that the tenant is responsible for the accuracy of the sender data and of the goods shipped; the Super Admin can disable masking for a single tenant through a tenant-level flag (default: allowed) and can suspend the tenant (Super Admin workspace, UX-12); a Mengantar or courier notice about a masked parcel is a trigger for platform review. Acceptance of the policy: given a tenant with masking disabled, When an operator opens the label, Then the switch is shown disabled with a Bahasa reason, the label shows the gerai identity and no masked snapshot can be written (a direct RPC call is refused); given masking on with any of the three fields empty, Then printing is refused; given any masked snapshot, Then it holds the true tenant and pickup identity beside the printed sender.
- Evidence: Observed T-044 local switch, contact WhatsApp command, immutable true-identity/printed-content snapshots and print history; T-053 adds `/admin/tenant/[id]` with `platform_tenant_masking`, reasoned confirmation and `platform_set_masking_allowed` under `tenant_governance` plus `aal2`. Worker-reported masked-label/discount-recording DB and label/masking-admin e2e cover authorization and disable/re-allow behavior. F2 fixes invalid-reason submit locking. Not built/proved: activation responsibility acceptance (counsel wording), courier acceptance (T-048), physical printing.
- Change history: 2026-11-05 — Owner confirmed gerai logo/name branding on masked parcel labels too ("label paket juga dong", T-096); gerai WhatsApp/contact stays excluded while the masked sender fields and frozen reprint identity remain unchanged. Supersedes the interim implementation that suppressed all masked parcel branding.
- Change history: 2026-10-28 — Added per DEC-017.
- Change history: 2026-10-28 — Gerai WhatsApp source and editing authority decided (`contact_whatsapp`, owner-selected "like the legacy project"); the Unknown about the source is closed.
- Change history: 2026-10-28 — Masking misuse policy decided as an owner-delegated default (DEC-018): per-shipment, off by default, three fields required, true identity retained in the snapshot, tenant accepts responsibility, Super Admin tenant-level disable and suspension, courier notice triggers review; the open decision is closed.

### PR-35 — Public marketing site limited to approved and implemented claims
- Status: Proposed (review finding P0-4); the conditions in DEC-012 are accepted; the correction is built (T-036)
- Owner: Paduka Ongki
- Source: `docs/review/2026-10-28-full-review.md` finding P0-4; DEC-003, DEC-012; AGENTS.md.
- Statement: While a public marketing page is served, the system shall describe only capabilities that are implemented at the displayed release, shall state a commercial term only where a recorded decision approves it with its provider source and date, and shall not state a numeric commission, discount percentage, COD fee, insurance or payout term or a Mengantar partnership otherwise.
- Acceptance: Given the repository, When src/ and public/ are searched for numeric commission, discount-tier, COD fee, insurance or payout terms and for partnership wording, Then no match exists unless a decision record backs it; given a capability that is not implemented (for example tracking, WhatsApp resi, receipt printing, COD payout reports, and pickup scheduling until T-043 lands), Then no page presents it as available; given the marketing courier names, Then they are a subset of the couriers the application offers, derived from its single courier configuration; given a preview or staging host, Then responses carry X-Robots-Tag noindex and its robots.txt disallows everything; marketing tests assert the approved copy and zero legacy-brand matches.
- Constraints: PR-22, PR-23, DEC-003, DEC-012, AGENTS.md. A percentage may reappear only after the Mengantar terms are provider-verified (DEC-012). "Implemented" is judged against ARCHITECTURE.md "Present on disk". Observed (review static read at HEAD 5f85d86, 2026-10-28): the indexed pages publish commission tiers, a COD fee percentage, insurance and payout terms, a partnership claim and features that are not built, and marketing tests lock those numbers in.
- Evidence: Observed (2026-10-28): the five public pages, robots and sitemap publish no numeric commission, fee, payout or partnership copy, omit unimplemented features, derive couriers from `OFFERED_COURIERS` minus `DROP_OFF_UNSUPPORTED`, and non-apex hosts send `X-Robots-Tag: noindex, nofollow` with a disallow-all `robots.txt` (T-036; tests/unit marketing-rebrand and middleware, tests/e2e marketing on 390 and 1280). Open: the pages still describe drop-off only and do not announce pickup or the local label (they wait for T-048); `APP_ORIGIN` must be set in the apex build environment.
- Change history: 2026-10-28 — Added (review finding P0-4; DEC-012).

### PR-36 — Host topology and cookie scope
- Status: Accepted (DEC-015; CTX-41 items 1 to 10, and items 11 to 17 accepted by the owner on 2026-10-28)
- Owner: Paduka Ongki
- Source: CTX-41, DEC-015.
- Statement: When a request arrives, the system shall serve Super Admin routes only from owner.geraiexpress.com, gerai-application routes only from app.geraiexpress.com and the public marketing routes from the apex, answer another host's routes with 404 rather than a redirect, scope session cookies to the host that set them, derive the tenant from the verified membership and never from the hostname, and receive provider webhooks on a separate cookie-less host authenticated only by signature.
- Acceptance: Given the host matrix, When each host is asked for the other hosts' paths, Then it answers 404 (unit test); given a session on the app host, When the owner host is requested, Then the cookie is not sent (e2e); given an invitation or marketing link, Then it is built from per-environment configuration (`APP_ORIGIN`) and not from request headers (code mail is code-only and carries no link); given a non-production deployment, Then its hosts are single-level names; given any non-marketing host, Then it sends X-Robots-Tag noindex.
- Constraints: SEC-1, IAM-7, TEN-1, PR-12, PR-24, DEC-015, DEC-020, DEC-021. Cloudflare Access in front of the owner host in addition to TOTP is optional (CTX-41 item 5) and not required. There is no separate egress gateway host (DEC-020); `internal.geraiexpress.local` is internal-only for `/api/internal/cron/*` and `/healthz`. Decision (CTX-41 items 11 to 17, accepted 2026-10-28; runtime/data amended by DEC-020 and DEC-021; full text in ARCH-6 and UX-11): the owner host `/` leads to platform sign-in and the platform overview and the app host `/` to sign-in and the shipment queue; one identity may be both platform administrator and tenant member with a separate session per host and no platform action in a tenant context; preview, staging and production each have their own PostgreSQL database, PostgREST instance, Compose deployment, hosts, signing secrets and Mengantar environment with no shared credential or seller id; each host has its own health route, Bahasa Indonesia not-found and error pages and its own CSP, with CORS off; Auth e-mail keeps the apex sender address while sending-domain verification and SPF/DKIM stay a production gate (DEC-009). Items 11 and 12 are stated in PR-37.
- Evidence: Observed merged `src/lib/hosts.ts`, `src/proxy.ts` (renamed from `src/middleware.ts` in T-066) and `src/lib/db/cookies.ts` (replacing `src/lib/supabase/cookies.ts` in T-066) enforce audience/404 routing, host-only `gx_at`/`gx_rt` cookies and configured origins. `infra/proxy/Caddyfile` maps the four public hosts and `infra/env/*.env.example` supplies their origin templates (DEC-020). The former `/api/auth/send-email` route on the hooks host was removed in T-066 (`hooks.` now reserves `/api/webhooks` plus `/healthz`). DNS, production ACME issuance/renewal, cross-host Server Actions and production host cutover remain unproved; owner TOTP recency remains T-054.
- Amendment (Proposed, 2026-11-02, PR-40, SEC-8): the apex also serves `/lacak/*`, a non-marketing route that reads and sets no cookie, sends per-route `X-Robots-Tag: noindex` and a robots disallow, and answers 404 on the app, owner, hooks and internal hosts.
- Change history: 2026-10-28 — Added per DEC-015 and CTX-41.
- Change history: 2026-10-28 — The Supabase Auth Send Email Hook (`/api/auth/send-email`) was placed on the cookie-less hooks host (DEC-018; ARCH-6, TD-14, SEC-6).
- Change history: 2026-10-28 — CTX-41 items 11 to 17 accepted by the owner and stated in the constraints.
- Change history: 2026-10-29 — Amended for DEC-020 and DEC-021 (T-062, T-066): `src/proxy.ts` and `src/lib/db/cookies.ts` replace the Worker/Supabase middleware and cookie helpers; the Send Email Hook route is removed, leaving the hooks host for provider webhooks.

### PR-37 — Tenant slug and shipment reference
- Status: Accepted (CTX-41 items 2, 11 and 12, owner-accepted 2026-10-28); built locally (T-049)
- Owner: Paduka Ongki
- Source: CTX-41.
- Statement: When a tenant is activated, the system shall give it an immutable, unique, lower-case slug used for display, shipment-reference prefixes and support lookups and never for authorization, and shall issue shipment references that cannot collide within a tenant.
- Acceptance: Given two tenants, When either asks about the other's slug or reference, Then access is decided by membership only; given an attempt to change a slug after activation or to take a duplicate or reserved slug, Then it is refused; given concurrent confirmations on one day in one tenant, Then each shipment gets a distinct reference. Decision (CTX-41 items 11 and 12, accepted 2026-10-28): the slug matches the pattern ^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$, reserved names and the blocked marketing keyword are refused, and the reference is PREFIX-yymmdd-seq with a per-tenant prefix of 3 to 5 upper-case letters set at activation and a per-tenant, per-day counter taken under a row lock.
- Constraints: TEN-1, DATA-1, DATA-2, PR-36, CTX-41. The display name stays editable while the slug does not; the applicant is not asked for a prefix at registration. Decision (CTX-41 item 11): the reserved names are www, app, owner, hooks, api, admin, mail, status, static, assets, staging, preview, demo and support, plus the blocked marketing keyword.
- Evidence: Observed (2026-10-28, local): `tenants.slug` and `tenants.shipment_prefix` are immutable and unique (the prefix is unique across non-demo tenants; demo tenants share `DEMO`, DEC-019), assigned by the `tenants_identity` trigger at tenant insert, so at approval rather than at a separate activation step; references are `<PREFIX>-<yymmdd>-<seq>` from `private.reference_counters` under a row lock; 60 parallel demo drafts and 25 parallel real-tenant drafts gave no collision, and a slug from another tenant authorizes nothing (T-049; tests/db tenant-slug-reference). Demo references repeat across tenants, so support lookups must be scoped by tenant.
- Change history: 2026-10-28 — Added per CTX-41.
- Change history: 2026-10-28 — Items 11 and 12 accepted by the owner; the reserved-name list is fixed.


## Counter-business requirements from the 2026-11-02 market gap analysis

These requirements come from the [Indonesia market gap analysis](../research/geraiexpress-indonesia-market-gap-analysis.md)
(counter jobs J2 to J13). All are Proposed; development is permitted by DEC-023 through tasks
T-080 to T-087, and none is accepted product behavior until the owner accepts it. Priority labels
are proposals in that note's section 7.

### PR-38 — Counter payment record and customer receipt
- Status: Proposed (gap analysis, 2026-11-02); receipt content is an existing open owner decision
- Owner: Paduka Ongki
- Source: Gap analysis J5; DJP N10 (retail receipts such as bon kontan or kuitansi may serve PKP retailers); BI QRIS MDR rule (gap analysis N8); INDOPAKET "counter charged more than app quote" reviews (gap analysis section 3.3); PR-22.
- Statement: When an operator records that the customer paid for a confirmed shipment, the system shall store the payment method (cash, QRIS, transfer or other), the amount in whole rupiah, the collecting staff member and the time, and shall offer a printable customer receipt that states the normal customer charge and the payment record without exposing net cost, the gerai discount or the platform remainder.
- Acceptance: Given a confirmed shipment, When an operator records cash payment, Then the shipment shows "Lunas" with method, amount, staff and time and the receipt prints them; given an amount different from the customer charge, Then the difference is recorded and visible to the tenant administrator, never silently corrected; given a second payment record for the same shipment, Then it is refused unless the first is voided with a reason by a tenant administrator; given a member of another tenant, Then neither the record nor the receipt is reachable; given QRIS as the method, Then no surcharge is added to the customer charge (BI: MDR is borne by the merchant); given a COD shipment, Then the shipping charge is shown as collected by the courier and is never prefilled or counted as counter cash (DEC-003, counted once); given a counter payment marked paid, Then the Mengantar order payment state stays visible and unchanged; given the receipt, Then every amount on it comes from the accepted quote and confirmation snapshot, and any later provider weight or fee correction is shown as a separate line rather than rewriting the original.
- Constraints: PR-22, TEN-1, IAM-1, DATA-2, BILL-1, NFR-3. GeraiExpress records payments taken by the gerai; this requirement adds no payment processing and does not hold or move customer money; licensing remains a counsel item (market research L6). Unknown payment is distinct from unpaid. Tax wording on the receipt is a tax-owner decision; no PPN amount is hardcoded.
- Evidence: Not implemented (gap analysis section 2).
- Change history: 2026-11-02 — Added from the market gap analysis.

### PR-39 — Outlet shift and day close
- Status: Proposed (gap analysis, 2026-11-02)
- Owner: Paduka Ongki
- Source: Gap analysis J6; evidence is weak (one academic case of manual bookkeeping at a small agent); the owner interviews (lane E section 5) should validate it during the pilot, but development is not blocked (DEC-023).
- Statement: When a permitted user closes a shift or day for an outlet, the system shall total the PR-38 payment records by method and staff for that period in WIB, accept the counted cash, record the variance and the closer, and keep the closed period read-only.
- Acceptance: Given payments across two staff members and two methods, When the day is closed with a counted cash amount, Then the expected cash, counted cash and variance are stored with the closer and time; given a payment recorded after the close, Then it falls into the next open period; given a reopen, Then only a tenant administrator can do it, with a reason, and the audit log shows it.
- Constraints: PR-38, IAM-1, DATA-2, UX-1. A period stays open until it is closed and may span midnight; times are shown in WIB.
- Evidence: Not implemented.
- Change history: 2026-11-02 — Added from the market gap analysis.

### PR-40 — Customer resi message and tracking link
- Status: Proposed (gap analysis, 2026-11-02); depends on PR-12 (T-045)
- Owner: Paduka Ongki
- Source: Gap analysis J9 and J10; UKURIR customer WhatsApp notifications; Permenkomdigi 8/2025 Art 12(1)(h); public tracking-page privacy benchmark and COD-recipient scam reviews (gap analysis sections 1 and 3.3; lane C section 3).
- Statement: When a resi is issued, the system shall let the operator share the AWB, courier and a tracking link with the sender through a prefilled WhatsApp message opened on the operator's device, and shall serve a public tracking page, for a valid unguessable token, that shows only the status history, courier, AWB, destination city, the sender and recipient as initials (for a masked shipment, the initials of the printed sender) and the gerai name when masking is off, never the real pickup identity.
- Acceptance: Given an issued shipment, When the operator chooses "Kirim resi ke pelanggan", Then a `wa.me` link opens with the sender's normalized phone and a message containing the AWB and the tracking link, and nothing is sent by the server; given the tracking link, When opened without a session, Then it shows status history, courier, AWB, destination city, initials and the gerai name only when masking is off, with no full names, phone numbers, street address, price, tenant cost, COD amount, item description, courier driver details or proof-of-delivery photo, and sends noindex; given a guessed or revoked token, Then it answers 404; given a masked shipment, Then the initials are those of the printed sender and no gerai name or real pickup identity appears; given repeated lookups from one client, Then rate limiting applies and tokens cannot be enumerated.
- Constraints: PR-12, PR-34, PRIV-1, SEC-2, PR-36, NFR-3. No automated WhatsApp Business API sending is implied; that needs its own provider decision. Tracking data comes only from PR-12 events.
- Evidence: Not implemented.
- Change history: 2026-11-02 — Added from the market gap analysis.

### PR-41 — Parcel content declaration and prohibited-goods acknowledgement
- Status: Proposed (gap analysis, 2026-11-02); acknowledgement wording needs counsel (T-048)
- Owner: Paduka Ongki
- Source: Gap analysis J3; Permenkomdigi 8/2025 Art 22.
- Statement: Before a shipment is confirmed, the system shall require a content description and the operator's confirmation that the sender declared the parcel free of prohibited items, and shall store both in the shipment snapshot.
- Acceptance: Given a draft without a content description or without the confirmation, When the operator confirms, Then confirmation is refused with the missing item named; given a confirmed shipment, Then its snapshot shows the description, the declaration version, the confirming staff member and the time; given the declaration text, Then it lists the Art 22 categories in Bahasa Indonesia. Wording gate (not a development gate, DEC-023): the text is marked provisional until the Mengantar sync approves it.
- Constraints: PR-5, PR-7, DATA-2. The system does not inspect parcels; it records the declaration. Courier-specific restricted lists stay the courier's.
- Evidence: Implemented locally by T-081 (DATA-13); the acknowledgement text is provisional (DEC-023) and categories quote Permenkomdigi 8/2025 Pasal 22(3).
- Change history: 2026-11-02 — Added from the market gap analysis.

### PR-42 — Insurance offer and recorded choice
- Status: Proposed (gap analysis, 2026-11-02); insurance itself stays Deferred under DEC-013 until the provider capability is verified
- Owner: Paduka Ongki
- Source: Gap analysis J4; Permenkomdigi 8/2025 Art 27; DEC-013. Observed (Mengantar homepage, marketing copy identical to a 2023 page and possibly stale): free insurance below Rp500,000 goods value and Rp1,000 above, but the Public API has no insurance field, so the provider capability for API orders is Unknown.
- Statement: When a shipment is quoted for a courier service whose insurance capability the provider has verified, the system shall show that insurance is available with its verified premium and shall record whether the sender accepted or declined.
- Acceptance: Given a verified insurance capability, When the operator reaches review, Then the offer is shown and a choice is required; given acceptance, Then the premium is added once (PR-22) and sent in the provider order; given decline, Then the choice is stored and printed on the receipt; given no verified capability, Then no offer appears and nothing implies coverage.
- Constraints: PR-22, DEC-003, DEC-013, BILL-1. No invented premium percentage.
- Evidence: Not implemented; Deferred.
- Change history: 2026-11-02 — Added from the market gap analysis.

### PR-43 — Measured weight, dimensions and billable-weight estimate
- Status: Accepted for regular-service integration (owner, 2026-11-03); full T-080 remains open for verified route-specific cargo constraints/order support. The Mengantar formula is published (help article 5387484).
- Non-COD cargo (owner, 2026-11-03): JNE (JTR), SiCepat (Gokil) and iDexpress cargo are quoted beside regular services for non-COD shipments only, within their sourced minimum/maximum weight and with the provider's route minimum matching the rule; the counter sees them as service `Kargo`. Cargo COD and SAP cargo stay unavailable until verified.
- Owner: Paduka Ongki
- Source: Gap analysis J2; Permenkomdigi 8/2025 Art 12(1)(f) (operator duty, context only); Permenkomdigi 15/2025 KBLI 53202 scale standard (0 to 50 kg, 100 g precision); KirimAja SubConsole weight verification; operator dispute evidence (lane E E6 to E8). Observed (Mengantar help 5387484, updated 2026-10-19): volumetric weight is (L x W x H) / 6000, JNE and IDX Kargo divide by 4000, the heavier of actual and volumetric applies, rounding tolerance 0.30 kg (Lion 0.31 kg), and a weight difference is debited from or credited to the seller balance.
- Statement: When an operator enters a parcel, the system shall store measured weight and dimensions as entered at the counter, show a billable-weight estimate only from a provider-verified formula, and keep the measured values on the shipment snapshot as dispute evidence.
- Acceptance: Given dimensions and weight, When the per-courier formula is recorded as provider configuration with its source and date, Then the quote shows actual, volumetric and billable weight per courier and uses the billable weight; given no verified formula, Then the quote states that volumetric weight is not included; given a later provider weight correction, Then both values are shown and the difference is visible.
- Constraints: PR-4, PR-7, DATA-2. Units are validated at the backend.
- Evidence: The Public API has no dimension field (lane D finding 5). The regular-service implementation instead groups courier estimates by derived billable grams and freezes the selected quote's weight through create-order, retaining measured values and legacy NULL-weight compatibility. DATA-14 specifies fallback and sub-kg behavior; cargo ranges are evidence only and cargo remains disabled. Provider reweigh ingestion remains T-045; nullable storage/presentation does not claim ingestion is complete. See STATUS.md and the T-080 review report for current verification.
- Change history: 2026-11-02 — Added from the market gap analysis. 2026-11-03 — Owner approved regular-service integration with cargo disabled; aligned rounding/fallback semantics with DATA-14 without closing T-080.

### PR-44 — Return-to-sender and claim cases
- Status: Proposed (gap analysis, 2026-11-02); depends on PR-12 (T-045)
- Owner: Paduka Ongki
- Source: Gap analysis J11 and J12; Permenkomdigi 8/2025 Art 20, 47(2)(i), 73, 75 (operator duties, context only); Mengantar return-fare rules; Mengantar claim rules (help 8140017, 5596208): claim decided within 14 days, per-courier filing windows from 3x24 hours to 60 working days, no claims API; Mengantar web UI adds a Lost final status whose webhook value is Unknown.
- Statement: When a provider status shows a return or a permitted user reports loss, damage or delay, the system shall open a case on the shipment that records the type, dates, evidence references, the courier or Mengantar ticket reference and the outcome, and shall show return charges as provider facts without promising compensation on the courier's behalf.
- Acceptance: Given a return status event, Then the shipment enters a visible return state and the queue lists it under attention; given a claim case, Then the courier's filing deadline (from provider configuration with source and date) and its age in working days are shown, and closing it requires an outcome; given a member of another tenant, Then the case is unreachable.
- Constraints: PR-12, PR-9, TEN-1, DATA-2. Compensation is decided by the courier (Penyelenggara Pos) or Mengantar; the system records the decided amount and never promises one.
- Evidence: Not implemented.
- Change history: 2026-11-02 — Added from the market gap analysis.

### PR-45 — Pilot measurement and gerai earnings view
- Status: Proposed (gap analysis, 2026-11-02)
- Owner: Paduka Ongki
- Source: Gap analysis J13; "Problem, goals and evaluation" (measures with no instrument); T-048 pilot log.
- Statement: While a pilot runs, the system shall report per outlet and day in WIB the shipments issued, time from draft to resi, payment-method mix (PR-38), share of masked labels and, for the tenant administrator only, the estimated earnings: the normal tariff minus the gerai-facing cost from the assigned discount at quote time (DEC-018), with COD fee and insurance passed through and excluded, never the provider net cost or percentage.
- Acceptance: Given a pilot period, When the tenant administrator exports the report, Then each measure has its definition, period and data timestamp; given an operator, Then the earnings column is not visible; given an unknown gerai cost, Then earnings are shown as unknown, never zero; given any role, Then no provider net cost or observed percentage appears.
- Constraints: PR-14, PR-22, PR-23, IAM-1, NFR-3. These are evaluation measures, not revenue promises.
- Evidence: Not implemented.
- Change history: 2026-11-02 — Added from the market gap analysis.

### PR-46 — Masked-label regulatory and return-path acceptance gate
- Status: Proposed (gap analysis v2, 2026-11-02); gates the public masking claim, not the existing built label
- Owner: Paduka Ongki
- Source: Permenkomdigi 8/2025 Art 77 (the licensed operator's resi QR contains sender and recipient names, addresses, postcode, phone, item and tariff), Art 58(4), Art 84; Mengantar return-address rule (pickup address, or a configured return address only when origin and destination are both on Java, help 14715369); courier exceptions (Anteraja manual drops return to the dropping agent; SPX returns are collected by the shipper; lane E E15); DEC-017; PR-34; T-048.
- Statement: Before the masked local label is presented to gerai or customers as an approved way to ship, the system shall require recorded evidence that the receiving courier accepts the label for each enabled courier and recorded counsel advice on Art 77, and shall tell the operator at masking time that a returned parcel goes to the provider pickup address or configured return address under the courier's rule, never to the printed masked sender.
- Acceptance: Given a courier without recorded scan acceptance, When an operator opens the masking choice for that courier, Then the masked option is marked "belum terverifikasi" and requires an explicit acknowledgement (whether it should instead be unavailable is blocked until the owner selects); given masking is chosen, Then the screen states the return destination for that courier and route; given the public marketing pages, Then they make no masking claim until both records exist (PR-35).
- Constraints: PR-34, PR-35, DEC-017, DEC-018, DEC-023, T-048. This requirement does not change the label layout; the Mengantar sync may require one. Development of the gate is not blocked (DEC-023); only the recorded acceptance evidence waits for the sync and the courier test.
- Evidence: Not implemented; courier scan and counsel advice pending (T-048).
- Change history: 2026-11-02 — Added from the market gap analysis v2.

## Non-functional acceptance proposals

### NFR-1 — Isolation proof
- Status: Proposed
- Owner: Engineering owner
- Source: CTX-1, CTX-11.
- Statement: Every implemented tenant-owned read/write/search/export/label/job path shall have a same-tenant success and cross-tenant denial check, including direct PostgREST Data API and RPC access.
- Acceptance: An isolated two-tenant suite passes with authenticated, anonymous, suspended, revoked, and different-account cases; guessed IDs cannot disclose protected records.
- Constraints: TEN-1, TEN-2, IAM-1, SEC-1.
- Evidence: Observed (`ARCHITECTURE.md`, `STATUS.md`, 2026-10-29): `tests/db` (27 files / 410 tests on PostgreSQL 17 + PostgREST from a dropped database, including `isolation.test.ts`, `privileges.test.ts` and `auth-core.test.ts`), the machine-attested Partner seller binding (T-032), and the full-signature privilege catalog allowlist (T-035, T-065) pass locally. T-067 independent security review of the owned auth module remains open.

### NFR-2 — Duplicate and interrupted operation recovery
- Status: Proposed
- Owner: Engineering owner
- Source: CTX-11, CTX-13.
- Statement: Replayed commands and interrupted provider operations shall not cause a second order or silently lose a known provider outcome.
- Acceptance: Concurrent submit, duplicate delivery, process restart, and timeout-after-provider-acceptance scenarios preserve one logical attempt and enter explicit reconciliation when outcome cannot be proved.
- Constraints: TD-3, DATA-2.
- Evidence: Observed: idempotency keys, one in-flight operation per tenant and reconcile-by-reference are covered by tests/db and tests/unit dispatcher suites and by e2e double-confirm and stale-tab cases (tasks 005, 022, 024). Gap: an ambiguous batch-payment result can be released for replay (review finding P0-3, T-033).

### NFR-3 — Private operational payloads
- Status: Proposed
- Owner: Engineering owner
- Source: CTX-3, CTX-11.
- Statement: Operational output shall contain no provider credential/path, auth secret, or unnecessary contact detail, and protected responses shall not be publicly cached.
- Acceptance: Canary credentials are absent from logs, errors, traces, browser bundles, and anonymous access; phone/customer values are absent from unauthorized or policy-suppressed payloads while the selected authorized operational display/detail/print policy still works.
- Constraints: SEC-1, PRIV-1, TEN-2.
- Evidence: Observed: the client-bundle scan (`scripts/check-client-bundle.mjs`, scanning for `AUTH_JWT_SECRET`, `AUTH_SECRET`, `SERVICE_ROLE_JWT`, `PGRST_*`, `MENGANTAR_*`, `CREDENTIAL_KEY*` and `CRON_SECRET`), no-store `src/proxy.ts` tests, count-only logging, HttpOnly `gx_at`/`gx_rt` cookies, CSP base policy and account limiters (T-038, T-066); the script CSP remains Report-Only (T-055).

### NFR-4 — Operator browser proof
- Status: Proposed
- Owner: Engineering owner
- Source: CTX-11.
- Statement: Each delivered primary workflow shall be keyboard-operable with labelled inputs, visible validation/pending/recovery states, and a usable layout at 390px, 768px, and 1280px.
- Acceptance: Browser journeys pass at those viewports without document overflow greater than 1px or inaccessible primary actions; wide tables may scroll in a labelled local region.
- Constraints: UX-1, UI-1.
- Evidence: Observed: e2e at 390/768/1280 for the delivered workflows (tasks 003 to 007, PERF-1). The review did not re-run e2e and found missing browser evidence for several recovery states and a missing pending state on provider actions (findings SUP-13, SUP-18). Old static-render tests are not browser proof.

### NFR-5 — Partner network, quota, and protocol readiness
- Status: Proposed
- Owner: Engineering owner
- Source: CTX-17, CTX-18.
- Statement: Partner calls shall use exact-byte endpoint-bound signatures, durable partner-wide scheduling, and an approved production egress path, with isolated seller shipping quotas and redacted telemetry.
- Acceptance: Offline signature vectors and tampering negatives pass; concurrent instances honor provider Retry-After/request limits and WIB daily reset; production primary/failover addresses are accepted by Mengantar and an unavailable approved route cannot fall back to ordinary egress.
- Constraints: ARCH-2, TD-7, SEC-3; initial limits 60 requests/minute and 1,000 new sellers/day are configurable provider entitlements, not a product sales guarantee.
- Evidence: Historical unit signing/tampering vectors and sandbox Partner/Public API observations remain bounded to that environment. Decision (DEC-020, owner) replaces the hybrid gateway design with direct Node-server egress; `Dockerfile`/`compose.yaml` are Observed source, not proof of the server's actual fixed IPv4 or Mengantar production acceptance (ARCH-2).

## Operational state boundaries

Drafts are editable. An estimate is not a submitted order. A queued or unknown
submission does not authorize another create-order request. An unpaid provider
order is an existing order without an issued AWB. A pickup time reservation is
not an order, and a lost reservation or create response is reconciled, never
repeated blindly (PR-5). The local masked label (PR-6, PR-34) exists only once an
authoritative AWB exists and is a printed snapshot with its own append-only print
history; a provider PDF label job, if one is ever used, has its own pending,
processing, completed, and failed state, separate from delivery status. A browser
print dialog does not prove that a physical label was printed.

## Access and data guardrails

- Every tenant-owned record and operation must have validated tenant scope, including contacts, addresses, sender mappings, shipment snapshots, provider job references, search, exports, and print history.
- User-context queries through PostgREST (`src/lib/db/server.ts` `dbServer()`) must enforce current membership through PostgreSQL RLS (`auth.uid()`, `auth.jwt()`). Routine tenant operations must not run as `service_role` (`machineClient()`), which bypasses RLS and is restricted to machine-only RPCs (`dispatch_*`, `auth_*`, `machine_seller_key`, `record_live_quotes`).
- Mengantar credentials and credential-bearing URL paths stay on the trusted backend and out of browser bundles, logs, traces, and errors.
- Shared provider accounts do not authorize cross-tenant access to provider-wide sender search, orders, labels, or wallet details.
- Sender and recipient names, phones, addresses, and label documents are private operational data; do not place them in analytics events or public storage by default.
- No remote provisioning, customer-data migration, or provider write is implied by drafting this specification.

## Pilot baseline and capability gates

Status 2026-10-28: the table separates owner decisions already recorded from
what is still only a recommendation. What is built is in the implementation
status section. Accepted policy does not by itself authorize provisioning,
deployment or live provider calls (DECISIONS.md).

| Area | Baseline | Basis | If evidence/selection is missing |
|---|---|---|---|
| Ownership | One business tenant owns exactly one Mengantar seller (Partner-created, or BYOK for an existing seller the verified owner proves they control); several outlets map to it; no central platform seller and no silent fallback | Decision DEC-006; the Partner account is GeraiExpress's own (DEC-012) | Production seller provisioning stays gated by ARCH-2 egress, PR-20 documents and T-032 |
| Registration | Email-first native verification, password after inbox control, resumable application, manual Super Admin approval during the pilot | Decision DEC-007; automatic activation after the pilot remains a Proposal | No automatic activation by assumption |
| Member access | IAM-1 matrix as resolved in DEC-008: tenant-wide memberships in the pilot, per-outlet assignment deferred; invitations single-use, email-bound, 7 days | Decision DEC-007, DEC-008 | No user-selected roles or implicit access to a new outlet |
| Money | Sender pays the full normal tariff; the gerai discount is Super Admin configuration; no platform fee is collected and no platform ledger exists in the first release; BILL-1/BILL-2 | Decision DEC-003, DEC-016; provider terms unverified (CTX-42) | An unknown fee, payer, discount or activation blocks the affected action and never becomes zero or a local subsidy |
| Resi and label | Local masked label with the AWB as a Code128 barcode; masking switch; no provider dropshipper; the Mengantar pickup name is never the default sender | Decision DEC-017 (PR-34) | Courier acceptance of a locally printed label is Unknown until a pilot scan; no claim of an arbitrary sender address or provider-label layout |
| Pickup | Drop-off or pickup per shipment, with provider time reservation | Decision CTX-39 launch scope (PR-5, T-043) | Pickup is not offered until implemented and proved in the sandbox |
| Delivery | Working isolated demo, then sandbox evidence, then a bounded authorized pilot; DEL-1 | Decision DEL-1; the owner runs the pilot gerai (CTX-39) | A simulated preview cannot be presented as a working live integration |
| Hosting and data | Self-hosted Node.js container, Caddy proxy and scheduler with fixed server IPv4 for Mengantar (DEC-020); plain PostgreSQL 17 + PostgREST + application-owned auth (DEC-021, ADR-0002); hosts per DEC-015 | Decision DEC-015, DEC-020, DEC-021 (superseding DEC-001 and DEC-011); built locally in T-062 and T-064..T-066 | No production use until the server's fixed IPv4 is registered with Mengantar, PostgreSQL hosting/backup/PITR are chosen, and T-067 security review passes |
| Operations | Named responders, explicit limit configuration and restore drill under OBS-1/RATE-1/DR-1 | Proposal | No production readiness claim without signal delivery and safe recovery proof |

## Risks and open questions

### Closed since the draft

| Question as first written | Resolution | Basis |
|---|---|---|
| CTX-9: account owner, cardinality and BYOK verification | One seller per tenant business, several outlets mapped to it, BYOK only for a seller the verified owner proves they control | Decision DEC-006 |
| Next.js Workers/OpenNext compatibility gate | Historical only: exact Next.js pins remain, but the Node-container gate replaces the adapter path; Observed `next.config.ts` and `Dockerfile`, security fixes in progress | Decision DEC-020 (owner); DEC-005 pins retained |
| Does one tenant own several outlets; which roles manage contacts, issue, reprint and configure the provider | Several outlets; roles per the IAM-1 matrix resolved in DEC-008; pilot memberships are tenant-wide | Decision DEC-006, DEC-008 |
| Email-first signup and manual review versus automatic activation; Super Admin bootstrap and recovery owner | Email-first OTP, manual review during the pilot; bootstrap is the owner's verified identity with TOTP plus one recovery administrator | Decision DEC-007, DEC-008 |
| Invite lifetime, roles and outlet scope; additional-business rules | Single-use, email-bound, 7-day, revocable invitation with the role fixed by the inviter; one application and review per additional business | Decision DEC-007, DEC-008 |
| Supabase SMTP implicit-TLS compatibility | Native-SMTP and Worker Send Email Hook candidates are both superseded by DEC-020 and DEC-021 (ADR-0002, T-066): the Node app renders and sends code mail directly through `src/lib/mail-transport.ts` (local Mailpit Observed; production transport/provider remains Proposal, unbuilt, T-063) | Decision DEC-009, DEC-020, DEC-021 (owner) |
| Which intended accounts have Dropshipper enabled | Moot for the first release: no provider dropshipper is used (PR-3) | Decision DEC-017, DEC-013 |
| Whether the provider PDF meets the selected customer-document policy | Moot for the first release: the printed label is local and the provider PDF is optional and whitelist-gated | Decision DEC-017 |
| Which tenant branding must appear on the local parcel label | The masking switch chooses the sender fields, not the branding: both masked and unmasked parcels show the bounded gerai logo or legible gerai-name fallback, never the gerai contact while masked. Branding is frozen with the label snapshot. The separate 10x5 slip is T-095 scope; no provider-label branding change is implied | Owner decision 2026-11-05 ("label paket juga dong"), PR-34 / T-096; amends DEC-017 branding scope |
| GeraiExpress free versus paid or commission model | First release: no separate platform fee is collected from the gerai; revisit only if the written Mengantar answer requires it | Decision DEC-016, CTX-42 |
| Which domains apply (part of the cloud accounts, region, domains and volume question) | `owner.geraiexpress.com`, `app.geraiexpress.com`, apex for the public site | Decision DEC-015 |
| CTX-41 proposals 11 to 17: slug format and reserved names, shipment-reference format, entry points, identities, environment matrix, per-host pages, mail sender | Accepted by the owner on 2026-10-28 ("setuju"); stated in PR-36, PR-37, ARCH-6, DATA-8 and UX-11 | Decision CTX-41 |
| Source of the gerai WhatsApp number printed on the masked label (earlier Unknown in PR-34) | Tenant-level `contact_whatsapp`, initialized at approval from the application's business contact phone and editable only by a tenant administrator through an audited command; an empty value blocks the masked print (owner-selected "like the legacy project"; exact normalization and backfill stay Proposals until the migration task is accepted) | Decision (PR-34, PR-30) |
| What the gerai discount means while Mengantar debits the gerai's own seller account (earlier Assumption, BILL-3); the rounding rule for amounts derived from basis points (earlier Unknown, PR-23) | The Super Admin assigns a discount per tenant; it is the cost basis shown to the gerai and the amount the Super Admin is accountable for; Mengantar's debit follows the seller account's own rate; the variance is shown and neither collected nor subsidized; above-observed assignment stays blocked; the platform earns nothing from the discount in the first release; amounts use integer arithmetic with the discount rounded down and unknown stays NULL | Decision, owner-delegated default (DEC-018); mechanics Proposal; provider terms still unverified (T-048) |
| Masking misuse policy (earlier open row, PR-34) | Per-shipment choice, off by default; all three sender fields required; the snapshot keeps the true tenant and pickup identity beside the printed sender; the tenant accepts responsibility at activation (wording by counsel, T-048); the Super Admin can disable masking for one tenant and suspend it; a courier or Mengantar notice triggers platform review | Decision, owner-delegated default (DEC-018); tenant flag and screens are Proposal mechanics |
| Host of the Supabase Auth Send Email Hook (earlier unassigned item, TD-14) | Historical: DEC-018 placed `/api/auth/send-email` on the cookie-less hooks host; DEC-021 (T-066) removed the Send Email Hook altogether, leaving `hooks.geraiexpress.com` reserved for signed provider webhooks (`/api/webhooks`) | Decision DEC-018, superseded for Auth mail by DEC-021 (ADR-0002) |

### Open owner decisions and gates

Decision (DEC-023, CTX-44, 2026-11-02): GeraiExpress is an official Mengantar sub-partner;
legal-status, regulatory and commercial items below that involve Mengantar or counsel are
settled with Mengantar later. They gate live provider use, production release and public
claims; they do not gate development of PR-38 to PR-46.

| Question | Owner | Due gate |
|---|---|---|
| Written Mengantar answer on discount terms (CTX-42): does a partner-registered seller get a negotiated discount and is it 30% from the first shipment; can the partner set or change a per-seller discount and how is it activated; are the partner's sellers pooled for volume steps; does Mengantar pay the partner a rebate and how is it settled; or must the platform remainder be collected from the gerai | Paduka Ongki with the Integration owner | Before any discount is marked provider-verified (T-041) and before any percentage is shown publicly (DEC-012) |
| Revenue model: subscription per outlet, per-resi platform fee, negotiated volume pooling with Mengantar, or a free product feeding another revenue line; DEC-016 currently yields zero platform revenue at Mengantar's documented 20% (gap analysis section 5) | Paduka Ongki | Before the paid pilot and before any public pricing |
| Positioning against free competitors (bosAgen, SIMASRIM, UKURIR, AutoKirim, Fastpay): which proven outcome leads the offer, and whether PPOB or bill payments are ever in scope | Paduka Ongki | Before marketing copy beyond PR-35 |
| Whether a gerai using a GeraiExpress seller account is an agent under Permenkomdigi 8/2025 Art 10 and 75 and KBLI 53202 (Permenkomdigi 15/2025, which requires a written agreement with a postal operator), and which operator duties (Art 22, 27, 51, 73, 77) it must surface | Paduka Ongki with counsel | Before PR-41 wording, PR-46 and the live pilot |
| Whether the masked local label is compatible with Art 77 resi QR content and courier acceptance (PR-46) | Paduka Ongki with counsel and the Integration owner | Before any masking claim |
| Tax treatment: whether PPN besaran tertentu (PMK 71/2022 as amended by PMK 11/2025) applies to a counter or a platform fee, and whether PP 20/2026 excludes a counter's spread as intermediary income | Paduka Ongki with a tax adviser | Before receipts state tax and before any platform fee |
| Breach-notice duty and controller/processor roles under PP 33/2026 (3x24-hour notice) | Paduka Ongki with counsel | Before real customer data |
| Owner interviews (at least five gerai, guide in lane E section 5) | Paduka Ongki | Recommended product validation during the pilot; not a development gate (DEC-023) |
| Expected volume and timing: tenants (about 50 is an Assumption), shipments per gerai and day, staffing and concurrency, go-live date | Paduka Ongki | Before capacity sizing, hosting sizing or any performance commitment |
| Who the pilot gerai is (entity, location, go-live date; the owner states he runs the first pilot gerai, CTX-39), plus baseline, target and observation period for the counter workflow evaluation | Paduka Ongki | Before business-improvement claims and before the supervised production order |
| Retention policy for contacts, shipment and label snapshots, print history, invoices, uncompleted registrations and invitations, audit and exports; archive/delete and support access | Paduka Ongki | Before personal-data lifecycle implementation (PRIV-1, PRIV-3); label snapshots and print history before T-044 serves a real gerai |
| Terms and Privacy: application Terms/Privacy documents and notice versions; Mengantar Terms/Privacy URLs and versions for PR-20; gerai-facing terms for the assigned discount and the masking responsibility statement; whether an electronic-system registration obligation applies (Unknown, no default invented; counsel, T-048) | Paduka Ongki with the Integration owner | Before accepting real signup data and before real seller onboarding |
| Whether couriers accept a locally printed label whose barcode decodes to the AWB (scan and routing evidence) | Integration owner | Pilot scan before launch |
| Partner production origin, IP allowlist entitlement and fixed server IPv4 registration (ARCH-2; historical gateway design T-040 withdrawn by DEC-020) | Integration owner | Before real onboarding; production networking before live enablement |
| Callback-secret handling for webhooks, key regeneration and a lost rotation response (PR-12, PR-19) | Integration owner | Before T-039 and T-045 are enabled |
| Owner transfer, factor recovery, and rejection/resubmission policy for applications | Paduka Ongki | Before those flows are built (PR-30, PR-32) |
| Production mail provider/domain/quotas (T-063) and production Turnstile keys; former Worker mail binding no longer applies | Engineering owner | Before public real-account registration (DEC-009, DEC-020, PR-33) |
| Which support investigations may expose customer data or authorize money or credential actions beyond the default platform projection | Paduka Ongki | Before support access or exceptional recovery |
| Customer receipt and invoice content and branding (the UX-17 receipt field list is the Proposal to decide); cashier, deposits, settlement, refunds (including refund after a voided payment or a failed provider order) and finance scope | Paduka Ongki | Before monetary workflows; before the invoice part of T-047 |
| COD Ongkir uses normal retail shipping under CTX-28; the actual collection, fee and insurance rule, and who receives COD goods proceeds under Full COD | Paduka Ongki | Before enabling that collection mode |
| Per-account fee base and inclusion, minimums, rounding, insurance and goods-value semantics, and the billable-weight rule (provider-configured and dated per PR-43; confirm before the supervised production order) | Integration owner | Before real charge calculation and before the supervised production order |
| Internal cost, discount and payout visibility per role | Paduka Ongki | Before pricing DTO and document acceptance |
| Server provider/region and fixed IPv4, production PostgreSQL hosting (same server or managed) with backup/PITR proof (T-067), printers and label media | Paduka Ongki | Before infrastructure provisioning and hardware acceptance |
| Name operational responders; select signal and audit retention, alert and retry budgets, and recovery targets with actual backup entitlements | Paduka Ongki with the Engineering owner | Before the production pilot; DEL-1, DR-1, OBS-1, RATE-1 |
| CTX-10: recheck current reachability and official status of the hostnames in the dated ISP DNS record | Paduka Ongki | Before treating migration as a remedy |

## Contradictions resolved by this review

| Previous ambiguity or reference mismatch | Resolution in this draft | Remaining evidence |
|---|---|---|
| The first checkout was assumed to represent every LegacyReference worktree | CTX-14 selects the clean advanced checkout as the preferred adaptation candidate and bounds old findings to their source | Pinned checkout/digests and target-runtime checks |
| Provider create DTO looks like a proven live integration | TD-2 prefers the advanced nested builder/live HTTP adapter over the old flat fixture DTO, but adds provider customer identity and requires current evidence | Sanitized sandbox creation and account binding |
| A webhook is either absent or automatically live because its route exists | TD-4 distinguishes the old 404-only route from the advanced signed but gated handler and its documented gaps | Account-specific signed capture and replay/tenant tests |
| A locally printed label implies courier-approved routing | PR-6 and PR-34 (DEC-017): the label is a local GeraiExpress document whose Code128 barcode decodes to the AWB; the provider PDF is optional and whitelist-gated; courier acceptance is Unknown until a pilot scan | Barcode decode test, courier scan/routing proof from a pilot, logo capability |
| Reusing the old tenant wrapper preserves RLS automatically | TEN-1 specifies JWT-verified identity (`auth.uid()`, `auth.jwt()` via PostgREST) and direct Data API/RPC denial | RLS, privilege-catalog and auth-core DB tests (`tests/db`) |
| One account dispatcher or queue implies exactly-once ordering | TD-3 requires durable in-flight state, idempotency, reconciliation, and account grouping | Concurrent tenants, restart, replay, and unknown-outcome tests |
| Old dashboard implementations define correct metrics | TD-6 uses definitions as candidates and explicitly avoids importing the reference's documented drift | Query/list/export parity and accepted business definitions |
| Saving a sender or switching label masking changes Mengantar identity | PR-2 is local persistence; masking under PR-34 is local and submits no provider dropshipper (DEC-017); a provider dropshipper mapping under PR-3 stays deferred (DEC-013) | Test that no dropshipper or provider label call is made when printing |
| All contacts must inherit the old list-masking behavior | The advanced reference allows complete phones inside authorized operations; GeraiExpress display permissions remain an explicit policy decision | Authorized display and unauthorized/direct-payload denial checks |
| Reference labels, retention, COD fees, and free-plan decisions carry over | Those policies remain owner-held decisions | Explicit scope and policy selection |
| Partner API replaces shipping or makes every customer a seller | PR-17 binds the tenant business; Public API still issues shipments and contacts remain separate | Account-owner/cardinality and real sandbox contract |
| A returned key makes every capability ready | PR-8 separates connection, shipping, local label and webhook readiness; provider dropshipper and PDF capability are optional (DEC-017) | Per-account capability and label proof |
| Get key is harmless and rotation can be blindly retried | PR-19 records provisioning/rotation effects and lost callback-secret recovery | Failure-injection and provider recovery procedure |
| Cloudflare hosting automatically meets provider IP allowlisting | NFR-5 and ARCH-2 require dedicated approved egress including failover | Entitlement and actual production-path proof |
| App registration, tenant approval and seller creation were collapsed into one first-use step | PR-29 through PR-33 and UX-7/UX-8 separate verified identity, versioned application/activation, staff invitation and explicit provider connection | Auth/transaction/browser/mail proof and owner policy selection |
| A confirmation click or sent email automatically grants tenant access | Native email verification establishes identity only; TEN-5 and IAM-8 still require the current scoped application/membership | Direct API/RPC denial and identity/recovery tests |
| Apple styling implies sparse shipping tables or absent error states | UI-1 through UI-3 retain form/table usability and accessibility | Rendered browser and token-contrast evidence |
| Requirements read "Proposed" and "no application build exists" after the build and decisions DEC-005 to DEC-017 | The status section and each requirement's Status line were reconciled on 2026-10-28; ARCHITECTURE.md stays the authority for what is built | Re-check when a task completes |
| PR-33 named native custom SMTP, then a Worker-bound Send Email Hook | DEC-021 (ADR-0002, T-066) removes the Send Email Hook; the Node app gates code issuance in SQL (`auth_issue_otp`) and sends directly via `src/lib/mail-transport.ts` (local Mailpit Observed; production transport Proposal, unbuilt, T-063) | Owner provider/domain decision and production delivery proof |
| PR-3 and PR-6 assumed a provider dropshipper and a provider PDF label | DEC-017 replaces both with a local masked label (PR-34); the provider dropshipper stays deferred under DEC-013 | T-044 evidence |
| Pricing text offered a platform-defined share of the spread and a platform ledger | DEC-016 replaces it: the sender pays the full normal tariff, the gerai gets a configured discount, no platform fee or ledger in the first release | Written Mengantar answer (CTX-42) |
| One host serves tenant and platform routes, and Super Admin needs no separate domain | DEC-015: owner., app. and apex hosts, enforced server-side (PR-36) | T-042 evidence |
| The public site publishes commission, fee and feature claims | PR-35 limits it to approved and implemented claims; the correction is T-036 | Copy checklist against ARCHITECTURE.md, and tests |

## Verification and next handoff

Observed (2026-10-29; sources: `ARCHITECTURE.md`, `STATUS.md`, `BUILD-LOG.md`): the
GeraiExpress application runs locally on the self-hosted Node.js container runtime (DEC-020,
T-062) and plain PostgreSQL 17 + PostgREST + application-owned auth module (DEC-021,
ADR-0002, T-064..T-066), all uncommitted in the working tree. Lead verification on the
cutover tree recorded: `pnpm typecheck` clean; `pnpm test:unit` 47 files / 817 tests;
`scripts/db-verify.sh` from a dropped database (35 migrations, `tests/db` 27 files / 410 tests);
`pnpm build`, `pnpm check:bundle`, `pnpm check:environments` pass; Docker build and
`pnpm smoke:container` 9/9; container Playwright full suite across desktop-1280, mobile-390
and tablet-768 (three single-run flakes passed on solo rerun; cause unconfirmed, T-059).
Earlier 2026-10-28 review counts (unit 102, DB 114 on the pre-cutover stack) remain historical.

Not proven (Unknown): an independent security review of the owned auth module (T-067, open),
PostgreSQL backup and point-in-time recovery drill (T-067), an authenticated production
Mengantar request, a label printed on a physical printer, a courier scan of a locally
printed label, and any remote deployment of the 2026-10-28/29 changes. No production
environment exists; the old remote Worker + Supabase preview still runs the prior stack
until the owner retires it.

Handoff: `TASKS.md` is the sole work queue (T-037, T-043 capture, T-045, T-048, T-054..T-063
and T-067 remain open). A change
to a requirement updates the implementation status table and the change history;
two current claims for one behavior are not left in place. User authorization to
create the project is recorded in CTX-1; unresolved business decisions must not be
replaced with assumed answers.

Additional advanced-source candidates are readable local shipment/contact
references, quick tariff checking, gerai logo/profile, customer invoice snapshots,
batch print, scanned handover, and state-valid cancellation. TD-1 owns their
source/disposition; DEC-014 schedules a subset (pickup, cancel, webhook and
tracking, masked label, invoice, CSV export, wilayah reference) as T-043 to T-047.
The rest do not become promised features or money/label policies merely because
their source exists.

## Change history

- 2026-11-02 — Round 3 review (`docs/review/2026-11-02-counter-operations-review.md`): earnings exclude
  the COD fee, PR-39 periods may span midnight, PR-40 statement and PR-36 amendment completed, PR-43
  scheduled as T-080; T-045 amended and T-088 (Mengantar sync question pack) added in TASKS.md.
- 2026-11-02 — DEC-023 / CTX-44 (owner): official Mengantar sub-partner; legal and commercial
  items sync with Mengantar later and gate release and public claims, not development.
  Two independent reviews (schema fit: REVISE; decisions and UX: APPROVE WITH FIXES) were applied:
  COD never counted twice at the counter, masked shipments hide the gerai on tracking, `/lacak` is
  apex-only, earnings use the gerai-facing cost not the provider net, IAM rows marked Proposed,
  cash periods built in T-082, per-courier billable-weight estimate groups, RLS and RPC-only writes.
  PR-38 to PR-46 (except PR-42, still provider-blocked) gain development contracts
  (UX-17 to UX-20, DATA-11 to DATA-15, SEC-8) and tasks T-080 to T-087; requirement Status
  lines stay Proposed until the owner accepts them.

- 2026-11-02 — Market gap analysis v2 (five research lanes): market table extended (competitor, review,
  BPS, QRIS and regulatory findings); PR-38, PR-40, PR-42, PR-43 and PR-44 sharpened with new
  evidence; PR-46 added (masked-label acceptance gate); four open decisions added (Art 77,
  tax, PP 33/2026, owner interviews). Independent evidence audit (PASS WITH FIXES): all 13 Medium and
  9 Low wording findings applied, including the PR-43 evidence pointer (dimensions are not sent to
  Mengantar), testable PR-40 and PR-46 acceptance, Art 20/75 attribution and status-table order.
  No requirement accepted; no task created.

- 2026-11-02 — Market gap analysis (`docs/research/geraiexpress-indonesia-market-gap-analysis.md`): the
  "Market and users" table now cites both research notes and records competitor, regulatory and
  unit-economics findings; PR-14 status corrected to Partial (T-078); PR-38 to PR-45 added as
  Proposed; three open owner decisions added (revenue model, positioning, Art 10 agent status).
  No requirement was accepted and no task was created.

- 2026-10-29 — Amended for DEC-020 and DEC-021 (ADR-0002, T-062, T-064..T-066): self-hosted
  Node.js container, plain PostgreSQL 17 + PostgREST and the application-owned auth module
  (`src/lib/auth/**`, `src/lib/db/**`, `src/proxy.ts`, `db/foundation/`, `db/migrations/20261029100000_auth_core.sql`)
  replace Cloudflare Workers, Supabase/GoTrue and the Send Email Hook as the current local
  implementation; T-067 independent security review and PostgreSQL backup/PITR release gates
  remain open.
- 2026-10-28 — Owner-delegated defaults (DEC-018): per-tenant discount meaning and the
  round-down rule (PR-23, BILL-3), masking misuse policy (PR-34), Send Email Hook host
  (PR-36); moved those rows from the open to the closed decision table. Retention,
  Terms and Privacy wording and the electronic-system registration question stay open
  for counsel (T-048).
- 2026-10-28 — Owner accepted CTX-41 items 11 to 17 (PR-36, PR-37 now Accepted) and
  decided the gerai WhatsApp source for the masked label (PR-34, PR-30); moved both
  rows from the open to the closed decision table.
- 2026-10-28 — Reconciliation with disk, ARCHITECTURE.md and decisions DEC-005 to
  DEC-017 (CTX-39 to CTX-42): replaced the stale "Proposed / no build / open
  decision" status; added the status legend, resolved-decision table and
  implementation status table; added the Market and users section; amended PR-3,
  PR-5, PR-6, PR-10, PR-12, PR-16, PR-19, PR-22, PR-23, PR-24, PR-30, PR-31, PR-32,
  PR-33 and NFR-1 to NFR-5 (see each Change history line); added PR-34 to PR-37;
  rewrote the closed and open decision tables. No requirement ID was renumbered.
- 2026-10-13 — Registration and documentation-completeness review: PR-29 to PR-33
  added.
