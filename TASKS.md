# GeraiExpress — Execution Queue

Updated: 2026-10-14

This is the sole execution queue. Canonical requirements remain in
[docs/spec/02-PRD.md](docs/spec/02-PRD.md); no competing root PRD is maintained.

## Completed slice — DEL-1 local foundation and usable demo preview

Owner request (2026-10-13): run development task by task, leave delivery footprint and
produce a system map. Scope was DEL-1's first two stages only: local foundation and a
synthetic demo preview (PR-21, IAM-4, UX-3). No cloud resource, Mengantar call, seller
onboarding, email, deployment, commit or push was made. Owner-held policies (CTX-9
ownership, roles, registration, pricing activation, retention) stay open; the demo uses only
synthetic data and a server-side simulated provider.

Shared constraints for every task: Cloudflare + Supabase; tenant scope comes from
server-verified membership, never a client selector; every tenant-owned path pairs a
same-tenant success with a cross-tenant denial (NFR-1); provider work is simulated and refuses
non-demo tenants; UI copy is Bahasa Indonesia; tokens follow UI-2.

Every task below ran as its own `delivery-ledger` run with executed checks, a boundary check
and a separate independent reviewer. Run IDs and evidence are in `.delivery/runs/`; the
narrative is in [BUILD-LOG.md](BUILD-LOG.md).

| Task | Requirement | Risk | Result | Done-when evidence |
|---|---|---|---|---|
| T-001 Runtime foundation and Workers compatibility | ARCH-1, DEL-1 | R1→R3 | PASS, reviewed | typecheck, build, cf:build, bundle scan, worker smoke, browser smoke |
| T-002 Supabase schema, RLS and isolation tests | TEN-1, DATA-1/2, IAM-4 | R3 | PASS, security-reviewed | db reset, 32 isolation/flow tests, db lint, mutation check |
| T-003 Auth, demo entry, scoped shell, queue | PR-1, PR-13, PR-21, UX-3 | R2→R3 | PASS, reviewed | e2e on next dev and Worker incl. 44px targets, forged cookie |
| T-003b Two-membership fixture and tenant chooser test | PR-1 | R2→R3 | PASS, reviewed | `/pilih-gerai` e2e |
| T-004 Contact directory | PR-2 | R2 | PASS, reviewed | contacts e2e incl. stale tab and tampered foreign form |
| T-005 Intake, simulated quote, review, confirmation | PR-4, PR-5, PR-7, PR-22 (sim), NFR-2 | R3 | PASS, security-reviewed | unit, DB, e2e incl. double-click, stale tab, charge = reviewed price |
| T-006 Sample label and print | PR-6 (sim), UX-3 | R2 | PASS, reviewed | label reuse, print media, no-AWB redirect |
| T-008 Quote reuse in RPC and seeded quotes | DATA-2, PR-4 | R3 | PASS, security-reviewed | DB tests, db lint, Worker e2e |
| T-007 Readiness settings, browser proof, system map | PR-8, UX-3, NFR-4 | R2→R3 | PASS, reviewed | settings e2e, full Worker e2e, ARCHITECTURE.md system map |

T-008 was inserted after T-006 so the closing documentation reflects the final database.

## Next candidates (not started; each needs its owner decision or gate)

Owner decisions DEC-005 to DEC-008 (adapter, CTX-9, CTX-34, roles) were accepted on
2026-10-14 and the verified slice was committed and pushed on owner request.

1. Enforce DEC-008 operator limits in RLS/RPC as each gated action (contact archive, export,
   unknown-outcome resolution, member management) is built; each needs an operator-denied test.
2. Close the anonymous-to-verified-email conversion before any invite-by-email work (PR-31).
3. Remote Supabase project + Cloudflare preview with isolated demo data (DEL-1 stage 2 hosting;
   needs provisioning/deploy approval and an Auth rate-limit decision for Worker egress).
4. Mengantar sandbox contract proof (DEL-1 stage 3; needs sandbox credentials; ownership per DEC-006).

## Deferred (owner decision or external gate)

Real registration/invitations (PR-29–PR-33, DEC-007; needs ARCH-3 mail),
seller onboarding/BYOK (PR-17–PR-20, DEC-006; needs Partner access/egress),
live quotes/issuance/labels (sandbox credentials), Super Admin workspace
(PR-15, PR-23–PR-28, bootstrap per DEC-008), CSV/export/overview.
