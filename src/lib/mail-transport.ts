import "server-only";
import type { OutgoingMail } from "@/lib/auth-mail";
import { workerSecret } from "@/lib/worker-secret";

// DEC-009: delivery for the Auth Send Email Hook, chosen by the MAIL_TRANSPORT binding.
// - "mailpit": local development only (loopback Mailpit API; refused for any other host).
// - anything else / missing: not configured; the hook fails closed and Auth reports the error.
// The production transport (Cloudflare Email Sending) is added once eligibility, sending domain
// and quota are verified (ARCH-3 gate).
export class MailNotConfigured extends Error {}

export async function deliver(messages: OutgoingMail[]): Promise<void> {
  const transport = workerSecret("MAIL_TRANSPORT");
  if (transport !== "mailpit") throw new MailNotConfigured("mail transport not configured");
  const base = workerSecret("MAILPIT_URL") ?? "";
  const host = (() => { try { return new URL(base).hostname; } catch { return ""; } })();
  if (!["127.0.0.1", "localhost", "[::1]"].includes(host)) throw new MailNotConfigured("mailpit transport is local-only");
  const from = workerSecret("MAIL_FROM") ?? "no-reply@geraiexpress.local";
  for (const m of messages) {
    const res = await fetch(new URL("/api/v1/send", base), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ From: { Email: from, Name: "GeraiExpress" }, To: [{ Email: m.to }], Subject: m.subject, Text: m.text, HTML: m.html }),
    });
    if (!res.ok) throw new Error(`mail delivery failed with HTTP ${res.status}`);
  }
}
