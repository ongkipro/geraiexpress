# GeraiExpress — Data Model

- Status: Proposed logical model with Observed local SQL implementation; amended 2026-10-29 for DEC-006, DEC-016, DEC-017, DEC-020, DEC-021 (ADR-0002), CTX-41, CTX-42 and the 2026-10-28 review (DATA-4, DATA-5, DATA-8 to DATA-10); each statement is labelled Observed, Decision, Proposal or Unknown.
- Owner: Engineering owner
- Updated: 2026-11-02
- Basis: CTX-3, CTX-11, CTX-13, CTX-41, CTX-42; reference schema/repositories; local migrations in `db/foundation/20261001000000_pg_foundation.sql` and `db/migrations/` through `20261029100000_auth_core.sql` (35 files total, applied by `scripts/db-migrate.sh`). Built-state evidence below is not a deployed-schema claim.

## DATA-1 — Tenant-owned entities and relationships
- Status: Proposed
- Owner: Engineering owner
- Source: CTX-1, CTX-3, CTX-11.
- Statement: Persisted operational entities shall carry explicit ownership and database-enforced same-tenant relationships, with authentication identity (`auth.users`, DEC-021, ADR-0002; formerly Supabase identity) separate from contacts.
- Acceptance: Local schema checks reject a contact address, shipment, snapshot, or label bound to another tenant's parent, including a direct insert/update through the PostgREST Data API.
- Constraints: TEN-1, IAM-1, PRIV-1. Cardinality/permissions remain proposed.
- Evidence: Reference composite foreign keys observed; GeraiExpress schema not created.

Names below are proposed logical entities, not existing tables or promised SDK APIs.

| Entity | Ownership and keys | Essential information / relationship |
|---|---|---|
| Application profile and auth state | `auth.users`, `auth.sessions`, `auth.otp_codes`, `auth.mfa_factors` (schema `auth`, `db/foundation/20261001000000_pg_foundation.sql` and `db/migrations/20261029100000_auth_core.sql`, ADR-0002); not tenant-owned customer data | Identity state, `scrypt` password hash, server-held sessions with SHA-256 refresh hashes, HMAC code digests and AES-GCM sealed TOTP factors; all `auth.*` table privileges are revoked from API roles and accessed only through 14 `service_role`-only `public.auth_*` RPCs. |
| Tenant | Business access boundary | Name, immutable `slug`, `shipment_prefix`, `contact_whatsapp`, `masking_allowed`, branding reference, lifecycle. Observed on disk (`db/migrations/20261028120000_tenant_slug_reference.sql`, `20261028150000_masked_label.sql`): `name`, `lifecycle`, `is_demo`, `slug`, `shipment_prefix`, `contact_whatsapp`, `contact_whatsapp_revision` and `masking_allowed` exist (DATA-8, DATA-10). |
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
| Customer sender mapping | Deferred (DEC-013, DEC-017): provider dropshipper master mapping is not used; the printed sender is local (DATA-10) | No table is created for it. Tenant + contact + account + source revision would be the key if a provider sender identity is ever accepted. |
| Label job | Tenant + shipment + account + format + generation ID | Pending/processing/completed/failed, metadata and document reference for the deferred provider PDF path (gated on Mengantar whitelisting, TASKS Deferred) and for the simulated sample label. Observed: `public.label_jobs` (state, format, `is_simulated`). Signed download capabilities are transient secrets, not list DTOs. |
| Print attempt | Tenant + shipment/label + actor + attempt ID | Request sequence, allowed/blocked outcome, timestamp; not proof of physical printing. For the masked label this is the append-only print history in DATA-10. |
| Audit event | Tenant/object + actor or machine + event ID | Command/outcome/reason/correlation with minimal metadata; no full contact or credential payload. |
| Gerai discount terms | Tenant or platform template + provider environment + version | Basis points, effective date, source reference, status per value, actor; DATA-9. Private; no operator projection. |
| Masked label snapshot | Tenant + shipment + snapshot ID | Immutable printed content (mask switch, printed sender, AWB barcode value, size, template version); DATA-10. |
| Shipment reference counter | Tenant + day | Last allocated sequence for the per-day reference; DATA-8. |
| Mengantar area catalogue | Shared provider reference data; **no tenant owner**; `public.mengantar_areas`, primary key `id` (original Mengantar 24-hex `_id`) | T-100, owner request 2026-11-05: province/city/district/subdistrict (1–160 characters), postal code (five digits or empty), `dataset_version`, generated lowercase `search`. RLS enabled, no direct API-role grants; bounded authenticated `search_mengantar_areas(text, integer)` verifies active membership, demo included. Owner-run `scripts/load-mengantar-areas.mjs` validates and upserts the committed 79,391-row 2026-10-30 99ribu harvest, never deleting omitted historical ids. Defined on disk in `20261105100000_mengantar_area_catalogue.sql`; application/execution remains a verification gate, not a deployed-schema claim. |

T-100 reference-data boundary: the local catalogue is an incomplete, versioned search aid,
not an authority over Mengantar quote/order validity. The area route reads it first with the
user JWT; only an empty catalogue result for a connected non-demo gerai falls back to live
Mengantar `GET /address/search`. Provider ids remain unchanged in shipment/contact fields;
there is deliberately no foreign key requiring historical or live-fallback ids to be present
in the local harvest. Refresh/new harvest requires owner approval; see
`data/mengantar/README.md` for provenance, approximately 435 unmatched Kepmendagri districts
and capped-query gaps. Demo route access is enabled while demo intake retains free-text areas.

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
tenant users see only their safe binding/readiness projection. Decision (DEC-006,
accepted 2026-10-14): one tenant business owns exactly one Mengantar seller
(Partner-created or BYOK), all outlets of the tenant map to it, and there is no
central platform seller or silent fallback; DATA-4 holds the integrity rules.

## Migration and lifecycle boundary

Use one fresh PostgreSQL migration history (`db/foundation/` and `db/migrations/`,
applied by `scripts/db-migrate.sh` with the checksum ledger `private.schema_migrations`,
DEC-021, ADR-0002; renamed from `supabase/migrations/` in T-064/T-066); do not run the
reference Drizzle migrations against the new project. Retain useful constraints
after adapting identity and policies. No automatic import of old contacts,
users, credentials, or orders is authorized. Retention, erasure, and archiving
follow PRIV-1 rather than the old product's five-year/90-day policy.
Ledger, COD settlement, reconciliation finance, analytics materialization, and
bulk-preview persistence activate only when their requirements are accepted. Decision
(DEC-016): the first release collects no platform fee from the gerai and builds no
platform ledger.

## DATA-4 — Seller binding, agreement, and credential operation history
- Status: Proposed logical contract; Observed local implementation includes machine-only seller binding, provider-environment scope and key ring (T-032, T-034, T-039, T-050, wave F); T-054/T-057 also implement durable stops, TOTP recency, SQL consent-version enforcement, caller-environment checks and rotation-outcome fencing locally
- Owner: Engineering owner
- Source: CTX-17, CTX-9.
- Statement: Tenant seller onboarding and key lifecycle shall preserve immutable provider identity, explicit connection mode, accepted account-owner agreement, versioned private secrets, and recoverable external-operation state.
- Acceptance: Duplicate external IDs/managed seller bindings fail safely, a contact/staff ID cannot become onboarding authority, no API/secret projection is exposed through the Data API, and interrupted onboarding/rotation can resume without changing seller identity or losing a known result.
- Constraints: PR-17, PR-18, PR-19, PR-20, TD-7, TD-8, TEN-3, PRIV-2.
- Evidence: Observed (2026-10-28, local): `20261028230000_environment_scope_key_ring.sql` adds `provider_env` (`sandbox`/`production`, default sandbox) to private credentials/onboarding, active-credential uniqueness per tenant/environment and seller-id uniqueness per environment. Its backfill assumes all existing rows are sandbox and must be checked before applying to another database. Machine key reads/claims are environment-scoped. F1's `20261028250000_reconcile_across_key_regeneration.sql` permits only same-tenant/same-environment Partner-key substitution for original-operation recovery, blocks onboarding in `rotation_unknown` and refuses rewrap downgrade. Tests: environment-scope, key-regeneration-reconcile, credential-keyring (worker-reported). T-054/T-057 subsequently add SQL caller `p_env` and consent-version enforcement, durable Partner stops and rotation-outcome fencing, plus hourly environment-scoped rewrap. Deployment verification, a separate staging database and supervised provider capture remain unproved.
- Change history: 2026-10-28 — Added the seller-binding integrity subsection below for review P0-1 (a tenant admin could bind another tenant's seller). Scope by provider environment added for review P1-13.

| Logical record | Required information / invariant |
|---|---|
| Partner environment | Private configuration reference, Partner ID, confirmed origin, quota entitlement and egress readiness; global Partner Secret remains a server-only environment secret (DEC-020; formerly a Worker binding) |
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

### Seller-binding integrity (review P0-1; TASKS T-032, T-034)

Observed historical gap (before T-032/T-050, not current state): the original onboarding
writers accepted authenticated callers' seller ids without binding uniqueness or environment
scope. T-032 made the writers machine-only, added write-once uniqueness and the application server's
`sellers/list` ownership proof; T-034 added the expected-version fence; T-050 scopes credentials
and seller-id uniqueness by provider environment. Current definitions are in migrations
`20261028100000_partner_seller_binding.sql`, `20261028230000_environment_scope_key_ring.sql`
and `20261028250000_reconcile_across_key_regeneration.sql`; user sessions cannot call the
machine writers. Bindings written before T-032 still require operator verification before
a shared-environment migration; no historical binding was silently declared verified.

Required invariants (Decision for the direction in DEC-006 and DEC-010; Proposal for
the mechanism):

1. **Machine-only writers.** Both RPCs are executable by `service_role` only, called
   through the machine client after the user-session tenant-admin check, like
   `dispatch_*` (DEC-010). No user-callable path accepts a seller id.
2. **Unique per environment.** Unique `(provider_environment, partner_seller_id)`
   where the id is not null, so one Partner seller binds to one tenant in one
   environment. A sandbox seller never satisfies a production binding (review P1-13).
3. **Write-once.** After the id is set no caller can change or clear it; replacement
   is an explicit governed action with new authority that preserves historical
   shipment bindings.
4. **Ownership proof before key access.** The application server opens or seals a seller key only
   after the Partner seller list filtered by the server-derived
   `externalUserId = geraiexpress:tenant:<tenantId>` returns exactly the stored id; a
   mismatch makes no `sellers/api-key` call and no completion write.
5. **Version fence.** Completion carries the expected credential version and raises
   `stale_state` on mismatch, mirroring `store_seller_credential` (review P1-4).
6. **Projection.** The seller id and owner details are returned to tenant admins only,
   never to every member (Observed: implemented by `partner_onboarding_status`).
7. **Proof.** Tenant B's admin calling either RPC with tenant A's seller id gets 42501
   and no row changes; a mismatching seller list never reaches `sellers/api-key`.

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
number. Decision (DEC-016): no platform ledger and no platform fee record exist in the
first release. No financial record or liability workflow is implemented by this draft.

### Selected pricing fields and discount assignment

Extend the existing price snapshot with normal shipping R, verified net shipping
N, separate customer/provider fee and insurance amounts, explicit inclusion and
collection channel, insurance selection/coverage/declared value, quote time and
source/phase, confirmed amount and observed actual-charge adjustment. Customer
label amounts read the frozen retail projection, not the net record. Keep null
(unknown) distinct from verified zero and not-applicable.

Superseded in part by DATA-9 (2026-10-28): the discount assignment is the versioned
terms record defined there (integer basis points, effective date, source reference,
status owner-stated, provider-observed or provider-verified, audit actor). The
earlier per-courier/service/tier scoping and the pending, verified-active, mismatch,
expired and suspended status list are replaced by that model and by the observed
provider percentage recorded per quote. Assigned terms and the observed provider net
quote remain separate facts, both referenced by confirmation; a later edit cannot
rewrite a previous quote or submitted amount. The terms may apply to shipping only: no
automatic percentage on COD fee or insurance (DEC-003, TD-9).

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
| Platform grant | `auth.users` reference, active/revoked state, approved capability set, revision, grant/revocation actor/reason/time; server-owned and unavailable to public signup/metadata writes |
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
- Statement: Onboarding and invitations shall persist bounded versioned application state, scoped decisions, idempotent command receipts and explicit acceptance independently of authentication credentials (`auth.users`, `auth.sessions`, `auth.otp_codes`, DEC-021; formerly Supabase Auth) and seller provisioning.
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


Never store passwords, password hashes, OTPs, refresh tokens or sessions in these
`public` onboarding/invitation records: they live exclusively in schema `auth`
(as `scrypt` password hashes, HMAC code digests, SHA-256 refresh hashes and
AES-GCM sealed TOTP secrets, ADR-0002), with no API-role table grants. Credential-readiness hints are server-owned safe
projections only; they do not replace the auth store. Uncompleted application/invitation
retention and identity-erasure consequences require PRIV-3 policy acceptance.

## DATA-8 — Tenant slug, shipment reference and seller-binding keys
- Status: Decision (CTX-41 items 2, 11 and 12, accepted 2026-10-28); slug/prefix/counter built (T-049), per-provider-environment seller key built (T-050); no production deployment claimed
- Owner: Engineering owner
- Source: CTX-41 items 2, 11 and 12; PR-37; review P0-1, P1-13 and the 24-bit reference note (section 3, P3); TASKS T-032, T-042, T-044.
- Statement: A tenant shall have an immutable, unique, lower-case `slug` and a per-tenant shipment prefix; each shipment reference shall come from a per-tenant per-day counter allocated under a row lock; and each Partner seller shall bind to at most one tenant per provider environment.
- Acceptance: A second tenant with the same slug, a slug update, a reserved or malformed slug, and a duplicate seller binding in the same provider environment are each rejected by the database; two concurrent drafts for one tenant on one day receive distinct sequences with no unique-violation error; an existing reference is not rewritten.
- Constraints: DATA-1, DATA-4, TEN-1, TEN-6, DEC-006; the slug is display, reference-prefix and support-lookup data and never authorizes anything.
- Evidence: Observed (2026-10-28, local): slug, prefix and counter tests cover format, reserved/keyword refusal, immutability, uniqueness and concurrent drafts (T-049). T-050 migration `20261028230000_environment_scope_key_ring.sql` adds immutable onboarding `provider_env`, environment-qualified seller-id uniqueness and one active credential per tenant/environment; tests/db environment-scope exercise sandbox/production separation (worker-reported). This does not provide separate staging infrastructure.

**Tenant slug.** Decision (CTX-41 items 2 and 11, accepted 2026-10-28): immutable, unique, lower-case, never an authorization input; format `^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$`; reserved names `www`, `app`, `owner`, `hooks`, `api`, `admin`, `mail`, `status`, `static`, `assets`, `staging`, `preview`, `demo`, `support` and the repository's blocked marketing keyword are refused; the display name stays editable while the slug is not. Observed (2026-10-28, `db/migrations/20261028120000_tenant_slug_reference.sql`, `20261028210000_catalog_slug_lock_fixes.sql`): `public.tenants.slug` is set by the `tenants_identity` trigger at insert when absent, so at approval and by the system rather than by the applicant or the reviewer; it is generated from the business name (accent-folded, hyphenated, at most 32 characters, a numeric suffix after a collision, a reserved name or a short result; demo tenants get `demo-<8 hex>`), validated against the format, the reserved names and the blocked keyword, unique (`tenants_slug_key`) and immutable (`slug_immutable`, SQLSTATE 55000); existing tenants were backfilled. The earlier Unknown about who chooses the slug is closed in practice; whether a Super Admin should be able to override the generated slug at approval is not decided.

**Shipment reference.** Decision (CTX-41 item 12, accepted 2026-10-28): `<PREFIX>-<yymmdd>-<seq>`, a per-tenant prefix of 3 to 5 upper-case letters and a per-tenant, per-day counter taken under a row lock. Observed (2026-10-28): `tenants.shipment_prefix` is derived from the slug letters by `private.derive_shipment_prefix` (the first four letters, then other windows, then suffixes; never the blocked keyword or `DEMO` for a non-demo tenant), assigned by the same trigger (so at approval, not at a separate activation step), immutable (`prefix_immutable`) and unique across non-demo tenants (partial unique index `tenants_shipment_prefix_real_key`; demo tenants share `DEMO`; DEC-019). This replaces the earlier Proposal that the prefix is immutable only once a shipment exists. `private.reference_counters (tenant_id, day)` is an upsert under a row lock inside `private.next_reference`, called by `create_shipment_draft` and the demo seeding; the day is the Asia/Jakarta date, the sequence has at least three digits and widens past 999. Old-shape references (`GX<yymmdd>-<6 chars>`) are not rewritten, and `unique (tenant_id, reference)` stays; the reference stays separate from the AWB and the database id (TD-1). Demo references repeat across tenants. The one-time backfill re-derives shared prefixes inside the migration with the identity trigger disabled for that block only, and refuses when a new-shape reference already exists.

**Seller binding keys.** Observed: T-050 adds `provider_env` to both private tables, makes the onboarding environment immutable and scopes seller-id uniqueness by `(provider_env, partner_seller_id)`. There is still one onboarding row per tenant; this is not multi-environment onboarding for one tenant.

## DATA-9 — Gerai discount terms and observed provider discount
- Status: Decision (DEC-016, CTX-39, CTX-42; rounding DEC-018); terms, observed-provider column and tenant/admin UI built locally (T-041, T-053); provider verification and environment-scoped terms remain open
- Owner: Engineering owner
- Source: DEC-012, DEC-016; CTX-39, CTX-40, CTX-42; TASKS T-041; docs/review/2026-10-28-full-review.md section 8 item 3.
- Statement: The discount a gerai receives shall be versioned configuration set per tenant by a Super Admin, stored as integer basis points with an effective date, a source reference and a status per value; the platform remainder shall be derived and never typed; the provider discount actually returned shall be recorded per quote; a gerai discount above the provider-observed discount shall be refused by the database; and every rupiah amount derived from basis points shall use integer arithmetic with the discount amount rounded down to whole rupiah.
- Acceptance: A terms row cannot be written without effective date, source reference and status; no writer can set the remainder; an estimate without a provider percentage stores NULL, not zero; a gerai discount larger than the provider-observed discount is refused at the database with a test; a later terms edit changes no stored quote or confirmed amount; the sender-facing price equals the normal tariff in every case; the owner's starting terms exist only as owner-stated configuration, never as a constant in code; the test vectors below pass, including an unknown input yielding NULL instead of 0.
- Constraints: DATA-5, DATA-6, IAM-5, TEN-4, BILL-3, PR-23; DEC-003, DEC-012; no percentage in public marketing until provider-verified; no platform fee and no ledger (DEC-016).
- Evidence: Observed (2026-10-28, local): T-041 terms/ceiling/version-at-quote-time read models plus T-053 migration `20261028240000_discount_recording_and_ui.sql` are built. `private.quote_costs.provider_discount_bps` is nullable, checked 0–10000; `record_live_quotes` keeps six arguments and reads optional per-row `discount_bps`. `discountPercentToBps` accepts whole hundredths of a percent (22.5 → 2250); invalid/absent values stay NULL, present zero stays zero; `discountExtraPercent` is not read. Observations prefer provider bps, otherwise the amount-derived ceil. Tenant-admin-only gerai-cost detail and assigned-terms settings callers exist. Worker-reported coverage: discount-recording DB, gerai-discount DB/e2e and public-api/pricing-display unit tests. Terms themselves have no `provider_env`; no written provider verification or live activation is inferred.

Terms record (private to the platform capability; tenant admins see only their own gerai discount and its status):

| Field | Rule |
|---|---|
| Scope | One tenant, or the platform default template (no tenant), within one provider environment. Decision (DEC-016, T-041): per-tenant terms plus a template. |
| Version | Monotonic per scope; a new version supersedes the previous and at most one version is active per scope (Proposal, following `seller_credentials_one_active`, Observed in `20261014150000_credentials.sql:25-26`). |
| Provider discount | Integer basis points 0 to 10,000; NULL means unknown, never zero. The owner-stated starting value is 3,000 (30%), Observed in CTX-42 as unverified. |
| Gerai discount | Integer basis points 0 to 10,000. The owner-stated starting value is 2,000 (20%). |
| Effective date | Timestamp from which the version applies; each quote records the version it used. |
| Source reference | Required, bounded text naming where the value comes from (for example the written Mengantar confirmation or the owner statement and its date). |
| Status per value | `owner_stated`, `provider_observed` or `provider_verified` (CTX-42). `provider_verified` requires a written Mengantar confirmation named in the source reference (DEC-012). Proposal: the gerai value is a GeraiExpress commercial setting and is expected to stay `owner_stated`; Unknown whether the provider can verify it. |
| Actor and audit | Super Admin actor and time on every create or supersede, plus an append-only audit event (Observed: `public.audit_events` exists, `20261014120000_platform_admin.sql:19-29`). |
| Platform remainder | Derived as provider discount minus gerai discount by a view, function or generated column with no writer; displayed as an estimate unless the provider value is `provider_verified`; a negative result means the terms are invalid and blocked. |
| Variance (derived) | Observed provider discount minus the assigned gerai discount, per tenant, shown to the Super Admin (UX-12). It has no writer, is not collected from or paid to anyone, and is NULL when the observed value is NULL. Decision (DEC-018, BILL-3). |

Observed provider discount per quote (T-053, local): nullable `private.quote_costs.provider_discount_bps` stores the valid estimate `discountPercent`, not `discountExtraPercent`. Absent/invalid or non-hundredth values stay NULL without a per-value log; zero is stored as zero. The earlier proposal to record the extra percentage separately and log invalid percentages is not implemented. The sandbox example in CTX-42 is source evidence, not proof of universal activated terms.

Database rule (Decision for the requirement, DEC-016 and PR-23; Proposal for the mechanism): the database enforces `gerai_discount_bps <= provider-observed discount` where the two facts meet. A table CHECK cannot span tables, so the rule lives in a trigger or the quote and confirm RPCs: it compares the active terms with the quote's observed value at quote recording and at confirmation, and refuses the discounted gerai cost when the gerai value is larger. There is no local subsidy, and the check never rewrites the sender-facing tariff. Unknown (PR-23): when the observed value is NULL, whether a gerai discount may apply; Proposal (PR-23): hold the discount as pending, show the gerai cost as unknown, and let the sender pay the normal tariff as usual.

Computation (Decision for the rule, DEC-018; Proposal for the mechanism): gerai cost = normal tariff minus the gerai discount applied to shipping only, never to COD fee or insurance (DEC-003, TD-9). Every rupiah amount derived from basis points uses integer arithmetic only (no floating point) and rounds the discount amount DOWN to whole rupiah: discount = floor(tariff x bps / 10,000), so the derived gerai cost never understates the provider-observed cost. Any unknown input (tariff, observed provider discount or applicable terms version) yields NULL, never 0. A confirmed shipment stores the terms version and the observed basis points it used; later edits do not rewrite it (DATA-5).

Built state (Observed 2026-10-28; supersedes mechanisms above where different): append-only `public.gerai_discount_terms` stores tenant/template, version, basis points, effective date, source/status, verification reference, observed bps at creation, actor/time. Writes use `platform_set_gerai_discount` (`integration_operations`, `aal2`, advisory lock, expected version, audit); platform read models show observations/history and tenant admins read only assigned bps/status/date. Terms have no provider-environment column. T-053 adds per-quote `provider_discount_bps`; observed bps is `coalesce(provider_discount_bps, ceil((tariff-net)*10000/tariff))`, NULL when no usable observation exists. The latest real batch maximum caps assignments, `provider_observed` must equal it, and an owner-stated assignment without observations may exist but reads unverified. Per-quote effective discount is the lesser of assigned/observed; `gerai_cost_for_quote` selects terms whose effective/created dates precede `quoted_at`, preserves old prices and returns NULL for unknown input. No confirmed terms-version column is added: the quote-time lookup supplies it. Variance is maximum observed minus assigned and remains an estimate until verified. UI callers now render tenant-admin gerai-cost estimates and assigned terms, never the provider percentage or remainder; operators, labels, invoices and CSV have no private cost projection.

Test vectors (Observed 2026-10-28: the discount and cost amounts, the NULL case and the refusal are asserted in tests/db gerai-discount per the T-041 delivery report; the amount-variance figure in row 3 was not separately verified; arithmetic also checked by hand):

| Case | Arithmetic | Result |
|---|---|---|
| Tariff 23,000; 2,000 bps | 23,000 x 2,000 = 46,000,000; / 10,000 = 4,600 exactly | Discount 4,600; gerai cost 23,000 - 4,600 = 18,400 |
| Tariff 12,345; 2,250 bps | 12,345 x 2,250 = 27,776,250; / 10,000 = 2,777.625; floor = 2,777 (remainder 6,250 is dropped) | Discount 2,777; gerai cost 12,345 - 2,777 = 9,568 |
| Tariff 12,345; 3,000 bps observed provider discount | 12,345 x 3,000 = 37,035,000; / 10,000 = 3,703.5; floor = 3,703 | Provider-observed discount 3,703; with 2,250 bps assigned the amount variance is 3,703 - 2,777 = 926 and the basis-point variance is 750 |
| Tariff 23,000; observed provider discount unknown | No computation possible | Variance and derived provider cost NULL, not 0; the gerai cost is shown as unknown (PR-23 pending rule) |
| Tariff 23,000; assigned 3,000 bps; observed 2,000 bps | 3,000 > 2,000 | Refused by the database; no amount is derived |

## DATA-10 — Masked label snapshot and print history
- Status: Decision (label behavior: DEC-017, CTX-39); Proposal (record design, built as described in "Built state"); built (T-044); the acceptance record for the activation statement and retention are not built
- Owner: Engineering owner
- Source: DEC-017, DEC-013; CTX-39; PR-34; TASKS T-044, T-047; PR-3 and PR-6 as amended by DEC-017.
- Statement: Each printable local label shall be an immutable snapshot of what was printed (including the masking choice, the sender block shown, and, stored next to it, the true tenant identity and the pickup identity), and every print request shall append a history row; the label shall carry the courier AWB as a Code128 barcode and shall not depend on the provider PDF or provider dropshipper identity.
- Acceptance: A real shipment yields a snapshot whose barcode decodes to the AWB; reprinting uses the stored snapshot, not current settings; changing the masking switch creates a new snapshot version and leaves earlier ones unchanged; the Mengantar pickup name never appears as the default printed sender; snapshot and history rows cannot be updated or deleted through API roles; a masked snapshot holds the true tenant and pickup identity beside the printed sender and still holds them after the tenant or outlet is edited; a masked snapshot cannot be written for a tenant with `masking_allowed` false, including by a direct RPC call.
- Constraints: DATA-1, DATA-2, PRIV-1, TEN-1, UX-9, UI-6; no provider dropshipper call and no provider PDF call (DEC-017).
- Evidence: Observed (2026-10-28, local, `db/migrations/20261028150000_masked_label.sql`): the tables, commands and label page in "Built state" exist and are tested (tests/db masked-label, tests/unit code128, tests/e2e label on 390 and 1280). The Code128 encoder is `src/lib/label-code128.ts`; the marketing illustration's encoder was removed with T-036. The watermarked sample label for simulated shipments is unchanged.

| Record | Content and invariant (Proposal) |
|---|---|
| Label snapshot | Tenant, shipment, version, AWB and courier, label size (10x15 cm default or 10x10 cm), masking switch value, the printed sender block (gerai name, WhatsApp, pickup address when masking is off; the operator-confirmed name, phone, optional street and area when on, pre-filled from the shipment sender, DEC-025), the true tenant identity (tenant name and slug) and the pickup identity (outlet name, address and area) copied at print time and stored whether or not masking is on, recipient block, template version, creator, time and a content digest. Immutable. Decision (DEC-018): the true identity fields are retained for the audit retention period, which is Unknown and stays for counsel (T-048); the fields are Proposal mechanics. |
| Print history | Append-only: tenant, shipment, snapshot, actor, time, size. It records that a print request was issued, not that paper came out (DATA-1 print attempt). |

The real pickup address stays visible on the shipment detail for returns and is not printed when masking is on (DEC-017). Since DEC-025 (2026-11-04) the shipment itself carries an optional sender street, area and postal code (draft content, never sent to Mengantar) and the masked label prints the confirmed sender street within its limits. Sender fields typed or edited on the label are third-party personal data held only in the snapshot, bounded in length, and never copied into contacts automatically (PRIV-1); a sender address reaches a contact only through the explicit "Simpan sebagai kontak pengirim" choice at intake. The printed sender is never written back to Mengantar. Simulated shipments keep the sample watermark and never produce a real label snapshot.

Source of the printed gerai sender (Decision, PR-34, owner-selected "like the legacy project", 2026-10-28): the gerai name comes from the tenant, the WhatsApp number from the tenant-level `contact_whatsapp` and the pickup address from the outlet; the snapshot copies these values at print time, so a later edit of the tenant or outlet never rewrites a printed label. If `contact_whatsapp` is empty, printing with masking off is blocked. With masking on, the operator-confirmed sender phone is required; gerai WhatsApp/contact is not printed. Proposal (until the migration task is accepted): the field is stored as `0` plus the Indonesian national number (a leading `+62` or `62` becomes `0`), constrained to `^0[2-9][0-9]{7,11}$`, written only by an audited tenant-administrator command and never by a direct browser write, initialized at approval from the application's `contact_phone` (PR-30), and backfilled for existing approved tenants only where that value validates.

Masking policy data (Decision for the policy, DEC-018; Proposal for the fields): masking is a per-shipment choice, off by default, and printing with it on requires the sender name, phone and area (the street is optional, DEC-025); the tenant flag `masking_allowed` (tenant entity) is checked by the snapshot command, which refuses a masked snapshot when it is false; the tenant administrator's acceptance, at activation, of the statement that the tenant is responsible for the accuracy of the sender data and the goods shipped is stored as a versioned acceptance record (actor, time, statement version); the statement wording belongs to counsel (T-048).

Built state (Observed 2026-10-28): `public.label_snapshots` holds tenant, shipment, `version` (unique per shipment), `size` (`10x15` or `10x10`), `template_version`, `mask_sender`, the printed sender name, phone, address and city (a masked row keeps name 2-60, street 5-120 or none, area 2-40: `label_snapshots_masked_sender_tidy`, T-094/DEC-025, replacing the former no-street rule), `true_tenant_name`, `true_tenant_slug`, `true_pickup_name`, `true_pickup_address`, `true_pickup_area`, AWB, shipment reference, courier, service, weight, COD fields, item description, the recipient block, `content_digest` (SHA-256 hex), creator and time; `public.label_print_events` is the append-only history. A trigger blocks update, delete and truncate on both even for a superuser (only a foreign-key cascade from the shipment or tenant may remove rows). `create_label_snapshot` (tenant member; operators print) returns the existing snapshot when the switch, size and sender fields are unchanged, so a reprint is a print event and not a new version, and refuses with `masking_disabled`, `sender_fields_required`, `whatsapp_missing`, `simulated_shipment` or `no_awb`; `record_label_print` appends the history; `masking_allowed` is enforced inside both. `tenants.contact_whatsapp` (CHECK `^0[2-9][0-9]{7,11}$`, with `contact_whatsapp_revision`) is set at approval, backfilled and changed only by `set_tenant_contact_whatsapp` (tenant admin, audited, stale revision: 55000); `tenants.masking_allowed` defaults to true and is changed only by `platform_set_masking_allowed` (`tenant_governance`, `aal2`, exposed on `/admin/tenant/[id]` in T-053). The Proposal rows above are built as stated. The invoice record is a separate append-only table, `public.invoice_snapshots` (T-047): the gerai identity, the sender-facing `shipping_charge_idr` (`customer_charge_idr`, never net cost, discount or remainder), a parties summary without phone or street address, and a `<PREFIX>-INV-<yymmdd>-<seq>` number from `private.invoice_counters`. Not built: the versioned responsibility-statement acceptance record and the retention period (Unknown, T-048).

Gerai logo (Observed locally, T-096, `db/migrations/20261104130000_gerai_logos.sql`): `private.gerai_logo_versions` (tenant, `version`, `mime`, `bytes`, creator, time) is append-only under `private.label_history_guard`, has no API grants, and keeps one current logo as the latest version; a NULL payload is a removal version. `private.gerai_logo_mime` accepts only PNG, JPEG or WebP by magic bytes, 1-204800 bytes (SVG refused). `tenant_logo(tenant)` (member) returns `{revision, logo}`; `set_tenant_logo(tenant, mime, base64, expected_revision)` (tenant admin, audited) requires the current revision (stale: 55000) and both NULL means remove. `label_snapshots.gerai_logo` (jsonb `{version, mime, base64}` or NULL) and `gerai_logo_revision` are captured only on snapshot INSERT by `private.capture_label_logo` under a tenant SHARE lock and enter the content digest, so a replaced or removed logo never rewrites a printed label; older rows keep NULL and print the frozen `true_tenant_name`. Owner decision 2026-11-05 (DEC-017 amendment): masked and unmasked parcels both print the frozen logo, or the gerai name, while a masked parcel still prints no gerai WhatsApp/contact.

### Masking acceptance per courier (amendment to DATA-10 for PR-46)
- Proposal (T-084): `private.masking_acceptance` with `courier`, `state` (`unverified`, `verified`, `refused`), `evidence_ref`, `recorded_by`, `recorded_at`; a missing row or a NULL `label_snapshots.courier` counts as `unverified`. Members read the state through a security-definer RPC `masking_acceptance_for(courier)`. `label_print_events` gains nullable `acceptance_state` and `acknowledged` columns (its update guard stays) and `record_label_print` gains an acknowledgement parameter; the privilege allowlists are updated with the new signatures. Only a platform capability writes the acceptance rows.

## DATA-11 — Counter payment records and cash periods
- Status: T-082 implemented, behaviorally verified and integrated locally (not deployed); verification recorded in STATUS.md; T-083/T-087 remain proposed. Receipt content/identity accepted by the owner on 2026-11-05 (DEC-026).
- Owner: Engineering owner
- Source: PR-38, PR-39, PR-45; DEC-023, DEC-026.
- Statement: Payments taken at the counter shall be tenant-owned, append-only records bound to one shipment and one outlet cash period, with the amount in whole rupiah, the method, the collecting member, the expected charge from the confirmation snapshot and any difference with its reason; cash periods shall total those records and store counted cash and variance when closed.
- Acceptance: A shipment has at most one active payment record (partial unique index on non-voided rows); `record_counter_payment` requires `submission_state in ('queued','in_flight','unknown','issued')` and a non-NULL `customer_charge_idr`, otherwise it raises `charge_unknown`; `expected_idr` is NOT NULL; for an `is_cod` shipment the counter expected amount is 0 because the shipping charge is inside the courier-collected COD amount, and a record is refused (`cod_collected_by_courier`); an extra counter charge for a COD shipment is not part of this contract (it needs its own accepted requirement, PRD pricing table); `reopen_shipment` is refused while an active payment exists (void first); voiding stores actor, time and reason and never deletes; outlet and period are derived from the shipment, never caller-supplied; a closed period accepts no new or changed record; expected cash equals the sum of active cash records in the period; another tenant cannot read or write any row through PostgREST or RPC.
- Constraints: DATA-1, DATA-2, DATA-5, TEN-1, IAM-1, NFR-3. Amounts are `bigint` rupiah; no floating point; no tax column until the tax owner decides (DEC-023 gate on receipt tax wording).
- Evidence: T-082 is implemented and behaviorally verified locally; DEC-026 receipt content/identity is accepted. Source-run evidence and final integration verification are recorded in STATUS.md. Not deployed; physical-printer output is unproved. Cash closing and pilot reports remain T-083/T-087.

| Record | Fields and invariants (cash closing/report remain proposed) |
|---|---|
| `public.counter_payments` | `tenant_id`, `id`, `shipment_id`, `outlet_id`, `period_id`, `method` (`cash`, `qris`, `transfer`, `other`), `amount_idr` (>0), `expected_idr` (NOT NULL; `shipments.customer_charge_idr` at record time, or 0 when `is_cod`), `difference_reason` (required when amount ≠ expected), `cash_received_idr` (cash only, ≥ amount), `recorded_by`, internal `recorded_by_label`, `recorded_at`, `voided_at`, `voided_by`, `void_reason`, `receipt_gerai_name`, nullable `receipt_gerai_whatsapp` (gerai identity frozen at payment time, not confirmation). Writes only through `record_counter_payment` and `void_counter_payment` RPCs (security definer, membership checked, operator may record, tenant admin may void). |
| `public.cash_periods` | `tenant_id`, `id`, `outlet_id`, `opened_at`, `closed_at`, `closed_by`, `counted_cash_idr`, `expected_cash_idr` (computed at close), `variance_idr`. At most one open period per outlet (partial unique index on `closed_at is null`). A payment joins the outlet's open period whatever its WIB day; the first payment with no open period opens one inside `record_counter_payment` (built in T-082). Close and reopen only through RPCs; reopen requires tenant admin, sets `closed_at = NULL` and keeps the earlier close (counts, actor, time, reason) in an append-only `cash_period_events` audit row. |
| Receipt (DEC-026) | Rendered from confirmed shipment facts and active non-COD payment (including payment-time-frozen gerai identity), or COD first-print-frozen identity. Customer print/WhatsApp omit staff; internal collecting-member identity/audit and void summaries stay unchanged. Non-COD adds `No. pembayaran: PAY-` followed by the first eight uppercase payment UUID hex characters. Header adds `Outlet <name>` from frozen `pickup_snapshot.outlet` when present and different from gerai name. Each application print appends to `label_print_events` (`kind = 'receipt'`), a request rather than proof of paper output. |
| COD receipt identity | Nullable `label_print_events.receipt_gerai_name`, `receipt_gerai_whatsapp`: required name/optional WhatsApp on COD receipt rows (`receipt_payment_id IS NULL`), both NULL on label and non-COD receipt rows. First COD print freezes current tenant identity; subsequent events retain it. `/struk` uses the earliest COD receipt identity when present, otherwise previews current tenant settings. `record_receipt_print(uuid,uuid,text,text,text)` is one RPC (no overload): shipment, payment, width, preview gerai name/WhatsApp (last two default NULL for non-COD). It locks the member shipment; on first COD print it SHARE-locks the tenant and compares both preview fields to current settings; on reprint it compares against the frozen event. Stale preview raises `receipt_identity_changed`, appends nothing and returns a Bahasa reload error before any `window.print`. Existing authenticated/member read scope and append-only, RPC-only write grants apply; no provider credentials or private pricing are stored here. |
| Pilot report (PR-45) | Read model over shipments, quotes and payments; earnings = `normal_tariff_idr` − the gerai cost from the terms at `quoted_at` (same per-quote logic as `public.gerai_cost_for_quote`, DEC-018); COD fee and insurance components pass through and are excluded; exposed only through a tenant-admin RPC; the provider net cost and observed percentage never leave the database; unknown gerai cost stays NULL. |
| Access | RLS on for all three tables (`counter_payments`, `cash_periods`, `cash_period_events`); member-scoped reads via `private.is_member(tenant_id)`. For `counter_payments`, grant column SELECT only for payment/receipt facts, not whole-table SELECT: the stored `expected_idr`, `difference_reason` and `void_reason` are tenant-admin-only through a membership- and admin-checked read RPC (IAM-1, UX-17). Members may read the actual amount, method, collecting member/time and active/voided fact for operations and receipts; possible inference from the shipment tariff does not authorize the stored administrative payload. `cash_periods` and `cash_period_events` remain member-readable. No INSERT/UPDATE/DELETE grants; writes only through security-definer RPCs; privilege-catalog allowlists updated with each new RPC. |

## DATA-12 — Public tracking links
- Status: Proposed (PR-40; UX-18; SEC-8); not built; task T-085
- Owner: Engineering owner
- Source: PR-40, PR-12; DEC-023.
- Statement: A tracking link shall be a revocable, unguessable token bound to one shipment, and the public read shall return only a fixed projection of status data and initials.
- Acceptance: The token is `base64url(HMAC-SHA256(TRACKING_TOKEN_SECRET, link_id))` (256 bits; the secret is server-only, SEC-8) and only `sha256(token)` is stored, so a repeat share re-derives the same token; the public read is one security-definer function taking the token and returning the UX-18 projection; it returns nothing for revoked, expired or unknown tokens; the projection type has no column for full names, phones, address, amounts or item description; creating a link is idempotent per shipment (one active link) and audited; RLS on; members SELECT their tenant's rows; no `anon` table privilege; writes through RPCs only.
- Constraints: DATA-1, TEN-1, SEC-8, PRIV-1, PR-12, PR-34. Status timeline rows come from `public.shipment_events` written by T-045; before then the projection returns an empty timeline.
- Evidence: Not built.

| Record | Fields (Proposal) |
|---|---|
| `public.tracking_links` | `tenant_id`, `id`, `shipment_id`, `token_hash` (unique), `created_by`, `created_at`, `revoked_at`, `revoked_by`, `expires_at` (NULL until delivery or return, then 90 days later, within the Art 51 four-month context; T-045 supplies the delivered/returned timestamps) |
| `public.track_shipment(token text)` | Returns gerai display name (NULL when masked; masked = the latest `label_snapshots` row for the shipment has `mask_sender`; with no snapshot yet the gerai name and sender initials are hidden, fail closed; sender initials come from that same snapshot), courier, service, AWB, current status, destination city, sender initials (printed sender when masked), recipient initials, timeline (time, public status, hub city). Public status is mapped from a whitelist of `shipment_events.kind` values; `detail` is never returned; `hub_city` comes from a structured column T-045 adds (NULL before then). Executable by `anon`; added to the `ANON_EXECUTE` allowlist test. |

## DATA-13 — Content declaration
- Status: Implemented locally (owner go-ahead 2026-11-03, T-081 run `RUN-20261103T124731Z-215400e6`); wording provisional until the Mengantar sync
- Owner: Engineering owner
- Source: PR-41; DEC-023.
- Statement: Confirmation shall require and freeze a content description and a declaration acceptance referencing the declaration text version.
- Acceptance: The declaration is recorded only inside `confirm_shipment` (new parameter `p_declaration_version`; `content_declared_by = auth.uid()`, `content_declared_at = now()`), never through a column grant; confirmation is refused without `item_description` or a valid current declaration version; the snapshot keeps version, member and time; declaration texts are versioned rows with RLS on, SELECT `using (true)` for `authenticated`, and writes only by a platform capability; the privilege allowlist and TypeScript callers are updated with the new signature.
- Constraints: DATA-2, PR-7, IAM-1.
- Evidence: Migration `20261103110000_content_declaration.sql`: append-only `public.declaration_texts` (RLS, member SELECT, update/delete trigger refusal), version 1 seeded with the six Permenkomdigi 8/2025 Pasal 22 ayat (3) categories verbatim from JDIH Komdigi (page 10) and `provisional = true`; `platform_add_declaration_text` appends a version under `tenant_governance` with reason/audit; `confirm_shipment(uuid,uuid,integer,text,integer)` replaces the four-argument signature (dropped, no alias), refuses a blank description (`content_description_required`) or a version other than the current one (`content_declaration_required`) and freezes version, `auth.uid()`, `now()` and the confirmer's sign-in email (`content_declared_by_email`, so another member of the gerai sees who confirmed without a user-directory read; anonymous demo identities have none); a table check keeps version/member/time all-or-none; no column grant. Shipments confirmed earlier keep NULL (shown as not recorded).

| Record | Fields (Proposal) |
|---|---|
| `shipments` additions | `content_declared_at`, `content_declared_by`, `content_declaration_version` (frozen at confirmation) |
| `public.declaration_texts` | `version`, `body` (Bahasa), `prohibited_categories` (text array), `effective_at`, `created_by`; read by any member; written by platform capability only |

## DATA-14 — Billable-weight rules and measured parcel values
- Status: Regular services and supported non-COD cargo implemented locally (owner, 2026-11-03); verification is recorded in STATUS.md. Full T-080 remains open for authenticated provider/route/order evidence.
- Non-COD cargo (owner, 2026-11-03): forward migration `20261103100000_cargo_noncod.sql` adds `shipment_quotes.service_class` (`regular` default, `cargo`) with a table check that a cargo quote is never COD-capable and carries no COD fee, and appends sourced cargo min/max versions from help 5502313 (updated 2026-09-24): JNE 10–30 kg, SiCepat 10–50 kg, iDexpress 10–70 kg. SAP cargo has region-dependent minimums and receives no executable version, so it stays excluded. `record_live_quotes` accepts a cargo row only with its cargo rule id and a provider `minimum_weight_grams` equal to that rule's minimum; it stores service `Kargo`, never COD. `confirm_shipment` refuses a cargo quote for COD and freezes `service_class` in `weight_snapshot`; `dispatch_payload` carries `cargo` from the selected quote. The applied 20261102100000 migration is unchanged; its range rows remain evidence.
- Owner: Engineering owner
- Source: PR-43; Mengantar help 5387484 (updated 2026-10-19); DEC-023.
- Statement: Per-courier volumetric divisors, rounding tolerance and maximum weight shall be provider configuration with source and date, and each quote and confirmation shall freeze the actual, volumetric and billable weight with the rule version used.
- Acceptance: A pure function computes raw volumetric grams as `L×W×H×1000 / divisor`, displays volumetric grams rounded with the sourced tolerance, and computes billable grams by applying that same tolerance to `max(actual, raw volumetric)` per courier with unit tests for the Mengantar rule (divisor 6000; JNE 4000; IDX Kargo 4000; tolerance 0.30 kg, Lion 0.31 kg) and boundary cases (1.30 → 1 kg, 1.31 → 2 kg); a missing dimension or unknown formula yields `volumetric = NULL` and `billable = actual` without rounding the measured value; complete-dimension weights below 1000 g preserve the heavier positive raw weight at integer-gram API precision (rounding up fractional grams), without a guessed provider-wide minimum or half-fare; because one estimate call carries one weight for all couriers, couriers are grouped by distinct billable weight and one estimate call is made per group, keeping only that group's couriers from each response; each quote stores the weight actually sent and the rule id; create-order sends the selected quote's billable weight, frozen at confirmation, so the provider price matches the confirmed charge; a rule row cannot be written without source and effective date; rules are read by the server through a security-definer read (the `private` schema is not exposed by PostgREST); `private.simulated_tariffs` reads the same rules instead of its hard-coded 6000 divisor.
- Constraints: PR-4, PR-7, DATA-2, DATA-5. Rules are configuration, never constants in code; the current rule is seeded from the help article with its URL and date.
- Evidence: The regular slice adds `20261102100000_billable_weight.sql`, `src/lib/billable-weight.ts`, grouped quote estimation, and a confirmation-frozen dispatch weight. Existing measured fields are never replaced by a derived or provider weight. Legacy quote rows retain NULL computed fields and dispatch with actual weight. The original cargo range rows remain provenance evidence. Non-COD JNE, SiCepat and iDexpress cargo are wired through quoting, confirmation and dispatch under the sourced rules added by `20261103100000_cargo_noncod.sql`. Cargo COD and SAP cargo remain excluded. Local implementation is not proof of provider acceptance or release readiness. See STATUS.md and `docs/review/2026-11-02-t080-implementation-review.md` for executed evidence and remaining gates.

| Record | Fields (Proposal) |
|---|---|
| `private.billable_weight_rules` | `id`, `courier`, `service_class` (`regular`, `cargo`), `divisor`, `tolerance_grams`, `max_weight_grams`, `min_weight_grams`, `cargo_minimum_range_grams` (evidence only), `cargo_minimum_source_url`, `cargo_minimum_observed_at`, `source_url`, `source_updated_at`, `effective_at`, `created_by`; append-only through the audited aal2 `integration_operations` RPC |
| `shipment_quotes` additions | `actual_weight_grams`, `volumetric_weight_grams`, `billable_weight_grams`, `weight_rule_id`, all nullable; NULL on existing rows means "not computed", never 0 |
| `shipments` additions | `weight_snapshot` (nullable; selected quote's actual/volumetric/billable grams, rule id and measured dimensions frozen at confirmation), `provider_weight_grams` (nullable; future T-045 ingestion from events or reconciliation), never overwriting measured values |

## DATA-15 — Return and claim cases
- Status: Proposed (PR-44; UX-20); not built; task T-086
- Owner: Engineering owner
- Source: PR-44; Mengantar help 8140017, 5596208; DEC-023.
- Statement: A case shall be a tenant-owned record on one shipment with type, timeline, evidence references, provider ticket reference, deadline basis and outcome; claim filing windows shall be provider configuration with source and date.
- Acceptance: At most one open case per shipment and type; closing requires an outcome and, for compensation, the decided amount and who decided it (`courier` or `mengantar`); the deadline is computed from the rule and the anchor event (last status, delivery or RTS) in hours, calendar days or working days (weekends excluded, holidays not until a calendar is configured); `deadline_at` is NULL when no rule or anchor applies (unknown, never a default); RLS on, SELECT via membership, writes through RPCs only; cross-tenant access is denied; every transition is audited.
- Constraints: DATA-1, TEN-1, IAM-1, PR-12.
- Evidence: Not built.

| Record | Fields (Proposal) |
|---|---|
| `public.shipment_cases` | `tenant_id`, `id`, `shipment_id`, `type` (`lost`, `damaged`, `late`, `return`, `other`), `state` (`open`, `submitted`, `closed`), `description`, `evidence_refs` (text array), `provider_ticket`, `deadline_at`, `rule_id`, `opened_by`, `opened_at`, `outcome` (`compensated`, `rejected`, `return_received`, `other`), `decided_amount_idr`, `decided_by_party`, `closed_by`, `closed_at` |
| `private.claim_window_rules` | `courier`, `case_type`, `window_value`, `window_unit` (`working_days`, `days`, `hours`), `anchor` (`last_status`, `delivered`, `rts`), `region_note`, `source_url`, `source_updated_at`, `effective_at` |
