I'm recommending **REVISE**. The data model mostly matches the real schema (`shipments`, `shipment_quotes`, `shipment_events`, `label_print_events`, `private.quote_costs`), and DATA-11 states cross-tenant denial at both PostgREST and RPC. But six P1 issues mean at least T-082, T-083, T-085, T-086 and T-087 can't be built as written. Read-only review; I made no edits.

**Limits of what I checked:** I read the three requested diffs, the five named files, and short excerpts needed to check claims: `pickup_orders.sql`, `issuance.sql`, `gerai_discount_terms.sql`, `invoices_and_export.sql`, `proxy.ts`, `workspace-frame.tsx`, `marketing-data.ts`, `csv.ts` and the allowlist in `tests/db/privileges.test.ts`. I read no scripts and not the traceability checker, and ran no tests.

## Review

**What's already right**
- **DATA-14 inputs exist:** `shipments.length_cm/width_cm/height_cm` are at `foundation.sql:131-133`, and `EstimateRequest` really has no dimension field (`public-api.ts:87-95`).
- **DATA-11 acceptance:** "another tenant cannot read or write any row through PostgREST or RPC" (`05-DATA-MODEL.md:433`).
- **Rate limiter fit:** `limiter.ts` supports SEC-8 (3) once a new `LIMITS` entry is added.
- **Anonymous access is already guarded:** an anonymous database client exists and the `ANON_EXECUTE` allowlist test is in place, so `track_shipment` granted to `anon` is feasible on PostgreSQL 17 + PostgREST.

**Findings**

1. **P1 — T-082 needs a table that T-083 creates** (`TASKS.md:661`, `TASKS.md:669`; `05-DATA-MODEL.md:432-433, 439`)
   - **Problem:** DATA-11 says every payment carries `period_id` and "always references an open period". T-082 has "Depends On: none", but `cash_periods` and the auto-open rule only arrive in T-083, which depends on T-082.
   - **Fix:** Move the `cash_periods` table, its one-open-per-outlet partial index and the auto-open inside `record_counter_payment` into T-082. Keep close, reopen, variance and `/kas` in T-083.

2. **P1 — T-087 has no migration path, and "spread" from `private.quote_costs` would expose net cost to the tenant** (`TASKS.md:700`; `05-DATA-MODEL.md:442`)
   - **Problem:** DATA-11 requires a "tenant-admin RPC" over `private.quote_costs`, but T-087's Allowed Paths have no `db/migrations/**`. Worse, the existing tenant contract `gerai_cost_for_quote` (`gerai_discount_terms.sql:327-331`) returns "never the net cost, the observed discount or the remainder". A spread computed from `net_shipping_idr` would reveal the provider net cost (DATA-5, IAM-5).
   - **Fix:**
     - Add `db/migrations/**` (new forward migration only) to T-087.
     - Redefine the earnings figure as `customer_charge_idr − private.gerai_cost_idr(...)`, NULL when the gerai cost is unknown.
     - Replace `private.quote_costs` in the DATA-11 row with "derived gerai cost (`private.gerai_cost_idr`); net cost never leaves the database."

3. **P1 — COD shipments would be charged twice** (`05-DATA-MODEL.md:439`)
   - **Problem:** `expected_idr` comes from `shipments.customer_charge_idr`. For COD, that amount is already inside `cod_amount_idr = goods_value_idr + customer_charge_idr`, which the recipient pays (`pickup_orders.sql:172`). Expecting the sender to pay it at the counter applies the charge twice, against AGENTS.md "apply COD exactly once".
   - **Fix:** Add to DATA-11: "for `is_cod` shipments the counter expected amount is 0 / not applicable; `record_counter_payment` refuses (`cod_collected_by_courier`) unless an explicit non-shipping reason is given."

4. **P1 — Unknown expected amount and shipment state are undefined** (`05-DATA-MODEL.md:439`)
   - **Problem:** `customer_charge_idr` is nullable and is reset to NULL by `reopen_shipment` (`issuance.sql:178`). A CHECK like `amount_idr = expected_idr or difference_reason is not null` passes silently when expected is NULL, because `NULL <> x` is NULL. DATA-11 also never says which `submission_state` allows a payment.
   - **Fix:** State that `record_counter_payment` requires `submission_state in ('queued','in_flight','unknown','issued')` and a non-NULL `customer_charge_idr`, otherwise it raises `charge_unknown`. Make `expected_idr` NOT NULL. Say what a reopen does to an active payment (block the reopen, or require a void first).

5. **P1 — New routes 404 because Allowed Paths miss the host matrix, nav and robots files** (`TASKS.md:668, 684, 692`)
   - **Problem:** Every tenant path must be listed as a prefix in `hosts.ts:109`, or the proxy answers 404 (`proxy.ts:41-46`). T-083 (`/kas`) and T-086 (`/kasus`) don't allow `src/lib/hosts.ts`. Nav items are defined in `src/components/workspace-frame.tsx:38-43`, not in `workspace-nav.tsx`, which is what T-083 lists. T-086 lists neither. Breadcrumbs live in `src/components/app-header-crumbs.ts`, and the robots disallow list in `src/lib/marketing-data.ts:77-89`.
   - **Fix:** Add `src/lib/hosts.ts`, `src/components/workspace-frame.tsx`, `src/components/app-header-crumbs.ts` and `src/lib/marketing-data.ts` to T-083 and T-086. Add `src/lib/marketing-data.ts` and `src/app/robots.ts` to T-085.

6. **P1 — Which host serves `/lacak` is unspecified, and only one host meets SEC-8 (1)** (`12-SECURITY-ARCHITECTURE.md:266`; `TASKS.md:684`)
   - **Problem:** Only the public, hooks and internal scopes strip cookies (`proxy.ts:52-55`). On the tenant host the proxy resolves and refreshes sessions and may set cookies. The apex is also the only indexable host (`hosts.ts:24`).
   - **Fix:** Add to SEC-8: "`/lacak/[token]` is a new route family on the `public` (apex) audience only; 404 on the app, owner, hooks and internal hosts; `X-Robots-Tag: noindex` plus a robots disallow, despite the indexable apex." Add a host-matrix unit test to T-085's Done-when.

7. **P1 — "One active link, idempotent" can't coexist with "token stored only as a hash"** (`05-DATA-MODEL.md:449, 455`)
   - **Problem:** A second share can't give back the raw token of the existing active link, so the share action breaks on repeat.
   - **Fix:** Derive the token server-side as `base64url(HMAC-SHA256(TRACKING_TOKEN_SECRET, link_id))` (256-bit, secret server-only), store only `sha256(token)`, and re-derive it on repeat shares. Alternatively, redefine "idempotent" as "re-share rotates: revoke + new". Add the secret to SEC-8 and the bundle scan.

8. **P1 — One estimate call can't carry per-courier billable weight** (`05-DATA-MODEL.md:477`; `TASKS.md:646`)
   - **Problem:** The estimate sends one `weight` for all couriers (`public-api.ts:240-248`), but divisors differ per courier (6000 vs JNE/IDX 4000), so billable weight differs per courier.
   - **Fix:** Have DATA-14 and T-080 state "one estimate call per distinct billable weight (group couriers by rule), keeping only that group's couriers from each response; each quote stores the weight actually sent." Or send actual weight plus dimensions, if the provider documents dimension fields.

9. **P2 — Existing hard-coded divisor and unknown-vs-zero for old quotes** (`05-DATA-MODEL.md:479, 484`)
   - **Problem:** `private.simulated_tariffs` hard-codes the 6000 divisor (`foundation.sql:420`), which contradicts "never constants in code". The new `shipment_quotes` weight columns aren't stated as nullable, and existing quotes have no rule.
   - **Fix:** State that the simulated tariff reads `private.billable_weight_rules`. State that the new quote columns are nullable, with NULL meaning "not computed" for existing rows, never 0. Note that the TypeScript function gets its rules through a server-only/security-definer read, because `private` isn't exposed by PostgREST.

10. **P2 — Masking-acceptance amendment doesn't match the current tables** (`05-DATA-MODEL.md:426`)
    - **Problem:**
      - `label_print_events` has no acceptance or acknowledgement columns (`masked_label.sql:203-214`), and `record_label_print(p_snapshot uuid)` (`:350`) must change signature, which the signature-based allowlist in `privileges.test.ts` will catch.
      - `label_snapshots.courier` is nullable (`:183`).
      - `private.*` tables are invisible to PostgREST, yet the print view must read the state.
    - **Fix:**
      - Spell out the change: add nullable `acceptance_state` and `acknowledged` columns to `label_print_events`; the update guard stays.
      - Define "missing row or NULL courier = `unverified`".
      - Add a member-readable RPC `masking_acceptance_for(courier)`.
      - Have T-084's Done-when update the privilege allowlists.

11. **P2 — T-084 Allowed Paths point at the wrong pages** (`TASKS.md:676`)
    - **Problem:** Acceptance is per courier and platform-wide, but the listed admin path is `src/app/admin/tenant/**`. The print views live in `src/app/(workspace)/pengiriman/[id]/label/**` and `pengiriman/cetak/**`, which aren't allowed.
    - **Fix:** Add those two print-view paths, and either a platform page (e.g. `src/app/admin/integrasi/**` or a new `src/app/admin/kurir/**`) or a statement that acceptance changes go through RPC/seed only.

12. **P2 — The declaration columns would be client-writable without a stated write path** (`05-DATA-MODEL.md:463, 469`)
    - **Problem:** Shipments are edited through column-level UPDATE grants (`foundation.sql:309-312`). If T-081 adds `content_declared_*` the same way, `content_declared_by` can be spoofed.
    - **Fix:** State that the declaration is set only inside `confirm_shipment` (e.g. a new `p_declaration_version` parameter; `content_declared_by = auth.uid()`, `content_declared_at = now()`), with no column grant. Add "update the privilege allowlist and the TypeScript callers" to T-081.

13. **P2 — Tables without RLS or grant statements** (`05-DATA-MODEL.md:440, 455, 470, 498`)
    - **Problem:** `cash_periods`, `tracking_links`, `declaration_texts` and `shipment_cases` don't state RLS or grants. `declaration_texts` has no `tenant_id`. The existing table sweep requires RLS on every public table.
    - **Fix:** Add per table:
      - "RLS on; SELECT to `authenticated` via `private.is_member(tenant_id)` (for `declaration_texts`: `using (true)`); no INSERT/UPDATE/DELETE grants; writes through security-definer RPCs".
      - For `tracking_links`: "no `anon` table privilege".
      - Make `outlet_id` and `period_id` derived from the shipment, never caller-supplied; memberships carry no outlet scope (`foundation.sql:20-28`).

14. **P2 — The tracking timeline source has no status or hub columns and holds free text** (`05-DATA-MODEL.md:450, 456`)
    - **Problem:** `shipment_events` has `kind` and free-text `detail` (`foundation.sql:222-231`), with no status or hub-city fields. There is also no `delivered_at`/`returned_at` column to anchor `expires_at`.
    - **Fix:** State that `track_shipment` maps a whitelist of `kind` values to public statuses and never returns `detail`; that T-045 adds a structured `hub_city` and delivered/returned timestamps; and that `expires_at` stays NULL until delivery or return.

15. **P2 — Smaller gaps in cash periods, claims and exports** (`05-DATA-MODEL.md:440, 492, 499`; `TASKS.md:702`)
    - **Problem:**
      - **Overnight period and reopen:** if yesterday's period is still open, it's unclear whether a payment on a new WIB day joins it. The open-period partial index also ignores reopen unless reopen clears `closed_at`.
      - **Claim deadlines:** "working days" needs a holiday calendar that doesn't exist.
      - **CSV guard:** the formula guard lives in `src/lib/csv.ts`, not `src/lib/export-format.ts`.
    - **Fix:**
      - **Cash periods:** "a payment joins the outlet's open period whatever its day; the first payment with no open period opens one; reopen sets `closed_at = NULL` and keeps the earlier close in an audit record."
      - **Claims:** "`deadline_at` NULL = unknown when no rule or calendar applies; working days exclude weekends only until a holiday source is configured (Proposal)."
      - **T-087 paths:** reference `src/lib/csv.ts`.

**Tests the supervisor must run after these spec changes are implemented:** `pnpm test:db` (privileges allowlist and RLS sweep), `pnpm test:unit` (host matrix, billable weight), and the e2e suites named in each task.

**Merge verdict: REVISE.** Fix findings 1–8 in `05-DATA-MODEL.md`, `12-SECURITY-ARCHITECTURE.md` and `TASKS.md` before any of T-080..T-087 gets the go-ahead. Findings 9–15 are small spec edits and can go in the same pass.