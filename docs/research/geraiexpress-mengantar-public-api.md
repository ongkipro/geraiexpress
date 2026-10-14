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
| Sandbox origin | `https://sandbox.mengantar.com` answers **403 `Not allowed` for every key**, including invented keys and `/address/search`, which the docs say does not validate the key | Sandbox access is gated by caller (IP) allowlisting or account whitelisting on Mengantar's side. The owner's sandbox key cannot be tested until Mengantar enables the caller |
| Partner API | `POST /api/partner/v1/sellers/list` with the supplied values answered 401 `Invalid partner credentials` | No Partner credentials exist yet; seller onboarding stays BYOK (DEC-006) |
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
