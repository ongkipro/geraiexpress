# Mengantar Partner API — GeraiExpress Integration Breakdown

- Reviewed: 2026-10-13.
- Audience: GeraiExpress internal product and engineering team. The provider describes this as a private partner integration; this analysis is not for public publication.
- Primary contract: [Mengantar Partner documentation](https://sandbox.mengantar.com/docs/partner/).
- Related contract: [Mengantar Public API](https://sandbox.mengantar.com/docs/).
- Evidence: Unauthenticated documentation retrieval and offline checks only. No seller, credential, order, charge, or cloud resource was created.
- Product owner: [GeraiExpress PRD](../spec/02-PRD.md). This research explains the vendor contract; the numbered specification pack owns proposed product requirements.

## 1. Integration scope and account ownership

There are two integrations with different authority:

| Layer | Credentials | Functions | Local owner |
|---|---|---|---|
| Partner API | Platform Partner ID and Partner Secret | Register, list, retrieve keys, regenerate keys for partner-created sellers | Private platform control plane |
| Public API | One seller's API key | Rates, orders, status, balance; other capabilities subject to permissions | Account-bound shipping operations |

The four Partner routes are all POST with JSON, including listing and key retrieval. They do not replace Public API shipment endpoints. Registered sellers own their Mengantar accounts, orders, balance, COD funds, and applicable rates. Possession of their API key grants API access, not their password or dashboard login. [Scope](https://sandbox.mengantar.com/docs/partner/#content-get-started), [Public API usage](https://sandbox.mengantar.com/docs/partner/#content-use-api-key).

**GeraiExpress recommendation:** create one seller for each independently owned tenant business, with an explicitly identified account owner. Multiple outlets under that business may share the seller through verified pickup mappings. Staff users are memberships; sender/recipient customers are contacts. Neither should automatically become Mengantar sellers. A tenant UUID is therefore a better `externalUserId` basis than a staff user ID. Confirm business-owner/cardinality policy before provisioning real accounts.

Existing Mengantar users need a separate bring-your-own-key (BYOK) connection. A centrally funded platform seller is a separate commercial model and is not the default proposed here. Never silently fall back to another seller or balance.

## 2. Environments, access, and production networking

| Item | Documentary evidence | GeraiExpress action |
|---|---|---|
| Sandbox origin | The supplied page runs at `https://sandbox.mengantar.com`; its documentation script fills base URL from `window.location.origin` | Configure a sandbox-only origin and keep keys/accounts environment-separated |
| API prefix | `/api/partner/v1` | Sign the exact endpoint path |
| Production origin | Not established by this sandbox page | Obtain it from Mengantar; do not infer it from the Public API host |
| Partnership | Approved agreement required | Confirm partner enablement and contractual account-owner mapping |
| Partner ID | Assigned identifier; not a secret | Exact `partner-id` header |
| Partner Secret | Issued through agreed channel; provider-managed replacement | Worker secret binding; no browser/database-public projection |
| Source IP | Production allowlist always enforced; sandbox may relax it | Verify egress and failover before production enablement |

An ordinary Cloudflare Worker deployment does not establish the required dedicated egress identity. A candidate entirely within Cloudflare is Workers VPC's `cf1:network` binding → Gateway egress policy → dedicated approved egress addresses. [Workers Gateway routing](https://developers.cloudflare.com/changelog/post/2026-06-05-gateway-egress/), [VPC network configuration](https://developers.cloudflare.com/workers-vpc/configuration/vpc-networks/).

Dedicated Gateway egress IPs require a **Zero Trust Enterprise add-on**. Documented allocation starts with two addresses in two cities, and failover policy can choose shared egress if configured that way. Obtain plan/availability confirmation, register every selected IPv4/IPv6 primary and failover address with Mengantar, and test the actual Worker path. Use no direct-fetch fallback for Partner calls. This is a proposed composition, not a provisioned or tested network. [Dedicated egress requirements](https://developers.cloudflare.com/cloudflare-one/traffic-controls/egress-policies/dedicated-egress-ips/).

Supabase Edge Functions also do not supply static egress IPs; moving the signer there does not remove this gate. If the Cloudflare plan is unavailable, production Partner provisioning remains gated pending a provider-approved arrangement. [Supabase egress limitation](https://supabase.com/docs/guides/troubleshooting/why-supabase-edge-functions-cannot-provide-static-egress-ips-for-whitelisting-3d78b0).

## 3. Authentication and exact-byte signing

[Authentication contract](https://sandbox.mengantar.com/docs/partner/#content-authentication).

| Header | Value |
|---|---|
| `Content-Type` | `application/json` |
| `partner-id` | Assigned Partner ID |
| `timestamp` | Unix seconds as a string, within five minutes of provider time |
| `signature` | Lowercase hexadecimal SHA-256 digest |

```text
SHA256(METHOD + ":" + PATH + ":" + TYPE + ":" + BODY + ":" + TIMESTAMP + ":" + PARTNER_SECRET)
```

| Signed part | Required representation |
|---|---|
| METHOD | Uppercase `POST` |
| PATH | Full `/api/partner/v1/...`; no host, query, or trailing slash |
| TYPE | Body `type`, otherwise empty; none of these four routes uses it |
| BODY | Exact UTF-8 JSON bytes sent |
| TIMESTAMP | Same string as the header; seconds, not milliseconds |
| PARTNER_SECRET | Secret appended to preimage; never transmitted |

Serialize once, sign that string, and send the same string. Empty TYPE produces a double colon immediately after PATH. Changing whitespace, object order, escaping, endpoint, or timestamp changes the signature. This is a plain SHA-256 construction specified by Mengantar, **not HMAC**. Its webhook protocol is separate: HMAC-SHA256 over its documented timestamp/raw-body input, with different headers and timestamp units.

Regenerate timestamp/signature for each attempt. The documentation describes per-call signatures but does not specify a nonce or replay-cache/idempotency contract. Do not derive an exactly-once guarantee from authentication or retry key regeneration blindly.

The following standalone Node check uses public synthetic values and performs no HTTP request. Save the fenced block as `partner-signing-check.mjs` and run `node partner-signing-check.mjs`:

```javascript
import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';

const body = JSON.stringify({ sellerId: 'fixture-seller' });
const path = '/api/partner/v1/sellers/api-key';
const timestamp = '1758790800'; // fixed offline fixture, never send it
const fixtureSecret = 'offline-fixture-only';
const preimage = `POST:${path}::${body}:${timestamp}:${fixtureSecret}`;
const expected = '6ad3b743496bb5ed0c03b7696d8b4f8504ec04ef29b48f33637195c7ba794a5a';
const sha = value => createHash('sha256').update(value, 'utf8').digest('hex');
const webDigest = await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(preimage));
const webHex = Array.from(new Uint8Array(webDigest), b => b.toString(16).padStart(2, '0')).join('');
assert.equal(sha(preimage), expected);
assert.equal(webHex, expected);
for (const changed of [
  preimage.replace(path, `${path}/regenerate`),
  preimage.replace(body, '{ "sellerId": "fixture-seller" }'),
  preimage.replace(timestamp, `${timestamp}000`),
  preimage.replace('POST:', 'GET:'),
  preimage.replace('::', ':'),
]) assert.notEqual(sha(changed), expected);
console.log('PASS: 2 digest parity checks and 5 signature-binding negatives; offline only');
```

Production code must also allowlist the configured host and four operations, reject arbitrary signer inputs/redirects, bound request/response sizes, protect the preimage, and authorize the local tenant operation before signing. The example is a protocol check, not a production client.

## 4. Register seller

**POST `/api/partner/v1/sellers`**. [Contract](https://sandbox.mengantar.com/docs/partner/#content-register-seller).

| JSON field | Type | Validation |
|---|---|---|
| `name` | String, required | At most 100 characters; letters, numbers, spaces, apostrophe, hyphen, underscore, dot, `@` |
| `email` | String, required | Valid, readable real owner email; not already a Mengantar account |
| `phone` | String, required | Indonesian mobile prefix `08`, `62`, or `+62`; 10–15 digits; spaces/dashes/brackets ignored |
| `externalUserId` | String, required | Stable application identifier, at most 128 characters |
| `password` | Forbidden | Provider returns `PASSWORD_NOT_ALLOWED` |

The precise Unicode interpretation of allowed name characters is not documented. Do not invent an ASCII-only validation rule. Generic international phone normalization from LegacyReference is insufficient for this endpoint's Indonesian-specific constraints.

| Outcome | Response contract | Local handling |
|---|---|---|
| New registration | HTTP 201; `success: true`, `alreadyRegistered: false`, `data: {sellerId, email, apiKey}` | Persist seller binding and encrypted key before readiness |
| Existing external ID | HTTP 200; same shape, `alreadyRegistered: true`; same seller, **current** key | Recover the original operation; not an owner/profile-update API |
| Disabled key on repeat | `data.apiKey: null` | Mark blocked; no automatic enablement or rotation |
| Partial provisioning | HTTP 503 `KEY_PROVISIONING_FAILED`; response carries `sellerId` | Preserve ID and retry the identical external ID/input; do not create a new identity |
| Existing email | HTTP 409 `EMAIL_ALREADY_REGISTERED` | Offer BYOK; no account takeover or ownership reassignment |

Proposed external ID: `geraiexpress:tenant:<immutable-uuid>`, generated by the backend and stored before dispatch. Keep sandbox/production mappings separate. Repeated registration remains recoverable even after the daily creation quota is exhausted. Do not change external IDs after a timeout or assume repeated registration edits name/email/phone.

Recommended local progression: `not_connected` → `consent_recorded` → `registration_pending` → `registered_key_pending` or `registration_unknown` → `connected`; explicit `existing_account_required`, `quota_wait`, `provider_restricted`, and `configuration_blocked` branches. A journal, unique binding, guarded transitions, and recoverable persistence bridge the database/provider transaction gap. `connected` only proves a stored key/binding; shipping, sender, label, and webhook readiness are separate checks.

## 5. List partner-created sellers

**POST `/api/partner/v1/sellers/list`**. [Contract](https://sandbox.mengantar.com/docs/partner/#content-list-sellers).

| Body field | Contract |
|---|---|
| `page` | Optional positive integer; default 1 |
| `size` | Optional positive integer; default 50, maximum 200 |
| `externalUserId` | Optional nonempty string filter |

HTTP 200 success returns `data.sellers`, `page`, `size`, `total`, and `totalPages`. Seller entries contain `sellerId`, `externalUserId`, `name`, `email`, `phone`, `registeredAt`, and `active`; newest first. No API keys are included. `active: false` means provider-disabled/banned account; its key and shipping stop.

Use the external-ID filter for onboarding reconciliation; bounded pagination for platform reconciliation. Tenant screens receive their mapped status projection, never the partner-wide result. Pagination while new sellers arrive need not be a snapshot; reconciliation must tolerate duplicates/changes. Provider account restriction, local tenant suspension, and Partner access restriction are distinct states.

## 6. Get current seller key

**POST `/api/partner/v1/sellers/api-key`**, body `{ "sellerId": "..." }`, required string. [Contract](https://sandbox.mengantar.com/docs/partner/#content-get-api-key).

HTTP 200 success returns `data: {sellerId, apiKey}`. The operation creates a key if absent, so it is not a harmless read. It can refresh a stale local key after the seller independently regenerates it. Authorize/audit it as a credential operation and persist the encrypted result with a new credential version.

| Refusal | Interpretation |
|---|---|
| 404 `SELLER_NOT_FOUND` | Nonexistent or outside this partner's registered sellers; deliberately indistinguishable |
| 403 `SELLER_DEACTIVATED` | Seller disabled; no returned/created key |
| 403 `API_KEY_DISABLED` | Deliberate key restriction; retrieval does not reactivate it |

A BYOK connection is outside this management authority. Never try this route as a discovery oracle for existing accounts. This response does not contain a webhook callback secret.

## 7. Regenerate seller key and callback secret

**POST `/api/partner/v1/sellers/api-key/regenerate`**, same required `sellerId` body. [Contract](https://sandbox.mengantar.com/docs/partner/#content-regenerate-api-key).

HTTP 200 success returns `data: {sellerId, apiKey, callbackSecret}`. Old key validity ends immediately. If the seller has a configured Webhook URL, its webhook secret rotates as well; otherwise `callbackSecret` is null. The same seller ownership/restriction errors as key retrieval apply, without rotation on those refusals.

GeraiExpress must coordinate at the actual seller account, fence new work, record rotation intent, and store both returned secrets/version changes atomically in private storage. Already-dispatched operations may have uncertain outcomes and must reconcile their original order rather than repeat it.

**Lost rotation response:** pause affected dispatch and reconcile the current key with the retrieval endpoint. Do not issue another rotation automatically. That recovery cannot recover a lost callback secret from the documented retrieval response. Keep webhook ingestion unavailable until the correct secret is obtained through an agreed seller/provider recovery procedure; use authorized status polling where available. Do not accept forged callbacks or retain an old secret indefinitely to conceal desynchronization.

Seller-initiated regeneration has the same callback implications. API-key recovery does not establish webhook readiness. Provider-managed Partner Secret replacement is a different operation, obtained from Mengantar, and is not one of these routes.

## 8. Limits, retries, and the complete error taxonomy

[Limits](https://sandbox.mengantar.com/docs/partner/#content-authentication), [errors](https://sandbox.mengantar.com/docs/partner/#content-errors).

| Limit | Initial documented value | Scheduling scope |
|---|---|---|
| Requests | 60/minute, fixed window | Entire partner across all Workers/instances |
| New registrations | 1,000/day | Entire partner; reset midnight Asia/Jakarta |
| Response hints | `Retry-After` seconds, `RateLimit`, `RateLimit-Policy` | Honor provider retry timing; agreement may raise quotas |

Use a durable partner-wide scheduler, independent from per-seller shipping/label coordination. Do not multiply quota by tenant or isolate counters in each Worker. Repeated known registration is exempt from the exhausted new-registration quota, not from request-rate scheduling.

Error envelope: `{success: false, code, message, field?}`. Branch on `code`, sanitize/map messages, and avoid logging sensitive request/response bodies.

| HTTP | Code | Recovery classification |
|---|---|---|
| 400 | `MISSING_FIELDS` | Correct required input |
| 400 | `PASSWORD_NOT_ALLOWED` | Remove password; never request one |
| 400 | `INVALID_NAME` | Correct allowed characters/length |
| 400 | `INVALID_EMAIL` | Correct readable email |
| 400 | `INVALID_PHONE` | Correct Indonesian mobile format |
| 400 | `INVALID_EXTERNAL_USER_ID` | Correct stable ID/filter type or bounds |
| 400 | `PHONE_NOT_ALLOWED` | Owner correction or provider support; no unchanged retry loop |
| 400 | `INVALID_PAGINATION` | Positive integers and size ≤200 |
| 401 | `INVALID_TIMESTAMP` | Check seconds/clock; regenerate signed request |
| 401 | `UNAUTHORIZED` | Check assigned ID/signing configuration; no credential dump |
| 403 | `IP_NOT_ALLOWED` | Fix approved egress/allowlist; no bypass |
| 403 | `PARTNER_DEACTIVATED` | Stop Partner retries and contact provider; existing sellers may keep working |
| 403 | `SELLER_DEACTIVATED` | Stop affected seller work; provider review |
| 403 | `API_KEY_DISABLED` | Stop affected key work; do not recreate/reactivate |
| 404 | `SELLER_NOT_FOUND` | Correct own binding; no existence enumeration |
| 409 | `EMAIL_ALREADY_REGISTERED` | Route to existing-account BYOK |
| 429 | `RATE_LIMITED` | Respect `Retry-After`; bounded scheduled retry |
| 429 | `DAILY_REGISTRATION_LIMIT` | Defer new creation until WIB reset/agreed increase |
| 503 | `KEY_PROVISIONING_FAILED` | Resume same registration identity/input |
| 500 | `INTERNAL_ERROR` | Bounded backoff and operation-specific reconciliation; rotation is not blindly repeatable |

Transport timeout, malformed/oversized response, and persistence failure are local integration failures, not invented Mengantar error codes. Preserve outcome uncertainty. Persist next attempt time, safe code, operation reference, and attempt count; never spin or announce completion before durable persistence.

## 9. Seller access, existing accounts, and agreement

[First sign-in](https://sandbox.mengantar.com/docs/partner/#content-seller-sign-in), [existing users](https://sandbox.mengantar.com/docs/partner/#content-existing-seller), [partner responsibilities](https://sandbox.mengantar.com/docs/partner/#content-obligations).

| Journey | Required product behavior |
|---|---|
| New seller | Name the real account owner, readable email, and account/balance relationship; capture affirmative agreement before provider creation |
| First seller login | Explain Mengantar's `Lupa Password` flow using the registered email; GeraiExpress never knows or sets the password |
| Existing seller | Owner signs in to Mengantar → account settings/Public API integration → creates/copies own key → submits through protected GeraiExpress connection form |
| Withdrawal/settings | Explain provider-managed email/phone verification and bank-change identity/approval requirements; do not promise automatic payouts |
| Restriction | Separate seller restriction from platform/Partner restriction and route to the appropriate support path |

Terms and Privacy agreement must refer to the actual provider documents. Their exact URLs/version identifiers are not given on the reviewed page; obtain and version them before enabling real registration. Store accepted document versions/digests, account-owner identity/email, authenticated actor, tenant, and accepted time, with a selected retention policy. A stored contact or Supabase signup consent is not this agreement.

No Partner webhook or webhook-URL provisioning endpoint exists in the documented set. Seller setup in Mengantar is manual. Use Public API status polling as the initial tracking baseline; enable per-seller webhooks only after URL/secret configuration and signed delivery are verified. Standard key permissions explicitly cover order, status, fee, and balance; Dropshipper enablement and PDF `labelGeneration` access remain separate gates.

## 10. Integration into GeraiExpress

| Concern | Proposed contract owner | Improvement over copying LegacyReference |
|---|---|---|
| Tenant seller onboarding / existing key | PR-17, PR-18; UX-2 | Clear business-owner mapping and distinct management authority |
| Safe key/callback lifecycle | PR-19, TD-8, SEC-3 | Durable rotation, encrypted versions, lost-response recovery |
| Required agreement / owner access | PR-20, PRIV-2 | Explicit consent and accessible real account |
| Production egress / quotas | NFR-5, ARCH-2, TD-7 | Production network gate and platform-wide scheduling |
| Provider identity / isolation | DATA-4, TEN-3, IAM-3 | Partner-global access never becomes tenant-global access |
| Visual presentation | UI-1, UI-2, UI-3 | User-selected shadcn/ui with Apple-inspired tokens; operational state coverage |

Cloudflare hosts the application, provider transport, coordination, and conditional Gateway egress. Supabase owns Auth and PostgreSQL data/RLS/private credential records. Mengantar owns shipping and seller funds. This preserves the requested Cloudflare + Supabase infrastructure while explicitly accounting for the external shipping provider and Enterprise egress dependency.

## 11. Verification gates and unresolved provider questions

Prospective implementation checks:

1. Signing: independent digest parity, exact-body/path binding, Unix-second validation, no arbitrary signing endpoint.
2. Onboarding: concurrent confirmation, timeout after seller creation, 503 partial provisioning, current-key replay, null key, daily-cap recovery, and existing-email BYOK routing.
3. Isolation: same-tenant success plus foreign tenant seller/list/key/rotation denial through Worker and direct database/RPC surfaces; customer contact cannot provision a seller.
4. Lifecycle: rotate during queued/in-flight order; lost response; callback secret null/non-null; seller-initiated changes; no automatic repeat create/rotate.
5. Networking: real Worker primary/failover egress accepted by provider, fail-closed behavior, and no credentials/PII in Worker/Gateway telemetry.
6. Shipping: independent Public API sender-versus-pickup and provider PDF permission/label proof; polling and signed webhook share an account-scoped transition applicator.
7. Browser: new/existing onboarding, disclosure/agreement, errors without input loss, stale membership denial, and secret-free readiness display.

Still required from Mengantar: production origin and enabled environments; agreement/account-owner mapping; exact Terms/Privacy links and versions; production allowed egress families; negotiated quotas; enabled Public API permissions; sender/PDF capability; callback-secret recovery after lost rotation; current webhook retries/freshness. Key formats and Mongo-like example IDs are not a stable validation contract.

Documentation coverage: all eleven Partner sections reviewed — get started, authentication, register seller, list sellers, get API key, regenerate API key, use API key, seller sign-in, existing seller, obligations, errors. Raw Partner HTML SHA-256: `7b4f501acc40560893b7048694072d85e496b42c8af4dfe4c7dd10d7c605eaaa`; source records reside in the specification pack's `sources.json`. Raw hashes identify retrieved bytes; vendor contract changes require semantic review.

### Executed verification

Executed the embedded signer fixture with Node: PASS, two digest comparisons and five signature-binding negatives. The specification structural check passed with 12 Markdown files, 75 declarations, zero findings; independent document checks covered four paths, all 20 error codes, unique source records, and local links. Token contrast was also calculated offline. See the context record for scope and results. These checks do not establish provider acceptance, fixed egress, database security, browser accessibility, or a running application; no live API/deployment evidence is claimed.

### Sandbox evidence (T-020, 2026-10-14)

Owner supplied Partner ID `ongkirich` (not a secret) and the sandbox Partner Secret (secrets
store only) and approved registering one sandbox seller. Client: `src/lib/mengantar/partner-api.ts`
(list, register, get key; sandbox origin only; regeneration not built). Unit tests reproduce the
offline vector above (`6ad3b743…`) through WebCrypto.

| Step | Result |
|---|---|
| `sellers/list` `{externalUserId}` before | 200, `total: 0`; calls from the development machine accepted (sandbox does not enforce the IP list) |
| `sellers` register (`externalUserId geraiexpress:sandbox:proof-seller-1`) | 201, `alreadyRegistered: false`, seller `6acf4420b93360b458b2d7ba`, key `API-` + 16 characters |
| Same register again | 200, `alreadyRegistered: true`, same seller, same key (idempotency confirmed) |
| `sellers/api-key` | 200, same key (no rotation) |
| `sellers/list` after | 200, one seller, `active: true`; list entries also carry name/email/phone, which the client discards |
| Public API with that key | area search and estimate pass (`pnpm test:contract` on the sandbox) |

The seller key is stored as `GERAIEXPRESS_MENGANTAR_SANDBOX_SELLER_KEY`. The sandbox returned
Cloudflare 502 pages for whole minutes twice the same afternoon; non-JSON 5xx answers map to
`unavailable`, and registration is safe to repeat with the same external ID.
