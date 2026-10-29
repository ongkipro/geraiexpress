# GeraiExpress — Technical Design and Reference Reuse

- Status: Proposed component contracts with Observed local implementation evidence; amended 2026-10-29 for Decisions DEC-020 and DEC-021 (ADR-0002, owner), replacing Cloudflare Workers/gateway runtime mechanics and Supabase/GoTrue/Send Email Hook with the self-hosted Node container, plain PostgreSQL 17 + PostgREST and the application-owned auth module (T-062, T-064..T-066 built locally; T-067 security review open).
- Owner: Engineering owner
- Updated: 2026-10-29
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
`/home/ongki/Projects/legacy-reference`; it records what was inspected there, not the
most advanced implementation of the product. The advanced matrix that follows
takes precedence when both provide the same capability. Fifteen worktrees were
inventoried; their commit metadata alone is not code or runtime proof.

| Reference paths / symbols | Observed behavior | Disposition and GeraiExpress treatment | Verification needed |
|---|---|---|---|
| `src/lib/shipment-draft.ts`: `validateShipmentDraft`, `normalizePartyPhone`; callers in `src/app/app/actions.ts`, `contact-directory.ts`, `bulk-shipment-intake.ts` | Name/phone/area/package/dimension/whole-IDR validation shared across single and bulk intake | Extract validation after removing `server-only`/alias coupling. Review hard limits; phone validation is not international canonicalization and must not establish contact uniqueness. | Valid/invalid/boundary inputs; same invariant at every backend caller |
| `src/lib/contact-directory.ts`; `src/db/contact-repository.ts`; `src/app/app/kontak/actions.ts` | Sender/recipient flags, multiple addresses, archive handling, masked search DTO, atomic master+address creation | Adapt to PostgreSQL/PostgREST SQL/RPC, tenant policies, projected DTOs, and selected role rules. | Tenant negatives, same phone on separate records, address conflict, stale selection |
| `src/lib/domain-enums.ts`; `src/lib/shipment-queue.ts` | Browser-safe literals, status labels, next-action guidance, filters | Extract concepts; split submission/payment/delivery states rather than copying the mixed state union as a new canonical model. | State/action matrix plus browser behavior |
| `src/lib/analytics-range.ts`, `data-freshness.ts`, `label-format.ts`, `pii-redaction.ts` | Explicit timezones, half-open ranges, freshness checks, Intl formatting, phone masking | Extract small independent functions. Replace hard-coded WIB display when workspace timezone is selected; confirm freshness policy. | Existing applicable checks plus Node-container/browser checks and midnight boundaries |
| `src/lib/analytics-filters.ts`, `platform-monitoring-filters.ts` | URL filter normalization and scope validation | Adapt runtime schema imports to pure literals before browser reuse; passing Node tests do not remove database graph imports. | Bundle/import inspection and unauthorized selector cases |
| `src/lib/mengantar-locations.ts`; `src/app/app/location-actions.ts` | Bounded provider lookup, authoritative pickup/area pair, destination options | Adapt to request-scoped server clients and account-authority versions. | Account replacement during lookup; pickup ID versus area ID |
| `src/lib/mengantar-estimate.ts`; `src/db/estimate-repository.ts`; `src/app/app/estimate-actions.ts` | HTTP timeout/body limits, normalized services, persisted estimate authority | Adapt transport/normalizer against current account-specific schemas and price mode. | Supported/unsupported/COD cases, stale quote, unexpected response fields |
| `src/lib/mengantar-credentials.ts`; `src/db/outlet-readiness-repository.ts` | Private/platform account sources, authority version, pickup readiness | Adapt under DEC-006 (one seller per tenant, no central fallback); explicit account reference, capability state, and rotation behavior. | Partial configuration, disabled private connection, account switch without fallback |
| `src/lib/shipment-issuance.ts`, `mengantar-order.ts`; `src/db/order-batch-repository.ts`; `src/app/app/pengiriman/[shipmentId]/actions.ts` | Preparation/claim/result orchestration and unknown outcome; UI transport is fixture-only | Rebuild real wire transport; adapt state guards and idempotency. Old flattened `buildMengantarOrderPayload` is not the official nested request. | Current sandbox envelope, partial response correlation, restart and replay |
| `src/lib/mengantar-order.ts`: `withProviderAccountSerialization` | Session-level PostgreSQL advisory lock using a Node `pg.Pool` client | Rebuild coordination around the PostgreSQL database rule (DEC-010, DEC-021), retained on Node under DEC-020. Preserve actual-account serialization, not a DB connection lock held across remote work. | Two tenants sharing one account; concurrent awaits, restarts, lease/claim failure |
| `src/db/shipment-unpaid-recovery-repository.ts`, `unpaid-recovery-repository.ts`; `src/lib/mengantar-unpaid-recovery.ts`, `shipment-reconciliation.ts` | Recover existing unpaid order, reconcile unknown outcomes, stale-operation guidance | Adapt state transitions and account-scoped authority; do not treat fixture recovery as a verified live endpoint. | Timeout after payment, existing order reused, duplicated results, unexpected account |
| `src/db/label-print-repository.ts`; `src/app/app/label/[shipmentId]/label-sheet.tsx`, `label-print-panel.tsx`; `src/app/globals.css` | Local 100×150mm HTML label, eligibility and print-attempt history | Adapt eligibility, local layout and print-attempt history. Decision (DEC-017, 2026-10-28): the local masked label is the label (TD-13) and the provider PDF is deferred. Local branded receipt/layout stays a separate unselected capability. | Barcode decode, masking switch, print history, accessible print workflow; provider permission and expired-URL checks apply only to the deferred PDF path |
| No `dropShipper`/`dropshippers` implementation found in scanned `src`/`tests` | Current provider feature is not in the application | Deferred (DEC-013, DEC-017): no provider dropshipper mapping is built; the printed sender is local (TD-13) and local contacts remain primary local data. | Revisit only if a provider sender identity is later accepted behind the supervised production order gate |
| `src/app/api/webhooks/mengantar/route.ts`: `POST` returns 404; `tests/provider-webhook-boundary.integration.test.ts` | Deliberately closed tracking ingestion | Rebuild from the current documented signature/payload and a scoped machine principal. Keep disabled until verified. | Forged, replayed, old, out-of-order, different-account, duplicated updates |
| `src/db/tenant-context.ts`, `platform-context.ts`, `src/lib/cms-auth.ts`, `cms-principal.ts`, `auth.ts`, `auth-config.ts` | Better Auth identity and transaction-local app context | Rebuild with the application-owned auth module (`src/lib/auth/**`, `db/migrations/20261029100000_auth_core.sql`, DEC-021, ADR-0002; formerly Supabase Auth) and membership-backed PostgreSQL RLS (`auth.uid()`, `auth.jwt()`); preserve active membership/tenant and deny-by-default invariants. | Direct PostgREST Data API/RPC access, stale JWT role, suspended user/tenant, platform separation |
| `src/db/member-governance-repository.ts`, `platform-tenant-repository.ts`, `tenant-lifecycle.ts` | Last-admin guard, governance idempotency, tenant transitions, audit | Adapt atomic governance and selected policy; staff invitations (`tenant_invitations`) and email-code verification (`src/lib/auth/**`) remain separate from membership activation. | Concurrent last-admin removal, retry, role escalation, rejected lifecycle action |
| `src/lib/bulk-shipment-intake.ts`, `bulk-shipment-intake-contract.ts`, `bulk-import-envelope.ts`; `src/app/app/impor/actions.ts` | CSV preview, ambiguous destination handling, encrypted expiring preview, selected row replay guards | Conditional. Retain proven installed CSV parsing approach after Node-container checks; review crypto and auth-secret coupling with purpose-separated keys. | Byte/row/fan-out limits, expired/tampered/wrong-tenant token, partial draft failure |
| `src/lib/analytics-export.ts` | Quoted CSV fields and spreadsheet formula escaping | Conditional extract with new browser-safe row DTO; export authorization belongs to backend. | Scope/filter parity, hostile formula, PII permission, bounded result size |
| `src/components/ui/*`, `src/components/cms/page-header.tsx`, `page-container.tsx`, `empty-state.tsx`; `src/lib/cms-shell-navigation.ts` | shadcn-style primitives and operator composition | Adapt vetted primitives and task hierarchy; replace navigation/router/auth coupling and remove reference branding. | Installed dependency compatibility, keyboard, responsive browser, no schema/server bundle leakage |
| `src/components/cms/data-freshness-control.tsx` | Accessible refresh state and focus management using Next router refresh | Adapt result/announcement pattern to the selected loader and verified self-hosted Next.js refresh behavior; do not assume the old router/cache semantics transfer. | Recoverable fetch failure preserves useful data and focus |
| `src/db/ledger-repository.ts`, `analytics-repository.ts`, `tenant-dashboard-repository.ts`, `platform-monitoring-repository.ts`; `docs/spec/19-METRICS-ANALYTICS-CONTRACT.md` | Financial/event models, dashboards, documented metric drift and pending policies | Conditional. Reuse invariant and definition approach, not unreviewed formulas, fees, old accepted policy, or all current query implementations. | Accepted finance policy; ledger/list/export parity; no COD principal as revenue |
| `src/db/schema.ts`; `drizzle/*.sql` | Tenant composite FKs, immutable ownership, RLS/privilege hardening, append-only snapshots | Adapt constraints selectively into one fresh PostgreSQL migration history (`db/foundation/` and `db/migrations/`, DEC-021; formerly `supabase/migrations/`). Do not replay Better Auth schema and application-context policies wholesale. | Empty local migration build, grant/RLS negatives, ownership reparenting rejection |

### Preferred advanced source and precedence

Advanced paths below are relative to `/home/ongki/Projects/legacy-reference-completion`,
HEAD `1199406c5c6fb67d6607add624cea487c91ad029`. This checkout was clean; 727
selected files were fingerprinted and the relevant flows inspected selectively.
Sibling brand/landing/operations worktrees were inventoried and the dated
operations note was read; they were not silently merged into this source.

| Advanced paths / symbols | Reuse recommendation | Remaining adaptation/proof |
|---|---|---|
| `src/lib/mengantar-http.ts`: `requestMengantar`, `mengantarAnswerMessage` | Adapt this bounded, redirect-refusing, credential-redacting HTTP client instead of starting from the old estimate-only client | Node-container runtime, allowed endpoints/hosts, exact current error semantics; never classify every rejection as safe to replay from HTTP status alone |
| `src/lib/mengantar-live-transport.ts`; `src/lib/mengantar-order.ts`: `buildMengantarOrderRequest`, pickup-time handling | Adapt the existing nested request builder and gated order/payment transport. The old flat fixture builder is not the preferred starting point | Live success still unproved in this review; no `dropShipper` (DEC-017); add pickup time reservation (TD-12), new auth/account identity, durable coordination, and current sandbox evidence |
| `src/lib/mengantar-webhook.ts`; `src/db/mengantar-webhook-repository.ts`; route `src/app/api/webhooks/mengantar/route.ts` | Adapt verification/body bounds/failure semantics and relevant tests rather than rebuilding all parsing from nothing | Replace Node HMAC/Buffer and database boundary; select per-account secret routing and mapped account+order authority; serve from the separate cookie-less webhook host (SEC-6). Current implementation notes a platform-default-only secret/no real capture |
| `src/lib/provider-delivery-status.ts`, `mengantar-status-pull.ts`; `src/db/provider-tracking-repository.ts` | Adapt shared status/transition and pull reconciliation rules | Recheck current categories, unknown-status handling and actual account ownership before applying updates |
| `src/lib/shipment-number.ts`; `src/db/shipment-number-repository.ts` | Conditional readable local shipment references and scoped numeric URLs | Keep local reference separate from AWB and database ID; Decision (CTX-41 item 12, accepted 2026-10-28; DATA-8): per-tenant prefix and per-tenant per-day counter under a row lock; the row-lock mechanism is a Proposal until the migration task is accepted |
| `src/lib/shipment-draft-logic.ts`: product-row helpers, pickup/drop-off and scheduling checks; `src/app/app/pengiriman/baru/page.tsx` | Adapt the one-page fill → estimate → review/confirm workflow; extract genuinely independent helpers | Do not import fee constants or old schedule windows as policy. Provider sender identity must match the new customer workflow, not just local label masking |
| `src/app/app/cek-tarif/rate-check.tsx`; `src/lib/wilayah.ts`, `wilayah-match.ts` | Conditional quick tariff comparison and human-readable area selection | Resolve provider-authoritative area IDs, expose ambiguity, bound lookups; local geographic matches are not provider identity authority |
| `src/lib/gerai-settings.ts`; `src/app/app/brand/gerai-brand.tsx`, `brand/logo/route.ts`; `src/app/app/pengaturan/label/label-info-editor.tsx` | Adapt gerai profile/brand and bounded logo validation; keep operator preview | New private storage/access and selected upload limits; local display overrides do not update Mengantar sender records or authorize courier PDF branding |
| `src/app/app/label/[shipmentId]/label-barcode.tsx`, `label-sheet.tsx`; `src/lib/label-size.ts`, `label-fields.ts`, `label-queue.ts`; `src/app/app/label/cetak/*` | Adapt local thermal layout, barcode fitting and print-attempt UX for the masked label (Decision DEC-017; TD-13); batch selection stays conditional | The provider PDF is deferred (DEC-017). Courier acceptance of a locally printed label needs a pilot scan; no physical-print claims |
| `src/db/shipment-invoice-repository.ts`: `invoiceForRole`; `src/app/app/invoice/*` | Conditional customer receipt/invoice snapshots, scoped rendering, operator-safe projection | Select receipt purpose/price/tax policy, make new snapshot schema, never show private provider cost or imply a fiscal invoice |
| `src/app/app/label/handover-actions.ts`, `handover-dialog.tsx`; `src/lib/shipment-cancel-rules.ts`, `shipment-cancellation.ts` | Conditional scanned handover and state-valid cancellation/recovery patterns | Handover is an operational action; cancellation is a provider mutation needing its own authority, verification and money/reconciliation policy |
| Advanced `AGENTS.md`, operational contact source, and `tests/contact-numbers-t241.integration.test.ts` | Preserve the distinction between authorized full contact display and redaction outside permitted operational scope; consider readable contact references/attribution | Do not impose the older universal masked-list policy without a new owner decision. Advanced contact/database tests were inspected, not executed |

The advanced reference currently records no successful documented-shape live
creation and no real webhook capture in its inspected comments/status. Those are
reference observations, not newly executed provider checks. Its local label
masking deliberately does not send `dropShipper`; Decision (DEC-013, DEC-017,
2026-10-28): GeraiExpress keeps that choice, so provider-authoritative customer
sender identity is deferred and the masked label is local (TD-13).

## TD-2 — Current provider adapter and account authority
- Status: Proposed
- Owner: Integration owner
- Source: CTX-5, CTX-9, CTX-13; SRC-MENGANTAR-DOCS in `sources.json`.
- Statement: The server-side provider adapter shall translate validated domain operations into the current provider contract and bind every provider identifier and response to the selected account authority.
- Acceptance: Sanitized account-specific sandbox fixtures prove pickup-area selection, quotes, pickup type and slot (TD-12), order response correlation, and no use of a previous account's identifiers.
- Constraints: DATA-3, TEN-2, SEC-1; DEC-006 settles account ownership (one seller per tenant); intended-account capabilities must still be proved.
- Evidence: Documentation and static reference review only.

The original checkout's flat DTO is internal to fixture orchestration. The
advanced `buildMengantarOrderRequest` already supplies the documented nested
shape and is the preferred adaptation candidate. It deliberately omits
`dropShipper`; Decision (DEC-013, DEC-017): the provider-sender requirement is
deferred and no dropshipper mapping is built, so the omission stays. The current
official create request groups `courier`, `pickup`, and `orders[]`; a customer
sender could use an existing account-owned `dropShipper` only if that is later
accepted. Preserve item-level
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
- Source: CTX-11, CTX-13; DEC-010, DEC-020; `src/lib/mengantar/dispatcher.ts`, `src/lib/mengantar/scheduled.ts`, `src/lib/cron.ts`.
- Statement: Provider-mutating work shall have a durable operation record, one actual-account executor where serialization is required, guarded state transitions, and reconciliation for uncertain outcomes.
- Acceptance: Concurrent users/tenants, duplicate delivery, restart, and timeout-after-acceptance tests cannot create a second order or lose a known provider result.
- Constraints: TEN-2, DATA-2, DATA-3, SEC-1, TD-8. DEC-006 (accepted 2026-10-14) fixes the account-owner/outlet cardinality: one seller per tenant, every outlet of the tenant mapped to it; BYOK is the existing-account path.
- Evidence: Observed dispatcher and bounded scheduled-task implementation on disk; the runtime cutover does not itself prove restart, production egress or live-provider behavior.

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

Decision (DEC-010; runtime retained by DEC-020, owner): the coordinator is a
database rule, not a Worker or an in-process JavaScript lock. Mengantar results
are written only by a machine identity; at most one real operation is in flight
per tenant, with no SQL transaction held across a provider call; a stale
in-flight operation goes to reconciliation, never to a blind resend.
Serialization equals per seller only while no two tenants share a seller
(DEC-006); an actual-account identity is needed if that changes. A process restart
or scheduler timeout cannot authorize a duplicate effect.

Observed (merged code, 2026-10-29): `src/lib/mengantar/scheduled.ts` runs the
dispatcher sweep and demo cleanup through `src/app/api/internal/cron/[task]/route.ts`.
`infra/scheduler/scheduler.mjs` calls dispatch every five minutes and cleanup
hourly. `src/lib/cron.ts` requires the internal host and `CRON_SECRET`, compares
the bearer secret in constant time, rejects overlapping task calls and bounds
the response wait while retaining the lock until work ends. The proxy denies
the internal routes. These mechanics replace the former Worker cron; the
guarded database `pg_cron` demo-cleanup job runs only where the extension exists
(absent on plain PostgreSQL 17, so the scheduler container's hourly call is the
active path). Credential rewrap has no scheduled invocation yet (T-057).

Observed: `src/lib/config.ts` reads runtime settings from the app environment,
and `src/lib/limiter.ts` uses bounded process-local fixed-window tables (10,000 keys
per visitor table, 100,000 per account table; expired windows evicted first, then
oldest non-exhausted windows, never exhausted windows). Proposal (unbuilt): a shared
limiter store before a second app instance; it is distinct from durable database
provider serialization. With DEC-021 (T-066), authentication runs in-process against
PostgreSQL (`src/lib/auth/**`), so the former external Supabase Auth per-IP quota
concern and `AUTH_FORWARD_CLIENT_IP` / `Sb-Forwarded-For` forwarding no longer exist (RATE-2).

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

Amended 2026-10-28 (Decision, DEC-017): the label is a local masked label with a
Code128 AWB barcode (TD-13), so label generation and its quota behavior below
describe only the deferred provider-PDF path, which stays gated on Mengantar
whitelisting the seller account (Observed: HTTP 403 on the sandbox, TASKS Deferred).
Tracking ingestion is unchanged and now has its own cookie-less host (SEC-6).

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
Use a dedicated purpose/versioned key if encryption is retained; never reuse
`AUTH_JWT_SECRET`, `AUTH_SECRET` or a Mengantar credential as the application envelope key.

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
pure functions, a disposable PostgreSQL 17 + PostgREST database (`compose.db.yaml`) with authenticated RLS/role
negatives, Node-container account concurrency/recovery, sandbox provider contracts,
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

Observed (2026-10-28): no partner-wide scheduler or durable quota exists, and a
recorded retry-after or restriction is wiped by the next `begin` (review P1-11, T-038).
DEC-010 selected a database rule rather than a Durable Object coordinator for the
first form. Dispatch sweep and demo cleanup run through the scheduler container's
internal cron routes on the self-hosted Node deployment (ARCH-5, T-062).

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
- Source: CTX-24 through CTX-28; [pricing study](../research/geraiexpress-reference-pricing-review.md), historical evidence only.
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

### DEC-016 amendment — gerai discount recording and derivation (2026-10-28)

Decision (DEC-016, CTX-42): the sender pays the full normal tariff; the gerai receives
a Super Admin-assigned discount stored as configuration (DATA-9); no platform fee is
collected and no platform ledger exists. Proposal (mechanism): the estimate's
`discountPercent` is read at quote recording and stored as observed provider basis
points beside the private net cost, `discountExtraPercent` is stored unused, and an
absent field stays NULL. The gerai cost estimate is the normal tariff minus the
assigned gerai discount on shipping only; the platform remainder is derived and shown
as an estimate. A gerai discount above the observed provider discount is refused by
the database (DATA-9), and the assigned value never changes the provider's debit.
Unknown: the rounding rule (PR-23 requires it before T-041 ships). Observed: the
estimate parser already reads `discountPercent` (`src/lib/mengantar/public-api.ts:410`)
but nothing stores it.

Prospective synthetic vectors for this amendment (test inputs, not tariffs or quotes;
basis points are integers):

| Case | Synthetic input | Required result |
|---|---|---|
| Gerai within observed | Normal tariff 10,000; observed provider 2,000 bps; gerai 2,000 bps | Sender 10,000; gerai cost estimate 8,000; remainder 0; accepted |
| Gerai above observed | Same tariff; observed 2,000 bps; gerai 2,500 bps | Refused by the database; sender still 10,000 |
| Observed unknown | Same tariff; observed NULL; gerai 2,000 bps | Discount held pending; gerai cost unknown, not 0; sender 10,000 |
| Stated above observed | Stated provider 3,000 bps; observed 2,000 bps; gerai 2,000 bps | Remainder estimate 1,000 from the stated value with a drift marker against the observed value; status owner-stated |
| Discount on fees | COD fee and insurance present | The gerai discount applies to shipping only |

## TD-12 — Pickup orders with provider time reservation
- Status: Proposed; requirement decided (CTX-39, PR-5); built locally (T-043) from the provider documentation; request and response shapes Unknown until a supervised sandbox capture (T-048)
- Owner: Integration owner
- Source: CTX-39, DEC-010, DEC-014; PR-5; TASKS T-043, T-034.
- Statement: The adapter shall support a per-shipment choice of drop-off or pickup; for pickup it shall list the provider's time slots, reserve the chosen slot, and only then create the order with the matching pickup type, treating the reservation and the order as durable operations that each reconcile instead of resend.
- Acceptance: A lost reservation response and a lost create response each end in reconciliation of the original operation with no second reservation or order (failure-injection test); drop-off behavior is unchanged; the dispatched pickup identity is the one frozen at confirmation; one supervised sandbox pickup is recorded with owner approval.
- Constraints: TD-2, TD-3, DEC-010, ARCH-5, RATE-1, UX-10.
- Evidence: Observed (2026-10-28, local): `src/lib/mengantar/pickup.ts` and `dispatcher.ts` run `GET /time` (a read-only reachability check before the write-ahead and the read-back for reconciliation), a stored `reserving` phase, one `POST /time`, `reserved`, `creating`, then `POST /order` with `scheduledPickup`, `time_id` and a volume class (`volumeMotor`, `volumeMobil` or `volumeTruck`, required by the documentation); the `dispatch_pickup_*` RPCs are machine-only and a started reservation or create cannot be released; a lost reservation response reconciles by a `GET /time` read-back (exactly one match, else `reservation_ambiguous`), a lost create response by order reference, a refused slot reopens without resending; the frozen pickup identity is dispatched (T-034). Tests: tests/unit mengantar-pickup (28 at delivery), tests/db pickup-orders (20), tests/e2e shipping (38 of 38 on 390 and 1280). Deviations from the Statement: no provider slot list is shown, the operator picks a date and a start hour locally (09 to 18 WIB, 90-minute lead and 14-day maximum are local rules; WIB and the one-hour slot length are assumptions marked Unknown in code). Unverified: the `POST /time` success status and refusal body, the id format, the `GET /time` date form and whether rows carry an address; whether an orphaned reservation can be released; the Pos pinpoint is not handled; no supervised sandbox pickup was performed.

1. **Listing** the available slots is read-only and may retry with bounded backoff and a deadline.
2. **Reservation** is a state-changing provider call. It uses the existing durable-operation pattern: intent persisted first, no SQL transaction held across the call, per-seller serialization (DEC-010: at most one real operation in flight per tenant), and the reservation counts as that in-flight operation.
3. **Order creation** follows only after a recorded reservation result and carries the matching pickup type; a reservation is not an order.
4. **Unknown outcomes.** A timeout or 5xx after a possible reservation or order reconciles by the original reference; whether the provider exposes a way to list a seller's reservations for that reconciliation is Unknown. No cancel call is invented: whether an unused reservation can be released or expires is Unknown until the capture.
5. **Identity.** Keep the provider pickup-address ID separate from the origin area ID (TD-2), and dispatch the pickup identity frozen at confirmation, not the current outlet pickup (review P1-3).
6. **Egress.** Decision (DEC-020, owner): pickup calls use the seller's Public API key from the Node app on the self-hosted server, without a separate gateway. The server's fixed IPv4 is the ARCH-2 Partner allow-list address; whether Public API pickup itself enforces an allow-list is Unknown (T-048).

## TD-13 — Local masked label generation and barcode
- Status: Proposed; label behavior decided (DEC-017, PR-34, PR-6); built locally (T-044)
- Owner: Engineering owner
- Source: DEC-017, DEC-013; CTX-39; PR-34, PR-6; DATA-10; TASKS T-044.
- Statement: The label shall be produced locally from an immutable snapshot of the issued shipment and the operator's masking choice, drawn with a Code128 barcode that decodes to the AWB, with no provider label call, no provider dropshipper call and no external barcode service.
- Acceptance: A decode test over representative AWB shapes from each supported courier returns the exact AWB; reprinting reproduces the stored snapshot after the source contact or outlet changes; the Mengantar pickup name never appears as the default sender; no outbound provider request is made when printing; a simulated shipment cannot create a real snapshot.
- Constraints: DATA-10, UX-9, UI-6, PRIV-1, TEN-1, IAM-1, DEC-008 (operators may print); native-first rule for any barcode dependency.
- Evidence: Observed (2026-10-28, local): `src/lib/label-code128.ts` (Code128-B encoder, table checked against the standard and pinned vectors from an independent encoder), `src/lib/label-content.ts`, `src/components/label/**` and `src/modules/labels/**` render the stored snapshot as vector bars with quiet zones in a print stylesheet sized to 10x15 cm or 10x10 cm; `create_label_snapshot` and `record_label_print` are database-enforced; no provider request is made (a unit test searches the label files and the migration for provider, fetch, label-generation and dropshipper references); the pickup name is never the default sender; a simulated shipment cannot create a real snapshot. Tests: tests/unit code128, tests/db masked-label, tests/e2e label on 390 and 1280 (768 not run); Chromium print-to-PDF gives one page at 100x150 mm and 100x100 mm. The encoder uses Code128 subset B and the stored AWB is decoded back in the browser; the AWB character set per courier stays Unknown beyond the fixtures. Not built: a physical-printer check.

- **Snapshot command (Proposal).** A reviewed RPC checks the caller's membership and role, an issued shipment with an authoritative AWB, and the tenant of the shipment; it writes the snapshot from the stored party and pickup snapshots (PR-7) plus the operator's choice, and a second command appends the print-history row. Both are database-enforced, not route-only (TEN-1).
- **Character set.** The set of characters in each courier's AWB is Unknown, so the encoder must select the Code128 subset per value and be proved by a decoder rather than by inspection. Whether to extend the marketing encoder or add a dependency is open and follows the native-first check.
- **Rendering.** Vector bars with quiet zones in a print stylesheet sized to the chosen label (UI-6); no server-rendered PDF. Printing uses the browser print dialog, which is not proof of paper output.
- **Boundaries.** The masked sender is never sent to Mengantar and is never copied to contacts automatically; the gerai's own WhatsApp comes from the tenant-level `contact_whatsapp` (Decision, PR-34; DATA-10), and an empty value blocks the masked print.
- **Masking policy (Decision, owner-delegated, DEC-018; PR-34).** The snapshot command refuses a masked snapshot unless all three operator-entered sender fields are present and the tenant's masking-allowed flag is true (flag and column are Proposal mechanics, DATA-9 and DATA-10); the snapshot stores the true tenant identity and the pickup identity beside the printed sender (DATA-10); the label shown to the operator comes from the stored snapshot, and the shipment detail always shows the real pickup address. The tenant's accepted responsibility statement and the retention period are counsel items (T-048).

## TD-14 — Host routing, cookie helper and per-environment URLs
- Status: Proposed; hosts decided (DEC-015, PR-36); Observed router, `src/proxy.ts` and `src/lib/db/cookies.ts` built on the Node runtime (DEC-020, DEC-021, T-062, T-066); production cutover and enforced script CSP remain open (T-055)
- Owner: Engineering owner
- Source: DEC-015, DEC-005, DEC-020, DEC-021; CTX-41; PR-36; ARCH-6, TEN-6, SEC-6; TASKS T-042, T-062, T-066.
- Statement: A single server-side host router shall map each request's host to a route class (public, tenant, platform, webhook, internal) from per-environment configuration and answer any path outside its class with 404; one cookie helper shall set the session cookies (`gx_at`, `gx_rt`) and tenant selector (`ge_tenant`) with host-only attributes; and every link that leaves the application shall be built from configured per-environment URLs.
- Acceptance: A unit test over the host matrix shows each host serving only its class and 404 for the rest, including with a forged `Host` or `X-Forwarded-Host`; an end-to-end test shows an app-host cookie is not sent to the owner host; the hooks host strips cookies and answers only `/api/webhooks` and `/healthz`; invitation and marketing links come from configuration (`APP_ORIGIN`), not request headers.
- Constraints: ARCH-6, TEN-6, SEC-6, DEC-005, DEC-009, DEC-020, DEC-021; no per-tenant hostname.
- Evidence: Observed merged code: `src/lib/hosts.ts` holds the host table/route-family matrix, `src/proxy.ts` (renamed from `src/middleware.ts` in T-066, running on Node) answers wrong-host routes with 404 and rotates session cookies via `src/lib/db/refresh.ts`, and `src/lib/db/cookies.ts` (replacing `src/lib/supabase/cookies.ts` in T-066) enforces host-only attributes on `gx_at` and `gx_rt`. `infra/proxy/Caddyfile` maps the four public hosts; `infra/env/*.env.example` names their origins. The former Send Email Hook route (`/api/auth/send-email`) was removed in T-066. Cross-host Server Actions checks, DNS and production ACME TLS remain unproved.

| Route class | Routes (the same on the shared host; Observed in `src/lib/hosts.ts`) | Target host |
|---|---|---|
| Public | `/`, `/fitur`, `/simulasi`, `/cara-kerja`, `/hubungi-kami`, `robots.txt`, `sitemap.xml` | Apex (Decision) |
| Tenant | `/masuk`, `/akses`, `/pilih-gerai`, `/daftar`, `/daftar/kata-sandi`, `/daftar/gerai`, `/undangan`, `/pengiriman`, `/kontak`, `/pengaturan`, `/anggota`, `/api/mengantar/area` | App host (Decision) |
| Platform | `/admin`, `/admin/pengajuan`, `/admin/integrasi`, `/admin/akses`, `/admin/audit`, `/admin/diskon`, `/admin/tenant/[id]`, `/verifikasi-2fa` | Owner host (Decision) |
| Webhook | No webhook route exists yet; the prefix `/api/webhooks` is reserved on the hooks host (the former `/api/auth/send-email` route was removed by DEC-021 / T-066) | Separate cookie-less host (Decision); route not built (T-045) |
| Health | `/healthz` | Each host, including `internal.geraiexpress.local` (Decision, CTX-41 item 16, accepted 2026-10-28) |
| Internal scheduler | `/api/internal/cron/{dispatch,cleanup}` and `/healthz` | Observed: `internal.geraiexpress.local` only; not a public product host, denied by the proxy; cron requires `CRON_SECRET` |

Rules (Observed, 2026-10-29): `src/lib/hosts.ts` reads `Host`, not `X-Forwarded-Host`, and keeps explicit production/staging audiences. Loopback and `*.localhost` names require a non-production build or explicit local `HOST_SHARED_MODE=1`; `*.workers.dev` is no longer accepted. The internal cron audience is never included in shared mode. Wrong-host paths return a plain Bahasa 404, and session cookies (`gx_at`, `gx_rt`) have no `Domain`. Decision (DEC-020, DEC-021, owner): Caddy replaces the Worker edge; `client-address.ts` accepts only proxy-overwritten `X-Real-IP` with `TRUSTED_PROXY=1`; `src/middleware.ts` was migrated to `src/proxy.ts` on the Node.js runtime in T-066. Production ACME TLS is Unknown (ARCH-5).

## Owner decision trace

Observed: `docs/adr/ADR-0001-hybrid-hosting-egress-gateway.md` remains the historical hybrid design. Decision (DEC-020, owner, 2026-10-29) withdrew it before implementation. DECISIONS.md is the canonical index; this section is only the specification trace link.

| Decision | Designed in | ADR file |
|---|---|---|
| DEC-005 exact Next.js pins; adapter part withdrawn by DEC-020 | ARCH-1, DEL-2 | None |
| DEC-006 one seller per tenant | DATA-3, DATA-4, TEN-3 | None |
| DEC-010 machine dispatcher | TD-3, TD-12, SEC-7 | None |
| DEC-011 hybrid hosting, withdrawn by DEC-020 | Historical ADR-0001; current runtime in ARCH-2, ARCH-5, DEL-2 | ADR-0001 (`docs/adr/ADR-0001-hybrid-hosting-egress-gateway.md`), never built |
| DEC-012 and DEC-016 discount and pricing model | TD-9, DATA-9, BILL-3, UX-12 | None |
| DEC-013 deferred requirements | TD-2, TD-8, UX-8 | None |
| DEC-015 hosts | ARCH-6, TEN-6, SEC-6, TD-14, UX-11 | None |
| DEC-017 masking | TD-13, DATA-10, UX-9, UI-6 | None |
| DEC-020 self-hosted Node runtime (owner) | ARCH-1, ARCH-2, ARCH-5, ARCH-6, TD-3, TD-14, DEL-2, SEC-7, RATE-2 | No new ADR file; DECISIONS.md owns the decision |
| DEC-021 PostgreSQL + PostgREST + application-owned auth (owner) | ARCH-1, ARCH-3, SEC-5, SEC-7, IAM-8, DEL-2 | ADR-0002 (`docs/adr/ADR-0002-postgres-owned-auth.md`) |

### ADR-0001 — Hybrid hosting with a fixed-egress Mengantar gateway
- Status: Withdrawn by DEC-020 (owner, 2026-10-29); historical design only, never built
- Owner: Engineering owner
- Source: DEC-011, DEC-018, DEC-020; the full historical record is `docs/adr/ADR-0001-hybrid-hosting-egress-gateway.md` (trace link only; the ADR file is the canonical text).
- Statement: Historical design: a dedicated fixed-address gateway would have authenticated the Worker, held the Partner Secret and forwarded production Mengantar calls. Decision (DEC-020, owner) cancels that gateway; ARCH-5 now owns the Node-container deployment.
- Acceptance: Historical gateway failure-injection criteria are not current deployment gates. Current acceptance is ARCH-2/ARCH-5: Given an uncertain mutating outcome, When the Node dispatcher resumes, Then it reconciles the original operation without blindly repeating it.
- Constraints: ARCH-2, ARCH-5, NFR-5, SEC-3, TD-3, DEC-010.
- Evidence: Design only; the gateway task was cancelled by DEC-020 before implementation. No gateway deployment or test is claimed.
- Change history: 2026-10-28 — Added with the ADR. 2026-10-29 — Withdrawal recorded from DEC-020; no obsolete gateway task dependency remains.

### ADR-0002 — PostgreSQL with PostgREST and an application-owned auth module
- Status: Accepted by the owner (DEC-021, 2026-10-29); mechanics implemented locally in T-064..T-066 (uncommitted), pending T-067 independent security review and PostgreSQL backup/PITR release gates
- Owner: Engineering owner
- Source: DEC-021, DEC-020; the full text is `docs/adr/ADR-0002-postgres-owned-auth.md` (trace link only; the ADR file is the canonical text).
- Statement: Supabase is replaced by plain PostgreSQL 17 plus PostgREST and an auth module owned by the application (scrypt passwords, email OTP, rotating refresh tokens with server-held sessions, application TOTP for the Super Admin, HS256 JWTs verified by PostgREST); the SQL, RLS and RPC core is kept.
- Acceptance: Given the cutover is complete, When the database suite, unit suite and full browser suite run against the Compose stack, Then they pass without any Supabase component, and the ten security obligations of the ADR are each demonstrated by a test or a review finding.
- Constraints: ARCH-1, ARCH-3, SEC-5, SEC-7, IAM-8, DEL-2, DEC-007, DEC-010, DEC-020.
- Evidence: Observed on disk (uncommitted, T-064..T-066): `db/foundation/20261001000000_pg_foundation.sql`, `db/migrations/20261029100000_auth_core.sql`, `src/lib/auth/**`, `src/lib/db/**`, `src/proxy.ts`, `compose.yaml`, `compose.db.yaml`, `scripts/db-{common,migrate,up,down,verify}.sh`, `tests/db/auth-core.test.ts` and `tests/unit/auth-*.test.ts`. Verified locally by the lead (unit 47 files / 817 tests, DB 27 files / 410 tests, container smoke 9/9, Playwright across 390/768/1280 with 3 single-run flakes that passed on solo rerun; `STATUS.md`). T-067 independent security review and PostgreSQL backup/PITR release gates remain open. Inventories: `~/Documents/work/notes/geraiexpress-pg-migration/`.
- Change history: 2026-10-29 — Added with DEC-021; updated after T-064..T-066 local implementation.


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

Resolve verified identity (`currentUser()` in `src/lib/db/server.ts`, which verifies `gx_at` locally and checks `auth_session_live`), verified assurance (`aal2` on `auth.sessions` and the JWT) and current platform grant (`private.platform_capable`) before
loading platform projections. Browser selectors choose only a permitted explicit
scope; they cannot turn a tenant endpoint into a global query. Routine tenant
queries remain user-context RLS queries. If a platform helper needs privileged
SQL, use restricted grants, fixed schema/search path and parameterized allowlisted
operations; never an unrestricted service-role browser/server proxy. Prove its
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
- Statement: Registration shall use the application-owned authentication module (DEC-021, ADR-0002; formerly Supabase Auth) for inbox/session/password effects and transactional application commands for own onboarding, activation and invitation acceptance, with idempotent resumable transitions between these boundaries.
- Acceptance: Duplicate and interrupted requests converge on one intended application/membership, Auth/email failure leaves a recoverable state, stale review/invite requests fail safely, and no signup or review retry dispatches a provider operation.
- Constraints: DATA-7, TEN-5, IAM-8, SEC-5, ARCH-3, UX-7, UX-8, DEC-021; no cross-system atomicity claim or reference Auth-table migration.
- Evidence: Observed local implementation in `src/lib/auth/**`, `db/migrations/20261029100000_auth_core.sql`, `src/lib/registration-actions.ts` and `tests/db/{auth-core,registration,invitations}.test.ts` (T-064..T-066); T-067 independent security review remains open.
- Change history: 2026-10-13 — Added in the registration and documentation-completeness review. 2026-10-29 — Updated for DEC-021 (ADR-0002, T-065/T-066): application-owned auth module replaces Supabase Auth.

### Application-owned Auth and application command boundary

Under DEC-021 (ADR-0002, T-065/T-066; replacing the earlier GoTrue `signInWithOtp` /
`verifyOtp` / `updateUser` / `signInWithPassword` calls), email-first signup uses
`requestEmailCode` (`src/lib/auth/service.ts` -> `public.auth_issue_otp`, which runs
`private.before_user_created` and refuses anonymous requesters before any user or
code row exists), then `verifyEmailCode` (`public.auth_verify_otp`, opening a
server-held session in `auth.sessions`). The new user sets their password through
`setPassword` (`scrypt` hash in `src/lib/auth/password.ts`, stored by
`public.auth_set_password`, which also revokes all other sessions of that user);
routine password login uses `signInWithPassword` (`public.auth_user_for_login` +
`public.auth_record_password_login`). Do not accept a password before inbox proof.

The application renders a 6-digit Bahasa Indonesia code mail (`renderCodeMail` in
`src/lib/auth-mail.ts`, 10-minute TTL matching `auth_issue_otp`, 5 wrong attempts per
code, 20 per address per hour, 30-second resend cooldown). Application invitations
remain app-owned (`tenant_invitations`); their acceptance requires the verified
invited email, never an email-send receipt alone.

Before initial account completion, establish fresh inbox control. The `BEFORE UPDATE`
trigger `discard_pre_verification_password` on `auth.users` clears any pre-verification
password hash at first email confirmation, and `public.auth_set_password` requires an
active live session (`p_session_id`) of that user and revokes every other session of
the user (`db/migrations/20261029100000_auth_core.sql:258-281`). A previously completed
legitimate app account keeps its credentials and may resume using a newly verified code
session or password sign-in. Writable metadata is never used as completion authority.

Session liveness is server-held in `auth.sessions`: `currentUser()` (`src/lib/db/server.ts`)
and `resolveSession` (`src/lib/db/refresh.ts` on non-GET/HEAD requests) call
`public.auth_session_live`, and `public.auth_refresh_session` rotates `gx_rt` hashes
with reuse detection (10-second `recent_reuse` window for parallel tabs; older reuse
revokes the session). Deactivating or banning a user revokes all of their sessions by
trigger (`revoke_sessions_on_deactivation`).

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

Use the server-only session cookie helpers (`src/lib/db/cookies.ts`, `src/lib/db/session.ts`,
`src/proxy.ts`) with `Cache-Control: private, no-store` responses. The email-code path is
code-only (`src/lib/auth-mail.ts`) and uses no PKCE redirect link or callback URL, avoiding
cross-browser link-opening and open-redirect surfaces (ADR-0002 obligation 9).

### Registration verification plan — prospective, not executed

| Target | Required behavioral check before acceptance |
|---|---|
| Application-owned Auth (`src/lib/auth/**`) | New email, returning account, closed-registration gate, pre-registration password discard, code expiry/replay/attempt budget, refresh rotation/reuse detection and no attacker password/session access (`tests/db/auth-core.test.ts`, `tests/unit/auth-*.test.ts`; T-067 review open) |
| Application transaction | Concurrent/double-click submission, interruption before/after commit, duplicate open request, own resume and no incomplete tenant/admin/outlet bundle |
| Review | Verified-owner guard, current factor/capability, corrections/resubmission reflected in approved business fields, concurrent approve/reject, stale revision, lifecycle-bypass denial and audit/tenant outcome parity |
| Invitation | New/existing identity, wrong account/email, expired/revoked invite, changed role/issuer/outlet, existing-member conflict, concurrent acceptance, replay after membership removal and final-admin guard |
| Direct boundaries | Anonymous, Auth-only, pending, rejected, foreign, demo, suspended and revoked users cannot bypass server/Data API/RPC permissions |
| Full stack | Email → account → gerai → selected activation → explicit new/BYOK seller → capability readiness → first resi; provider outcomes tested under separate authorization |
| Browser | New/returning/invited user, mobile email paste/autofill, preserved form/errors, multi-tenant chooser, resume after expiry and no wrong-workspace flash at NFR-4 sizes |
| Mail/release | Local capture in Mailpit through direct app delivery (`src/lib/auth-mail.ts`, `src/lib/mail-transport.ts`; Send Email Hook removed in T-066); production provider/transport remains Proposal (unbuilt, T-063); quota/suppression/outage, correct template/expiry, no token/password in diagnostics |

No new implementation task queue is created while these requirements are
Proposed. Accepted requirements must acquire executable tests and one root
execution queue during project initialization; this table is not runtime evidence.
