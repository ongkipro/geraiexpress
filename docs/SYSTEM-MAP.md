# GeraiExpress — System Map (navigation, one screen)

Updated: 2026-11-09 · head `257cc84` · branch `feat/counter-ops-2026-11`. This page only points; it does not
duplicate [ARCHITECTURE.md](../ARCHITECTURE.md) (what the code does, with diagrams) or STATUS.md (evidence).

## Repository layout

| Path | Holds |
|---|---|
| `src/app` | Next.js App Router: 41 pages and 6 route handlers (route table: ARCHITECTURE "Runtime route map") |
| `src/lib`, `src/modules`, `src/components`, `src/proxy.ts` | server libraries (`db/`, `auth/`, `mengantar/`, hosts, CSP), feature modules, UI (`ui/` = shadcn), host/session proxy |
| `db/foundation`, `db/migrations`, `db/*.sql` | plain-PostgreSQL prerequisites; 71 forward-only migrations; `seed.sql` and optional local fixtures |
| `tests/` | `unit` (109 files), `db` (52), `e2e` (35 specs), `contract` (2, opt-in live), `preview` (1) |
| `infra/`, `compose*.yaml`, `Dockerfile` | Caddy configs, scheduler sidecar, env templates; 4 Compose files (app/prod, Coolify, local, local db) |
| `scripts/`, `data/mengantar/` | db, docker, check and test harness scripts; the area catalogue snapshot |
| `docs/` | `spec/` canonical target, `adr/` (3), `research/`, `review/` (dated history), `runbooks/staging-alpha.md`, `WORKFLOW.md`, this page |
| `.delivery/` | delivery-ledger runs, releases and reviews (evidence; never edited by hand) |

## Runtime hosts and audiences

One container serves every host; `src/lib/hosts.ts` maps the Host header to an audience and `src/proxy.ts` answers 404
outside it. Production names (staging adds `-staging`):

| Host | Audience | Serves |
|---|---|---|
| `geraiexpress.com` | public | marketing pages, `/lacak/[token]`, robots, sitemap |
| `app.` | gerai workspace | sign-in/registration, `(workspace)` pages, `/api/mengantar/area` |
| `owner.` | Super Admin | `/admin/*` (grant + aal2 TOTP) |
| `hooks.` | cookie-less provider webhooks | only `POST /api/webhooks/mengantar/[endpoint]` and `/healthz` |
| `internal.geraiexpress.local` | scheduler only | `/api/internal/cron/{dispatch,cleanup}`; never routed by Caddy |

Local: a bare `127.0.0.1` serves every audience (`HOST_SHARED_MODE=1` for the container). Deployment target is Vultr +
Coolify (`compose.coolify.yaml`, DEC-022); nothing is provisioned.

## Data path

```text
browser -> Caddy proxy -> Next.js app (proxy.ts, Server Actions, pages)
        -> PostgREST (HS256 JWT: the user's, or the machine identity) -> PostgreSQL 17 (RLS, RPCs, private schema)
```

The app owns auth (`src/lib/auth`, `auth.*` tables, machine-only `auth_*` RPCs). PostgREST is never published.
Every user read and write carries the user's JWT; only `service_role` RPCs (dispatch, status ingestion, cancel record)
write provider results. See ARCHITECTURE "System map" and "Data map".

## Provider (Mengantar) path

- **Dispatcher**: Server Actions and the 5-minute `dispatch` sweep send quote/order/pickup/payment calls with the
  seller's key opened only in the app server; unknown outcomes are reconciled by reference, never resent.
- **Status in**: signed webhook on the hooks host, plus the hourly `cleanup` task's `status_pull` (`GET /order`); both end
  in `ingest_provider_status`. Details: ARCHITECTURE "Provider status ingestion (T-045)".
- **Cancel / batch delete / refund record** (T-045 slice 2): library and SQL only, **no route or screen calls them**.
- **Cron**: `scheduler` container -> `/api/internal/cron/*` with `CRON_SECRET`; cleanup also runs demo cleanup, auth purge,
  credential and webhook-secret rewrap.

## Which document owns what

| Document | Owns |
|---|---|
| `PRD.md` -> `docs/spec/02-PRD.md` | accepted product behavior (entry point to the spec pack, `docs/spec/README.md`) |
| `TASKS.md` | the sole executable work queue |
| `STATUS.md` | workflow state, current counts, review chain, M-milestone evidence; the only state authority |
| `DECISIONS.md`, `docs/adr/` | accepted owner decisions (DEC-001..DEC-029) and full architecture decisions (ADR-0001..0003) |
| `ARCHITECTURE.md` | what the code does and what is proved; outranks any pre-implementation design (no `PLAN.md` exists) |
| `docs/spec/` | canonical target design, data model, security, UX contracts |
| `RELEASE.md`, `OBSERVABILITY.md` | release boundary, risk and rollback gates; post-deploy health contract |
| `BUILD-LOG.md` | durable, append-only implementation notes |
| `.delivery/` | execution evidence and resume projection (never overrides STATUS.md) |
| `docs/research/`, `docs/review/` | provider and market studies; dated reviews (evidence, not requirements) |
| `docs/WORKFLOW.md` | the device-independent working agreement: change discipline, verification ladder, integrated run, review, parallel work, publishing |
| `docs/runbooks/staging-alpha.md` | alpha staging execution checklist (T-114; not deployed) |

## Migration and test conventions

- Migrations: `db/migrations/<yyyymmddhhmmss>_<slug>.sql`, forward-only and immutable once applied; `pnpm db:migrate`
  applies new ones and refuses changed history. Latest: `20261109210000_pickup_lead_reader.sql` (71 files).
- Every new SQL function must be added to the allowlists in `tests/db/privileges.test.ts` in the same change.
- Tests: `*.test.ts` under `tests/unit`, `tests/db`, `tests/contract`; `*.spec.ts` under `tests/e2e` and `tests/preview`.
  DB suites run one at a time on one database (`pnpm db:verify`, or disposable `node scripts/test-backend-isolated.mjs`).
- E2E runs at three viewports (mobile-390, tablet-768, desktop-1280). Commands: README "Checks".
