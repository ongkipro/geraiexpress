# ADR-0003: Provider status ingestion — per-seller webhook path with a stored secret, status pull as the floor

- **Status:** Accepted (owner direction 2026-11-06: "ya, jalankan" on the plan "build T-045 with tests and review"); implementation T-045 (local only; live ingestion stays gated, see §6)
- **Date:** 2026-11-06
- **Author:** Engineering (assistant), for Paduka Ongki
- **Deciders:** Paduka Ongki (plan approval); design choices below are the engineering recommendation recorded in the operations-contract note §4.5 as Proposals, now decided.
- **Evidence base:** `docs/research/geraiexpress-mengantar-operations-contract.md` §4 (webhook) and §5 (status values), access date 2026-10-28; PRD PR-12; DATA-12/14/15; DEC-006, DEC-010, DEC-015 (cookie-less `hooks.` host).

## 1. Context (Observed)

- Mengantar pushes `{cnote_no, order_id, courier, status_category}` to a seller-set HTTPS URL, signed with HMAC-SHA256 (hex) over `{x-timestamp}.{raw body}` keyed by the seller's Webhook Secret; `x-timestamp` is in milliseconds. **The body carries no seller identifier.**
- Only the seller can set the URL (signed-in Mengantar account + verification code); the Partner API cannot. The secret is generated on first save and replaced whenever the seller regenerates the API key (seller-side or Partner `regenerate`).
- Delivery is best effort: up to 3 retries (1 s, 5 s, 15 s), may arrive out of order or duplicated, is paused after 20 consecutive failures in 24 h, and updates during a pause are not resent. No fixed source IPs. Any 2xx acknowledges within 5 s.
- `status_category` is open-ended (`PENDING PICKUP`, `PICKED UP`, `ON DELIVERY`, `DELIVERY COURIER`, `DELIVERED`, `UNDELIVERED`, `PICKUP FAILED`, `RTS`, `CANCELED`/`CANCELLED`, `ACTIVE/WAITING NEXT PROCESS`, `ERROR`, possibly `LOST`).

## 2. Decision

1. **Endpoint per seller, chosen by an unguessable path:** `https://hooks.geraiexpress.com/api/webhooks/mengantar/<endpoint_id>`, one random 32-byte (base64url) `endpoint_id` per tenant seller binding and environment. The path only **selects** which stored secret to verify with; it is never the authentication (the operations note: "a speed bump, not a substitute"). Trial verification across all secrets is rejected (CPU and timing cost, cross-tenant oracle).
2. **Authentication = the seller's Webhook Secret**, stored encrypted per tenant with the existing credential key ring (`CREDENTIAL_KEYS`, versioned; the hourly `webhook_secret_rewrap` step re-seals secrets still on an older key, fenced by the expected key version, so retiring an old key never breaks a webhook), entered once by the tenant admin from Mengantar's settings, write-only (never shown again; a hint only). Constant-time HMAC compare over the **raw bytes** received.
3. **Request limits:** host must be the `hooks` audience (cookie-less, no session); `POST` + `application/json` only; body ≤ 4 KiB read with a hard cap; `x-timestamp` within ±5 minutes of server time (replay window, ms); `x-environment: sandbox` must match the binding's environment (a sandbox delivery never moves a production shipment and vice versa).
4. **Idempotent, order-safe ingestion in SQL:** one machine RPC `ingest_provider_status(endpoint, provider_ts_ms, awb, order_id, courier, status_category)` resolves the shipment **only within that endpoint's tenant and environment** by `order_id` (and `awb` must match when known), dedupes on `(tenant, shipment, provider_ts, status)`, appends a `shipment_events` row with structured `provider_status`, and moves the shipment's provider state only **forward** by `provider_ts` (an older update never regresses a newer one). Unknown values are stored verbatim and mapped to the non-final `unknown` kind.
5. **Responses:** any authenticated, well-formed delivery answers `204` even when the order is unknown to us (no oracle, no retry storm); a signature failure answers `401` and logs `webhook_secret_mismatch` (tenant id only, never the body or headers), the expected case after a seller-side key regeneration; everything else is `400`/`404`/`413` without detail.
6. **Status pull is the floor, not an extra:** an hourly step reads `GET /order?order_id=` (Public API, read-only, with each seller's own key) for issued, non-final shipments whose last provider update is older than 2 hours (or never arrived), least recently pulled first (`status_pulled_at`), at most 200 per run, through the same RPC with `source = 'pull'`. The Partner-wide quota (T-110) and the provider-mutation fence govern Partner API calls and mutations; this GET-only Public API read is outside both by design. A pulled row whose `lastStatusChange` is missing or in the future is recorded with the pull time as **untrusted** and is **history only**: it never changes the kind, the ordering watermark or `delivered_at`/`returned_at`, because local time cannot be ordered against provider time. Webhooks only make it faster.
7. **Fixed status mapping** (`private.provider_status_kind`): `DELIVERED` → `delivered` (final, sets `delivered_at`), `RTS` → `returned` (final, sets `returned_at`), `CANCELED`/`CANCELLED` → `cancelled` (final), `UNDELIVERED`/`PICKUP FAILED` → `problem` (non-final), `PENDING PICKUP`/`ACTIVE/WAITING NEXT PROCESS` → `awaiting_pickup`, `PICKED UP`/`ON DELIVERY`/`DELIVERY COURIER` → `in_transit`, `ERROR` → `problem`, anything else (incl. `LOST`) → `unknown` (non-final, shown as "Status tidak dikenal"). The public `track_shipment` exposes only the kind label and timestamps (the latest 50 events, oldest first), never `detail` or the raw value of an unrecognized status.

## 3. Consequences

- Positive: no new dependency; secret selection is O(1); a forged or replayed delivery cannot change state; arrival order cannot regress delivery; a missed or paused webhook is covered by the pull; the public tracking page gets a real status.
- Negative: the tenant admin must copy the webhook URL into Mengantar and paste the Webhook Secret back (one manual step per seller, unavoidable per the provider contract); the endpoint id travels in every request (mitigated: it selects, it does not authorize).
- Out of scope here (kept in T-045's later slices / T-048): cancel (`DELETE /order`) with unknown-outcome read-back and batch-delete refund parsing; provider re-weigh (`provider_weight_grams`); live proof (sandbox simulation with a public URL).

## 4. Alternatives considered

- Trial verification against every stored secret — rejected (cost grows with tenants, timing side channel across tenants).
- Query-string tenant id — rejected (equivalent to the path but its acceptance by Mengantar's URL rules is Unknown).
- Pull only, no webhook — kept as the floor, but alone it delays statuses and spends Partner quota.

## 5. Verification

Unit: signature (provider test vector), replay window, size cap, environment mismatch, constant-time compare, mapping table incl. unknown/LOST. DB: tenant isolation (an endpoint can never touch another tenant), idempotency, out-of-order no-regress, finals, public projection. E2E: the tracking page shows the mapped status.

## 6. Gates before live ingestion (owner)

Hooks host DNS + TLS; the seller enables webhooks in Mengantar (production rollout is per account) and pastes the secret; one sandbox `order/simulation` delivery captured and compared with the fixtures (T-048).
