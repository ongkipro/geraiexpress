import { createHmac, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decideMail, verifyHookSignature } from "../../src/lib/auth-mail";

const rawKey = randomBytes(32);
const secret = `v1,whsec_${rawKey.toString("base64")}`;
const now = 1_800_000_000;

function sign(body: string, id = "msg_1", ts = String(now), key = rawKey) {
  return { id, timestamp: ts, signature: `v1,${createHmac("sha256", key).update(`${id}.${ts}.${body}`).digest("base64")}` };
}

describe("Send Email Hook signature (DEC-009)", () => {
  const body = JSON.stringify({ user: { id: "u" }, email_data: { email_action_type: "signup" } });

  it("accepts a valid Standard Webhooks signature, including among several", async () => {
    expect(await verifyHookSignature(body, sign(body), secret, now)).toBe(true);
    const h = sign(body);
    expect(await verifyHookSignature(body, { ...h, signature: `v1,AAAA ${h.signature}` }, secret, now)).toBe(true);
  });

  it("refuses tampering, wrong key, stale timestamps and missing headers", async () => {
    expect(await verifyHookSignature(body + " ", sign(body), secret, now)).toBe(false);
    expect(await verifyHookSignature(body, sign(body, "msg_1", String(now), randomBytes(32)), secret, now)).toBe(false);
    expect(await verifyHookSignature(body, sign(body, "msg_1", String(now - 301)), secret, now)).toBe(false);
    expect(await verifyHookSignature(body, { ...sign(body), signature: null }, secret, now)).toBe(false);
    expect(await verifyHookSignature(body, sign(body), "v1,whsec_%%%", now)).toBe(false);
  });
});

describe("mail policy (DEC-009, T-016 residual)", () => {
  it("never mails for an anonymous identity, whatever the action", () => {
    for (const action of ["email_change", "signup", "magiclink", "recovery"]) {
      expect(decideMail({ user: { id: "a", is_anonymous: true, email: "x@y.test", new_email: "z@y.test" }, email_data: { email_action_type: action, token: "123456", token_new: "654321" } }))
        .toEqual({ refuse: "anonymous_identity" });
    }
  });

  it("renders one Indonesian code mail for sign-up and sign-in codes", () => {
    const d = decideMail({ user: { id: "u", email: "a@b.test" }, email_data: { email_action_type: "signup", token: "123456" } });
    expect("messages" in d && d.messages).toEqual([expect.objectContaining({ to: "a@b.test", subject: "Kode verifikasi GeraiExpress" })]);
    expect("messages" in d && d.messages[0].text).toContain("123456");
  });

  it("mails both addresses for a real user's email change, and refuses unknown actions", () => {
    const d = decideMail({ user: { id: "u", email: "old@b.test", new_email: "new@b.test" }, email_data: { email_action_type: "email_change", token: "111111", token_new: "222222" } });
    expect("messages" in d && d.messages.map((m) => m.to)).toEqual(["old@b.test", "new@b.test"]);
    expect(decideMail({ user: { id: "u", email: "a@b.test" }, email_data: { email_action_type: "invite", token: "123456" } })).toEqual({ refuse: "unsupported_action" });
    expect(decideMail({ user: { id: "u", new_email: "z@b.test" }, email_data: { email_action_type: "email_change", token: "111111", token_new: "222222" } })).toEqual({ refuse: "malformed" });
    expect(decideMail(null as never)).toEqual({ refuse: "malformed" });
    expect(decideMail({ user: { id: "u", email: "a@b.test" }, email_data: { email_action_type: "signup", token: "12ab" } })).toEqual({ refuse: "malformed" });
  });
});
