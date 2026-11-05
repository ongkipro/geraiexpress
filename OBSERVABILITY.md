# GeraiExpress — Runtime Observability Record

Updated: 2026-10-29
Status: LOCAL_CONTAINER (nothing deployed; DEC-020)

Production is not provisioned. The application runs as a self-hosted Node.js container (T-062): the log
source for every event below is the **container stdout** (`docker compose logs app`, one JSON object per
line; the scheduler's own lines come from `docker compose logs scheduler`). Caddy's operational logs,
not request access logging, are available from `docker compose logs proxy`. Every Compose service
uses the bounded Docker `local` driver (10 MB × 3 files); off-host shipping is not configured.
The app exposes `GET /healthz` (`{"ok":true,"service":"geraiexpress"}`,
`Cache-Control: no-store`) on every host it answers, including the internal host name
`internal.geraiexpress.local` (`src/lib/hosts.ts`); it is the image `HEALTHCHECK`, the compose
`service_healthy` condition and the first probe of `pnpm smoke:container` and `pnpm smoke:preview`. It
is a readiness check: an anonymous `registration_open` RPC must return a boolean within 2 seconds. A missing URL, timeout, refused request or malformed result returns 503 with `ok:false`; no upstream details are exposed. It checks PostgreSQL/PostgREST availability and the application schema, not Mengantar or mail delivery. The canonical proposed
signal and limit contract is [16-OBSERVABILITY-RATE-LIMITING.md](docs/spec/16-OBSERVABILITY-RATE-LIMITING.md).

The data path is browser → Caddy → app → PostgREST (HTTP, HS256 JWT) → PostgreSQL (ADR-0002, DEC-021);
sign-in is an application-owned module, not an external Auth service. `docker compose logs postgrest`
shows PostgREST's own output (profile `prod`; locally the `gxdb` stack's container); the application logs
below are the only app-side signals. DEC-022 selects Vultr + Coolify with same-host PostgreSQL as the initial deployment shape. Off-host backup storage, schedule, encryption and RPO/RTO/PITR remain release gates (T-067).

Log events (container stdout, no addresses, codes or secrets):

- `auth_mail_failed` (`src/lib/registration-actions.ts`): `{"event":"auth_mail_failed"}`; configured
  transport failed during background delivery. No recipient, code or provider error is logged. Delivery
  is not awaited by the action, so sent/withheld replies do not depend on transport latency or failure,
  whether registration is open or closed. There is no mail-success event or durable delivery queue;
  process termination may lose an in-flight send. A user can request a fresh code after the send window.
  `mailTransportReady()` checks deployment configuration before any code is issued; missing transport
  returns the same honest delivery error for every address, without issuing a code.
- `auth_limiter_failed` (`src/lib/rate-limit.ts`): limiter name only; a throwing limiter fails closed
  immediately as a refusal, without retrying or logging keys.
- `auth_unavailable` (`src/lib/auth-errors.ts`): `{"event":"auth_unavailable","route","operation"}`; the
  auth store (the machine-only `auth_*` functions behind PostgREST) failed or answered something unreadable.
  `route` is one of `/masuk`, `/daftar`, `/verifikasi-2fa`; `operation` is the function name only. The user
  sees a "busy" message and nothing is replayed. Any steady count means PostgREST or the database is failing.
- `session_resolution_failed` (`src/proxy.ts`): `{"event":"session_resolution_failed","route":"proxy"}`; the
  session resolution threw something other than a database-unavailable answer (a misconfigured auth module,
  for example a missing or short `AUTH_JWT_SECRET`/`AUTH_SECRET`, or neither Turnstile secret nor
  `AUTH_CAPTCHA_DISABLED`). The proxy answers 503 + Retry-After 60 and keeps the cookies. Treat it as a
  configuration or deployment fault.

`auth_rate_limited` (T-038, `src/lib/auth-errors.ts`): `{"event":"auth_rate_limited","route","status"}`
where `route` is one of `/masuk`, `/daftar`, `/verifikasi-2fa`, `/refresh`. Every event is a LOCAL refusal:
the in-process limiters (`src/lib/limiter.ts`) spent their budget, mapped to the Bahasa throttle message
(`authThrottleMessage`); there is no upstream 429 any more. Password account-plus-visitor checks precede
the auth call; its account-wide budget follows the Turnstile step. Code requests have no address-wide
pre-CAPTCHA charge. Code verification resolves email only from a host-only HttpOnly SameSite=Lax
cookie scoped to `/daftar`, HMAC-signed under HKDF(`AUTH_SECRET`, `gx:verify-state:v1`) with a random
nonce and a 10-minute lifetime. Missing, altered or expired state fails before verification budgets;
“Ganti email” clears the binding before returning to email entry. Sent, withheld and locally throttled
requests set indistinguishable bindings. Sign-in and OTP account+visitor ceilings are 5/60 s in separate
tables; account-wide ceilings remain 10/60 s after CAPTCHA (M1). Over-budget successes are revoked
without writing session cookies, matching failed guesses. A refused session refresh (`/refresh`, status **503**) is answered by `src/proxy.ts`
itself with **503 + Retry-After: 60** and the browser keeps its cookies, so the session survives. The same
503 + Retry-After 60 is returned when the database cannot answer the refresh (`AuthUnavailableError`);
that case is not logged as `auth_rate_limited`. Events contain no email, code, password, token or address.
There is no alert rule yet; do not infer a provider outage from these bounded ingress/refusal events alone.

`dispatch_sweep` (T-024; run every 5 minutes by the **scheduler container** through `POST /api/internal/cron/dispatch`, `src/lib/mengantar/scheduled.ts`): `checked` and a `tally`
of `action:status` counts (`dispatch`, `reconcile`, `payment` × `recorded`, `not_claimed`,
`inconclusive`, `record_failed`, `error`); no references, keys or recipient data. Signals:
`record_failed` (a provider result could not be stored — reconciliation will pick it up, but it
means the database or machine identity is failing), a steadily non-zero `reconcile:inconclusive`
(Mengantar unreachable or a rotated key blocking lookups), and `dispatch:not_claimed` that does
not fall (a seller stuck busy). Without the machine bindings it logs `disabled: true`; a
failing due-list query logs `failed: true`. Interactive steps log `dispatch_action` (step:
`dispatch`, `reconcile`, `payment`, or `pay_batch`; status; outcome/reason). A `price_mismatch`
shipment event (and `priceMismatch` in `dispatch_action`, a count in `dispatch_sweep`) means
Mengantar's price for the order differs from `customer_charge_idr` (normal tariff for non-COD,
normal tariff + `cod_fee_idr` for two-pass COD orders — T-025).
It is reported once per price (an unpaid order that is paid later does not report it again).
`priceUnknown` (and its count in `dispatch_sweep`) means the order's price was unreadable, so it
was not compared; a steady rise means Mengantar's response changed.
`dispatch_sweep.stuck` counts operations past the automatic re-check windows (`unknown` over 7
days, `failed_unresolved` "not created"/provider-error over 24 hours, `unpaid` over 7 days) and
operations that cannot be sent (`queued` over 6 hours: the gerai lost its key or is inactive):
any non-zero value needs an admin to check the Mengantar app (runbook in RELEASE.md).

`demo_cleanup` (T-030, T-051): expired demo tenants are removed by `cleanup_expired_demos(p_max_age_hours, p_batch)` (batch default 200). The **scheduler container** calls `POST /api/internal/cron/cleanup` once an hour (on the whole UTC hour); the route needs only `POSTGREST_URL` and `AUTH_JWT_SECRET` (the machine identity), not the full machine bindings, and emits `{"event":"demo_cleanup","deletedTenants":...,"deletedUsers":...,"hasMore":...,"failed":...}` (counts and flags only, no tenant or user identifiers). Migration `20261028180000_demo_quotas_and_cleanup.sql` also creates an hourly pg_cron job `demo-cleanup` (`0 * * * *`, `select public.cleanup_expired_demos(24, 200)`), but only where the `pg_cron` extension is available; on the plain PostgreSQL 17 image used here it is not, so the scheduler call is the cleanup. A job that does exist logs no container event, so its runs are visible only in `cron.job_run_details`. `hasMore: true` means more than one batch of expired demos remained and the next run continues; `failed: true` means the machine RPC call failed.

The hourly `/api/internal/cron/cleanup` task performs demo cleanup, auth expiry purge and
environment-scoped credential rewrap (`src/lib/mengantar/scheduled.ts`):

- `auth_purge` reports `sessions`, `otpCodes`, `hasMore` and `failed` (counts/flags only). Since T-104
  each `auth_purge_expired(p_limit)` call deletes at most 1000 rows per table, skips rows locked by a live
  refresh or verification, and returns `remaining`; one run makes at most 10 calls inside the task
  deadline. `hasMore: true` means a backlog is left for the next hourly run; a missing or malformed
  reply is `failed: true`, never zero work. Retention is unchanged (sessions dead > 7 days, codes > 1 day).
- `credential_rewrap` reports disabled state or bounded counts (`scanned`, `rewrapped`,
  `alreadyCurrent`, `noCredential`, `conflicts`, `failed`) and the provider environment; an unexpected
  exception reports `failed: true`. No tenant identifiers or key material are logged. Investigate
  failures and unexpected disabled state before retiring an old credential key. Retain old keys
  until completion is verified.

Scheduler events (T-062): `scheduler_call` carries `task`, HTTP `status` or transport `error`, and `ms`; `scheduler_skipped` means a previous call is running. The app logs `cron_skipped` for a held lock and `cron_timeout` at 270 s: it aborts scheduled PostgREST/provider requests and expires the lock, while the DB retains its one-in-flight rule. A missing task call for two periods, a non-200 status or `scheduler_disabled` needs investigation. A 200 can mean disabled: also inspect `dispatch_sweep.disabled`. No secret is logged.

## Configuration and release gates (local waves E/F, not deployed preview state)

| Name / gate | Observed behavior and operational boundary |
|---|---|
| `CREDENTIAL_KEYS`, `CREDENTIAL_KEY_CURRENT` | Container environment secrets: versioned encryption ring and sealing pointer; open by stored `key_version`. Single `CREDENTIAL_KEY` remains v1. At first production rotation switch to the ring, keep old keys until rewrap is complete; never log key material |
| `reencryptCredentials` | The hourly cleanup task invokes environment-scoped rewrap (T-057), emitting `credential_rewrap` as above; `credential.rewrapped` is the separate database audit action. Verify completion before old-key retirement |
| `APP_ORIGIN` | Must be passed as the `APP_ORIGIN` build argument of the image (and exported for `pnpm build`); local value `http://127.0.0.1:8080`. Static marketing links are baked, so the runtime environment alone is insufficient. Current invitation/marketing callers read only this origin; the other three names are generic mappings without current application callers |
| `pnpm check:environments` | Required release gate over the env files, the Compose model and the proxy configuration (no secret value shared between environments, Turnstile never disabled outside local, no production value in staging, only the proxy publishes ports, `X-Real-IP` overwritten, `/api/internal` denied); the committed templates pass, the real files are checked at release (RELEASE.md) |
| Container-runtime email | `MAIL_TRANSPORT=mailpit` and local `MAILPIT_URL` required. Production has no transport (T-063): readiness fails before issuance, with the same error for every address. Configured delivery failures log `auth_mail_failed` asynchronously; no address is logged. |
| Rate limiter | In-process fixed windows (`src/lib/limiter.ts`), one app instance only. Caps: visitor tables 10 000, account tables 100 000. At capacity, expired windows are removed first, then the oldest non-exhausted live window may be evicted; exhausted budgets are kept. Only an all-exhausted table refuses fresh keys. `rate_limiter_saturated` logs the limiter, capacity and action at most once per minute per table, never a key or address. This indicates capacity pressure, not a provider outage. The session refresh now runs in `src/proxy.ts` on the Node runtime, like the Server Actions, and the tables live on `globalThis`, so the refresh budget is meant to be one table; this has not been measured (the header comment of `src/lib/limiter.ts` still describes the former Edge split) |

Environment-scoped credentials and same-environment Partner reconciliation across regeneration are
built. Persistent `credential_unavailable` can still reflect missing ring material, BYOK replacement
or an unresolved rotation; it is not proof that replay is safe. Implemented locally by T-054/T-057:
durable Partner stops/retry windows, platform TOTP recency, SQL-enforced consent versions,
environment-bound reconciliation/payment claims and rotation-outcome fencing. Deployment
verification remains a separate release gate. The full-suite `account_busy`
flake is Unknown (T-059), not an established production signal or accepted timing defect.

Area catalogue/fallback rates and receipt preparation/print failures currently have no dedicated
telemetry or alerts. Receipt history proves only a recorded application request, not printer success
or browser-dialog completion. `/healthz` does not detect an empty catalogue or these failures.

Add only actual stable non-secret endpoints after they exist, using the native
release-check format:

```text
Probe: <name>|<url>|<expected-status>|<contains-or-TBD>|<max-latency-ms>
```

Do not turn template example URLs or arbitrary latency values into an operational
claim. Release checks need actual expected behavior, named ownership and
observed signal delivery before the production pilot.
