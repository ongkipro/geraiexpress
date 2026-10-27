# GeraiExpress

Multi-tenant shipping-counter application using Cloudflare, Supabase and Mengantar.

Status: DEL-1 stages 1–3 implemented and verified locally (T-001 through T-030: local foundation,
platform/onboarding slice, public marketing pages, Mengantar Partner sandbox seller onboarding,
live quotes/issuance, two-pass COD pricing, and batch `pay-unpaid` recovery) with a synthetic-data
preview deployed (see Preview below). Production is not provisioned, and no real customer data is
used. Technical documentation is English; conversation and product UI are Bahasa Indonesia.

## Preview

A synthetic-data demo preview runs at https://geraiexpress-preview.ongki.workers.dev (open
`/masuk` → **Coba demo**). Deployment and remote settings: [RELEASE.md](RELEASE.md).

## Start here

- [System map and current architecture](ARCHITECTURE.md): what is implemented and proved,
  with runtime, code, data and flow diagrams.
- [Specification index](docs/spec/README.md): canonical product, technical, data,
  access, design, financial, operational and UX contracts.
- [Architecture design](docs/spec/04-SYSTEM-ARCHITECTURE.md): target system boundaries.
- [Current status](STATUS.md), [decisions](DECISIONS.md), [work queue](TASKS.md)
  and [build history](BUILD-LOG.md): repository handoff and actual evidence.
- [Mengantar Partner study](docs/research/geraiexpress-mengantar-partner-api.md) and
  [reference pricing study](docs/research/geraiexpress-reference-pricing-review.md).

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
pnpm dev:hook-relay      # lets local Auth (Docker) call the app's Send Email Hook (DEC-009);
                         # without it no Auth email (codes) is delivered
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
`no-access@geraiexpress.test`, `multi@geraiexpress.test` (two gerai → choose one),
`owner-c@geraiexpress.test` (Gerai Uji C, used by platform lifecycle tests).

Credentials (local): `pnpm dev:env` also writes a local `CREDENTIAL_KEY` (kept across runs) used
to seal seller API keys saved under `/pengaturan`; the Partner Secret is not needed locally.

Registration (local): `/daftar` sends a 6-digit code to the local mail capture at
http://127.0.0.1:54324 (Mailpit); public registration is open only because `seed.sql` opens it.
Approve applications as a Super Admin under `/admin/pengajuan`.

Super Admin fixtures (open `/masuk`, then `/verifikasi-2fa`): `admin@geraiexpress.test` and
`admin-2@geraiexpress.test` have a verified TOTP factor whose local-only secrets are in
`tests/totp.ts` (add them to an authenticator app or compute codes with `totp()`);
`admin-new@geraiexpress.test` has no factor and walks through enrolment.

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
├── custom-worker.ts              # OpenNext Worker entry + scheduled cron (dispatch_sweep, demo_cleanup)
├── src/
│   ├── app/                      # Next.js routes: /, fitur, simulasi, cara-kerja, hubungi-kami,
│   │   │                         # masuk, akses, pilih-gerai, daftar, undangan, verifikasi-2fa,
│   │   │                         # admin (akses, audit, pengajuan, integrasi), api/auth/send-email, healthz
│   │   └── (workspace)/          # pengiriman, kontak, pengaturan, anggota (membership required)
│   ├── components/               # shell, status badge, marketing; ui/ = shadcn (radix, UI-2 tokens)
│   ├── lib/                      # Supabase server client, workspace scope, auth/platform/registration,
│   │   └── mengantar/            # Partner & Public API clients, account dispatcher, live quotes/orders
│   ├── modules/                  # contacts/, credentials/, members/, shipments/ (actions, validation, forms)
│   └── middleware.ts             # session refresh, private no-store responses, security headers
├── supabase/
│   ├── migrations/               # schema, RLS, RPCs, signup gate, COD, Partner onboarding, demo cleanup
│   ├── seed.sql                  # local synthetic fixtures only
│   └── config.toml               # local stack configuration
├── tests/                        # unit/, db/ (Data API/RPC), e2e/ (Playwright, 3 viewports)
├── scripts/                      # bundle scan, worker smoke, ui smoke, dev env
├── docs/                         # canonical spec pack, research, promotion manifest
├── .delivery/                    # delivery-ledger runs (execution evidence)
└── AGENTS.md · STATUS.md · TASKS.md · DECISIONS.md · ARCHITECTURE.md · BUILD-LOG.md · RELEASE.md · OBSERVABILITY.md
```

## Selected direction

Cloudflare + Supabase; Next.js App Router on Workers via OpenNext 1.x (DEC-005). shadcn/ui with the supplied Apple-inspired palette. Customer/resi shipping uses
normal Mengantar tariff (plus two-pass `cod_fee_idr` for COD orders); private seller cost uses the verified activated discount. Sandbox Partner onboarding, live quotes/issuance, COD, registration and Super Admin are implemented and verified locally; production provisioning and live Mengantar egress remain gated (see [RELEASE.md](RELEASE.md) and [TASKS.md](TASKS.md)).
