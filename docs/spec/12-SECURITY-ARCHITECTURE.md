# GeraiExpress — Security Boundaries

- Status: Proposed controls with Observed merged-code boundaries; amended 2026-10-29 for Decisions DEC-020 and DEC-021 (ADR-0002, owner). The T-062 runtime security fixes and T-064..T-066 PostgreSQL + PostgREST + application-owned auth cutover are merged locally; T-067 independent security review of the owned auth module and production security proof remain open.
- Owner: Engineering owner
- Updated: 2026-10-29
- Scope: Trust-boundary controls. TEN-1/TEN-2 own isolation; IAM-1/IAM-2 own permission policy.

## SEC-1 — Trusted commands, credentials, and private results
- Status: Proposed
- Owner: Engineering owner
- Source: CTX-1, CTX-3, CTX-11; SRC-SUPABASE-RLS and SRC-SUPABASE-FUNCTIONS in `sources.json`.
- Statement: Every operational command shall validate identity, object scope, permitted action, input bounds, and authority version before a sensitive effect, with private credentials and projected results.
- Acceptance: Direct unauthorized Data API/RPC/server requests, ownership changes, oversized inputs, arbitrary outbound hosts, and canary secret/PII leakage attempts are denied while valid workflows remain usable.
- Constraints: TEN-1, TEN-2, DATA-1, DATA-3, IAM-1, PRIV-1.
- Evidence: Proposed controls plus Observed server/configuration/auth boundaries in `src/lib/config.ts`, `src/lib/client-address.ts`, `src/lib/cron.ts`, `src/lib/db/**`, `src/lib/auth/**`, `src/proxy.ts`, `db/foundation/`, `db/migrations/20261029100000_auth_core.sql` and `infra/proxy/`; T-067 independent security review and production security audit are not yet run.

| Entry → asset/effect | Required boundary | Proposed proof |
|---|---|---|
| Browser selector → contact/shipment row | Current membership + action + same-tenant FK/policy; immutable ownership | Same-tenant success, foreign row read/write/reparent denial, direct RPC coverage |
| Settings input → provider secret/connection | Authorized tenant administrator; bounded input, encrypted private storage, dedicated key and rotation/version | No plaintext readback, no partial fallback, wrong-tenant update denied |
| Browser confirmation → provider charge/order | Current draft/quote/account version, explicit user confirmation, durable command and idempotency | Modified quote/total/account rejected, replay and double-click safe |
| Server/job → private database transition | Bounded machine permission and authoritative operation reference | Forged tenant/account or arbitrary target cannot mutate other data |
| Provider response/link → browser or HTTP fetch | Validate schema/size, expected authority and trusted HTTPS endpoint; reject unsafe redirects/hosts | Bounded body, HTML/error response, foreign-account ID, unsafe download URL rejected |
| Import/export → parsing and spreadsheet | Byte/row/fan-out limits, scoped preview/confirmation, escaped output | Excessive/ambiguous/tampered input rejected; formula cells inert |
| List/detail/error/telemetry → contact/credential disclosure | Minimum permitted DTO projection, server masking where selected, private cache policy, structured redacted errors | Credential absent everywhere public; customer canaries absent from unauthorized/suppressed payloads and logs; authorized operational display still works |

Use a request-scoped PostgREST client (`dbServer()` in `src/lib/db/server.ts`,
carrying the user's verified `gx_at` access JWT) for user-context work. Do not turn an
ordinary server route into a `service_role` proxy with a client-supplied tenant
filter. Exposed RPCs must be safe when called directly: wrapping a dangerous
RPC in a careful server route does not protect the database endpoint. Privileged
functions require restricted execution, fixed search paths, parameterized
operations, narrow allowed transitions, and explicit scope validation.

Provider keys are credentials embedded in outbound URL paths. Strip complete
credential-bearing paths from diagnostic events, fetch exceptions, and traces.
Protect key submission and never return stored key values or fragments in
settings state. Encryption keys, provider secrets and signed download URLs must
not be written into the specification, fixtures, logs, analytics, browser storage
or public configuration. Session material (`gx_at` access JWT and `gx_rt`
refresh token) is restricted to the server-only HttpOnly cookie helpers
(`src/lib/db/cookies.ts`, `src/lib/db/session.ts`, `src/proxy.ts`) and
`auth.sessions` (SHA-256 refresh hashes); do not make extra copies in application
storage, diagnostics or saved artifacts. Use built-in Node/Web Crypto primitives and a
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

Decision (CTX-41 item 6): provider webhooks are served from their own cookie-less host
and authenticated only by signature; SEC-6 holds the host-level controls. Observed
2026-10-28: no webhook route exists, so this section is target only (TASKS T-045).

## SEC-3 — Partner signing and seller credential lifecycle
- Status: Proposed
- Owner: Engineering owner
- Source: CTX-17, CTX-18.
- Statement: Partner signing and credential effects shall be confined to configured trusted operations with verified local authority, private versioned storage, approved egress, and durable recovery.
- Acceptance: Arbitrary host/path/body signing, tenant/seller substitution, raw-key readback, credential/preimage logging, unapproved egress fallback, and disabled-key reactivation are denied; valid scoped signing and managed recovery work.
- Constraints: TEN-3, IAM-3, DATA-4, TD-7, TD-8, ARCH-2, NFR-3.
- Evidence: Documentary threat-boundary review and offline protocol check only; no deployed security proof.

Decision (DEC-020, owner): the platform-global Partner Secret is supplied to the
Node app through its private container environment. Seller API keys and callback
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
it cannot replace either. Verify server, proxy and container log policy as well as app logs.
Expose safe error codes and operation references, never secret-bearing vendor
messages or URLs. Stop retries on Partner/seller restriction as appropriate;
provider-disabled credentials must not be circumvented by another seller.

Persist regeneration intent and atomically save returned key/callback versions
before readiness. Unknown callback state disables ingestion until synchronized;
do not accept unsigned events or an unbounded old-secret grace period. Any
bounded overlap for authentic queued events requires a verified provider retry
contract and account/version binding, not a guessed global verifier secret.

Decision (DEC-020, owner): the Node app holds provider signing and credential
sealing configuration; no separate gateway is built. SEC-7 owns secret inventory
and rotation, ARCH-5 owns placement, and ARCH-2 still requires the server's fixed
IPv4 to be accepted by Mengantar. Source-IP allowlisting never replaces local
tenant permission or the no-blind-replay rule (DEC-010).

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
- Source: CTX-31 through CTX-35; DEC-007, DEC-009, DEC-020, DEC-021, ADR-0002; `src/lib/auth/**`, `src/lib/db/**`, `src/proxy.ts`, `db/migrations/20261029100000_auth_core.sql`.
- Statement: Public authentication and onboarding shall resist enumeration, forged ownership, pre-registration takeover, unsafe navigation, replay, brute force and shared-cache session exposure while preserving legitimate recovery.
- Acceptance: Wrong/replayed code or invite, metadata/role forgery, foreign application reference, malicious redirect, concurrent review and stale identity cannot grant access; controlled valid paths pass and Auth/mail secrets remain absent from logs/browser persistence.
- Constraints: PR-29 through PR-33, IAM-8, TEN-5, DATA-7, ARCH-3, DEC-021, ADR-0002; the application-owned auth module (`src/lib/auth/**` + `db/migrations/20261029100000_auth_core.sql`) is the single authentication authority, with no unverified confirmation bypass.
- Evidence: Observed local implementation in `src/lib/auth/**`, `db/migrations/20261029100000_auth_core.sql`, `tests/db/auth-core.test.ts` (50 SQL-level tests), `tests/db/captcha.test.ts` and `tests/unit/auth-*.test.ts` (T-065, T-066): `scrypt` passwords with dummy-hash timing equalization on unknown emails, HMAC-SHA256 6-digit OTPs (10-min TTL, 5 guesses/code, 20 guesses/hour/address, 30 s cooldown), SHA-256 refresh-token rotation with 10 s parallel-tab grace (`recent_reuse`) and reuse revocation, server-enforced 7 d / 12 h session expiry, AES-256-GCM sealed TOTP secrets with `last_used_step` replay guard, and fail-closed server-side Turnstile verification (`src/lib/auth/turnstile.ts`) before password sign-in, demo entry, OTP request AND OTP verification. Verify-email address in the registration form remains client-held state without a server-signed binding (T-058), and **T-067 independent security review of the owned auth has not yet been run.**
- Change history: 2026-10-13 — Added in the registration and documentation-completeness review.
- Change history: 2026-10-28 — DEC-007 accepted email-first verification, manual approval during the pilot and invitation-only staff entry; DEC-009 replaced native SMTP with the Worker Send Email Hook.
- Change history: 2026-10-29 — DEC-021 (ADR-0002, T-065/T-066) replaced Supabase Auth and the Send Email Hook with the application-owned auth module (`src/lib/auth/**`, `db/migrations/20261029100000_auth_core.sql`) and direct code-mail delivery (`src/lib/auth-mail.ts`, `src/lib/mail-transport.ts`).

| Entry → protected effect | Control and proof (ADR-0002, DEC-021) |
|---|---|
| Public email form → Auth/mail capacity and account existence | Generic accepted feedback (`withheld` vs `sent` indistinguishable to caller); server-side Turnstile before OTP request and OTP verify; process-local visitor/account limiters plus SQL per-address cooldown (30 s) and hourly guess budget (20/h); dummy password hash on unknown email (`src/lib/auth/password.ts`) |
| OTP verification → verified session | 6-digit code hashed with HMAC-SHA256 (`AUTH_SECRET`) and verified in `public.auth_verify_otp` (at most 5 attempts per code, 10-min TTL, single use); opens a server-held `auth.sessions` row and sets host-only HttpOnly `gx_at`/`gx_rt` cookies; code-only mail with no redirect callback URL |
| Attacker registration → another inbox owner's credentials | Email-first/password-after-proof (DEC-007); `discard_pre_verification_password` trigger clears any pre-verification password at first email confirmation; `public.auth_set_password` requires a live session of that user and revokes all other sessions of the user |
| Cookie mutation → application/role changes | Current identity/scope (`currentUser()` + `auth_session_live`), Server Actions Origin check, expected revision and idempotency; `lock_anonymous_identity` trigger blocks demo-to-permanent conversion |
| Invite link → tenant membership | Independent verified-email match in `accept_invitation`, current tenant/invite/issuer/role checks; expiry/revocation/replay/concurrency tests (`tests/db/invitations.test.ts`) |
| Mail configuration → arbitrary send or secret exposure | Fixed sender and code-only template (`src/lib/auth-mail.ts`); SQL `auth_issue_otp` checks `private.before_user_created` and refuses anonymous identities before any code exists; `src/lib/mail-transport.ts` fails closed outside local Mailpit until T-063 |
| Auth response → another browser/session | `Cache-Control: private, no-store` on all `src/proxy.ts` responses; host-only `gx_at` and `gx_rt` cookies; 503 + `Retry-After: 60` on local refresh refusal or DB unavailability preserves cookies without dropping the session |

Under DEC-021 (ADR-0002), PostgREST runs on the internal Compose network with no
published port and `auth.*` tables/RPCs are revoked from `public`, `anon` and
`authenticated`, so all authentication requests enter through the Node app and
its in-process limiters (`src/lib/limiter.ts`, `src/lib/rate-limit.ts`) plus SQL
throttles. Former Cloudflare runtime DDoS/WAF protection is not automatically
replaced by the Node container. Turnstile remains (DEC-020, DEC-021) and is
verified server-side by `src/lib/auth/turnstile.ts` before sign-in, demo entry,
code request and code verification. Never trust client-supplied forwarding
headers (`client-address.ts` reads only proxy-overwritten `X-Real-IP` when `TRUSTED_PROXY=1`).

The server verifies `gx_at` HS256 signature, `aud`, `role` and `exp` locally
(`src/lib/auth/jwt.ts`) AND checks `public.auth_session_live` in `currentUser()`
(`src/lib/db/server.ts`) and on non-GET/HEAD requests in `resolveSession`
(`src/lib/db/refresh.ts`), so a revoked or expired session fails closed on the
next check rather than surviving until JWT expiry.
GET email-link visits and link-scanner prefetch must not provision tenants,
approve applications, accept invitations, create sellers or spend funds.

## SEC-6 — Session cookies, host separation, webhook-host ingress and Auth ingress
- Status: Decision (hosts and CTX-41 items 3, 6, 9 and 16: DEC-015; per-host CSP, health route and CORS-off accepted 2026-10-28; runtime and owned-auth cookies DEC-020, DEC-021, ADR-0002); cookie flags, host routing, `src/proxy.ts` and the noindex header are built (T-036, T-038, T-042, T-062, T-066), the script CSP is Report-Only (T-055) and nothing is deployed
- Owner: Engineering owner
- Source: DEC-009, DEC-015, DEC-020, DEC-021, ADR-0002; CTX-41 items 3, 5, 6, 9, 10 and 16; review P1-1, P1-9, P1-10, P1-11; PR-36; TASKS T-038, T-042, T-045, T-062, T-066.
- Statement: Session cookies (`gx_at`, `gx_rt`) shall be host-only, `HttpOnly`, `Secure` in production and `SameSite=Lax`; the webhook host shall be cookie-less and authenticate by signature alone; and authentication traffic handled by the Node server shall be limited per visitor (from the trusted proxy's `X-Real-IP`) and per target account (RATE-2).
- Acceptance: An end-to-end test shows every `gx_at` and `gx_rt` session `Set-Cookie` carrying `HttpOnly` (`Secure` on HTTPS/production) and no session token in `document.cookie`; an app-host cookie is not sent to the owner host; a webhook-host request carrying a cookie has its `Cookie` header stripped and the response sets none; an unsigned, stale, replayed or oversized webhook causes no mutation; the CSP rollout is observed in Report-Only before enforcement.
- Constraints: SEC-1, SEC-2, SEC-5, TEN-6, ARCH-6, RATE-2, DEC-009, DEC-020, DEC-021.
- Evidence: Observed merged host/cookie/CSP/rate code in `src/proxy.ts`, `src/lib/hosts.ts`, `src/lib/db/cookies.ts`, `src/lib/db/session.ts`, `src/lib/db/refresh.ts`, `src/lib/csp.ts`, `src/lib/rate-limit.ts`, `src/lib/client-address.ts` and `src/lib/limiter.ts`, plus `infra/proxy/Caddyfile`. Tested in `tests/unit/{hosts,proxy,cookies,refresh,client-address,limiter,rate-limit}.test.ts` and `tests/e2e/hosts.spec.ts`. T-067 independent security review of the owned auth and deployed-host TLS proof remain open.

| Control | Target | Observed / remaining claim (2026-10-29) |
|---|---|---|
| Cookie scope | Decision (CTX-41 item 3): host-only, never set on `.geraiexpress.com`; owner and app hosts do not share cookies | Built (T-042, T-066): `src/lib/db/cookies.ts` drops any `Domain` for `gx_at`, `gx_rt` and `ge_tenant`; `tests/e2e/hosts.spec.ts` shows app-host cookies are host-only and not sent to the owner host; no host is deployed |
| Session cookie flags | Proposal (review P1-10, T-038; ADR-0002 section 3.3): one shared helper sets `httpOnly: true`, `secure` in production/HTTPS, `sameSite: "lax"`, `path: "/"` on `gx_at` and `gx_rt`, mirroring server-enforced lifetimes (7 days gerai, 12 hours Super Admin, DEC-019, DEC-021) | Built (T-038, T-042, T-065, T-066): `sessionCookieOptions` in `src/lib/db/cookies.ts` applies those flags and bounds, and `private.auth_open_session` enforces 7 days / 12 hours in `auth.sessions`; no browser-side auth client or `document.cookie` use exists; TOTP recency within a 12-hour session remains T-054 |
| Transport | Decision (DEC-020, owner): Caddy terminates production HTTPS for the four hosts; retain HSTS | Observed: `infra/proxy/Caddyfile` enables automatic HTTPS and sends HSTS; `src/proxy.ts` also sends HSTS on HTTPS. Unknown: real production ACME issuance/renewal; DNS and ACME contact are owner-gated |
| CSP | Decision (CTX-41 item 16): per-host CSP. Proposal (T-055): move the base header to `next.config.ts` or the reverse proxy without overwriting Next's nonce-carrying request policy; observe Report-Only before script enforcement; retain Turnstile | Observed: `src/lib/csp.ts` and `src/proxy.ts` enforce the base policy (`frame-ancestors 'none'; object-src 'none'; base-uri 'none'; form-action 'self'`) and emit nonce/strict-dynamic in Report-Only. Enforced script CSP remains T-055 |
| Indexing | Decision (CTX-41 item 9): `X-Robots-Tag: noindex` on every non-marketing host | Built (T-036, T-042): `X-Robots-Tag: noindex, nofollow` on every host except the production apex, including 404 and `/healthz`; the `robots.txt` of every non-apex host is disallow-all |
| Webhook host | Decision (CTX-41 item 6): separate cookie-less host; signature only. Proposal for the webhook mechanism (TD-4): HMAC-SHA256 over timestamp, a dot and the exact raw body, constant-time compare, body size cap, replay window, per-seller callback secret held per tenant and never shown, 2xx only after durable persistence | Partly built (T-042, T-066): the `hooks` audience in `src/lib/hosts.ts` serves only the reserved prefix `/api/webhooks` and `/healthz`, and `src/proxy.ts` strips incoming `Cookie` headers and sets none; no webhook route exists yet (T-045) |
| Send Email Hook route (removed) | Historical (DEC-009, DEC-018): was `/api/auth/send-email` on the hooks host | Removed in T-066 under DEC-021 (ADR-0002): the app renders and sends code mail directly (`src/lib/auth-mail.ts`, `src/lib/mail-transport.ts`) after `public.auth_issue_otp` gates issuance in SQL |
| Server Actions origin check | Unknown: whether the framework origin check needs explicit allowed origins once there are two tenant-facing hosts | Observed (review): the framework origin check covers Server Actions today on one host |
| Auth ingress | RATE-2: visitor/account guessing controls, server-side Turnstile and retryable 503 refresh refusal | Observed: trusted-proxy `X-Real-IP` via `client-address.ts`; fixed-window process-local counters in `limiter.ts`; `src/proxy.ts` answers 503 + `Retry-After: 60` on refused or DB-unavailable refresh and keeps cookies; Turnstile verified before password sign-in, demo entry, OTP request and OTP verify (`src/lib/auth/turnstile.ts`). Verify-email state binding remains T-058; limiter follow-ups remain T-060 |

Observed runtime controls (T-062 security fixes merged in the working tree):
`compose.yaml` binds the production proxy to IPv4 `0.0.0.0` only (release requires
no `AAAA` records so Docker's IPv6 userland proxy cannot collapse visitor addresses);
`limiter.ts` evicts expired windows first, then oldest non-exhausted windows, and
never evicts exhausted windows; `Caddyfile.local` trusts only the pinned
`172.30.62.1/32` gateway; `compose.yaml` requires `GX_ENV_FILE` and sets `10m × 3`
container log limits and read-only root filesystems. Remaining gaps: no Cloudflare
DDoS/WAF replacement is built, a shared limiter store is required before a second
app instance (Proposal, unbuilt), and T-067's independent security review of the
owned auth module is still open.

Counter-evidence considered: HttpOnly cookies do not stop an attacker who can already run
script from acting as the user in-page, so SEC-6 reduces token theft, not XSS impact; the
CSP rollout is the control for that.

## SEC-7 — Secret handling: Partner Secret, credential key ring and secret inventory
- Status: Proposed control contract; Decision secret ownership retained with Node environment delivery and PostgreSQL/PostgREST/owned-auth secrets under DEC-020 and DEC-021 (ADR-0002, owner); Observed key ring/rewrap library and RPC, scheduled invocation still missing (T-057)
- Owner: Engineering owner
- Source: DEC-009, DEC-010, DEC-012, DEC-020, DEC-021, ADR-0002; SEC-3, ARCH-5, DEL-2; TASKS T-037, T-038, T-050, T-057, T-062, T-063, T-064, T-065, T-066, T-067; `src/lib/config.ts`, `src/lib/auth/instance.ts`, `compose.yaml`, `infra/env/*.env.example`, `scripts/check-client-bundle.mjs`, `scripts/check-environments.mjs`.
- Statement: Every secret shall have one accountable source of truth, least-privilege runtime holders, a separate value per environment and a rotation path that never makes stored data unreadable. Decision (DEC-020, DEC-021, owner): app and database/PostgREST secrets enter through a mode-0600 env file outside the checkout, not Worker bindings or the image; the credential sealing key uses a versioned ring.
- Acceptance: Without required Partner configuration the Node app makes no Mengantar call and reports `configuration_blocked`; sealing under v1, selecting v2 and decrypting v1 still works; a bounded re-encryption job moves old rows; bundle checks reject forbidden browser secret markers, privileged JWTs and scanned secret values baked into output; no secret value enters tracked templates, fixtures, documentation, logs or chat.
- Constraints: SEC-1, SEC-3, ARCH-5, DEL-2, NFR-3; DEC-010, DEC-012, DEC-020, DEC-021. Local generated env files are private and gitignored; production env files stay outside the repository and build context.
- Evidence: Observed: `src/lib/config.ts` reads `process.env` at call time; `src/lib/auth/instance.ts` requires `AUTH_JWT_SECRET` and `AUTH_SECRET` (>= 32 bytes, distinct) and mints the static `service_role` and `anon` JWTs; `credential-crypto.ts` reads the ring/current version and preserves single-key v1; `credential-keyring.ts` retains fenced/audited rewrap (`src/lib/mengantar/scheduled.ts` has dispatch/cleanup only, not rewrap, T-057). `scripts/check-client-bundle.mjs` scans browser markers, privileged JWT roles, known env-file secret values and standalone env-file exclusion. `scripts/check-environments.mjs` enforces distinct 32+ char secrets across environments. No real production secret value or rotation was inspected for this section.

| Secret | Holder and state today (Observed) | Target (Proposal unless marked) |
|---|---|---|
| Partner Secret | App runtime environment through `config()`; `src/modules/credentials/partner-deps.ts` still falls back from `MENGANTAR_PARTNER_SECRET` to the sandbox-named setting, while the admin badge checks only the first name | Proposal: one source/name and no silent fallback; fail closed. Decision (DEC-020, owner): no gateway secret holder. Never put a real value in tracked env templates or image layers; rotate previously exposed values before production |
| Partner ID | Non-secret runtime setting with `DEFAULT_PARTNER_ID` fallback in `partner-deps.ts`; the admin page separately reads the stored setting | Proposal: one source of truth, no hard-coded default; runtime cutover does not resolve that discrepancy |
| `CREDENTIAL_KEY`, `CREDENTIAL_KEYS`, `CREDENTIAL_KEY_CURRENT` | App environment through `config()`; single-key v1 or versioned ring/current pointer; ciphertext opening honors stored key version and rewrap is fenced/audited | Observed library/RPC; T-057 adds the scheduler-route trigger. Retain old keys until rewrap completes and use a separate ring per environment; no separate gateway |
| `AUTH_JWT_SECRET` | App runtime env file (`src/lib/auth/instance.ts`) and PostgREST (`PGRST_JWT_SECRET` in `compose.yaml`); >= 32 bytes, distinct from `AUTH_SECRET` | Decision (DEC-021, ADR-0002): signs 10-min `gx_at` user JWTs and the server-only `service_role` machine JWT (replacing `SUPABASE_SECRET_KEY`). Separate per environment; rotation invalidates active access tokens and requires re-minting static tokens (T-067 gate) |
| `AUTH_SECRET` | App runtime env file only (`src/lib/auth/instance.ts`); >= 32 bytes, distinct from `AUTH_JWT_SECRET` | Decision (DEC-021, ADR-0002): derives the HMAC key for `auth.otp_codes` and the HKDF AES-256-GCM key sealing `auth.mfa_factors.secret_sealed`. Separate per environment; rotation handling is a T-067 gate |
| `PGRST_DB_URI`, `POSTGRES_PASSWORD` | External env file interpolated by `compose.yaml` into `postgrest` (and `postgres` when `--profile db` is used); never passed to `app` or `scheduler` | Separate per environment; `authenticator` role password set after first migration (`RELEASE.md` gate 11) |
| `TURNSTILE_SECRET_KEY` | App runtime env file (`src/lib/auth/instance.ts`, verified server-side by `src/lib/auth/turnstile.ts`); public `TURNSTILE_SITE_KEY` in runtime config | Decision (DEC-020, DEC-021): required unless `AUTH_CAPTCHA_DISABLED=true`, which `check:environments` refuses outside `local` |
| Seller API keys and callback secrets | Sealed tenant/version-scoped records in `private.seller_credentials`; callback ingestion is not built | Server-only; key-rotation code ignores `callbackSecret` until the signed webhook contract is implemented (T-045) |
| `CRON_SECRET` | App runtime env file and scheduler environment; `compose.yaml` gives the scheduler no other app secret | Observed: internal-host gate, bearer comparison and task lock in `src/lib/cron.ts`; keep value environment-specific, out of logs and unreachable through the public proxy |
| Production mail credentials | None configured by the current local-only `src/lib/mail-transport.ts` | Proposal (unbuilt): owner-selected production provider/domain and transport under T-063; production fails closed meanwhile |
| Historical `SUPABASE_SECRET_KEY`, `SEND_EMAIL_HOOK_SECRET` | Removed from code and env templates in T-066 (DEC-021) | Owner must revoke/rotate on the old remote Worker + Supabase preview when retiring it (`RELEASE.md` gate 10) |

Observed: `.dockerignore`/`Dockerfile` exclude env files from the build and
`scripts/check-client-bundle.mjs` rejects a copied standalone env file, privileged
JWT or scanned secret value. `compose.yaml` requires `GX_ENV_FILE` with no local
fallback (`${GX_ENV_FILE:?...}`). `scripts/check-environments.mjs` defaults to
secret-free templates; actual external env files must be supplied at release to
prove cross-environment separation.

Unknown: whether host/container tooling or a future log sink captures outbound
seller-key URLs. Pin safe proxy/app/collector redaction before production;
`compose.yaml` bounds container logs (`local` driver, `10m × 3`), while a
Cloudflare DDoS/WAF replacement and the T-067 auth security review remain open.

## Backend audit amendment (DEC-022)

Execution task: T-068.

- First-password initialization is a machine-only RPC that locks the user row and rejects an existing hash; concurrent requests sharing a session cannot overwrite the winner. The kept session is locked during password mutation. Evidence: `tests/db/backend-audit.test.ts`, `tests/db/auth-core.test.ts`.
- Retired GoTrue-role grants and anonymous/authenticated sequence grants/defaults are revoked by a forward migration. Historical SQL and the still-used signup gate are retained. Evidence: catalog allowlists and sequence probes in `tests/db`.
- Coolify's edge is trusted only at its verified exact address, with right-to-left forwarded-address parsing; all public traffic passes the internal gateway and no app/data ports are published. Evidence: `scripts/test-coolify-proxy.mjs` and environment model checks.
- Database-owner/login credentials are excluded from the app environment. Migration runners serialize through a PostgreSQL advisory lock and validate the complete applied manifest before writing. Evidence: `tests/db/migration-runner.test.ts` and `tests/unit/db-environment.test.ts`.
- These are locally executable controls, not proof of the remote host, public TLS, backup storage or provider entitlements. See STATUS.md for the latest executed result.
