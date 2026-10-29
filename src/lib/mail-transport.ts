import "server-only";
import type { OutgoingMail } from "@/lib/auth-mail";
import { config } from "@/lib/config";

// DEC-009: delivery of the one-time-code mail, chosen by the MAIL_TRANSPORT setting.
// - "mailpit": local development only (loopback, or the local Mailpit reached from a container as
//   `host.docker.internal` or by the local database stack's container name; refused for any other host).
// - anything else / missing: not configured; delivery fails closed with MailNotConfigured.
// There is no production transport yet: it is chosen by the owner (sending domain and provider, T-063)
// and added behind this same interface. Until then production mail fails closed.
export class MailNotConfigured extends Error {}

const LOCAL_MAIL_HOSTS = ["127.0.0.1", "localhost", "[::1]", "host.docker.internal", "gxdb-mailpit-1"];

export function mailTransportReady(): boolean {
  if (config("MAIL_TRANSPORT") !== "mailpit") return false;
  try { return LOCAL_MAIL_HOSTS.includes(new URL(config("MAILPIT_URL") ?? "").hostname); }
  catch { return false; }
}
export async function deliver(messages: OutgoingMail[]): Promise<void> {
  if (!mailTransportReady()) throw new MailNotConfigured("mail transport not configured");
  const base = config("MAILPIT_URL")!;
  const from = config("MAIL_FROM") ?? "no-reply@geraiexpress.local";
  for (const m of messages) {
    const res = await fetch(new URL("/api/v1/send", base), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ From: { Email: from, Name: "GeraiExpress" }, To: [{ Email: m.to }], Subject: m.subject, Text: m.text, HTML: m.html }),
    });
    if (!res.ok) throw new Error(`mail delivery failed with HTTP ${res.status}`);
  }
}
