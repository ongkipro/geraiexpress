import "server-only";
import { randomUUID } from "node:crypto";
import { connect as netConnect, type Socket } from "node:net";
import { connect as tlsConnect, type TLSSocket } from "node:tls";

// T-063 / DEC-009: a provider-neutral SMTP submission client on Node's own net/tls (no dependency).
// Scope is deliberately small: one authenticated submission per message, as a transactional sender needs.
//  - TLS is mandatory: implicit TLS ("tls", usually port 465) or STARTTLS ("starttls", usually 587). A server
//    that does not offer STARTTLS is refused; nothing is ever sent in clear text. Certificates are verified.
//  - AUTH PLAIN or LOGIN over TLS only.
//  - Every reply code is checked; any unexpected reply aborts the message (the caller logs no provider text).
//  - Header values are validated against CR/LF so a recipient or subject cannot inject headers.
export type SmtpSettings = {
  host: string;
  port: number;
  security: "tls" | "starttls";
  username: string;
  password: string;
  from: string;
  fromName: string;
  timeoutMs?: number;
};
export type SmtpMessage = { to: string; subject: string; text: string; html: string };

export class SmtpError extends Error {}

const ADDRESS = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

export function assertAddress(value: string): string {
  if (value.length > 254 || !ADDRESS.test(value)) throw new SmtpError("invalid mail address");
  return value;
}
function headerText(value: string): string {
  if (/[\r\n]/.test(value)) throw new SmtpError("header value contains a line break");
  return value;
}
// RFC 2047 encoded word for non-ASCII header text (subject, display name).
function encodeHeader(value: string): string {
  headerText(value);
  return /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}
function base64Lines(value: string): string {
  return (Buffer.from(value, "utf8").toString("base64").match(/.{1,76}/g) ?? []).join("\r\n");
}

// The full RFC 5322 message. Bodies are base64 (no dot-stuffing or line-length issues).
export function buildMessage(settings: Pick<SmtpSettings, "from" | "fromName">, message: SmtpMessage, now = new Date(), id: string = randomUUID()): string {
  const from = assertAddress(settings.from);
  const to = assertAddress(message.to);
  const boundary = `gx-${id}`;
  const domain = from.split("@")[1];
  return [
    `From: ${encodeHeader(settings.fromName)} <${from}>`,
    `To: <${to}>`,
    `Subject: ${encodeHeader(message.subject)}`,
    `Date: ${now.toUTCString()}`,
    `Message-ID: <${id}@${domain}>`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    base64Lines(message.text),
    `--${boundary}`,
    "Content-Type: text/html; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    base64Lines(message.html),
    `--${boundary}--`,
    "",
  ].join("\r\n");
}

// Reads SMTP replies (multi-line aware) from a socket.
class Replies {
  private buffer = "";
  private waiting: ((reply: { code: number; text: string }) => void) | null = null;
  private failed: ((error: Error) => void) | null = null;
  private queue: { code: number; text: string }[] = [];
  private error: Error | null = null;

  attach(socket: Socket | TLSSocket) {
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => this.push(chunk));
    socket.on("error", (error) => this.fail(error));
    socket.on("close", () => this.fail(new SmtpError("connection closed")));
  }
  private push(chunk: string) {
    this.buffer += chunk;
    if (this.buffer.length > 64 * 1024) return this.fail(new SmtpError("reply too long"));
    let lines: string[] = [];
    let end: number;
    while ((end = this.buffer.indexOf("\r\n")) >= 0) {
      const line = this.buffer.slice(0, end);
      this.buffer = this.buffer.slice(end + 2);
      // Every line of one reply carries the same code (RFC 5321 4.2.1); a mixed reply is malformed, never the
      // last line's code (e.g. "550-rejected" then "250 ok" must not read as success).
      if (lines.length && line.slice(0, 3) !== lines[0].slice(0, 3)) return this.fail(new SmtpError("malformed reply"));
      lines.push(line);
      if (/^\d{3} /.test(line) || /^\d{3}$/.test(line)) {
        this.deliver({ code: Number(line.slice(0, 3)), text: lines.join("\n") });
        lines = [];
      } else if (!/^\d{3}-/.test(line)) {
        return this.fail(new SmtpError("malformed reply"));
      }
    }
    if (lines.length) this.buffer = `${lines.join("\r\n")}\r\n${this.buffer}`;
  }
  private deliver(reply: { code: number; text: string }) {
    if (this.waiting) { const w = this.waiting; this.waiting = null; this.failed = null; w(reply); }
    else this.queue.push(reply);
  }
  private fail(error: Error) {
    if (this.error) return;
    this.error = error;
    if (this.failed) { const f = this.failed; this.waiting = null; this.failed = null; f(error); }
  }
  next(timeoutMs: number): Promise<{ code: number; text: string }> {
    const queued = this.queue.shift();
    if (queued) return Promise.resolve(queued);
    if (this.error) return Promise.reject(this.error);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.waiting = null; this.failed = null; reject(new SmtpError("reply timeout")); }, timeoutMs);
      this.waiting = (reply) => { clearTimeout(timer); resolve(reply); };
      this.failed = (error) => { clearTimeout(timer); reject(error); };
    });
  }
}

type Connector = {
  plain: (host: string, port: number) => Socket;
  tls: (options: { host: string; port?: number; socket?: Socket; servername: string }) => TLSSocket;
};
const defaultConnector: Connector = {
  plain: (host, port) => netConnect({ host, port }),
  tls: (options) => tlsConnect({ ...options, rejectUnauthorized: true, minVersion: "TLSv1.2" }),
};

function waitSecure(socket: TLSSocket, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new SmtpError("TLS handshake timeout")), timeoutMs);
    socket.once("secureConnect", () => { clearTimeout(timer); resolve(); });
    socket.once("error", (error) => { clearTimeout(timer); reject(error); });
  });
}

// Sends each message in its own authenticated session (simple and isolated; volume is one code mail at a time).
export async function sendSmtp(settings: SmtpSettings, messages: SmtpMessage[], connector: Connector = defaultConnector): Promise<void> {
  for (const message of messages) await sendOne(settings, message, connector);
}

async function sendOne(settings: SmtpSettings, message: SmtpMessage, connector: Connector): Promise<void> {
  const timeout = settings.timeoutMs ?? 15_000;
  const from = assertAddress(settings.from);
  const to = assertAddress(message.to);
  const body = buildMessage(settings, message);
  let socket: Socket | TLSSocket | null = null;
  let replies = new Replies();
  const send = (line: string) => { socket!.write(`${line}\r\n`); };
  const expect = async (codes: number[], what: string) => {
    const reply = await replies.next(timeout);
    if (!codes.includes(reply.code)) throw new SmtpError(`unexpected reply to ${what}: ${reply.code}`);
    return reply;
  };
  try {
    // Connection and TLS handshake run inside the cleanup scope: a peer that accepts TCP and then stalls is
    // destroyed on timeout instead of leaking an open socket.
    if (settings.security === "tls") {
      const secure = connector.tls({ host: settings.host, port: settings.port, servername: settings.host });
      socket = secure;
      replies.attach(secure);
      await waitSecure(secure, timeout);
    } else {
      socket = connector.plain(settings.host, settings.port);
      replies.attach(socket);
    }
    await expect([220], "greeting");
    send("EHLO geraiexpress");
    let ehlo = await expect([250], "EHLO");
    if (settings.security === "starttls") {
      if (!/\bSTARTTLS\b/i.test(ehlo.text)) throw new SmtpError("server does not offer STARTTLS");
      send("STARTTLS");
      await expect([220], "STARTTLS");
      const plain: Socket = socket as Socket;
      plain.removeAllListeners("data"); plain.removeAllListeners("error"); plain.removeAllListeners("close");
      const secure = connector.tls({ socket: plain, servername: settings.host, host: settings.host });
      replies = new Replies();
      replies.attach(secure);
      await waitSecure(secure, timeout);
      socket = secure;
      send("EHLO geraiexpress");
      ehlo = await expect([250], "EHLO after STARTTLS");
    }
    const auth = /^250[ -]AUTH\b(.*)$/im.exec(ehlo.text)?.[1]?.toUpperCase() ?? "";
    if (/\bPLAIN\b/.test(auth)) {
      send(`AUTH PLAIN ${Buffer.from(`\0${settings.username}\0${settings.password}`, "utf8").toString("base64")}`);
      await expect([235], "AUTH");
    } else if (/\bLOGIN\b/.test(auth)) {
      send("AUTH LOGIN");
      await expect([334], "AUTH LOGIN");
      send(Buffer.from(settings.username, "utf8").toString("base64"));
      await expect([334], "AUTH username");
      send(Buffer.from(settings.password, "utf8").toString("base64"));
      await expect([235], "AUTH password");
    } else {
      throw new SmtpError("server offers no supported AUTH mechanism");
    }
    send(`MAIL FROM:<${from}>`);
    await expect([250], "MAIL FROM");
    send(`RCPT TO:<${to}>`);
    await expect([250, 251], "RCPT TO");
    send("DATA");
    await expect([354], "DATA");
    socket.write(`${body}\r\n.\r\n`);
    await expect([250], "message");
    // The message is accepted at this point; QUIT is still checked so a misbehaving peer is visible.
    send("QUIT");
    await expect([221], "QUIT");
  } finally {
    socket?.destroy();
  }
}
