# GeraiExpress — Runtime Observability Record

Updated: 2026-10-14
Status: NOT_CONFIGURED

No deployed runtime, sink or production probe exists. Locally, the Worker build exposes
`GET /healthz` (`{"ok":true}`, `Cache-Control: no-store`), used by `pnpm smoke:worker`; it is a
liveness check only and says nothing about Supabase or provider health. Wrangler
`observability.enabled` is set in `wrangler.jsonc` but has never received production traffic. The canonical proposed
signal and limit contract is [16-OBSERVABILITY-RATE-LIMITING.md](docs/spec/16-OBSERVABILITY-RATE-LIMITING.md).

Log events (Worker console, no addresses, codes or secrets): `auth_mail_sent`,
`auth_mail_refused` (reason: `anonymous_identity`, `unsupported_action`, `malformed`) and
`auth_mail_failed` (`configured` false = no transport binding) from the Send Email Hook
(DEC-009). A rise in `auth_mail_refused` with `anonymous_identity` is the demo email-abuse
signal; `auth_mail_failed` means users are not receiving codes.

`dispatch_sweep` (T-024, cron every 5 minutes in `custom-worker.ts`): `checked` and a `tally`
of `action:status` counts (`dispatch`, `reconcile`, `payment` × `recorded`, `not_claimed`,
`inconclusive`, `record_failed`, `error`); no references, keys or recipient data. Signals:
`record_failed` (a provider result could not be stored — reconciliation will pick it up, but it
means the database or machine identity is failing), a steadily non-zero `reconcile:inconclusive`
(Mengantar unreachable or a rotated key blocking lookups), and `dispatch:not_claimed` that does
not fall (a seller stuck busy). Without the machine bindings it logs `disabled: true`; a
failing due-list query logs `failed: true`. Interactive steps log `dispatch_action` (step,
status, outcome/reason). A `price_mismatch` shipment event (and `priceMismatch`
in `dispatch_action`, a count in `dispatch_sweep`) means Mengantar's price for the order differs
from the customer charge; for non-COD orders both are the normal tariff, so any mismatch is real.
It is reported once per price (an unpaid order that is paid later does not report it again).
`priceUnknown` (and its count in `dispatch_sweep`) means the order's price was unreadable, so it
was not compared; a steady rise means Mengantar's response changed.
`dispatch_sweep.stuck` counts operations past the automatic re-check windows (`unknown` over 7
days, `failed_unresolved` "not created"/provider-error over 24 hours, `unpaid` over 7 days) and
operations that cannot be sent (`queued` over 6 hours: the gerai lost its key or is inactive):
any non-zero value needs an admin to check the Mengantar app (runbook in RELEASE.md).

Add only actual stable non-secret endpoints after they exist, using the native
release-check format:

```text
Probe: <name>|<url>|<expected-status>|<contains-or-TBD>|<max-latency-ms>
```

Do not turn template example URLs or arbitrary latency values into an operational
claim. Release checks need actual expected behavior, named ownership and
observed signal delivery before the production pilot.
