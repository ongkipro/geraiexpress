import "server-only";
import { getCloudflareContext } from "@opennextjs/cloudflare";

// Reads a Worker secret binding only (wrangler secret in production, .dev.vars locally, also under
// `next dev` via the OpenNext dev proxy). No process.env fallback: OpenNext mirrors baked .env*
// values into process.env, and a secret must never come from the build. Missing => undefined, and
// callers fail closed. Values never leave the server; callers must not log or return them.
// TURNSTILE_SITE_KEY is public configuration read the same way (runtime, not baked at build).
export type WorkerBindingName = "CREDENTIAL_KEY" | "MENGANTAR_PARTNER_SECRET" | "TURNSTILE_SITE_KEY"
  | "SEND_EMAIL_HOOK_SECRET" | "MAIL_TRANSPORT" | "MAILPIT_URL" | "MAIL_FROM"
  // DEC-010 machine identity (Supabase secret key) and the Mengantar environment for live calls.
  | "SUPABASE_SECRET_KEY" | "MENGANTAR_ENV" | "PARTNER_ID" | "GERAIEXPRESS_MENGANTAR_SANDBOX_SECRET";

// Non-secret configuration (site key, mail transport, sender) is read the same way.
export function workerSecret(name: WorkerBindingName): string | undefined {
  try {
    const value = (getCloudflareContext().env as unknown as Record<string, string | undefined>)[name];
    return value || undefined;
  } catch {
    return undefined;
  }
}
