# GeraiExpress review — Lane SPEC+UX+PROCESS

- Scope: documentation/process consistency, PRD → task → code → test traceability, UX/UI against `10-DESIGN-SYSTEM-WHITELABEL.md` and `17-UX-FLOWS-SCREEN-CONTRACTS.md`, SEO/marketing, e2e coverage.
- Snapshot: HEAD `5f85d86` (clean working tree), reviewed 2026-10-28. Read-only: no build, test, db, e2e, deploy or `delivery-ledger` command was run. Evidence comes from files at HEAD, `git show/log`, and `.delivery/*.jsonl` read with `jq`. Line numbers were checked on disk.
- Counts: **Critical 1 · High 3 · Medium 14 · Low 6** (24 findings). ID prefix `SUP` = Spec/UX/Process.

## Findings

### [Critical] SUP-01 A tenant admin can bind and retrieve another gerai's Partner seller key (cross-lane: Security)
Where: `supabase/migrations/20261027230000_production_readiness_polish.sql:10-56` (esp. `:45`); `supabase/migrations/20261027210000_partner_seller_onboarding.sql:63-155` (`:137` returns the stored `partner_seller_id`), `:158-226`, `:228-275` (`:261`), `:280-300` (`:295` membership-only read), `:335-345` (grants to `authenticated`); `src/lib/mengantar/partner-onboarding.ts:141-176`; `src/lib/mengantar/partner-api.ts:153-155`; `src/modules/credentials/forms.tsx:64,70-87`; `src/modules/credentials/actions.ts:61-80`; `docs/research/geraiexpress-mengantar-partner-api.md:140-152`.
Evidence: `record_partner_seller_onboarding_outcome` is `security definer`, executable by `authenticated`, guarded only by `require_tenant_admin_locked(p_tenant)` (any admin of a real gerai), and sets `partner_seller_id = coalesce(p_seller_id, partner_seller_id)` from the caller's argument (format check only). `begin_partner_seller_onboarding` (also user-callable) creates the row and returns that stored id; `onboardPartnerSeller` then calls `partner.getSellerApiKey(partnerSellerId)` — a Partner-signed `POST {sellerId}` that, per research §6, returns the current key of any seller registered under this Partner — without checking that the seller's `externalUserId` is `geraiexpress:tenant:<tenantId>`. The key is sealed for the caller's tenant and `complete_partner_seller_onboarding` stores it; there is no cross-tenant uniqueness on `partner_seller_id`. The UI exposes the trigger: state `registered_key_pending` renders "Ambil kunci API". A victim seller id is readable by any member, operator included, of the victim gerai through `partner_onboarding_status` and is shown on `/pengaturan`.
Impact: Gerai A's admin calls `begin_partner_seller_onboarding`, then `record_partner_seller_onboarding_outcome(A, 'registered_key_pending', <B's seller id>)`, then clicks "Ambil kunci API". From then on, A's workspace quotes, issues and pays (`pay-unpaid`) against gerai B's Mengantar account and balance. This breaks DEC-006, TEN-3, the PR-18 acceptance ("other tenants cannot … invoke Partner retrieval/rotation for it") and the AGENTS.md Data API/RPC boundary rule. It works anywhere Partner onboarding is configured (`MENGANTAR_ENV=sandbox` + Partner secret, e.g. `env.staging`). The production Partner path is blocked today only by the sandbox-only check (`partner-onboarding.ts:115`). [INFERENCE] If Mengantar seller ids are ObjectId-like, they are also partly predictable.
Recommendation: Make the outcome and complete RPCs `service_role`-only, called by the Worker machine identity like `dispatch_*`. Never accept a seller id from a user-callable RPC. Before `getSellerApiKey`, resolve the seller with `listSellers({ externalUserId: 'geraiexpress:tenant:'+tenantId })` and require an exact match. Add a unique partial index on `partner_seller_id`. Project `partner_seller_id` to tenant admins only.
Verify: A DB test shows the outcome RPC refusing `p_seller_id` from a tenant admin. A unit test shows onboarding with a seller whose `externalUserId` differs is refused before `getSellerApiKey`. A DB test shows two tenants cannot hold the same `partner_seller_id`.

### [High] SUP-02 Public marketing publishes unverified commercial terms copied from the legacy reference
Where: `src/lib/marketing-data.ts:60-64` (`MENGANTAR_DISCOUNT_TIERS`), `:94-139` (`estimateCommission`), `:183-198` (`codSample`, "fee COD Mengantar 3,33%"); `src/app/page.tsx:22-36` (indexed title/description "Komisi 20%–25% … Gratis"), `:38-43`, `:88`, `:97-105`, `:123-125`, `:171-180`, `:229`; `src/app/simulasi/page.tsx:38-62` (FAQ), `:85-92`; `src/components/marketing/profit-simulator.tsx`; tests that lock the numbers in: `tests/unit/marketing-rebrand.test.ts:72-98`, `tests/e2e/marketing.spec.ts:9-13`.
Evidence: The 20/22.5/25 % tiers and the 333-bps COD gross-up are hard-coded. The site also states a Mengantar partnership ("dikembangkan bersama tim Mengantar"), daily COD payout at 19.45/20.00 WIB, free return shipping, an insurance rule ("< Rp500 ribu gratis; di atasnya Rp1 ribu") and "Gratis". Its stated source is "ketentuan diskon resmi Mengantar (dibaca Oktober 2026)", but the link points only to the `mengantar.com` root. No research note, DECISIONS.md row or BUILD-LOG entry records these terms. A repo grep finds them only in `docs/spec/reference-scan.json:4545`, the legacy branch commit "show only the 20%–25% discount tiers (T-299)". The canonical documents say the opposite:
- `02-PRD.md:809` keeps the commission/free model as an open owner decision due "Before commercial offers".
- PR-22 (`02-PRD.md:600`) says "Historical 333-bps/VAT/discount assumptions … are not accepted current policy".
- PR-23 (`:609`) says "No arbitrary local subsidy or commission is created".
- `docs/research/geraiexpress-reference-pricing-review.md:232` says no commission or discount-share entitlement exists.
- AGENTS.md says "Never import a historical fee percentage as a default".
- Insurance and goods-value rules are an open gate (`STATUS.md:71-72`, `RELEASE.md:57-58`).
Impact: An indexable public site promises earnings per package, month and year, free service, fee/insurance/payout terms and a Mengantar partnership. The product cannot guarantee these and the owner has not accepted them. This creates advertising/consumer-protection and partner-relationship risk, and contradicts DEC-003 (seller discount follows verified activated terms).
Recommendation: Remove the numeric commission, fee, insurance, payout and partnership claims (or unpublish `/simulasi`) until an owner DEC records the provider source, effective date and approval. Any simulator should take a user-entered discount with no default %. Add the decision to DECISIONS.md and a PRD requirement for the public site (see SUP-09).
Verify: grep of `src/` for `22,5%|3,33|333n|dikembangkan bersama|cair setiap hari|mengasuransikan` returns only DEC-backed copy. A docs/research note cites the provider terms document. Marketing tests assert the approved copy.

### [High] SUP-03 Marketing advertises features that are not implemented or are explicitly gated
Where: `src/app/fitur/page.tsx:34-44,52-74,87-97,101-104`; `src/app/cara-kerja/page.tsx:33-35,41-46,49-62`; `src/app/page.tsx:24,30,92,119-136,175,219-220,243`; `src/lib/marketing-data.ts:36-50`.
Evidence, claim by claim against the code:
- **Pickup scheduling** ("Jadwalkan penjemputan … kurir datang", "pilih penjemputan dan jamnya"): orders are drop-off only. `src/lib/mengantar/public-api.ts:465` says "Only drop-off is offered for now; scheduled pickup needs time slots", and `:524` sends `pickup: { …, type: "dropOff" }`.
- **"Berat dan ukuran dihitung … toko tidak menanggung selisih"**: live estimates send weight only and drop the dimensions (SUP-08). `TASKS.md:152` defers volumetric weight; `RELEASE.md:57` says "quotes use actual weight".
- **Thermal label 10×15 / 10×10 with handover proof, gerai name or masking on the label, "Cetak resi + invoice" receipts in 80 mm/A4**: real shipments get no label in the app. `[id]/page.tsx:254` says "Cetak label resmi dari aplikasi Mengantar", and `label/page.tsx:26` redirects non-simulated shipments. No dropshipper field is sent (`public-api.ts:503-540`) and no receipt code exists.
- **WhatsApp resi, "Uang gerai dan Pencairan COD" with CSV, automatic status with a retur page, cancellation**: none exist. A grep of `src/app/(workspace)` and `src/modules` for `wa.me|Pencairan|retur|batal` finds nothing. `/pengaturan` itself shows "Pelacakan status kurir — Belum diaktifkan pada versi ini" and marks dropshipper and label as unverified (`pengaturan/page.tsx:97-101`).
- **Courier lists**:
  - AnterAja is advertised as orderable (`marketing-data.ts:42`, `fitur:34`) but is removed from every live quote (`public-api.ts:36`, `shipments/actions.ts:185`).
  - The "12+ layanan" count includes cargo services (`page.tsx:243`) that the courier allow-list drops (`public-api.ts:20-30,369`).
  - SPX is labelled quote-only (`marketing-data.ts:47-50`) but is orderable (`public-api.ts:28`).
Impact: A prospective gerai is told the product schedules pickups, prints labels and receipts, tracks status and reports COD funds. After sign-up they get drop-off-only issuance with labels printed in the Mengantar app and no tracking. The site is indexed, and the in-app readiness page contradicts it.
Recommendation: Rewrite `/`, `/fitur` and `/cara-kerja` to the implemented scope. Mark roadmap items as such only with owner approval. Derive courier names and counts from `OFFERED_COURIERS` minus `DROP_OFF_UNSUPPORTED` instead of a parallel constant.
Verify: A unit test asserts marketing courier codes ⊆ `OFFERED_COURIERS \ DROP_OFF_UNSUPPORTED`. A copy checklist against ARCHITECTURE's "Present on disk" table passes.

### [High] SUP-04 T-031 recorded as PASS and "full verification" without a green full e2e run or its named release gates
Where: `STATUS.md:3-10,41-43,63` and its "Delivery state machine" section; `TASKS.md:137` (T-031 done-when); `.delivery/runs/RUN-20261027T154818Z-a871bd43.jsonl:1,11,22-30`; `BUILD-LOG.md:699-721` (no "Verified:" line).
Evidence:
- The only broad e2e run in T-031 (4 specs: marketing, shipping, credentials, contacts) exited 1 ("90 passed", line 11).
- After fixes, e2e was re-run only as `-g 'T-025|T-026|T-027|T-028|GeraiExpress'`, which is 12 tests: FAIL at line 22, PASS at line 24. Marketing (9 tests) failed at line 23 and passed at line 25.
- auth-demo, registration, platform, members, settings, auth-mail and the rest of shipping/contacts/credentials were never re-run after T-031 changed `src/app/layout.tsx`, `src/app/page.tsx` (signed-in routing), `custom-worker.ts`, migration 16 and the shared e2e helpers.
- The done-when names `security-check`, `release-manifest` and `rollback-check`. None appears in either 2026-10-27 run (grep: 0 hits), and `requiredChecks` is `[]`.
- The R4 review was APPROVED 18 s after the boundary check (lines 26→27). The reviewer ran on the same model and provider as the implementer (`gemini-4-argon`/google).
- STATUS still claims "Last full verification (2026-10-27, T-031): … Playwright e2e … across 390/768/1280" and `State: AWAITING_DEPLOY_APPROVAL`. That state comes after PRODUCTION_READY, and AGENTS.md requires `production-gate` plus `delivery-ledger verify` for it; neither is recorded.
Impact: The pending deploy approval (T-031 + migration 16) rests on verification that was not executed. Regressions in affected journeys such as `/` routing and the auth flows would ship unseen. The ledger contradicts STATUS.
Recommendation: Run and record the full `pnpm test:e2e`. Run and record the three named gates, or amend the done-when with owner approval. Declare them as required checks on R4 runs. Set STATUS back to VERIFYING until they pass. Add a BUILD-LOG "Verified:" line with counts.
Verify: New ledger events show a full e2e PASS at the reviewed head and `delivery-ledger verify` PASS. STATUS numbers equal the ledger tails.

### [Medium] SUP-05 Task records claim evidence that did not exist for T-026..T-030
Where: `STATUS.md:9`; `TASKS.md:76-81,97,105,129`; `BUILD-LOG.md:683,691-692`; `.delivery/runs/` (no T-026..T-030 run); `git show f059a9a:custom-worker.ts`.
Evidence:
- **No per-task runs.** `STATUS.md:9` says "separate review agents per task (see .delivery runs T-001…T-031)". No run exists for T-026, T-027, T-028, T-029 or T-030. All six tasks ran in a single run labelled `T-025` (requirement PR-22, declared R3, effective R4, one review `218a8a7b`), `RUN-20261027T122627Z-42dca1d4.jsonl:1,19-20`.
- **Hourly cleanup claimed before it existed.** T-030 was marked "PASS, security-reviewed" with evidence "`cleanup_expired_demos` RPC + hourly cron" (`TASKS.md:81`), and `BUILD-LOG.md:683` says "custom-worker.ts runs hourly demo cleanup". At the recording commit `f059a9a`, `custom-worker.ts` contains no cleanup call. It was added in T-031 (`59d1299`).
- **T-030 done-when not met.** `TASKS.md:129` requires "staging/production environment configuration for geraiexpress.com … ready for owner-approved deploy". `wrangler.jsonc` has no production env and no geraiexpress.com route, staging points at the preview database (SUP-07), and there is no staging deploy script.
- **Wrong evidence type for T-026/T-027.** The T-026 and T-027 done-when (`:97`, `:105`) say Playwright proves batch payment, foreign-batch refusal, timeout reconciliation, 200/503/409 onboarding recovery and cross-tenant denial. The e2e only renders the batch card and operator notice (`tests/e2e/shipping.spec.ts:278-330`) and checks consent refusal and operator hiding (`tests/e2e/credentials.spec.ts:42-55`). Those behaviours are proved in unit/db tests.
Impact: The work queue overstates review independence and evidence. A security-reviewed task was accepted on evidence that did not exist, so done-when text cannot serve as a release checklist.
Recommendation: Correct STATUS:9 and the T-026..T-030 rows to cite the combined run. Amend the BUILD-LOG T-030 entry. Reopen T-030's geraiexpress.com/production item as pending. Restate the T-026/T-027 evidence as unit/db, or add the e2e.
Verify: Every `[x]` row maps to a ledger runId, and `git show <recorded head>` contains each cited artifact.

### [Medium] SUP-06 RELEASE.md header is internally inconsistent and does not describe the pending release
Where: `RELEASE.md:3-10,16-17,28,42`; `scripts/deploy-preview.sh:20`; `.delivery/releases/` (empty).
Evidence:
- `Environment: production`, while RELEASE.md:42 and STATUS.md:51-52 say production is not provisioned.
- `Release-ID preview-2026-10-27-c00e9c85` is the already-deployed T-025..T-030 version. STATUS asks for approval of T-031 + migration 16, which has no record of its own (base, enabled changes, rollback).
- `Rollback-Ref` equals `Base` (`f059a9a`), so the rollback points at itself.
- `Rollback-Command` targets `f9bc88ad` (two versions back, T-024/PERF-1 code `d85fa92`) rather than the active `c00e9c85`. It also drops the `env -u CLOUDFLARE_API_TOKEN -u CF_API_TOKEN` guard that `deploy-preview.sh:20` uses.
- `Backup-Proof: snapshot://…` is a non-resolvable pseudo-URI with no supporting BUILD-LOG or ledger entry.
- `Status: READY` disagrees with STATUS `AWAITING_DEPLOY_APPROVAL`.
- The residuals "tracked under TASKS 'Preview hardening'" (`:28`) point to a section that does not exist.
- AGENTS.md requires `delivery-ledger` release snapshots, but `.delivery/releases/` is empty.
Impact: An operator following this record would roll back to the wrong version, possibly with the wrong Cloudflare credentials, and has no proof of a database backup before migration 16. The DEL-1 release-evidence fields ("rollback target and owner") are not met.
Recommendation: Add a release record for the T-031 candidate with Environment `preview`, rollback target `c00e9c85` behind the token-unset prefix, and a note that migration 16 is additive (index plus a widened function). Attach a real backup artifact, or state NOT_REQUIRED with a reason as the previous record did. Add the missing TASKS section. Snapshot the release with `delivery-ledger`.
Verify: `.delivery/releases/<id>.json` exists and `delivery-ledger verify` passes. `wrangler deployments list --env preview` lists the named rollback target.

### [Medium] SUP-07 `env.staging` reuses the preview Supabase project and has no guarded deploy path
Where: `wrangler.jsonc:50-69` (`:53` crons, `:62` SUPABASE_URL, `:65` MENGANTAR_ENV); `infra/supabase-preview/supabase/config.toml:20-21,45-46,78-81`; `docs/spec/15-DEVOPS-CICD-MIGRATIONS.md:24-27` (DEL-1 distinct data); `scripts/deploy-preview.sh:9-12`; `ARCHITECTURE.md:231`.
Evidence: Staging uses the same `SUPABASE_URL` as the preview while turning on the `*/5` cron, `MENGANTAR_ENV: "sandbox"` and a Partner ID. That project's Auth `site_url`, redirect URLs and Send Email Hook URI all point to the preview Worker, and its Auth captcha is off. DEL-1 says demo, sandbox and production use "distinct data, credentials, callback configuration and provider-environment binding". Only `deploy:preview` moves `.env*` aside before the OpenNext build, which bakes `.env*` values into the Worker; staging has no equivalent script. No handoff document mentions the shared project.
Impact: Turning on staging would write live-sandbox seller keys and orders, plus cron and demo-cleanup effects, into the synthetic preview database, and route staging Auth mail and redirects through the preview Worker. A naive staging build can bake local Supabase values into the bundle.
Recommendation: Give staging its own Supabase project and an `infra/` Auth config, or record an owner decision to share. Add a `deploy:staging` script with the deploy-preview guard. Document the environment matrix in RELEASE.md.
Verify: Staging `SUPABASE_URL` differs from the preview's. `pnpm deploy:staging` aborts when env keys are baked into the build.

### [Medium] SUP-08 Intake collects parcel dimensions that live quotes silently discard
Where: `src/modules/shipments/intake-form.tsx:228-235`; `src/modules/shipments/actions.ts:156-176`; `src/lib/mengantar/public-api.ts:77-86,181-194,402-435`; `supabase/migrations/20261013170000_foundation.sql:455`.
Evidence: `liveQuotes` builds `dims` and spreads it into `client.estimate(...)` and `estimateTwoPassCod`. `EstimateRequest` has no dimension fields, and `estimate()` sends only `origin_id`, `destination_id`, `courier`, `weight` and `COD_AMOUNT` (`:187-193`). TypeScript does not reject properties coming from a spread, so the values are dropped without any error. The intake form presents Panjang/Lebar/Tinggi with no caveat. Simulated tariffs do use dimensions, so demo and live behave differently, and marketing claims dimensions are priced (SUP-03).
Impact: Operators believe volumetric weight is quoted. The customer pays the actual-weight tariff while Mengantar may bill the billable weight, and the gerai absorbs the difference; it is flagged only afterwards as `price_mismatch`.
Recommendation: For live gerai, label or hide the dimension fields ("Belum memengaruhi ongkir Mengantar") until the billable-weight rule is verified. Remove the dead `dims`/`discountPercent` plumbing, or add the fields to `EstimateRequest` once the provider contract is confirmed.
Verify: A unit test asserts the estimate request parameters for a draft with dimensions. The live intake copy states the rule.

### [Medium] SUP-09 The canonical spec pack has not been reconciled with accepted decisions or the implementation
Where: `docs/spec/02-PRD.md:3-7` (status), `:405-753` (every requirement "Status: Proposed"), `:513-520`, `:703`, `:798`, `:838-845`; `docs/spec/README.md:1-5,171-172`; `TASKS.md:80,108,116,147-154`; `ARCHITECTURE.md:240-252`.
Evidence:
- **Stale status.** The PRD says requirements "remain Proposed until product decisions are resolved" and "No GeraiExpress application build … exists" (`:840-842`).
- **Resolved items still open.** It lists invite, role and additional-business policy as open (`:798`), which DEC-007/008 resolved.
- **Superseded design.** PR-33 still names "Native custom SMTP is the candidate" (`:703`) after DEC-009; `04-SYSTEM-ARCHITECTURE.md:99,115` was updated but the PRD was not.
- **Contradicts DECISIONS.** Spec README `:171` says "CTX-9 is explicitly a proposal", which contradicts DEC-006.
- **Undocumented features.** No PRD requirement covers the public marketing site, the commission simulator or SEO.
- **Mismapped tasks.** T-029 is mapped to PR-13 "Tenant identity and brand" (workspace branding), and T-028 to PR-10 "Govern tenant membership".
- **Gaps missing from the work queue.** PR-3's customer-sender (dropshipper) identity is never transmitted (`public-api.ts:503-540`) even though T-023 claims PR-3. PR-19 rotation, PR-32 password recovery and insurance (PR-22/UX-5) are absent from TASKS "Deferred". Of those, ARCHITECTURE "Not implemented" mentions recovery and partially rotation.
- **Weak tracing check.** The ledger's spec-traceability check counts 7 tasks (the `### [x]` blocks only), so it cannot see these gaps.
Impact: Two "current" claims exist for the same behaviour, which AGENTS.md forbids. The canonical PRD shows no accepted requirement and a stale decision list. Unimplemented requirements are invisible in the sole work queue.
Recommendation:
- Update the PRD and spec README statuses for DEC-005..010, or add an implementation-status column that points to ARCHITECTURE.
- Add a PRD requirement for the public site with its approved claims.
- Fix the T-028/T-029 mappings.
- Add PR-3 dropshipper, PR-19, PR-32 recovery and insurance to "Deferred" and to "Not implemented".
- Extend the traceability check to cover table-form tasks.
Verify: The traceability check reports 33 tasks. The PRD no longer contains "Native custom SMTP". Appendix A has no "no task / no deferral" rows.

### [Medium] SUP-10 The legacy-brand scrub rewrote evidence records and over-claims "zero references"
Where: `docs/spec/CONTEXT-RECORD.md:18,47,67,140,195,230,434`; `docs/spec/reference-scan.json:2,1519,1528,4448`; `docs/promotion-manifest.json:97-98`; `BUILD-LOG.md:721`; `TASKS.md:137`; `STATUS.md:38`; `tests/unit/marketing-rebrand.test.ts:38-54`; `.delivery/runs/*.jsonl`.
Evidence: Commit `59d1299` replaced verbatim user quotes (`:47` "konsep mirip legacy-reference kita", `:434` "harga kau pelajari legacy-reference") and absolute source paths with a placeholder. The new paths (`/home/ongki/Projects/legacy-reference*` and the manifest source `…/geraiexpress-reference-pricing-review.md`) do not exist, while the original paths still do. `reference-scan.json` keeps the original HEAD hashes against the renamed roots. The same commit also changed the CTX-9/CTX-34 status and evidence-kind fields. `BUILD-LOG.md:721` claims "0 matches across the entire repo", but `git grep -i` finds the term in 12 tracked `.delivery/runs` files, including the T-031 run itself; those files are hash-chained and must not be edited. The unit test scans only `src/` and `public/`.
Impact: The context record and reference scan own the evidence behind decisions. Their excerpts are no longer verbatim and their fingerprints can no longer be re-verified. The "entire repository" claim is false and cannot be made true without breaking the ledger.
Recommendation: Use explicit `[redacted: legacy brand]` markers, or a private mapping, instead of substituted words. Record the redaction in each CTX change history. Restate the claim as "zero in src/, public/ and current docs; immutable ledger excluded".
Verify: Every excerpt either matches its source or carries a redaction marker. The BUILD-LOG/STATUS wording matches the test scope.

### [Medium] SUP-11 PR-20 consent stores placeholder document versions posted by the browser and links no documents
Where: `src/modules/credentials/forms.tsx:82-83,133-134,168-175`; `src/modules/credentials/actions.ts:48-49,74-75`; `src/lib/mengantar/partner-onboarding.ts:9-10,71-82,241-243`; `supabase/migrations/20261027210000_partner_seller_onboarding.sql:79-80,90-94,116`.
Evidence: The checkbox agrees to "Ketentuan Layanan dan Kebijakan Privasi Mengantar" but links neither document. `terms_version` and `privacy_version` are hidden inputs hard-coded to `"2026-10"`, and the server forwards whatever the client posts (`form.get("terms_version") || PARTNER_TERMS_VERSION`). The RPC accepts any 1–64-character string as consent evidence. PR-20 acceptance requires: "unavailable provider-policy documents … no seller is created; accepted onboarding records … document versions". UX-2 requires "links to actual provider Terms/Privacy". `TASKS.md:150` lists the document versions as a production gate, yet T-027 is credited with "PR-20 disclosure & agreement".
Impact: Stored consent identifies no real document and is controlled by the caller. Sandbox sellers have already been created under it.
Recommendation: Hold document URL and version in server configuration and render the links. Ignore versions posted by the client. Fail closed (`configuration_blocked`) when the configuration is unset.
Verify: A posted `terms_version` that differs from the configured one is ignored or refused. An e2e test checks the consent text contains both links.

### [Medium] SUP-12 The Super Admin "Partner ID" setting and secret readiness do not reflect what onboarding uses
Where: `src/app/admin/integrasi/page.tsx:27-33,47-61`; `src/modules/credentials/actions.ts:20-28,115-123`; `src/lib/mengantar/partner-onboarding.ts:11,115`; `supabase/migrations/20261014150000_credentials.sql:30,106-133`; `ARCHITECTURE.md:229`.
Evidence: `/admin/integrasi` stores an audited `private.settings.mengantar_partner_id`, but onboarding uses `workerSecret("PARTNER_ID") ?? DEFAULT_PARTNER_ID` ("ongkirich"). Nothing reads the database setting. The "Partner Secret" badge checks only `MENGANTAR_PARTNER_SECRET`, while onboarding also accepts `GERAIEXPRESS_MENGANTAR_SANDBOX_SECRET`. ARCHITECTURE says the Super Admin "sets the Partner ID and sees binding readiness".
Impact: A governed, audited change has no effect. Readiness can show "Belum dipasang" while onboarding works, or "Terisi" with a different ID from the one signing requests (PR-26).
Recommendation: Pick one source of truth: either the Worker reads the database setting, or the form is removed. Drop the silent default. Compute readiness with the same resolver onboarding uses.
Verify: A unit test shows onboarding signing with the configured ID. Changing the setting either takes effect or the control is gone.

### [Medium] SUP-13 Provider and money actions on the shipment detail page have no pending or duplicate-click state
Where: `src/app/(workspace)/pengiriman/[id]/page.tsx:164-169,202,234-238,259-263,274,282-298`; `src/app/(workspace)/pengiriman/baru/page.tsx:26-28`; `src/modules/credentials/forms.tsx:205-213`.
Evidence: These buttons are plain server-component forms with a bare `<Button type="submit">`: "Kirim sekarang", "Periksa pembayaran", "Periksa status operasi asli", "Bayar batch dari saldo Mengantar", "Siapkan label", "Ubah & coba lagi", "Tutup percobaan" and "Mulai draf baru". None uses `useFormStatus`, and none shows a disabled state, `aria-busy` or progress text, although provider calls can take up to the 10 s timeout. "Bayar batch…" spends the seller's balance in one click, and "Hapus kunci" removes the credential without confirmation. The contracts require this:
- UX-1 step 5: "Disable repeated pending clicks in the UI".
- UI-3: a pending action "retains its label/width and explains progress".
- UX-2: credential management needs explicit effect confirmation.
The intake, confirm-dialog, contacts and members forms already implement pending states.
Impact: Operators get no feedback during slow Mengantar calls and re-click or navigate away. Backend idempotency (DEC-010) prevents duplicate orders, but each extra click adds a provider call and a confusing flash result.
Recommendation: Add a client `SubmitButton` built on `useFormStatus` and use it in these forms. Add explicit confirmation for batch payment and key removal.
Verify: In e2e, double-clicking "Bayar batch…" or "Kirim sekarang" sends one request and shows a pending label.

### [Medium] SUP-14 Users with several gerai cannot switch gerai without signing out
Where: `src/app/pilih-gerai/page.tsx:9-11`; `src/lib/workspace.ts:51-56`; `src/lib/auth-actions.ts:31,68-80`; `src/app/(workspace)/layout.tsx:18-34`.
Evidence: Once `ge_tenant` is set, `loadWorkspace` returns `ready` and `/pilih-gerai` redirects to `/`. The shell shows the gerai name but has no "Ganti gerai" control, so the only way out is "Keluar" and signing in again. `chooseTenantAction` redirects to `/pilih-gerai?galat=1`, but the page ignores `galat`. The UI-3 shell contract assumes a switcher ("identity stays visible beyond the switcher"), and DEC-007 expects identities with several businesses.
Impact: Owners and staff with two gerai must sign out to switch, and a failed choice gives no message.
Recommendation: Show "Ganti gerai" when the user has more than one membership; it clears `ge_tenant` and opens `/pilih-gerai`. Render `/pilih-gerai` for such users even when a gerai is already chosen, and show the `galat` message.
Verify: An e2e test with `multi@geraiexpress.test` switches gerai without signing out and then sees only the new gerai's data.

### [Medium] SUP-15 Marketing pages are indexable on non-production hosts, with canonicals and sitemap pointing to an unprovisioned origin
Where: `src/app/robots.ts:3-25`; `src/app/sitemap.ts:3-11`; `src/app/layout.tsx:4-9`; the metadata of the 5 marketing pages (e.g. `src/app/page.tsx:22-36`); `src/middleware.ts:22`; `STATUS.md:51-52`.
Evidence: robots.txt allows the five routes and advertises `https://geraiexpress.com/sitemap.xml`. Each page emits `index, follow` plus a canonical and OG URL on `geraiexpress.com`. This is identical on every deployment, with no host or environment check, so the preview (workers.dev) and staging serve indexable pages. Production is not provisioned. The middleware also marks these anonymous static pages `private, no-store`.
Impact: Search engines can index the preview hostname, including the claims in SUP-02/03, and are pointed at canonicals that do not serve the app. T-031's "SEO indexation" is not live-ready.
Recommendation: Allow indexing only on the production host or environment. Send `X-Robots-Tag: noindex` and a disallow-all robots.txt on preview and staging. Let anonymous marketing responses be cached at the edge.
Verify: `curl -sI` against the preview shows `X-Robots-Tag: noindex`, and the preview's `/robots.txt` disallows `/`.

### [Medium] SUP-16 Not-found, denied and error states fall back to Next.js English defaults; dialogs use English accessible names
Where: `src/app` (no `not-found.tsx`, `error.tsx` or `global-error.tsx` at any level); `notFound()` callers such as `src/app/(workspace)/pengiriman/[id]/page.tsx:89-93` and the admin/anggota guards; `src/components/ui/dialog.tsx:79,118`; `src/components/ui/sheet.tsx:80`; `node_modules/next/dist/client/components/builtin/not-found.js`.
Evidence: Foreign or unknown shipments, contacts and labels, operator access to `/anggota`, and non-admin access to `/admin` all use `notFound()`; e2e asserts only the 404 status. These render Next's built-in English "This page could not be found." outside the workspace shell, with no link back. Server errors render the default English error page. The dialog and sheet close buttons are announced as "Close". AGENTS.md requires the product UI in Bahasa Indonesia, and UX-1/UX-6 require recoverable, explained denials.
Impact: Operators and screen-reader users hit English dead-ends on common paths: stale links, revoked access and transient Supabase or Mengantar errors.
Recommendation: Add Bahasa `app/not-found.tsx`, `(workspace)/not-found.tsx` with a link back to Pengiriman, and `error.tsx`/`global-error.tsx`. Change the sr-only labels to "Tutup".
Verify: An e2e test asserts the 404 body text and the link back to `/pengiriman`; the close button's accessible name is "Tutup".

### [Medium] SUP-17 Hourly demo cleanup relies on an unconfigured cron string; the trigger path that actually runs is untested and mis-documented
Where: `custom-worker.ts:31-37`; `wrangler.jsonc:19,34,53`; `tests/unit/custom-worker.test.ts:111-131`; `OBSERVABILITY.md:38`; `RELEASE.md:31`; `BUILD-LOG.md:710`.
Evidence: The docs say cleanup runs on "the hourly `0 * * * *` cron", but `wrangler.jsonc` configures only `*/5 * * * *`. In practice the code depends on its fallback `ev.cron === "*/5 * * * *" && scheduledTime % 3_600_000 === 0`. The only test drives `{ cron: "0 * * * *" }`, a trigger that fires in no configured environment. OBSERVABILITY attributes the signal to T-030, but it shipped in T-031. [INFERENCE] Cloudflare documents `scheduledTime` as the nominal time, so the fallback probably fires in production, but nothing proves it.
Impact: The T-031 acceptance is proven only for a code path that never runs. If `scheduledTime` is ever unaligned, demo tenants and anonymous users pile up without any signal.
Recommendation: Add `"0 * * * *"` to the staging/production crons, or drop that branch and test the `*/5` path with aligned and unaligned `scheduledTime`. Fix the docs and the attribution.
Verify: A unit test with `{ cron: "*/5 * * * *", scheduledTime: Date.UTC(2026,9,28,10,0,0) }` calls the RPC; the same time `+300000` does not.

### [Medium] SUP-18 Browser evidence is missing for most recovery and sensitive states the UX contracts require
Where: `tests/e2e/shipping.spec.ts` (covers draft, estimate, simulated confirm, unknown reconcile and the unpaid card render); `tests/e2e/credentials.spec.ts:42-55`; `tests/e2e/live-mengantar.spec.ts:14` (opt-in, skipped by default); `17-UX-FLOWS-SCREEN-CONTRACTS.md:96-101` ("unknown/unpaid status, and denied actions need rendered-browser evidence") and the UX-2 state table.
Evidence: No e2e test clicks "Kirim sekarang", "Ubah & coba lagi", "Tutup percobaan", "Bayar batch dari saldo Mengantar" or "Ambil kunci API". None renders the Partner states `existing_account_required`, `quota_wait`, `provider_restricted` or `configuration_blocked` (grep of `tests/e2e` and `tests/preview`). `shipping.spec.ts` never runs `expectTouchTargets`. Live issuance has browser coverage only in the opt-in spec.
Impact: The recovery UI for real money and provider states, where operator mistakes cost the most, ships without browser proof at 390/768/1280 (NFR-4, UX-1).
Recommendation: Add seeded-state e2e (using `localSql`, as the T-026 test does) for each state and action above, with overflow and touch-target assertions.
Verify: The new specs pass in all 3 projects, and each label above appears in `tests/e2e`.

### [Low] SUP-19 The main marketing CTA leads to closed registration everywhere except local
Where: `src/app/page.tsx:183-187`; `src/components/marketing/marketing-shell.tsx:81-85,115-119,186-190,233-237,291-295`; `src/app/daftar/page.tsx:24-28`; `RELEASE.md:24`.
Evidence: Every "Daftar gratis" link goes to `/daftar`. On the preview, and on any new project, that page says "Pendaftaran gerai baru belum dibuka": registration is closed by default and Auth email fails closed under DEC-009.
Impact: The indexed site's main conversion path dead-ends, leaving only WhatsApp.
Recommendation: When `registration_open()` is false, render the CTA as a contact or waitlist action and keep "Coba demo" prominent.
Verify: On a stack with registration closed, e2e sees the alternate CTA.

### [Low] SUP-20 The registration code step lacks resend and change-email controls and field-linked errors
Where: `src/app/daftar/forms.tsx:59-69`.
Evidence: After a code is sent, only the code field and "Salah alamat? Muat ulang halaman ini." remain. There is no resend action or expiry/resend information, and code errors appear in a top-level `role=alert` without `aria-invalid`/`aria-describedby` on `#reg-code`. UX-7 asks for change-email and rate-limited resend; UI-5 asks for "resend availability" and focus on the useful result.
Impact: A user who misses the email must reload and start over, and screen-reader users do not get the error tied to the field.
Recommendation: Add "Kirim ulang kode" (same action, Turnstile and OTP limiter) and "Ganti email", and bind the error to the input.
Verify: An e2e test covers resend and change-email.

### [Low] SUP-21 Marketing surfaces bypass the UI-2 semantic tokens and type scale
Where: `src/app/page.tsx:165-229`; `src/app/cara-kerja/page.tsx:117-170`; `src/components/marketing/marketing-shell.tsx:226-229,270-283`; `src/app/globals.css:7-17,94-105`; `src/app/(workspace)/pengiriman/[id]/page.tsx:230`; `src/modules/shipments/intake-form.tsx:245`.
Evidence: Dark surfaces use per-screen hex literals (`bg-[#1d1d1f]`, `text-[#cccccc]`, `text-[#2997ff]`, `bg-[#272729]`); these are palette values, but no CSS variable exists for them. Headings use Tailwind default sizes (`text-lg/2xl/5xl` = 18/24/48 px) that are not on the UI-2 scale. `font-medium` (weight 500) appears in workspace UI. The UI-2 acceptance says "semantic references rather than per-screen hex values" and "Do not introduce 500".
Impact: Theme or brand changes cannot reach these surfaces, and the type scale drifts from the accepted system.
Recommendation: Add tile, body-muted and primary-on-dark tokens, map the extra text sizes to the UI-2 scale, and replace 500 with 400 or 600.
Verify: grep of `src/` for hex literals finds only `globals.css`, the viewport `themeColor` and the barcode `fill`.

### [Low] SUP-22 `.env.example` lists secrets that must never be in `.env*` and omits the real bindings
Where: `.env.example:1-9`; `scripts/dev-env.sh:8-11,27`; `scripts/check-client-bundle.mjs:52-63`.
Evidence: It lists `CREDENTIAL_KEY=` and `MENGANTAR_PARTNER_SECRET=` as "server-only configuration". dev-env.sh says `CREDENTIAL_KEY` "must never go into .env.local", and check:bundle fails if either name is baked into the build. Bindings the app actually reads are absent: `SUPABASE_SECRET_KEY`, `MENGANTAR_ENV`, `TURNSTILE_SITE_KEY`, `SEND_EMAIL_HOOK_SECRET`, `MAIL_TRANSPORT`, `MAIL_FROM` and `PARTNER_ID`.
Impact: Copying the example creates a hazard that only check:bundle catches, and there is no inventory of the required bindings.
Recommendation: Keep only the two public variables in `.env.example`, and add a `.dev.vars.example` that lists binding names without values.
Verify: `.env.example` contains no secret names.

### [Low] SUP-23 Status numbers and references are stale or inconsistent across docs
Where: `ARCHITECTURE.md:6,29`; `README.md:5`; `STATUS.md:43`; `BUILD-LOG.md:691-692`; `RELEASE.md:28`; `DECISIONS.md:3`; `TASKS.md:69-72`; `src/app/api/mengantar/area/route.ts`.
Evidence:
- **Stale headers.** ARCHITECTURE and README still say "T-001 through T-030".
- **Incomplete route map.** ARCHITECTURE's runtime map omits `/anggota`, `/daftar`, `/undangan`, `/verifikasi-2fa`, `/admin/*`, and the Worker route `/api/mengantar/area`, which calls Mengantar with the tenant key.
- **Mismatched counts.**
  - STATUS says "145 declarations" where the T-031 ledger records 146.
  - BUILD-LOG says "12 files" (unit) and "10 files" (db), while commit `f059a9a` has 14 and 13.
- **Dangling reference.** RELEASE cites a non-existent TASKS section.
- **Unrecorded decision.** The 2026-10-26 owner direction (standalone brand on geraiexpress.com) exists only in the TASKS preamble; DECISIONS.md was last updated 2026-10-14.
Impact: The handoff documents disagree with the code and with each other.
Recommendation: Refresh the headers and maps, copy numbers from the ledger, add a DEC for the brand/domain/marketing direction, and add the preview residuals to TASKS.
Verify: grep finds no "T-001 through T-030", and the counts equal the ledger.

### [Low] SUP-24 Minor accessibility, usability and observability gaps
Where: `src/app/(workspace)/pengiriman/page.tsx:154-155`; `src/app/(workspace)/pengiriman/[id]/page.tsx:114`; `OBSERVABILITY.md:40-48`; `RELEASE.md:62-66`.
Evidence:
- **Unlabelled scroll region.** The queue table (min-width 780 px) scrolls horizontally at 768 px inside an unlabelled, non-focusable `div`; NFR-4 allows scrolling only "in a labelled local region".
- **Silent contact cap.** The intake contact pickers load at most 300 contacts, with no notice or search.
- **No probes or alerts.** OBSERVABILITY defines no `Probe:` line, even for the deployed `/healthz`. None of the alerts in RELEASE item 4 exist (a stated production gate), and the preview has crons off, so `dispatch_sweep`/`demo_cleanup` never emit there.
Impact: Keyboard users at tablet width cannot scroll the table region directly, contacts beyond 300 are silently hidden from the picker, and nothing signals health even on the preview.
Recommendation: Give the scroll region `role="region"`, `aria-label` and `tabIndex={0}`. Show a truncation notice or search beyond 300 contacts. Add a healthz `Probe:` line once the owner sets a latency target.
Verify: An axe scan at 768 px is clean, and seeding 301 contacts shows the notice.

## Checked and SOUND (brief)

- **UI-2 tokens in the workspace.** `globals.css:7-49` maps the palette and the shadcn semantic variables exactly as the spec table does: parchment canvas, ink, ink-80 muted text, ink-48 control edge, single-blue primary, `#0071e3` ring. The radius scale (5/8/11/18) and type scale (12/14/17/21/34) match. Focus is a 2 px ring with offset (`:118-121`). Press-scale applies only under `prefers-reduced-motion: no-preference` (`:127-131`). There are no shadows or gradients anywhere in `src/`. Hand-computed contrast passes for primary on white (≈5.6:1), `#7a7a7a` control edge on white (≈4.3:1, needs 3:1), and `#cccccc`/`#2997ff` on `#1d1d1f` (≈10.5:1 and ≈5.6:1).
- **State cues.** `status-badge.tsx` uses a neutral surface with icon and text. Errors use ink, a ⚠ glyph and text, never colour alone. The selected quote shows a ring, a check icon and the word "Dipilih".
- **Demo (PR-21/UX-3) and simulation labelling are consistent end to end:**
  - a persistent `role=status` banner "Demo · Simulasi";
  - "Harga contoh (simulasi)" on quotes and "(simulasi)" on the AWB;
  - confirm-dialog copy for simulation versus live issuance;
  - a watermarked "CONTOH — BUKAN LABEL KURIR" label;
  - demo-restricted settings, reset and exit.
  The `/masuk` demo entry is reachable from every marketing page. The CAPTCHA gate keeps buttons focusable (`aria-disabled`) and explains the wait.
- **Forms.** Inputs are labelled; field errors use `aria-invalid` and `aria-describedby`; values survive errors. Stale-revision conflicts keep typed input (contacts, intake). Saving a contact is an explicit checkbox (UX-1 step 2). A stale quote disables service selection with a reason.
- **Queue.** Search, status filter and pagination work. Empty, filtered-empty, failed-load and out-of-range states are distinct. A "Perlu ditindaklanjuti" list is shown. Times are WIB and IDR amounts are tabular and right-aligned. The PostgREST `or()` input is sanitised.
- **Shells.** Skip links, `lang="id"`, labelled navs and `aria-current` are present. The mobile sheet keeps the gerai/outlet scope visible. The admin shell carries an explicit "Super Admin" context.
- **Honest live copy.** It warns that real orders debit the Mengantar balance, sends users to the Mengantar app for real labels, and tells them not to create new shipments for unknown or unpaid outcomes.
- **SEO basics.** App routes default to `noindex` (`layout.tsx:8`). robots.txt disallows the app paths. The 5 marketing pages carry canonical, OG and `locale id_ID`. Indexing itself is not environment-gated (SUP-15).
- **Legacy brand.** There are zero case-insensitive matches in `src/`, `public/`, `docs/` or the root docs. The only matches are in the immutable `.delivery` ledger (SUP-10).
- **Hygiene.** `.env*`, `.dev.vars` and `supabase/.env` are gitignored and untracked (`git check-ignore`, `git ls-files`). Only `.env.example` is tracked.
- **Numbers that match disk:**
  - 16 migrations on disk, consistent with "15/16 applied remotely".
  - `tests/db` has 115 `it`/`test` occurrences, as claimed.
  - Pins match DEC-005 (Next 16.3.8, OpenNext 1.20.10).
  - Keeping `middleware.ts` rather than Next 16's `proxy.ts` is documented (`BUILD-LOG.md:69-70`; Next guide `version-16.md:612-625`).
- **Error copy.** Every error code the Mengantar, dispatcher and onboarding paths raise has a Bahasa message in `src/lib/errors.ts`.

## Appendix A — Requirement → task → code → test traceability

Status legend: Implemented / Partial / Not implemented / Implemented-but-undocumented. "Deferred" means the item is listed in TASKS.md:147-154.

| Req | Summary | Task(s) | Code (primary) | Tests | Status | Notes |
|---|---|---|---|---|---|---|
| PR-1 | Tenant workspace access | T-002, T-003, T-003b | `lib/workspace.ts`; RLS (foundation migration) | db isolation; e2e auth-demo (forged cookie, two memberships) | Implemented | no in-session switch (SUP-14) |
| PR-2 | Save/reuse contacts | T-004, T-028 | `modules/contacts`; `(workspace)/kontak` | db isolation, contact-archive; e2e contacts | Implemented | retention open; picker cap 300 (SUP-24) |
| PR-3 | Customer sender vs pickup | T-023 (claimed) | pickup: `modules/mengantar`; `createOrderBody` sends no sender/dropshipper | none reference PR-3 | Partial | dropshipper never sent; no task or deferral (SUP-09) |
| PR-4 | Compare services | T-005, T-008, T-019, T-023, T-025 | `public-api.ts` parse/two-pass COD; `shipments/actions.ts` liveQuotes | unit public-api; db live-quotes; e2e shipping (sim); live e2e opt-in | Implemented (actual weight) | dims dropped (SUP-08); volumetric deferred |
| PR-5 | Issue & recover | T-005, T-021, T-022, T-024, T-025, T-026 | `lib/mengantar/dispatcher.ts`; issuance/dispatcher/COD migrations | unit dispatcher/orders; db dispatcher/issuance/cod-and-payment; e2e shipping | Implemented | recovery UI without e2e (SUP-18) or pending state (SUP-13) |
| PR-6 | Labels | T-006, T-024 | `[id]/label` (simulated only) | e2e label reuse/print | Partial | provider PDF deferred (HTTP 403) |
| PR-7 | Party snapshots | T-005 | `confirm_shipment` snapshot; detail "dibekukan" | db shipment-flow/dispatcher; e2e shipping | Implemented | — |
| PR-8 | Readiness | T-007, T-015, T-023 | `(workspace)/pengaturan` | e2e settings, credentials | Implemented | sender/label/tracking shown unverified/blocked |
| PR-9 | Queue & detail | T-003, T-024 | `pengiriman/page.tsx`, `[id]/page.tsx` | e2e shipping, auth-demo | Implemented | — |
| PR-10 | Membership governance | T-014 (T-028 mislabelled) | `modules/members` | db invitations; e2e members | Implemented | T-028 mapped here incorrectly |
| PR-11 | CSV preview | — | — | — | Not implemented | Deferred |
| PR-12 | Tracking | — | — | — | Not implemented | Deferred; marketing claims auto status (SUP-03) |
| PR-13 | Tenant identity/brand | T-003 (T-029 mislabelled) | `(workspace)/layout.tsx` gerai/outlet names | e2e auth-demo | Partial | no logo/branding; marketing task mapped here |
| PR-14 | Daily overview | — | attention list only | — | Not implemented | Deferred |
| PR-15 | Tenant lifecycle | T-012, T-013 | `admin/*`, platform RPCs | db platform/registration; e2e platform | Implemented | — |
| PR-16 | Export | — | — | — | Not implemented | Deferred; marketing claims CSV (SUP-03) |
| PR-17 | Partner onboarding | T-020, T-027, T-031 | `lib/mengantar/partner-onboarding.ts` | unit+db partner-onboarding; e2e consent only | Implemented (sandbox) | cross-tenant seller binding (SUP-01) |
| PR-18 | BYOK | T-015, T-027 | `modules/credentials` | db credentials; e2e credentials | Implemented | ownership proof pending (documented) |
| PR-19 | Key rotation/recovery | — | 503 key recovery only | — | Not implemented | no task and no deferral entry |
| PR-20 | Disclosure & consent | T-027 | `credentials/forms.tsx` consent | db/unit partner-onboarding | Partial | no document links; placeholder versions (SUP-11) |
| PR-21 | Demo login | T-003, T-009, T-010, T-011, T-018 | `masuk`, `startDemoAction`, `start_demo` | e2e auth-demo; preview smoke | Implemented | — |
| PR-22 | Prices & private net cost | T-005, T-023, T-025 | `record_live_quotes`; COD migration | db cod-and-payment/shipment-flow; unit | Implemented (no insurance) | insurance rule unknown; marketing fee claims (SUP-02) |
| PR-23 | Seller discount admin | — | — | — | Not implemented | ARCHITECTURE gated; marketing publishes tiers (SUP-02) |
| PR-24 | Super Admin access | T-012 | `lib/platform.ts`; `verifikasi-2fa` | db platform; e2e platform | Implemented | — |
| PR-25 | Platform health | — | — | — | Not implemented | ARCHITECTURE gated |
| PR-26 | Integration readiness | T-015, T-031 | `admin/integrasi` | db credentials; e2e credentials | Partial | Partner ID setting not consumed (SUP-12) |
| PR-27 | Super Admin reconciliation | — | tenant-admin reconcile only | — | Not implemented | ARCHITECTURE gated |
| PR-28 | Audit | T-012 | `audit_events`; `admin/audit` | db platform; e2e platform | Implemented | — |
| PR-29 | Verified registration | T-013, T-016, T-017 | `daftar`; `registration-actions.ts` | db registration; e2e registration | Implemented (local) | production mail gated; no resend (SUP-20) |
| PR-30 | Gerai application | T-013 | `daftar/gerai`; `admin/pengajuan` | db/e2e registration | Implemented | — |
| PR-31 | Staff invitations | T-014 | `modules/members`; `undangan` | db invitations; e2e members | Implemented | — |
| PR-32 | Recovery & routing | T-003, T-013, T-029 | `app/page.tsx` Home routing | e2e marketing/registration/members | Partial | password recovery absent; not deferred |
| PR-33 | Auth email | T-017 | `api/auth/send-email`; `lib/auth-mail.ts` | unit auth-mail; e2e auth-mail | Partial | production transport fails closed; PRD still names SMTP |
| NFR-1 | Isolation proof | T-002…T-028 | RLS/RPC guards | db suites; cross-tenant e2e | Implemented (gap) | Partner seller path (SUP-01) |
| NFR-2 | Duplicate/interrupted ops | T-005, T-022, T-024, T-026 | idempotency keys; dispatcher | db/unit; e2e double-confirm, stale tab | Implemented | — |
| NFR-3 | Private payloads | T-001, T-015, T-030 | `check-client-bundle.mjs`; no-store middleware; count-only logs | unit middleware; check:bundle | Implemented | — |
| NFR-4 | Browser proof | all UI tasks | — | e2e at 390/768/1280 | Partial | recovery states, touch targets, zoom/reduced-motion (SUP-18/24) |
| NFR-5 | Partner network | T-020 | `partner-api.ts` signing | unit partner-api | Partial | production egress gated |
| DEL-1 | Release stages | T-018, T-030, T-031 | `wrangler.jsonc` envs; `deploy-preview.sh` | preview smoke | Partial | staging shares preview data (SUP-07); release record (SUP-06) |
| UX-1/UX-4 | Counter journey | T-003…T-006, T-024 | intake/detail | e2e shipping | Partial | pending states, gerai switch (SUP-13/14) |
| UX-2 | Seller onboarding UX | T-015, T-027 | credentials forms | e2e credentials (consent) | Partial | doc links (SUP-11); states untested (SUP-18) |
| UX-3 | Demo UX | T-003, T-006, T-007 | layout banner; label watermark | e2e auth-demo/settings | Implemented | — |
| UX-5 | Normal tariff vs private net | T-005, T-025 | quote chips; confirm dialog | e2e shipping | Implemented (no insurance) | — |
| UX-6/UI-4 | Super Admin UX | T-012…T-015 | `admin/*` | e2e platform/credentials | Partial | Overview/Diskon/Operasi workspaces absent |
| UX-7/UI-5 | Registration UX | T-013 | `daftar/*` | e2e registration | Partial | resend/change email (SUP-20) |
| UX-8 | Staff/login/recovery | T-003, T-014 | `masuk`, `undangan` | e2e members | Partial | password recovery absent |
| UI-1..UI-3 | Presentation | T-001, T-003, T-029 | `globals.css`, `components/ui` | e2e focus/touch/overflow | Implemented (workspace) | marketing drift (SUP-21); English defaults (SUP-16) |
| (none) | Public marketing, simulator, SEO | T-029, T-031 | `app/{page,fitur,simulasi,cara-kerja,hubungi-kami}`, `robots.ts`, `sitemap.ts` | unit marketing-rebrand; e2e marketing | Implemented-but-undocumented | no PRD requirement or DEC (SUP-02/03/09/15) |
| (none) | `/api/mengantar/area` Worker route | T-023 | `app/api/mengantar/area/route.ts` | live e2e opt-in only | Implemented-but-undocumented (ARCHITECTURE) | SUP-23 |
| (none) | Demo cleanup | T-030 (claimed) / T-031 | migration `20261027220000`; `custom-worker.ts` | db cleanup; unit (unconfigured cron) | Implemented | SUP-05, SUP-17 |

Requirements with no implementing task and no deferral entry: **PR-3 (dropshipper part), PR-19, PR-32 (password recovery), insurance (PR-22/UX-5)**. PR-23, PR-25 and PR-27 appear only in ARCHITECTURE "Not implemented", not in TASKS.

## Coverage

**Reviewed:**
- **Root docs:** AGENTS.md, STATUS.md, TASKS.md, DECISIONS.md, ARCHITECTURE.md, RELEASE.md, OBSERVABILITY.md, README.md, PRD.md, and BUILD-LOG.md (T-025..T-031 sections plus targeted greps).
- **Spec and research:**
  - `docs/spec/02-PRD.md`: all PR/NFR requirements and the open-question tables.
  - Full reads: `10-DESIGN-SYSTEM-WHITELABEL.md`, `17-UX-FLOWS-SCREEN-CONTRACTS.md`, `15-DEVOPS-CICD-MIGRATIONS.md` and spec `README.md`.
  - Partial reads: `16-OBSERVABILITY-RATE-LIMITING.md` (OBS-1), `04-SYSTEM-ARCHITECTURE.md` (DEC-009 parts), and research partner/public API (targeted sections).
  - Diffs: CONTEXT-RECORD, reference-scan and the promotion manifest in commit `59d1299`.
- **Delivery evidence:** `.delivery/current.json`; the task mapping of all 30 runs; every event of the two 2026-10-27 runs; `.delivery/releases/`.
- **Config:** `wrangler.jsonc`, `.env.example`, `.gitignore` and `infra/supabase-preview` Auth config (targeted).
- **Runtime entry and scripts:** `custom-worker.ts`, `scripts/dev-env.sh`, `scripts/deploy-preview.sh`, `scripts/check-client-bundle.mjs`.
- **UI and app code:**
  - Pages: all marketing pages; workspace layout; pengiriman list, baru, `[id]` and label; kontak list; pengaturan; masuk; daftar and its forms; pilih-gerai; akses; admin layout; admin integrasi; the area API route.
  - Components and styles: marketing shell, simulator, status badge, navs, Turnstile, UI primitives, `globals.css`, `middleware.ts`, `robots.ts`, `sitemap.ts`, root layout.
  - Library and modules: `marketing-data.ts`, `workspace.ts`, `auth-actions.ts`, `errors.ts`, `format.ts`, `mengantar/public-api.ts` (estimate/create-order), `partner-onboarding.ts`, `partner-api.ts` (key retrieval), `tenant.ts`; the intake form, the shipments actions (live quotes), credentials forms/actions, and the area picker.
- **Migrations:** `20261027210000` and `20261027230000` in full; others targeted (foundation dims, credentials Partner ID, invitations admin guard, COD changes).
- **Tests:** `marketing-rebrand` and `custom-worker` unit tests; e2e helpers, marketing, credentials (Partner) and shipping (COD, batch); every e2e title; per-file test counts.

**Not reviewed (other lanes or out of time):**
- Pages: anggota, kontak/[id], undangan, verifikasi-2fa, daftar/gerai, daftar/kata-sandi, admin akses/audit/pengajuan.
- Migrations 1–12 and RLS correctness (DB lane).
- `dispatcher.ts`, `auth-mail.ts`, `rate-limit.ts` and the rest of `partner-api.ts` (integration/security lanes).
- Specs 03/05/06/07/11/12/13 in depth; the research docs in full.
- Nothing was executed at runtime: no browser, no axe/contrast tooling (contrast was computed by hand for 4 token pairs), and no `delivery-ledger verify`, so ledger hash-chain integrity is unverified.
- SUP-01 is a cross-lane finding: the security lane should confirm it against the live sandbox Partner API.
