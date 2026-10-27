// DEC-009: the Worker's Send Email Hook, called directly the way Supabase Auth calls it.
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test } from "./fixtures";
import { mailCode } from "./helpers";

const secret: string = readFileSync("supabase/.env", "utf8").match(/^GE_SEND_EMAIL_HOOK_SECRET[=](.+)$/m)![1];

function signed(body: string) {
  const id = `msg_${Date.now()}`;
  const ts = String(Math.floor(Date.now() / 1000));
  const key = Buffer.from(secret.replace(/^v1,whsec_/, ""), "base64");
  return { "content-type": "application/json", "webhook-id": id, "webhook-timestamp": ts,
    "webhook-signature": `v1,${createHmac("sha256", key).update(`${id}.${ts}.${body}`).digest("base64")}` };
}

test.describe.configure({ mode: "serial" });

test("unsigned or tampered calls are refused", async ({ request }) => {
  const body = JSON.stringify({ user: { id: "u", email: "x@geraiexpress.test" }, email_data: { email_action_type: "signup", token: "123456" } });
  expect((await request.post("/api/auth/send-email", { data: body, headers: { "content-type": "application/json" } })).status()).toBe(401);
  const headers = signed(body);
  expect((await request.post("/api/auth/send-email", { data: body.replace("123456", "654321"), headers })).status()).toBe(401);
});

test("anonymous identities never get mail; real sign-up codes are delivered", async ({ request }) => {
  const anonTo = `hook-anon-${Date.now()}@geraiexpress.test`;
  const anon = JSON.stringify({ user: { id: "a", is_anonymous: true, new_email: anonTo }, email_data: { email_action_type: "email_change", token: "111111", token_new: "222222" } });
  const refused = await request.post("/api/auth/send-email", { data: anon, headers: signed(anon) });
  // Decisions are 200 + error object (what Auth reads); see route.ts.
  expect(refused.status()).toBe(200);
  expect((await refused.json()).error.http_code).toBe(403);
  // Defence in depth: without the anonymous flag, an email change with no current address is refused too.
  const noFlag = JSON.stringify({ user: { id: "a", new_email: anonTo }, email_data: { email_action_type: "email_change", token: "111111", token_new: "222222" } });
  expect((await (await request.post("/api/auth/send-email", { data: noFlag, headers: signed(noFlag) })).json()).error.http_code).toBe(403);

  const to = `hook-real-${Date.now()}@geraiexpress.test`;
  const real = JSON.stringify({ user: { id: "r", email: to }, email_data: { email_action_type: "signup", token: "424242" } });
  const sent = await request.post("/api/auth/send-email", { data: real, headers: signed(real) });
  expect(sent.status()).toBe(200);
  expect(await mailCode(to)).toBe("424242");
});
