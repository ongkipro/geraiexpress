# ADR-0001: Hybrid hosting with a fixed-egress Mengantar gateway on Vultr under Coolify

- **Status:** Accepted for design (owner-delegated recommendation, 2026-10-28). Provisioning, spend and any live provider call still need the owner's explicit approval.
- **Date:** 2026-10-28
- **Author:** Engineering (assistant), for Paduka Ongki
- **Deciders:** Paduka Ongki (direction DEC-011, delegation DEC-018)
- **Supersedes:** None. DEC-001 (Cloudflare + Supabase) is not superseded.
- **Consulted / Informed:** Review lanes SEC, DIL, BIZ, SUP (docs/review); research notes in `docs/research/`.

## 1. Context

Mengantar's Partner API refuses calls from addresses that are not on the partner's allowed-IP list. The documentation says the list is always enforced on production and may be relaxed on the sandbox (Observed, Partner documentation read 2026-10-28). Cloudflare Workers have no stable egress address (Observed in the ARCH-2 evidence). Whether the Public API also enforces an allowed-IP list is Unknown: it is implied only by the label-generation error table (operations-contract note, section 9).

Today the Worker holds the Partner Secret and signs Partner requests itself, and it also opens each tenant's sealed seller key with `CREDENTIAL_KEY` and calls the Public API directly (Observed: `src/lib/worker-secret.ts`, `src/lib/mengantar/partner-onboarding.ts`, `src/lib/mengantar/dispatcher.ts`).

- **Decision drivers:** a fixed address Mengantar can allow-list; secrets exposed in as few places as possible; a provider outage or gateway outage must end in reconciliation, never a blind resend (DEC-010); a small team must be able to run it; about 50 tenants (Assumption, CTX-39), so no horizontal scaling is needed; no second mail, payment or hosting stack is added to bypass a gate (AGENTS.md).
- **Non-goals:** moving the web tier, the database or Auth off their current hosts; building the gateway (TASKS T-052); provisioning any server.

## 2. Considered Options

- **Option A — Gateway on a dedicated Vultr instance under Coolify (selected).** Good: a fixed address under our control (a Vultr reserved IP survives a rebuild); small attack surface; Coolify already in use by the owner. Bad: one more server to patch and a single point of failure for provider calls.
- **Option B — Cloudflare VPC network plus Gateway dedicated egress.** Good: no server of our own. Bad: needs Zero Trust Enterprise entitlement and cost that were never confirmed (ARCH-2); not selected.
- **Option C — Move the whole application to Vultr/Coolify.** Good: one fixed address for everything. Bad: gives up the Worker runtime the app is built and proven on (DEC-005, 114 database tests, Worker smoke) and adds patching burden for the web tier; no evidence it is needed.
- **Option D — Supabase Edge Functions as the forwarder.** Bad: no stable egress address either (ARCH-2 evidence); rejected.

## 3. Decision

Chosen option: **A**, because it is the only option that gives a fixed, owner-controlled address without a new entitlement and without moving the web tier.

1. **Scope of the gateway.** A narrow forwarder, not a general proxy. A fixed route table allows only the Mengantar Partner and Public API origins and path patterns; every other destination is refused. It carries **all production Mengantar calls (Partner and Public API)** because the Public API's allowed-IP behavior is Unknown and the safe default is to assume it is enforced. Preview and staging use the sandbox, which may relax the list, but staging should use the gateway too so the route is exercised before production. A configuration flag (`EGRESS_MODE=gateway|direct`) selects the route; `direct` is refused when `MENGANTAR_ENV=production`.
2. **Trust boundary.** The Worker authenticates each request with an HMAC-SHA256 signature over method, path, timestamp, a nonce and the body digest, using a dedicated `EGRESS_GATEWAY_SECRET` that is separate from every provider secret. The gateway accepts a 60-second timestamp window and rejects a repeated nonce inside it (an in-memory cache; a restart only widens the window to the timestamp bound). Mutual TLS is not required in the first version. As a second layer the firewall admits only Cloudflare's published address ranges [Assumption: Worker subrequests to a non-Cloudflare origin originate from those ranges; verify before provisioning and fall back to the HMAC alone if not].
3. **Secrets.** The **Partner Secret lives only on the gateway**; the Worker sends a logical Partner operation and the gateway signs it, so the Worker no longer holds that secret (a change to `partner-api.ts`, tracked in T-052). `CREDENTIAL_KEY` stays in the Worker, because the sealed seller keys are in the Supabase database and the gateway must not hold database credentials; the Worker opens a seller key and sends it to the gateway in the forwarded request over TLS. The gateway never logs bodies, headers other than a request id, or credential-bearing path segments.
4. **Fixed address.** A dedicated Vultr instance (not shared with any other project) with a **reserved IPv4 address** attached, so the address survives a rebuild. That single address is registered with Mengantar before any production Partner or Public API use. Changing it follows a written procedure: notify Mengantar first, keep the old address in place until the new one is confirmed, then switch.
5. **Scheduler.** The dispatch sweep stays on the Worker cron: it only reads the database and calls the gateway, and each sweep step is idempotent (`dispatch_due`). Demo cleanup moves to a database schedule (`pg_cron` on each hosted Supabase project) so it no longer depends on Worker secrets (review P1-15); T-051 implements it.
6. **Supabase.** Each environment keeps its own hosted Supabase project (CTX-41 item 15). No self-hosting on Vultr.
7. **Coolify exposure and patching.** The control panel is reachable only over the private network (Tailscale); no public panel port. SSH is key-only with root login disabled. Operating-system security updates are automatic; the gateway image is pinned by digest, runs as a non-root user and takes no secret at build time; configuration and environment values are backed up outside the server. Owner of the server: the platform owner.
8. **Single point of failure.** A second server is **not** required for the pilot; a documented manual failover (rebuild from the image, reattach the reserved IP, restore the environment) with a tested drill is a go-live gate. Revisit when volume or an incident justifies a second node.
9. **Outage behavior.** The gateway reports in a signed response header whether a request never left the gateway (`not_sent`) or may have reached Mengantar (`maybe_sent`). A `not_sent` result is a definite failure and the operation can be retried safely. Anything else on a mutating call, including a gateway timeout, is an unknown outcome and goes to reconciliation by its original reference (DEC-010, TD-3). Reads may be retried. If the gateway is unreachable the Worker fails closed; it never falls back to a direct call in production.
10. **Rollback.** The Worker flag returns sandbox environments to `direct`. For production there is no direct route by design: rollback means restoring the previous gateway image or rebuilding the instance, and until it is back provider calls stay blocked and operations queue.

## 4. Consequences

- **Positive:** Mengantar can allow-list one address we control; the Worker stops holding the Partner Secret; provider calls have one choke point for redaction, rate limiting and the Partner 60-requests-per-minute budget; outage semantics are explicit.
- **Negative:** one more service to patch, back up and watch; added latency on every provider call (one extra hop, to be measured); the gateway is a single point of failure until a second node exists; seller keys transit one more component (TLS, redacted logs).
- **Neutral:** the web tier, Auth, database and Turnstile do not move; the sandbox continues to work from a development machine as the documentation allows.

## 5. Confirmation

Compliance is checked by: unit tests for the route-table refusal, signature and replay rejection, redaction and the `not_sent`/`maybe_sent` mapping (T-052); a failure-injection test in the dispatcher suite proving a lost gateway response on a mutating call ends in reconciliation and exactly one create request; a Worker test proving `EGRESS_MODE=direct` is refused in production; a go-live checklist item recording Mengantar's written acceptance of the address; a restore drill record; an `infra` check that the image runs as non-root and is digest-pinned.

## 6. More Information

- Open until verified: whether the Public API enforces an allowed-IP list (ask Mengantar, T-048); whether Cloudflare's published ranges cover Worker subrequests; the measured added latency; the cost of the instance (not estimated here).
- Revisit when Mengantar answers the allow-list question, when a second node is needed, or when the Public API is confirmed not to need the gateway (the scope in point 1 could then narrow to the Partner API).
- Related: DEC-011, DEC-018, ARCH-2, ARCH-5, DEL-2, `docs/research/geraiexpress-mengantar-operations-contract.md` section 9, TASKS T-040, T-052.
