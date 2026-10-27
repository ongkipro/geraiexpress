# GeraiExpress — Data Model

- Status: Proposed logical model; not executable SQL or an approved migration.
- Owner: Engineering owner
- Updated: 2026-10-13
- Basis: CTX-3, CTX-11, CTX-13; reference schema and repositories.

## DATA-1 — Tenant-owned entities and relationships
- Status: Proposed
- Owner: Engineering owner
- Source: CTX-1, CTX-3, CTX-11.
- Statement: Persisted operational entities shall carry explicit ownership and database-enforced same-tenant relationships, with Supabase identity separate from contacts.
- Acceptance: Local schema checks reject a contact address, shipment, snapshot, or label bound to another tenant's parent, including a direct insert/update through the Data API.
- Constraints: TEN-1, IAM-1, PRIV-1. Cardinality/permissions remain proposed.
- Evidence: Reference composite foreign keys observed; GeraiExpress schema not created.

Names below are proposed logical entities, not existing tables or promised SDK APIs.

| Entity | Ownership and keys | Essential information / relationship |
|---|---|---|
| Application profile | Supabase `auth.users` identity, not tenant-owned customer data | App identity state/display fields; do not copy Better Auth sessions/accounts/verifications. |
| Tenant | Business access boundary | Name, branding reference, lifecycle; accepted lifecycle policy pending. |
| Membership | Tenant + auth user; unique pair | Role/state, revision; no client-owned promotion fields. |
| Outlet | Tenant + outlet ID | Physical pickup and provider-account binding; proposed multiple outlets per tenant. |
| Contact | Tenant + contact ID | Name, phone, sender/recipient flags, archive/revision; phone is not a unique person identifier. |
| Contact address | Tenant + contact ID + address ID | Address label/text, optional destination identity, primary/archive/revision; composite parent FK. |
| Shipment | Tenant + outlet + shipment ID | Draft revision and submission/payment/delivery state references. |
| Party/pickup snapshot | Tenant + shipment + snapshot ID | Exact submitted sender/recipient/pickup details and source references/revisions; historical display does not join mutable contact values. |
| Estimate snapshot and service | Tenant + shipment + account authority version | Request revision, origin/destination IDs, amounts/units, timestamp and normalized provider service. |
| Provider connection binding | Tenant/outlet → provider account | Non-secret account reference, environment, capabilities, authority/credential version; encrypted secret storage is private. |
| Provider operation / outbox | Tenant + shipment(s) + operation ID | Actor, account/version, idempotency, immutable input digest, dispatch attempt, guarded state, recoverable handoff. |
| Provider order snapshot | Tenant + shipment + account + provider order | Provider order/batch identifiers, `cnote_no`, paid state, observed/resolved timestamps and bounded normalized result. |
| Customer sender mapping | Tenant + contact + account + source revision | Saved provider dropshipper ID and canonical name/phone; changes create/revalidate mappings rather than mutating unrelated historical identities. |
| Label job | Tenant + shipment + account + format + generation ID | Pending/processing/completed/failed, metadata and document reference. Signed download capabilities are transient secrets, not list DTOs. |
| Print attempt | Tenant + shipment/label + actor + attempt ID | Request sequence, allowed/blocked outcome, timestamp; not proof of physical printing. |
| Audit event | Tenant/object + actor or machine + event ID | Command/outcome/reason/correlation with minimal metadata; no full contact or credential payload. |

Use composite unique parent keys and composite foreign keys where records have
tenant-owned parents. Restrict changes to ownership/authority columns; RLS row
visibility alone is not a prohibition on reparenting. Include indexes for active
membership lookup, scoped search/pagination, pending operations, and parent joins.
Choose exact PostgreSQL types and indexes in reviewed migrations, not this table.

## DATA-2 — Snapshots, versions, and state dimensions
- Status: Proposed
- Owner: Engineering owner
- Source: CTX-3, CTX-11.
- Statement: Shipment mutation and provider results shall preserve versioned submitted authority and distinguish submission, payment, label-generation, and delivery state.
- Acceptance: Editing/archiving a contact or replacing a connection cannot rewrite a submitted shipment; a stale draft/quote command is rejected and an out-of-order delivery update cannot regress a terminal state.
- Constraints: PR-5, PR-7, TD-3, SEC-2, PRIV-1.
- Evidence: Reference snapshots observed; new state machine unimplemented.

| Dimension | Proposed values / interpretation |
|---|---|
| Submission | Draft, estimated, queued, in flight, unknown, issued, failed; exact provider-facing transition mapping requires verified fixtures. |
| Provider payment | Unknown/not applicable, unpaid, paid; an existing unpaid order is not a failed create request. |
| Delivery | Unobserved, picked up/in transit/delivered/problem/RTS categories as verified; do not copy invented or discontinued courier vocabularies. |
| Label generation | Pending, processing, completed, failed; separate from whether a physical print occurred. |

Persist timestamps with timezone and record distinct created/submitted/resolved
events. Store customer-charge amounts as whole IDR with bounded exact arithmetic
and explicit bigint serialization where needed. Preserve authoritative provider
amounts using their verified decimal precision under DATA-5, including fractional
fees; never round evidence merely to fit a customer display. Keep internal weights
in grams and convert once at the verified provider boundary; no float-money math. Current numeric
limits in LegacyReference are candidates for validation, not approved new limits.

Provider side effects cannot participate in a single database rollback. Durable
intent, response persistence, and reconciliation model that uncertainty rather
than claiming an impossible cross-system atomic transaction.

## DATA-3 — Account identity and sender mappings
- Status: Proposed
- Owner: Engineering owner
- Source: CTX-5, CTX-9, CTX-11.
- Statement: Provider data shall distinguish a stable actual-account identity from tenant/outlet binding and credential version, and every sender/order/label lookup shall validate all applicable scopes.
- Acceptance: Multiple outlets and credential versions of one tenant account obey the same coordinator/quota; a different tenant cannot bind that account under the recommended ownership model, and changing account cannot reuse old dropshipper/label authority. Cross-tenant account sharing requires a separately accepted model.
- Constraints: TEN-2, TD-2, TD-3, SEC-1. How the intended account identity is established remains a mandatory onboarding decision.
- Evidence: Proposed adaptation; no provider identity response is assumed.

Do not use raw API keys as object names, public identifiers, or correlation
values. Credential rotation and account change are different events. Never infer
the true account from different outlet IDs or private secret-reference strings.
A platform-account authority record belongs to a private control boundary;
tenant users see only their safe binding/readiness projection. CTX-9 must decide
the supported ownership modes before executable account tables are finalized.

## Migration and lifecycle boundary

Use one fresh Supabase migration history for accepted contracts; do not run the
reference Drizzle migrations against the new project. Retain useful constraints
after adapting identity and policies. No automatic import of old contacts,
users, credentials, or orders is authorized. Retention, erasure, and archiving
follow PRIV-1 rather than the old product's five-year/90-day policy.
Ledger, COD settlement, reconciliation finance, analytics materialization, and
bulk-preview persistence activate only when their requirements are accepted.

## DATA-4 — Seller binding, agreement, and credential operation history
- Status: Proposed
- Owner: Engineering owner
- Source: CTX-17, CTX-9.
- Statement: Tenant seller onboarding and key lifecycle shall preserve immutable provider identity, explicit connection mode, accepted account-owner agreement, versioned private secrets, and recoverable external-operation state.
- Acceptance: Duplicate external IDs/managed seller bindings fail safely, a contact/staff ID cannot become onboarding authority, no API/secret projection is exposed through the Data API, and interrupted onboarding/rotation can resume without changing seller identity or losing a known result.
- Constraints: PR-17, PR-18, PR-19, PR-20, TD-7, TD-8, TEN-3, PRIV-2.
- Evidence: Proposed logical additions; no executable table/migration exists.

| Logical record | Required information / invariant |
|---|---|
| Partner environment | Private configuration reference, Partner ID, confirmed origin, quota entitlement and egress readiness; global Partner Secret remains a Worker binding |
| Tenant seller binding | Tenant, mode `partner_created` or `existing_byok`, provider environment, stable local account ID, sellerId when verified, stable externalUserId for managed onboarding, owner name/email/phone, binding revision and status |
| Account-owner agreement | Tenant/actor/account owner, accepted Terms/Privacy URLs and version/digest, disclosure version, affirmative acceptance time; access/retention under PRIV-2 |
| Credential versions | Private encrypted API key and independently versioned webhook secret, encryption-key version, credential revision/status and rotation operation; no key fragment readback |
| Onboarding/credential operation | Reuse durable operation-history pattern with an explicit typed target: tenant connection/account, not a fake shipment. Include actor, agreement/input digest, environment, stable external ID/seller, attempt/fence, result code, next retry, unknown/blocked state |

For managed sellers, enforce unique `(partner_environment, externalUserId)` and
`(provider_environment, sellerId)` in the private authority model, plus one
active binding per tenant/environment under the selected product policy.
Multiple outlets can reference that tenant binding; foreign tenants cannot.
Key version changes do not create new seller IDs or new coordinator identities.
A seller account replacement requires explicit new authority and preserves
historical shipment bindings.

For BYOK, a vendor key alone does not establish a canonical seller identity.
Select a verified identity/owner-binding mechanism before enabling it; reject
unverifiable or duplicate account bindings rather than assuming each key is a
new account. No account-identity endpoint is invented in this draft.

Keep provider account restriction, local tenant lifecycle, onboarding state,
credential state, and individual shipping/sender/label/webhook capabilities
separate. `connected` is not `all_capabilities_ready`. Private operation results
may contain secrets; ordinary audit/outbox DTOs must contain only safe references.

## DATA-5 — Versioned price facts and financial visibility
- Status: Proposed
- Owner: Engineering owner
- Source: CTX-25, CTX-26, CTX-27, CTX-28.
- Statement: Price facts shall distinguish normal customer tariff, assigned/verified net provider cost, customer/provider COD and insurance components, payer/inclusion semantics and confirmation authority, with private cost/assignment data unavailable through operator-readable projections.
- Acceptance: Editing current prices/contact data cannot rewrite submitted amounts; a missing fee/cost remains unknown; normal/cargo and estimate/order facts cannot be mixed; direct operator table/view/RPC reads cannot recover private cost/payout fields.
- Constraints: PR-22, DATA-2, DATA-3, TEN-1, IAM-5, SEC-1. Exact SQL and enabled collection modes remain implementation decisions after policy selection.
- Evidence: Logical addition only; no schema migration or live price record created.

Extend existing estimate/party/provider snapshots rather than adding a general
pricing engine. Record tenant/outlet, stable seller/account and quote authority,
service/tier, currency/units, phase, source fields, customer shipping/collection,
goods included in collection, fee basis/rate or authoritative fee, explicit
included components, rounding, policy version and observed/confirmed time.
Private provider normal/special/deducted cost and optional payout/spread facts
must be in a separately protected record/projection, with amount provenance.

Row-level tenant visibility alone cannot hide selected columns from an
operator who may read the row. Keep private monetary columns outside the
operator-readable Data API table/view, or use an equivalently verified narrow
role-checked projection with no raw-table bypass. Demo values remain synthetic.

Whole-IDR customer charges use exact integer arithmetic. Preserve verified
provider decimal precision separately whenever provider amounts are recorded;
the reference uses four decimal places and rounds only at presentation/aggregate
boundaries. Do not truncate provider evidence to a whole rupiah or assume those
four decimals are a universal future provider limit.

For full COD across several customer senders, retain the submitted sender/goods
ownership reference. A customer-payables/settlement ledger is conditional on its
financial contract; it cannot be inferred from this snapshot table or a margin
number. No financial record or liability workflow is implemented by this draft.

### Selected pricing fields and discount assignment

Extend the existing price snapshot with normal shipping R, verified net shipping
N, separate customer/provider fee and insurance amounts, explicit inclusion and
collection channel, insurance selection/coverage/declared value, quote time and
source/phase, confirmed amount and observed actual-charge adjustment. Customer
label amounts read the frozen retail projection, not the net record. Keep null
(unknown) distinct from verified zero and not-applicable.

A proposed private discount assignment records tenant + actual provider account,
negotiated terms/reference, covered courier/service/tier, effective period,
version, authorized actor/audit, provider activation evidence and status
(pending, verified-active, mismatch, expired or suspended). The terms may cover
shipping, COD fee or insurance only as explicitly negotiated; no automatic
cross-component percentage application. Exact types/constraints remain a
reviewed migration concern. Assigned policy and observed provider net quote are
separate facts, both referenced by confirmation; a later edit cannot rewrite a
previous quote or submitted amount. Enforce tenant/account scope and prevent
overlapping active authority with ambiguous terms.

## DATA-6 — Platform governance, monitoring and audit scope
- Status: Proposed
- Owner: Engineering owner
- Source: CTX-29, CTX-30.
- Statement: Platform administration shall persist governed grants/review decisions/audit and expose minimal explicit-scope monitoring projections, separately from tenant-operational raw data.
- Acceptance: Public/tenant/demo identities cannot write or read privileged grant/control records; platform projections omit customer/credential payloads, command targets/versions cannot be substituted, and every completed local or external decision has one truthful durable outcome/history.
- Constraints: PR-15, PR-23 through PR-28, TEN-4, IAM-7, SEC-4. Logical model only; no remote database/table/grant is created.
- Evidence: Reference control/projection patterns; target schema and query checks pending.

| Logical owner / record | Essential data and invariant |
|---|---|
| Platform grant | Supabase user reference, active/revoked state, approved capability set, revision, grant/revocation actor/reason/time; server-owned and unavailable to public signup/metadata writes |
| Tenant business projection | Tenant name/lifecycle, minimum authorized owner contact, outlet/member counts and readiness summary; no sender/recipient contact directory |
| Tenant review decision, if enabled | Tenant/application revision, decision/reason, actor/time and idempotent request reference; provider onboarding status remains a separate record |
| Monitoring projections | Defined current-state or event-period aggregates plus tenant/object correlation, safe status/code, age, account/mode/version and observed time; no raw provider bodies or customer values |
| Recovery request | Reuse typed durable operation history: original operation/account, requested permitted reconciliation/resume, actor/scope/revision, reason, attempt and result; cannot become a generic write target |
| Platform audit | Global or explicit target tenant/account/object, actor/capability, action, before/after revision, reason/outcome/correlation and time; append-only, no raw secret/PII body |

Existing provider bindings/operations and DATA-5 discount assignments remain the
source of account and price facts; do not duplicate them into a second admin
state model. Platform events may have no tenant target for genuinely global
work; tenant-targeted events preserve a validated tenant relationship. Restrict
which callers can append/read these events, not only which UI renders them.

Use indexed scoped pagination and bounded aggregates first. A platform read
view is not automatic permission to join full tenant/contact/financial tables.
A protected projection or narrow reviewed function must enforce the actual
platform grant/capability and assurance at the exposed database boundary.
Retention/export/support-data policy is selected before those capabilities are
enabled; immutable audit does not mean unlimited legal retention is assumed.

## DATA-7 — Application and invitation lifecycle records
- Status: Proposed
- Owner: Engineering owner
- Source: CTX-31, CTX-32, CTX-34; PR-29 through PR-32.
- Statement: Onboarding and invitations shall persist bounded versioned application state, scoped decisions, idempotent command receipts and explicit acceptance independently of Supabase Auth credentials and seller provisioning.
- Acceptance: Unique same-application submissions and invitation acceptance converge once; invalid/foreign revisions and roles fail; rejected application history cannot erase or reassign Auth identity, seller or another tenant membership.
- Constraints: TEN-5, IAM-8, SEC-5, PRIV-3, DATA-1, DATA-4, DATA-6; logical names only, no migration created.
- Evidence: Proposed entity/constraint model; database checks not executed.
- Change history: 2026-10-13 — Added in the registration and documentation-completeness review.

| Logical record | Ownership, minimal facts and invariants |
|---|---|
| Application account completion | Auth-user reference, server-owned pending/completed state and completion/security revision; initial completion follows fresh inbox proof and explicit password establishment; pre-completion sessions cannot inherit later business authority; never infer from writable Auth metadata or presence of an Auth row |
| Registration application | Verified applicant auth-user ID, server-issued application ID, business/owner/contact fields, revision, application state, policy/acceptance reference, intended tenant/outlet references when committed; applicant cannot set owner/role/activation columns |
| Application submission/decision | Immutable submitted revision and reviewer/policy decision, safe reason, actor/time, expected revision and command receipt; DATA-6 platform review refers to this record rather than a competing queue |
| Initial tenant bundle | Provisioning tenant, first tenant-admin membership and initial outlet with composite ownership keys; commit with application submission and audit once; incomplete pickup means not ready |
| Application policy acceptance | Authenticated actor, document identifier/URL/version or digest, purpose, time and application revision; distinct from DATA-4 Mengantar consent; avoid collecting raw IP/device records without a selected purpose/retention |
| Staff invitation | Tenant, normalized intended email, allowed role/outlet scope, issuer, state/revision, expires-at, acceptance user/time, revocation and delivery state; no active membership before acceptance |
| Invitation lookup capability | If a secret link token is used, store only its digest and require independently verified intended email; public ID is never sole authority; no raw link/code in audit, analytics or fixtures |
| Registration command receipt | Actor + command type + idempotency reference, input digest/version, result reference and outcome; same key/different payload is a conflict, not a silent update |

Proposed invitation states: pending, accepted, revoked and expired. Delivery
attempt status is a separate dimension: accepted mail is not accepted membership.
Acceptance/revocation uses a transactional current-state guard. Duplicate invites
reuse/revoke according to the selected policy; accepting an invitation never
silently upgrades an existing membership. Invitation lifetime and safe retention
are explicit implementation gates, not imported reference constants.

Application states follow the PRD. Rejected/withdrawn applications retain only
the selected bounded history; they do not delete an Auth identity that may have
other memberships. Corrections/resubmission create a new submitted revision.
An already approved application is not edited retroactively. Do not enforce a
global unique owner email on tenants: one identity may have explicit memberships
in multiple businesses. A proposed one-open-application rule is separate.

### Authoritative application transition table

This proposed table owns the transition contract referenced by PR-30/TD-11/UX-7.
All writes compare the expected application revision and current authority;
a receipt replay returns historical outcome plus current state, never a new effect.

| From | Actor and guarded command | To / committed effect |
|---|---|---|
| No application | Eligible completed applicant explicitly starts gerai setup | `setup_draft`; no tenant/member/outlet bundle |
| `setup_draft` | Same applicant saves permitted fields | `setup_draft`, next editable revision only |
| `setup_draft` | Same applicant submits valid current fields and required acceptance | `submitted`, immutable review snapshot and initial provisioning bundle once |
| `submitted` | Granted reviewer requests corrections with safe reason | `changes_requested`; keep submitted snapshot and provisioning bundle |
| `changes_requested` | Same applicant saves corrections | Remains `changes_requested`; editable revision changes, prior submitted snapshot stays immutable |
| `changes_requested` | Same applicant explicitly resubmits valid current revision | `submitted`; new immutable review snapshot, same tenant/member/outlet references |
| `submitted` | Current reviewer approves current snapshot under selected manual policy | `approved`; activate an eligible provisioning tenant and record decision atomically |
| `submitted` | Selected automatic policy evaluates the same valid snapshot | `approved` and eligible activation with policy/version evidence; no fictitious reviewer |
| `submitted` | Current reviewer rejects with safe reason | `rejected`; retain history/provisioning references, no shipping access |
| `setup_draft`, `submitted` or `changes_requested` | Applicant withdraws only if withdrawal policy is accepted | `withdrawn`; invalidate pending review eligibility, retain required history; never delete Auth or other memberships |
| `approved`, `rejected`, `withdrawn` | Replay or attempted ordinary edit | No retroactive edit/re-activation. Approved changes use governed settings; rejected/withdrawn reapplication needs an accepted policy |

Submitted revisions are read-only to the applicant; requesting corrections is
an explicit reviewer transition. A stale approval after correction/resubmission
must fail, as must any attempt to reactivate a suspended/archived tenant through
application approval. On approval, atomically apply the allowed business/outlet
fields from the current reviewed snapshot (or make that approved revision their
canonical reference). Preserve immutable tenant/member/outlet IDs and provider
bindings; applicant fields cannot set lifecycle or authority. Corrected fields
must not leave the active tenant displaying the original rejected values.
All initial activation paths, including generic lifecycle administration, require
the approved application/current policy outcome. Rejected, withdrawn, submitted
or changes-requested applications cannot be activated through a lifecycle shortcut.
Later suspension/reactivation preserves the valid initial approval and independently
rechecks current lifecycle authority. Tenant lifecycle commands remain PR-15. Under the manual
pilot proposal, no automatic approval path is enabled.

Invitation acceptance is similarly terminal for that invitation. Replaying an
accepted invitation after the resulting membership was deactivated or revoked
returns its historical acceptance and current denied/access state; it never
recreates/reactivates membership. Restoration needs an explicitly authorized
membership action or a new eligible invitation under the selected policy.


Never store Supabase passwords, password hashes, OTPs, refresh tokens or sessions
in these application records. Credential-readiness hints are server-owned safe
projections only; they do not replace Auth. Uncompleted application/invitation
retention and identity-erasure consequences require PRIV-3 policy acceptance.
