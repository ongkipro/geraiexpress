# GeraiExpress — Technical Design and Reference Reuse

- Status: Proposed; documentation-only review, not a completed port.
- Owner: Engineering owner
- Updated: 2026-10-13
- Sources: CTX-4, CTX-11 through CTX-15; exact inventories/digests in `reference-scan.json`.
- Scope: Component adaptation and provider orchestration. Runtime boundaries belong to `04-SYSTEM-ARCHITECTURE.md`; data and authorization belong to their owner documents.

## TD-1 — Selective reuse contract
- Status: Proposed
- Owner: Engineering owner
- Source: CTX-11, CTX-12, CTX-14, CTX-15.
- Statement: Reuse shall preserve the referenced behavior while removing incompatible dependencies and obtaining fresh target-runtime evidence; a source file or existing test is not evidence of a completed port.
- Acceptance: Each extracted/adapted module has an inspected dependency boundary, a linked behavior check, and no runtime import of old auth, schema, fixture transport, or Next.js APIs where unsupported.
- Constraints: PR-1 through PR-16 retain their own scope and acceptance; unselected features remain candidates.
- Evidence: Reference source observation and the bounded test subset only.

Disposition below means **Extract** = small logic candidate after import/limit review;
**Adapt** = reuse behavior with new integration; **Rebuild** = new boundary;
**Conditional** = useful only if its feature is accepted. No disposition means
blind copy, runtime portability, production readiness, or adoption of old policy.
The first matrix is the **original baseline**, relative to
`/home/ongki/Projects/geraicuan`; it records what was inspected there, not the
most advanced implementation of the product. The advanced matrix that follows
takes precedence when both provide the same capability. Fifteen worktrees were
inventoried; their commit metadata alone is not code or runtime proof.

| Reference paths / symbols | Observed behavior | Disposition and GeraiExpress treatment | Verification needed |
|---|---|---|---|
| `src/lib/shipment-draft.ts`: `validateShipmentDraft`, `normalizePartyPhone`; callers in `src/app/app/actions.ts`, `contact-directory.ts`, `bulk-shipment-intake.ts` | Name/phone/area/package/dimension/whole-IDR validation shared across single and bulk intake | Extract validation after removing `server-only`/alias coupling. Review hard limits; phone validation is not international canonicalization and must not establish contact uniqueness. | Valid/invalid/boundary inputs; same invariant at every backend caller |
| `src/lib/contact-directory.ts`; `src/db/contact-repository.ts`; `src/app/app/kontak/actions.ts` | Sender/recipient flags, multiple addresses, archive handling, masked search DTO, atomic master+address creation | Adapt to Supabase SQL/RPC, tenant policies, projected DTOs, and selected role rules. | Tenant negatives, same phone on separate records, address conflict, stale selection |
| `src/lib/domain-enums.ts`; `src/lib/shipment-queue.ts` | Browser-safe literals, status labels, next-action guidance, filters | Extract concepts; split submission/payment/delivery states rather than copying the mixed state union as a new canonical model. | State/action matrix plus browser behavior |
| `src/lib/analytics-range.ts`, `data-freshness.ts`, `label-format.ts`, `pii-redaction.ts` | Explicit timezones, half-open ranges, freshness checks, Intl formatting, phone masking | Extract small independent functions. Replace hard-coded WIB display when workspace timezone is selected; confirm freshness policy. | Existing applicable checks plus Worker/browser checks and midnight boundaries |
| `src/lib/analytics-filters.ts`, `platform-monitoring-filters.ts` | URL filter normalization and scope validation | Adapt runtime schema imports to pure literals before browser reuse; passing Node tests do not remove database graph imports. | Bundle/import inspection and unauthorized selector cases |
| `src/lib/mengantar-locations.ts`; `src/app/app/location-actions.ts` | Bounded provider lookup, authoritative pickup/area pair, destination options | Adapt to request-scoped Worker clients and account-authority versions. | Account replacement during lookup; pickup ID versus area ID |
| `src/lib/mengantar-estimate.ts`; `src/db/estimate-repository.ts`; `src/app/app/estimate-actions.ts` | HTTP timeout/body limits, normalized services, persisted estimate authority | Adapt transport/normalizer against current account-specific schemas and price mode. | Supported/unsupported/COD cases, stale quote, unexpected response fields |
| `src/lib/mengantar-credentials.ts`; `src/db/outlet-readiness-repository.ts` | Private/platform account sources, authority version, pickup readiness | Adapt only after CTX-9; explicit account reference, capability state, and rotation behavior. | Partial configuration, disabled private connection, account switch without fallback |
| `src/lib/shipment-issuance.ts`, `mengantar-order.ts`; `src/db/order-batch-repository.ts`; `src/app/app/pengiriman/[shipmentId]/actions.ts` | Preparation/claim/result orchestration and unknown outcome; UI transport is fixture-only | Rebuild real wire transport; adapt state guards and idempotency. Old flattened `buildMengantarOrderPayload` is not the official nested request. | Current sandbox envelope, partial response correlation, restart and replay |
| `src/lib/mengantar-order.ts`: `withProviderAccountSerialization` | Session-level PostgreSQL advisory lock using a Node `pg.Pool` client | Rebuild coordination for Workers. Preserve actual-account serialization, not a DB connection lock held across remote work. | Two tenants sharing one account; concurrent awaits, restarts, lease/claim failure |
| `src/db/shipment-unpaid-recovery-repository.ts`, `unpaid-recovery-repository.ts`; `src/lib/mengantar-unpaid-recovery.ts`, `shipment-reconciliation.ts` | Recover existing unpaid order, reconcile unknown outcomes, stale-operation guidance | Adapt state transitions and account-scoped authority; do not treat fixture recovery as a verified live endpoint. | Timeout after payment, existing order reused, duplicated results, unexpected account |
| `src/db/label-print-repository.ts`; `src/app/app/label/[shipmentId]/label-sheet.tsx`, `label-print-panel.tsx`; `src/app/globals.css` | Local 100×150mm HTML label, eligibility and print-attempt history | Adapt eligibility/history; provider PDF is the proposed shipping-label source. Local branded receipt/layout is a separate unselected capability. | Provider permission, expired URL, scoped download, accessible print workflow |
| No `dropShipper`/`dropshippers` implementation found in scanned `src`/`tests` | Current provider feature is not in the application | Rebuild customer-to-provider master mapping; local contacts remain primary local data. | Enabled feature, saved master, mixed ordinary/dropship batch, account rotation |
| `src/app/api/webhooks/mengantar/route.ts`: `POST` returns 404; `tests/provider-webhook-boundary.integration.test.ts` | Deliberately closed tracking ingestion | Rebuild from the current documented signature/payload and a scoped machine principal. Keep disabled until verified. | Forged, replayed, old, out-of-order, different-account, duplicated updates |
| `src/db/tenant-context.ts`, `platform-context.ts`, `src/lib/cms-auth.ts`, `cms-principal.ts`, `auth.ts`, `auth-config.ts` | Better Auth identity and transaction-local app context | Rebuild with Supabase Auth and membership-backed RLS; preserve active membership/tenant and deny-by-default invariants. | Direct Data API/RPC access, stale JWT role, suspended user/tenant, platform separation |
| `src/db/member-governance-repository.ts`, `platform-tenant-repository.ts`, `tenant-lifecycle.ts` | Last-admin guard, governance idempotency, tenant transitions, audit | Adapt atomic governance and selected policy; Supabase Auth invitations are a separate integration. | Concurrent last-admin removal, retry, role escalation, rejected lifecycle action |
| `src/lib/bulk-shipment-intake.ts`, `bulk-shipment-intake-contract.ts`, `bulk-import-envelope.ts`; `src/app/app/impor/actions.ts` | CSV preview, ambiguous destination handling, encrypted expiring preview, selected row replay guards | Conditional. Retain proven installed CSV parsing approach after Worker check; rebuild Node crypto and auth-secret coupling with purpose-separated keys. | Byte/row/fan-out limits, expired/tampered/wrong-tenant token, partial draft failure |
| `src/lib/analytics-export.ts` | Quoted CSV fields and spreadsheet formula escaping | Conditional extract with new browser-safe row DTO; export authorization belongs to backend. | Scope/filter parity, hostile formula, PII permission, bounded result size |
| `src/components/ui/*`, `src/components/cms/page-header.tsx`, `page-container.tsx`, `empty-state.tsx`; `src/lib/cms-shell-navigation.ts` | shadcn-style primitives and operator composition | Adapt vetted primitives and task hierarchy; replace navigation/router/auth coupling and remove reference branding. | Installed dependency compatibility, keyboard, responsive browser, no schema/server bundle leakage |
| `src/components/cms/data-freshness-control.tsx` | Accessible refresh state and focus management using Next router refresh | Adapt result/announcement pattern to the selected loader and verified Next.js/Workers refresh behavior; do not assume the old router/cache semantics transfer. | Recoverable fetch failure preserves useful data and focus |
| `src/db/ledger-repository.ts`, `analytics-repository.ts`, `tenant-dashboard-repository.ts`, `platform-monitoring-repository.ts`; `docs/spec/19-METRICS-ANALYTICS-CONTRACT.md` | Financial/event models, dashboards, documented metric drift and pending policies | Conditional. Reuse invariant and definition approach, not unreviewed formulas, fees, old accepted policy, or all current query implementations. | Accepted finance policy; ledger/list/export parity; no COD principal as revenue |
| `src/db/schema.ts`; `drizzle/*.sql` | Tenant composite FKs, immutable ownership, RLS/privilege hardening, append-only snapshots | Adapt constraints selectively into one fresh Supabase migration history. Do not replay Better Auth schema and application-context policies wholesale. | Empty local migration build, grant/RLS negatives, ownership reparenting rejection |

### Preferred advanced source and precedence

Advanced paths below are relative to `/home/ongki/Projects/geraicuan-completion`,
HEAD `1199406c5c6fb67d6607add624cea487c91ad029`. This checkout was clean; 727
selected files were fingerprinted and the relevant flows inspected selectively.
Sibling brand/landing/operations worktrees were inventoried and the dated
operations note was read; they were not silently merged into this source.

| Advanced paths / symbols | Reuse recommendation | Remaining adaptation/proof |
|---|---|---|
| `src/lib/mengantar-http.ts`: `requestMengantar`, `mengantarAnswerMessage` | Adapt this bounded, redirect-refusing, credential-redacting HTTP client instead of starting from the old estimate-only client | Worker runtime, allowed endpoints/hosts, exact current error semantics; never classify every rejection as safe to replay from HTTP status alone |
| `src/lib/mengantar-live-transport.ts`; `src/lib/mengantar-order.ts`: `buildMengantarOrderRequest`, pickup-time handling | Adapt the existing nested request builder and gated order/payment transport. The old flat fixture builder is not the preferred starting point | Live success still unproved in this review; add saved-account `dropShipper`, new auth/account identity, durable coordination, and current sandbox evidence |
| `src/lib/mengantar-webhook.ts`; `src/db/mengantar-webhook-repository.ts`; route `src/app/api/webhooks/mengantar/route.ts` | Adapt verification/body bounds/failure semantics and relevant tests rather than rebuilding all parsing from nothing | Replace Node HMAC/Buffer and database boundary; select per-account secret routing and mapped account+order authority. Current implementation notes a platform-default-only secret/no real capture |
| `src/lib/provider-delivery-status.ts`, `mengantar-status-pull.ts`; `src/db/provider-tracking-repository.ts` | Adapt shared status/transition and pull reconciliation rules | Recheck current categories, unknown-status handling and actual account ownership before applying updates |
| `src/lib/shipment-number.ts`; `src/db/shipment-number-repository.ts` | Conditional readable local shipment references and scoped numeric URLs | Keep local reference separate from AWB and database ID; atomic per-tenant allocation, uniqueness and immutable-reference policy need acceptance |
| `src/lib/shipment-draft-logic.ts`: product-row helpers, pickup/drop-off and scheduling checks; `src/app/app/pengiriman/baru/page.tsx` | Adapt the one-page fill → estimate → review/confirm workflow; extract genuinely independent helpers | Do not import fee constants or old schedule windows as policy. Provider sender identity must match the new customer workflow, not just local label masking |
| `src/app/app/cek-tarif/rate-check.tsx`; `src/lib/wilayah.ts`, `wilayah-match.ts` | Conditional quick tariff comparison and human-readable area selection | Resolve provider-authoritative area IDs, expose ambiguity, bound lookups; local geographic matches are not provider identity authority |
| `src/lib/gerai-settings.ts`; `src/app/app/brand/gerai-brand.tsx`, `brand/logo/route.ts`; `src/app/app/pengaturan/label/label-info-editor.tsx` | Adapt gerai profile/brand and bounded logo validation; keep operator preview | New private storage/access and selected upload limits; local display overrides do not update Mengantar sender records or authorize courier PDF branding |
| `src/app/app/label/[shipmentId]/label-barcode.tsx`, `label-sheet.tsx`; `src/lib/label-size.ts`, `label-fields.ts`, `label-queue.ts`; `src/app/app/label/cetak/*` | Conditional local thermal layout/barcode fitting, batch selection and print-attempt UX | Official provider PDF remains the recommended shipping-label route pending capability decision. Local label acceptance/routing needs courier proof; no physical-print claims |
| `src/db/shipment-invoice-repository.ts`: `invoiceForRole`; `src/app/app/invoice/*` | Conditional customer receipt/invoice snapshots, scoped rendering, operator-safe projection | Select receipt purpose/price/tax policy, make new snapshot schema, never show private provider cost or imply a fiscal invoice |
| `src/app/app/label/handover-actions.ts`, `handover-dialog.tsx`; `src/lib/shipment-cancel-rules.ts`, `shipment-cancellation.ts` | Conditional scanned handover and state-valid cancellation/recovery patterns | Handover is an operational action; cancellation is a provider mutation needing its own authority, verification and money/reconciliation policy |
| Advanced `AGENTS.md`, operational contact source, and `tests/contact-numbers-t241.integration.test.ts` | Preserve the distinction between authorized full contact display and redaction outside permitted operational scope; consider readable contact references/attribution | Do not impose the older universal masked-list policy without a new owner decision. Advanced contact/database tests were inspected, not executed |

The advanced reference currently records no successful documented-shape live
creation and no real webhook capture in its inspected comments/status. Those are
reference observations, not newly executed provider checks. Its local label
masking deliberately does not send `dropShipper`; extending the current adapter
to provider-authoritative customer sender identity is a real new requirement.

## TD-2 — Current provider adapter and account authority
- Status: Proposed
- Owner: Integration owner
- Source: CTX-5, CTX-9, CTX-13; SRC-MENGANTAR-DOCS in `sources.json`.
- Statement: The Worker adapter shall translate validated domain operations into the current provider contract and bind every provider identifier and response to the selected account authority.
- Acceptance: Sanitized account-specific sandbox fixtures prove pickup-area selection, quotes, customer sender identity, order response correlation, and no use of a previous account's identifiers.
- Constraints: DATA-3, TEN-2, SEC-1; CTX-9 and intended-account capabilities must be resolved.
- Evidence: Documentation and static reference review only.

The original checkout's flat DTO is internal to fixture orchestration. The
advanced `buildMengantarOrderRequest` already supplies the documented nested
shape and is the preferred adaptation candidate. It deliberately omits
`dropShipper`, so it does not yet meet the new provider-sender requirement. The current
official create request groups `courier`, `pickup`, and `orders[]`; each customer
sender uses an existing account-owned `dropShipper`. Preserve item-level
response/error correlation, the top-level batch identifier, paid/unpaid state,
and `cnote_no` as AWB authority. Never invent a correspondence from array order
when the verified response cannot prove it. Quarantine ambiguous partial results.

Separate provider pickup-address ID from origin area ID. Keep provider master
creation distinct from saving a local contact. Account replacement invalidates
old lookups, quote authority, sender mappings, and pending confirmations. Key
rotation preserves actual seller identity but fences/revalidates credential-bound
work under TD-8. The default proposed tenant-seller/BYOK model has no silent
central-account fallback; any future central mode needs separate policy.
The advanced live transport also restricts a platform-default operation to the
platform's own pickup address. Do not inherit that single-address assumption
for independent gerai: if shared-account multi-gerai pickup is selected, define
and verify an explicit tenant/outlet → account-owned pickup mapping. Provider
ownership of an address alone is not authorization for every tenant to use it.
Quote mode, courier availability, flags, units, and COD amount fields require
current account-specific fixtures; the original skill/toolkit is not sufficient
when it differs from the current official documentation.

## TD-3 — Durable submission and recovery
- Status: Proposed
- Owner: Engineering owner
- Source: CTX-11, CTX-13; SRC-CLOUDFLARE-QUEUES and SRC-CLOUDFLARE-DO in `sources.json`.
- Statement: Provider-mutating work shall have a durable operation record, one actual-account executor where serialization is required, guarded state transitions, and reconciliation for uncertain outcomes.
- Acceptance: Concurrent users/tenants, duplicate delivery, restart, and timeout-after-acceptance tests cannot create a second order or lose a known provider result.
- Constraints: TEN-2, DATA-2, DATA-3, SEC-1, TD-8. CTX-9 still owns account-owner/outlet cardinality; tenant sellers with BYOK are the current recommendation.
- Evidence: Proposed design; not an executed Worker proof.

1. In an atomic database operation, validate membership/outlet/account authority,
   current draft revision, quote, sender mapping, and idempotency. Freeze the
   submitted inputs and create an operation/outbox record before dispatch.
2. A durable dispatcher claims the operation under a non-secret account identity
   common to every binding for that real Mengantar account. Different outlet
   IDs or credential versions do not automatically mean different accounts.
3. Recheck scope and transition eligibility when the job runs. Persist in-flight
   intent before calling the provider. Do not hold a cross-request SQL
   transaction or session advisory lock through a provider request.
4. Persist an authoritative response using a bounded machine identity and an
   attempt/version guard. Record legitimate outcomes even if the initiating
   user's session expires or membership is revoked after dispatch; revocation
   blocks new mutations, not truthful recording of an already-started effect.
5. Timeout, crash after dispatch, or ambiguous response enters reconciliation.
   Expiring a lease is not proof that the provider stopped processing. A stale
   in-flight account operation must not immediately unleash another unsafe call.
6. An unpaid response retains the original provider order and batch. Payment
   recovery follows the batch authorization contract below; a duplicate result
   cannot issue again or append the same effect twice.

A per-account Durable Object with durable pending/in-flight state is a candidate
coordinator. Single-threaded JavaScript alone does not prevent interleaving at
`await`; the implementation must explicitly serialize work and recover after
restart. Cloudflare Queues is optional transport: delivery may repeat and is
not FIFO, so it does not supply the provider-account lock or exactly-once effect.
Database outbox to dispatcher handoff needs a recoverable publish/ack record;
neither fire-and-forget fetch nor `waitUntil` is the only record of paid work.

### Payment recovery is a batch command

The retained official Public API contract (`SRC-MENGANTAR-SANDBOX-PUBLIC`, Pay unpaid)
requires `batch_id` for `/order/pay-unpaid`; `courier` is optional for the JNE
default and required for other couriers. GeraiExpress shall always supply the
verified courier explicitly to avoid default ambiguity. The response contains a
count and AWB array; this is not a documented single-row payment endpoint. Before an
explicit payment command, resolve the original account/courier/batch and every
payable member using verified provider/local evidence. Review the full batch,
its payable amount and payer authority; all members must belong to permitted
tenant/outlet scope. Unknown members, unrelated orders or partial authorization
block payment and route to authorized reconciliation. Do not split/re-create an
order merely to reduce the authorization scope. No new spending authority is
inferred from Super Admin monitoring access.

Bind the payment operation to the reviewed batch membership/input digest and
recheck before dispatch. If the provider cannot establish safe payable membership
and amount, keep this capability disabled. A timeout after payment dispatch is
an unknown payment outcome, not permission to retry create or pay blindly.
Reconcile every original order using authoritative identifiers; response-array
position or a count alone cannot prove which shipment received which AWB.
The retained contract discontinues Ninja create/payment from 1 September 2026;
legacy unpaid Ninja work goes to Mengantar support, not a pay-unpaid attempt.
Recheck current courier eligibility when enabling services; do not inherit the
old application's courier list as an availability guarantee.

### Operation transitions and retry authority

These are local operation states, separate from provider payment, delivery and
label states in DATA-2. The implementation must map its actual values explicitly.

| Current condition | Permitted transition and evidence | Forbidden shortcut |
|---|---|---|
| Valid draft/estimate | Explicit review creates one queued operation with frozen input and receipt | A UI click without durable intent cannot authorize dispatch |
| Queued, no dispatch begun | Current scope/quote/input check then claim and persist in-flight intent; stale authority returns to review without sending | Revoked membership, changed cost authority or suspended tenant cannot dispatch |
| In flight | Record known outcome against the attempt/fence; ambiguous outcome becomes unknown | Lease expiry or browser timeout cannot mark failure and start a replacement |
| Unknown | Reconcile the same account/order/batch; record known result or remain unknown with escalation | No blind retries or account switching to bypass uncertainty |
| Authoritatively rejected with no external effect | Correct the cause and explicitly re-review; retain original history | A generic 5xx or timeout is not proof of no effect |
| Existing unpaid order | Separate reviewed batch payment operation under the contract above | No new create; no payment implied by a label request |
| Confirmed issued/paid | Store exact provider identity and result; labels/tracking become eligible by capability | No second create from response replay or duplicate queue delivery |

Reusing a local idempotency key protects application commands; it does not imply
Mengantar supports that key or guarantees exactly-once execution. Terminal error
classification requires verified endpoint evidence, not only HTTP status.


## TD-4 — Provider PDF and tracking ingestion
- Status: Proposed
- Owner: Integration owner
- Source: CTX-6, CTX-13.
- Statement: Label and tracking capabilities shall activate only after their current account-scoped contract, permissions, and failure behavior are verified.
- Acceptance: Provider PDF request/poll/reprint and signed tracking scenarios pass with ownership, expired links, invalid signatures, duplicate deliveries, and out-of-order transitions.
- Constraints: TEN-2, SEC-2, PRIV-1, DATA-2.
- Evidence: Current documentation only; old webhook is closed and local print is not provider PDF proof.

Keep a label generation ID bound to its tenant, shipment, provider account,
authority version, and format. Poll an existing job rather than re-requesting
to check progress. Distinguish requested/generated/downloaded/print-attempt
events; none proves physical print completion. Quotas cover the actual parent
account, its outlets/keys and Seller Web activity. Label visibility also requires
current authorization; foreign-tenant bindings remain denied under DATA-4.

### Label generation wire behavior

Source: retained same-day official Public documentation under `SRC-MENGANTAR-SANDBOX-PUBLIC`;
SHA-256 `278f4e8317eabf315fb119c99a65ba70ffe127600b79dbe83b95f86634611f18`.
These documented facts still require permission/account/courier proof.

| Operation / condition | Verified documentation and required application behavior |
|---|---|
| POST `/label-generation` | Exactly one paid, account-owned order with AWB; documented input `orderId`, `courier`, `format`; HTTP 202 yields generation ID/status, not a ready PDF |
| GET `/label-generation/{labelGenerationId}` | Reauthorize local tenant/order/account binding and poll the existing ID; pending/processing stays pending; completed returns a private signed URL |
| Expired completed URL | Documented validity is 15 minutes per poll; GET again obtains a fresh URL. Do not POST just to refresh it |
| Failed generation | Show a safe bounded cause, correct it, then allow a deliberate eligible new POST; no automatic unlimited regeneration |
| Print quota | Eight Print actions per 60 seconds for the parent account, shared by Seller Web and Public API. A valid POST consumes an action even when it reuses an active generation; GET does not consume this Print quota |
| Formats | `normal-1`, `normal-2`, `normal-4`, `normal-6`, `thermal-10x10`, `thermal-10x15`, `thermal-8x6` for supported couriers; `thermal-new-10x10` and `thermal-new-10x15` only for J&T/SPX Express |
| Requested custom resi | No logo, custom retail-price or arbitrary sender-address field is documented in this request. Prove actual PDF content and supported configuration before enabling PR-6/PR-22 |

A local limiter cannot reserve Seller Web's unobserved quota consumption. Respect
provider rejection/retry guidance and retain the same job/draft when throttled.
Acceptance includes concurrent outlets/keys, quota consumed outside the app,
expired-URL GET renewal, format/courier rejection and redaction of signed URLs.


The advanced signed handler is a source/test candidate, rather than the old
closed route. Current documented webhook verification uses `x-timestamp`, `x-signature`, and
HMAC-SHA256 over timestamp + dot + exact raw body. Use the documented status
category, current capture, replay/freshness checks, bounded parsing, and durable
deduplication. Resolve the trusted account and locally mapped order; neither a
payload tenant ID nor an AWB-only global lookup establishes scope. Polling and
webhook updates must share one transition applicator. Keep ingestion closed
until the new account-scoped contract is proved. Do not generalize the original
closed route to the advanced checkout, or treat the advanced implementation's
presence as evidence of captured live deliveries or private-account support.

## TD-5 — Conditional import/export adaptation
- Status: Proposed
- Owner: Engineering owner
- Source: CTX-11.
- Statement: If accepted, bulk intake and exports shall preserve bounded parsing, explicit preview confirmation, tenant binding, and safe output without coupling crypto to an old authentication secret.
- Acceptance: Oversized/ambiguous/expired/tampered/cross-tenant inputs fail without extra drafts or provider writes; an authorized export matches its scoped list and escapes formulas.
- Constraints: PR-11, PR-16, TEN-1, SEC-1, PRIV-1.
- Evidence: Existing source/test definitions inspected; bulk/database/export behavior not executed in this review.

Reference limits are 256 KiB per CSV, 8 KiB per record, 100 data rows, and 10
unique destination queries. These are review starting points, not approved
GeraiExpress limits. A database-backed opaque preview reference may avoid
porting encrypted client envelopes; select the smallest design that preserves
expiry, tenant/actor binding, tamper resistance, replay behavior, and data privacy.
Use a dedicated purpose/versioned key if encryption is retained; never reuse a
Supabase signing secret or Mengantar credential as the application envelope key.

## TD-6 — Operational metrics and freshness
- Status: Proposed
- Owner: Engineering owner
- Source: CTX-11, CTX-12.
- Statement: Any accepted overview/report shall name one event basis, timezone, filter scope, and formula per metric and use the same definition on its list and export.
- Acceptance: Half-open date boundaries, current action snapshots, issued-time versus created-time counts, zero denominators, and list/export parity pass on the new database.
- Constraints: PR-14, PR-16, UX-1. Do not inherit unresolved financial definitions.
- Evidence: 35 reference date/filter/freshness checks passed; new data queries remain unverified.

The reference metric document explicitly records drift. Prefer its discipline
of canonical definitions and its regression scenarios over copying dashboard
SQL. A queued shipment, issued AWB, current exception, and delivered parcel
measure different events. Whole-IDR arithmetic and COD-liability separation
remain necessary if monetary reporting is selected; pricing and tax rates need
owner decisions. A reference's five-minute freshness threshold is a proposal,
not a requirement accepted through this review.

## Reference verification and target handoff

The original five test files passed 35 pure-logic checks. Three additional
advanced-checkout transport/webhook/shipment-reference files passed 25 local
mocked/synthetic checks. Database variables were removed; no database suite or
real provider request ran. Both results and their exact checkout/commands are
recorded in `reference-scan.json`. The fingerprint check scopes source evidence;
it does not test either application's full behavior or a port.

For GeraiExpress, first settle the relevant owner decisions, pin actual runtime
versions, and create one execution queue. Verification must cover extracted
pure functions, a disposable Supabase database with authenticated RLS/role
negatives, Workers account concurrency/recovery, sandbox provider contracts,
and real-browser primary journeys. No fixture or passing old test may be
reported as new-application, production, courier-label, or deployment evidence.

## TD-7 — Partner control plane, signing, and scheduling
- Status: Proposed
- Owner: Integration owner
- Source: CTX-16, CTX-17, CTX-18; detailed vendor analysis in [Partner breakdown](../research/geraiexpress-mengantar-partner-api.md).
- Statement: The trusted Partner adapter shall expose four fixed vendor operations through authorized local commands, sign exact bytes, preserve registration identity, and coordinate platform-wide quotas independently of seller shipping work.
- Acceptance: The offline signature vector and changed-method/path/body/time cases pass; concurrent onboarding and timeout/503 recovery preserve one external ID/seller; partner-wide 429 and daily WIB reset behavior is durable across instances; foreign bindings and arbitrary signer paths are denied.
- Constraints: PR-17, PR-18, PR-20, NFR-5, ARCH-2, TEN-3, SEC-3.
- Evidence: Eleven vendor sections reviewed; no authenticated Partner operation executed.

The four POST paths are `/api/partner/v1/sellers`, `/sellers/list`,
`/sellers/api-key`, and `/sellers/api-key/regenerate`, where the latter three
also include the full `/api/partner/v1` prefix. JSON is serialized once; the
same UTF-8 bytes are signed and sent. Use the documented plain SHA-256 preimage
`METHOD:PATH:TYPE:BODY:TIMESTAMP:PARTNER_SECRET`, with empty TYPE, seconds,
uppercase POST, and a path without host/query/trailing slash. This is separate
from the Public API webhook HMAC/millisecond protocol. Do not expose a generic
signing proxy or accept a tenant-supplied host/path/external identity.

Persist onboarding intent, accepted owner/agreement reference, stable external
ID, and immutable request digest before dispatch. Uniqueness and claim guards
prevent concurrent account creation; a timeout/503 resumes the same input.
Bind returned seller/environment and encrypted key before reporting connected.
A replay returns the seller's current key, not permission to update its profile.
Null keys and provider restrictions remain blocked. EMAIL_ALREADY_REGISTERED
routes to BYOK without claiming Partner ownership.

Use a durable scheduler scoped to partner + environment for the initial
60-request fixed minute and 1,000-new-registration WIB-day limits, honoring
Retry-After and negotiated quota changes. One per-partner coordinator is a
candidate; reuse the account coordination mechanism rather than adding a
second framework. New registration throttling and per-seller shipping/label
limits have distinct scopes. Persist next-attempt state; no unbounded retry loop.

List/filter is for bounded partner-owned reconciliation, not tenant-wide search.
Local tenant status derives only from its stored binding. A Partner access
restriction stops control-plane retries, not an automatic blanket suspension of
otherwise working seller Public API connections. Disable affected seller work
only when its own provider authority requires it.

## TD-8 — Credential rotation and tracking readiness
- Status: Proposed
- Owner: Integration owner
- Source: CTX-17.
- Statement: Seller key retrieval/rotation shall be versioned durable operations against stable seller identity, and webhook readiness shall require its independently synchronized per-seller callback secret.
- Acceptance: Key retrieval provisioning, disabled-key refusal, rotation with/without webhook URL, lost response, seller-initiated rotation, and in-flight-order cases preserve truthful state without repeated orders/rotation or invalid callback acceptance.
- Constraints: PR-19, DATA-4, TEN-3, IAM-3, SEC-2, SEC-3, NFR-2.
- Evidence: Vendor contract reviewed; failure-injection and signed account-specific capture pending.

Get key may create a missing key and must be audited. Managed regeneration
invalidates the previous API key immediately and rotates the callback secret
when a Webhook URL exists. Fence new account dispatch, record intent, and
atomically persist returned encrypted values and versions. Do not hold a SQL
transaction across the HTTP call. Preserve already-dispatched outcomes with
attempt guards and reconcile their original provider order.

A lost response enters rotation_unknown, not an automatic second regeneration.
Get current key can recover the API key but not callbackSecret. If the webhook
secret is unknown, mark that capability unavailable and use authorized polling
until a provider/seller recovery procedure succeeds. A null callbackSecret
means no configured webhook, not a ready blank-secret verifier. Seller-initiated
changes require the same synchronization. No Partner webhook or URL-setting
endpoint is documented; seller setup and live signed proof are separate gates.

BYOK cannot use Partner-managed get/regenerate. The owner rotates in Mengantar
and replaces the local key through the protected connection flow, preserving
actual account identity and separately re-establishing webhook secret state.
Partner Secret replacement comes from Mengantar, invalidates the old secret,
and is independent of these per-seller credential versions.

## TD-9 — Normal retail tariff and verified discounted provider cost
- Status: Proposed
- Owner: Integration owner
- Source: CTX-24 through CTX-28; [pricing study](../research/geraiexpress-geraicuan-pricing-review.md), historical evidence only.
- Statement: The pricing adapter shall separately resolve normal customer shipping and account-specific discounted provider cost, apply verified COD/insurance inclusion and collection rules once, and bind each confirmed price to its current authority/assignment version.
- Acceptance: Changing the seller discount changes private net cost without changing normal customer shipping; regular/cargo, fee inclusion, COD bases, insurance payer, rounding, unknown/mismatched discount, stale input and private-cost projection checks pass in every enabled mode.
- Constraints: PR-22, PR-23, DATA-5, IAM-5, IAM-6, UX-5, TD-2, TD-3. Provider discount activation and actual fee/insurance capability must be verified; no hardcoded 333-bps or flat discount default.
- Evidence: Reference checks establish source behavior only; the selected retail/net policy has no runtime/provider proof yet.

Map normal shipping R and net shipping N separately from complete provider totals.
The documented account-aware estimate path is `/order/estimate`; the reviewed
flat Public and raw 3PL alternatives are different pricing contracts, not free
substitutes for a seller-specific discount. Keep matching route/weight/dimensions,
service/tier, account and phase. A `price`, `estimatedPrice` or
`estimatedSpecialPrice` field name alone does not establish whether COD fee or
insurance is already included. Prove current mappings; handle cargo equivalents.

Use the confirmed normal retail basis for customer/resi output in Non-COD,
Full COD and COD Ongkir. The reference's new COD Ongkir uses deducted-shipping
break-even; that is historical source behavior and is superseded for GeraiExpress
customer pricing by CTX-28. Customer-facing fees/premiums are distinct from
private provider deductions. Reuse monetary composition and exact arithmetic,
not its historical rate, tax interpretation or payout assumptions.

The estimate request's COD fee base and the final order collection are distinct
contract values. Determine rate/base/minimum/maximum/rounding and any final-amount
dependency from current evidence. Use provider-returned applicable components
where authoritative; derive only with a verified current rule. Count each fee
once and do not apply a shipping discount to COD fee/insurance without separate
entitlement. A selected insurance premium needs coverage/declared value, payer
and whether it is collected in COD or at the counter; preserve goods value for
insurance even in shipping-only collection. Unsupported/missing required
components produce an explicit readiness/revalidation state, not an invented
zero or old formula fallback.

Keep negotiated discount assignment separate from provider-verified activation.
The reviewed Partner API registers/lists sellers and manages their keys; it has
no rate-management route. Use the agreed provider channel to activate terms,
then verify account/service net quotes and eventual actual charges. Local
assignment edits cannot change an upstream debit. A mismatch remains visible
and does not silently become a platform subsidy, altered customer retail rate
or switched provider account. Store an audited, versioned scoped assignment
without creating a generic promotion engine.

Before dispatch, reload quote/input/account/assignment authority and require new
customer review when their confirmed amount changes. After external submission,
record any actual-charge difference against the original order and reconcile;
do not claim it could not have charged or blindly submit again. Historic price
snapshots never follow later discount changes. Optional owner reporting uses
estimated versus verified actual cost, excluding customer goods from earnings.

Use explicit role DTOs in every mode; fix the reference Non-COD internal-cost
field exposure on adaptation. Protect private cost/assignment data at the direct
Data API boundary too. Verify that actual provider PDF output supports the
selected normal customer tariff/private-net rule; no invented custom-price
parameter, altered barcode/routing or silent discounted-label fallback.

### Prospective synthetic price vectors

These are test inputs, not current tariffs, percentages, quotes or executed tests.
`R` is normal shipping, `N` private net shipping, `Fc/Fp` customer/provider COD
fee and `Ic/Ip` customer/provider insurance. Test fixtures supply authoritative
component/inclusion/channel facts; the adapter must not infer them from names.

| Vector | Explicit synthetic input | Required result |
|---|---|---|
| Two activated discounts | Same service: R=10,000; N=8,000 then 7,000; Non-COD, no fees/insurance | Customer shipping stays 10,000 in both. Private cost changes; estimated shipping spread is 2,000 then 3,000, not proof of profit/payment |
| Fee-exclusive vs inclusive | R=10,000, N=8,000, Fc=Fp=500, Ic=Ip=200; provider fixture A separates components; fixture B totals 10,700/8,700 and explicitly says fee/premium included | Both normalize to customer shipping-related 10,700 and provider cost 8,700; neither adds 500/200 twice |
| Insurance at counter | Full COD, goods=100,000; same components; shipping and COD fee collected by courier, insurance only at counter | Courier collection 110,500; counter insurance due 200; combined customer obligation 110,700; no paid receipt implied |
| Insurance by courier | Same Full COD facts, but supported insurance channel is courier | Courier collection 110,700; counter due 0; same combined obligation and private provider cost |
| COD Ongkir | Goods value=100,000 for declared insurance value only, goods collection=0; same supported courier components | Courier collection 10,700, never 8,700; goods excluded from collection and retained for insurance validation |
| Unknown vs verified zero | Required insurance/fee amount missing vs explicitly verified 0 vs not-applicable mode | Missing blocks affected quote/confirmation; verified 0 and not applicable retain distinct provenance, no historical fallback |
| Private authority changed | Customer total unchanged but N, actual account, applicable assignment or quote revision changes after confirmation | Prior dispatch authority is invalid. Revalidate and obtain the required renewed spending confirmation without exposing private N to an operator |
| Provider decimal | Authoritative provider fee string `3329.99` | Preserve exact evidence; customer whole-IDR display/charge requires its separately verified rounding rule, not truncation or binary float arithmetic |

A fee calculated from final collection may require provider re-estimation; the
fixed fee fixtures above deliberately do not assert a universal gross-up formula.
A new customer review is required if customer amounts change. Even if only a
private cost changes, no dispatch may reuse stale financial authority: route
renewed authorization through the permitted payer/confirmation policy.


## TD-10 — Platform projections and governed commands
- Status: Proposed
- Owner: Engineering owner
- Source: CTX-14, CTX-29, CTX-30; source paths retained in `reference-scan.json`, super_admin_review.
- Statement: Super Admin work shall use separately authorized platform read projections and narrowly bounded commands with current capability/assurance checks, consistent metric definitions and durable audit/recovery.
- Acceptance: Platform lists/metrics match their defined cohort and filters, stale/partial data is explicit, direct tenant/demo/non-platform access fails, and concurrent/replayed lifecycle/discount/recovery commands do not broaden scope, duplicate effects or lose a known external outcome.
- Constraints: PR-15, PR-23 through PR-28, DATA-6, TEN-4, IAM-7, SEC-4, UX-6. Existing tenant APIs and provider-account ownership remain authoritative.
- Evidence: Read-only platform source trace and vendor auth documentation; no target runtime/query/browser proof.

Adapt the preferred source's platform overview/attention queue, business directory,
registration review, tenant lifecycle and audit composition. Relevant modules are
`src/app/platform/{page,tenant/page,pendaftaran/page,audit/page}.tsx`,
`src/app/platform/platform-access.ts`, `src/db/platform-context.ts`,
`src/db/platform-monitoring-repository.ts`, `src/db/tenant-lifecycle.ts` and
`src/db/tenant-registration-repository.ts`. Do not port Better Auth sessions,
Node database transaction settings or historical monitoring formulas unchanged.

Resolve Supabase identity, verified assurance and current platform grant before
loading platform projections. Browser selectors choose only a permitted explicit
scope; they cannot turn a tenant endpoint into a global query. Routine tenant
queries remain user-context RLS queries. If a platform helper needs privileged
SQL, use restricted grants, fixed schema/search path and parameterized allowlisted
operations; never an unrestricted service-role browser/Worker proxy. Prove its
direct Data API/RPC denial independently of route guards.

Global health uses defined aggregate projections and minimum safe operation
metadata. Current lifecycle/queue snapshots and period-based issued/attempt
metrics have separate labels/bases and timestamps. Apply the same tenant,
period/courier/status filters to detail and summary where their cohort matches.
No failed load becomes a healthy zero; no quota/session threshold is copied
without its accepted definition. Add charts only where evidence/data exists.

Each mutation records current actor/capability, target tenant/account/object,
expected revision and intent before a side effect. Local state/audit write is
atomic where possible; external work remains a durable pending operation with
attempt guards and truthful result persistence. Lifecycle/role decisions recheck
inside the transaction. Safe reconciliation/resume binds its original provider
operation/account and reuses TD-3/TD-8; Super Admin cannot turn unknown into a
fresh create or create new spending authority from an exception-view permission.

Local tenant review/suspension, seller restriction, key status, pricing-assignment
activation and production egress readiness remain separate. Changing one does
not manufacture provider activation/ban/refund or rewrite issued retail prices.
No credential value appears in monitoring/audit. Existing narrow incident/key
permission must be selected before a platform administrator can initiate such
an exceptional credential action; routine owner recovery stays under PR-19.

## TD-11 — Registration orchestration and bounded recovery
- Status: Proposed
- Owner: Engineering owner
- Source: CTX-31 through CTX-35; PR-29 through PR-33.
- Statement: Registration shall use native Auth for inbox/session/password effects and transactional application commands for own onboarding, activation and invitation acceptance, with idempotent resumable transitions between these systems.
- Acceptance: Duplicate and interrupted requests converge on one intended application/membership, Auth/email failure leaves a recoverable state, stale review/invite requests fail safely, and no signup or review retry dispatches a provider operation.
- Constraints: DATA-7, TEN-5, IAM-8, SEC-5, ARCH-3, UX-7, UX-8; no cross-system atomicity claim or reference Auth-table migration.
- Evidence: Source-only patterns reviewed; target implementation and failure-injection tests pending.
- Change history: 2026-10-13 — Added in the registration and documentation-completeness review.

### Native Auth and application command boundary

Recommended email-first signup uses `signInWithOtp` with explicitly permitted
Auth user creation, then `verifyOtp` for email-code verification. The new user
sets their password through native authenticated `updateUser`; routine password
login uses `signInWithPassword`. Do not call `signUp` with an unverified person's
password merely to emulate the reference. These method names are documented
vendor APIs, not implemented GeraiExpress endpoints. Recheck installed versions.

Configure the native email template to send an email code rather than leaving
the default Magic Link presentation. Code lifetime, resend delay and attempt
limits come from the actual Auth configuration and must match screen/email copy.
Application invitations remain app-owned; their business notification uses the
verified same-stack mail channel, not an Auth-email success as role authority.

Before initial account completion, establish fresh inbox control. An Auth user
row or an existing password does not prove prior legitimate app setup: someone
could have registered another person's email through the direct Auth endpoint.
For identities without a trusted completed application-account record, require
explicit password set/replacement after inbox proof, invalidate other sessions
through native Auth and reject pre-completion sessions before permitting business
setup or invitation acceptance. Never silently retain an unverified registrant's
password. A previously completed legitimate app account keeps its credentials
and may resume using the newly inbox-verified native OTP session after current
access checks, or use explicit password sign-in/recovery. Do not use writable metadata as completion
authority. Native password/session changes and the app completion record recover
separately; no cross-system transaction is assumed. The exact freshness/revocation
enforcement, including direct database access, requires proof before enablement.

Completion must bind to the native session that proved inbox control. An older
attacker-controlled session cannot gain app authority when completion becomes
true, including by refreshing into a JWT with a newer `iat`. Issued JWT expiry
and refresh-session revocation are different facts. Prove a trusted session-start
or security-revision mechanism across Worker and direct Data API/RPC boundaries;
a client timestamp, writable metadata or `iat` alone is insufficient. Native Auth
APIs and actual enforcement are implementation proof gates, not invented here.

| Application command (logical, not published HTTP API) | Preconditions | Atomic effect / retry contract |
|---|---|---|
| Start or resume own onboarding | Verified non-demo user with trusted account completion and permitted current session; explicit new-business intent; no conflicting open application under selected policy | Server-owned application reference and revision; repeats return own current reference, never lookup by public email |
| Save application draft | Same verified applicant; editable state under DATA-7; expected revision and bounded fields | Save own draft/revision only; no tenant, membership, outlet or provider side effect |
| Submit application | Same verified applicant; DATA-7 transition, current validated revision and actual application policy acceptance | First submission commits provisioning tenant, first admin membership, initial outlet, immutable submitted revision, receipt and audit together; resubmission reuses the bundle and adds a revision, never resets tenant lifecycle; no remote call inside transaction |
| Review application | Current granted Super Admin with required factor; current submitted revision, verified owner and selected review policy | Approve/changes-request/reject decision, reason, tenant transition and audit together; duplicate same command returns original result; opposite/stale decisions conflict |
| Automatic activation, if selected | Current policy version and same verified applicant/data constraints | Record policy outcome and tenant transition; no fake human review or automatic seller creation |
| Issue/revoke staff invitation | Current same-tenant administrator, allowed role/outlet scope, administrability guards | Store invitation revision/state and safe delivery status; do not create active membership merely because mail was accepted |
| Accept invitation | Exact intended current verified email, trusted account completion/current session, active tenant, current invitation/issuer authority, expected version and explicit acceptance | One membership/outlet assignment plus accepted invitation/audit; concurrent replay returns the same result, never escalates an existing member silently |

Auth creation, mail sending and application data have no shared transaction.
An Auth-only user is allowed to resume onboarding after a database outage.
A tenant created before response loss is recovered from the command receipt.
A mail-send timeout does not trigger tenant deletion, password replacement or
seller recreation. Preserve only bounded non-secret form values; recover state
from the authenticated server, not an email query parameter or localStorage.

If the initial policy permits only one unresolved self-service application per
applicant, enforce that constraint server-side and return its existing reference.
This is a proposal, not a one-user/one-tenant permission model: existing users
can belong to multiple tenants through explicit memberships. Additional business
creation remains disabled until the corresponding policy is accepted.

Use native SSR cookie/session support with private/no-store responses. For any
enabled PKCE callback, exchange the code server-side once; validate the return
destination against configured origins and local paths. Missing verifier,
expired code, wrong logged-in identity or callback replay leads to a safe retry
or sign-in state. The recommended email-code path does not depend on opening a
signup link in the original browser. Neither callback style activates a tenant.

### Registration verification plan — prospective, not executed

| Target | Required behavioral check before acceptance |
|---|---|
| Native Auth | New email, returning account, direct alternate signup, pre-registration attack, code expiry/replay/wrong code, fresh recovery and no attacker password/session access |
| Application transaction | Concurrent/double-click submission, interruption before/after commit, duplicate open request, own resume and no incomplete tenant/admin/outlet bundle |
| Review | Verified-owner guard, current factor/capability, corrections/resubmission reflected in approved business fields, concurrent approve/reject, stale revision, lifecycle-bypass denial and audit/tenant outcome parity |
| Invitation | New/existing identity, wrong account/email, expired/revoked invite, changed role/issuer/outlet, existing-member conflict, concurrent acceptance, replay after membership removal and final-admin guard |
| Direct boundaries | Anonymous, Auth-only, pending, rejected, foreign, demo, suspended and revoked users cannot bypass Worker/Data API/RPC permissions |
| Full stack | Email → account → gerai → selected activation → explicit new/BYOK seller → capability readiness → first resi; provider outcomes tested under separate authorization |
| Browser | New/returning/invited user, mobile email paste/autofill, preserved form/errors, multi-tenant chooser, resume after expiry and no wrong-workspace flash at NFR-4 sizes |
| Mail/release | Local capture plus controlled inboxes through actual Supabase → Cloudflare SMTP; quota/suppression/outage, correct template/expiry, no token/password in diagnostics |

No new implementation task queue is created while these requirements are
Proposed. Accepted requirements must acquire executable tests and one root
execution queue during project initialization; this table is not runtime evidence.
