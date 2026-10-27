# GeraiExpress — Delivery, Migration and Recovery

- Status: Proposed release contract; no repository, CI pipeline or deployment exists.
- Owner: Engineering owner
- Updated: 2026-10-13
- Sources: CTX-1, CTX-20, CTX-21, CTX-35, CTX-36, CTX-37.

## DEL-1 — Evidence-based release stages
- Status: Proposed
- Owner: Engineering owner
- Source: PR-21, PR-29 through PR-33, NFR-1 through NFR-5; CTX-37.
- Statement: Releases shall progress through isolated demonstration, sandbox contract proof and bounded production pilot with evidence tied to the exact application/configuration/schema version and enabled capabilities.
- Acceptance: A release cannot enable an unproved capability or point a demo/preview at production credentials/data; each enabled primary journey has recorded backend, direct-boundary and browser evidence.
- Constraints: ARCH-1, ARCH-2, ARCH-3, TEN-1, SEC-1, SEC-5, BILL-1; this document does not authorize provisioning, deployment or live writes.
- Evidence: Prospective release gates only.

| Stage | Required deliverable and evidence | Exit / limitation |
|---|---|---|
| Local foundation | Pin actual Next.js/Workers adapter, SDK and shadcn versions; run native dependency/build/type checks and Worker compatibility smoke; fresh disposable Supabase migrations and role/RLS negatives | Resolve the beta-runtime compatibility question before depending on it; no successful runtime claim from the old source build |
| Usable demo preview | Working login instructions, synthetic tenant/contacts/shipments, simulated quote/create/recovery/label, tenant/admin/operator views and isolated admin demonstration if supplied | No live seller, real mail invitation, real AWB, money or production key; rendered 390/768/1280px journeys and denied direct actions under PR-21/UI-2 |
| Sandbox proof | Controlled Auth/mail, registration/invitation/recovery, two-tenant isolation, provider signing/egress, durable operations, price mapping, sender/pickup, PDF and tracking checks for the selected accounts/couriers | Explicit credentials/account authorization; capture bounded redacted evidence. Sandbox success does not establish production entitlements or actual commercial tariffs |
| Bounded production pilot | Selected ownership/IAM/application/retention policies; native mail and privileged recovery; actual approved egress; provider pricing/label permissions; named responders, observability and restore drill; explicit release authorization | Enable only the proved modes/couriers. Full COD retains BILL-1's goods-settlement gate; no general-availability/SLA claim |

Development/demo, provider sandbox and production use distinct data, credentials,
callback configuration and provider-environment binding. Preview builds receive
synthetic or deliberately isolated non-production resources only. Never clone
customer records, keys, sessions or production labels into fixtures. Cloudflare
and Supabase remain the selected stack; no third-party SMTP, VPS or alternate
funding account is silently added when an entitlement is unavailable.

Native project scripts become the CI authority after scaffolding. The proposed
pipeline is deterministic install → static/build checks → focused logic/money
checks → disposable schema/RLS/RPC and concurrency checks → affected browser
journeys → explicit release gate. Provider-mutating checks require a separately
authorized environment and cannot run on arbitrary pull requests. No command or
workflow filename is promised before those scripts exist.

Each release evidence record names revision, pinned runtime/dependencies,
environment, schema/policy/config versions, enabled capabilities, exact checks
and observed results, known exclusions, rollback target and owner. Keep secrets,
raw customer data and signed label links out. Accept requirements before creating
the one root `TASKS.md`; this matrix is not another execution queue.

## MIG-1 — Forward-compatible schema and configuration changes
- Status: Proposed
- Owner: Engineering owner
- Source: DATA-1 through DATA-7, TEN-1, CTX-37.
- Statement: Maintained releases shall use a reviewed fresh Supabase migration history and compatible staged changes that preserve tenant constraints, RLS, current grants and durable provider operation identity.
- Acceptance: A representative non-production upgrade preserves existing snapshots and pending operations, denies cross-tenant/direct access, and allows the recorded application rollback without replaying external effects.
- Constraints: DEL-1, TD-3, TD-8, SEC-1; no automatic migration of LegacyReference customers/users/credentials is authorized.
- Evidence: No SQL or migration executed.

Use additive changes first, then bounded resumable backfill if required, then
switch reads/writes only after validation. Remove old structures only through a
separately reviewed destructive change after rollback needs expire. Record
schema compatibility for both old and new workers/queued payloads; stale messages
cannot bypass current authority or rerun an unknown provider operation.

Check foreign keys, ownership-column mutation, grants/RLS and private monetary
projections during each relevant schema change. Configuration versioning includes
provider environment, credential reference, signing, mail, pricing assignment and
capability flags. Do not restore an obsolete credential revision or re-enable a
disabled courier merely by rolling back UI/application code.

## DR-1 — Restore without duplicating provider effects
- Status: Proposed
- Owner: Engineering owner
- Source: NFR-2, TD-3, TD-8, DATA-2, CTX-37.
- Statement: Incident recovery shall preserve or reconcile external-operation uncertainty across database, dispatcher and secret/configuration recovery before any affected account resumes mutations.
- Acceptance: A non-production restore drill covers an operation dispatched after the backup point, a changed credential version and duplicate queued delivery; no blind create/payment/rotation follows restore, and current authorization is re-established.
- Constraints: BILL-2, MIG-1, OBS-1; no zero-loss, RPO/RTO, availability percentage or contractual SLA is promised.
- Evidence: Recovery design only; backups and restoration have not been exercised.

1. The authorized responder fences affected new dispatch and records the incident
   scope. Read-only status and safe known-result capture continue where possible.
2. Identify recovery points for Supabase application/Auth data, durable account
   coordination/outbox, object assets and secret/configuration versions. Verify
   what the actual purchased services back up; a database backup alone is not
   proof that all these systems can be restored together.
3. Restore into an isolated environment first. Validate identity/grants, RLS,
   snapshots, account identity, command receipts and audit continuity. Record
   any gaps rather than inventing missing events.
4. Reconcile operations that may have reached Mengantar after the recovery point,
   including orders/payments, seller creation and key rotation. Suppress stale
   queued deliveries and retain unknowns; provider state cannot be rolled back
   by restoring local SQL. Lost callback-secret recovery remains TD-8.
5. Verify current credentials and least-privilege access, then release the fence
   by actual account only when its operation history is safe. Validate one
   authorized journey and signals before expanding scope.

Paduka Ongki and the engineering owner must select recovery-point/time targets,
backup retention/entitlements, on-call identity and restoration authorization
before the pilot. Record drill duration and observed data loss against those
targets. No separate SLA document is activated without a customer commitment;
this document is the canonical recovery owner until that trigger occurs.
