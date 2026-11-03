# GeraiExpress — Identity and Permission Draft

- Status: Role policy accepted by owner (DEC-007, DEC-008); identity and TOTP assurance implemented in the application-owned auth module on PostgreSQL 17 + PostgREST (DEC-021, ADR-0002, T-064..T-066; T-067 security review open).
- Owner: Paduka Ongki
- Updated: 2026-11-02

**Terminology:** Super Admin is the product/UI name for the platform
administrator below. Platform pricing, integration, monitoring and recovery
access are explicit capabilities under that role. Tenant Admin and Operator
remain tenant-owned roles; no UI label creates a database permission.

## IAM-1 — Identity and candidate role matrix
- Status: Proposed
- Owner: Paduka Ongki
- Source: CTX-1, CTX-4, CTX-11.
- Statement: Authentication identity (`auth.users`, DEC-021, ADR-0002; formerly Supabase identity) shall be separate from tenant membership, customer contacts, and bounded machine permissions; each command requires an authorized role and object scope.
- Acceptance: An operator cannot invoke tenant/platform administration, a tenant administrator cannot invoke platform actions, and a saved sender/recipient receives no login or membership merely by being saved.
- Constraints: TEN-1, TEN-2, DATA-1. Invitation/signup policy and role cells resolved in DEC-007 and DEC-008; per-outlet assignments remain deferred.
- Evidence: Observed in `db/migrations/`, `src/lib/auth/**`, `src/lib/db/**`, `tests/db/{isolation,invitations,platform,auth-core}.test.ts`.

| Action | Operator | Tenant administrator | Platform administrator | Machine worker |
|---|---|---|---|---|
| View/create permitted drafts, estimates, shipment detail | Own authorized scope | Own authorized scope | No automatic tenant impersonation | Operation-specific only |
| Create/update saved contacts and addresses | Proposed: permitted within tenant | Own tenant | No automatic contact-directory access | Only verified mapping work |
| Archive contacts / manage contact export | Proposed: denied | Proposed: allowed with policy | No automatic access | No general permission |
| Confirm shipment / request print | Proposed: permitted with explicit review | Own tenant | No automatic tenant operation | Only durable authorized operation |
| Retry unpaid payment / resolve unknown result | Proposed: escalates | Own tenant, subject to money policy | No default spending authority | Bounded recovery/result permission |
| Configure outlet/provider connection/brand | Denied | Own tenant; IAM-3 constrains credential effects | Separate Partner configuration permission only; no automatic tenant credential action | Bounded binding/operation only |
| Invite, change role, deactivate members | Denied | Own tenant with governance guards | Separate platform governance policy | No general permission |
| Provision/suspend/reactivate a tenant | Denied | Denied | Proposed explicit platform role | No general permission |
| Financial/reporting/export actions | No default grant | Conditional on accepted feature/policy | Explicit pricing/monitoring scope; no automatic tenant payout/customer export | No general permission |
| Platform overview, seller readiness, safe exception/audit projections | Denied | Denied | Current platform capability and restricted projection only | Bounded machine read/transition only |
| Assign/verify tenant seller discounts | Denied | Own terms/net inspection as permitted | Explicit pricing capability; IAM-6 | Only authorized verification operation |
| Record counter payment; print or share receipt; share resi link (PR-38, PR-40) | Proposed: permitted within tenant | Proposed: own tenant | No automatic tenant operation | None |
| Close a cash period, seeing that period's cash-count variance (PR-39) | Proposed: any outlet of the tenant (memberships are tenant-wide, DEC-008) | Proposed: own tenant | No automatic access | None |
| Void a payment record; reopen a cash period; view per-record charge differences and pilot earnings (PR-38, PR-39, PR-45) | Proposed: denied | Proposed: own tenant | No automatic access | None |
| Open or update a return/claim case (PR-44) | Proposed: permitted within tenant | Proposed: own tenant | No automatic access | Case creation from return events only |
| Close a case; revoke a tracking link (PR-40, PR-44) | Proposed: denied | Proposed: own tenant | No automatic access | None |
| Edit declaration texts, billable-weight and claim-window rules, masking acceptance per courier (PR-41, PR-43, PR-44, PR-46) | Denied | Denied | Proposed: explicit platform capability with audit | None |
| Grant/revoke platform administrator access | Denied | Denied | Governed privileged action; final-admin guard; IAM-7 | Bootstrap/recovery only through approved bounded path |

Rows for PR-38 to PR-46 (counter operations, 2026-11-02) are not covered by DEC-008; their cells stay Proposed until the owner accepts them. They narrow the "Financial/reporting/export" row for these specific counter actions only.

The application-owned auth module (`src/lib/auth/**` and PostgreSQL schema `auth`
behind 14 `service_role`-only `public.auth_*` RPCs, DEC-021, ADR-0002; replacing
Supabase Auth) owns passwords (`scrypt`), 6-digit email OTPs, server-held sessions
(`auth.sessions` with rotating `gx_rt` refresh hashes), 10-minute HS256 access JWTs
(`gx_at`) and Super Admin TOTP (`auth.mfa_factors`). Do not port Better Auth
session/account/verification tables, auth routes, cookie defaults, or role fields.
The app's `public` schema owns active tenant memberships, platform-role grants,
outlet assignments if selected, and authorization audit. Never derive permissions
from writable user metadata or rely exclusively on potentially stale JWT role
claims. Reload authoritative membership where actions can change data or create
provider effects.

Login destinations and hidden navigation are presentation, not permission
enforcement. A platform administrator's identity does not imply support
impersonation or customer-detail access. Any future impersonation requires an
explicit policy, visible context, bounded duration, exit path, and separate
audit of the real and acted-as principals; none is granted by this draft.

## IAM-2 — Atomic governance and asynchronous authority
- Status: Proposed
- Owner: Engineering owner
- Source: CTX-11.
- Statement: Membership and tenant-lifecycle commands shall validate current authority atomically, preserve required administrator access, and separate new operation authorization from truthful processing of already-started effects.
- Acceptance: Concurrent final-admin removal is denied safely, an operator cannot promote itself through direct database/RPC calls, repeated invitations do not duplicate membership effects, and revocation blocks future issuance without discarding a valid in-flight provider result.
- Constraints: TEN-1, TEN-2, TD-3, SEC-1.
- Evidence: Observed in `db/migrations/20261014140000_invitations.sql`, `20261029100000_auth_core.sql` and `tests/db/invitations.test.ts` (task 014, T-065).

Email invitation, identity creation, membership activation, and role assignment
are different effects. An email-send failure must not be hidden as an activated
membership, and an `auth.users` identity alone must not expose a workspace. PR-29
through PR-32 and IAM-8 specify initial creation, closed-by-default public signup,
invitation and recovery behavior (accepted in DEC-007 and DEC-008; owner transfer
and last-admin exceptions remain open).

Machine processing uses a dedicated bounded command surface. If privileged
database execution is necessary, allow only the specific transition on an
authoritative operation reference; do not use a general admin client as routine
tenant storage. Audit actor, tenant/object, command, outcome/reason, correlation,
and authority/attempt version without sensitive payloads. Background completion
must remain possible after the initiating access token expires.

## IAM-3 — Provider onboarding and credential permissions
- Status: Proposed
- Owner: Paduka Ongki
- Source: CTX-17.
- Statement: Only explicitly authorized tenant administrators shall initiate their tenant's seller connection and credential lifecycle; platform and machine access shall remain bounded by separate operational permissions.
- Acceptance: Operators and foreign tenant administrators cannot register/recover/rotate a binding, a platform role cannot act as a seller or grant itself customer access, and a worker can complete only its stored authorized operation without returning any key to a human client.
- Constraints: PR-17, PR-18, PR-19, PR-20, TEN-3, SEC-3, IAM-2.
- Evidence: Candidate policy; not an implemented permission grant.

| Operation | Proposed authority |
|---|---|
| Provide owner details and agree to new seller creation | Own tenant administrator with account-owner authority; identity/owner validation required |
| Submit/replace BYOK | Own tenant administrator through a dedicated protected form; no plaintext readback |
| Recover current managed key | Explicit credential permission on own managed binding; audited side effect |
| Regenerate managed key | Own authorized administrator, explicit confirmation of immediate invalidation and possible webhook change |
| Reconcile partner-wide seller inventory / configure partner access and egress | Explicit platform operations role or narrowly bounded machine permission; no ordinary tenant endpoint |
| Complete or reconcile onboarding/rotation | Machine command bound to durable operation and account; no arbitrary seller target |

Provider account ownership is independent of application user membership (`auth.users`). Removing
staff access must not create/reassign/delete a seller. Account-owner transfer,
shared-owner tenants, and incident rotation authority need explicit product
policy before enablement; there is no default platform impersonation permission.

## IAM-4 — Dedicated demo identity and effect boundaries
- Status: Proposed
- Owner: Engineering owner
- Source: CTX-21.
- Statement: Demo access shall use a dedicated demo identity and tenant with bounded operator permissions, synthetic data, and server-enforced simulation of shipping effects.
- Acceptance: Demo login succeeds in its sample workspace, while direct application-server/PostgREST Data API/RPC attempts to access real tenant data, provision sellers, spend funds, manage keys/members or grant broader roles are denied; removing a browser demo flag cannot enable a live provider operation.
- Constraints: PR-21, TEN-1, SEC-1, IAM-1. Demo identity is not a platform administrator and shares no real provider credential or customer record.
- Evidence: Proposed access contract only; no account or policy has been provisioned.

Resolve demo authority from trusted environment/identity and stored membership,
not a browser selector. Use synthetic provider fixtures for demo estimates,
submission/status and sample labels; the trusted transport must reject real
Partner/Public API dispatch for demo work. Keep preview demo configuration and
credentials separate from production accounts. Normal real-tenant operations
continue to require current membership and their own provider readiness.

Shared demo access starts from seeded examples. Keep visitor trial edits in
session-local state so one visitor cannot see another visitor's entered values;
resetting the trial restores those examples without affecting real data. Issue
the actual demo access through the selected Auth setup when the preview exists,
and include working login instructions with that delivery. Do not invent or
store a password in the PRD or reuse an administrator's account.

## IAM-5 — Customer charges versus private provider economics
- Status: Proposed
- Owner: Paduka Ongki
- Source: CTX-24, CTX-25, CTX-28.
- Statement: Operators shall receive normal customer tariff and applicable customer-facing COD/insurance charges; private net provider cost, assigned discounts, settlement fee/payout breakdown and shipping spread shall require the selected tenant-administrator financial permission, or a narrowly scoped platform pricing/monitoring permission for its stated purpose.
- Acceptance: Operator HTML/client DTO/Data API/RPC/export responses in every enabled collection mode omit private monetary fields while customer totals remain usable; an authorized same-tenant administrator can access accepted private details and another tenant cannot.
- Constraints: PR-22, DATA-5, TEN-1, NFR-3, IAM-1. This is a proposed transfer of the latest reference role boundary, not a new financial feature grant or provider PDF privacy guarantee.
- Evidence: Reference projections traced, including the Non-COD transfer gap; new permission/database checks pending.

A customer charge remains available to the operator for quoting and review even
when the provider deduction is private. Explicitly project each mode rather than
returning a whole internal quote object for Non-COD. Current app pricing or
fees never authorize an operator to edit confirmed prices, withdraw funds,
change credentials, grant roles or inspect another tenant's business economics.

## IAM-6 — Negotiated seller-discount administration
- Status: Proposed
- Owner: Paduka Ongki
- Source: CTX-27, CTX-28.
- Statement: Discount assignment/activation shall require an explicit platform pricing permission and scoped audited authority; tenant administrators may inspect their own assigned terms/net cost as permitted, while operators and customers receive only the retail projection.
- Acceptance: An operator, foreign tenant administrator or ungranted platform user cannot assign/backdate/activate discounts through application-server/PostgREST Data API/RPC; a permitted administrator can manage the intended tenant/account version without claiming an unverified provider activation.
- Constraints: PR-23, DATA-5, TEN-1, IAM-5, SEC-1. Platform pricing permission does not grant customer-directory access, general impersonation or arbitrary live provider mutation.
- Evidence: Proposed permission contract; no grant, account change or discount interface exists.

Customer retail tariff remains unchanged by seller-discount administration.
Provider activation/reconciliation and optional commercial approvals need their
actual agreed channel before use. Audit before/after terms, scope/version,
effective period, actor and safe outcome, not raw credentials or customer data.

## IAM-7 — Super Admin authority and recovery boundaries
- Status: Proposed
- Owner: Paduka Ongki
- Source: CTX-29, CTX-30; SRC-SUPABASE-MFA in `sources.json`.
- Statement: Super Admin access shall combine current platform grants, explicit capability/object scope and required verified session assurance, with governed role changes and a bounded investigation/recovery surface.
- Acceptance: Tenant/demo/self-edited-metadata and revoked grants cannot access platform functions; direct API/RPC assurance checks match UI behavior, privileged actions recheck current authority, and final-admin governance preserves a recovery path without a universal bypass.
- Constraints: PR-24 through PR-28, IAM-6, TEN-4, SEC-4. Platform access does not automatically confer tenant membership, customer access, secret readback or spending authority.
- Evidence: Observed in `db/migrations/20261014120000_platform_admin.sql`, `20261029100000_auth_core.sql`, `src/lib/auth/totp.ts` and `tests/db/{platform,auth-core}.test.ts` (task 012, T-065, T-066; T-067 security review open).

Use the application-owned TOTP second-factor flow (`src/lib/auth/totp.ts`,
`auth.mfa_factors` with AES-256-GCM sealed secrets and `last_used_step` replay
protection, and `public.auth_mfa_verify` upgrading `auth.sessions` to `aal2`,
DEC-021, ADR-0002; replacing Supabase MFA); require verified `aal2` for the
platform workspace and privileged commands (`private.platform_capable`). Enforce
it in backend and exposed database boundaries as well as the UI. Enrolment/challenge
access is separate from platform data access. Session assurance alone is not a role;
reload the server-owned current grant. Factor recovery/removal must not become
a public shortcut around privileged authorization.

| Capability | Permitted purpose | Explicit limit |
|---|---|---|
| Tenant governance | Business profile/readiness, configured review, permitted lifecycle | No customer-directory grant, automatic provider ban/delete or unaudited ownership transfer |
| Platform monitoring | Safe global/selected-tenant projections and operation correlation | No raw provider payload/secret or unbounded personal-data export |
| Platform pricing | Assigned negotiated terms and verification of own targeted net quote | No tenant-operator self-discount or invented upstream activation |
| Integration operations | Private configuration readiness and approved scoped credential process | No plaintext key reveal, arbitrary signer/proxy or seller dashboard login |
| Safe recovery | Reconcile original operation or resume a proven safe recorded handoff | No blind order/payment replay, balance withdrawal, financial status edit or new spending authority |
| Platform access governance | Approved grant/revoke and recovery administration | No public self-promotion; atomically preserve a usable access-governance administrator and approved recovery path |
| Audit review | Filtered decision/investigation history | Append-only; no edit/delete permission |

Initial bootstrap and emergency recovery require an owner-selected verified
identity/process, separately from public signup. No account is provisioned by
this document. Platform-role changes record acting principal, target, reason,
version and outcome; current revocation must take effect even with an old token.
The final-administrator guard applies to capability reduction as well as grant
revocation. A monitoring-only grant is not a surviving access administrator:
the survivor must retain platform access-governance authority and usable required
assurance/recovery under the approved process. Test concurrent removal/demotion
and recovery availability without granting a universal bypass.
If a person also has a tenant membership, platform and tenant workspaces keep
separate explicit context. Routine tenant APIs still apply tenant rules.

Support impersonation remains unavailable (DEC-024 owner selection: Super Admin only monitors).
The owner selected Super Admin visibility of customer detail (DEC-024). Proposed control
(assistant safeguard, not an owner selection): reads only with a separate `customer_data_review`
capability, a recorded reason and an audit row (T-093); without it, access stays denied. Necessary owner onboarding contact data
is purpose-bound tenant-business information, not a platform-wide customer book.
No fixed session lifetime or recovery exception is copied from Better Auth.

## IAM-8 — Verified identity, applicant and invite lifecycle
- Status: Proposed
- Owner: Paduka Ongki
- Source: CTX-31, CTX-33, CTX-34; PR-29 through PR-32.
- Statement: Authentication, own application access, active tenant membership and platform grants shall remain independent authorities, with explicit current-state routing and acceptance of scoped staff invitations.
- Acceptance: Verification/password recovery alone grants no tenant/platform role, a pending owner can complete only their setup, a wrong-email invitation is denied, and expired/revoked/suspended authority is rechecked on every sensitive transition.
- Constraints: IAM-1, IAM-2, IAM-7, TEN-5, SEC-5, DATA-7; policy proposals are not provisioned accounts.
- Evidence: Observed in `src/lib/auth/**`, `src/lib/registration-actions.ts`, `db/migrations/20261029100000_auth_core.sql` and `tests/db/{auth-core,registration,invitations}.test.ts` (T-065, T-066; T-067 review open).
- Change history: 2026-10-13 — Added in the registration and documentation-completeness review. 2026-10-29 — Updated for DEC-021 (ADR-0002): application-owned auth replaces Supabase Auth.

| Identity/access condition | Proposed permitted destination / authority |
|---|---|
| Anonymous or code requested | Public register/login/code/recovery; no tenant application read or data grant |
| Verified identity, no application/membership | Complete own account, explicitly start own application or accept valid invitation; never select an arbitrary tenant |
| Own provisioning application | Own setup/status/corrections and selected withdrawal; no quote/order/credential/staff effects before activation |
| Active member | Explicit permitted tenant/outlet; multiple memberships use a chooser without broadening any role |
| Active tenant but provider incomplete | Permitted local work and role-scoped setup; provider effects remain capability-gated |
| Rejected/withdrawn application | Own safe outcome/support or accepted resubmission path; other memberships remain independent |
| Suspended tenant/revoked membership | Restricted status/help/switch to other permitted membership; no new tenant/provider effect |
| Current platform grant | Separate platform assurance/capabilities under IAM-7; public registration cannot grant this role |
| Demo identity | Only dedicated simulation under IAM-4; no real signup, invite acceptance or provider effect |

Decision (DEC-007, DEC-021, ADR-0002): 6-digit email OTP first (`requestEmailCode` /
`verifyEmailCode` in `src/lib/auth/service.ts` backed by `public.auth_issue_otp` and
`public.auth_verify_otp`), password setup after verified inbox control (`setPassword`
backed by `public.auth_set_password`), and password login afterward (`signInWithPassword`).
Previously completed app users sign in or recover; registration does not silently
reset their credentials. Initial/partial identities follow TD-11's inbox-proof,
explicit password replacement (`discard_pre_verification_password` trigger) and
session-revocation guard (`auth_set_password` revokes all other sessions of the user).
Never mark a public registrant confirmed without code verification or trust user-provided role data.
Proposed staff flow: same-tenant administrator issues an allowed role/outlet
invitation; recipient verifies their email/signs in, reviews the business and
role, then explicitly accepts. Recheck tenant, invitation expiry/revocation,
issuer authority and current target membership in the acceptance transaction.
Expiry/role policy remains pending acceptance. An Auth invitation or email
delivery receipt is not membership; contacts never receive invitations by being saved.

Password recovery (scheduled under PR-32 and DEC-013 behind the T-063 production
mail gate) and future email change will use the same application-owned OTP primitive
(ADR-0002 section 5; formerly native Supabase flows). Changing app email does not change stored tenant ownership or the Mengantar seller email.
Owner/seller transfer, privileged factor recovery and administrative exceptions
require their separately selected policy; no public shortcut is supplied.
