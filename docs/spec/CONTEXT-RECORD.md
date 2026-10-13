# GeraiExpress — Context Record

- Status: Reviewed planning draft; unresolved decisions remain; not implementation-ready or production evidence.
- Owner: Paduka Ongki
- Updated: 2026-10-13
- Depth profile: platform, because separate shipping businesses share an application.
- Authority: Canonical repository specification at `docs/spec/`, promoted by the owner's request on 2026-10-13. Historical staging statements below describe earlier work; they do not override this authority.

## Decision brief

The requested product is a new Cloudflare + Supabase shipping-outlet application,
using GeraiCUAN as a workflow reference and Mengantar as the courier aggregator.
The current decision is how independent outlets obtain provider access and issue
shipments for their customers, with reusable sender and recipient contacts.

- Accountable product owner: Paduka Ongki.
- Product state: new project requested; no GeraiExpress application or cloud resource exists from this session.
- Reference implementations: original checkout `/home/ongki/Projects/geraicuan`; preferred advanced implementation candidate `/home/ongki/Projects/geraicuan-completion`, with exact revisions and worktree inventory in `reference-scan.json`.
- Risk if wrong: cross-tenant contact disclosure, incorrect sender identity, charges to the wrong provider account, or duplicate shipments.
- Deadline, volume, budget, revenue model, and acceptable uncertainty: Unknown; owned by Paduka Ongki before release planning.
- Immediate scope: maintain the user-selected Partner integration, shadcn/ui + Apple presentation and normal-retail/net-seller pricing; cover gerai and Super Admin operations with explicit account, production-network and authorization gates before implementation.
- Research boundary: existing local contracts and current official vendor documentation. No customer records, credentials, authenticated API calls, or provider writes.
- Go threshold: confirmed workflow, explicit account ownership, and an account-specific sandbox contract before provider issuance.
- Hold threshold: unresolved account ownership or unavailable provider capability; independent drafting may continue.
- Stop threshold: a requested provider operation would spend funds or use an unapproved live account.
- Review trigger: provider documentation, account permission, hosting choice, tenant ownership, or product scope changes.

## Context facts

### CTX-1 — Requested project
- Status: Observed
- Evidence kind: direct-observation
- Owner: Paduka Ongki
- Source: User conversation, 2026-10-13.
- Source locator: Initial project request and follow-up confirming Cloudflare and Supabase.
- Source excerpt: "bikin project geraiexpress"; "ini untuk cludflare dan supabase".
- Statement: GeraiExpress is a new project using Cloudflare and Supabase, with multiple users and tenants.
- Confidence: High for requested direction; deployment region and account configuration remain unresolved.
- Recheck trigger: Product owner changes the project or stack.

### CTX-2 — Outlet shipping workflow
- Status: Observed
- Evidence kind: direct-observation
- Owner: Paduka Ongki
- Source: User conversation, 2026-10-13.
- Source locator: Mengantar integration and GeraiCUAN reference messages.
- Source excerpt: "kerjasama dengan agregator mengantar multi expedsi"; "konsep mirip geraicuan kita".
- Statement: The product serves shipping outlets that issue and print multi-courier shipments through Mengantar, under a tenant/outlet brand and with customer sender identities.
- Confidence: High for the job; exact branding of provider-generated labels is unverified.
- Recheck trigger: Courier integration or label requirements change.

### CTX-3 — Reusable contact directory
- Status: Observed
- Evidence kind: direct-observation
- Owner: Paduka Ongki
- Source: User conversation, 2026-10-13.
- Source locator: Contact-storage follow-up.
- Source excerpt: "kontak pengirim dan penerima juga bisa kita simpan".
- Statement: Sender and recipient contacts must be reusable in future shipments.
- Confidence: High; retention and deletion policy remain unresolved.
- Recheck trigger: Contact access or retention policy changes.

### CTX-4 — Existing GeraiCUAN is a reference, with local changes
- Status: Observed
- Evidence kind: direct-observation
- Owner: Engineering owner
- Source: `/home/ongki/Projects/geraicuan/AGENTS.md`, `package.json`, `docs/spec/02-PRD.md`, and `git status --short`, inspected 2026-10-13.
- Source locator: Repository contract, runtime dependencies, the existing product's outlet-setup/thermal-label/reusable-contact requirements, and working-tree status.
- Source excerpt: "Next.js App Router, PostgreSQL, Drizzle, Better Auth, and Coolify are selected decisions."
- Statement: GeraiCUAN contains relevant tenant, outlet, contact, shipment, and label workflows, but its runtime differs from the requested stack and its working tree has pre-existing changes.
- Confidence: High for the inspected contract and files; this is not verification of every existing workflow.
- Practical implication: Reuse product invariants and reviewed logic selectively. Preserve the existing checkout and do not copy its credentials, data, generated output, or runtime-specific integration wholesale.
- Recheck trigger: GeraiCUAN source changes or a specific module is selected for reuse.

### CTX-5 — Provider sender identity is separate from pickup
- Status: Evidence
- Evidence kind: external-publication
- Owner: Integration owner
- Source: SRC-MENGANTAR-DOCS in `sources.json`.
- Source locator: Official Create order section, Dropshipper note.
- Source excerpt: "The pickup address remains the seller address selected in the request".
- Statement: Current Mengantar documentation says a saved dropshipper supplies shipment/label sender name and phone, while the selected seller pickup address remains unchanged.
- Confidence: High for documented behavior; no account-specific request or printed-label test was executed.
- Limitations: Dropshipper must be enabled in Seller Web; a documented capability does not establish access for a particular account or courier.
- Practical implication: Keep customer sender identity, physical outlet pickup, and return destination distinct.
- Recheck trigger: Before implementing the adapter and before enabling each courier in production.

### CTX-6 — Provider label access is conditional
- Status: Evidence
- Evidence kind: external-publication
- Owner: Integration owner
- Source: SRC-MENGANTAR-DOCS in `sources.json`.
- Source locator: Print Label PDF (BETA), Request Label Generation.
- Source excerpt: "The API key must have the labelGeneration permission."
- Statement: Provider PDF generation requires account permission and operates on one account-owned, paid order with an AWB per request.
- Confidence: High for documentation; permission on the intended account is Unknown.
- Limitations: The inspected API contract does not establish arbitrary tenant logos, layouts, or sender-address replacement.
- Recheck trigger: Account onboarding and label-format selection.

### CTX-7 — Cloudflare and Supabase are technically compatible
- Status: Evidence
- Evidence kind: external-publication
- Owner: Engineering owner
- Source: SRC-CLOUDFLARE-SUPABASE in `sources.json`.
- Source locator: Supabase client setup.
- Source excerpt: "The Supabase client (`@supabase/supabase-js`) provides access to Supabase's various features".
- Statement: Cloudflare documents a Workers integration using the Supabase JavaScript client.
- Confidence: High for the supported integration path; no GeraiExpress runtime was built or tested.
- Recheck trigger: Client or Workers runtime version selection.

### CTX-8 — Proposed application shape
- Status: Proposal
- Evidence kind: inference
- Owner: Engineering owner
- Derived from: CTX-1, CTX-4, CTX-7; SRC-CLOUDFLARE-REACT and SRC-SUPABASE-RLS in `sources.json`.
- Statement: Initial React + Vite proposal is superseded by the Next.js recommendation in CTX-20 after the user asked Next.js versus Astro. Workers remain the trusted provider runtime; Supabase Auth + PostgreSQL with membership-based RLS remain the identity/data direction.
- Confidence: Medium; final runtime and hosting-region decisions require a scoped implementation check.
- Supporting evidence: Vendor React/Vite and Supabase Workers guides; existing API-backed operator workflow.
- Counterevidence: Existing GeraiCUAN server modules depend on Next.js and Node/PostgreSQL transactions and are not directly portable.
- Consequence: Product behavior can transfer; authorization and provider orchestration need explicit adaptation.
- Recheck trigger: Runtime selection before scaffolding application code.

### CTX-9 — Provider account ownership
- Status: Decision (DEC-006, owner accepted the recommended default 2026-10-14)
- Evidence kind: inference
- Owner: Paduka Ongki
- Source: CTX-16/CTX-17 Partner direction and contract review; exact ownership remains pending, 2026-10-13.
- Change history: 2026-10-13 — Corrected claim classification from Decision to Proposal; no owner acceptance was evidenced. 2026-10-14 — Owner accepted the recommended default; recorded as DEC-006.
- Statement: Confirm the legal/account owner and tenant/outlet mapping for the proposed tenant-owned seller model, with existing-account BYOK. A central platform seller would need a separate commercial decision.
- Selected option: User selected the Partner integration direction in CTX-16. The exact tenant/account-owner/cardinality policy remains proposed; no unanswered preselected option is approval.
- Recommended default: One partner-created seller per tenant business plus BYOK for an existing seller. This replaces the earlier both-central-and-tenant recommendation after review of the Partner contract. No silent central-account fallback.
- Trade-offs: Central ownership shares provider balance, concurrency, quotas, and reconciliation; tenant ownership isolates provider accounts but adds onboarding and credential lifecycle work.
- Consequence: Determines who owns orders, whose balance is charged, and the scope of dropshipper mappings, retries, and printing limits.
- Due: Before provider-account schema and submission implementation.

### CTX-10 — Reported blocking issue
- Status: Unknown
- Evidence kind: none
- Owner: Paduka Ongki
- Source: User reports GeraiCUAN may have been blocked by Komdigi. The later worktree scan found a dated Biznet DNS-override record for `geraicuan.com` and `app.geraicuan.com` in `/home/ongki/Projects/geraicuan-ops-backup/BUILD-LOG.md`, section dated 2026-10-10; this is historical repository evidence, not a current official blocking determination.
- Statement: Current reachability, official blocking status, and root cause remain unverified in this session; a historical ISP DNS symptom and affected hostnames are now identified.
- Consequence: Hosting migration must not be presented as a proven remedy.
- Next evidence: Current ordinary-ISP DNS/HTTP observations and authoritative domain status, if diagnosing the old service is requested. Do not infer a Komdigi action from the dated ISP observation alone.
- Due: Before making any availability or compliance claim based on the old service.

## Artifact route

Current output is a reviewed draft specification informed by a read-only reference scan. It is not an accepted implementation-ready pack.

| Concern | Trigger | Canonical artifact when specified |
|---|---|---|
| Product behavior | CTX-1 through CTX-3 | `02-PRD.md` |
| Runtime and provider integration | CTX-5 through CTX-9, CTX-11 | `03-TECHNICAL-DESIGN.md`, `04-SYSTEM-ARCHITECTURE.md` |
| Persistent contacts and shipments | CTX-2, CTX-3 | `05-DATA-MODEL.md` |
| Tenant and user authorization | CTX-1 | `06-TENANT-ISOLATION.md`, `07-IAM-RBAC-ABAC.md` |
| Authenticated operational UI and tenant branding | CTX-2, CTX-3 | `17-UX-FLOWS-SCREEN-CONTRACTS.md`, `10-DESIGN-SYSTEM-WHITELABEL.md` |
| Contact/recipient data and provider credentials | CTX-3, CTX-9 | `12-SECURITY-ARCHITECTURE.md`, `13-COMPLIANCE-PRIVACY.md` |
| Shared provider concurrency, quotas and operational signals | CTX-9, CTX-29, CTX-37 | `16-OBSERVABILITY-RATE-LIMITING.md`; TD-3/TD-7 own provider operation semantics |
| Selected shipping prices and provider payment responsibility | CTX-27, CTX-28, CTX-37 | `11-BILLING-PAYMENTS.md`; selected retail rule stays in PRD, adapter vectors in TD-9 |
| Release, schema changes and safe recovery | CTX-1, CTX-21, CTX-37 | `15-DEVOPS-CICD-MIGRATIONS.md` |

Domain applicability is explicit; unsettled commercial values do not postpone
already applicable shipping-money or operational contracts. Dedicated artifacts
are omitted only when not required or when one named existing owner suffices.

| Omitted dedicated artifact | Applicability and reason | Owner / review trigger |
|---|---|---|
| `01-BRD.md` | Not applicable to this single-owner planning scope; PRD owns business outcomes | Paduka Ongki; multiple commercial owners or contractual commitments |
| `08-DOMAIN-ROUTING.md` | Not applicable to initial same-origin app/platform workspaces; no tenant custom hosts selected | Engineering owner; tenant subdomain/custom-domain requirement |
| `09-API-SPECIFICATION.md` | Independent app API/SDK not applicable currently. Vendor integration/webhook contracts are applicable and consolidated in TD-2/TD-4/TD-7 and SEC-2/SEC-3; no independent HTTP consumer has been selected | Integration owner; before exposing an independent API or implementing a callback route, specify exact verified wire/ack/error contract and decide whether a standalone OpenAPI owner is warranted |
| `14-SLA-DRP.md` | Contractual SLA not applicable without a commitment. Material recovery is applicable and consolidated in DR-1; measurement in OBS-1 | Paduka Ongki + engineering owner; customer SLA/high-availability commitment or recovery scope outgrows DEL-1/DR-1 |

Subscriptions, platform custody, customer-goods ledger and old-customer migration
remain conditional features, not implied exclusions from shipping-money review.
The root `TASKS.md` becomes the sole execution queue after requirements are ready.
No task queue is generated while implementation requirements remain Proposed.

## Open decisions and boundaries

- Provider account mode: CTX-9, accepted as DEC-006 (2026-10-14).
- Tenant versus outlet/cabang ownership and member roles: proposed to follow GeraiCUAN; confirm before IAM implementation.
- Provider sender address versus customer address: CTX-5 supports name/phone substitution and preserved pickup; arbitrary label-address substitution is not established.
- Tenant logo and branding on the official courier label: Unknown; distinguish the application brand, a customer receipt, and the official shipping label.
- Contacts may serve as sender, recipient, or both: Proposal; contacts are not automatically login accounts.
- Retention, archiving, contact export, support access, COD, markup, refunds, and account settlement: owned by Paduka Ongki before their respective implementation slices.
- Supabase project region, Cloudflare/Supabase accounts, domain, sandbox access, and label whitelist: Unknown. No cloud provisioning or secret access performed.
- Jurisdiction, data transfer, and regulatory applicability: Unknown; no legal conclusion is made by this draft.

## Reference review additions — 2026-10-13

### CTX-11 — Reference implementation maturity and reuse
- Status: Observed
- Evidence kind: direct-observation
- Owner: Engineering owner
- Source: Original `/home/ongki/Projects/geraicuan` checkout source inventory, imports, callers, schema, migrations, route handlers, and test definitions, inspected 2026-10-13. CTX-14 records the advanced worktree and takes precedence for reuse selection.
- Source locator: `reference-scan.json` and the path/symbol matrix in `03-TECHNICAL-DESIGN.md`.
- Source excerpt: "No live Mengantar `/order` transport exists yet"; webhook `POST()` returns 404.
- Statement: The original checkout contains reusable validation, contacts, snapshot, queue/recovery, authorization, and presentation patterns. In that checkout, order issuance is fixture-backed, the webhook is closed, labels are local HTML, and no dropshipper/provider-PDF implementation was found. These findings must not be generalized to every GeraiCUAN worktree.
- Confidence: High for inspected source; source presence and test definitions do not prove deployment or account behavior.
- Practical implication: Extract small independent functions, adapt domain/repository invariants, and rebuild provider/auth/runtime boundaries; see TD-1.
- Recheck trigger: Source digest changes or a different reference branch/worktree is selected.

### CTX-12 — Bounded reference test execution
- Status: Observed
- Evidence kind: direct-observation
- Owner: Engineering owner
- Source: Executed reference pure-logic test subset, 2026-10-13.
- Source locator: `reference-scan.json`, `pure_test_run`.
- Source excerpt: "Test Files 5 passed (5)"; "Tests 35 passed (35)".
- Statement: Five selected date/filter/freshness test files passed, with database connection variables removed for the test process.
- Confidence: High for these 35 Node/Vitest checks only. No database, browser, Workers runtime, or provider integration result is implied.
- Recheck trigger: A reused function or its dependencies change, or code is ported into GeraiExpress.

### CTX-13 — Current official contract overrides older integration assumptions
- Status: Evidence
- Evidence kind: external-publication
- Owner: Integration owner
- Source: SRC-MENGANTAR-DOCS in `sources.json`, rechecked 2026-10-13.
- Source locator: Official Create order, Dropshipper, Print Label PDF, and Webhook sections.
- Source excerpt: "The signature is an HMAC-SHA256".
- Statement: Current official documentation describes nested order creation, saved dropshipper identities, asynchronous provider PDF labels, and a webhook contract. The original checkout's closed webhook and flattened fixture DTO are not evidence that the provider lacks these capabilities; the advanced checkout already implements a gated live adapter and signed webhook.
- Confidence: High for documentary availability; sandbox capture and intended-account access remain unverified.
- Practical implication: Use current vendor documentation for a new adapter. Keep local fixtures, old application contracts, and the toolkit as secondary sources whose drift must be reconciled.
- Recheck trigger: Before each provider integration slice; raw HTML hashes may vary between public retrievals and do not establish semantic API change alone.

### CTX-14 — Advanced reference worktree
- Status: Observed
- Evidence kind: direct-observation
- Owner: Engineering owner
- Source: `/home/ongki/Projects/geraicuan-completion`, branch `feat/phase14-completion`, HEAD `1199406c5c6fb67d6607add624cea487c91ad029`, clean at review.
- Source locator: `reference-scan.json`, `advanced_reference`; source symbols in the advanced matrix under TD-1.
- Source excerpt: "Deliberately not sent" includes `dropShipper`; "no real delivery has been captured yet" in the webhook route's gap note.
- Statement: Worktree discovery found 15 related checkouts. The clean advanced checkout has a bounded HTTP client, gated live order/payment/cancellation transport, nested documented order builder, signed webhook handler, tenant brand/settings, local thermal/batch print, customer invoice, readable shipment references, and improved operator screens. Its builder omits saved-provider dropshipper identity, and its webhook notes a platform-default-only secret and no real captured delivery.
- Confidence: High for source presence and inspected implementation boundaries. The source's historical order-probe blockage is not a current provider-runtime test.
- Practical implication: Prefer these advanced modules over stale baseline equivalents. Port compatible behavior and tests while adapting Node/auth/database and framework-runtime integration and completing customer sender/account scope.
- Recheck trigger: Advanced HEAD/digest changes, another accepted checkout is selected, or provider sandbox behavior contradicts the source.

### CTX-15 — Advanced local adapter/webhook/reference tests
- Status: Observed
- Evidence kind: direct-observation
- Owner: Engineering owner
- Source: Executed selected advanced-reference tests, 2026-10-13.
- Source locator: `reference-scan.json`, `advanced_reference.local_test_run`.
- Source excerpt: "Test Files 3 passed (3)"; "Tests 25 passed (25)".
- Statement: The selected transport, webhook, and shipment-number tests passed 25 checks on the advanced checkout with mocked/synthetic dependencies and database variables removed.
- Confidence: High for those local checks; no real provider account, live order, webhook delivery, database migration, browser, or Workers runtime was tested.
- Recheck trigger: Porting the tested behavior or modifying its reference dependencies.

## Verification history

On 2026-10-13, the reference repository contract and relevant contact/order
source files were inspected read-only. Both official Mengantar documentation
URLs returned HTTP 200 through an unauthenticated Python HTTP request with
identical page bytes (SHA-256 in `sources.json`). Cloudflare and Supabase
documentation was retrieved through browsing. No authenticated provider call,
order, label job, migration, customer-data import, deployment, commit, or push
was performed. These observations establish documentation discovery only.

Discovery structure check executed on 2026-10-13:
`python3 /data/ai/codex/skills/development-spec-suite/scripts/check-traceability.py /home/ongki/Documents/work/prd/geraiexpress --stage research`.
Result: PASS, two Markdown files, 17 declarations, no findings. This checks
discovery structure; it does not approve product policy or verify application behavior.

Review verification on 2026-10-13: the same research-stage structural command
passed with 12 Markdown files, 54 declarations, zero findings, and no accepted
implementation queue. Local-link/source-JSON checks also passed. Semantic review
reconciled old versus advanced checkout maturity, provider versus local sender
identity, contact-display policy, active-membership versus in-flight completion,
shared-account pickup authority, metric drift, and conditional commercial scope
in the PRD's contradiction/open-decision sections.

The reference check remeasured 367 original and 727 advanced source fingerprints
and both checkout statuses without a change. Fifteen worktrees were inventoried;
selective source tracing and 8 test files / 60 passing local checks are recorded
in `reference-scan.json`. This is not an exhaustive code audit, a new-app test,
a live provider proof, or deployment verification. No reference source was edited.

## Partner and visual direction additions — 2026-10-13

### CTX-16 — User-selected Partner integration
- Status: Observed
- Evidence kind: direct-observation
- Owner: Paduka Ongki
- Source: User conversation, 2026-10-13.
- Source locator: Partner documentation URL supplied in the user conversation.
- Source excerpt: "pelajari breakdown lengkap dan buat md nya"; "implementasikan ke prd kita sistem yang better".
- Statement: The intended integration includes the Mengantar Partner API; its reviewed endpoint breakdown is in the linked research artifact and proposed product changes remain in the existing pack.
- Confidence: High for direction; no Partner account, credentials, or contractual approval was verified.
- Recheck trigger: Provider integration direction changes.

### CTX-17 — Partner control plane and seller authority
- Status: Evidence
- Evidence kind: external-publication
- Owner: Integration owner
- Source: SRC-MENGANTAR-PARTNER in `sources.json`.
- Source locator: All eleven sections; four POST routes under `/api/partner/v1`.
- Source excerpt: "Every endpoint is a POST".
- Statement: Partner API registers and manages keys of its own sellers; Public API performs shipping under each seller's account/rates. Existing accounts require BYOK. Registration replay uses stable externalUserId; key retrieval can provision a key; regeneration invalidates the previous key and may rotate the callback secret. Seller webhook setup is manual.
- Confidence: High for documentary contract; no authenticated API request executed.
- Practical implication: Tenant-owned seller onboarding, separate BYOK authority, durable operation recovery, per-seller key/callback lifecycle, and no automatic customer/staff seller registration.
- Recheck trigger: Before implementing each route, provisioning sellers, changing permissions, or rotating secrets.

### CTX-18 — Production egress is a conditional Cloudflare dependency
- Status: Evidence
- Evidence kind: external-publication
- Owner: Engineering owner
- Source: SRC-MENGANTAR-PARTNER, SRC-CF-GATEWAY-WORKERS, SRC-CF-VPC-NETWORK, SRC-CF-DEDICATED-EGRESS, SRC-SUPABASE-EGRESS in `sources.json`.
- Source locator: Partner allowed-IP requirement; Workers Gateway routing; dedicated egress plan and failover documentation; Supabase function egress limitation.
- Source excerpt: "IP_NOT_ALLOWED"; dedicated egress plan: "Enterprise".
- Statement: Partner production source-IP allowlisting is mandatory. Workers VPC/Gateway with dedicated egress is a candidate within Cloudflare, with a Zero Trust Enterprise add-on requirement; ordinary Workers or Supabase Functions do not establish this static-IP guarantee.
- Confidence: High for published components/requirements; the proposed combined route, entitlement, cost, approved addresses, and failover have not been tested.
- Practical implication: ARCH-2 is a production enablement gate; no direct-fetch fallback or assumed IP-policy waiver.
- Recheck trigger: Before infrastructure selection and again before production Partner enablement.

### CTX-19 — User-selected shadcn/ui with Apple-inspired presentation
- Status: Observed
- Evidence kind: direct-observation
- Owner: Paduka Ongki
- Source: User-provided design brief, 2026-10-13; SRC-SHADCN-THEMING supplies component token integration guidance.
- Source locator: User design brief from Overview through Known Gaps.
- Source excerpt: "nanti pakai shadcn ui kombinasi apple".
- Statement: Use shadcn/ui with the supplied blue/neutral palette, native system typography, restrained surfaces, prescribed radii, pressed states, and imagery-only shadows. Preserve operational form/table density, accessible focus, and truthful failure/recovery states.
- Confidence: High for user preference; the brief is a supplied design reference, not an independently verified audit of Apple's website. No GeraiExpress UI is implemented.
- Practical implication: UI-1 through UI-3 own tokens/composition/validation; official label customization remains a separate provider capability.
- Recheck trigger: User changes visual direction or rendered evidence exposes accessibility/operational conflicts.

### CTX-20 — Next.js versus Astro recommendation
- Status: Proposal
- Evidence kind: inference
- Owner: Engineering owner
- Derived from: CTX-4, CTX-14, CTX-19; SRC-CF-NEXTJS and SRC-CF-ASTRO in `sources.json`.
- Statement: Recommend Next.js App Router for the interactive authenticated operator application and familiar reference structure, with a verified Cloudflare Workers deployment path. Astro remains a feasible content-first option; a second marketing app is not required now.
- Confidence: Medium until a scoped compatibility/runtime check. Cloudflare currently recommends vinext, which is beta; compatible Next.js APIs are not a guarantee of every reference dependency working.
- Trade-offs: Next.js reduces routing/component adaptation from GeraiCuan but adds adapter compatibility work. Astro supports server rendering and React islands, but a mostly interactive shipping console would still require substantial shared client state. Plain React/Vite remains technically viable; avoiding adapter dependence is its advantage.
- Consequence: ARCH-1 now records the Next.js proposal; no Next.js-only business/auth module is copied without review. Pin the actual framework/adapter versions and verify auth, scoped reads/mutations, deep links, and queue/label flows before accepting runtime readiness.
- Recheck trigger: Before application scaffolding or when the compatibility spike fails.

## Partner/design update verification — 2026-10-13

Executed the research-stage structural command again after the Partner/design
update: PASS, 12 specification Markdown files, 75 declarations, zero tasks,
zero findings. Independently checked 13 Markdown artifacts including the
research breakdown, 16 local document links, 17 unique source records, all
11 Partner documentation sections, four endpoint paths, and 20 vendor error
codes. Documentation hashes for Partner HTML, its base-URL script, and the
companion sandbox Public page match the recorded retrievals.

Extracted the self-contained JavaScript fixture from the Partner breakdown and
executed it with Node: PASS, two independent digest comparisons against a fixed
SHA-256 vector and five method/path/body/time/empty-TYPE tampering negatives.
This used synthetic constants and no HTTP calls or credentials.

Offline sRGB contrast calculations passed for action text (5.57:1), essential
secondary text on parchment (11.60:1), dark-surface links (4.94:1), functional
input borders (3.94:1), and focus against white/dark (4.70:1 / 3.17:1). The
supplied lighter muted text is 4.29:1 on white and is excluded from essential
normal text. These are token-pair calculations, not rendered accessibility,
browser behavior, or a completed visual implementation.

Semantic review separates Partner versus Public authority, tenant business
versus staff/contact identity, seller versus credential replacement, BYOK
versus Partner ownership, connection versus capability readiness, provider
versus local restriction, and unknown rotation versus safe registration replay.
No GeraiExpress application exists at `/home/ongki/Projects/geraiexpress`; no
reference source, live account, database, cloud config, or deployment was changed.

## Initial demo access — user request

### CTX-21 — Demo account for the initial login
- Status: Observed
- Evidence kind: direct-observation
- Owner: Paduka Ongki
- Source: User conversation, 2026-10-13.
- Source locator: Follow-up after the Partner seller-onboarding explanation.
- Source excerpt: "nanti sediakan demo akun untuk login awal ya".
- Statement: The first usable GeraiExpress delivery must include a ready-to-use demo login with sample operational data and clear access instructions.
- Confidence: High for requested access. Proposed implementation uses a dedicated demo tenant/operator and simulated shipping, with no real provider account or balance effects.
- Practical implication: PR-21, IAM-4 and UX-3 define initial demo access. Credentials and the live login are supplied when the application preview is actually implemented; none is created by this documentation update.
- Recheck trigger: Before first application preview and if demo exposure or role scope changes.

Demo-access documentation check, 2026-10-13: research-stage structural validator
PASS with 12 Markdown files, 79 declarations, zero tasks and zero findings.
Checked all 15 local specification links, preserved PR-1 through PR-20, and
confirmed unique new PR-21/CTX-21/IAM-4/UX-3 declarations. No Auth identity,
credential, application, remote account or cloud resource was created; login,
simulation and isolation acceptance remain prospective implementation checks.

## Product direction and outlet operating needs

### CTX-22 — Requested completeness and operating direction
- Status: Observed
- Evidence kind: direct-observation
- Owner: Paduka Ongki
- Source: User conversation, 2026-10-13.
- Source locator: Documentation completeness question and its immediate follow-up.
- Source excerpt: "doc md sudah lengkap?"; "sekalian arah kita dan kebutuhan gerai".
- Statement: The Markdown pack must explain the GeraiExpress product direction and outlet operating needs alongside its technical contracts, create-label flow and initial demo access.
- Confidence: High for documentation scope. No new pricing, staffing, finance, demand or release policy was selected by this request.
- Practical implication: Extend the existing PRD with intended users/jobs, operating needs mapped to requirements, goals/evaluation, scope ordering and explicit business decisions; UX-4 connects those needs to the counter journey.
- Recheck trigger: Product owner changes the target outlet workflow or initial scope.

### CTX-23 — Recommended shipping-counter product frame
- Status: Proposal
- Evidence kind: inference
- Owner: Paduka Ongki
- Derived from: CTX-1, CTX-2, CTX-3, CTX-14, CTX-17, CTX-19, CTX-21, CTX-22.
- Statement: Position GeraiExpress as a tenant-branded operating workspace for a shipping counter serving many customer senders: reusable contacts, account-appropriate quotes, authoritative shipment/label creation and recoverable daily operations, with owner setup/governance and a separate safe demo.
- Confidence: High fit to the requested job; actual outlet interviews, throughput, printer/device constraints, business model, budget and quantitative targets remain unknown.
- Supporting evidence: User-requested customer sender identities/contact reuse, current Partner/Public API ownership, and selectively inspected GeraiCuan counter workflows.
- Counterevidence: The reference's broader finance and thermal-label features do not establish demand, pricing policy or courier acceptance for GeraiExpress.
- Consequence: Prioritize one complete counter workflow before optional reporting/finance/bulk capabilities. Platform fees, customer markup, COD accounting and custody/handover policy remain owner decisions.
- Recheck trigger: Before accepting the live pilot scope, after an observed outlet trial, or if business/account ownership changes.

Product-direction/gerai-needs verification, 2026-10-13: the research-stage
structural validator passed with 12 specification Markdown files, 82 declarations,
zero tasks and zero findings. Independently checked 13 Markdown artifacts,
16 local links, source-reference resolution, preservation of PR-1 through PR-21,
and unique CTX-22/CTX-23/UX-4 declarations. Semantic review confirmed that the
operating-needs matrix maps initial behaviors to existing requirements and keeps
customer charges, provider costs, COD, revenue and custody distinct. Optional
money/handover/hardware features remain proposed candidates; no market evidence,
throughput target, commercial policy or production readiness was invented.
These checks verify document structure/consistency only, not an implemented gerai
workflow. No app, account, cloud resource, credential or live transaction changed.

## GeraiCuan pricing study

### CTX-24 — User-requested pricing study
- Status: Observed
- Evidence kind: direct-observation
- Owner: Paduka Ongki
- Source: User conversation, 2026-10-13.
- Source locator: Follow-up to the price/markup/COD decisions recorded in the product draft.
- Source excerpt: "harga kau pelajari gerai cuan".
- Statement: Study GeraiCuan's pricing behavior and use its verified findings to improve the GeraiExpress pricing proposal.
- Confidence: High for study scope; this request does not select new fees, markup, subscription pricing or a universal COD rate.
- Recheck trigger: Owner selects or changes GeraiExpress commercial rules.

### CTX-25 — Advanced pricing behavior and transfer gaps
- Status: Observed
- Evidence kind: direct-observation
- Owner: Engineering owner
- Source: Preferred GeraiCuan checkout in CTX-14; selected source/spec/test fingerprints in `reference-scan.json`, pricing_review.
- Source locator: mengantar-estimate, mengantar-cod-fee, shipment-draft-logic, shipment-estimate-options, shipment-money, cod-totals-repository, owner-money-repository, shipment-invoice-repository and invoice-sheet; reference PRD/metric contract.
- Source excerpt: "computed, never typed"; "per-tenant customer price lists or markup" are a reference non-goal.
- Statement: The reference separates list/normal/special/cargo prices, applies a historical 333-bps gross-up for COD, computes new COD Ongkir at deducted-shipping break-even, folds COD fee/rounding into customer Ongkir, and reports private owner shipping spread rather than goods profit. It has no free-form gerai markup/cashier and its application-use policy is free. Non-COD issuance options retain internal deducted shipping in the client payload; this must not be copied under an admin-only cost policy.
- Confidence: High for traced source behavior, not actual current tariffs, payment receipt, customer demand or deployed security. Later invoice/collection rules supersede older reference prose.
- Practical implication: PR-22 and TD-9 preserve separate quantities/provenance and require current provider fee inclusion/rounding proof. COD customer-goods obligations and intentional COD Ongkir earnings remain owner decisions; GeraiCuan free access does not decide GeraiExpress monetization.
- Recheck trigger: Source revision changes, provider contract disagrees, or GeraiExpress selects its pricing/financial scope.

### CTX-26 — Bounded pricing checks
- Status: Observed
- Evidence kind: direct-observation
- Owner: Engineering owner
- Source: Executed existing local source tests and a synthetic plain-helper check, 2026-10-13.
- Source locator: `reference-scan.json`, pricing_review; [pricing analysis](../research/geraiexpress-geraicuan-pricing-review.md).
- Source excerpt: "numPassedTests": 34; independent example: "checksPassed": 9.
- Statement: Three selected reference files passed 34 checks with database variables removed; an independent synthetic example using the plain fee helper passed nine assertions. An initial broader selection failed on database-dependent nested imports and is retained as a limited result, not counted as fully passing.
- Confidence: High for executed local arithmetic/normalization/static-render scope only; no DB, browser, Workers or live provider proof.
- Practical implication: Retain the useful checks as port candidates and isolate pure presentation/financial logic from server-action/database imports. Do not supply a real database merely to force this documentation review to pass.
- Recheck trigger: Porting/modifying the tested behavior or enabling current account-specific prices.

Pricing-study documentation verification, 2026-10-13: research-stage structural
validator PASS with 12 specification Markdown files, 90 declarations, zero tasks
and zero findings. Independent checks covered 14 Markdown artifacts, 21 local
links, preservation of PR-1 through PR-21 with new PR-22, valid source/scan JSON,
and 21 unchanged advanced-reference fingerprints/Git status. The reproducible
plain-helper script in the pricing analysis passed nine assertions on execution.
The bounded 3-file/34-check passing result and the initial broader import failures
remain separately recorded in pricing_review; none is new-app, DB or browser proof.

Semantic review corrected current-versus-retired COD Ongkir rules, versioned
customer invoice display, current owner shipping spread versus withdrawn goods
profit, quotation-versus-order fee inclusion, and the difference between private
application projections and external provider PDF content. Current fee/tax
entitlements, custom markup, platform monetization and customer COD obligations
remain explicit policy/contract gates. No reference source was changed and no
GeraiExpress app, database, live account or actual charge was created.

## Selected customer and seller pricing policy

### CTX-27 — Provider-price instruction and clarification
- Status: Observed
- Evidence kind: direct-observation
- Owner: Paduka Ongki
- Source: User conversation, 2026-10-13.
- Source locator: Two consecutive messages after the GeraiCuan pricing study.
- Source excerpt: "pakai harga real mengantar"; "bukan harga setelah diskon ya"; "biaya fee cod dan asuransi jika ada".
- Statement: Use actual Mengantar pricing, display its normal undiscounted customer rate on the gerai's customer/resi surface, apply assigned seller/gerai discounts to the cost paid to Mengantar, and account for COD fee and insurance where applicable.
- Confidence: High for the retail-versus-net distinction. Exact discount terms, current fee/insurance contract and upstream activation method are not supplied by these messages.
- Practical implication: Correct any interpretation that would pass the discounted net shipping cost to the customer or reuse GeraiCuan's cost-break-even COD Ongkir as the customer price.
- Recheck trigger: Owner changes the retail/net or fee/insurance policy.

### CTX-28 — Customer normal tariff and seller discounted cost
- Status: Decision
- Evidence kind: human-policy
- Owner: Paduka Ongki
- Source: CTX-27 user clarification, 2026-10-13.
- Statement: Separate normal customer shipping tariff from discounted seller/provider cost; applicable COD and insurance components must be calculated without double inclusion and snapshotted on confirmation.
- Selected option: Customer/resi uses Mengantar normal tariff before seller discount. Seller payment follows the actual applicable assigned discount and verified Mengantar cost. No extra discretionary gerai shipping markup was requested.
- Supporting evidence: Direct user correction; CTX-25 source distinction between list/special prices. The reviewed Partner contract supports seller/key operations, not an endpoint for changing seller discount rules.
- Supersedes: Any net-only interpretation of "real Mengantar price" and the prior open choice to use deducted-cost break-even as new customer COD Ongkir pricing. Reference formulas remain historical evidence only.
- Trade-offs: Requires separate retail/net amounts, restricted discount administration and verified provider fee/inclusion/insurance; a discount entered locally cannot prove Mengantar will bill it.
- Consequence: PR-22/PR-23, TD-9, DATA-5, IAM-5/IAM-6 and UX-5 reflect this selected policy. Actual rates, discount eligibility and provider label support still need current account-specific proof.
- Due: Before pricing/discount implementation and live confirmation. Demo may show clearly synthetic normal/net examples without provider writes.


Normal-retail/net-seller policy verification, 2026-10-13: research-stage structural
validator PASS with 12 specification Markdown files, 94 declarations, zero tasks
and zero findings. Independent checks covered 14 Markdown artifacts, 21 local
links, preserved PR-1 through PR-22 with new PR-23, unique CTX-27/CTX-28/IAM-6,
and the selected policy referenced across six owner/index documents. Review
confirmed that COD Ongkir retains normal retail shipping, seller discounts do
not change that customer base, fee/insurance inclusion and collection channels
are explicit, and local discount assignment is distinct from actual provider
activation. Historic GeraiCuan formulas remain research evidence, not defaults.

Official web-tool retrieval was unavailable; this documentation update used the
already retrieved same-day official Partner/Public contracts and did not claim
current live tariffs or a discount-management endpoint. No source tests were
rerun for this document-only policy change; earlier results retain their original
scope. No application, credential, live quote, discount, payment or cloud resource
was created/changed.

## Super Admin needs and scope

### CTX-29 — Super Admin completeness request
- Status: Observed
- Evidence kind: direct-observation
- Owner: Paduka Ongki
- Source: User conversation, 2026-10-13.
- Source locator: Follow-up after the normal-customer/net-seller pricing decision.
- Source excerpt: "super admin dan kebutuhan super admin sudah?".
- Statement: The specification must cover the Super Admin role and its operational needs alongside the gerai/operator journeys.
- Confidence: High for role coverage. This status/completeness request does not grant live administrator access, unrestricted customer access, or accept every proposed governance policy.
- Practical implication: Expand the existing platform role/lifecycle/discount contracts with explicit platform screens, monitoring, integration readiness, controlled recovery, privileged access and audit needs.
- Recheck trigger: Owner changes platform operating or support responsibilities.

### CTX-30 — Super Admin operating frame and reference evidence
- Status: Proposal
- Evidence kind: inference
- Owner: Paduka Ongki
- Derived from: CTX-11, CTX-14, CTX-17, CTX-28, CTX-29; SRC-SUPABASE-MFA in `sources.json`.
- Statement: Super Admin is the product name for the existing platform administrator: a restricted platform workspace for tenant governance, seller/integration readiness, assigned discounts, service health, safe exception recovery and append-only audit. Platform capabilities are explicit; customer operations/PII are not inherited automatically.
- Confidence: High fit to the source/user jobs; staffing, manual-approval requirement, support-data access, recovery authority and alert thresholds remain owner decisions.
- Supporting evidence: Preferred reference has platform overview, registration review, tenant list/detail, lifecycle commands, audit and restricted platform access with second-factor state; target replaces Better Auth/Node-specific mechanisms with Supabase/Workers.
- Counterevidence: Existing screen/source presence is not a live GeraiExpress control or a grant to spend tenant funds; Partner API does not manage discount rates.
- Consequence: PR-15 and PR-24 through PR-28 define product coverage; IAM-7/TEN-4/SEC-4 bound authority; UX-6/UI-4 define the workspace. No new role beyond the existing platform administrator is implied by the display name.
- Recheck trigger: Before platform implementation/release, after operator review, or when cloud/provider permissions change.

Super Admin documentation verification, 2026-10-13: research-stage structural
validator PASS with 12 specification Markdown files, 108 declarations, zero tasks
and zero findings. Independent checks covered 14 Markdown artifacts, 21 local
links, unique IDs/source resolution, 18 source records, preserved PR-1 through
PR-23 with PR-24 through PR-28, and ten unchanged preferred-reference platform
source fingerprints/Git status. Official Supabase MFA documentation was retrieved;
a failed alternate auth page was not used as authority.

Semantic review aligned the Super Admin/platform-administrator terminology,
platform-only versus tenant-member authority, manual-review policy versus seller
onboarding, pricing-assignment versus actual provider activation, current versus
period metrics, safe original-operation recovery, and append-only audit. The
normal-customer/net-seller price decision remains unchanged. Supabase backend/
direct database assurance enforcement and bootstrap/recovery are specified as
prospective controls; no factor, role, account, cloud setting or live effect was
created. No source tests were rerun for this document-only expansion and no
browser/database/Workers success is inferred from the document checks.

## Registration and first-use completeness

### CTX-31 — Complete the remaining documentation including registration
- Status: Observed
- Evidence kind: direct-observation
- Owner: Paduka Ongki
- Source: User conversation, 2026-10-13.
- Source locator: Follow-up after Super Admin documentation expansion.
- Source excerpt: "lanjut sempurnakan md docnya yang belum"; "termasuk flow register".
- Statement: Continue updating the existing specification, covering the full registration journey and its missing cross-document contracts.
- Confidence: High for documentation scope; not authorization for cloud provisioning, live accounts or deployment.
- Recheck trigger: Owner changes the requested documentation or authorizes implementation.

### CTX-32 — Registration patterns in the preferred GeraiCuan reference
- Status: Observed
- Evidence kind: direct-observation
- Owner: Engineering owner
- Source: Preferred reference at revision 1199406c5c6fb67d6607add624cea487c91ad029; registration_review in `reference-scan.json`.
- Source locator: `src/app/daftar/registration-form.tsx`, `src/app/daftar/actions.ts`, `src/lib/self-registration.ts`, `src/db/tenant-registration-repository.ts`, and selected test source.
- Source excerpt: "three client-side steps, one server submission".
- Statement: The reference groups account/business fields, validates on the server, uses generic valid-submission responses, provisions a pending tenant/outlet/admin in a local transaction, and reviews verified owners. Its Better Auth password/verification implementation cannot be ported as Supabase Auth behavior.
- Confidence: High for inspected source only; the database-backed registration tests were not executed in this review.
- Practical implication: Adapt form/state/recovery and transactional membership patterns; use native Supabase identity APIs and explicitly separate its transaction boundary from application data and Mengantar.
- Recheck trigger: Reference source changes or a module is selected for implementation.

### CTX-33 — Native Supabase email verification and recovery capabilities
- Status: Evidence
- Evidence kind: external-publication
- Owner: Engineering owner
- Source: SRC-SUPABASE-EMAIL-OTP, SRC-SUPABASE-AUTH-PASSWORDS, SRC-SUPABASE-AUTH-SSR, SRC-SUPABASE-AUTH-REDIRECTS, SRC-SUPABASE-AUTH-LIMITS in `sources.json`.
- Source locator: Email OTP, password recovery, SSR/PKCE, redirect and rate-limit sections.
- Source excerpt: "If the user hasn't signed up yet, they are automatically signed up by default."
- Statement: Native email OTP can establish an Auth session; password setup/recovery and SSR callbacks remain separate from application tenant permissions. User creation behavior, expiry and quotas require explicit project configuration.
- Confidence: High for documented features; no GeraiExpress Auth instance or mail delivery has been tested.
- Recheck trigger: Before Auth implementation, selected SDK/version change or signup release.

### CTX-34 — Recommended registration operating policy
- Status: Decision (DEC-007, owner accepted the recommendation 2026-10-14; invite lifetime and additional-business rule fixed there)
- Evidence kind: inference
- Owner: Paduka Ongki
- Derived from: CTX-1, CTX-17, CTX-21, CTX-29, CTX-31, CTX-32, CTX-33.
- Statement: Recommend email-first verification, then password setup and a resumable gerai application. Recommend manual Super Admin business approval for the initial pilot, followed by explicit tenant-owned Mengantar connection; staff join through invitations.
- Confidence: High workflow fit; authentication UX, manual versus automatic activation, invite expiry and additional-business policy remain owner choices before implementation.
- Supporting evidence: Avoid collecting an unverified applicant's password/business authority together; keep provider account creation behind verified identity, current tenant authority and separate provider consent.
- Counterevidence: Manual review adds an operational queue and is not demanded by the provider; email-first signup depends on a working mail channel. No user decision selecting these defaults is implied.
- Consequence: PR-29 through PR-33 and UX-7/UX-8 propose complete success/recovery paths; existing multi-tenant access remains permitted only by explicit memberships.
- Recheck trigger: Before accepting onboarding requirements or after pilot evidence.

### CTX-35 — In-stack outbound authentication email candidate
- Status: Evidence
- Evidence kind: external-publication
- Owner: Engineering owner
- Source: SRC-SUPABASE-AUTH-SMTP, SRC-CF-EMAIL-SENDING, SRC-CF-EMAIL-SMTP in `sources.json`.
- Source locator: Supabase custom SMTP; Cloudflare Email Sending overview and authenticated SMTP endpoint.
- Source excerpt: "smtp.mx.cloudflare.net:465"; "Implicit TLS"; "Email Sending Beta".
- Statement: Supabase supports custom SMTP and Cloudflare documents authenticated SMTP sending. Their composition is a candidate within the selected stack; Cloudflare sending eligibility/domain and actual interoperability/delivery remain unverified. Supabase's built-in test mailer is not a public-signup delivery solution.
- Confidence: High for documented individual features; combined runtime outcome Unknown.
- Practical implication: ARCH-3 proposes native custom SMTP first; no custom mail hook or third-party service is needed unless this composition fails and a revised design is accepted.
- Recheck trigger: Before production email setup, public registration, or vendor/plan change.

Registration documentation verification, 2026-10-13: research-stage structural
validator PASS with 12 specification Markdown files, 128 declarations, zero tasks
and zero findings. Independent checks covered 14 Markdown artifacts, 21 local
links, preservation of every prior declaration, PR-1 through PR-33, resolution of
26 official source records and six unchanged registration-source fingerprints,
revision and Git status. The selected customer-normal/net-seller pricing section
was byte-for-byte unchanged. No application repository exists from this task.

Semantic review separated native identity, trusted initial account completion,
versioned own gerai application, selected activation, staff invitation and explicit
Mengantar seller connection. Review covered corrections/rejection, idempotent
resume, multi-membership routing, pre-registration/password/session risks,
current invitation authority, direct pending-user scope, private caching and
capability-specific first-resi readiness. Manual approval/email-first UX and
policy lifetimes remain proposals, not accepted decisions. The diagram uses
plain Mermaid flowchart syntax; it was not rendered as browser/runtime evidence.

Current official Supabase Auth/SMTP and Cloudflare Email Sending/SMTP docs were
retrieved. The separate Cloudflare domain-configuration page failed retrieval
and was excluded from the source ledger; domain onboarding prerequisites are
supported by the retrieved SMTP contract. No unverified mail-hook composition
was adopted. Actual SMTP compatibility, sending eligibility/domain and inbox
delivery remain gates, alongside the existing provider/runtime/policy decisions.

No database-backed reference tests were run or rerun for this documentation
change. No GeraiExpress account, invitation, factor, seller, quote, charge,
credential, cloud resource, browser/DB/Workers check, deployment or Git mutation
was performed. Document consistency is the verified result; product runtime
acceptance remains prospective in TD-11.


## Semantic completeness audit — 2026-10-13

### CTX-36 — Review and complete the existing Markdown pack
- Status: Observed
- Evidence kind: direct-observation
- Owner: Paduka Ongki
- Source: User conversation, 2026-10-13.
- Source locator: Latest request after the documentation status discussion.
- Source excerpt: "review doc md, jika ada yang kurang presisikan dan sempurnakan lengkap".
- Statement: Audit the existing Markdown for gaps and ambiguity and refine the canonical documents in place.
- Confidence: High for document-review scope; no additional implementation, production or credential authorization inferred.
- Recheck trigger: Owner changes scope or supplies a missing policy/provider fact.

### CTX-37 — Operational and financial contract completion
- Status: Proposal
- Evidence kind: inference
- Owner: Engineering owner
- Derived from: CTX-1, CTX-21, CTX-27, CTX-28, CTX-29, CTX-31, CTX-36.
- Statement: Activate bounded shipping-money, delivery/recovery and operational-signal contracts now, while preserving the selected retail/net policy and leaving unresolved commercial/provider values explicit.
- Confidence: High for applicable domains; no actual deployment, ledger, alerting or recovery capability is implied.
- Supporting evidence: The product already requests provider spending, stored tenant state, initial demo and Super Admin recovery/monitoring; release and reconciliation boundaries are necessary even before commercial values are accepted.
- Counterevidence: No application runtime or pilot workload exists; numerical SLOs, recovery objectives, exact local limits and installed telemetry APIs cannot yet be verified.
- Consequence: BILL-1/BILL-2, DEL-1/MIG-1/DR-1 and OBS-1/RATE-1 own these boundaries without duplicating PRD policy, TD-9 pricing or an execution queue.
- Recheck trigger: Requirement acceptance, application initialization, pilot readiness or provider/runtime changes.


Semantic audit verification, 2026-10-13: the research-stage validator passed with
15 specification Markdown files, 137 declarations, zero tasks and zero findings.
Independent checks covered 17 Markdown artifacts including both research notes,
25 local links and their one explicit heading anchor, 26 source records, all 128
prior declarations preserved, and nine synthetic exact-arithmetic assertions.
The user-selected pricing section remained byte-for-byte unchanged. Sixteen
registration/platform source fingerprints and both reference checkout revisions
and Git statuses remained unchanged. The retained official Public HTML matched
its recorded SHA-256. `reference-scan.json` stores the current result and preserves
the earlier document-check result as history.

Two read-only specialist reviews and a correction pass checked money/provider
semantics and registration/access transitions. Findings were resolved in their
canonical owners, including batch payment scope, URL renewal, decimal evidence,
application draft/submit effects, correction synchronization, lifecycle-bypass
denial, completed-user OTP routing, old-session/invitation replay and final
access-governance administrator protection. A second review corrected vendor
wording: courier is optional for the JNE default in Pay unpaid; always supplying
it explicitly is GeraiExpress policy, not a vendor requirement for JNE.

Numerical vectors are synthetic documentation checks, not provider tariffs or
application test evidence. New money/release/recovery/signal requirements remain
Proposed. Exact provider entitlements, approved ownership/commercial/privacy
policies, runtime/egress/mail compatibility and operational targets remain named
capability gates. No new successful vendor retrieval is claimed in this pass;
the additional reviewer web open was inaccessible, so existing retrieved bytes
and their provenance support the bounded protocol refinements.

No app repository, secrets, account, live provider operation, production data,
DB migration, browser runtime, deployment or Git mutation was created/accessed
by this document audit. No reference DB test was run. The verified outcome is a
more precise specification; implementation acceptance still requires DEL-1.


## Project promotion and architecture organization

### CTX-38 — Promote the documentation into the GeraiExpress project
- Status: Decision
- Evidence kind: human-policy
- Owner: Paduka Ongki
- Source: User conversation, 2026-10-13.
- Source locator: Request following AI CLI updates and confirmation of Projects directory listing.
- Source excerpt: "pindahkan ke prodject dan susun architech nya di project".
- Statement: Initialize ~/Projects/geraiexpress, promote the existing specification/research into it and organize the architecture in the project. Repository copies are canonical; source snapshots are retained under the planning-artifact policy.
- Selected option: Project-local docs/spec and docs/research with the canonical target architecture extended in ARCH-4 and an observed root ARCHITECTURE.md record.
- Consequence: Future work reads and edits repository documents; this promotion does not select unresolved business rules or establish runtime readiness.
- Recheck trigger: Owner changes project location or implementation decisions.

Native project-init promoted all 17 staged specification/provenance files.
Both research notes were copied and hash-checked. docs/promotion-manifest.json
records pre-refinement copy hashes; source snapshots remain untouched. Repository
refinements repair research links, clarify authority and replace generic bootstrap
placeholders with the selected Cloudflare/Supabase, visual and pricing direction.
ARCH-4 adds the proposed code layout, trust diagram, module/deployment ownership
and primary execution paths. No application source, dependencies, cloud resource,
account, migration, live provider operation, Git commit/push or deployment is
created by this promotion. Native generator is none.
