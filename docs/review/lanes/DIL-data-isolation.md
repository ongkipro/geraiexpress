# Review — DataIsolationLane (Postgres schema, RLS, RPC, tenant isolation)

Read-only static review (2026-10-28). Read in timestamp order: all 16 `supabase/migrations/*.sql`, tracking the final effective definitions, including the runtime 40001→55000 rewrite. Also read: `supabase/seed.sql`, `supabase/config.toml`, `infra/supabase-preview/supabase/config.toml`, every `tests/db/*.ts`, `docs/spec/05-DATA-MODEL.md`, `06-TENANT-ISOLATION.md` and `07-IAM-RBAC-ABAC.md`, plus the Worker call sites that consume DB outputs across the trust boundary. No database, test, EXPLAIN or build was executed. Performance magnitudes are marked [INFERENCE].

Severity counts: **Critical 1 · High 1 · Medium 10 · Low 11** (23 findings).

## Findings

### [Critical] DIL-01 Tenant admin can plant another seller's ID and make the Worker fetch that seller's API key
Where:
- `supabase/migrations/20261027230000_production_readiness_polish.sql:10-61`: final `record_partner_seller_onboarding_outcome`; l.45 `partner_seller_id = coalesce(p_seller_id, partner_seller_id)`.
- `supabase/migrations/20261027210000_partner_seller_onboarding.sql`:
  - :158-225 `complete_partner_seller_onboarding`, l.209 `partner_seller_id = p_seller_id`
  - :24-25 `partner_seller_id` is neither unique nor write-once
  - :333-345 both RPCs granted to `authenticated`
  - :137, :152 `begin_…` returns the stored id
  - :106-109 `already_partner_connected` guard
- `src/lib/mengantar/partner-onboarding.ts`:
  - :102-105 trusts `beginData.partner_seller_id`
  - :141-144 `partner.getSellerApiKey(partnerSellerId)`
  - :168-178 seals the key for the caller's tenant and stores it
- `src/modules/credentials/forms.tsx:70-73`: recover button shown for `registered_key_pending`.
- `src/lib/mengantar/partner-api.ts:152-161`; `docs/research/geraiexpress-mengantar-partner-api.md:142-148`: `sellers/api-key` returns the current key of any seller registered under this partner.

Evidence: Both write RPCs are `security definer`, granted to `authenticated`, and gated only by `require_tenant_admin_locked(p_tenant)`. The seller id is caller-supplied and only regex-checked, so any tenant admin can call them directly through PostgREST with their own session; the publishable key is public.

The attack chain:
1. The admin plants a seller id through one of these RPCs.
2. `begin_partner_seller_onboarding` returns the planted `partner_seller_id`.
3. `onboardPartnerSeller` calls the Partner API `getSellerApiKey(id)` with the platform Partner Secret.
4. The returned key is sealed for the attacker's tenant and stored through `complete_partner_seller_onboarding`.

Nothing checks that the seller's `externalUserId` equals `geraiexpress:tenant:<tenant>`. The DB suite exercises this client-side write as a feature: `tests/db/partner-onboarding.test.ts:126-131` (outcome with a seller id), :135-144 (begin returns it) and :149-153 (complete by the user session).

A connected tenant can re-enter the flow: `record_…_outcome` moves `onboarding_state` off `connected`, which disarms the `already_partner_connected` guard.

Impact: Cross-tenant credential takeover. The attacker's gerai can quote, create orders and pay unpaid batches against the victim's Mengantar account and balance. The victim's key is not rotated, so nothing alerts them.

The victim's seller id is easy to obtain:
- `partner_onboarding_status` (…onboarding.sql:280-331) returns it to every member of the victim tenant, including operators.
- `/pengaturan` displays it (forms.tsx:64).
- The `partner.onboarding_complete` audit detail contains it.

The realistic attacker is a person who is an operator in tenant A and an admin in tenant B. This violates TEN-3 ("Do not trust browser-supplied sellerId", 06:90-91), IAM-3 ("no arbitrary seller target", 07:89) and DATA-4 (unique sellerId binding, 05:115-118). Today the Partner flow runs only where `MENGANTAR_ENV=sandbox` (staging config), so the exposed money is sandbox; the same design is planned for production.

Recommendation:
1. Revoke `complete_partner_seller_onboarding` and `record_partner_seller_onboarding_outcome` from `authenticated` and grant them only to `service_role`. The Worker calls them with the machine client after `requireWorkspace` and the user-session `begin_…` succeed. Bind each call to an attempt id that `begin` creates and stores, and require `onboarding_state = 'registration_pending'`.
2. Make the binding unique and write-once: `create unique index on private.tenant_mengantar_onboarding (partner_seller_id) where partner_seller_id is not null`, plus a BEFORE UPDATE trigger that refuses changing a non-null `partner_seller_id`.
3. In `onboardPartnerSeller`, never call `getSellerApiKey(storedId)` blindly. Either always call the idempotent `registerSeller` with the server-derived externalUserId, which returns the same seller and its current key, or first `listSellers({ externalUserId })` and require `sellerId === storedId && externalUserId === expected`.

Verify:
- DB test: the tenant B admin calling either RPC with tenant A's seller id gets a permission error, and a duplicate `partner_seller_id` insert fails.
- Unit test: when the stored seller id's `listSellers` externalUserId mismatches, the flow never reaches `sellers/api-key`.

### [High] DIL-02 The "revoke EXECUTE by default" statement is a no-op for PUBLIC; only per-function discipline keeps SECURITY DEFINER RPCs away from anon
Where: `supabase/migrations/20261013170000_foundation.sql:287`; every per-function `revoke … from public` across the migrations; `tests/db/isolation.test.ts:30-33`.

Evidence: Line 287 runs `alter default privileges in schema public revoke execute on functions from public, anon, authenticated`. PostgreSQL grants EXECUTE to PUBLIC *globally* by default, and the [ALTER DEFAULT PRIVILEGES docs](https://www.postgresql.org/docs/current/sql-alterdefaultprivileges.html) state "you cannot revoke privileges per-schema if they are granted globally". So every new function still receives PUBLIC EXECUTE, and anon is a member of PUBLIC.

I checked all 16 migrations: every current public function carries an explicit `revoke … from public`, so I found **no live exposure**. No test enumerates `pg_proc`, though; the only anon RPC check calls a single function (`create_shipment_draft`).

Impact: One missed `revoke` in a future migration ships a `security definer` RPC that anon can call via `/rest/v1/rpc/*`, bypassing tenant scope. The safety net the foundation comment assumes does not exist.

Recommendation:
- Add the effective global form `alter default privileges for role postgres revoke execute on functions from public;` (no `in schema`). Keep the per-schema revokes for anon and authenticated.
- Add a catalog test over `pg_proc` in `public` and `private`:
  - `has_function_privilege('anon', oid, 'execute')` is false except an allowlist (`registration_open`).
  - `authenticated` matches an explicit allowlist.
  - Machine RPCs are executable by `service_role` only.
- Add the table sweep: no anon table privileges, and `relrowsecurity` on every public table.

Verify: In a test transaction, create a scratch function and assert anon cannot execute it; the catalog test passes.

### [Medium] DIL-03 Partner completion stores the credential version without an expected-version check (AAD/version mismatch)
Where: `supabase/migrations/20261027210000_partner_seller_onboarding.sql:188-200`; `src/lib/mengantar/partner-onboarding.ts:106-109,168-178`; `src/lib/credential-crypto.ts:13-15`; `src/lib/mengantar/tenant.ts:34-37`.

Evidence: The Worker seals the key with AAD `(tenant, latest_from_begin + 1)`. `complete_…` separately inserts `version = max(version) + 1` at completion time and returns it unchecked. The BYOK sibling `store_seller_credential` enforces `p_expected_version` (credentials.sql:42-46).

Any overlap breaks the binding: a double submit, a second tab, an impatient retry while the first request waits up to 15 s on Mengantar, or a concurrent BYOK save. The later completion supersedes a good key with ciphertext whose AAD version differs from its row version.

Impact: The active credential can never be opened while the tenant shows "connected". Live quotes fail with `key_unreadable`, and dispatch releases and keeps operations queued. Nothing fails at write time.

Recommendation: Add `p_expected_version` to `complete_partner_seller_onboarding` and raise `stale_state` (55000) unless `max(version) = p_expected_version`. Pass `latestVersion` from the Worker.

Verify: DB test: begin returns N, a BYOK store creates N+1, then complete sealed for N+1 fails with `stale_state` and the active row stays decryptable.

### [Medium] DIL-04 Retrying onboarding overwrites the owner identity and consent of an already-created seller
Where: `supabase/migrations/20261027210000_partner_seller_onboarding.sql:125-137`; `src/lib/mengantar/partner-onboarding.ts:141-144`; `tests/db/partner-onboarding.test.ts:135-144,165-171`.

Evidence: The `begin_…` upsert unconditionally replaces owner_name, owner_email and owner_phone, the terms/privacy versions, `consent_actor_id` and `consent_recorded_at`, even when `partner_seller_id` is already set. When a seller id exists, the Worker only calls `getSellerApiKey`, so new owner data never reaches Mengantar. The test asserts that the changed email is shown afterwards, and the `partner.onboarding_begin` audit row does not keep the owner fields.

Impact:
- `/pengaturan` can show an owner email that is not the registered Mengantar owner, so PR-17's "Lupa Password" guidance points at the wrong inbox.
- The consent record for the seller actually created is lost (PR-20 acceptance; research:122 "do not assume repeated registration edits name/email/phone").

Recommendation: Freeze owner_* and consent_* once `partner_seller_id` is non-null (or after the first registration call). Keep consents as append-only rows, or include the owner and version fields in the audit detail.

Verify: DB test: after an outcome that carries a seller id, `begin` with a different email leaves `owner_email` unchanged (or is refused), and the consent history holds both entries.

### [Medium] DIL-05 Seller binding and credentials are not scoped by provider environment (DATA-4 drift)
Where: `20261014150000_credentials.sql:9-26`; `20261027210000_partner_seller_onboarding.sql:6-42`; `20261014170000_live_quotes.sql:34-47` (`machine_seller_key`).

Evidence: Neither `private.seller_credentials` nor `private.tenant_mengantar_onboarding` has an environment column. `machine_seller_key`, `dispatch_claim` and `dispatch_payload` return the single active key whatever `MENGANTAR_ENV` is. Only `provider_operations.provider_env` records the environment, per operation.

Impact: Moving a deployment from sandbox to production reuses sandbox seller ids and keys: `begin` hands the sandbox `partner_seller_id` to the production Partner client, and live quotes use a sandbox key. This contradicts "Keep sandbox/production mappings separate" (research:122) and DATA-4's `(provider_environment, sellerId)` uniqueness (05:115-117).

Recommendation: Add `provider_env` to both tables and to the active and unique indexes. Machine reads take or derive the environment and select only matching credentials.

Verify: DB test: a sandbox credential is not returned for `production`, and the partner binding is unique per (env, seller).

### [Medium] DIL-06 Batch payment spends the Mengantar balance with no durable actor or audit, and authorization is not bound to the machine claim
Where: `20261027190000_cod_and_batch_payment.sql:738-792` (`dispatch_begin_batch_payment`), :807-831 (`dispatch_record_payment`); `20261013170000_foundation.sql:381-386` (`add_event` actor = `auth.uid()`, null for service_role); `src/modules/shipments/actions.ts:303-313,227-230`.

Evidence: The admin check runs in `review_unpaid_batch` under the user session, in its own transaction, and its share lock ends there. The spend then runs as `service_role`. `dispatch_begin_batch_payment` takes no actor and writes no `private.audit` row, the resulting shipment events have `actor = null`, and the Worker logs counts only.

Impact: No durable record of which tenant admin authorized spending the balance. IAM-2 and TEN-4 require actor, command and outcome audit for state-changing decisions. A demotion between review and claim is not re-checked (a small window).

Recommendation: Add a user-callable `authorize_batch_payment(p_shipment, p_batch_digest)` that:
1. re-checks the admin role under a share lock;
2. inserts a short-lived authorization row (actor, tenant, batch, digest, expires_at);
3. writes `private.audit('shipment.batch_pay', …)`.

`dispatch_begin_batch_payment` must consume a matching unexpired authorization.

Verify: DB test: the machine claim fails without an authorization row. With one, an audit row carries the admin uid, and an operator cannot create one.

### [Medium] DIL-07 No database-side quota on writes that anonymous demo sessions can make directly through the Data API
Where: `20261013170000_foundation.sql:395-411` (`create_shipment_draft`), :321-333 (contact/address insert policies); `20261027190000_cod_and_batch_payment.sql:76-142` (`request_quotes` adds 3 quotes per revision); `infra/supabase-preview/supabase/config.toml:37,45-46`; `RELEASE.md:29-31`.

Evidence: Worker rate limits cover only Auth ingress (ARCHITECTURE.md:235). With the publishable key, any anonymous session can loop `create_shipment_draft`, contact and address inserts, and draft edit plus `request_quotes`. Each call adds rows, and there is no per-tenant cap. RELEASE.md declares only the anonymous sign-in plus `start_demo` bypass, not unbounded per-session writes.

Impact: One anonymous JWT can grow `shipments`, `shipment_events`, `shipment_quotes` and `private.quote_costs` without limit (storage, IO, plan quota). On the preview, cleanup does not run (DIL-19).

Recommendation: Enforce caps for demo tenants in SQL: in `create_shipment_draft` and `request_quotes`, plus a BEFORE INSERT trigger on contacts and addresses for `is_demo` tenants (for example 50 shipments, 100 contacts, 300 addresses; raise `demo_limit`). Enable captcha on the preview as already planned.

Verify: DB test: the 51st draft or 101st contact of a demo session fails with `demo_limit`, and real tenants are unaffected.

### [Medium] DIL-08 Every RLS predicate runs a SECURITY DEFINER function per row (no InitPlan caching)
Where: `20261013170000_foundation.sql:314-348` (all `using ((select private.is_member(tenant_id)))`), :45-62; `src/app/(workspace)/pengiriman/page.tsx:44-51`, `kontak/page.tsx:17-20` (`count: "exact"`).

Evidence: The `(select …)` wrapper becomes a cached InitPlan only when it does not reference row columns. Here it references `tenant_id`, so it is a correlated SubPlan executed per row. `is_member` and `member_role` are `security definer` with `SET search_path`, which makes them non-inlinable: each visible row costs two definer calls plus a membership join. The list pages request `count: "exact"`, which evaluates the predicate for every row in the tenant.

Impact: [INFERENCE] List and count latency grows linearly with tenant size, into seconds at about 10^5 rows. This is the main scaling limit of the Data API path.

Recommendation:
- Add `private.my_tenant_ids() returns setof uuid` (stable, security definer, with the same active, lifecycle and anonymous-demo rules as `member_role`).
- Write policies as `tenant_id in (select private.my_tenant_ids())`; the memberships admin branch uses `private.my_admin_tenant_ids()`.
- Use `count: "estimated"` for large lists.

Verify: Seed about 50k shipments and `EXPLAIN (ANALYZE)` the page query before and after (expect a hashed SubPlan or InitPlan). The full `tests/db` suite stays green.

### [Medium] DIL-09 Hot-path indexes are missing or mismatched
Where:
- `20261013170000_foundation.sql:84,100-101,152-153,209-220`; `20261014180000_issuance.sql:21-22`.
- Callers:
  - `pengiriman/page.tsx:44-55`, `pengiriman/baru/page.tsx:17-18`, `kontak/page.tsx:17-20`, `pengiriman/[id]/page.tsx:153-156`
  - `shipmentOperation` in `modules/shipments/actions.ts`
  - `reopen_shipment` (cod…sql:353-356), `close_failed_operation`, `compute_unpaid_batch` (cod…sql:604-610)

Evidence:
- Shipment lists order by `updated_at`, but the only index is `(tenant_id, created_at desc)`.
- Contacts order by `name`, but the index is on `lower(name)`.
- `contact_addresses` has no `(tenant_id, contact_id)` index, which the per-contact PostgREST embeds and the FK cascade need.
- `provider_operations` lookups by `(tenant_id, shipment_id, kind) order by created_at desc` can use only the partial unique index, whose predicate these queries do not imply.
- `label_jobs` has no `(tenant_id, shipment_id)` index.

Impact: [INFERENCE] Each page and RPC sorts or scans tenant-wide, compounding DIL-08.

Recommendation: Add these indexes:
- `shipments (tenant_id, updated_at desc)`
- `contacts (tenant_id, name) where archived_at is null`, or order by `lower(name)`
- `contact_addresses (tenant_id, contact_id)`
- `provider_operations (tenant_id, shipment_id, created_at desc)`
- `label_jobs (tenant_id, shipment_id)`

Consider pg_trgm GIN indexes for the `ilike '%q%'` searches.

Verify: EXPLAIN each listed query and confirm an index scan with no Sort over the whole tenant set.

### [Medium] DIL-10 The 5-minute sweep scans all historical operations
Where: `20261014180000_issuance.sql:27-29` (`provider_operations_due` includes every `succeeded` and `failed` row), :193-220 (`dispatch_due` payment and failed branches), :552-564 (`dispatch_stuck_counts`); `wrangler.jsonc:19,53`.

Evidence: The payment branch filters `state='succeeded'` joined to `shipments.payment_state='unpaid'`; the failed branch filters `state='failed'`. Both use the non-sargable `coalesce(last_checked_at,'-infinity') < …`, and their `updated_at`/`dispatched_at` windows are not indexed. So every run walks every succeeded or failed operation ever recorded.

Impact: [INFERENCE] Sweep cost grows with lifetime order volume, every 5 minutes, on top of the stuck-count scans.

Recommendation:
- Add narrow partial indexes, e.g. `shipments (tenant_id, id) where payment_state = 'unpaid'` to drive the payment branch, and `provider_operations (dispatched_at) where not is_simulated and state='failed' and result_code in ('NOT_CREATED','PROVIDER_ERROR_ITEM')`.
- Rewrite predicates as `(last_checked_at is null or last_checked_at < …)`.

Verify: EXPLAIN `dispatch_due(50)` with about 100k historical succeeded ops: no full pass over succeeded rows.

### [Medium] DIL-11 The runtime SQLSTATE 40001→55000 rewrite makes migration sources diverge from deployed functions, with no regression guard
Where: `20261027220000_contact_archive_and_demo_cleanup.sql:90-107`. Remaining `'40001'` literals in earlier sources include:
- `platform_admin.sql:130,218`
- `registration.sql:122,132,152,174,229-230`
- `invitations.sql:168,186,204`
- `credentials.sql:45,65`
- `dispatcher.sql:181,273`
- `live_quotes.sql:69`
- `issuance.sql:86-97,246,422`
- `foundation.sql:443,507,512,515`
- `quote_reuse…sql:21`

Evidence: A DO block regex-replaces `'40001'` in every `public` or `private` function body taken from `pg_get_functiondef` and re-executes it. The SQL that reviewers read still says 40001 for `platform_set_tenant_lifecycle`, `set_member_role`, `store_seller_credential`, `save_application` and others, while the deployed code raises 55000.

Impact: Copying any of these functions forward in a later `create or replace` silently reintroduces 40001, which the migration's own comment says PostgREST retries forever. Reviewers cannot trust the source text.

Recommendation: Either add a forward migration that re-declares the affected functions verbatim with 55000, so source equals deployed code, or document clearly that pre-`20261027220000` SQLSTATEs are superseded. Add a DB test that no function in `public` or `private` contains `'40001'`.

Verify: `select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and p.prosrc like '%''40001''%'` returns 0 in a DB test.

### [Medium] DIL-12 The DB suite does not prove several of its isolation claims
Where: `tests/db/isolation.test.ts:24-33`; `tests/db/partner-onboarding.test.ts:126-153`; `tests/db/cod-and-payment.test.ts:45-65`; `tests/db/dispatcher.test.ts:19-30`; `tests/db/issuance.test.ts:167-170`.

Evidence:
- (a) No `pg_proc`/`has_function_privilege` sweep; the anon RPC check covers one function (DIL-02).
- (b) The anon table read covers 6 of 14 public tables; there is no `has_table_privilege` or `relrowsecurity` sweep.
- (c) No TEN-3 foreign seller-binding test; the suite performs the client-side seller-id write as a feature (DIL-01).
- (d) "freezes … cod_amount_idr … on confirm" never calls `confirm_shipment`. It writes `customer_charge_idr`/`cod_amount_idr` with superuser SQL, so the COD-once computation (cod…sql:318-319) is untested at DB level.
- (e) No user-denial tests for the service_role-only `dispatch_release`, `dispatch_release_batch_payment` and `dispatch_record_payment`.
- (f) No guard against `'40001'` (DIL-11) and no credential-version concurrency test (DIL-03).

Impact: The TEN-1, TEN-3 and DATA-5 acceptance claims (06:15, 06:86-88) are reported PASS without executable proof for these paths.

Recommendation: Add:
- the catalog sweep (DIL-02);
- the foreign-binding and machine-only onboarding tests (DIL-01);
- a real user-session `confirm_shipment` COD test asserting `customer_charge_idr = tariff + cod_fee` and `cod_amount_idr = goods + charge`;
- user-denial loops for every service_role RPC.

Verify: The new tests fail on the current schema for DIL-01 and DIL-02, and pass after the fixes.

### [Low] DIL-13 `record_live_quotes` turns missing COD facts into "supported, fee 0"
Where: `20261027190000_cod_and_batch_payment.sql:189-205`.

Evidence: A row without `cod_supported` defaults to `s.is_cod`, and a row without `cod_fee`/`codFee` gets fee `'0'`. Today's Worker always sends both (`src/modules/shipments/actions.ts:189-191`, and `public-api.ts:375-381` drops unknown fees), so this only guards a future or rolled-back caller.

Impact: Unknown becomes zero at the money boundary (AGENTS invariant; DATA-5 "a missing fee/cost remains unknown"), so a COD quote can undercharge.

Recommendation: For COD shipments, require both keys and raise `invalid_input` when either is absent.

Verify: A machine RPC test with a COD row lacking `cod_fee` returns `invalid_input`.

### [Low] DIL-14 Opposite lock orders: batch payment (tenant→shipment→operation) versus dispatcher (operation→shipment)
Where: cod…sql:759, 592, 606, 629-632; `20261014160000_dispatcher.sql:75-87` (`lock_real_operation`), used by `dispatch_begin_payment_check` and `dispatch_record`.

Evidence: A payment check or record on a batch member that runs concurrently with an admin batch payment can deadlock.

Impact: Postgres aborts one side with 40P01, causing an occasional failed pay or sweep step. No corruption.

Recommendation: In `compute_unpaid_batch(p_lock)`, lock the batch operations first (ordered by id), then their shipments.

Verify: A concurrent psql test (the `asUser` pattern at `tests/db/invitations.test.ts:151`) completes without 40P01.

### [Low] DIL-15 Concurrent `start_demo` calls create several demo tenants for one anonymous user
Where: `20261014110000_reconcile_admin_only.sql:38-62`.

Evidence: The lookup (l.51) and the insert are not serialized, and no unique constraint limits a user to one demo membership.

Impact: A double submit lands the visitor on the "choose" screen between identical sample gerai, and `reset_demo` then picks an arbitrary one (`limit 1`).

Recommendation: Add `perform pg_advisory_xact_lock(hashtextextended(v_user::text, 0));` before the lookup.

Verify: Two parallel `start_demo` calls return the same tenant id.

### [Low] DIL-16 The 24-bit reference suffix collides and surfaces as a draft-creation error
Where: `20261013170000_foundation.sql:388-392,147`.

Evidence: The reference suffix is 6 hex characters per day. A collision raises 23505 out of `create_shipment_draft`, which does not retry.

Impact: [INFERENCE] A gerai creating 1,000 drafts a day hits an error on about 3% of days.

Recommendation: Retry on `unique_violation` inside `create_shipment_draft` with a bounded loop, or widen the suffix.

Verify: A SQL test that forces a collision still succeeds.

### [Low] DIL-17 `auth.users` FKs without ON DELETE block identity deletion, while the membership cascade skips the last-admin guard
Where: `foundation.sql:141,199,216,228`; `partner_seller_onboarding.sql:36`; `foundation.sql:22`.

Evidence: Deleting a staff identity that ever created a shipment, operation, label or consent fails with an FK error, which is why `cleanup_expired_demos` pre-filters (contact_archive…sql:75-79). Deleting an admin who has no such rows cascades the membership away without `assert_tenant_admin_remains`.

Impact: Account erasure is impossible for active staff, and a tenant can be left with no admin, with no platform RPC to restore one.

Recommendation: Decide the PRIV policy (`on delete set null` with nullable actor columns), and add a BEFORE DELETE trigger on `public.memberships` that runs `assert_tenant_admin_remains`.

Verify: A DB test that deletes the last admin's auth user is refused.

### [Low] DIL-18 `seed.sql` has no environment guard
Where: `supabase/seed.sql:1-83`; `supabase/config.toml:67-72`.

Evidence: The seed creates working admins with a known password and fixed TOTP secrets, two full platform grants, and `registration_open = true`. Only process keeps it off shared databases: RELEASE.md:17 records a preview push without the seed. `db reset --linked` or `db push --include-seed` would apply it remotely.

Impact: If the seed ever reaches a shared project, an attacker gets full Super Admin takeover.

Recommendation: Begin `seed.sql` with a DO block that raises unless a local-only marker is present, such as a GUC set by `scripts/supabase-local-env.sh`, a loopback or docker `inet_server_addr()`, or `cluster_name`.

Verify: Running the seed against a database without the marker aborts before any insert.

### [Low] DIL-19 `cleanup_expired_demos` is one unbounded transaction with full anti-join scans, and the preview has no scheduler (declared residual)
Where: `contact_archive…sql:43-85`; `wrangler.jsonc:34`; `RELEASE.md:29-31`.

Evidence: All expired demo tenants are deleted in one chain of cascades. The user-deletion `not exists` checks hit the unindexed `shipments.created_by`, `provider_operations.actor`, `label_jobs.requested_by` and `shipment_events.actor`. The preview has `crons: []` and no secret key, so cleanup never runs there; RELEASE.md declares this.

Impact: [INFERENCE] After an abuse burst, a single huge transaction (locks, WAL). Until scheduling exists, preview growth is unbounded.

Recommendation:
- Delete in bounded batches per run.
- Pre-filter anonymous candidates before checking history.
- Schedule inside the database with pg_cron (`cron.schedule('demo-cleanup','0 * * * *','select public.cleanup_expired_demos(24)')`), so cleanup does not depend on a Worker secret.

Verify: With 5k expired demos seeded, each run deletes at most N within statement_timeout, and `cron.job` lists the schedule on the preview.

### [Low] DIL-20 `partner_onboarding_status` reports `partner_managed` after a BYOK replacement
Where: `partner_seller_onboarding.sql:300-320`; `credentials.sql:36-53`.

Evidence: The first CASE branch trusts `o.connection_mode`, not the active credential's `seller_credentials.mode`, and `store_seller_credential` never touches the onboarding row.

Impact: Tenant settings mislabel a BYOK key as Partner-managed, although TEN-3 requires the two to stay distinct. `/admin/integrasi` uses `c.mode` and is correct.

Recommendation: Derive the mode from `c.mode`.

Verify: DB test: after partner connect followed by a BYOK store, status reports `byok`.

### [Low] DIL-21 `review_unpaid_batch` treats `p_tenant` as a shipment id when `p_shipment` is null
Where: `cod_and_batch_payment.sql:706-711`.

Evidence: The function contains `if p_shipment is null and p_tenant is not null then v_shipment := p_tenant`.

Impact: No security effect, because the admin check and tenant scope still apply, but the API is misleading and invites caller bugs.

Recommendation: Reduce the signature to `review_unpaid_batch(p_shipment uuid)` and derive the tenant.

Verify: The adjusted tests pass, and a call with only `p_tenant` is rejected.

### [Low] DIL-22 Invitee emails are written into the append-only audit log
Where: `invitations.sql:148-154`; `platform_admin.sql:62-71`.

Evidence: The `member.invite` and `member.invite_revoke` details store the raw email, and audit rows can never be updated or deleted.

Impact: PII of people who may never become users is non-erasable, and DATA-6 forbids PII bodies in audit.

Recommendation: Store only the invitation id and role in the audit row; the email stays in `tenant_invitations` under retention policy.

Verify: The test asserts the audit detail has no `email` key.

### [Low] DIL-23 (cross-lane) Preview and staging Workers point at the same Supabase project
Where: `wrangler.jsonc:43,62` (identical `SUPABASE_URL`), :53, :65-66 (staging has the cron, `MENGANTAR_ENV=sandbox` and `PARTNER_ID`).

Evidence: The public synthetic demo (captcha off) and the live-sandbox staging deployment would share tables, cleanup and the sweep once staging receives `SUPABASE_SECRET_KEY`. [INFERENCE] Whether this is intended is not stated anywhere I read.

Impact: This breaks DEL-1 environment separation, and the staging Partner flow (DIL-01) and cron would act on preview data.

Recommendation: Give staging its own Supabase project, or record the sharing as an accepted decision in DECISIONS.md.

Verify: The wrangler environments reference distinct project URLs.

## Sound (checked, no finding)
- **RLS coverage.** RLS is on for all 14 public tables and for the private `quote_costs`, `seller_credentials` and `tenant_mengantar_onboarding`. `private.settings` has no RLS but also no grants.
- **Grants.** Anon has no table privileges. Authenticated writes are column-scoped. Ownership, state, archive and authority columns are not writable: guard triggers bump the revision, freeze submitted content and refuse ownership changes (tested).
- **Same-tenant FKs.** Composite FKs cover every child relation, and reparenting or foreign parents are refused (tested).
- **Definer functions.** Every `security definer` function has `set search_path = ''` and schema-qualified references. Every public function was checked to have an explicit revoke from PUBLIC. Machine RPCs are granted to service_role only.
- **Scope source.** Scope comes from `auth.uid()` and the JWT inside `private.member_role` (active membership, active tenant, anonymous only in demo). Membership is checked before row locks, and admin actions re-check the role after locking.
- **Anonymous identities.** Conversion is blocked on `auth.users` (tested). The signup hook refuses metadata and closed registration, and pre-verification passwords are discarded.
- **Platform.** Platform access needs aal2 plus a live grant read, with a final-admin guard under lock. Audit is append-only through update/delete/truncate triggers and a select-only grant.
- **Money.** Amounts are bigint IDR. Customer charge = tariff + COD fee, enforced by trigger and CHECK. Net cost exists only in `private.quote_costs` (tested unreadable). Unknown net or provider price stays NULL.
- **Idempotency.** Unique `(tenant_id, idempotency_key)`; at most one live create per shipment; one in-flight real operation per tenant. A replay returns the original operation and a conflicting digest is refused (tested, including 6-way concurrency).
- **Dispatcher.** Attempt fencing; "not created" requires age; reconciliation conclusions are corrected; operations are refused as stale after 6 h; the sealed key is returned only for the operation's credential version.
- **Invitations.** At most one pending invitation per tenant and email, 7-day expiry, the issuer must still be an admin, verified-email match, a 20-pending cap, and the last-admin guard (concurrency tested).
- **Credentials.** Stored as ciphertext only, with AAD binding tenant and version and one active row. BYOK writes are version-checked.
- **Demo cleanup.** `cleanup_expired_demos` is service_role only and input-bounded. It deletes only `is_demo` tenants and anonymous users without memberships or history (tested).
- **API exposure.** `[api] schemas = ["public"]` locally and on the preview; GraphQL is off.
- **Secrets hygiene.** `supabase/.env`, `.temp`, `.env*` and `.dev.vars` are gitignored and untracked (`git ls-files`: only `.env.example`). The seed was not applied to the preview (RELEASE.md:17, BUILD-LOG.md:355).

## Coverage
Reviewed fully: the 16 migrations in order, tracking the final definitions of:
- `request_quotes`, `confirm_shipment`, `reconcile_shipment`, the `dispatch_*` family, `record_live_quotes`;
- `guard_shipment`, `before_user_created`, `record_partner_seller_onboarding_outcome`, `start_demo`;
- the DO-block rewrite.

Also reviewed fully: `seed.sql`, both `config.toml` files, all `tests/db` files, spec 05, 06 and 07, the PRD pricing/COD sections, and the Partner research document.

Consumer-side reads, to follow DB outputs across the trust boundary:
- `src/lib/mengantar/partner-onboarding.ts` and `partner-api.ts`
- `src/modules/credentials/actions.ts` and `src/modules/shipments/actions.ts`
- `src/lib/workspace.ts`, `src/lib/auth-actions.ts`, `src/lib/credential-crypto.ts`
- the list pages
- `custom-worker.ts` (cron) and `wrangler.jsonc`

Not reviewed or not executed:
- Nothing was run: no database, tests, EXPLAIN or lint, so perf magnitudes are [INFERENCE].
- Not verified: hosted Supabase role privileges, including whether `postgres` may delete from `auth.users` in hosted, and PostgREST 40001 retry behavior.
- App lane: Worker UI and middleware, rate-limit code, the send-email hook, the e2e and unit suites, and PostgREST filter strings built from search input.
- COD collection policy: who pays `customer_charge_idr` on COD is an open owner decision (PRD:805).
