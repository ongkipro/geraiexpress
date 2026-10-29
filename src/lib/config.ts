import "server-only";

// The one configuration reader (T-062, DEC-020): server-side runtime configuration and secrets come
// from the container environment (`process.env`, read at call time, never at build time), so one image
// can be started with different values. Missing, empty or whitespace-only => undefined; callers fail closed.
// Values never leave the server: callers must not log or return them. Nothing here is NEXT_PUBLIC_*,
// so none of it is inlined into the browser bundle (`pnpm check:bundle` scans for the secret names).
//
// Not covered here, by design: hosts.ts reads the audience origins and HOST_SHARED_MODE from an
// injectable environment object; it does not go through this module's `config`.
export type ConfigName =
  // PostgREST (the only data API, ADR-0002) and the auth module's two secrets. AUTH_JWT_SECRET signs the
  // access tokens PostgREST verifies (and the machine identity of DEC-010); AUTH_SECRET roots the OTP and
  // TOTP-sealing keys. Both are at least 32 bytes and differ.
  | "POSTGREST_URL" | "AUTH_JWT_SECRET" | "AUTH_SECRET"
  // Credential sealing key ring (SEC-7): CREDENTIAL_KEY is the legacy single key (version 1).
  | "CREDENTIAL_KEY" | "CREDENTIAL_KEYS" | "CREDENTIAL_KEY_CURRENT"
  // Mengantar environment and Partner account.
  | "MENGANTAR_ENV" | "MENGANTAR_PARTNER_SECRET" | "GERAIEXPRESS_MENGANTAR_SANDBOX_SECRET" | "PARTNER_ID"
  | "PARTNER_TERMS_VERSION" | "PARTNER_PRIVACY_VERSION" | "PARTNER_TERMS_URL" | "PARTNER_PRIVACY_URL"
  // Cloudflare Turnstile: the site key is public configuration, the secret verifies tokens server-side.
  // AUTH_CAPTCHA_DISABLED=true is the explicit opt-out for stacks without a widget.
  | "TURNSTILE_SITE_KEY" | "TURNSTILE_SECRET_KEY" | "AUTH_CAPTCHA_DISABLED"
  // Mail transport for the emailed sign-in code, and the reverse proxy trust switch.
  | "MAIL_TRANSPORT" | "MAILPIT_URL" | "MAIL_FROM" | "TRUSTED_PROXY"
  // Scheduler secret for /api/internal/cron/*.
  | "CRON_SECRET";

export function config(name: ConfigName): string | undefined {
  const value = process.env[name];
  return value?.trim() ? value : undefined;
}
