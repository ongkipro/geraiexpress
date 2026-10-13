# GeraiExpress — Security Boundaries

- Status: Proposed controls; source review is not an exploit or production audit.
- Owner: Engineering owner
- Updated: 2026-10-13
- Scope: Trust-boundary controls. TEN-1/TEN-2 own isolation; IAM-1/IAM-2 own permission policy.

## SEC-1 — Trusted commands, credentials, and private results
- Status: Proposed
- Owner: Engineering owner
- Source: CTX-1, CTX-3, CTX-11; SRC-SUPABASE-RLS and SRC-SUPABASE-FUNCTIONS in `sources.json`.
- Statement: Every operational command shall validate identity, object scope, permitted action, input bounds, and authority version before a sensitive effect, with private credentials and projected results.
- Acceptance: Direct unauthorized Data API/RPC/Worker requests, ownership changes, oversized inputs, arbitrary outbound hosts, and canary secret/PII leakage attempts are denied while valid workflows remain usable.
- Constraints: TEN-1, TEN-2, DATA-1, DATA-3, IAM-1, PRIV-1.
- Evidence: Proposed controls grounded in the reference; no GeraiExpress security runtime exists yet.

| Entry → asset/effect | Required boundary | Proposed proof |
|---|---|---|
| Browser selector → contact/shipment row | Current membership + action + same-tenant FK/policy; immutable ownership | Same-tenant success, foreign row read/write/reparent denial, direct RPC coverage |
| Settings input → provider secret/connection | Authorized tenant administrator; bounded input, encrypted private storage, dedicated key and rotation/version | No plaintext readback, no partial fallback, wrong-tenant update denied |
| Browser confirmation → provider charge/order | Current draft/quote/account version, explicit user confirmation, durable command and idempotency | Modified quote/total/account rejected, replay and double-click safe |
| Worker/job → private database transition | Bounded machine permission and authoritative operation reference | Forged tenant/account or arbitrary target cannot mutate other data |
| Provider response/link → browser or HTTP fetch | Validate schema/size, expected authority and trusted HTTPS endpoint; reject unsafe redirects/hosts | Bounded body, HTML/error response, foreign-account ID, unsafe download URL rejected |
| Import/export → parsing and spreadsheet | Byte/row/fan-out limits, scoped preview/confirmation, escaped output | Excessive/ambiguous/tampered input rejected; formula cells inert |
| List/detail/error/telemetry → contact/credential disclosure | Minimum permitted DTO projection, server masking where selected, private cache policy, structured redacted errors | Credential absent everywhere public; customer canaries absent from unauthorized/suppressed payloads and logs; authorized operational display still works |

Use a request-scoped Supabase client for user-context work. Do not turn an
ordinary Worker route into a service-role proxy with a client-supplied tenant
filter. Exposed RPCs must be safe when called directly: wrapping a dangerous
RPC in a careful Worker does not protect the database endpoint. Privileged
functions require restricted execution, fixed search paths, parameterized
operations, narrow allowed transitions, and explicit scope validation.

Provider keys are credentials embedded in outbound URL paths. Strip complete
credential-bearing paths from diagnostic events, fetch exceptions, and traces.
Protect key submission and never return stored key values or fragments in
settings state. Encryption keys, provider secrets and signed download URLs must
not be written into the specification, fixtures, logs, analytics, browser storage
or public configuration. Native Supabase session material is restricted to its
verified SDK session/cookie mechanism; do not make extra copies in application
storage, diagnostics or saved artifacts. Use native platform cryptography and a
versioned, purpose-separated key lifecycle when required.

Runtime bindings and provider hosts must be explicitly configured. HTTPS alone
does not make a browser-supplied URL safe. Authenticated operational responses
and PDFs are private and must not be shared through public CDN caching.
Bound expensive work per actor/tenant and actual provider account as appropriate;
in-memory counters cannot represent a horizontally scaled quota.

## SEC-2 — Authenticated tracking and replay control
- Status: Proposed
- Owner: Engineering owner
- Source: CTX-13; TD-4 owns the provider contract and enablement boundary.
- Statement: Provider ingestion shall authenticate the exact raw body, enforce accepted freshness and replay rules, resolve the trusted account/order mapping, and apply only an idempotent valid transition.
- Acceptance: Invalid signature, stale timestamp, replay, oversized body, unknown account/order, and reordered update cases cause no unauthorized mutation; a valid event records one eligible transition.
- Constraints: TEN-2, DATA-2, TD-4. A new signed sandbox capture is required before activation.
- Evidence: Current public provider documentation; no webhook was received or verified in this review.

Choose the replay window from the actual delivery/retry contract, rather than
inventing a value. Verify before JSON-dependent effects, compare signatures
safely, and deduplicate durably. Record safe correlation/reason metadata and
acknowledge only according to a verified persistence/retry strategy. Do not
answer success while silently discarding an update that should be retried.

## SEC-3 — Partner signing and seller credential lifecycle
- Status: Proposed
- Owner: Engineering owner
- Source: CTX-17, CTX-18.
- Statement: Partner signing and credential effects shall be confined to configured trusted operations with verified local authority, private versioned storage, approved egress, and durable recovery.
- Acceptance: Arbitrary host/path/body signing, tenant/seller substitution, raw-key readback, credential/preimage logging, unapproved egress fallback, and disabled-key reactivation are denied; valid scoped signing and managed recovery work.
- Constraints: TEN-3, IAM-3, DATA-4, TD-7, TD-8, ARCH-2, NFR-3.
- Evidence: Documentary threat-boundary review and offline protocol check only; no deployed security proof.

Partner Secret is platform-global in Worker secrets. Seller API keys and callback
secrets are purpose-separated, encrypted private records with versions; key
retrieval and registration responses must not be copied into general outbox,
audit, browser DTOs, or telemetry. Protect user-submitted BYOK with origin/CSRF
controls appropriate to the selected auth path, input bounds, restricted access,
and no plaintext readback. Avoid browser-storage persistence.

Construct the documented plain SHA-256 signature over exact serialized bytes,
endpoint and Unix seconds. Do not substitute webhook HMAC signing or timestamp
milliseconds. Neither the preimage (which contains the Partner Secret) nor
request signatures belong in logs. Fixed trusted hosts/paths, redirect policy,
bounded fetch/parsing, and TLS are necessary even for a valid signed request.

Source-IP allowlisting supplements authentication and local tenant permission;
it cannot replace either. Verify Gateway/Worker log policy as well as app logs.
Expose safe error codes and operation references, never secret-bearing vendor
messages or URLs. Stop retries on Partner/seller restriction as appropriate;
provider-disabled credentials must not be circumvented by another seller.

Persist regeneration intent and atomically save returned key/callback versions
before readiness. Unknown callback state disables ingestion until synchronized;
do not accept unsigned events or an unbounded old-secret grace period. Any
bounded overlap for authentic queued events requires a verified provider retry
contract and account/version binding, not a guessed global verifier secret.

## SEC-4 — Privileged platform command boundary
- Status: Proposed
- Owner: Engineering owner
- Source: CTX-29, CTX-30; IAM-7 owns the native auth/assurance policy.
- Statement: Privileged platform reads/commands shall verify current identity, capability, session assurance, target scope and revision before access/effect, with constrained output, durable decision audit and safe recovery.
- Acceptance: Missing/stale/revoked grants, incomplete assurance, forged scope, unsafe return navigation, direct privileged RPC, concurrent role removal, secret-bearing diagnostics and replayed recovery cannot produce unauthorized access/effects; approved actions remain usable.
- Constraints: PR-24 through PR-28, TEN-4, IAM-7, SEC-1, SEC-3. No general database-admin client, browser key exposure, arbitrary provider console or implicit support impersonation.
- Evidence: Reference boundaries and proposed controls; no runtime exploit/security verification.

Apply backend/database assurance checks and current grant lookup, not a hidden
menu or a client-decoded unverified token. Privileged bootstrap, factor recovery
and access revocation need the owner-selected administrative path; public signup
and the demo never grant platform control. Protect factor/setup recovery material
through native auth flows and keep it out of audit/analytics/config readback.

Constrain expensive directory/aggregate queries, search input and recovery
requests. Validate origin/CSRF protections according to the selected session
transport and allowlist return destinations. Sensitive effects use explicit
intent, reason, target/revision and idempotency; audits record truthfully accepted,
pending, denied or completed states. Integrations expose safe binding/secret-version
status, while secret deployment/rotation uses its actual approved mechanism.

A provider outage/permission refusal does not justify creating orders again,
spending another account's balance, accepting unsigned callbacks or turning a
failed health region into a healthy state. Support PII access and incident
credential/spending authority require their separate explicit policy before
exposure. Do not capture raw requests/responses or full customer/credential data
in a platform "debug" screen.

## SEC-5 — Public Auth, onboarding and invitation defenses
- Status: Proposed
- Owner: Engineering owner
- Source: CTX-31 through CTX-35; SRC-SUPABASE-AUTH-SSR, SRC-SUPABASE-AUTH-REDIRECTS, SRC-SUPABASE-AUTH-LIMITS in `sources.json`.
- Statement: Public authentication and onboarding shall resist enumeration, forged ownership, pre-registration takeover, unsafe navigation, replay, brute force and shared-cache session exposure while preserving legitimate recovery.
- Acceptance: Wrong/replayed code or invite, metadata/role forgery, foreign application reference, malicious redirect, concurrent review and stale identity cannot grant access; controlled valid paths pass and Auth/mail secrets remain absent from logs/browser persistence.
- Constraints: PR-29 through PR-33, IAM-8, TEN-5, DATA-7, ARCH-3; no custom token/OTP authority or unverified confirmation bypass.
- Evidence: Threat/control proposals grounded in current native features; no exploit/runtime result claimed.
- Change history: 2026-10-13 — Added in the registration and documentation-completeness review.

| Entry → protected effect | Proposed control and required proof |
|---|---|
| Public email form → Auth/mail capacity and account existence | Generic accepted feedback; bounded valid input; configured native quota, resend delay and verification attempts; app abuse controls cannot rely on browser timers; avoid existence-specific response/timing branches |
| OTP/callback → verified session | Native verification, request-bound cookies, allowlisted type/destination and fresh authoritative user state; no custom code table, email parameter authority or logging of code/link/session |
| Attacker registration → another inbox owner's credentials | Email-first/password-after-proof proposal; require trusted account completion, replace unverified preexisting passwords explicitly after inbox proof, revoke other sessions and deny pre-completion sessions; prove direct native password-signup cannot inherit authority |
| Cookie mutation → application/role changes | Current identity/scope, origin/CSRF checks, expected revision and idempotency; anonymous, metadata and client role fields cannot invoke privileged application procedures |
| Invite link → tenant membership | Bounded unguessable capability if used, digest at rest, independent verified-email match, current tenant/invite/issuer/role checks; expiry/revocation/replay/concurrency tests |
| Mail configuration → arbitrary send or secret exposure | Fixed sender and actual selected templates; least-purpose private token/config, no user-selected SMTP host or arbitrary-recipient mail proxy; test suppression/outage without skipping verification |
| Auth response → another browser/session | Private/no-store and CDN bypass on session/authenticated routes; preserve native refresh cookies and cache headers; verify two-user isolation, including callback and recovery |

Native quotas protect the Supabase Auth endpoint directly, not just app routes.
App/Cloudflare request limits are additional controls. If CAPTCHA is selected,
verify it at the native/trusted boundary as documented rather than accepting a
client success flag. Do not add an unverified CAPTCHA integration to this draft.
Worker-proxied Auth requests need an explicitly verified rate-limit/IP design;
never blindly trust forwarded headers or assume every request has a unique IP.

The server verifies token signature/expiry and current membership/application
authority. Where immediate Auth session revocation matters, follow current native
session checks instead of assuming an unexpired JWT proves a live session.
GET email-link visits and link-scanner prefetch must not provision tenants,
approve applications, accept invitations, create sellers or spend funds.
