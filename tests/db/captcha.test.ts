// T-016 / SEC-5 / ADR-0002 section 3.2: password sign-in, anonymous (demo) entry, emailed-code request and
// emailed-code verification all need a solved Turnstile challenge. A refused challenge means the auth
// service touches nothing: no RPC, no user, no code, no session.
import { describe, expect, it, vi } from "vitest";
import { createAuth, type AuthStore } from "../../src/lib/auth";
import { machine, passwordUser, sql } from "./helpers";

const SECRET = "turnstile-test-secret";

const siteverify = (success: boolean) =>
  vi.fn<typeof fetch>(async () => new Response(JSON.stringify(success ? { success } : { success, "error-codes": ["invalid-input-response"] }), { status: 200 }));

// The machine client behind a recorder: every store call of the service shows up in `calls`.
function recordingStore() {
  const inner = machine();
  const calls: string[] = [];
  const store: AuthStore = {
    rpc(fn, args) {
      calls.push(fn);
      return inner.rpc(fn, args);
    },
  };
  return { store, calls };
}

const footprint = () => sql("select (select count(*) from auth.users) || '|' || (select count(*) from auth.sessions) || '|' || (select count(*) from auth.otp_codes)");

function service(store: AuthStore, fetchImpl: typeof fetch) {
  return createAuth({
    store,
    jwtSecret: process.env.AUTH_JWT_SECRET!,
    authSecret: process.env.AUTH_SECRET!,
    captcha: { secret: SECRET, fetchImpl },
  });
}

describe("captcha on every auth entry point", () => {
  it("refuses each entry point without a valid token and calls nothing", async () => {
    const owner = await passwordUser("captcha-owner");
    const email = `captcha-${Date.now()}@geraiexpress.test`;
    const { store, calls } = recordingStore();
    const fetchImpl = siteverify(false);
    const auth = service(store, fetchImpl);
    const before = footprint();

    for (const token of [undefined, "", "not-a-solved-challenge"]) {
      expect(await auth.signInWithPassword({ email: owner.email, password: owner.password, captchaToken: token })).toEqual({ ok: false, reason: "captcha_failed" });
      expect(await auth.signInAnonymous({ captchaToken: token })).toEqual({ ok: false, reason: "captcha_failed" });
      expect(await auth.requestEmailCode({ email, captchaToken: token })).toEqual({ status: "captcha_failed" });
      expect(await auth.verifyEmailCode({ email, code: "123456", captchaToken: token })).toEqual({ ok: false, reason: "captcha_failed" });
    }
    expect(calls).toEqual([]);
    expect(footprint()).toBe(before);
    expect(sql(`select count(*) from auth.users where email = '${email}'`)).toBe("0");
    // Only a non-empty token ever reaches Cloudflare: 4 entry points x 1 token.
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it("fails closed while the challenge verification itself is down", async () => {
    const { store, calls } = recordingStore();
    const down = vi.fn<typeof fetch>(async () => {
      throw new Error("siteverify unreachable");
    });
    const auth = service(store, down);
    expect(await auth.signInAnonymous({ captchaToken: "token" })).toEqual({ ok: false, reason: "captcha_failed" });
    expect(await auth.requestEmailCode({ email: "down@geraiexpress.test", captchaToken: "token" })).toEqual({ status: "captcha_failed" });
    expect(calls).toEqual([]);
  });

  it("accepts the same entry points once the challenge is solved", async () => {
    const owner = await passwordUser("captcha-ok");
    const email = `captcha-ok-${Date.now()}@geraiexpress.test`;
    const { store } = recordingStore();
    const fetchImpl = siteverify(true);
    const auth = service(store, fetchImpl);

    const password = await auth.signInWithPassword({ email: owner.email, password: owner.password, captchaToken: "solved-1", remoteIp: "203.0.113.5" });
    expect(password).toMatchObject({ ok: true, session: { userId: owner.id, aal: "aal1" } });
    const anonymous = await auth.signInAnonymous({ captchaToken: "solved-2" });
    expect(anonymous).toMatchObject({ ok: true, session: { isAnonymous: true } });
    const sent = await auth.requestEmailCode({ email, captchaToken: "solved-3" });
    if (sent.status !== "sent") throw new Error(`code not sent: ${sent.status}`);
    expect(await auth.verifyEmailCode({ email, code: sent.code, captchaToken: "solved-4" })).toMatchObject({ ok: true, session: { email } });

    const form = new URLSearchParams(String(fetchImpl.mock.calls[0][1]?.body));
    expect(form.get("secret")).toBe(SECRET);
    expect(form.get("response")).toBe("solved-1");
    expect(form.get("remoteip")).toBe("203.0.113.5");
  });
});
