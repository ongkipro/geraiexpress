# GeraiExpress — Tenant Isolation

- Status: Proposed, with Observed negative database and browser tests on the PostgreSQL 17 + PostgREST + application-owned auth stack (DEC-020, DEC-021, ADR-0002, T-064..T-066; T-067 security review open). Amended 2026-10-28/29 for review P0-1 (TEN-3), DEC-015 (TEN-6), DEC-017 (TEN-2), DEC-020 and DEC-021; statements are labelled Observed, Decision or Proposal.
- Owner: Engineering owner
- Updated: 2026-10-29

## TEN-1 — Membership authority at every data boundary
- Status: Proposed
- Owner: Engineering owner
- Source: CTX-1, CTX-11; SRC-SUPABASE-RLS and SRC-SUPABASE-FUNCTIONS in `sources.json`.
- Statement: Routine tenant-user access and authorization of new work shall require verified identity, current active membership, active tenant, and allowed action at application/database boundaries; bounded completion follows TEN-2 and explicit platform-only authority follows TEN-4.
- Acceptance: Tenant A cannot read, insert, update, reparent, delete, search, export, subscribe to, or download tenant B data through the application server, PostgREST Data API, views, or RPCs; same-tenant permitted operations work.
- Constraints: IAM-1, IAM-2, SEC-1, DATA-1.
- Evidence: Observed (`tests/db/isolation.test.ts`, `privileges.test.ts`, `auth-core.test.ts`; 27 files / 410 DB tests on PostgreSQL 17 + PostgREST via `scripts/db-verify.sh`; T-067 review open).

The reference wrapper sets `app.user_id` and `app.tenant_id` in a Node/Drizzle
transaction. Do not copy those policies and assume PostgREST supplies that
transaction-local context. Under DEC-021 (ADR-0002, `db/foundation/20261001000000_pg_foundation.sql`),
PostgREST verifies the request's HS256 JWT (`AUTH_JWT_SECRET`) and sets
`request.jwt.claims`, from which `auth.uid()` and `auth.jwt()` resolve the
verified user and session claims (`is_anonymous`, `aal`) while RLS and RPCs
check current database membership. A requested tenant/outlet, URL, localStorage
value, or header is only a selector; neither a JWT user-editable field nor cached UI role is authority.

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
tenant. If a provider sender identity is ever accepted (deferred by DEC-013; DEC-017
selects a local masked label instead and uses no provider dropshipper), resolve it
through local tenant-owned mappings and project only safe data. An account-owned
provider ID is not proof that the current tenant owns the associated shipment. Use
account + mapped local order, not AWB-only global resolution, for callbacks and
reconciliation.

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

Added 2026-10-28 (Proposal): cover host confusion (an owner-host path requested on the
app host and the reverse, a forged `Host` or `X-Forwarded-Host`), a `ge_tenant` cookie
naming a tenant the user is not a member of, seller-id substitution across tenants
(TEN-3), and a platform administrator who is also a tenant member acting in the wrong
context (TEN-6). Observed: a forged-cookie e2e test exists (ARCHITECTURE.md, Tenancy
row); the host-confusion cases have no test because only one host exists today.

## TEN-3 — Partner-global authority with tenant-local operations
- Status: Proposed
- Owner: Engineering owner
- Source: CTX-16, CTX-17.
- Statement: Access to a global Partner Secret shall never broaden a tenant's authority; every onboarding/key command shall resolve its managed seller through current local membership, action permission, and authoritative tenant binding.
- Acceptance: Tenant A cannot list, retrieve, rotate, replace, or register a binding for B through application-server/PostgREST Data API/RPC requests; BYOK cannot invoke Partner key management; permitted same-tenant operations succeed without exposing raw secrets.
- Constraints: TEN-1, TEN-2, DATA-4, IAM-3, SEC-3.
- Evidence: Observed in `db/migrations/20261028100000_partner_seller_binding.sql`, `20261028230000_environment_scope_key_ring.sql` and `tests/db/partner-onboarding.test.ts`, `environment-scope.test.ts` (T-032, T-034, T-050).
- Change history: 2026-10-28 — Review P0-1 found the boundary below not enforced for Partner onboarding (a tenant admin could write another tenant's seller id); the required machine-attested binding is specified here and in DATA-4 and tracked as TASKS T-032.

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

Observed historical defect (2026-10-28, review P0-1, closed in T-032/T-034/T-050):
before T-032 the two onboarding completion RPCs were granted to `authenticated` and
accepted a caller-supplied seller id (`db/migrations/20261027210000_partner_seller_onboarding.sql:340-345`).
Vendor 404 ownership checks do not separate tenants because every tenant's seller is
registered under one Partner ID. Decision (DEC-006, DEC-010) and Observed implementation
(T-032, T-034, T-050): seller identity is written only by the machine identity
(`service_role`) after the user-session admin check; the binding is unique per provider
environment and write-once; the application server proves the stored seller belongs to
the server-derived `externalUserId` before it opens any seller key; and the seller id
and owner details are projected to tenant admins only. The invariants and tests are in
DATA-4 (seller-binding integrity).

## TEN-4 — Explicit Super Admin scope without general tenant bypass
- Status: Proposed
- Owner: Engineering owner
- Source: CTX-29, CTX-30.
- Statement: Platform operations shall resolve current authorized Super Admin capability and explicit global/targeted scope separately from tenant membership, exposing only their approved projections and commands.
- Acceptance: Tenant/demo identities and forged/stale platform selectors/grants cannot access global or other-tenant platform data through application-server/PostgREST Data API/RPC; an allowed Super Admin action succeeds within its explicit target, while raw customer/secret/tenant operations remain unavailable without their own authority.
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

Decision (DEC-016, DATA-9): discount terms, the observed provider discount and the
derived platform remainder are platform-capability data. A tenant admin may read only
its own gerai discount and status; an operator reads none of it; the platform
remainder is never projected to a tenant. Assigning terms is a Super Admin command
with an audit event naming the actor and the target tenant.

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
- Acceptance: Auth-only, pending, rejected, foreign, wrong-email and demo identities cannot list tenant operations, mutate arbitrary membership or invoke seller provisioning via application-server/PostgREST Data API/RPC; valid own setup and invitation acceptance remain possible.
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

## TEN-6 — Host and cookie scope never select a tenant or platform authority
- Status: Decision (hosts and CTX-41 items 1, 3, 4 and 14: DEC-015; item 14 accepted by the owner on 2026-10-28); host separation built locally (T-042) and not deployed
- Owner: Engineering owner
- Source: DEC-015; CTX-41 items 1, 3, 4 and 14; PR-36; ARCH-6; TASKS T-042.
- Statement: The tenant for any tenant action shall come from the verified current membership, with the `ge_tenant` cookie only a validated selector, and never from the hostname, a forwarded header or a path segment; the owner host and the app host shall each refuse the other's routes with 404, and a session issued on one host shall not authorize anything on the other.
- Acceptance: A host-matrix test shows each host answering the other's route set with 404; a forged `Host` or `X-Forwarded-Host` selects no tenant and grants no platform access; an app-host session cookie is not sent to the owner host; a user holding both a platform grant and a tenant membership has separate sessions per host and a platform action never runs with a tenant context; the tenant slug in any URL or header is ignored for authorization.
- Constraints: TEN-1, TEN-4, IAM-7, SEC-6, ARCH-6, DATA-8.
- Evidence: Observed (2026-10-29, local): tenant resolution is `loadWorkspace` in `src/lib/workspace.ts` (active memberships read under the user's JWT, `ge_tenant` validated against them), and `loadWorkspace` and `loadPlatform` return nothing on the wrong host; platform routes under `/admin` are guarded by `requirePlatform` (grant plus `aal2`, `src/app/admin/layout.tsx`); `src/lib/hosts.ts` and `src/proxy.ts` (renamed from `src/middleware.ts` in T-066) answer 404 for another host's paths and never read `X-Forwarded-Host` (`tests/unit/hosts.test.ts`: every host by route family, odd spellings and a forged forwarded host), and the session cookies (`gx_at`, `gx_rt` in `src/lib/db/cookies.ts`) are host-only (`tests/e2e/hosts.spec.ts`: app-host cookies are `HttpOnly`, host-only and not sent to the owner host, none are set on the apex or hooks host). Not proven: that one identity holding both a grant and a membership keeps separate sessions beyond the cookie test; no host is deployed; an active owner session is not re-prompted for TOTP (T-054); enforced script CSP remains T-055.

Host separation is defense in depth, not the authorization boundary: RLS, RPC
membership checks and the platform capability check stay authoritative on every host
(TEN-1, TEN-4). Cloudflare Access in front of the owner host is an optional second
gate in addition to application-owned TOTP (`aal2`, DEC-021; formerly Supabase TOTP; CTX-41 item 5, Decision). Decision (CTX-41 item 3):
session cookies are host-only and never set on `.geraiexpress.com`. Decision (CTX-41
item 14, accepted 2026-10-28): one identity may be both a platform administrator and a
tenant member, but each host keeps its own session and no platform action takes a
tenant context.
