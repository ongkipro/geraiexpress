# Lane BIZ — Provider, Money, Dispatch and Reconciliation Review

## Result

Verdict: incorrect — fix the issues below before enabling the affected live workflows.
Counts: Critical 1; High 4; Medium 2; Low 0. Overall confidence: 0.97.

This is a read-only source/contract audit, not an executed application, database, sandbox or browser validation. No repository files were changed and no tests, builds, database commands or provider operations were run. The working tree had no changes at intake; implementation history and diffs from 23e250d through HEAD were inspected to establish introduction of the affected integration code. Current provider documentation was fetched read-only, without credentials. SQL was examined only as the contract consumed by the TypeScript lane, not as a general SQL-security audit.

### [Critical] <id: BIZ-01> Verify the tenant binding before retrieving a saved Partner seller key

Where: src/lib/mengantar/partner-onboarding.ts:141–144; supabase/migrations/20261027230000_production_readiness_polish.sql:40–45; supabase/migrations/20261027210000_partner_seller_onboarding.sql:340–345.

Evidence: The onboarding orchestrator uses any non-null partner_seller_id returned by begin_partner_seller_onboarding directly in the platform-authorized getSellerApiKey call. The record_partner_seller_onboarding_outcome RPC is executable by authenticated users and permits an admin to set a syntactically valid seller ID for their own tenant; its current replacement still validates only the format, not seller ownership. begin_partner_seller_onboarding preserves and returns that ID. Thus an admin can first create their own onboarding row, write a different Partner seller ID as registered_key_pending, and invoke the ordinary recovery action. The Worker retrieves that other seller key and seals it for the requesting tenant. Checking external_user_id against the current tenant at lines 94–100 does not establish that the independently mutable seller ID belongs to that external ID. complete_partner_seller_onboarding is another authenticated binding-write surface. The recovery caller is src/modules/credentials/actions.ts:60–78; Partner retrieval validates the echoed seller ID, but not its external tenant binding, in src/lib/mengantar/partner-api.ts:153–160.

Impact: An admin who knows another Partner-managed seller ID can connect that seller to their own gerai and use its Public API authority for orders and balance-funded shipping. This crosses tenant and money boundaries; the plaintext key need not be exposed to the browser for the takeover to occur. The ID is not treated as a secret: partner_onboarding_status returns it to members and the settings form displays it. The currently implemented provisioning flow is sandbox-only; production enablement must not carry this trust model forward.

Recommendation: Treat Partner seller identities and outcomes as machine-attested facts. Restrict provider-result/binding writes to the machine identity while retaining user-authorized consent commands. Before any key retrieval, independently verify the seller-to-externalUserId association against geraiexpress:tenant:<current tenant>, or use the documented idempotent registration recovery keyed by that server-derived external ID. Do not trust a seller ID solely because it came back from a user-writable RPC projection.

Verify: In an isolated two-tenant test with a controlled Partner adapter, let admin A attempt to install seller B through every exposed binding-write RPC and the recovery server action. Assert that no API-key request for B occurs and no credential for B is stored under A. Keep a successful same-tenant 503 recovery case. No exploit was executed during this audit.

### [High] <id: BIZ-02> Pay unpaid orders with the provider batch object ID, not its display code

Where: src/lib/mengantar/public-api.ts:248–252; src/lib/mengantar/dispatcher.ts:267–270.

Evidence: payUnpaidShipmentBatch supplies p.batch, which the SQL contract fills from provider_operations.provider_batch. That value is the human-readable batch code recorded from result.batch. payUnpaidBatch then sends the code as batch_id and even validates it with the uppercase-code BATCH_ID regex. The existing unpaid fixture distinguishes batch = 26101416827JYE from batch_id = 6acf476a6b00a9b494ff04b8. The current provider contract explicitly requires Batch _id for POST /order/pay-unpaid, while the research correctly establishes that GET /order batch filtering uses the batch code. CreateOrderResult and ProviderOrder currently discard the provider batch object ID. tests/unit/mengantar-orders.test.ts:308–310 asserts the wrong code-valued payment body, and dispatcher payment tests accept that body without provider validation.

Impact: The in-app batch payment path sends the wrong identity for the batch it reviewed and therefore does not satisfy the documented payment request contract. An unpaid order cannot reliably progress through this feature; paying manually in Mengantar remains a different path. Actual provider rejection text was not exercised here.

Recommendation: Preserve distinct typed fields for batch code and batch object ID through create/read parsing, operation persistence, batch claims and payment dispatch. Continue using the code for the GET filter and review display, but send the provider object ID in the payment batch_id field and validate its actual shape.

Verify: Add a fixture-backed adapter/dispatcher test where code and object ID differ, reject code-valued payment requests in the fake, and assert GET uses the code while POST uses the object ID. With separate approval, validate one unpaid payment in sandbox.

Provider citation: https://sandbox.mengantar.com/docs/#content-pay-unpaid — read during this audit; body parameter batch_id is explicitly Batch _id (required), with a 24-hex example. Local corroboration: tests/unit/fixtures/mengantar/order-create-jt-unpaid.json, data[0].batch and data[0].batch_id; docs/research/geraiexpress-mengantar-public-api.md, Order adapter evidence / batch filter.

### [High] <id: BIZ-03> Fence Partner credential completion with the version used for encryption

Where: src/lib/mengantar/partner-onboarding.ts:168–177; supabase/migrations/20261027210000_partner_seller_onboarding.sql:188–199.

Evidence: The Worker reads latest_credential_version in begin, makes a remote Partner call, and seals the returned key with AAD for latestVersion + 1. complete_partner_seller_onboarding does not receive an expected version: it re-reads max(version), clears the active ciphertext, and inserts the supplied ciphertext at its newly computed max + 1. Two onboarding/recovery requests can both begin at version n before either completes; the first writes n+1 and the second stores ciphertext sealed for n+1 in row n+2. A concurrent BYOK save creates the same race. The existing BYOK RPC already implements the necessary expected-version fence (20261014150000_credentials.sql:36–52), but Partner completion omits it.

Impact: A valid stored credential is destroyed and replaced by one that cannot authenticate its AES-GCM AAD. The action reports connected success, while tenantMengantar and the dispatcher subsequently fail to open the key, blocking live quotes and issuance. The SQL locks serialize completion transactions but do not protect the earlier read/remote-call/encryption interval.

Recommendation: Pass the encryption/expected version to completion and compare it under the existing write lock before clearing any credential. Return stale_state on mismatch so stale callers cannot overwrite a newer key. Follow the established BYOK expected-version convention.

Verify: Barrier-coordinate two begins at the same version and complete both; only one should commit. Also insert a BYOK credential between Partner begin and completion. In both cases prove the surviving active row decrypts with its stored version and that a losing completion does not clear it. Current unit tests hardcode begin version 2 and completion version 3, so they cannot detect this race.

### [High] <id: BIZ-04> Bind queued dispatch to the pickup origin that was quoted and confirmed

Where: supabase/migrations/20261027190000_cod_and_batch_payment.sql:377–386; src/lib/mengantar/dispatcher.ts:85–100,125–130.

Evidence: liveQuotes prices from the current outlet mengantar_area_id (src/modules/shipments/actions.ts:125–128), but quotes are bound only to shipment revision. set_outlet_mengantar_pickup changes the outlet address and area without invalidating dependent quotes or queued operations (20261014170000_live_quotes.sql:23–25). Confirmation freezes a display pickup_snapshot, but private.dispatch_payload later reads the live outlet and supplies its current mengantar_pickup_address_id. The Worker only checks that this ID still exists in the seller pickup list; it does not compare it with the quoted or confirmed origin.

Impact: A routine admin pickup change can leave an old quote valid for a different shipping origin. In the especially clear queued case, confirm with pickup A, change the outlet to B while the seller is busy, then dispatch: Mengantar receives B while the frozen shipment detail still describes A and the customer charge is based on A. Different-origin tariffs can differ, and the post-effect price mismatch event cannot restore the reviewed spending authority or correct the inaccurate pickup snapshot.

Recommendation: Bind quote and operation inputs to immutable pickup identity/area and relevant account/credential authority. Dispatch the confirmed pickup snapshot, or reject pre-send authority drift and require re-quote/reconfirmation. Invalidate affected unconfirmed quotes when pickup configuration changes. The pickup-exists check remains useful but is not an authority check.

Verify: Quote at A, switch to B before confirmation, and assert the stale quote cannot dispatch. Separately queue a confirmed A operation, switch to B, and assert dispatch either still uses the frozen A identity or stops for renewed review, never silently sending B under the A quote.

### [High] <id: BIZ-05> Preserve ambiguous payment attempts instead of releasing them for replay

Where: src/lib/mengantar/dispatcher.ts:284–285,294–317; supabase/migrations/20261027190000_cod_and_batch_payment.sql:767–770,795–804,824–825.

Evidence: After timeout/5xx/unknown_outcome from payUnpaidBatch, the dispatcher performs per-order reads. If a read fails, or still reports unpaid while the original provider request remains unresolved, allPaid becomes false, yet release() unconditionally clears payment_in_flight_at and the function returns still_unpaid. The SQL payment-record path also clears the flag on an unpaid read. No durable payment-attempt outcome survives. A second admin submit can immediately obtain a fresh claim, see an unpaid row, and issue POST /order/pay-unpaid again. A Worker crash similarly becomes claimable after the two-minute timestamp window, without any durable unknown-payment state. Reading unpaid is not proof an earlier payment command has stopped.

Impact: The no-blind-replay invariant only holds inside one function invocation, not across retries or button clicks. A delayed original command and its replacement can overlap against the same seller and batch. Duplicate debit or duplicate shipment creation depends on undocumented provider behavior and is [INFERENCE]; the repeated unresolved financial command itself is established by the code path. The existing timeout test only covers a single invocation whose immediate lookup already says paid.

Recommendation: Persist an original payment operation/attempt with an explicit unknown outcome. Ambiguity must move it to reconciliation-only, not reset it to payable or label it definitely unpaid. Authorize a fresh payment only after authoritative evidence that the original command had no effect and cannot still finish; fence claims/releases against their specific attempts rather than treating a timestamp expiry as that proof.

Verify: First simulate an accepted-but-pending payment whose response is lost and whose immediate status lookup is unpaid or fails. Invoke the server action again and advance past the lease expiry; assert exactly one payment POST across calls and reconciliation of the original attempt when its paid result appears. Repeat for crash-after-send. No provider payments were made during this audit.

### [Medium] <id: BIZ-06> Enforce live recipient limits before quoting and confirming

Where: src/lib/mengantar/public-api.ts:513–515; src/modules/shipments/draft.ts:40–48; src/lib/mengantar/dispatcher.ts:85–88.

Evidence: Draft validation and database constraints permit recipient names up to 120 characters, addresses up to 500, and phone numbers of 8–15 digits with an optional plus. The live create-order builder rejects names over 100 or addresses over 300, and providerPhone additionally requires an Indonesian/local-zero form of at least 10 digits. A 301-character otherwise valid address, for example, passes save, live quote and SQL confirmation; createOrderBody then throws InvalidOrderRequest before sending, and dispatchOperation records INPUT_INVALID. The user is sent into a failed/reopen/requote flow rather than receiving a field error. This is introduced by connecting the existing wider draft contract to the narrower live adapter.

Impact: Data accepted and explicitly confirmed by the UI cannot be issued, with only a generic failure rather than the offending field. Stored contacts accepted by the same broader validation can repeatedly reproduce the problem.

Recommendation: Use consistent, mode-aware provider validation at quote/confirm boundaries. Either support the provider-permitted lengths in the adapter with verified evidence or surface its actual restrictions as Bahasa field errors before freezing a real shipment. Keep draft-only partial saves possible and do not silently truncate recipient identities or delivery addresses.

Verify: Cover the 100/101 name and 300/301 address boundaries and phone formats accepted by drafts but not providerPhone. A live quote/confirmation must not succeed for inputs the local dispatch adapter is guaranteed to refuse; demo behavior can retain its separate contract.

### [Medium] <id: BIZ-07> Require existing recorded consent before allowing key recovery

Where: src/lib/mengantar/partner-onboarding.ts:235–243; src/modules/credentials/actions.ts:60–78; supabase/migrations/20261027210000_partner_seller_onboarding.sql:112–134.

Evidence: recoverPartnerSellerKeyAction accepts caller-supplied owner details and checks only tenant_admin/non-demo. recoverPartnerSellerKey skips even the status read when those three details are supplied, calls the full onboarding function, and sets agreed: true itself. There is no requirement that onboarding already exists, consent was recorded, or the state is registered_key_pending. On a new tenant, invoking the recovery server action with valid owner details therefore reaches begin_partner_seller_onboarding and registerSeller without any affirmative agreement input. On a real recovery, begin also replaces the original consent actor, document versions and timestamp as though the recovering actor had freshly consented.

Impact: The dedicated recovery entry point bypasses the PR-20 affirmative-consent gate used by normal registration and can create a seller rather than merely recover its key. Its audit facts can attribute fresh agreement to an actor who only clicked a key-recovery button. Hiding the recovery form except in a pending state does not restrict direct invocation of the exported server action.

Recommendation: Make recovery a distinct authorized transition that requires a persisted consent record and the appropriate recoverable state/binding. Load original owner and consent facts server-side, do not synthesize agreement or create a new registration through recovery, and retain the original consent provenance. If new terms require agreement, explicitly collect that agreement instead.

Verify: Invoke recovery for a tenant with no onboarding/consent record, including fully populated owner fields, and assert zero Partner calls and consent_required/not_recoverable. For a legitimately consented pending registration, recover successfully without changing the original consent actor/time/version.

## Sound controls and test assessment

- Public API and Partner transports use fixed origins, manual redirects, bounded response reads, timeouts, and sanitized errors; API-key-bearing URLs are not returned by these helpers. Signing uses one serialized body for both signature and request, with an independent published digest vector in unit tests.
- Order creation judges item status and identities rather than success:true alone. Ambiguous create results become unknown and do not automatically resend. Pickup lookup failures release a claim only before create is sent.
- SQL create claims have attempt fencing, a per-tenant in-flight unique index, short transactions, queued/stale checks and machine-only result writers. This remains a per-tenant guarantee, not a proven unique real-account guarantee across shared BYOK keys; DEC-010 explicitly acknowledges that ceiling.
- Reconciliation checks environment and original credential version, scans with timestamp/skew and ordering checks, and fails inconclusively on malformed/incomplete scans or duplicate live references. Terminal failed conclusions continue blocking new operations until explicitly closed.
- Quote confirmation checks revision/expiry and durable idempotency. Unknown and zero are distinct in draft parsing, formatIdr and the live estimate parser; monetary provider amounts must be nonnegative safe integers, and no live historical fee percentage default was found. Private net quote costs are not sent in the quote rows rendered to operators.
- Two-pass COD quoting asks the provider for fees on goods plus each discovered tariff; confirmation includes that fee once in customer charge and COD collection. Current provider documentation explicitly distinguishes estimate COD_AMOUNT = goods + shipping from create COD = goods + shipping + fee. A universal fee formula, final-amount gross-up rule or actual settlement correctness cannot be proved from the one captured COD amount, so no speculative arithmetic finding is asserted. There is no implemented selectable insurance flow; production proof of goodsValue-triggered insurance/fees remains a documented release gate.
- Batch review binds known local membership and customer charges to a digest and independently checks provider order IDs/references before spending. AWB arrays are not paired to local shipments by position. These good checks do not repair the wrong payment batch ID or unknown-payment replay defects above.
- Sweep routes dispatch, reconcile and payment actions to their actual consumers and catches individual item failures. With the production-required Workers Paid plan, the default 20-item worst-case scan is approximately 142 subrequests plus hourly cleanup, below 1000; it is not Free-plan safe, which STATUS.md already gates. Cleanup is isolated from sweep exceptions, but requires all dispatcher bindings. Preview intentionally disables crons and the machine key per RELEASE.md, so cleanup there was not reported as an accidental new defect.
- Actual runtime imports examined stay server-side: the client pickup form imports a type only; secret-bearing callers use server actions/tenant helpers/Worker cron. Transport and crypto implementations use WebCrypto/Web APIs, not Node-only production APIs. This is static import/runtime inspection, not bundle or workerd execution.
- Provider parser tests have meaningful fixture/mutation assertions, malformed-shape checks, secret non-disclosure checks, coverage filtering and reconciliation scan edge cases. Orchestrator unit tests replace RPC semantics, so they do not establish real locking, credential version races, RPC trust isolation or cross-invocation payment idempotency. The two-pass math test uses supplied mock fees rather than proving provider billing. Live dispatcher contracts cover one non-COD create/reconcile path, not batch pay-unpaid, onboarding races or end-to-end COD charge equality. Their absence is coverage information, not a separate finding.
- Contact/member actions derive tenant scope from the workspace or delegate to user-JWT RPCs; contact archive routes through archive_contact and historical shipment values remain frozen. General membership/RLS SQL correctness belongs to the other lane.

## Coverage

Files/areas reviewed: all six src/lib/mengantar/*.ts files; src/modules/shipments/{actions.ts,draft.ts,intake-form.tsx,area-picker.tsx}; src/modules/contacts/{actions.ts,forms.tsx}; src/modules/members/{actions.ts,forms.tsx,labels.ts}; src/modules/mengantar/{actions.ts,pickup-form.tsx}; src/lib/format.ts; custom-worker.ts; provider-related unit tests (public API, orders, dispatcher, Partner API, onboarding, tenant, draft, format, custom Worker) and both tests/contract files; provider fixture identities and COD observations; dispatcher/live quote/issuance/COD/onboarding migration contracts plus the final readiness replacement; DECISIONS.md/DEC-010, ARCHITECTURE.md, docs/spec/11-BILLING-PAYMENTS.md, relevant TD-9 and PRD pricing passages, research documents, and release/observability/task claims relevant to the lane. Also read direct consumers in credential actions/forms, shipment detail UI, area API route, error mapping, workspace membership selection, machine client, secret binding and encryption helpers. LSP references were used for onboarding and batch-payment entry points.

Areas NOT reviewed: general SQL/RLS policy security and unrelated migrations; auth/session/MFA implementation; full marketing/SEO/accessibility/UI review; unrelated unit tests; database helpers and full database/E2E suite internals; migrations applied remotely; production credentials, accounts, balances, legal agreement versions, actual provider billing/insurance/settlement or egress; built bundles, deployed Worker behavior and real browser interactions. No .env*, .dev.vars, supabase/.env or secret-store contents were opened.

Checks for the lead after fixes: add the targeted two-tenant, concurrency, stale-origin, request-identity, payment-retry and consent regression cases described above; then run the existing relevant unit/database/contract gates under the repository policy. Only a separately authorized sandbox run can establish the real unpaid-payment and COD-billing contract. No checks are claimed as executed by this lane.

