# GeraiExpress

Multi-tenant shipping-counter application using Cloudflare, Supabase and Mengantar.

Status: DEL-1 local foundation and synthetic demo preview implemented and verified locally.
Nothing is deployed, and no real Mengantar account, email or customer data is used. Technical
documentation is English; conversation and product UI are Bahasa Indonesia.

## Start here

- [System map and current architecture](ARCHITECTURE.md): what is implemented and proved,
  with runtime, code, data and flow diagrams.
- [Specification index](docs/spec/README.md): canonical product, technical, data,
  access, design, financial, operational and UX contracts.
- [Architecture design](docs/spec/04-SYSTEM-ARCHITECTURE.md): target system boundaries.
- [Current status](STATUS.md), [decisions](DECISIONS.md), [work queue](TASKS.md)
  and [build history](BUILD-LOG.md): repository handoff and actual evidence.
- [Mengantar Partner study](docs/research/geraiexpress-mengantar-partner-api.md)
  and [reference pricing study](docs/research/geraiexpress-geraicuan-pricing-review.md).

## Run locally

Requirements: Node 24, pnpm 12, Docker (for the local Supabase stack). Nothing here talks to a
shared or production service. Note that the Supabase CLI publishes its local ports (API 54321,
Postgres 54322 with default credentials, Studio 54323, mail capture 54324) on all interfaces;
run it only on a machine whose firewall blocks those ports from other hosts.

```bash
pnpm install
pnpm db:start            # local Supabase (Auth, Postgres, Data API) with migrations + seed
pnpm dev:env             # writes gitignored .env.local and .dev.vars from the local stack
pnpm dev -p 3100 -H 127.0.0.1   # Next.js dev server → http://127.0.0.1:3100
```

Run in the Cloudflare Workers runtime (workerd) instead of the Node dev server:

```bash
pnpm cf:build
pnpm exec wrangler dev --port 8787 --ip 127.0.0.1   # → http://127.0.0.1:8787
```

AI agents: `next dev` rewrites `AGENTS.md` when it detects an agent environment; start it
with the agent variables unset (see BUILD-LOG.md) or revert the injected block.

### Demo access (PR-21)

Open `/masuk` and choose **Coba demo**. No account or password is needed: each visitor gets an
isolated sample gerai ("Gerai Contoh Sentosa") with saved contacts and example shipments
(issued, unknown outcome, draft). Quotes, resi (`SIM…`) and labels are simulations and are
marked as such. **Atur ulang demo** restores the examples; **Keluar** ends the session.

Local test accounts (seeded fixtures, local stack only, password `geraiexpress-local-dev`):
`owner-a@geraiexpress.test`, `operator-a@geraiexpress.test`, `owner-b@geraiexpress.test`,
`no-access@geraiexpress.test`, `multi@geraiexpress.test` (two gerai → choose one).

## Checks

```bash
pnpm typecheck && pnpm test:unit
pnpm db:reset && pnpm test:db                 # isolation + shipment flow through Data API/RPC
pnpm build && pnpm cf:build && pnpm check:bundle && pnpm smoke:worker
pnpm test:e2e                                 # needs a server on :3100 (or E2E_BASE_URL)
```

## Repository layout

```text
geraiexpress/
├── src/
│   ├── app/                      # Next.js routes: masuk, akses, pilih-gerai, healthz
│   │   └── (workspace)/          # pengiriman, kontak, pengaturan (membership required)
│   ├── components/               # shell, status badge; ui/ = shadcn (radix, UI-2 tokens)
│   ├── lib/                      # Supabase server client, workspace scope, auth actions
│   ├── modules/                  # contacts/, shipments/ (actions, validation, forms)
│   └── middleware.ts             # session refresh, private no-store responses
├── supabase/
│   ├── migrations/               # schema, RLS, RPCs, signup gate, quote reuse
│   ├── seed.sql                  # local synthetic fixtures only
│   └── config.toml               # local stack configuration
├── tests/                        # unit/, db/ (Data API/RPC), e2e/ (Playwright, 3 viewports)
├── scripts/                      # bundle scan, worker smoke, ui smoke, dev env
├── docs/                         # canonical spec pack, research, promotion manifest
├── .delivery/                    # delivery-ledger runs (execution evidence)
└── AGENTS.md · STATUS.md · TASKS.md · DECISIONS.md · ARCHITECTURE.md · BUILD-LOG.md
```

## Selected direction

Cloudflare + Supabase; Next.js App Router on Workers via OpenNext 1.x (DEC-005). shadcn/ui with the supplied Apple-inspired palette. Customer/resi shipping uses
normal Mengantar tariff; private seller cost uses the verified activated discount. Live
provider integration, real registration and Super Admin remain gated (see TASKS.md).
