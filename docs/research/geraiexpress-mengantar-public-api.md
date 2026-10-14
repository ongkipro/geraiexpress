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
- Weight rounding: the request sends kilograms with decimals (`weight=1.5` was accepted and echoed); the
  provider's billable-weight rule (rounding, volumetric) is not established.
- COD fee formula: observed only for one amount.

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

Not covered: pay-unpaid (orders were paid at creation), COD orders, webhooks (need a public URL
and the seller's callback secret), cancellation/deletion.
