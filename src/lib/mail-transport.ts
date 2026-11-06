import "server-only";
import type { OutgoingMail } from "@/lib/auth-mail";
import { config } from "@/lib/config";
import { assertAddress, sendSmtp, type SmtpSettings } from "@/lib/mail-smtp";

// DEC-009 / T-063: delivery of the one-time-code mail, chosen by the MAIL_TRANSPORT setting.
// - "mailpit": local development only (loopback, or the local Mailpit reached from a container as
//   `host.docker.internal` or by the local database stack's container name; refused for any other host).
// - "smtp": production submission to the provider the owner configures (provider-neutral; domain
//   geraiexpress.com, default sender no-reply@geraiexpress.com). Needs SMTP_HOST, SMTP_PORT, SMTP_SECURITY
//   (tls | starttls), SMTP_USERNAME and SMTP_PASSWORD; TLS is mandatory and certificates are verified.
// - anything else / missing / incomplete: not configured; delivery fails closed with MailNotConfigured.
export class MailNotConfigured extends Error {}

export const DEFAULT_MAIL_FROM = "no-reply@geraiexpress.com";
const FROM_NAME = "GeraiExpress";
const LOCAL_MAIL_HOSTS = ["127.0.0.1", "localhost", "[::1]", "host.docker.internal", "gxdb-mailpit-1"];

function mailFrom(): string {
  return config("MAIL_FROM") ?? DEFAULT_MAIL_FROM;
}

// Canonical host for comparison: case-insensitive, without a trailing root dot (LOCALHOST., localhost.).
function canonicalHost(host: string): string {
  return host.trim().toLowerCase().replace(/\.+$/, "");
}
const LOCAL_CANONICAL = new Set(LOCAL_MAIL_HOSTS.map(canonicalHost));

// One validator per variable, shared by the settings and the diagnostics, so startup can never report a
// configuration as ready while delivery refuses it. Each returns true when the value is usable.
const SMTP_RULES = {
  SMTP_HOST: (v?: string) => !!v && /^[A-Za-z0-9.-]{1,253}$/.test(v) && !LOCAL_CANONICAL.has(canonicalHost(v)) && canonicalHost(v) !== "",
  SMTP_PORT: (v?: string) => { const n = Number(v); return !!v && Number.isInteger(n) && n >= 1 && n <= 65535; },
  SMTP_SECURITY: (v?: string) => v === "tls" || v === "starttls",
  SMTP_USERNAME: (v?: string) => !!v,
  SMTP_PASSWORD: (v?: string) => !!v,
} as const;
type SmtpVariable = keyof typeof SMTP_RULES;

function isAddress(value: string): boolean {
  try { assertAddress(value); return true; } catch { return false; }
}

// Names of the SMTP variables (and MAIL_FROM) that are missing or invalid; never their values.
function smtpProblems(): string[] {
  const bad: string[] = (Object.keys(SMTP_RULES) as SmtpVariable[]).filter((name) => !SMTP_RULES[name](config(name)));
  if (!isAddress(mailFrom())) bad.push("MAIL_FROM");
  return bad;
}

// The SMTP settings, or null when any of them is missing or invalid (fail closed, never partially).
export function smtpSettings(): SmtpSettings | null {
  if (smtpProblems().length) return null;
  const security = config("SMTP_SECURITY") as SmtpSettings["security"];
  return { host: canonicalHost(config("SMTP_HOST")!), port: Number(config("SMTP_PORT")), security,
    username: config("SMTP_USERNAME")!, password: config("SMTP_PASSWORD")!, from: mailFrom(), fromName: FROM_NAME };
}

// Names of the settings that keep a selected transport from being ready (names only, never values), for the
// startup check and the operator runbook.
export function mailConfigProblems(): string[] {
  const transport = config("MAIL_TRANSPORT");
  if (transport === undefined) return [];
  if (transport === "mailpit") return mailpitReady() ? [] : ["MAILPIT_URL"];
  if (transport !== "smtp") return ["MAIL_TRANSPORT"];
  return smtpProblems();
}

function mailpitReady(): boolean {
  try { return LOCAL_MAIL_HOSTS.includes(new URL(config("MAILPIT_URL") ?? "").hostname); }
  catch { return false; }
}

export function mailTransportReady(): boolean {
  const transport = config("MAIL_TRANSPORT");
  if (transport === "mailpit") return mailpitReady();
  if (transport === "smtp") return smtpSettings() !== null;
  return false;
}

export async function deliver(messages: OutgoingMail[]): Promise<void> {
  if (!mailTransportReady()) throw new MailNotConfigured("mail transport not configured");
  if (config("MAIL_TRANSPORT") === "smtp") return sendSmtp(smtpSettings()!, messages);
  const base = config("MAILPIT_URL")!;
  const from = mailFrom();
  for (const m of messages) {
    const res = await fetch(new URL("/api/v1/send", base), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ From: { Email: from, Name: FROM_NAME }, To: [{ Email: m.to }], Subject: m.subject, Text: m.text, HTML: m.html }),
    });
    if (!res.ok) throw new Error(`mail delivery failed with HTTP ${res.status}`);
  }
}
