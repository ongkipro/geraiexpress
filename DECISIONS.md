# GeraiExpress — Accepted Decision Index

Updated: 2026-10-14

The linked context records retain detailed provenance. This index contains only
explicit owner selections; recommendations remain in their canonical design.

| ID | Status | Decision | Evidence |
|---|---|---|---|
| DEC-001 | Accepted | Use Cloudflare + Supabase for the multi-user/tenant product | CTX-1 in docs/spec/CONTEXT-RECORD.md; owner stack instructions |
| DEC-002 | Accepted | Use shadcn/ui with the supplied modern Apple-inspired palette and presentation | CTX-19; owner visual reference and follow-up |
| DEC-003 | Accepted | Customer/resi uses normal Mengantar shipping before seller discount; private seller cost follows verified activated terms; applicable COD/insurance counted once | CTX-27/CTX-28; PR-22/PR-23 |
| DEC-004 | Accepted | Promote documentation into ~/Projects/geraiexpress and organize architecture there; project copies become canonical | CTX-38; current owner request |
| DEC-005 | Accepted | Keep `@opennextjs/cloudflare` 1.x (GA) as the Workers adapter with exact pins (Next.js 16.3.8, OpenNext 1.20.10). vinext (beta) is re-evaluated only when it reaches GA or OpenNext blocks a required Next.js release; a Next.js upgrade lands only after `pnpm cf:build` + `pnpm smoke:worker` + Worker e2e pass | Owner accepted the recommendation, 2026-10-14; BUILD-LOG 16.4.0 failure; ARCH-1 |
| DEC-006 | Accepted | CTX-9: one tenant business owns exactly one Mengantar seller (Partner-created, or BYOK for an existing seller the verified tenant owner proves they control). One tenant may have multiple outlets, all mapped to that seller. No central platform seller and no silent fallback to any other account | Owner accepted the recommendation, 2026-10-14; CTX-9, PR-17–PR-20 |
| DEC-007 | Accepted | CTX-34: email-first native verification (OTP), password set after inbox control, resumable gerai application, manual Super Admin approval during the pilot, then explicit tenant-owned Mengantar connection. Staff join only by invitation: single-use, bound to the invited email, 7-day expiry, revocable, role fixed by the inviter. Each additional business started by the same identity needs its own application and review | Owner accepted the recommendation, 2026-10-14; CTX-34, PR-29–PR-33, IAM-8 |
| DEC-008 | Accepted | Member roles = IAM-1 matrix with its "Proposed" cells resolved: `operator` may create/update contacts and their addresses (including archiving an address), create drafts, quote, confirm and print; may not archive contacts, export, resolve unknown provider outcomes, configure outlets/provider/brand or manage members. `tenant_admin` holds all tenant actions, guarded so a tenant always keeps one active admin. Pilot memberships are tenant-wide (all outlets); per-outlet assignment is deferred until a tenant needs it. Super Admin bootstrap = the owner's verified identity with Supabase TOTP (`aal2`) plus one second recovery administrator; no public promotion path | Owner accepted the recommendation, 2026-10-14; IAM-1, IAM-7 |

Manual-versus-automatic approval after the pilot, collection/settlement obligations,
Terms/Privacy and retention, mail sender domain and operational targets remain proposals or
verification gates. Accepted policy does not by itself authorize provisioning, deployment or
live provider calls.
