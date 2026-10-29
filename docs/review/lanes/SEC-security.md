# Security Lane (SEC) Review — GeraiExpress

Scope: application and Worker security (lane file list). Method: static reading only; nothing was executed. Line numbers refer to the working tree as of 2026-10-28.

## Findings

### [Critical] SEC-01 Partner seller binding is writable by any tenant admin → another tenant's Mengantar seller key can be swapped in
Where:
- `supabase/migrations/20261027210000_partner_seller_onboarding.sql`:
  - `record_partner_seller_onboarding_outcome` (:228–277) does `partner_seller_id = coalesce(p_seller_id, partner_seller_id)` (:261).
  - `complete_partner_seller_onboarding` (:158) stores any `p_seller_id` (:209).
  - `partner_seller_id` has no uniqueness constraint (:24–25).
  - Both functions are granted to `authenticated` (:335–345).
  - `begin_*` returns the stored id (:137).
  - `partner_onboarding_status` (:280–297) returns the seller id and the owner's name, email and phone to any member, operators included.
- `src/lib/mengantar/partner-onboarding.ts`:
  - :102–105 and :141–143 trust the stored id and call `getSellerApiKey(partnerSellerId)`.
  - :168–176 seal the returned key for the caller's tenant.
  - :255 records a provider error's `sellerId` for every error code.
- `src/lib/mengantar/partner-api.ts`:
  - :108–110 take `sellerId` from any error envelope.
  - :153–158 return the key of whatever seller id is passed.
- `src/modules/credentials/actions.ts:21–30` uses the user's own session for these privileged writes.

Evidence:
- The only check on a seller id is its format.
- A tenant admin of a real tenant B can call `begin_partner_seller_onboarding`, then `record_partner_seller_onboarding_outcome(p_tenant=B, p_state='registered_key_pending', p_seller_id=S)`, directly through PostgREST with the publishable key and their own JWT.
- They then click the normal Partner register/recover button. The Worker calls `getSellerApiKey(S)` with the platform's Partner credentials. The research doc says the Partner API returns, or creates, the key for any seller under that partner (geraiexpress-mengantar-partner-api.md:142–144).
- The Worker seals the key with AAD(B, v+1) and marks B as `partner_managed/connected`.
- Nothing checks that S belongs to `geraiexpress:tenant:B`:
  - `listSellers({externalUserId})` exists but is never called.
  - `registerSeller` is idempotent on externalUserId and would return B's own seller.

How an attacker learns S:
- Any current or former member of victim tenant A can read S through `partner_onboarding_status(A)`, and admins see it in `/pengaturan` (`credentials/forms.tsx:64,73`).
- Seller ids look like Mongo ObjectIds (research doc :264), so guessing ids near a known one may work [INFERENCE].
- If Mengantar's 409 `EMAIL_ALREADY_REGISTERED` response carries a `sellerId`, simply registering with the victim owner's email would bind S without any direct RPC [INFERENCE]. The documented 409 response shape does not mention a seller id.

Impact:
- Tenant B can quote and issue orders charged to tenant A's Mengantar balance, pay A's unpaid batches, and read A's saved pickup addresses and order lists. A notices nothing, because its key keeps working.
- This breaks SEC-3 ("tenant/seller substitution … denied", 12-SECURITY-ARCHITECTURE.md:70) and SEC-1 ("Exposed RPCs must be safe when called directly", :29).
- It is reachable today wherever Partner onboarding is enabled (`MENGANTAR_ENV=sandbox` plus the Partner secret, e.g. `env.staging`). It becomes real money as soon as a production Partner origin is added.

Recommendation:
1. Make `record_*` and `complete_*` callable by `service_role` only. Call them through `machineClient()` after the existing `requireWorkspace()` and tenant-admin check — the same pattern `record_live_quotes` already uses. `begin_*` must not accept or return seller ids.
2. Never fetch a key by a stored id. Recover through `registerSeller` with the fixed externalUserId, or require `listSellers({externalUserId})` to return exactly that seller id first.
3. Accept `PartnerError.sellerId` only for `KEY_PROVISIONING_FAILED`, and verify it the same way.
4. Add a partial unique index on `partner_seller_id` (where not null).
5. Restrict the seller id and owner details in `partner_onboarding_status` to tenant admins.

Verify:
- DB test: a direct RPC from B's tenant admin with A's seller id is refused (42501) and changes no rows.
- Unit test: when `listSellers` does not confirm the seller id, no `getSellerApiKey` or `complete_*` call is made.
- E2E: with two sandbox tenants, B never ends up with A's hint or seller id.

### [High] SEC-02 Auth calls through the Worker share one Supabase rate-limit budget, so a few visitors can lock out every tenant, and the resulting 429s read as wrong credentials
Where:
- `src/lib/rate-limit.ts:6–10,14–24`
- `wrangler.jsonc:11–16`
- `infra/supabase-preview/supabase/config.toml:32–41`
- `src/middleware.ts:21–22`
- `src/lib/auth-actions.ts:28–32,50–51`
- `src/lib/registration-actions.ts:44–45`
- `src/lib/platform-actions.ts:44–45`
- `ARCHITECTURE.md:255–267`

Evidence:
- The repo's own premise (rate-limit.ts:6–8) is that Supabase sees all Worker traffic as one address, so its limits are "sized for aggregate traffic". Preview values:

  | Supabase bucket | Preview limit |
  |---|---|
  | `sign_in_sign_ups` | 300 per 5 min |
  | `token_verifications` | 300 per 5 min |
  | `token_refresh` | 1500 per 5 min |
  | `anonymous_users` | 300 per hour |
  | `email_sent` | 30 per hour, project-wide |

- The Worker lets each visitor make 10 sign-ins/min, 5 demo starts/min and 3 code requests/min. Session refresh in middleware has no per-visitor limit at all (known gap).
- What that adds up to:
  - 6 IPs (or 6 IPv6 /64s) at 10/min = 60/min, which is the whole sign-in bucket.
  - Another 6 IPs drain OTP verification.
  - One visitor at 5 demo starts/min uses up the whole hourly anonymous sign-in budget.
  - With registration open, or against known addresses, one visitor at 3 code requests/min reaches the email limit in about 10 minutes.
- Cookies that hold a valid refresh token but a past `expires_at` make `getClaims()` refresh on every GET.
- When Supabase answers 429, the user sees:
  - sign-in: "Email atau kata sandi tidak cocok" (wrong email or password)
  - OTP and TOTP verification: "Kode tidak cocok…" (wrong code)
  - demo: "Demo belum bisa dibuka" (demo can't open yet)

  Nothing is logged.

Impact:
- Anyone, without an account, can cheaply block sign-in, code verification, demo entry and session refresh across the whole platform.
- Users and support are told the credentials are wrong.
- SEC-5 requires an "explicitly verified rate-limit/IP design" for Auth calls that go through the Worker (12-SECURITY-ARCHITECTURE.md:152–153).

Recommendation:
- (a) Forward the visitor's IP to Supabase with `Sb-Forwarded-For` from a client used only for Auth. The comment saying the app "deliberately does not hold" a secret key is out of date: DEC-010 binds `SUPABASE_SECRET_KEY` in live environments. Never use that client for `.from()` or `.rpc()`. First confirm whether Auth requests made with the secret key skip CAPTCHA [INFERENCE]. If they do, verify Turnstile in the Worker before calling Auth.
- (b) Otherwise, set the Supabase limits well above legitimate peak traffic and add per-account limits (SEC-03).
- (c) Map 429, `over_request_rate_limit` and `over_email_send_rate_limit` to the existing "too many attempts" message and log the event.
- (d) Limit session refresh per visitor.

Verify:
- Local stack with low Auth limits: flood sign-in from N synthetic visitors. A separate legitimate visitor either still signs in (after a) or sees the "too many attempts" message (after c).
- Unit test that a 429 maps to "too many attempts".

### [Medium] SEC-03 Brute-force limits are keyed only by network address; nothing limits guessing against one account
Where:
- `rate-limit.ts:14–24`
- `visitor-key.ts:4–16`
- `auth-actions.ts:25`
- `registration-actions.ts:42–44`
- `platform-actions.ts:34–44`
- `infra/supabase-preview/supabase/config.toml:55` (`otp_expiry = 3600`)
- `ARCHITECTURE.md:268–274`

Evidence:
- The only limiter key is `visitorKey(cf-connecting-ip)`: the IPv4 address, or the IPv6 /64.
- No key includes the target email or user id.
- OTP verification takes the email from action state held by the client.
- Email codes live 1 hour.
- Supabase's MFA verify endpoint can be called directly without throttling (already acknowledged).
- A free /48 gives 65,536 separate /64 keys.

Impact:
- Spreading guesses across many addresses is limited only by the shared budget in SEC-02. Fixing SEC-02 removes even that limit.
- Super Admin accounts are the most valuable target: they can sign in with an email code, plus TOTP.

Recommendation:
- Add a second limiter keyed on the target: `acct:<sha256(lower(email))>` and `mfa:<userId>`, for example 5–10 attempts per 15 minutes.
- Group IPv6 at /56.
- Shorten `otp_expiry` to 10–15 minutes.
- Size Supabase's MFA limits, or use the MFA verification-attempt hook.

Verify: 11 OTP checks for one email from 11 different visitors — the 11th is refused.

### [Medium] SEC-04 Supabase session cookies are readable by JavaScript and lack `Secure` (400-day lifetime)
Where:
- `src/lib/supabase/server.ts:9–20` and `src/middleware.ts:11–20`: neither passes `cookieOptions`.
- `node_modules/@supabase/ssr/dist/main/utils/constants.js:4–10`: defaults are `httpOnly: false`, a 400-day `maxAge`, and no `secure`.
- `node_modules/@supabase/ssr/dist/main/cookies.js:227–231`.

Evidence:
- Both clients use the library defaults.
- There is no browser-side Supabase client and no `document.cookie` use, so making the cookies HttpOnly costs nothing.
- HSTS is sent only on HTTPS responses (middleware.ts:28–30) [INFERENCE: whether plain HTTP reaches the Worker depends on the zone settings].

Impact:
- Any future XSS (there is no CSP that restricts scripts, see SEC-10) can steal the access and refresh tokens.
- That includes aal2 Super Admin sessions, which stay aal2 when refreshed.

Recommendation:
- One shared helper that passes `cookieOptions: { httpOnly: true, secure: <production>, sameSite: "lax", path: "/" }` to both clients.
- Turn on "Always Use HTTPS" for the production zone.
- Set Supabase session time limits for platform accounts.

Verify: E2E: `Set-Cookie` for `sb-*` carries `HttpOnly; Secure`, and `document.cookie` has no `sb-` entry.

### [Medium] SEC-05 Partner rate-limit waits and seller restrictions are recorded but never enforced
Where:
- `partner_seller_onboarding.sql:125–137`: the `begin_*` upsert resets `onboarding_state`, `last_error_code` and `retry_after_at`.
- `partner-onboarding.ts:107–146`: no check before calling Mengantar.
- `credentials/actions.ts:33–81`: no limiter.
- Spec: 16-OBSERVABILITY-RATE-LIMITING.md:101,116 and 12-SECURITY-ARCHITECTURE.md:90–91.

Evidence:
- When Mengantar answers 429 (rate limited) or reports the seller or key as restricted, the code stores the wait time or the restricted state.
- The next register or recover click runs `begin_*`, which wipes both, and the Worker calls Mengantar again.

Impact:
- One tenant admin can use up the Partner API's 60 requests/minute, which all tenants share, blocking onboarding for everyone and risking sanctions on the Partner account.
- Restricted sellers keep being retried, which SEC-3 forbids ("Stop retries on Partner/seller restriction").

Recommendation:
- `begin_*` refuses while `retry_after_at` is in the future, and refuses restricted sellers until a platform admin clears them; it no longer resets those fields.
- Add a per-tenant Workers rate limit and a partner-wide counter (Durable Object or KV) that fails closed.

Verify: DB test — `begin_*` after a recorded 429 with a future retry time raises an error.

### [Medium] SEC-06 Partner settings have two sources of truth; the Super Admin screen misreports what the Worker signs with
Where:
- `credentials/actions.ts:24,26`
- `partner-onboarding.ts:11,111`
- `admin/integrasi/page.tsx:27–33`
- `credentials.sql:106–145` (`platform_partner_config`, `platform_set_partner_id`)

Evidence:
- The Partner ID that `/admin/integrasi` edits, with an audit record, is never read by the Worker.
- Signing uses the `PARTNER_ID` binding, falling back to a hardcoded `"ongkirich"`.
- The "Partner Secret installed" badge checks only `MENGANTAR_PARTNER_SECRET`, while signing quietly falls back to `GERAIEXPRESS_MENGANTAR_SANDBOX_SECRET`.

Impact:
- The UI's configuration status does not match what actually runs, and audited setting changes have no effect.
- These silent fallbacks contradict SEC-3 ("unapproved … fallback denied") and RATE-1's fail-closed rule.

Recommendation:
- Keep one source of truth: either read the DB value through a machine RPC, or remove the DB setting and its UI.
- Remove the hardcoded default and the fallback secret, so missing configuration fails closed.
- Compute the badges from exactly what `partnerDeps` uses.

Verify: With no `PARTNER_ID` binding, the result is `configuration_blocked` with no calls to Mengantar.

### [Medium] SEC-07 `env.staging` uses the public preview Supabase project
Where:
- `wrangler.jsonc:43–45` vs `:62–65`: the same `SUPABASE_URL` and publishable key.
- `infra/supabase-preview/supabase/config.toml:20,43–46,78–81`.
- RELEASE.md describes the preview as isolated.

Evidence:
- Staging adds crons, `MENGANTAR_ENV=sandbox` and Partner onboarding to a project whose Auth has CAPTCHA off and anonymous sign-in on.
- That project's `site_url` and Send Email Hook point at the preview Worker.
- One shared database forces the two Workers to share `CREDENTIAL_KEY`.

Impact:
- The documented environment separation is broken: the machine identity and sandbox seller keys sit next to a deliberately weaker public Auth setup.
- Staging's Auth emails and links go through the preview Worker.

Recommendation: Give staging its own Supabase project (CAPTCHA on, its own hook and its own key), or remove `env.staging` until it has one. Document the boundary.

Verify: The staging variables point at a different project ref.

### [Medium] SEC-08 `CREDENTIAL_KEY` has no key ring: rotating it breaks every stored credential at once
Where:
- `credential-crypto.ts:7,27,31–34`
- `tenant.ts:32–34`
- `dispatcher.ts:34,77`
- `live_quotes.sql:45`
- `ARCHITECTURE.md:297–304`

Evidence:
- `key_version` is stored and returned, but both decryption paths ignore it and always use the current `CREDENTIAL_KEY`.
- There is no re-encryption path.

Impact:
- Rotating a compromised key makes every tenant's credential unreadable at the same moment.
- SEC-1 requires a dedicated key with rotation and versions. This is a known gap; it is listed here because this lane covers rotation.

Recommendation:
- Hold several keys (for example `CREDENTIAL_KEYS` as `{v1, v2}` plus a "current" pointer).
- Decrypt with the key named by the stored `key_version`, encrypt with the current one, and add a machine job that re-encrypts old rows.

Verify: Seal under v1, switch the current key to v2, and decrypting still works.

### [Medium] SEC-09 Demo cleanup only runs where live Mengantar is configured
Where:
- `custom-worker.ts:15–19,36–38`
- `machine-deps.ts:15–16`
- `RELEASE.md:30–31`

Evidence:
- `scheduled()` returns before the hourly `cleanup_expired_demos` call unless the Supabase secret key, `CREDENTIAL_KEY` and `MENGANTAR_ENV` are all bound.
- The preview never cleans up, yet anyone can call `start_demo` there directly without CAPTCHA.

Impact: Anonymous users and demo tenants with seeded data grow without bound.

Recommendation: Schedule the cleanup with pg_cron in the database, or give it its own client that only needs the Supabase URL and secret key.

Verify: Unit test — with only the URL and secret key bound, the hourly run still calls the cleanup.

### [Low] SEC-10 The CSP only covers framing
Where: `src/middleware.ts:23–30`

Evidence: The only CSP directive is `frame-ancestors 'none'`. There is no `script-src`, `object-src`, `base-uri` or `form-action`, and no Permissions-Policy header.

Impact: Nothing contains an XSS if one appears; together with SEC-04 that means session theft.

Recommendation:
- Add `object-src 'none'; base-uri 'none'; form-action 'self'` and a Permissions-Policy now.
- Then add a nonce-based `script-src` with `'strict-dynamic'` that allows `challenges.cloudflare.com` (Turnstile), following `node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md`. Roll it out as Report-Only first.

Verify: Extend the middleware unit test; check in a browser that Turnstile works with no CSP violations.

### [Low] SEC-11 The Send Email Hook reads an unlimited body before any cheap check
Where: `send-email/route.ts:19–22`, `auth-mail.ts:40–41`

Evidence: `request.text()` runs before the header and timestamp checks, with no size limit, on a public endpoint with no rate limit.

Impact: Large unauthenticated requests burn CPU, because the whole body is HMAC'd.

Recommendation: Check the headers and the timestamp window first, refuse bodies over 64 KiB, and read with a byte cap.

Verify: Missing headers return 401 without reading the body; an oversized body returns 413.

### [Low] SEC-12 Shipment pages show text taken from the URL inside error messages
Where: `pengiriman/[id]/page.tsx:100–105`, `shipments/actions.ts:316–318`

Evidence: The `detail` query parameter is printed as-is (React escapes it, so no script runs) next to a real error message.

Impact: A crafted link can show attacker-written text inside a genuine-looking GeraiExpress error to a logged-in member.

Recommendation: Only show known error codes from the URL; take provider error text from the stored `provider_error_detail`.

Verify: An arbitrary `detail` value is not rendered.

### [Low] SEC-13 A null expected revision switches off the stale-data checks
Where:
- `platform-actions.ts:80`
- `registration-actions.ts:111,123`
- `credentials/actions.ts:109`
- `platform_admin.sql:218`
- `registration.sql:174,235`
- `credentials.sql:64`

Evidence:
- A non-numeric revision becomes `NaN`, which is sent as `null`.
- In SQL, `x <> NULL` is neither true nor false, so the stale check never fires.
- `store_seller_credential` already guards against this with `coalesce(p_expected_version, -1)` (`credentials.sql:44`).

Impact: An authorized user can skip the stale check, for example approve an application revision they never reviewed.

Recommendation: Treat a null revision as stale (`is null or … is distinct from …`) and check `Number.isSafeInteger` in the actions.

Verify: DB tests that send `null` get `stale_state`.

### [Low] SEC-14 Consent records accept Terms/Privacy versions chosen by the client
Where: `credentials/actions.ts:48–49,74–75`

Evidence: `terms_version` and `privacy_version` come from form fields (any 1–64 characters) and are stored as the agreed versions.

Impact: Consent records (PR-20) can claim agreement to versions the user never saw.

Recommendation: Use only the server-side version constants.

Verify: A tampered version is ignored or rejected.

### [Low] SEC-15 Partner completion encrypts against a version read at the start, with no check at the end
Where: `partner-onboarding.ts:168–176`, `partner_seller_onboarding.sql:188–200`

Evidence: The encryption's associated data uses the version read in `begin_*` plus one; `complete_*` inserts at its own current maximum plus one, without checking an expected version.

Impact: If a BYOK key is saved between those two steps, the stored credential can never be decrypted.

Recommendation: Pass `p_expected_version` to `complete_*` and raise `stale_state` on a mismatch, as `store_seller_credential` does.

Verify: DB test with a key save in between — `complete_*` is refused.

### [Low] SEC-16 The client-bundle secret check has gaps
Where: `scripts/check-client-bundle.mjs:11–17,52–64`

Evidence:
- `GE_SERVER_ONLY_MARKER` appears nowhere in the source, so that check can never trigger.
- Browser assets are not scanned for the names `CREDENTIAL_KEY` or `SEND_EMAIL_HOOK_SECRET`, or for hook-secret values (`whsec_`).

Impact: A leaked hook secret or key value would pass the check.

Recommendation: Add value patterns, scan for every secret binding name, and either plant the marker in server-only modules or drop it.

Verify: A fake `whsec_` string placed in a browser chunk makes the check fail.

## Sound (checked, no finding)
- **CSRF on server actions:** Next 16.3.8 compares the request's Origin to Host (`action-handler.js:438–461`). There is no `allowedOrigins` widening, cookies are SameSite=Lax, and no server actions capture or bind variables.
- **Open redirects:** there is no `next` parameter anywhere. Every `redirect()` goes to a fixed path or a same-origin path prefix.
- **Tenant comes from the server, not the client:**
  - `loadWorkspace` (`workspace.ts:31–83`) checks the `ge_tenant` cookie against the user's active memberships, and suspended tenants drop out (`foundation.sql:45–57,314–317`).
  - Every server action and route in this lane takes the tenant from the workspace, never from input.
- **Super Admin:**
  - Every admin page calls `requirePlatform(capability)`.
  - Every platform RPC re-checks aal2, that the user is not anonymous, and that the grant is still current, again after taking the grant lock (`platform_admin.sql:34–52,175–181,205–216`; `registration.sql:200,220–222,255–257`; `credentials.sql` platform functions).
  - The TOTP factor is looked up on the server, and the MFA limit runs first.
- **Send Email Hook:**
  - Verifies the HMAC signature over `id.timestamp.body` before parsing, with a ±300 s window and a constant-time compare.
  - Refuses anonymous users and unknown email types, and validates the code format before putting it in HTML.
  - Logs no addresses or codes; mail delivery is loopback-only.
- **Credential encryption:** each seal uses a fresh random 96-bit IV and a 32-byte key. The associated data binds tenant and version and matches the version the database inserts. Plaintext is never returned or logged, and Worker secrets have no `process.env` fallback.
- **SSRF:**
  - Mengantar calls use fixed origins and fixed paths; user input only goes through URLSearchParams.
  - The API key is validated and encoded, redirects are refused, timeouts are set, response reads are capped at 256 KiB, and errors carry codes only.
  - `global_fetch_strictly_public` is on.
  - `/_next/image` enforces remote patterns, and none are configured.
- **Service-role key:** it is only used for service_role-only RPCs (`live_quotes.sql:115–118`, cleanup), and always after an authorization check with the user's own session (`shipments/actions.ts`).
- **Rate-limit key:** uses only `CF-Connecting-IP`, never `X-Forwarded-For`, and fails closed in production.
- **CAPTCHA:** Supabase Auth verifies the token on the server; the Worker has no fail-open path.
- **Demo lockout:** `start_demo` requires an anonymous session and returns the same demo tenant on repeat calls. Credential, Partner and area paths refuse demo users in both the Worker and the database (`invitations.sql:60–74`).
- **Cron:** there is no HTTP-reachable cron endpoint, and logs contain counts only.
- **`/healthz`:** returns only static fields with `no-store`.
- **Error messages:** come from a fixed mapping; nothing leaks stack traces or SQL.
- **Secrets in git:**
  - `.dev.vars`, `.env.local` and `supabase/.env` exist, are gitignored, and are not in `.git/index`. I read the raw index file, since `git ls-files` isn't available in this lane.
  - `.env.example` is tracked on purpose; I did not open it, per the secrets policy.
  - `wrangler.jsonc` holds only a publishable key and Cloudflare's public Turnstile test key.
  - The preview deploy script refuses any env values baked into the build.
- **Browser side:** no `dangerouslySetInnerHTML`, `eval` or browser token storage. GET page renders only read data.
- **Already-acknowledged residuals I reviewed and did not re-report:**
  - Send Email Hook replay inside its 5-minute window.
  - TOTP: trust-on-first-use enrolment, the same code accepted twice, direct MFA verify.
  - Account/invite enumeration through the Supabase Auth API while registration is closed.
  - No rate limit on demo reset or area search.
  - A tenant admin storing junk ciphertext for their own gerai.
  - Super Admin fixtures in `seed.sql`.
  - Workers rate-limit counters are per Cloudflare location.

## Coverage
Reviewed:
- Worker and config: `src/middleware.ts`, `custom-worker.ts`, `wrangler.jsonc`, `next.config.ts`, `open-next.config.ts`, `public/_headers`, `package.json`.
- Libraries:
  - `src/lib/{credential-crypto,worker-secret,auth-mail,mail-transport,rate-limit,visitor-key,errors,platform,workspace,auth-actions,platform-actions,registration-actions,utils}`, `src/lib/supabase/*`.
  - `src/lib/mengantar/{tenant,machine-deps,partner-api,partner-onboarding}`; `public-api` transport only; `dispatcher` credential and RPC calls only.
- Routes: `src/app/api/**`, `healthz`, `akses`, `admin/**`, `verifikasi-2fa/*`, `masuk/page`, `robots`, `sitemap`, `layout`.
- Other source: `components/turnstile.tsx`, `modules/credentials/*`, `modules/shipments/actions.ts` (machine-identity checks only), plus targeted greps of `pengaturan` and `pengiriman/[id]`.
- Scripts: `check-client-bundle.mjs`, `deploy-preview.sh`, `auth-hook-relay.mjs`.
- Git hygiene: `.gitignore`, `supabase/.gitignore`, the raw `.git/index`.
- Supabase settings: `supabase/config.toml`, `infra/supabase-preview/supabase/config.toml`.
- Migrations: platform_admin, credentials, partner_seller_onboarding, invitations (helper), foundation (helpers and RLS), reconcile_admin_only (`start_demo`), contact_archive_and_demo_cleanup, live_quotes (grants), cod_and_batch_payment (`review_unpaid_batch`), registration (guards).
- Docs:
  - AGENTS.md, ARCHITECTURE.md, RELEASE.md.
  - docs/spec 12/16/07 and the partner-api research doc (targeted reads).
  - Next docs and source (server actions, CSP, middleware→proxy).
  - @supabase/ssr cookie defaults; generated `.open-next/worker.js` and `images.js`.

Not reviewed:
- Remaining SQL bodies (dispatcher, issuance, invitation flows, contacts and shipments RPCs, `seed.sql`).
- `modules/{contacts,members,mengantar}` and shipment business logic; Mengantar response parsing and pricing.
- UI and marketing components; tests other than the middleware unit test.
- Hosted Supabase and Cloudflare settings that are not in the repo (production is not provisioned).
- Anything at runtime or in a browser — nothing was executed.
- Whether Workers Logs or traces capture cookies or outbound request URLs.
- The contents of `.env.example`.

Pointers for other lanes:
- **Untracked migrations?** `20261027220000_contact_archive_and_demo_cleanup.sql` and `20261027230000_production_readiness_polish.sql` do not appear in `.git/index` [INFERENCE from the raw index]. Tracked code depends on the first one, so confirm with `git status`.
- **Anon execute rights:** `registration.sql` revokes function access only from `PUBLIC`. Under Supabase's default privileges, `anon` may keep execute rights [INFERENCE]. The functions check internally, so this is harmless today.
- **Next 16 rename:** `src/middleware.ts` uses the convention Next 16 deprecated in favour of `proxy`. Check OpenNext support before migrating.
- **robots.txt:** it lists `/admin` and `/verifikasi-2fa`, although `platform.ts:52` intends the platform area not to advertise itself.
- **OpenNext image handler:** the generated `/cdn-cgi/image/` handler fetches remote URLs without remote patterns. Cloudflare reserves `/cdn-cgi/` at the edge, so it should only matter in dev [INFERENCE].
- **Tracing not pinned off:** RELEASE gate 3 says to keep tracing and Logpush of outbound URLs off, but `wrangler.jsonc` only sets `observability.enabled: true`. Mengantar seller keys appear in those URL paths.