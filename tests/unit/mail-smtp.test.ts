import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connect as tlsConnect, createServer as createTlsServer, TLSSocket, type SecureContextOptions } from "node:tls";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { buildMessage, sendSmtp, SmtpError, type SmtpSettings } from "../../src/lib/mail-smtp";

// T-063: the SMTP client against a scripted local server over real sockets. A throwaway self-signed certificate
// is trusted only through the test connector (production verifies against the system store).
let cert: SecureContextOptions;
let dir = "";
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "gx-smtp-"));
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=localhost",
    "-addext", "subjectAltName=DNS:localhost", "-keyout", join(dir, "key.pem"), "-out", join(dir, "cert.pem")], { stdio: "ignore" });
  cert = { key: readFileSync(join(dir, "key.pem")), cert: readFileSync(join(dir, "cert.pem")) };
});
afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

type Session = { commands: string[]; data: string; tlsUsed: boolean };
type Script = { starttls?: boolean; auth?: string; rcpt?: number; greeting?: number; quit?: string; mixedEhlo?: boolean };

// A minimal SMTP server: records every command and the DATA payload.
function smtpServer(mode: "tls" | "starttls", script: Script = {}): Promise<{ port: number; sessions: Session[]; close: () => void }> {
  const sessions: Session[] = [];
  const handle = (socket: Socket | TLSSocket, session: Session) => {
    let buffer = ""; let inData = false;
    const reply = (line: string) => socket.write(`${line}\r\n`);
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      if (inData) {
        const end = buffer.indexOf("\r\n.\r\n");
        if (end < 0) return;
        session.data = buffer.slice(0, end); buffer = buffer.slice(end + 5); inData = false;
        reply("250 queued");
      }
      let at: number;
      while (!inData && (at = buffer.indexOf("\r\n")) >= 0) {
        const line = buffer.slice(0, at); buffer = buffer.slice(at + 2);
        session.commands.push(line);
        const verb = line.split(" ")[0].toUpperCase();
        if (verb === "EHLO" && script.mixedEhlo) {
          socket.write("550-rejected\r\n250 ok\r\n");
        } else if (verb === "EHLO") {
          const ext = [];
          if (mode === "starttls" && !(socket instanceof TLSSocket) && script.starttls !== false) ext.push("STARTTLS");
          ext.push(`AUTH ${script.auth ?? "PLAIN LOGIN"}`);
          socket.write(`250-localhost\r\n${ext.map((e, i) => `250${i === ext.length - 1 ? " " : "-"}${e}`).join("\r\n")}\r\n`);
        } else if (verb === "STARTTLS") {
          reply("220 go ahead");
          socket.removeAllListeners("data");
          const secure = new TLSSocket(socket, { isServer: true, ...cert });
          session.tlsUsed = true;
          handle(secure, session);
          return;
        } else if (verb === "AUTH") {
          if (line.startsWith("AUTH LOGIN")) reply("334 VXNlcm5hbWU6"); else reply("235 ok");
        } else if (session.commands.at(-2)?.startsWith("AUTH LOGIN") && !session.commands.at(-2)?.includes(" ", 11)) {
          reply("334 UGFzc3dvcmQ6");
        } else if (session.commands.at(-3)?.startsWith("AUTH LOGIN")) {
          reply("235 ok");
        } else if (verb === "MAIL") reply("250 ok");
        else if (verb === "RCPT") reply(`${script.rcpt ?? 250} rcpt`);
        else if (verb === "DATA") { reply("354 go"); inData = true; }
        else if (verb === "QUIT") { reply(script.quit ?? "221 bye"); socket.end(); }
        else reply("502 no");
      }
    });
  };
  const onConnection = (socket: Socket | TLSSocket) => {
    const session: Session = { commands: [], data: "", tlsUsed: mode === "tls" };
    sessions.push(session);
    socket.write(`${script.greeting ?? 220} localhost ESMTP\r\n`);
    handle(socket, session);
  };
  const server: Server = mode === "tls" ? createTlsServer({ ...cert }, onConnection) : createServer(onConnection);
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => {
    const port = (server.address() as { port: number }).port;
    resolve({ port, sessions, close: () => server.close() });
  }));
}

// Test connector: same as production but trusts the throwaway certificate.
const connector = {
  plain: (host: string, port: number) => createConnection(host, port),
  tls: (options: { host: string; port?: number; socket?: Socket; servername: string }) =>
    tlsConnect({ ...options, host: options.socket ? undefined : "127.0.0.1", ca: cert.cert, servername: "localhost", rejectUnauthorized: true, minVersion: "TLSv1.2" }),
};
import { connect as createConnectionRaw } from "node:net";
function createConnection(_host: string, port: number) { return createConnectionRaw({ host: "127.0.0.1", port }); }

const base = (port: number, security: SmtpSettings["security"]): SmtpSettings =>
  ({ host: "localhost", port, security, username: "user@geraiexpress.com", password: "s3cret", from: "no-reply@geraiexpress.com", fromName: "GeraiExpress", timeoutMs: 3000 });
const mail = { to: "pelanggan@contoh.test", subject: "Kode masuk GeraiExpress", text: "Kode: 123456", html: "<p>123456</p>" };

describe("SMTP submission (T-063)", () => {
  it("implicit TLS: authenticates, submits one message and quits", async () => {
    const server = await smtpServer("tls");
    try {
      await sendSmtp(base(server.port, "tls"), [mail], connector);
      const s = server.sessions[0];
      expect(s.tlsUsed).toBe(true);
      expect(s.commands[0]).toMatch(/^EHLO /);
      expect(s.commands).toContain(`AUTH PLAIN ${Buffer.from("\0user@geraiexpress.com\0s3cret").toString("base64")}`);
      expect(s.commands).toContain("MAIL FROM:<no-reply@geraiexpress.com>");
      expect(s.commands).toContain("RCPT TO:<pelanggan@contoh.test>");
      expect(s.commands.at(-1)).toBe("QUIT");
      expect(s.data).toContain("From: GeraiExpress <no-reply@geraiexpress.com>");
      expect(Buffer.from(s.data.split("base64\r\n\r\n")[1].split("\r\n--")[0].replace(/\r\n/g, ""), "base64").toString()).toBe("Kode: 123456");
    } finally { server.close(); }
  });

  it("STARTTLS: upgrades before AUTH and re-sends EHLO; credentials never travel in clear text", async () => {
    const server = await smtpServer("starttls");
    try {
      await sendSmtp(base(server.port, "starttls"), [mail], connector);
      const s = server.sessions[0];
      const starttls = s.commands.indexOf("STARTTLS");
      const auth = s.commands.findIndex((c) => c.startsWith("AUTH"));
      expect(starttls).toBeGreaterThan(-1);
      expect(auth).toBeGreaterThan(starttls);
      expect(s.commands.filter((c) => c.startsWith("EHLO"))).toHaveLength(2);
      expect(s.tlsUsed).toBe(true);
    } finally { server.close(); }
  });

  it("refuses a server that does not offer STARTTLS, before sending any credential", async () => {
    const server = await smtpServer("starttls", { starttls: false });
    try {
      await expect(sendSmtp(base(server.port, "starttls"), [mail], connector)).rejects.toThrow(/STARTTLS/);
      expect(server.sessions[0].commands.some((c) => c.startsWith("AUTH"))).toBe(false);
    } finally { server.close(); }
  });

  it("uses AUTH LOGIN when PLAIN is not offered", async () => {
    const server = await smtpServer("tls", { auth: "LOGIN" });
    try {
      await sendSmtp(base(server.port, "tls"), [mail], connector);
      const c = server.sessions[0].commands;
      const at = c.indexOf("AUTH LOGIN");
      expect(c[at + 1]).toBe(Buffer.from("user@geraiexpress.com").toString("base64"));
      expect(c[at + 2]).toBe(Buffer.from("s3cret").toString("base64"));
    } finally { server.close(); }
  });

  it("aborts on an unexpected reply and sends no DATA", async () => {
    const server = await smtpServer("tls", { rcpt: 550 });
    try {
      await expect(sendSmtp(base(server.port, "tls"), [mail], connector)).rejects.toBeInstanceOf(SmtpError);
      expect(server.sessions[0].commands).not.toContain("DATA");
    } finally { server.close(); }
  });

  it("verifies the server certificate (an untrusted certificate is refused)", async () => {
    const server = await smtpServer("tls");
    try {
      const strict = { ...connector, tls: (o: { host: string; port?: number; socket?: Socket; servername: string }) =>
        tlsConnect({ ...o, host: "127.0.0.1", servername: "localhost", rejectUnauthorized: true }) };
      await expect(sendSmtp(base(server.port, "tls"), [mail], strict)).rejects.toThrow();
      expect(server.sessions[0]?.commands ?? []).toEqual([]);
    } finally { server.close(); }
  });
});

describe("SMTP robustness (T-063 review)", () => {
  it("destroys the socket when the TLS handshake stalls (no leaked connection)", async () => {
    // A TCP server that accepts and never starts TLS.
    const peers: Socket[] = [];
    const closed: boolean[] = [];
    // resume(): a socket that is never read stays paused and would not report the client's close.
    const server = createServer((socket) => { peers.push(socket); socket.on("close", () => closed.push(true)); socket.resume(); });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    const port = (server.address() as { port: number }).port;
    try {
      await expect(sendSmtp({ ...base(port, "tls"), timeoutMs: 300 }, [mail], connector)).rejects.toThrow(/timeout/);
      await expect.poll(() => closed.length, { timeout: 2000 }).toBe(1);
    } finally { for (const p of peers) p.destroy(); server.close(); }
  });

  it("refuses a multi-line reply whose lines carry different codes", async () => {
    const server = await smtpServer("tls", { mixedEhlo: true });
    try {
      await expect(sendSmtp(base(server.port, "tls"), [mail], connector)).rejects.toThrow(/malformed reply/);
      expect(server.sessions[0].commands.some((c) => c.startsWith("AUTH"))).toBe(false);
    } finally { server.close(); }
  });

  it("checks the QUIT reply", async () => {
    const server = await smtpServer("tls", { quit: "500 confused" });
    try {
      await expect(sendSmtp(base(server.port, "tls"), [mail], connector)).rejects.toThrow(/QUIT/);
    } finally { server.close(); }
  });
});

describe("message building (T-063)", () => {
  it("refuses header injection through the recipient or subject", () => {
    const from = { from: "no-reply@geraiexpress.com", fromName: "GeraiExpress" };
    expect(() => buildMessage(from, { ...mail, to: "a@b.test\r\nBcc: x@y.test" })).toThrow(SmtpError);
    expect(() => buildMessage(from, { ...mail, subject: "Hi\r\nBcc: x@y.test" })).toThrow(SmtpError);
    expect(() => buildMessage({ ...from, fromName: "X\nY" }, mail)).toThrow(SmtpError);
  });

  it("encodes a non-ASCII subject and keeps every line within 998 characters", () => {
    const msg = buildMessage({ from: "no-reply@geraiexpress.com", fromName: "GeraiExpress" },
      { ...mail, subject: "Kode masuk — GeraiExpress", text: "x".repeat(5000) }, new Date(0), "fixed-id");
    expect(msg).toContain("Subject: =?UTF-8?B?");
    expect(msg).toContain("Message-ID: <fixed-id@geraiexpress.com>");
    expect(Math.max(...msg.split("\r\n").map((l) => l.length))).toBeLessThanOrEqual(998);
  });
});
