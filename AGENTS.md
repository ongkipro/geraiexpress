# Project Instructions — geraiexpress

## Scope

This file contains repository-specific rules only. Global safety, Git, secret-handling, native-first, and verification policy comes from the user's canonical AI policy.

## Project

- Purpose: Multi-tenant shipping-counter application using Mengantar, with reusable contacts and tenant/outlet identity.
- Category: Multi-tenant logistics product
- Current stack: Next.js App Router + TypeScript + shadcn/ui on Node.js; PostgreSQL 17 + PostgREST with application-owned auth. Hosting direction: Vultr + Coolify (DEC-022); Cloudflare Turnstile only.

## Sources of truth

- Accepted product behavior: `PRD.md`; for a specification-suite project it is
  only the entrypoint to canonical `docs/spec/02-PRD.md`
- Sole executable work queue: `TASKS.md`
- Current implementation handoff and semantic review state: `STATUS.md`
- Accepted technical and product constraints: `DECISIONS.md`
- Accepted implementation design when present: `PLAN.md`
- Full architecture decisions when present: `docs/adr/ADR-NNNN-<slug>.md`; `DECISIONS.md` remains the canonical index
- Current release boundary, declared release risk, rollback evidence: `RELEASE.md`
- Post-deploy runtime health contract: `OBSERVABILITY.md`
- Execution evidence and resume projection: `.delivery/`
- Durable implementation notes: `BUILD-LOG.md`
- Architecture and trust boundaries: `ARCHITECTURE.md`

When design and implementation diverge, `ARCHITECTURE.md` records what the code
actually does and therefore outranks a pre-implementation `PLAN.md`. Update the
plan or supersede its decision rather than leaving two current claims.

`STATUS.md` is the only workflow-state authority. `.delivery/current.json` is a projection/evidence index and must never override `STATUS.md`. Do not hand-edit `.delivery/runs/*.jsonl` or `.delivery/releases/*.json`; their integrity is verified by hash chains/self-hashes. Use `delivery-ledger` to start runs, capture an R1-R4 task boundary, record verification, check the final change surface, checkpoint handoffs, finish runs, and snapshot releases. A bounded run may not report `PASS` without a current passing or independently approved boundary result. The canonical behavior and examples live in `~/dotfiles/docs/task-change-boundary.md`.

Delivery metrics are optional immutable sidecars under `.delivery/metrics/`. Use `delivery-benchmark` to record them after a run finishes and to compare model reliability/cost empirically. Benchmark recommendations are advisory only. Do not rewrite routing from a small sample, do not select a cheaper model below the configured reliability floor, and never auto-downgrade R3/R4 work from benchmark output.

Inspect the repository's actual configuration before adding stack-specific rules. Disk and executable behavior override stale documentation. Production readiness must be proven by the repository gates; never infer it from prose alone. `production-gate` also requires `delivery-ledger verify` to pass before a release is production-ready.


## GeraiExpress boundaries

- `docs/spec/` and `docs/research/` are canonical. Documents staging copies are
  historical snapshots and must not receive current project edits.
- `docs/spec/04-SYSTEM-ARCHITECTURE.md` owns target architecture;
  `ARCHITECTURE.md` owns what is implemented and proved.
- Documentation is English; user discussion and product UI are Bahasa Indonesia.
- Tenant/contact/staff identities are distinct from Mengantar sellers. Protect
  current tenant/outlet/account scope at the application server and direct Data API/RPC boundaries.
- Customer/resi shipping uses normal Mengantar tariff; private seller net cost
  follows verified activated terms. Apply COD/insurance exactly once; preserve
  unknown versus zero. Never import a historical fee percentage as a default.
- Provider credentials, signing and dispatch remain server-only. Unknown order,
  payment or rotation results reconcile their original operation; no blind replay.
- shadcn/ui uses the supplied Apple-inspired single-blue/neutral system. UI-1
  through UI-5 and UX contracts govern operational density and accessible states.
- The first usable preview must provide PR-21's isolated working demo login.
- Do not install an alternate hosting/email/payment stack to bypass an unresolved
  compatibility or entitlement gate. Record proposed changes before implementation.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
