# GeraiExpress — Delivery, Migration and Recovery


> Current hosting amendment (DEC-022, owner, 2026-10-29): Vultr + Coolify runs the Node application and PostgreSQL 17 + PostgREST. `compose.coolify.yaml` is the Coolify entrypoint; public TLS belongs to Coolify, with the internal Caddy gateway on 8080. Same-host PostgreSQL is the initial target; off-host recovery and real production verification remain release gates. This supersedes DEC-020 wording that excluded Vultr/Coolify; Workers and Supabase remain retired from the local runtime.

- Status: Proposed release contract; Decisions DEC-020 and DEC-021 (ADR-0002, owner) select the self-hosted Node container with plain PostgreSQL 17 behind PostgREST and the application-owned auth module (T-062, T-064..T-066 built locally; T-067 security review and PostgreSQL backup/PITR gates open). Observed merged container/Compose and `db/` migration tooling is not production deployment evidence; the former Worker + Supabase preview is historical.
- Owner: Engineering owner
- Updated: 2026-10-29
- Sources: CTX-1, CTX-20, CTX-21, CTX-35, CTX-36, CTX-37, CTX-41; DEC-005, DEC-015, DEC-020, DEC-021, ADR-0002; BUILD-LOG.md, 2026-10-28/29; `Dockerfile`, `compose.yaml`, `compose.db.yaml`, `infra/env/`, `scripts/db-migrate.sh`, `scripts/check-environments.mjs`.

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
| Local foundation | Pin Next.js, Node, PostgreSQL 17, PostgREST and shadcn versions; native dependency/type/unit/build/bundle checks, standalone image and container smoke; fresh disposable PostgreSQL migrations (`scripts/db-migrate.sh --reset`, `db/foundation/`, `db/migrations/`) and role/RLS/auth negatives (`tests/db`) | Decision (DEC-020, DEC-021, owner): the Node/container and PostgreSQL/PostgREST gates replace the Workers adapter and Supabase CLI gates; old Worker/Supabase results do not prove this image |
| Usable demo preview | Working login instructions, synthetic tenant/contacts/shipments, simulated quote/create/recovery/label, tenant/admin/operator views and isolated admin demonstration if supplied | No live seller, real mail invitation, real AWB, money or production key; rendered 390/768/1280px journeys and denied direct actions under PR-21/UI-2 |
| Sandbox proof | Controlled Auth/mail, registration/invitation/recovery, two-tenant isolation, provider signing/egress, durable operations, price mapping, sender/pickup, PDF and tracking checks for the selected accounts/couriers | Explicit credentials/account authorization; capture bounded redacted evidence. Sandbox success does not establish production entitlements or actual commercial tariffs |
| Bounded production pilot | Selected ownership/IAM/application/retention policies; native mail and privileged recovery; actual approved egress; provider pricing/label permissions; named responders, observability and restore drill; explicit release authorization | Enable only the proved modes/couriers. Full COD retains BILL-1's goods-settlement gate; no general-availability/SLA claim |

Development/demo, provider sandbox and production use distinct data, credentials,
callback configuration and provider-environment binding. Preview builds receive
synthetic or deliberately isolated non-production resources only. Never clone
customer records, keys, sessions or production labels into fixtures. Decision
(DEC-020, DEC-021, ADR-0002, owner): self-hosted Node replaces Cloudflare Workers
and the withdrawn Vultr/Coolify gateway design, and plain PostgreSQL 17 + PostgREST
+ application-owned auth replace Supabase; Cloudflare Turnstile remains. Proposal
(unbuilt): the production mail provider/transport is selected through T-063, not
silently substituted for missing mail readiness or an alternate funding account.

Observed: `package.json` supplies native build, test, bundle, environment and
Docker commands. Proposal for the release pipeline: deterministic install →
static/type/unit checks → disposable schema/RLS/RPC and concurrency checks →
environment-specific image build and bundle scan → actual Compose/env-file
guard → container smoke and affected browser journeys → explicit release gate.
The final-image full Playwright gate uses all three product viewports under
T-062; the lead records its result. Stop the local scheduler while tests share
the local database. Provider-mutating checks require a separately authorized
environment and cannot run on arbitrary pull requests. This is a pipeline
contract, not a claim that an automated CI/release workflow exists.

Each release evidence record names revision, pinned runtime/dependencies,
environment, schema/policy/config versions, enabled capabilities, exact checks
and observed results, known exclusions, rollback target and owner. Keep secrets,
raw customer data and signed label links out. Accept requirements before creating
the one root `TASKS.md`; this matrix is not another execution queue.

## DEL-2 — Environment separation, host cutover and self-hosted release gates
- Status: Proposed cutover contract; Decision (DEC-015 hosts, DEC-020 runtime, DEC-021 / ADR-0002 PostgreSQL + PostgREST + owned auth, owner); Observed provider scope/key ring, `db/` migration runner and Compose/env-file guard; T-067 security review/backup gates, remote environment isolation, TLS and rollback unproved
- Owner: Engineering owner
- Source: DEC-015, DEC-020, DEC-021, ADR-0002, CTX-41 items 8, 10 and 15; TASKS T-037, T-042, T-050, T-062, T-063, T-064, T-065, T-066, T-067; `scripts/check-environments.mjs`, `scripts/db-migrate.sh`, `scripts/docker.sh`, `Dockerfile`, `compose.yaml`, `compose.db.yaml`, `infra/env/*.env.example`.
- Statement: Each environment (local, staging, production) shall own its PostgreSQL 17 database, internal PostgREST instance, Compose deployment, hosts, signing/encryption secrets and Mengantar scope. A hosting/host change requires a staged cutover and a rollback that never replays external effects. Decision (DEC-020, DEC-021, owner): no Cloudflare Worker, separate egress gateway or Supabase service is a current deploy target.
- Acceptance: A staging/production release record names the exact hosts, PostgreSQL database target, environment-specific image tag/digest and provider environment; actual external env files and rendered Compose configuration pass `pnpm check:environments`; `scripts/db-migrate.sh` verifies the `private.schema_migrations` checksum ledger; a rehearsed rollback restores the previous compatible image/configuration and host routing without replaying a provider operation.
- Constraints: ARCH-5, ARCH-6, DEL-1, MIG-1, DR-1, SEC-6, SEC-7, DATA-8, ADR-0002.
- Evidence: Observed merged code: `scripts/check-environments.mjs` validates named env files (distinct 32+ char `AUTH_JWT_SECRET`, `AUTH_SECRET`, `TURNSTILE_SECRET_KEY`, `PGRST_DB_URI`, `CREDENTIAL_KEY*`, `CRON_SECRET`, `MENGANTAR_*`) and renders `docker compose config` (`app`, `scheduler`, `postgrest`, `proxy`); its default inputs are the secret-free `infra/env/{staging,production}.env.example` templates. `scripts/docker.sh` wraps local image/Compose operations and requires build-time `APP_ORIGIN`; `scripts/db-migrate.sh` applies `db/foundation/` and `db/migrations/` with SHA-256 checksum verification. These files do not prove remote databases, actual secret isolation, DNS, production ACME or rollback.
- Change history: 2026-10-29 — Decision (DEC-020, owner) replaces Wrangler/deploy scripts and the hybrid gateway release gate with Node/Compose gates. Decision (DEC-021, ADR-0002, owner) replaces Supabase projects and CLI steps with plain PostgreSQL 17, PostgREST and `scripts/db-migrate.sh` (T-064..T-066; T-067 gates open).

| Topic | Target contract | Observed state / remaining claim (2026-10-29) |
|---|---|---|
| Separate databases and secrets | Decision (CTX-41 item 15; amended by DEC-020 and DEC-021, owner): each shared environment has its own PostgreSQL 17 database, PostgREST service, Compose deployment, signing secrets (`AUTH_JWT_SECRET`, `AUTH_SECRET`), hosts and provider scope, with no shared credential/seller id | `infra/env/staging.env.example` and `production.env.example` define the secret-free templates; `scripts/check-environments.mjs` rejects any secret value shared across environments. Proposal (unbuilt): provision actual isolated databases and env files; a template PASS is not remote evidence |
| Provider environment scope | Proposal: seller binding/credential scope follows provider environment; a sandbox key must never serve production | Observed T-050: `provider_env` on private onboarding/credentials and environment-qualified machine reads. F1 permits same-environment Partner recovery across regeneration; reconcile caller `p_env` remains T-057 |
| Per-environment secrets | Decision (DEC-020, DEC-021, owner): runtime env files outside the checkout, mode 0600, separate values per environment; never bake secrets into images | Observed: `src/lib/config.ts` reads the container environment; `compose.yaml` requires `GX_ENV_FILE`; `scripts/check-environments.mjs` rejects shared secrets, short secrets (< 32 chars), equal `AUTH_JWT_SECRET`/`AUTH_SECRET`, and secret-bearing committed templates; the scheduler receives only `CRON_SECRET` and `postgrest` receives only `PGRST_DB_URI` and `AUTH_JWT_SECRET` |
| Deploy guard and image | Proposal: actual env-file/Compose checks precede release; build with that environment's `APP_ORIGIN` and retain the exact image tag/digest | Observed: guard checks secret reuse, HTTPS/origin presence, production-value restrictions, IPv4-only published proxy ports and proxy/scheduler/postgrest boundaries; `Dockerfile` requires `APP_ORIGIN` and runs `check-client-bundle.mjs`. T-061 retains the pure-origin validation gap |
| Host cutover | Decision (DEC-015): apex/app/owner/hooks audiences; Proposal: configure staging first, then production, including `SITE_ORIGIN`, `APP_ORIGIN`, `OWNER_ORIGIN`, `HOOKS_ORIGIN` | Observed: host/router code (`src/lib/hosts.ts`, `src/proxy.ts`), Caddy host variables and four origin variables exist (the former Supabase redirect/hook URLs are gone under DEC-021). Proposal (unbuilt): owner DNS/provider/region and ACME contact choice. Unknown: production TLS issuance/renewal |
| Old preview | Retire the remote Worker and old Supabase project `geraiexpress-preview` and rotate their secrets (`RELEASE.md` gate 10) | Local removal of Workers and Supabase tooling does not delete the remote preview. Retirement and secret rotation remain owner-gated |
| Production egress | Decision (DEC-020, owner): server's fixed IPv4 is registered with Mengantar; no separate gateway | Proposal (unbuilt): owner reserves server/address; ARCH-2 requires actual source-address acceptance and no-replay failure proof |
| Search indexing | Decision (CTX-41 item 9): noindex on every non-marketing host; non-production disallow-all | Observed: `src/proxy.ts` applies non-apex `X-Robots-Tag: noindex, nofollow`. Unknown: prior search-engine indexing and removal |
| Runtime security and capacity | No second app instance without a shared limiter store; preserve visitor identity and bound logs without assuming former Cloudflare protection | Observed (T-062 fixes merged): process-local limiter (exhausted windows never evicted), unpublished `app`/`postgrest` ports, IPv4-only `0.0.0.0` proxy bind (no AAAA records), `172.30.62.1/32` local gateway trust, required `GX_ENV_FILE`, and `10m × 3` container log limits. Absent DDoS/WAF replacement and T-067 auth security review remain open |
| Release record and rollback | Record the true environment, database backup proof and an existing previous compatible image; rehearse restart without provider replay | Observed: `Dockerfile` and `RELEASE.md` define image-based delivery/rollback mechanics. Proposal (T-067): provide PostgreSQL backup/restore drill and PITR proof (`RELEASE.md`'s old Supabase snapshot is historical only) |

Proposal (unbuilt, owner-gated): choose server provider/region/fixed IPv4, DNS for
four hosts (A records only, no AAAA), ACME contact, production mail provider (T-063),
and where production PostgreSQL 17 runs (same-server `db` profile or managed
PostgreSQL) with its backup and PITR strategy (T-067); obtain qualified data-residency
advice where applicable.

## MIG-1 — Forward-compatible schema and configuration changes
- Status: Proposed
- Owner: Engineering owner
- Source: DATA-1 through DATA-7, TEN-1, CTX-37.
- Statement: Maintained releases shall use a reviewed fresh PostgreSQL migration history (`db/foundation/` and `db/migrations/`, applied by `scripts/db-migrate.sh` with the checksum ledger `private.schema_migrations`, DEC-021, ADR-0002) and compatible staged changes that preserve tenant constraints, RLS, current grants and durable provider operation identity.
- Acceptance: A representative non-production upgrade preserves existing snapshots and pending operations, denies cross-tenant/direct access, refuses any modified already-applied migration checksum, and allows the recorded application rollback without replaying external effects.
- Constraints: DEL-1, TD-3, TD-8, SEC-1, ADR-0002; no automatic migration of LegacyReference customers/users/credentials is authorized.
- Evidence: Observed on disk: `scripts/db-migrate.sh` applies `db/foundation/20261001000000_pg_foundation.sql` and 34 files in `db/migrations/` (35 migrations total through `20261029100000_auth_core.sql`) in one transaction per file with SHA-256 checksum verification in `private.schema_migrations`; `scripts/db-verify.sh` exercises a clean reset + 27 DB test files (410 tests).

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

Observed 2026-10-29: 1 foundation migration (`db/foundation/20261001000000_pg_foundation.sql`)
and 34 application migrations under `db/migrations/` (renamed from `supabase/migrations/`
in T-064/T-066, through `20261029100000_auth_core.sql`) exist on disk. Additive
changes (the seller-binding uniqueness and write-once guard of T-032, the global
default-privilege revoke of T-035, discount terms of T-041, the shipment-reference
counter and label snapshot of T-044, environment scope and key ring of T-050, and
the owned auth core of T-065) are enforced in SQL. A unique index on
`partner_seller_id` is applied only after a duplicate check on any environment
that already holds Partner-onboarded tenants; a duplicate found there is a tenant
incident to investigate, not a row to delete silently.

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
2. Identify recovery points for PostgreSQL 17 (`public`, `private` and `auth`
   schemas, including `auth.users`, `auth.sessions`, `auth.mfa_factors` and
   durable account coordination/outbox), object assets and secret/configuration
   versions (`AUTH_JWT_SECRET`, `AUTH_SECRET`, `CREDENTIAL_KEY*`). Production
   PostgreSQL backup (`pg_dump` / `scripts/db-backup.sh`, not yet on disk), a
   tested restore drill and point-in-time recovery (WAL archiving or managed
   PITR) remain open under T-067; a database backup alone is not proof that all
   these systems can be restored together.
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
