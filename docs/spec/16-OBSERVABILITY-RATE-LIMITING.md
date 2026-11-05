# GeraiExpress — Operational Signals and Limits

- Status: Proposed signal/limit contract; Observed Node-container logs, process-local counters and application-owned auth telemetry after Decisions DEC-020 and DEC-021 (ADR-0002, owner; T-062, T-064..T-066 built locally). Production signal delivery, alerting and the T-067 auth security review are not established by merged source.
- Owner: Engineering owner
- Updated: 2026-10-29
- Sources: CTX-29, CTX-30, CTX-36, CTX-37, CTX-41; PR-25, PR-27, PR-28; DEC-016, DEC-020, DEC-021, ADR-0002; `src/lib/limiter.ts`, `src/lib/rate-limit.ts`, `src/lib/client-address.ts`, `src/lib/auth-errors.ts`, `src/proxy.ts`, `src/lib/cron.ts`, `src/lib/mengantar/scheduled.ts`, `infra/scheduler/scheduler.mjs`.

## OBS-1 — Actionable, private operational evidence
- Status: Proposed
- Owner: Engineering owner
- Source: PR-25, PR-27, PR-28, TD-3, TD-6, TD-10; CTX-37.
- Statement: Each enabled critical journey shall expose complete durable state for safe recovery and bounded diagnostic signals with explicit completion, freshness, privacy and response ownership.
- Acceptance: A controlled success, failure and async retry/duplicate scenario produces the expected logical outcome and correlated sink evidence without private payloads; telemetry failure does not falsify business state or remove mandatory audit.
- Constraints: DATA-6, TEN-4, SEC-1, SEC-4, PRIV-1, DEL-1; exact installed telemetry API, retention, responder identities and alert thresholds remain release gates.
- Evidence: Observed structured stdout events and container health-check configuration (OBS-2); no production sink, query, alert or notification path was exercised by this documentation pass.
- Change history: 2026-10-28 — OBS-2 records implemented signals. 2026-10-29 — Decision (DEC-020, owner) replaces Worker logging/cron and rate-limit bindings with Node/Compose mechanics; Decision (DEC-021, ADR-0002, owner) replaces Supabase Auth and Send Email Hook telemetry with application-owned auth signals (`auth_unavailable`, `session_resolution_failed`, `auth_mail_failed`, `auth_rate_limited`, `rate_limiter_saturated`).

| Operator decision | Journey boundary and evidence | First safe action / accountable role |
|---|---|---|
| Can users enter their intended workspace? | Code requested → verified session → account completion → permitted destination; distinguish expected rejection, delivery uncertainty and dependency failure | Inspect bounded Auth/mail outcomes and current configuration; engineering owner. SMTP acceptance is not inbox delivery |
| Is a submitted shipment stuck or unsafe to repeat? | Durable operation accepted → dispatch attempts → authoritative original-order outcome; count unknowns and oldest unresolved age separately | Inspect original scoped receipt/account/attempt; integration owner. Fence unsafe dispatch, reconcile under TD-3 |
| Can paid shipments obtain correct labels? | Eligible generation request → known job → completed/failed PDF; URL renewal and print attempts are separate events | GET existing generation or correct failure cause; integration owner. No automatic POST storm |
| Is tracking current? | Verified observation/delivery received → scoped transition applied/deduplicated; show observation age | Check signature/account mapping or verified polling fallback; integration owner. Callback acknowledgement is not successful state application |
| Are assigned prices actually in force? | Quote/actual-charge comparison against applicable assignment; mismatch/unknown counts, safe account correlation | Pause affected price-dependent dispatch and verify provider terms; authorized pricing/integration owner. No automatic subsidy or customer repricing |
| Can Super Admin act safely? | Current grant/assurance → versioned command → atomic local audit or durable external outcome | Review denial/conflict or original operation; platform access-governance owner. No bypass from monitoring permission |

One logical operation can have many delivery/dispatch attempts. Attempts have
their own duration/outcome; retry success must not count as several completed
shipments or several logical failures. Unknown is unresolved, never silently
good or terminal failure. Persist current operations/audit regardless of trace
sampling. TD-6 remains the owner of product overview event/timezone definitions.

### Minimal signal schema and measurement

Prefer the actual stack's native facilities and standard telemetry conventions;
pin installed versions before choosing SDK-specific names. Bounded dimensions
are environment, component, operation class, result class and verified error
category. Define finite value sets in implementation. Never put tenant/user IDs,
emails, phones, AWBs, free text, raw paths or operation IDs in metric labels.
Restricted diagnostic correlation may carry opaque operation/audit/trace IDs
with explicit access/retention. They never authorize an action.

Do not record request/response bodies, passwords/OTPs, cookies, API keys in URLs,
Partner signatures/secrets, recipient/sender data, exact addresses or signed PDF
download URLs. Redact at the producing boundary, including dependency exceptions.
Diagnostic sinks may drop under bounded backpressure; failures remain visible
without blocking ordinary successful reads. Required audit/intent persistence
failing before a sensitive mutation blocks that mutation. A result already
received from a provider must retain safe durable recovery evidence under TD-3.

Before selecting an SLO, record the population, window, numerator/denominator,
delay threshold, exclusions and data-freshness behavior. Proposed measurement:

- **Submission completion:** cohort of distinct durable accepted operations in
  a declared window; authoritative expected completion within a selected deadline
  is the numerator. Validation denials before acceptance are outside the cohort;
  accepted operations with no dispatch/result remain visible. Provider restriction
  or insufficient funds is classified explicitly, never silently excluded.
- **Label readiness:** distinct eligible accepted generation operations and their
  completed outcomes within a selected deadline; a repeated GET adds no denominator.
- **Backlog freshness:** unresolved count and oldest age by bounded operation/state;
  missing/failed source data is unknown, not zero. No traffic and broken collection
  have different states.

Show period, timezone, source freshness and exclusion counts. Use complete
durable/aggregated populations for reliability ratios; sampled traces alone
cannot establish them. Numerical objectives and alert windows require pilot
measurement and owner selection; no inherited five-minute or 99.9% promise.

### Response and proof

Before production, name the person/rotation for each accountable role above and
approve the notification channel. Each alert needs a user symptom, complete query,
sustained trigger, missing-data behavior, deduplication, safe first action,
escalation, recovery condition and firing/non-firing evidence. Page only when
an immediate action can change the outcome; send capacity trends to review.

Safe incident sequence: establish scope and signal freshness → inspect the
original authorized operation → fence only unsafe affected work → reconcile or
apply an authorized compatible rollback → verify the user journey and signal
recovery. DR-1 owns restoration; secrets, arbitrary SQL and blind provider replay
are not troubleshooting shortcuts. Public health responses contain no dependency
topology or customer data; probes never create real sellers/orders or spend funds.

Release proof follows actual application → exporter/native sink → restricted
query, with a harmless non-production correlation marker. Verify one success,
one controlled failure, one retry/duplicate, redaction, expected metric changes,
and alert firing/non-firing when enabled. A logger initialized or dashboard
rendered does not establish end-to-end signal delivery.

## RATE-1 — Scope-aware capacity and retry rules
- Status: Proposed
- Owner: Integration owner
- Source: TD-3, TD-4, TD-7, TD-8, SEC-5; SRC-MENGANTAR-PARTNER in `sources.json`, CTX-37, DEC-020; `src/lib/limiter.ts`.
- Statement: Rate controls shall honor the actual provider/account scope and endpoint retry semantics, while bounding application-owned authentication, application ingress and polling without treating a throttle as permission to replay an uncertain mutation.
- Acceptance: Multiple outlets/key versions, Seller Web quota consumption, concurrent dispatch, 429, expired leases and unknown outcomes remain bounded and preserve original operation identity; blocked capability states remain actionable.
- Constraints: NFR-5, TEN-2, SEC-3, SEC-5; current provider documentation/configuration is authoritative and must be rechecked before enablement.
- Evidence: Retained provider-documentation baseline plus Observed fixed-window limits in `src/lib/limiter.ts` and `src/lib/rate-limit.ts` and SQL OTP limits in `db/migrations/20261029100000_auth_core.sql`; no production load or provider-quota proof. Decision (DEC-020, DEC-021, owner): these are process-local counters and PostgreSQL RPC rules, not Workers bindings or external Supabase Auth quotas.

| Limit domain | Scope and documented baseline | Required response |
|---|---|---|
| Partner API | Partner-wide 60 requests/minute fixed window; 1,000 new sellers/day resetting midnight WIB per reviewed contract (our account's entitlement unverified) | Durable shared scheduling; honor provider rate-limit/retry headers. Retried same external ID is not a new seller; TD-7 still governs exact retry safety. Observed (T-054): tenant retry windows and stops persist. Observed (T-110): every Partner request reserves `reserve_partner_quota` (per environment and Partner ID, all tenants and replicas, advisory-lock serialized; requests per UTC minute, distinct `externalUserId`s per WIB day) before signing; a denial is `partner_quota_exhausted` (nothing sent, retry later); a provider 429 is stored by `note_partner_retry_after` for every caller. Limits in `private.partner_quota_limits` are unverified placeholders (30/minute, 100/day) until Mengantar confirms the entitlement (RELEASE.md). DB concurrency/WIB-reset/shared-Retry-After tests are written in `tests/db/partner-quota-restore-fence.test.ts` |
| Seller shipping | Actual parent seller account across outlets and credential versions; endpoint-specific quota/serialization verified at enablement | One account authority/coordinator where required; do not key limits only by tenant, outlet or key version |
| PDF Print | TD-4's eight Print actions/60 seconds shared with Seller Web | POST consumes Print action even for reused job; GET renewal/status does not. Provider rejection remains possible despite local headroom |
| Auth and mail | Application-owned auth limits (`src/lib/limiter.ts`, `src/lib/rate-limit.ts`), SQL OTP limits (`public.auth_issue_otp` 30 s cooldown, `public.auth_verify_otp` 5 guesses/code and 20 guesses/hour/address) and the future production mail provider's quota/suppression rules (Proposal, unbuilt, T-063) | Show resend/retry guidance, generic public errors and recoverable mail state. Process-local visitor/account limits and SQL OTP throttles are RATE-2 |
| App commands/search/polling | Explicit per-action/actor/tenant/account limits selected from workload and abuse needs | Bounded pages/body/batch size and concurrency; no invented unlimited plan or unbounded background polling |

Observed (merged code): `src/lib/limiter.ts` retains per-minute limits of 10 for
sign-in/MFA visitors, 5 for demo and 3 for OTP; target-account/MFA and refresh
limits are 10 per minute. Visitor tables are bounded to 10,000 keys and account
tables to 100,000 keys; at capacity expired windows are evicted first, then the
oldest non-exhausted live window, while exhausted windows are NEVER evicted (an
all-exhausted table refuses new keys and emits `rate_limiter_saturated` at most
once per minute per table). They reset on process restart. Since T-066 renamed
`middleware.ts` to `src/proxy.ts` on the Node.js runtime, `REFRESH_LIMITER` and
the Server Action limiters share `globalThis` in one Node process (by construction;
the header comment in `src/lib/limiter.ts` still mentions the old Edge split).

Proposal (unbuilt): a shared limiter store before any second app instance or
overlapping replicas. The T-062 security fixes (IPv4-only `0.0.0.0` proxy port
binds with no-AAAA release requirement, limiter eviction preserving exhausted
windows, `172.30.62.1/32` local gateway trust, `10m × 3` log limits) are merged
in the working tree. No Cloudflare DDoS/WAF replacement is built; retained
Turnstile is not evidence of network-level capacity protection.

Read-only transient failures may use bounded backoff/jitter and a deadline.
Mutations require endpoint-specific proof: timeout/5xx after possible dispatch
enters reconciliation; neither exponential backoff nor a 429 wrapper makes a
non-idempotent command safe. Partner create can resume its stable external ID
under the documented contract; key rotation cannot be blindly repeated. Persist
next-attempt/age/attempt budget, stop at the defined bound and surface an owner
action. Sign each Partner attempt with fresh time and its exact request bytes.

Limits and retry budgets require explicit configuration and tests before the
pilot. Missing mandatory account coordination or unavailable limiter fails
closed for the affected provider mutation, preserving the draft/operation.
This is a capacity/safety contract, not a customer subscription entitlement.

## RATE-2 — Auth ingress: per-visitor and per-account limiting
- Status: Observed trusted-proxy address handling, process-local visitor/account limits, server-side Turnstile and SQL OTP throttles on the Node + PostgreSQL stack (DEC-020, DEC-021, ADR-0002, T-062, T-065, T-066); verify-email state binding (T-058), limiter follow-ups (T-060) and T-067 security review remain open
- Owner: Engineering owner
- Source: SEC-5, SEC-6, RATE-1; DEC-020, DEC-021, ADR-0002; `src/lib/client-address.ts`, `src/lib/visitor-key.ts`, `src/lib/limiter.ts`, `src/lib/rate-limit.ts`, `src/lib/auth/service.ts`, `src/lib/auth/turnstile.ts`, `src/proxy.ts`, `db/migrations/20261029100000_auth_core.sql`.
- Statement: Authentication traffic handled by the Node server shall be limited per visitor (from the trusted proxy's `X-Real-IP`), per visitor-plus-account pair, per target account and per MFA user, with server-side Turnstile verification and SQL per-code/per-address OTP limits; a throttle shall surface as a too-many-attempts message and a counted log event, never wrong credentials.
- Acceptance: A flood of sign-ins from N synthetic visitors does not stop a separate visitor from signing in; the eleventh code or MFA attempt against one account from different visitors is refused; a local throttle renders the Bahasa too-many-attempts message and emits `auth_rate_limited` without email, code or address; session refresh is limited per visitor and a refused refresh returns 503 + `Retry-After: 60` while keeping the session cookies.
- Constraints: RATE-1, SEC-5, SEC-6, DEC-009, DEC-010, DEC-020, DEC-021; no secret or PII in logs (SEC-7).
- Evidence: Observed merged code in `src/lib/client-address.ts`, `src/lib/limiter.ts`, `src/lib/rate-limit.ts`, `src/lib/auth/**`, `src/proxy.ts` and `db/migrations/20261029100000_auth_core.sql`, covered by `tests/unit/{client-address,limiter,rate-limit,auth-account-lockout,proxy,refresh}.test.ts` and `tests/db/{auth-core,captcha}.test.ts` (T-062, T-065, T-066). Verify-email form state binding remains T-058, side-channel/limiter follow-ups remain T-060, and T-067 independent security review is open.

Historical note (pre-DEC-021): when Supabase GoTrue owned Auth, RATE-2 also
specified opt-in `Sb-Forwarded-For` (`AUTH_FORWARD_CLIENT_IP`) forwarding with an
`sb_secret_` key to work around GoTrue's per-IP token buckets. Under DEC-021
(ADR-0002, T-066), GoTrue, `AUTH_FORWARD_CLIENT_IP`, `Sb-Forwarded-For` and
`authForwarding()` are removed; authentication runs in-process in `src/lib/auth/**`
against internal PostgREST and PostgreSQL 17.

Observed (merged code, 2026-10-29): `src/lib/client-address.ts` reads only
`X-Real-IP` when `TRUSTED_PROXY=1` ( taking the last comma-separated value if
several are present); production `infra/proxy/Caddyfile` overwrites `X-Real-IP`
and `X-Forwarded-For` with `{remote_host}` and drops `Forwarded`,
`CF-Connecting-IP`, `True-Client-IP` and `X-Client-IP`. `visitor-key.ts` groups
IPv6 by `/56`. Missing/invalid addresses refuse production visitor-limited
actions (fail closed). `compose.yaml` binds the production proxy to IPv4
`0.0.0.0` only (no AAAA records), and `Caddyfile.local` trusts only the pinned
`172.30.62.1/32` gateway.

Observed controls in `src/lib/rate-limit.ts`, `src/lib/auth/service.ts` and SQL:

1. **Visitor and account-plus-visitor pre-checks.** Password sign-in checks `SIGN_IN_LIMITER` (visitor, 10/60 s) and `withinAccountVisitorLimit("SIGN_IN_ACCOUNT_LIMITER", email)` (account + visitor network, 10/60 s) before calling `auth.signInWithPassword`, so one visitor cannot burn another visitor's pre-CAPTCHA budget.
2. **Post-CAPTCHA account budget.** `auth.signInWithPassword` verifies Turnstile server-side (`src/lib/auth/turnstile.ts`) before checking the password; only after a non-`captcha_failed` result does `signInAction` spend `withinAccountLimit("SIGN_IN_ACCOUNT_LIMITER", email)` (10/60 s across all visitors) and immediately revokes the newly created session (`auth.revokeSession`) if that account-wide budget is exceeded.
3. **OTP code issuance and verification.** Code requests check `OTP_LIMITER` (visitor, 3/60 s) and `withinAccountVisitorLimit("OTP_ACCOUNT_LIMITER", email)` (10/60 s), then verify Turnstile server-side before `public.auth_issue_otp` (which enforces the signup gate, refuses anonymous users, and enforces a 30-second per-email cooldown and the 20-guess/hour budget). Code verification (`verifyEmailCode`) now also verifies Turnstile server-side (`src/lib/auth/service.ts:204`, closing the CAPTCHA part of T-058) and `public.auth_verify_otp` enforces 10-minute code validity, at most 5 wrong attempts per code, and a cumulative 20 wrong attempts per email per hour (`db/migrations/20261029100000_auth_core.sql:102-238`). The email field on the verify form is still client-held state without a server-signed binding (remaining part of T-058).
4. **Local refusal logging.** Every local refusal calls `authThrottleMessage` and logs `{"event":"auth_rate_limited","route","status"}` (`route` in `/masuk`, `/daftar`, `/verifikasi-2fa`, `/refresh`) without email, code, token or IP address; there is no upstream Auth 429 anymore.
5. **Session refresh preservation.** `src/proxy.ts` (Node runtime) and `resolveSession` (`src/lib/db/refresh.ts`) budget token rotations with `REFRESH_LIMITER` (10/60 s per visitor). When the budget is exhausted or `AuthUnavailableError` occurs, `src/proxy.ts` answers **503 + `Retry-After: 60`** itself and keeps `gx_at` and `gx_rt`, so the session survives.
6. **No direct public Auth/PostgREST endpoint.** PostgREST has no published port in `compose.yaml` and `auth.*` tables/RPCs are revoked from `public`, `anon` and `authenticated`, so external callers cannot bypass the Node app's limiters or Turnstile checks by calling PostgREST directly.

## OBS-2 — Signals promised versus implemented
- Status: Observed merged-source signals (2026-10-29); Proposal for new signals and production collection
- Owner: Engineering owner
- Source: OBS-1, RATE-1; DEC-016, DEC-020, DEC-021, ADR-0002; `src/lib/auth-errors.ts`, `src/lib/registration-actions.ts`, `src/proxy.ts`, `src/lib/limiter.ts`, `src/lib/cron.ts`, `src/lib/mengantar/scheduled.ts`, `infra/scheduler/scheduler.mjs`, `Dockerfile`, `compose.yaml`; OBSERVABILITY.md owns the operational handoff.
- Statement: Each journey signal promised by OBS-1 and RATE-1 shall be classed as implemented, partly implemented or absent, so that no document implies an alert exists where only a log line does.
- Acceptance: Every row below is re-checked against the repository when its task lands; a signal moves to "implemented" only with the log event name and a test or query that proves it; no alert is described as active until a rule, a threshold, a notification channel and a named responder exist.
- Constraints: OBS-1, RATE-1, NFR-3, SEC-1; named responders, retention and thresholds remain release gates.
- Evidence: Static reading of merged Node/Compose source and BUILD-LOG.md's bounded local observations; no production dashboard, query, collector, alert or log-retention proof was exercised.

| Promised signal | Implemented today (Observed) | Gap |
|---|---|---|
| Auth, session and mail outcomes | App stdout events `auth_mail_failed` (`src/lib/registration-actions.ts`), `auth_unavailable` and `auth_rate_limited` (`src/lib/auth-errors.ts`), `session_resolution_failed` (`src/proxy.ts`), and `rate_limiter_saturated` (`src/lib/limiter.ts`). The former Send Email Hook events `auth_mail_sent` and `auth_mail_refused` were removed in T-066 | No production collection/alert proof; local Mailpit only and production mail fails closed pending T-063 |
| Stuck or unsafe-to-repeat shipments | `dispatch_sweep` with `checked`, `failed`, `tally`, `priceMismatch`, `priceUnknown` and `stuck` (`src/lib/mengantar/scheduled.ts`); the sidecar schedules it every five minutes. Existing interactive `dispatch_action` and shipment `price_mismatch` evidence remain | No alert/dashboard; missing machine configuration logs `disabled: true`. Configured cadence is not evidence of a live production scheduler |
| Label readiness | Label snapshots audited as `label.snapshot` and each print appends `label_print_events`; no dedicated runtime log event | No alert/dashboard; a print request is not paper. Provider-PDF job states remain deferred (DEC-017) |
| Tracking freshness | None | No webhook or status pull exists (T-045) |
| Assigned prices in force | Observed price_mismatch plus T-041 terms/ceiling and T-053 per-quote provider bps, admin variance and tenant-only cost/settings views | No alert or monitoring drift signal; no separate stated-provider-value field or written provider verification is established |
| Super Admin actions | Append-only `audit_events` and its filtered page `/admin/audit` | No monitoring projections, overview or recovery queue (PR-25, PR-27 not built) |
| Demo cleanup | Hourly scheduler route invokes `runDemoCleanup` and emits `demo_cleanup` counts/`hasMore`/`failed` (`src/lib/mengantar/scheduled.ts`); the guarded `pg_cron` job is skipped on plain PostgreSQL 17 where the extension is absent | No production scheduler or alert proof; missing `POSTGREST_URL`/`AUTH_JWT_SECRET` disables cleanup |
| Scheduler and cron boundary | `scheduler_started`, `scheduler_call`, `scheduler_skipped` in the sidecar; `cron_skipped` and `cron_timeout` in `src/lib/cron.ts` | No absence-of-tick alert or notification; in-process task lock is not distributed coordination; credential rewrap runs hourly in the `cleanup` task (`credential_rewrap`, T-057) in bounded batches of 500 after an in-process cursor (T-105) over only the tenants still below the current key version (`machine_rewrap_candidates`, T-109); the cursor does not survive a restart (a new pass is idempotent) |
| Readiness | `GET /healthz` loads the server configuration (T-105), runs the anonymous SQL-backed `registration_open` RPC and the machine-only `schema_version` RPC (T-109) with a 2-second timeout; 200 for a boolean result and an applied schema at least `EXPECTED_SCHEMA_VERSION` (a newer schema is ready), 503 `reason:"schema_behind"` for an older schema, otherwise 503 with `ok:false` and no dependency details; `Dockerfile` declares a health check and Compose waits for app health (`postgrest` has its own `postgrest --ready` check) | `/healthz` proves configuration, PostgREST, a PostgreSQL read and the schema level; it does not check provider or mail, and no externally exercised production probe exists |
| Log retention and infrastructure protection | Structured stdout exists and `compose.yaml` configures bounded Docker `local` logs (`10m × 3`) on every service | Off-host log shipping, retention/responder choices and Cloudflare DDoS/WAF replacement are not built |
| Alerts | No repository-defined runtime alert/notification contract is active | External host/provider dashboard settings are Unknown; no production channel, SLO or named responder is proved |

Proposal: count bounded private events for Auth/native throttles (RATE-2), Partner
quota waits/restrictions (RATE-1), future webhook rejection/replay (SEC-6),
fixed-server egress failures and unknown-operation reconciliation (ARCH-2/ARCH-5),
discount drift/missing provider percentage (DATA-9), pickup reservation failures
and reservation-without-order recovery (UX-10), and scheduler silence. New sinks,
thresholds and notifications are unbuilt; use no account name, address or tenant
identifier as metric labels. Production ACME issuance/renewal, off-host log/alert
delivery and PostgreSQL backup/PITR proof (T-067) remain unproved, not healthy signals.
