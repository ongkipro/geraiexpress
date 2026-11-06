import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderCodeMail } from "../../src/lib/auth-mail";
import { MailNotConfigured, deliver } from "../../src/lib/mail-transport";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth-mail", () => vi.importActual("../../src/lib/auth-mail"));

const settings: Record<string, string | undefined> = {};
vi.mock("@/lib/config", () => ({ config: (name: string) => settings[name] }));
vi.mock("@/lib/mail-smtp", () => vi.importActual("../../src/lib/mail-smtp"));

describe("one-time-code mail (DEC-009, PR-36)", () => {
  it("renders one Indonesian mail carrying the code, in text and html", () => {
    const mail = renderCodeMail("a@b.test", "123456");
    expect(mail).toMatchObject({ to: "a@b.test", subject: "Kode masuk GeraiExpress" });
    expect(mail.text).toContain("123456");
    expect(mail.html).toContain("123456");
    expect(mail.text).toContain("Kode berlaku 10 menit.");
    expect(mail.text).toContain("abaikan email ini");
  });

  // PR-36 / T-042: the mail is code-only. A link would need a per-environment origin (never a
  // request header), so none may appear until one is built from configuration.
  it("contains no link or host name", () => {
    const mail = renderCodeMail("a@b.test", "654321");
    expect(`${mail.text}\n${mail.html}`).not.toMatch(/https?:|href=|\.com|localhost|workers\.dev/i);
  });

  it("refuses anything but a six-digit code, so markup can never reach the html body", () => {
    for (const code of ["12345", "1234567", "12ab56", "<b>123</b>", ""]) {
      expect(() => renderCodeMail("a@b.test", code), code).toThrow("six digits");
    }
  });
});

describe("mail transport (fails closed)", () => {
  const send = vi.fn<typeof fetch>();
  const mail = renderCodeMail("a@b.test", "123456");

  beforeEach(() => {
    for (const key of Object.keys(settings)) delete settings[key];
    send.mockReset();
    send.mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", send);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("is not configured unless MAIL_TRANSPORT names a ready transport", async () => {
    await expect(deliver([mail])).rejects.toBeInstanceOf(MailNotConfigured);
    // smtp without its settings stays closed even when a Mailpit URL is present (no silent fallback).
    settings.MAIL_TRANSPORT = "smtp";
    settings.MAILPIT_URL = "http://127.0.0.1:58025";
    await expect(deliver([mail])).rejects.toBeInstanceOf(MailNotConfigured);
    settings.MAIL_TRANSPORT = "sendgrid";
    await expect(deliver([mail])).rejects.toBeInstanceOf(MailNotConfigured);
    expect(send).not.toHaveBeenCalled();
  });

  it("sends through a local Mailpit only", async () => {
    settings.MAIL_TRANSPORT = "mailpit";
    for (const url of ["https://mailpit.example.com", "http://10.0.0.5:8025", "not a url", ""]) {
      settings.MAILPIT_URL = url;
      await expect(deliver([mail]), url).rejects.toBeInstanceOf(MailNotConfigured);
    }
    expect(send).not.toHaveBeenCalled();
    for (const url of ["http://127.0.0.1:58025", "http://localhost:8025", "http://host.docker.internal:58025", "http://gxdb-mailpit-1:8025"]) {
      settings.MAILPIT_URL = url;
      await deliver([mail]);
    }
    expect(send).toHaveBeenCalledTimes(4);
  });

  it("posts the message to the Mailpit send API and reports a refused delivery", async () => {
    settings.MAIL_TRANSPORT = "mailpit";
    settings.MAILPIT_URL = "http://127.0.0.1:58025";
    await deliver([mail]);
    const [url, init] = send.mock.calls[0];
    expect(String(url)).toBe("http://127.0.0.1:58025/api/v1/send");
    expect(JSON.parse(String(init?.body))).toMatchObject({ To: [{ Email: "a@b.test" }], Subject: mail.subject, Text: mail.text });
    send.mockResolvedValue(new Response("no", { status: 500 }));
    await expect(deliver([mail])).rejects.toThrow("HTTP 500");
  });
});

// T-063: the SMTP transport is all-or-nothing and names missing settings (never values).
describe("SMTP transport configuration (T-063)", () => {
  const complete = {
    MAIL_TRANSPORT: "smtp", SMTP_HOST: "smtp.provider.test", SMTP_PORT: "587", SMTP_SECURITY: "starttls",
    SMTP_USERNAME: "apikey", SMTP_PASSWORD: "s3cret",
  };
  beforeEach(() => { for (const key of Object.keys(settings)) delete settings[key]; });

  it("is ready only with every setting valid, and defaults the sender to no-reply@geraiexpress.com", async () => {
    const { mailTransportReady, smtpSettings, mailConfigProblems, DEFAULT_MAIL_FROM } = await import("../../src/lib/mail-transport");
    Object.assign(settings, complete);
    expect(mailTransportReady()).toBe(true);
    expect(mailConfigProblems()).toEqual([]);
    expect(DEFAULT_MAIL_FROM).toBe("no-reply@geraiexpress.com");
    expect(smtpSettings()).toMatchObject({ host: "smtp.provider.test", port: 587, security: "starttls", from: "no-reply@geraiexpress.com", fromName: "GeraiExpress" });
    // Every invalid value is refused AND named by the diagnostics (the two share one validator, T-063 review).
    for (const [name, bad] of [["SMTP_PORT", "0"], ["SMTP_PORT", "smtp"], ["SMTP_SECURITY", "none"], ["SMTP_HOST", "localhost"],
      ["SMTP_HOST", "LOCALHOST"], ["SMTP_HOST", "localhost."], ["SMTP_HOST", "Host.Docker.Internal."], ["SMTP_HOST", "GXDB-MAILPIT-1"],
      ["SMTP_HOST", "127.0.0.1"], ["SMTP_HOST", "bad host"], ["SMTP_PASSWORD", ""], ["MAIL_FROM", "no reply@geraiexpress.com"]] as const) {
      Object.assign(settings, complete, { [name]: bad });
      expect(mailTransportReady(), `${name}=${bad}`).toBe(false);
      expect(mailConfigProblems(), `${name}=${bad}`).toEqual([name]);
    }
  });

  it("reports the missing setting names, never their values", async () => {
    const { mailConfigProblems } = await import("../../src/lib/mail-transport");
    Object.assign(settings, { MAIL_TRANSPORT: "smtp", SMTP_HOST: "smtp.provider.test", SMTP_PASSWORD: "s3cret" });
    const problems = mailConfigProblems();
    expect(problems).toEqual(["SMTP_PORT", "SMTP_SECURITY", "SMTP_USERNAME"]);
    expect(problems.join(" ")).not.toContain("s3cret");
    settings.MAIL_TRANSPORT = "postmark";
    expect(mailConfigProblems()).toEqual(["MAIL_TRANSPORT"]);
    delete settings.MAIL_TRANSPORT;
    expect(mailConfigProblems()).toEqual([]);
  });
});
