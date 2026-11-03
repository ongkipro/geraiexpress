# GeraiExpress — UI/UX and Admin Menu Audit

**Date:** 2026-11-03  
**Method:** Read-only source audit of the current working tree.  
**Audiences:** Admin Gerai (`tenant_admin`), Operator, and Super Admin.

No files were edited. No tests, servers, containers, database operations, authenticated browser sessions, provider calls, or secret/env-file reads were performed. Another job owns runtime verification. Findings below distinguish source-confirmed behavior from items requiring rendered-browser verification or an owner decision.

## Review

- **Correct:** Tenant and platform navigation are separate, mobile navigation receives the same filtered menu items as desktop, and primary menu links have accessible names, current-page state, and 44px minimum heights.
- **Correct:** Cargo service identity is exposed as **“Kargo”** through the stored quote’s service name. The new declaration mechanism has a server/database enforcement boundary; its remaining UI issues are not evidence of an authorization bypass.
- **Fixed:** None; this audit was read-only.
- **Findings:** **2 P1**, **8 P2**, plus separately identified contract/IA gaps. No P0 found.
- **Merge verdict: BLOCK** for release-level UX acceptance until F1–F2 are addressed. This is not a certification or rejection of the separate verification job’s final build.

## 1. Prioritized confirmed findings

### F1 — P1: Contact search silently changes the selected shipping service

**Type:** Confirmed state/data-selection defect.

**Evidence**
- `src/modules/shipments/intake-form.tsx:116` resets `quoteId` to the first quote whenever the `props.quotes` array changes.
- Contact search navigates with `router.replace`, preserving the component’s unsaved form state: `src/modules/shipments/intake-form.tsx:122–131`.
- The server reconstructs quote options on that render and orders quotes by customer charge: `src/modules/shipments/draft-intake.tsx:36–41,68–71`.
- Confirmation uses the resulting selected quote: `src/modules/shipments/intake-form.tsx:189–191,444–453`.

**Failing scenario:** Staff selects the second courier/service, then uses “Saring kontak” without changing the parcel. The refreshed quote array resets the choice to the first, cheapest row. The service previously chosen by the operator is no longer selected, without an explicit service-change warning.

**Contract/task:** UX-4 explicitly says never silently replace the selected service or price; UX-1 review/state preservation. Regression coverage belongs with shipment UI/T-053 and intake interaction work/T-072.

**Smallest fix:** Preserve the selected quote ID while that ID remains in the refreshed valid quotes. If it disappears, invalidate the selection or explicitly announce that reselection is required. Do not silently select another service after an unrelated contact search.

---

### F2 — P1: Overview copy directs users to external payment without checking an unresolved payment attempt

**Type:** Confirmed unsafe recovery guidance; not a demonstrated backend double-payment bypass.

**Evidence**
- Dashboard awaiting-payment tile says **“Bayar di aplikasi Mengantar”**: `src/modules/dashboard/stats.tsx:48–50`.
- The shipment-list tile repeats it: `src/app/(workspace)/pengiriman/page.tsx:91–94`.
- Those counts use shipment state alone, not batch-payment-attempt state: `src/modules/dashboard/load.ts:72–81` and `src/app/(workspace)/pengiriman/page.tsx:65–67`.
- The detail screen explicitly explains why operators must **not** receive that instruction: they cannot determine whether a payment attempt is unresolved. It instead says not to pay independently in Mengantar: `src/modules/shipments/detail-next-step.tsx:83–96`.

**Failing scenario:** A payment response is lost and the shipment remains `awaiting_payment`. An operator sees the dashboard/list instruction and pays in Mengantar even though the original payment command may already have succeeded. The safe detail-page guidance is contradicted before the operator opens it.

**Contract/task:** UX-1 unpaid-state contract; UX-13 ambiguous payment must reconcile rather than repeat. T-033, T-053, and T-056 recovery work.

**Smallest fix:** Replace both generic hints with **“Periksa pembayaran batch”** or **“Minta admin memeriksa pembayaran”**. Keep any instruction to pay externally inside the authorized, original-batch review flow where the attempt state is known.

---

### F3 — P2: Several failed reads are presented as true empty, missing configuration, or nonexistent records

**Type:** Confirmed error-state/data-truthfulness defect.

**Evidence**
- Members/invitations discard both RPC errors and default to empty lists: `src/app/(workspace)/anggota/page.tsx:28–33`. An invitation-read failure becomes **“Tidak ada undangan yang menunggu”** at lines `90–96`.
- Integration reads discard errors; a failed Partner-config read becomes an empty Partner ID and a failed seller read becomes **“Belum ada gerai terdaftar”**: `src/app/admin/integrasi/page.tsx:42–50,108–109`.
- Discount detail discards errors from overview/history/observations/template; a failed overview becomes `notFound()`: `src/app/admin/diskon/[tenant]/page.tsx:24–35`.
- Settings discard initial status/tenant-read errors and synthesize disconnected/default state: `src/app/(workspace)/pengaturan/page.tsx:59–79`.

**Failing scenario:** During a transient Data API failure, Super Admin is told there are no registered sellers or no Partner ID; Admin Gerai is told there are no invitations. These are materially different from “could not load.”

**Contract/task:** UX-1, UX-6, UX-12 distinguish true empty, partial, error, missing, and denied states. T-012/T-013, T-041, T-069, T-077.

**Smallest fix:** Retain and handle each read’s `error`. Render a scoped Bahasa load-error/retry state and withhold configuration-changing forms whose prerequisite state failed to load. Reserve empty/404 states for successful reads establishing absence.

**Positive comparison:** Contacts and the main shipment list already distinguish query error from empty results: `src/app/(workspace)/kontak/page.tsx:85–91` and `src/app/(workspace)/pengiriman/page.tsx:219–225`.

---

### F4 — P2: An integration-only Super Admin lands on a false “no page” message

**Type:** Confirmed capability-to-entrypoint mismatch.

**Evidence**
- `/admin` redirects users without `tenant_governance` to access or audit pages, but has no integration-capability branch: `src/app/admin/page.tsx:56–65`.
- The fallback says **“Kemampuan Anda belum memiliki halaman di versi ini.”**
- That same capability has two existing, authorized menu destinations: `src/app/admin/layout.tsx:13–14`.
- `/admin/integrasi` explicitly accepts it: `src/app/admin/integrasi/page.tsx:40`.
- Successful TOTP verification redirects everyone to `/admin`: `src/lib/platform-actions.ts:65–66`.

**Failing scenario:** A user granted only `integration_operations` completes authentication and is told their capability has no page, despite “Integrasi Mengantar” and “Diskon gerai” appearing in the menu.

**Contract/task:** UX-6 permitted workspace entry; IAM-7 capability-bound access. T-012 and T-077.

**Smallest fix:** Add an `integration_operations` landing redirect to `/admin/integrasi`. Prefer a shared first-permitted-destination helper so login and navigation cannot drift.

---

### F5 — P2: Declaration is required by the database, but the confirmation UI does not expose it as a required prerequisite

**Type:** Confirmed form-feedback/accessibility defect in **in-progress T-081**; no enforcement bypass found.

**Evidence**
- The checkbox has neither native `required` nor an explicit required-state description: `src/modules/shipments/intake-form.tsx:558–562`.
- The final submit remains enabled when unchecked and when declaration text is unavailable: `src/modules/shipments/intake-form.tsx:535–540,550–553`.
- The action sends `null` when unchecked: `src/modules/shipments/actions.ts:266–275`.
- Database confirmation validates the declaration: `db/migrations/20261103110000_content_declaration.sql:98–108`.

**Failing scenario:** Staff reaches the final review, sees an enabled “Konfirmasi & terbitkan resi,” and submits without checking the declaration. Only after the server round trip is the missing prerequisite explained. If text failed to load, the UI still offers a submit action it cannot complete.

**Contract/task:** UX-19 item 4 explicitly requires the confirm button to explain what is missing. T-081, `TASKS.md:656–662`.

**Smallest fix:** Mark the checkbox required, explain the requirement before submission, and make confirmation unavailable when declaration text is missing. Preserve the database check. Associate any declaration error directly with the checkbox and announce/focus the relevant result.

---

### F6 — P2: Mobile menu has no vertical overflow strategy for short or zoomed viewports

**Type:** Source-confirmed accessibility/layout omission; rendered dimensions remain unverified.

**Evidence**
- Mobile menu content is a fixed-height left sheet with navigation and bottom session actions but no `overflow-y-auto` or separately scrollable navigation region: `src/components/mobile-nav.tsx:18–24`.
- The shared left sheet is fixed to the viewport with `h-full`, also without vertical scrolling: `src/components/ui/sheet.tsx:61–69`.
- Workspace navigation contains multiple groups and at least five/six 44px rows: `src/components/workspace-frame.tsx:37–45`; `src/components/workspace-nav.tsx:56–76`.

**Failing scenario:** On a short mobile viewport, landscape phone, or enlarged text, menu rows plus session actions exceed the sheet height. Lower controls such as Pengaturan or Keluar can extend beyond the visible sheet without a defined scroll region.

**Contract/task:** UX-15 keyboard/reflow/focus checks; UX-1 viewport access. T-073 and T-079.

**Smallest fix:** Give the sheet a bounded, vertically scrollable content region, retaining a nonshrinking header/close control. Verify that keyboard focus scrolls into view and session actions remain reachable.

**Required runtime check:** Short landscape viewport and 200% text zoom, including a multi-gerai/demo session with additional session actions.

---

### F7 — P2: A retained unsaved contact’s address picker can display options that do nothing

**Type:** Confirmed dead-control/state-preservation defect.

**Evidence**
- Contacts selected in this form session are cached in `picked`: `src/modules/shipments/intake-form.tsx:139–140`.
- The displayed recipient/address options include that cache when the current search no longer includes the contact: `src/modules/shipments/intake-form.tsx:184–188`.
- But `pickAddress` searches only `props.contacts`, not the cached contact: `src/modules/shipments/intake-form.tsx:152–157`.
- The address select calls this handler: `src/modules/shipments/intake-form.tsx:295–302`.

**Failing scenario:** Pick a recipient with multiple addresses but do not save yet. Search for another contact so the selected recipient drops out of server search results. Its address options remain visible, but selecting another address returns early and leaves the old address in place.

**Contract/task:** UX-1 intentional address choice and unsaved-state preservation; UX-4 returning-customer workflow. T-051 contact-picker behavior and T-072.

**Smallest fix:** Resolve the selected contact through the same merged/cached collection used to display `recipientAddresses`.

---

### F8 — P2: “Terbit hari ini” on Dashboard counts creation-day cohorts, not today’s issuance events

**Type:** Confirmed metric-label/data-semantics defect.

**Evidence**
- Dashboard labels the value **“Terbit hari ini”**: `src/modules/dashboard/stats.tsx:43–46`.
- Dashboard data does not load `issued_at`: `src/modules/dashboard/load.ts:15–23,36–40`.
- Aggregation groups by `created_at` and then checks current `submission_state === "issued"`: `src/modules/dashboard/aggregate.ts:122–126`.
- The shipment list more honestly labels the equivalent metric’s basis **“Dibuat dan terbit hari ini (WIB)”**: `src/app/(workspace)/pengiriman/page.tsx:98–101`.

**Failing scenario:** Yesterday’s draft issues today. It does not increase today’s “Terbit hari ini,” and can instead increase yesterday’s issued cohort and alter the apparent comparison against yesterday.

**Contract/task:** UX-16 honest metrics, timestamps and today/yesterday comparison. T-078.

**Smallest fix:** At minimum, name the current creation-cohort basis explicitly on Dashboard. To satisfy a true issuance-day metric, count by `issued_at` and provide a corresponding list-filter basis. Do not silently change chart semantics along with the tile.

---

### F9 — P2: Cargo weight exclusions disappear without the named reason supplied for regular services

**Type:** Confirmed new-feature feedback gap.

**Evidence**
- Quote generation returns exclusions, but the action takes only `quoted.rows`: `src/lib/mengantar/billable-quotes.ts:12–20,43`; `src/modules/shipments/actions.ts:180–181`.
- Display warnings are reconstructed only for `service_class === "regular"`: `src/modules/shipments/draft-intake.tsx:73–81`.
- Cargo rules have concrete minima/maxima: `db/migrations/20261103100000_cargo_noncod.sql:12–19`.
- Intake renders only the supplied `weightWarnings`: `src/modules/shipments/intake-form.tsx:383–385`.

**Failing scenario:** A non-COD parcel below a supported cargo service’s minimum still gets regular quotes, but cargo simply disappears. Staff cannot distinguish “below cargo minimum” from “cargo unavailable on this route” or a configuration restriction.

**Contract/task:** UX-1 service eligibility/unavailability explanation; T-080 requires a named reason when a weight limit excludes a service, `TASKS.md:654`.

**Smallest fix:** Propagate or reconstruct class-specific exclusion messages for the services actually considered. Include “Kargo” in the message so a courier’s regular and cargo outcomes cannot be confused. Do not infer missing route minima.

---

### F10 — P2: Queued-order “Kirim sekarang” bypasses its contracted effect confirmation

**Type:** Confirmed interaction-contract mismatch, not a duplicate-order finding.

**Evidence**
- A queued real operation renders a direct submit action: `src/modules/shipments/detail-next-step.tsx:60–76`.
- `dispatchQueuedAction` dispatches immediately once the form posts: `src/modules/shipments/actions.ts:290–299`.
- UX-13’s action table explicitly requires confirmation that the queued order will be sent to Mengantar: `docs/spec/17-UX-FLOWS-SCREEN-CONTRACTS.md:518–519`.

**Failing scenario:** Staff clicks “Kirim sekarang” while inspecting a queued record and immediately initiates the provider effect, without the confirmation required by the screen contract.

**Contract/task:** UX-13, T-051/T-053.

**Smallest fix:** Put the existing pending-safe submit behind the shared confirmation dialog, naming the shipment/reference and effect. Keep the existing original-operation dispatch and backend protections unchanged.

## 2. Contract and menu/IA gaps — not authorization defects

### G1 — P2: No Super Admin UI to inspect/version declaration text or billable-weight/cargo rules

**Confirmed current gap**
- The platform menu contains Gerai, Pengajuan gerai, Integrasi Mengantar, Diskon gerai, Akses Super Admin and Audit only: `src/app/admin/layout.tsx:10–17`.
- Declaration append exists and requires `tenant_governance`: `db/migrations/20261103110000_content_declaration.sql:40–51`.
- Weight-rule append exists and requires `integration_operations`: `db/migrations/20261102100000_billable_weight.sql:68–91`.
- Exhaustive symbol search under `src` found **no call sites** for either `platform_add_declaration_text` or `platform_set_billable_weight_rule`. Declaration/rule reads are in shipment intake/quoting, not platform management.
- Intake exposes weight source/date only in the tenant-admin quote view: `src/modules/shipments/draft-intake.tsx:68–71`.

**User-visible consequence:** Super Admin cannot review the active declaration/version or courier rules as platform configuration, and cannot append a sourced correction through the application UI.

**Mapping:** T-080/T-081, UX-19, IAM-1 configuration row. **The placement and acceptance contract for a platform editor are not specified—needs owner decision.** The existence of an RPC alone does not establish that these current tasks require a new menu item.

**Smallest proposal:** Agree one bounded configuration section, likely within existing capability-scoped administration, with current version, history, source/date, explicit append-only save, reason and confirmation. Do not add operator or tenant-admin editing privileges.

### G2 — P2: New rule/declaration audit events lack readable labels and dedicated filters

The RPCs emit `declaration_text.append` and `billable_weight_rule.append` at the locations above. Neither is present in the Audit action/category dictionaries: `src/app/admin/audit/page.tsx:17–57`. Unknown events can appear as raw codes, but cannot be explicitly selected through the validated action filter at lines `162–166`.

**Mapping:** UX-6 readable/filterable audit, T-080/T-081 integration follow-up.

**Smallest proposal:** Add Bahasa action/outcome labels and category membership for both append events; preserve raw identifiers in details.

### G3 — Explicitly deferred platform monitoring and cross-tenant operations are not “broken menu links”

`platform_monitoring` is a grantable capability: `src/lib/platform.ts:8–19`; `src/app/admin/akses/page.tsx:26`. There is no corresponding menu/page. UX-6 describes Ringkasan/Operasi, but `TASKS.md:728` explicitly says platform health and Super Admin reconciliation are not scheduled.

**Disposition:** Known capability/product gap, not evidence to expose tenant shipments or add an unsafe retry console. A monitoring-only administrator currently has no useful workspace. Owner should either accept that restricted interim experience or schedule a separately bounded read-only monitoring surface.

### G4 — Tenant directory/detail do not yet implement the full proposed UX-6 inventory

- Directory implements lifecycle filtering, but not search/pagination controls: `src/app/admin/page.tsx:68–85,110–116`.
- Tenant detail is primarily status/counts/identity, masking control and a discount link: `src/app/admin/tenant/[id]/page.tsx:37–49,71–118`.
- UX-6 proposes owner contact, outlet/readiness summaries, lifecycle/history and scoped issues: `docs/spec/17-UX-FLOWS-SCREEN-CONTRACTS.md:234–235`.

**Disposition:** Contract-completeness gap, not permission bypass. T-012/T-077 cover the built governance slice; completing the broader inventory needs an explicit task boundary and bounded data projection.

## 3. What is already working well

### Admin Gerai and Operator separation

- Anggota appears only for real tenant admins: `src/components/workspace-frame.tsx:42`.
- Direct page entry also rejects operator/demo access: `src/app/(workspace)/anggota/page.tsx:25–26`.
- Settings separates administrative forms from operator read-only explanations: `src/app/(workspace)/pengaturan/page.tsx:210–219,236–258,299–307`.
- Gerai cost panels are assembled only for tenant-admin views, not operator intake/detail: `src/modules/shipments/draft-intake.tsx:101–104`; `src/app/(workspace)/pengiriman/[id]/page.tsx:60–65`.
- Unknown/unpaid detail states suppress print and direct operators to authorized recovery: `src/modules/shipments/detail-next-step.tsx:79–96,167–177`.

These are source-level checks, not a fresh database authorization certification.

### Super Admin navigation and boundaries

The six menu capabilities match their inspected page guards. Platform detail does not automatically enter a tenant’s customer workspace. `requirePlatform` checks current grant, factor assurance and requested capability: `src/lib/platform.ts:34–49,64–70`.

### Menu, breadcrumb and mobile parity

- All declared primary-menu destinations correspond to route files found in this checkout.
- Desktop/mobile share the filtered `items` collection: `src/components/app-shell.tsx:64–76`.
- Most-specific active matching avoids selecting “Pengiriman” and “Buat pengiriman” simultaneously: `src/components/workspace-nav.tsx:43–45`.
- Navigation uses `aria-current="page"` and `min-h-11`: `src/components/workspace-nav.tsx:70–76`.
- Breadcrumb mapping deliberately avoids linking nonexistent `/admin/tenant`: `src/components/app-header-crumbs.ts:18–29,39–42`.
- Shared buttons use 44px minimum/default icon dimensions: `src/components/ui/button.tsx:23–26`.
- Shared dialogs have bounded vertical scrolling and focus-return handling: `src/components/ui/dialog.tsx:58–88`.

### Cargo and declaration exposure

- Cargo storage writes service **“Kargo”**: `db/migrations/20261103100000_cargo_noncod.sql:122–127`.
- Intake displays that service at `src/modules/shipments/intake-form.tsx:419`, and summary/confirmation reuse the service name through `src/modules/shipments/intake-summary.tsx:20`.
- Declaration UI includes the requested Bahasa acknowledgement, body, expandable categories and provisional notice: `src/modules/shipments/intake-form.tsx:548–573`.
- Current `STATUS.md:12–35` correctly distinguishes in-progress T-081, implemented non-COD cargo wiring, and unproved live provider acceptance.

### Design opinions—not defects

Do not add generic Analytics, Finance, customer impersonation, or cross-tenant shipment menus merely to make Super Admin look fuller. Their contracts/permissions must come first.

The five-step intake plus summary, grouped menu, and responsive record-card approach are reasonable source-level density choices. Whether quote-weight rows are too tall, headers too repetitive, or table density sufficient requires rendered inspection with realistic long Bahasa content; this audit does not claim visual proof.

## 4. Exact inspection scope and limitations

### Sources inspected

**Contracts/work queue/state**
- `docs/spec/17-UX-FLOWS-SCREEN-CONTRACTS.md`: UX-1, UX-4–6, UX-12–16, UX-19.
- `docs/spec/07-IAM-RBAC-ABAC.md`: IAM-1 role matrix and surrounding identity/governance constraints.
- Relevant `TASKS.md` task/deferred entries and `STATUS.md` current T-080/T-081 sections.

**Shell/navigation/shared UI**
- `src/components/{workspace-frame,workspace-nav,mobile-nav,app-shell,app-header,app-header-breadcrumb}.tsx`
- `src/components/app-header-crumbs.ts`
- `src/components/ui/{button,dialog,sheet}.tsx`
- `src/lib/{workspace,platform,platform-actions}.ts`

**Workspace routes**
- `src/app/page.tsx`
- `src/app/(workspace)/anggota/page.tsx`
- `src/app/(workspace)/kontak/page.tsx`
- `src/app/(workspace)/kontak/[id]/page.tsx`
- `src/app/(workspace)/pengaturan/page.tsx`
- `src/app/(workspace)/pengiriman/page.tsx`
- `src/app/(workspace)/pengiriman/baru/page.tsx`
- `src/app/(workspace)/pengiriman/[id]/page.tsx`
- `src/app/(workspace)/pengiriman/[id]/label/page.tsx`
- `src/app/(workspace)/pengiriman/[id]/invoice/page.tsx`
- `src/app/(workspace)/pengiriman/cetak/page.tsx`
- `src/app/(workspace)/not-found.tsx`, `src/app/error.tsx`

**Operational modules**
- `src/modules/shipments/{intake-form,draft-intake,intake-summary,detail-next-step,area-picker}.tsx`
- Relevant portions of `src/modules/shipments/actions.ts`
- `src/modules/contacts/actions.ts`
- `src/modules/members/{actions.ts,forms.tsx}`
- `src/modules/pricing/{forms.tsx,actions.ts,gerai-cost.tsx,gerai-discount-card.tsx}`
- `src/modules/dashboard/{dashboard-page.tsx,actions-panel.tsx,stats.tsx,load.ts,aggregate.ts}`
- `src/lib/mengantar/billable-quotes.ts`
- Declaration-related messages in `src/lib/errors.ts`

**Super Admin**
- `src/app/admin/{layout,page,forms}.tsx`
- `src/app/admin/{pengajuan,integrasi,akses,audit,diskon}/page.tsx`
- `src/app/admin/diskon/[tenant]/page.tsx`
- `src/app/admin/tenant/[id]/page.tsx`

**Supporting database-source seams**
- Capability helper/search results in `db/migrations/20261014120000_platform_admin.sql`
- Rule RPC in `db/migrations/20261102100000_billable_weight.sql`
- Cargo-rule/service storage seams in `db/migrations/20261103100000_cargo_noncod.sql`
- Declaration schema/RPC/confirmation validation in `db/migrations/20261103110000_content_declaration.sql`

The app/module route inventory, relevant working-tree diff, and exhaustive `src` searches for the two platform configuration RPCs were also inspected. This was **not** a line-by-line review of every file under `src/modules/**`.

### Verification still needed

The running verification job should independently exercise:

1. Selected service survives contact search.
2. Cached recipient address selection after a different search.
3. Unresolved-payment copy for operator and tenant admin.
4. Members/integration/discount/settings read failures.
5. Integration-only Super Admin login destination.
6. Unchecked/missing/stale declaration states.
7. Short-height mobile menu, keyboard reachability and 200% text zoom.
8. Yesterday-created/today-issued dashboard semantics.
9. Cargo minimum exclusion explanation.
10. Queued-order confirmation.

No claim is made here that viewport reflow, contrast, actual touch geometry, screen-reader announcements, focus behavior, database denial tests, or provider behavior passed runtime verification.