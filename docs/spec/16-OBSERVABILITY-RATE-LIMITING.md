# GeraiExpress — Operational Signals and Limits

- Status: Proposed signal/limit contract; no telemetry pipeline or alert is running.
- Owner: Engineering owner
- Updated: 2026-10-13
- Sources: CTX-29, CTX-30, CTX-36, CTX-37; PR-25, PR-27, PR-28.

## OBS-1 — Actionable, private operational evidence
- Status: Proposed
- Owner: Engineering owner
- Source: PR-25, PR-27, PR-28, TD-3, TD-6, TD-10; CTX-37.
- Statement: Each enabled critical journey shall expose complete durable state for safe recovery and bounded diagnostic signals with explicit completion, freshness, privacy and response ownership.
- Acceptance: A controlled success, failure and async retry/duplicate scenario produces the expected logical outcome and correlated sink evidence without private payloads; telemetry failure does not falsify business state or remove mandatory audit.
- Constraints: DATA-6, TEN-4, SEC-1, SEC-4, PRIV-1, DEL-1; exact installed telemetry API, retention, responder identities and alert thresholds remain release gates.
- Evidence: Contract review only; no sink, query, metric or alert was exercised.

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
- Source: TD-3, TD-4, TD-7, TD-8, SEC-5; SRC-MENGANTAR-PARTNER in `sources.json` and CTX-37.
- Statement: Rate controls shall honor the actual provider/account scope and endpoint retry semantics, while bounding native Auth, application ingress and polling without treating a throttle as permission to replay an uncertain mutation.
- Acceptance: Multiple outlets/key versions, Seller Web quota consumption, concurrent dispatch, 429, expired leases and unknown outcomes remain bounded and preserve original operation identity; blocked capability states remain actionable.
- Constraints: NFR-5, TEN-2, SEC-3, SEC-5; current provider documentation/configuration is authoritative and must be rechecked before enablement.
- Evidence: Vendor documentation and proposed local controls; no load or provider quota test.

| Limit domain | Scope and documented baseline | Required response |
|---|---|---|
| Partner API | Partner-wide 60 requests/minute fixed window; 1,000 new sellers/day resetting midnight WIB per reviewed contract | Durable shared scheduling; honor provider rate-limit/retry headers. Retried same external ID is not a new seller; TD-7 still governs exact retry safety |
| Seller shipping | Actual parent seller account across outlets and credential versions; endpoint-specific quota/serialization verified at enablement | One account authority/coordinator where required; do not key limits only by tenant, outlet or key version |
| PDF Print | TD-4's eight Print actions/60 seconds shared with Seller Web | POST consumes Print action even for reused job; GET renewal/status does not. Provider rejection remains possible despite local headroom |
| Auth and mail | Actual Supabase native endpoint/project limits plus Cloudflare mail entitlement and suppression behavior | Protect native endpoints as well as app UI; show configured resend/retry guidance, generic public errors and recoverable mail state |
| App commands/search/polling | Explicit per-action/actor/tenant/account limits selected from workload and abuse needs | Bounded pages/body/batch size and concurrency; no invented unlimited plan or unbounded background polling |

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
