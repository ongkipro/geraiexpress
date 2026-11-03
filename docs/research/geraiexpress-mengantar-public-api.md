# Mengantar Public API — read-only contract evidence (T-019)

- Contract: [Mengantar Public API](https://sandbox.mengantar.com/docs/) (`SRC-MENGANTAR-SANDBOX-PUBLIC`;
  page fetched 2026-10-14, 204557 bytes, SHA-256 `00db72a0d9f94caeb6106e1d06b43f23f0e99ea8c3daa40cb866bb2799fb03f8`; the registry entry's earlier hash differs,
  so the page changed since it was recorded).
- Evidence date: 2026-10-14. Owner-approved **read-only** calls against production with the owner's own
  seller key (account of the owner's counter "Permata Mall Store", Depok). No order was created, paid,
  edited or deleted.
- Client: `src/lib/mengantar/public-api.ts`. Fixtures: `tests/unit/fixtures/mengantar/` (sanitized
  production responses: area records and tariffs only, no pickup contacts, phones or emails).
- Fixtures cover COD and non-COD `courier=all` responses.
- Checks: `pnpm test:unit` (fixture/mutation-checked parser and transport rules) and
  `pnpm test:contract` (live, read-only, skipped without a key; see the test header for the invocation).

## Findings

| Topic | Observed | Consequence |
|---|---|---|
| Authentication | The seller API key is a URL path segment: `{BASE_URL}/api/public/{API_KEY}/...` | A request URL is a secret: never log, throw, return or trace it |
| Production origin | `https://api-public.mengantar.com` answered 200 from the development machine (no allowlisting requested) | Read calls do not need dedicated egress; the Partner API still does (Partner research §2) |
| Sandbox origin | `https://sandbox.mengantar.com` answered **403 `Not allowed`** to every key tried in T-019 (the Partner Secret and invented keys), including on `/address/search`; a Partner-registered seller key works there (T-020) | The 43-character sandbox value is the **Partner Secret** (owner, 2026-10-14), not a Public key, so the Public API rightly refused it. Sandbox Public calls need a seller key (from a Partner-registered seller or the sandbox app) |
| Partner API | With Partner ID `ongkirich` (not a secret per Mengantar) and the Partner Secret, sandbox `POST /api/partner/v1/sellers/list` `{}` answered 200 `{sellers: [], page 1, size 50, total 0}` from the development machine. (An earlier attempt with the production key as Partner ID got 401.) | Partner signing (§3 of the Partner research) is proven on the sandbox; seller registration is the next, owner-approved step |
| Area search | Despite the docs ("any string"), production answers 403 for an invalid key here too. `GET /address/search?keyword=` returns matching area records (`_id` 24-hex, province/city/district/subdistrict/zip plus courier-specific codes); an unknown keyword returns `success:true, data:[]` | Origin and destination are provider area ids, not free-text addresses: outlets and recipient addresses need a stored area id before a live quote |
| Estimate shape | `courier=all` returns an object keyed by service: `JNE, JNECargo, SiCepat, SiCepatCargo, SAP, SAPLite, SapCargo, iDexpress, JT, lion, iDexpressCargo, anteraja, spx, pos`. A single courier returns one flat object | The client always asks for `all` and reads only keyed rows |
| Unknown area | `success:false, data:0` (HTTP 200) | Mapped to `rejected` |
| Prices | `price` = normal tariff; `codFee` = COD service fee (4994 for `COD_AMOUNT=150000`); `estimatedPrice = price + codFee`; `estimatedSpecialPrice` = after the account's volume discount, including the COD fee | Counter/resi show `price` (+ COD fee); administrator net cost = `estimatedSpecialPrice − codFee` (UX contract line 187) |
| Coverage | `unsupported: true` = no service; `unsupported_cod: true` or `coverage_cod: false` = no COD | Dropped rows, never guessed |
| Inconsistent rows | `SiCepatCargo` reuses SiCepat's totals; `SAPLite` to Merauke has `estimatedPrice` below `price`; cargo/lite keys are not documented `courier` values | Only documented courier values are offered (JNE, SiCepat, Sap, iDexpress, JT, lion, anteraja, spx, pos); a row is dropped when `estimatedPrice ≠ price + codFee` or the net cost exceeds the tariff |
| ETA | `estimate_delivery` (e.g. `1 - 2 days`, `4 HARI`) is sometimes `"undefined"` or `-`; `estimatedDate` is a generic `2-4 hari` | `etaText` is null when absent, `"undefined"` or `-` |
| SiCepat coverage | SiCepat rows also carry `unsupportedPickup` and `unsupportedOriginSicepat` | Either flag `true` drops the row |
| Redirects | workerd rejects `redirect: "error"` (only `follow`/`manual`) | The client uses `manual` and treats any 3xx as `unavailable`; verified in local workerd (`wrangler dev`) with an invalid key: both calls reached Mengantar and returned `not_allowed` |
| Ninja | Discontinued 1 September 2026; no longer returned | Not in the courier allowlist |

## Not yet proven (needs separate approval or provider action)

- Create order, pay-unpaid, label generation, delete, webhook: write operations; sandbox access first
  (ask Mengantar to enable the sandbox for the development and Worker egress addresses).
- Weight rounding: the request sends kilograms with decimals (`weight=1.5` was accepted and echoed).
  Update 2026-11-02 (help 5387484 updated 2026-10-19, lane D, `docs/research/evidence/2026-11-02/lane-d-mengantar-current.md`): volumetric weight is (L×W×H)/6000
  for regular service, JNE regular /4000, cargo /6000 except IDX Kargo /4000; the courier bills the
  heavier of actual and volumetric; a decimal part up to 0.30 kg rounds down (1.30 kg → 1 kg, 1.31 kg
  → 2 kg; Lion 0.31 kg). The API accepts only `weight` in kg, so the billable weight is computed
  locally (T-080). Unknown: whether the estimate applies the rounding to a decimal `weight` itself.
- COD fee formula: Update 2026-11-02 (help 5109167, lane D): 3% of the COD amount with no minimum,
  plus 11% VAT on the fee; 150,000 × 3% × 1.11 = 4,995 matches the observed `COD_FEE 4995`.

## Sandbox write-path evidence (T-020, 2026-10-14)

Owner-approved, sandbox only, with the Partner-registered seller's key
(`GERAIEXPRESS_MENGANTAR_SANDBOX_SELLER_KEY`). Synthetic recipient; no real goods.

| Step | Result | Consequence for the order adapter |
|---|---|---|
| `POST /address` (pickup in Jakarta Selatan, Melawai) | 200, address `6acf44a4771fe2b474c055ca` | Outlet pickup addresses are provider records keyed by an area id |
| `GET /time` | 200, `data: []` | No scheduled-pickup slots offered to this account; drop-off is the working mode |
| Estimate `courier=all` (sandbox) | JNE `price: 0, unsupported: true`; other couriers synthetic prices | The parser already drops JNE here; sandbox prices prove shape only |
| Create order, JNE drop-off | **HTTP 200 `success: true`**, but the item has `status: "error"`, `error: "{}"`, no `ORDER_ID`, `estimatedPrice: 0`, `isPreviouslyError: true` | Success of the envelope is not success of the order: the adapter must judge every item (`status`, `ORDER_ID`, `cnote_no`, `error`) |
| Create order, anteraja drop-off | 400 `Ekspedisi Anteraja tidak mendukung pengiriman Drop Off` | Drop-off support is per courier; offer only couriers valid for the outlet's pickup mode |
| Create order, JT drop-off | 200, `ORDER_ID 261014LJ9GP7`, `cnote_no JO6844983511`, `isPaid: true`, `status: active`, `estimatedPrice: 93000`, batch `26101416Q0L7LJ` | First successful issuance; `cnote_no` is the resi |
| `GET /order` | 200, array including the order | Read-back by `ORDER_ID` works for reconciliation |
| `POST /order/simulation` ON DELIVERY, then DELIVERED | 200 each, `previousStatusCategory` chained `active → ON DELIVERY → DELIVERED`, tracking history returned | Deterministic status tests are possible on the sandbox |
| `POST /label-generation` | 403 `Not allowed` | Label PDF needs Mengantar to whitelist the account; GeraiExpress keeps its own label until then |

Not covered: pay-unpaid (orders were paid at creation), COD orders (covered in T-021 below), webhooks (need a public URL
and the seller's callback secret), cancellation/deletion.

## Order adapter evidence (T-021, 2026-10-14)

Client methods `createOrder`, `findOrder`, `findOrdersByReference` in `src/lib/mengantar/public-api.ts`;
fixtures `order-*.json` (sandbox, phones/emails/user records removed).

| Finding | Evidence | Adapter rule |
|---|---|---|
| No idempotency key on create-order | Contract has none | Every request carries a GeraiExpress reference `GE-…` as `destinationMark`; an unclear answer is `unknown_outcome` and is reconciled, never retried |
| `destinationMark` round-trips | Create echoed `GE-T021-MV7W5HXB`; `GET /order?order_id=` returned it | The item must echo our reference, otherwise the outcome is unknown |
| `GET /order?dateRange=…` does not filter; `count`/`total` are always 0 | JSON form (as documented) returned `[]`; dotted `dateRange.startDate/endDate` was ignored; every list answer had `count: 0, total: 0` | Reconcile by scanning pages per courier until a row predates the attempt by more than a 10-minute skew margin or a page is empty; rows out of order, or a scan that cannot reach the attempt time, are `unknown_outcome`, not "not found" |
| Order list paging | `size=2` pages returned 2, 2, then `[]`, newest-first by `createdAt`; `size=500` returned all 4 rows; `courier=JNE` returned only the JNE error row, `courier=Sap` none | The scan relies on this ordering and checks it on every page |
| `batch` filter takes the batch **code** | `batch=26101416Q0L7LJ` found the order; the documented batch `_id` returned `[]` | Store the batch code |
| `order_id` filter | Exact single order; unknown id → `success:true, data:[]` | `findOrder` returns null for none, malformed for duplicates |
| COD create | `COD: 150000` (JT drop-off) issued `2610142JG95B` / `JO6948371799` without balance; stored `COD_AMOUNT 150000`, `GOODS_AMOUNT 150000`, `COD_FEE 4995`, `estimatedPrice 97994` (= estimate tariff 93000 + COD fee) | `codAmount` is the total collected from the recipient (provider definition: goods + shipping + COD fee) |
| Create refusals | Only a plain 400 was observed (anteraja drop-off) | Only 400 `success:false` without a data array is `rejected`; any other 4xx (409/422/429 …) is `unknown_outcome` |
| Error item | JNE item `status: error` still has `_id`, `batch` and `isPaid: true` | `failed` carries the batch and record id; the dispatcher confirms the batch still holds only an error item before creating again |
| Insufficient balance | Second JT order: `isPaid:false`, `cnote_no:null`, `ORDER_ID` and batch present | `unpaid` outcome; payment is the batch command (TD-3), not a new create |
| Live adapter run (sandbox) | anteraja drop-off → `rejected` with provider text; JT → `unpaid 261014LKLL3E`; `findOrder` and `findOrdersByReference` both returned it; unknown reference → `[]` | — |

Sandbox residue on the sandbox seller: one paid JT order (simulated DELIVERED), one paid COD JT order, two unpaid JT orders, and one JNE error item that carries `isPaid: true`.

Not established: whether the live estimate applies the published billable-weight rounding to a decimal `weight` (rule: help 5387484, see above); whether an error item can later be completed.

## Cargo follow-up — public contract and read-only probes (2026-11-03, T-080)

Owner requested cargo analysis, external research, API study, then implementation. This section supersedes the **cargo-specific interpretation** in the older findings table; it does not rewrite the historical T-019 observations or authorize account/secret access. The regular-service integration remains verified separately.

### Sources and method

- Fresh official production and sandbox Public API documentation: `https://api-public.mengantar.com/docs/` and `https://sandbox.mengantar.com/docs/`. Their extracted text matched on this retrieval. This is documentation retrieval, not authenticated sandbox execution.
- Official courier help `5502313`, updated **2026-09-24**, explicitly distinguishes cargo minima and maxima; SAP alone has the detailed regional minimum table.
- Secondary cross-check: `ongkipro/mengantar-documentation` at `d97821c112e60661f0fdf01780fa0e1b4d37884c`. Its cargo order mapping agrees with official docs. Its generic 100 kg cargo maximum and universal 1 kg clamp are **not** adopted: current primary sources are more specific and the regular sub-kg contract must not regress.
- Four unauthenticated, read-only GETs against the documented public tariff endpoints, using the provider documentation's example area pair: 3PL at 1 and 10 kg; public tariff at 10 kg without COD and with `COD_AMOUNT=100000`. All four JSON envelopes reported `success: true`. The fetch tool did not expose a numeric HTTP status, so none is asserted. No credentials, seller/account records, orders, payment, customer data or provider write was used.
- Exact URLs, raw JSON, quoted official passages and limitations: [cargo evidence](evidence/2026-11-03/mengantar-cargo/sources.json), with file hashes in that directory's `manifest.json`.

### Confirmed cargo identity and constraints

Cargo is **not** a different create-order courier code. The official body table documents `orders[].cargo: true` while the top-level courier stays the base courier:

| Estimate response key | Create courier | Order flag | Sampled route API minimum | Help-page package maximum |
|---|---|---|---|---|
| `JNECargo` | `JNE` | `orders[].cargo: true` | 10 kg | 30 kg |
| `SiCepatCargo` | `SiCepat` | same | 10 kg | 50 kg |
| `SapCargo` | `Sap` | same | 5 kg for the sampled route | Not established by this help section |
| `iDexpressCargo` | `iDexpress` | same | 10 kg | 70 kg |

The older cargo range arrays `[10,30]`, `[10,50]` and `[10,70]` must **not** be treated as regional minimum ranges: the freshly quoted help text calls these minimum/maximum pairs. Preserve the earlier migration as history and correct configuration through a new version/forward migration, not by rewriting it. SAP minima do vary by route (5/10/50/100 kg in the help table); a universal SAP minimum or maximum is not justified.

The 3PL response exposes route-specific `minimumWeightCargo`. For the sampled route, 1 kg and 10 kg requests both returned JNE cargo Rp45,000, SiCepat cargo Rp35,000 and IDX cargo Rp30,000; SAP returned Rp30,000 then Rp60,000 with a 5 kg minimum. This demonstrates tariff-floor behavior in these public responses, **not** a general create-order acceptance rule below a minimum. Do not reject or silently inflate measured weight based on an unverified interpretation. Any cargo billing-floor implementation must preserve measured values and freeze the actual quote/order weight with the sourced route minimum.

Official help says SAP Cargo is **Non-COD only**, and the sampled API also returned `unsupported_cod: true`. It also limits IDX cargo geography to Java/Bali/Sumatra and intra-Kalimantan shipments; do not infer broader coverage from a courier name or one sampled route. Official API docs prohibit combining cargo with Dangerous Goods. Route coverage, pickup capability and seller entitlement still require their own checks; a price or a null/missing coverage flag is not proof of successful cargo dispatch.

### Price-field findings: regular parsing cannot be reused unchanged

Use cargo-specific fields only after validating them for the seller contract; never import the public endpoint's discount as account policy.

- In the sampled non-COD SiCepatCargo row, `cargoPrice`/`cargoEstimatedPrice` were **35000**, `cargoEstimatedSpecialPrice` **33250**, but the generic `estimatedPrice` was **85000**. The generic total belongs to another pricing path. The existing regular parser is right not to accept this as a regular-consistent quote.
- JNECargo's generic special price was **36000**, while its cargo-specific special price was **42750**. IDX similarly returned **24000** versus **27000**. Reusing regular net/discount fields would misstate private seller cost.
- In the COD sample, the generic `codFee` was **3329**, but each cargo total minus cargo price was **3330**. This is an observed inconsistency, not permission to invent a one-rupiah tolerance, a percentage default, or silently choose one side. Seller-specific estimate plus sandbox order/read-back evidence is needed before accepting cargo COD accounting. SAP remains excluded from COD regardless.
- Public/3PL responses are **not** the authenticated seller estimate contract and cannot replace normal customer tariffs or private account terms.

### Implementation impact and next gate

The existing adapter deliberately excludes cargo while its order mapping and price consistency remain unverified; that defensive exclusion is not itself a defect. The official `cargo` boolean now documents the response-key-to-base-courier-plus-mode mapping, but safe integration is cross-layer:

1. Preserve **courier + service class** as estimate/COD grouping identity so regular and cargo from the same courier cannot overwrite or cross-price each other.
2. Discover and validate a route minimum from the corresponding provider response, then re-quote at the final billable weight with the cargo divisor and hard maximum. Unknown minimum/pricing remains excluded; no island-name guessing, generic 100 kg ceiling or historical range shortcut.
3. Freeze service class/cargo flag, rule version, route-minimum evidence and quote weight through server-side confirmation; dispatch must send the base courier with `orders[].cargo: true`. Validate cargo echo during creation/read-back/reconciliation rather than accepting a regular order for a cargo quote.
4. Enforce the same invariants at direct Data API/RPC boundaries; preserve legacy regular quotes/operations and the existing 1–50,000 g measured-intake ceiling unless the owner separately accepts a wider counter scope.
5. Show unambiguous cargo service/weight/minimum/COD states, with DB/transport/COD-collision/unknown-outcome regressions and rendered narrow/wide evidence before activation.

**Awaiting explicit sandbox approval:** use the existing sandbox seller credential through `secrets-env` (never print or read an env file); perform bounded read-only seller estimates/pickup-reference validation and, if a supported cargo service is available, at most **one synthetic non-COD cargo order** plus read-back. No production key/call, top-up, payment, deletion or blind replay is authorized by this research. That gate still applies to authenticated testing and activation; the owner's subsequent offline implementation authorization is recorded below.

## Staged cargo transport implementation (2026-11-03)

Owner renewed the request to review the Mengantar docs and implement them in GeraiExpress.
Run `RUN-20261103T114322Z-9ac39bc7` therefore owns a bounded offline transport slice:

- `includeCargo: true` explicitly parses documented cargo keys; defaults and existing shipment actions remain regular-only. No invented `cargo` estimate query is sent.
- Non-COD cargo uses only `cargoPrice`, `cargoEstimatedPrice`, `cargoEstimatedSpecialPrice`, `cargoDiscountPercent` and `estimate_delivery_cargo`; missing/inconsistent amounts or route minimum exclude the row. Public snapshots test field semantics, never activate their prices/discounts as tenant policy.
- Courier plus service class is the grouping identity for weight groups and supplied-estimator COD passes. Cargo route-minimum metadata must equal the supplied verified rule. This does not yet discover/verify a tenant route or implement a billing-floor policy.
- Explicit non-COD creation uses the base courier plus per-item Boolean `cargo`. Unsupported courier/flag/COD inputs are refused before sending. A missing/wrong cargo echo or unreadable/contradictory selected-service price leaves creation UNKNOWN without automatic retry. Order reads preserve known Boolean mode and leave absent/malformed mode unknown; cargo dispatcher/reconciliation wiring remains unimplemented.
- All cargo COD parsing and creation remain disabled. Class-safe synthetic COD tests are algorithm regressions, not proof that cargo COD is accepted by the live adapter.

The historical migration and active regular workflow are unchanged. Source/test verification
and independent acceptance belong to STATUS.md and the exact final delivery digest. Full
T-080 remains open: GeraiExpress credential/account attribution, authenticated sandbox
route/order support, forward cargo-limit correction, DB confirmation snapshots and full
UI/dispatch/reconciliation must be proved before activation. No cross-project secret is
reused based on its variable name; no authenticated provider operation is part of this slice.
