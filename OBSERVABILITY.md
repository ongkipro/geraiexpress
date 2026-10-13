# GeraiExpress — Runtime Observability Record

Updated: 2026-10-14
Status: NOT_CONFIGURED

No deployed runtime, sink or production probe exists. Locally, the Worker build exposes
`GET /healthz` (`{"ok":true}`, `Cache-Control: no-store`), used by `pnpm smoke:worker`; it is a
liveness check only and says nothing about Supabase or provider health. Wrangler
`observability.enabled` is set in `wrangler.jsonc` but has never received production traffic. The canonical proposed
signal and limit contract is [16-OBSERVABILITY-RATE-LIMITING.md](docs/spec/16-OBSERVABILITY-RATE-LIMITING.md).

Add only actual stable non-secret endpoints after they exist, using the native
release-check format:

```text
Probe: <name>|<url>|<expected-status>|<contains-or-TBD>|<max-latency-ms>
```

Do not turn template example URLs or arbitrary latency values into an operational
claim. Release checks need actual expected behavior, named ownership and
observed signal delivery before the production pilot.
