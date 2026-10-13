# GeraiExpress — Tenant Isolation

- Status: Proposed, requiring executable negative tests on the new stack.
- Owner: Engineering owner
- Updated: 2026-10-13

## TEN-1 — Membership authority at every data boundary
- Status: Proposed
- Owner: Engineering owner
- Source: CTX-1, CTX-11; SRC-SUPABASE-RLS and SRC-SUPABASE-FUNCTIONS in `sources.json`.
- Statement: Routine tenant-user access and authorization of new work shall require verified identity, current active membership, active tenant, and allowed action at application/database boundaries; bounded completion follows TEN-2 and explicit platform-only authority follows TEN-4.
- Acceptance: Tenant A cannot read, insert, update, reparent, delete, search, export, subscribe to, or download tenant B data through the Worker, Data API, views, or RPCs; same-tenant permitted operations work.
- Constraints: IAM-1, IAM-2, SEC-1, DATA-1.
- Evidence: Reference transaction-local wrapper inspected; Supabase policy tests pending.

The reference wrapper sets `app.user_id` and `app.tenant_id` in a Node/Drizzle
transaction. Do not copy those policies and assume Supabase Auth supplies that
context. The new model resolves the verified auth user and current database
membership. A requested tenant/outlet, URL, localStorage value, or header is
only a selector; neither a JWT user-editable field nor cached UI role is authority.

All exposed tenant tables need reviewed grants and RLS with read/write checks.
Views, functions, storage access, and optional realtime subscriptions require
the same review. Keep private provider secrets/control records unexposed.
Routine user queries must not use a service/secret role that bypasses policies.
Membership lookup policies/helpers must avoid recursive RLS and role escalation.
If a privileged helper is necessary, pin its search path, schema-qualify objects,
restrict execution, validate scope, and prove the no-member/direct-call cases.

Contacts are proposed to be shared within an authorized tenant, not across all
platform users. Outlet-level restriction for an operator remains an owner-held
decision; the schema must not promise arbitrary assignment semantics before it
is selected. Multiple allowed memberships require an explicit validated tenant
selection, not an arbitrary first row.

Role/tenant suspension takes effect from current membership checks even when an
old access token still verifies. Untrusted selectors return a safe denial or
not-found result without other-tenant record details. A positive auth check
alone does not authorize changes to tenant_id, membership role, secret fields,
provider state, or append-only history.

## TEN-2 — Provider, worker, and derived-output scope
- Status: Proposed
- Owner: Engineering owner
- Source: CTX-5, CTX-9, CTX-11, CTX-13.
- Statement: Outlets and credential versions of one tenant seller and asynchronous processing shall preserve tenant ownership while applying coordination and quotas at the actual provider-account boundary; foreign-tenant account binding remains denied under DATA-4.
- Acceptance: A job for A cannot target B's contact/order/label, foreign generation/search/binding attempts are denied, same-tenant outlets/keys share coordination, and suspension before dispatch blocks new submission while an already-dispatched result is still recorded safely. An adversarial duplicate-account fixture tests denial, not an enabled cross-tenant ownership mode.
- Constraints: TD-3, DATA-3, SEC-2, PRIV-1.
- Evidence: Proposed new-stack boundary, not a live test result.

Queue envelopes carry opaque operation references plus authenticated internal
scope, not raw provider credentials or full customer payloads. The worker
reloads its authoritative tenant/account/input version and machine permission
from durable records. Do not depend on the original user's still-valid session.
Separate new-work eligibility from read/reconcile/result-recording authority.

Never proxy account-wide Mengantar search/list/wallet results straight to a
tenant. Resolve provider dropshippers through local tenant-owned mappings and
project only safe data. An account-owned provider ID is not proof that the
current tenant owns the associated shipment. Use account + mapped local order,
not AWB-only global resolution, for callbacks and reconciliation.

Cache/search/export/label/job keys include validated tenant and relevant outlet,
actor, account/version, and object scope. Omit irrelevant dimensions only after
the owner proves that the data is intentionally shared. Operational/authenticated
responses must not enter shared CDN caches. A tenant switch clears old view data
and ignores late responses from the previous scope. Signed label URLs remain
bearer capabilities; access must not be granted through an unvalidated list ID.

## Required isolation scenarios

Cover anonymous, authenticated outsider, other tenant, revoked member,
suspended tenant, wrong outlet, operator calling an administrator action,
user-edited metadata, direct RPC/view access, account rotation mid-request,
cross-tenant parent references, queued job replay, foreign account bindings/label
access, and permitted same-tenant shared-account coordination. Cross-tenant account
sharing requires a separately selected ownership model; it is not enabled by a
test fixture. Pair each denial with a permitted same-scope case. These are prospective
checks; no GeraiExpress database or isolation test has executed yet.

## TEN-3 — Partner-global authority with tenant-local operations
- Status: Proposed
- Owner: Engineering owner
- Source: CTX-16, CTX-17.
- Statement: Access to a global Partner Secret shall never broaden a tenant's authority; every onboarding/key command shall resolve its managed seller through current local membership, action permission, and authoritative tenant binding.
- Acceptance: Tenant A cannot list, retrieve, rotate, replace, or register a binding for B through Worker/Data API/RPC requests; BYOK cannot invoke Partner key management; permitted same-tenant operations succeed without exposing raw secrets.
- Constraints: TEN-1, TEN-2, DATA-4, IAM-3, SEC-3.
- Evidence: Proposed boundary; two-tenant Partner/RLS tests pending.

Generate externalUserId from the authorized immutable tenant on the server.
Do not trust browser-supplied sellerId, externalUserId, owner reassignment, or
partner mode. Partner-wide listing belongs to restricted machine/platform
reconciliation, with only own-binding status projected into tenant settings.
Vendor 404 ownership checks are a second boundary; they do not replace local
scope enforcement among this partner's many sellers.

Validate all outlet→connection→tenant relations in the database. Restrict
secret table/view/function grants independently of UI masking. Background
onboarding/rotation reloads its authoritative operation/binding; no operation
may switch target tenant/account after authorization. Completion of an already
sent registration may record its seller after membership revocation; enabling
shipping/new effects still needs current authority and accepted policy.

## TEN-4 — Explicit Super Admin scope without general tenant bypass
- Status: Proposed
- Owner: Engineering owner
- Source: CTX-29, CTX-30.
- Statement: Platform operations shall resolve current authorized Super Admin capability and explicit global/targeted scope separately from tenant membership, exposing only their approved projections and commands.
- Acceptance: Tenant/demo identities and forged/stale platform selectors/grants cannot access global or other-tenant platform data through Worker/Data API/RPC; an allowed Super Admin action succeeds within its explicit target, while raw customer/secret/tenant operations remain unavailable without their own authority.
- Constraints: TEN-1, TEN-2, IAM-7, DATA-6, SEC-4. Platform role is not an RLS-bypass credential or implicit impersonation grant.
- Evidence: Proposed target boundary; no negative database test executed.

A platform business directory may span tenants under its own reviewed grant;
it does not require pretending the Super Admin is a tenant member. Conversely,
regular tenant endpoints must never detect a platform role and remove every
tenant filter. If a person has both roles, preserve explicit workspace/action
context and its applicable rules. User-edited metadata cannot create either
platform authority or a new global scope.

Projection/cache/search/job keys distinguish platform-global, selected tenant,
actor/capability and relevant object/version. Private platform responses are not
publicly cached. Validate target tenant→seller→operation relations server-side;
changing a filter or queued request cannot retarget an authorized action.
Scoped pricing views may expose verified net amounts for assigned-discount
verification only under the relevant capability, without widening customer-data
or payout authority. Review raw-table/view/function grants independently.

Role/tenant suspension blocks the selected future effects; an already-dispatched
provider result still uses bounded completion authority. An operational viewer
cannot perform new payment/order creation just because the operation is unpaid
or unknown. Record scoped access and state-changing decisions with safe audit
metadata. Cross-tenant support detail/impersonation has no default grant.

## TEN-5 — Own onboarding and invitation scope before activation
- Status: Proposed
- Owner: Engineering owner
- Source: CTX-31, CTX-34; PR-29 through PR-32.
- Statement: Before tenant activation, verified applicants shall access only their own application/setup projection and explicitly permitted setup transitions; invitation acceptance shall grant only the current intended tenant/role/outlet scope.
- Acceptance: Auth-only, pending, rejected, foreign, wrong-email and demo identities cannot list tenant operations, mutate arbitrary membership or invoke seller provisioning via Worker/Data API/RPC; valid own setup and invitation acceptance remain possible.
- Constraints: TEN-1, TEN-4, DATA-7, IAM-8, SEC-5; no global anonymous registration lookup or general service-role proxy.
- Evidence: Prospective isolation contract; no RLS/RPC test executed.
- Change history: 2026-10-13 — Added in the registration and documentation-completeness review.

Initial setup is a deliberate narrow exception to routine active-tenant access:
allow an application's verified applicant to read its own status and update only
allowed setup fields. It does not create an operational permission on the whole
provisioning tenant. Restrict raw row columns, relationships, RPC execute grants
and result projections; a careful page cannot make a broad table grant safe.

Tenant activation and application approval remain current server-owned facts.
Unauthenticated registration feedback must not reveal email existence, application
status, tenant names or member lists. Resolve resume by verified auth-user ID and
the owned application reference, never a browser-supplied email/tenant selector.
Invitation links require the independently verified intended email and current
invitation state. Claimed role/tenant/outlet from URL or user metadata is untrusted.
