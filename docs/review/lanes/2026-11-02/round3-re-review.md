**Verdict: APPROVE WITH FIXES.** All 18 prior P1 findings are resolved. The fixes leave four new P1 gaps and five P2 notes, all small text edits to the docs. T-045 is the main blocker: it was never updated, yet DATA-12, DATA-15, T-085 and T-086 now depend on things it doesn't promise.

This was read-only. I made no edits, didn't read scripts or the traceability checker, and ran nothing. Since no files changed, there is no test command to run; the repository's spec/traceability gate should be rerun after the fixes.

## Prior findings

| # | Prior P1 | Status | Evidence |
|---|---|---|---|
| S1 | T-082 needs `cash_periods` from T-083 | RESOLVED | `05-DATA-MODEL.md:440` "(built in T-082)"; T-082 Done-when (`TASKS.md` ~664) builds the table, index and auto-open; T-083 (~672) says "(tables come from T-082)" |
| S2 | T-087 had no migration path; "spread" exposed net cost | RESOLVED | `TASKS.md:703` adds `db/migrations/**`; `05:442` uses `customer_charge_idr − private.gerai_cost_idr(...)` and keeps net cost in the database. See new finding N2 for a COD problem in this formula |
| S3 | COD charged twice at the counter | RESOLVED | `05:433` (`cod_collected_by_courier`, expected 0); `02-PRD.md:1010`; UX `17:571`; T-082 Done-when. See N7 |
| S4 | Unknown charge and shipment state undefined | RESOLVED | `05:433`: state list, `charge_unknown`, `expected_idr` NOT NULL, reopen refused while an active payment exists |
| S5 | Allowed Paths missed host matrix, nav, crumbs, robots | RESOLVED | T-083 (`TASKS.md` ~671) and T-086 (~695) list `hosts.ts`, `workspace-frame.tsx`, `app-header-crumbs.ts`, `marketing-data.ts`; T-085 (~687) lists `marketing-data.ts`, `robots.ts`, `hosts.ts`, `proxy.ts` |
| S6 | `/lacak` host unspecified | RESOLVED | `12-SECURITY-ARCHITECTURE.md:268` SEC-8 (1); `02-PRD.md:980` PR-36 amendment; `04-SYSTEM-ARCHITECTURE.md:362`; T-085 adds the host-matrix test |
| S7 | Idempotent share vs storing only a hash | RESOLVED | `05:450` HMAC(secret, link_id), re-derived on repeat share; the secret is in SEC-8 and T-085 paths |
| S8 | One estimate call for different per-courier billable weights | RESOLVED | `05:478` groups couriers by billable weight; T-080 Done-when matches. See N4 |
| U1 | COD double charge in the payment dialog | RESOLVED | `17:571` "Ditagih kurir (COD)", never prefilled; `02-PRD.md:1010`; UX-13 row `17:524` |
| U2 | Gerai identity leaks on a masked tracking page | RESOLVED (open edge) | `17:588` (3), `02-PRD.md:1030`, `05:457`. See N3: "masked" is not defined |
| U3 | Tracking host undefined in PR-36 | RESOLVED | `02-PRD.md:980`, `17:588` (2) and `17:589`, ARCH-6 row. See N6 |
| U4 | Spread reveals the provider discount | RESOLVED | `02-PRD.md:1079-1080`, UX-17 (6), `05:442` |
| U5 | New IAM cells read as accepted | RESOLVED | `07-IAM-RBAC-ABAC.md:34-39` prefixed "Proposed:"; note at `:42` |
| U6 | Operator has no "own outlet" | RESOLVED | `07:35` "any outlet of the tenant (memberships are tenant-wide, DEC-008)" |
| U7 | Variance shown to operators vs IAM denial | RESOLVED | `07:35` (period cash-count variance) is split from `07:36` (per-record differences); UX-17 (5) matches |
| U8 | PRD contradicts itself on tasks | RESOLVED | `02-PRD.md:1000-1002` reworded; open row `:1216` now "Before marketing copy beyond PR-35" |
| U9 | Receipt contents fixed while the decision is open | RESOLVED | UX-17 (4) marks the field list a Proposal; open row `02-PRD.md:1232` now includes refunds |
| U10 | "Lunas" collides with the Mengantar unpaid state | RESOLVED | `17:571` "Pelanggan: …" and "never hides or replaces the provider unpaid state"; `17:577`; `02-PRD.md:1010`; T-082 |

## New findings

**N1 — P1 — T-045 was never updated, but four contracts now rely on it** (`TASKS.md:343-349`)
- **What's wrong:**
  - Allowed Paths still say `supabase/migrations/**` (`:347`). That directory doesn't exist; migrations live in `db/migrations/`.
  - The Done-when (`:349`) only covers the signed webhook, status pull and cancel.
  - Yet DATA-12 (`05:456-457`) expects T-045 to add a structured `hub_city`, delivered/returned timestamps (which set `expires_at`), and a whitelist mapping event kinds to public statuses.
  - DATA-14 (`05:486`) expects `provider_weight_grams` "from events". DATA-15 and T-086 expect return/RTS anchor events.
  - PR-44 names a Lost final status whose webhook value is Unknown.
  - Today `shipment_events` has only `kind` and a free-text `detail` (`foundation.sql:222-231`).
- **Fix:** change T-045's Allowed Paths to `db/migrations/**` (new forward migration only). Append to its Done-when:
  - "`shipment_events` gains nullable structured `provider_status` and `hub_city`; `shipments` gains `delivered_at`, `returned_at` and `provider_weight_grams` (never overwriting measured values)."
  - "A tested mapping from provider status to a fixed `kind` whitelist used by `track_shipment` (DATA-12), including return/RTS, and Lost recorded as Unknown until its webhook value is captured."
  - "`detail` is never public."

**N2 — P1 — Pilot earnings overstate COD shipments by the COD fee** (`05-DATA-MODEL.md:442`; `02-PRD.md:1079`; UX-17 (6); `TASKS.md` T-087 Done-when)
- **What's wrong:**
  - `shipment_quotes.customer_charge_idr = normal_tariff_idr + cod_fee_idr`, enforced by a CHECK (`cod_and_batch_payment.sql:34`).
  - `private.gerai_cost_idr` only discounts the normal tariff (`discount_ceiling_fix.sql:46-54`).
  - So "customer charge − gerai cost" counts the COD fee, which is a pass-through to the provider, as gerai earnings. That breaks "count COD once".
- **Fix:** in all four places, define earnings as `normal_tariff_idr − gerai cost` (the same per-quote logic as `public.gerai_cost_for_quote`, using terms at `quoted_at`). State that COD and insurance fee components pass through and are excluded.

**N3 — P1 — Tracking page doesn't define what "masked shipment" means** (`05:457`; `17:588`; `02-PRD.md:1030`)
- **What's wrong:**
  - `mask_sender` is stored per label snapshot version (`masked_label.sql:167`), and a changed switch creates a new version (`:301`).
  - A shipment can have no snapshot yet, or versions with different masking.
  - So "NULL gerai name for a masked shipment" is undefined, and if read as "no snapshot = unmasked" it fails open.
- **Fix:** add to DATA-12: "masked = the latest `label_snapshots` row for the shipment has `mask_sender`. With no snapshot yet, the gerai name and sender initials are hidden (fail closed). Sender initials come from that same snapshot."

**N4 — P1 — The order is created with a different weight than the quote** (`05:478`; `TASKS.md` T-080 Done-when ~648)
- **What's wrong:**
  - Quotes will be requested with the billable weight.
  - The dispatcher still sends `weightGrams: p.weight_grams`, the actual weight (`src/lib/mengantar/dispatcher.ts:106`).
  - The provider's price would then differ from the confirmed `customer_charge_idr` and raise a false `price_mismatch` (`issuance.sql:352`).
- **Fix:** add to DATA-14 and T-080: "create-order sends the selected quote's `billable_weight_grams` (the weight actually quoted), frozen at confirmation; a test proves no `price_mismatch` when the order and quote weights match."

**N5 — P2 — PR-39 says WIB-day periods; DATA-11 says open-until-closed** (`02-PRD.md:1019, 1021` vs `05:440`; T-083 "DB tests for WIB boundaries")
- **What's wrong:** PR-39 says period boundaries use WIB "as the dashboard does". DATA-11 says a payment joins the open period "whatever its WIB day". T-083's "WIB boundaries" test target is therefore ambiguous.
- **Fix:** change the PR-39 constraint to "a period stays open until closed and may span midnight; times are shown in WIB". Change the T-083 test to "a payment after midnight joins the still-open period".

**N6 — P2 — UX-18 hard-codes the production URL** (`17:588` item 2)
- **What's wrong:** `https://geraiexpress.com/lacak/<token>` contradicts PR-36's rule that links come from per-environment configuration (`SITE_ORIGIN`, `src/lib/hosts.ts:153`). Read literally, staging and preview would share production URLs.
- **Fix:** "`<SITE_ORIGIN>/lacak/<token>` (production: `https://geraiexpress.com`)". Add "built from `SITE_ORIGIN`, not request headers" to T-085.

**N7 — P2 — DATA-11 table row and acceptance disagree on COD `expected_idr`; the non-shipping exception conflicts with the PRD** (`05:439` vs `:433`; `02-PRD.md:218`)
- **What's wrong:**
  - The `counter_payments` row still says `expected_idr` comes from `customer_charge_idr`, with no COD exception.
  - The "explicit non-shipping amount" exception creates a gerai extra charge, which the PRD pricing table says "needs its own accepted requirement".
- **Fix:** change the row to "`expected_idr` = `customer_charge_idr`, or 0 when `is_cod`". Then either remove the non-shipping exception (just refuse COD) or mark it "Proposed, owner decision" in PR-38 and the open row at `:1232`.

**N8 — P2 — `cash_period_events` has no RLS or grant statement** (`05:440, 443`)
- **What's wrong:** the Access row covers "both tables", but `cash_period_events` is a third table. The RLS sweep requires RLS on every public table.
- **Fix:** change the Access row to "all three tables (`counter_payments`, `cash_periods`, `cash_period_events`)". Add `cash_period_events` to T-083's Done-when.

**N9 — P2 — "Spread" in T-087 clashes with the PRD's definition** (`TASKS.md:701` and T-087 Done-when "cannot reach the spread"; `02-PRD.md:228`)
- **What's wrong:** the PRD defines spread as customer charge minus *provider* cost, the very quantity PR-45 forbids.
- **Fix:** replace "spread" with "earnings" in T-087's Constraints and Done-when.

**N10 — P2 — Stale and inconsistent wording**
- **What's wrong:**
  - PR-43 Status (`02-PRD.md:1056`) still says "the TASKS.md deferral can be revisited", and status row `:603` says "TASKS.md deferral stale", but `TASKS.md:713` is already updated.
  - PR-40's Statement (`:1029`) says the page "shows only" a list that omits the gerai name, while its Acceptance (`:1030`) allows it when masking is off.
  - The PR-36 amendment (`:980`) leaves out the internal host, which SEC-8 includes.
- **Fix:** change both PR-43 texts to "scheduled as T-080". Add "and the gerai name when masking is off" to the PR-40 Statement. Add "internal" to the PR-36 amendment's 404 host list.