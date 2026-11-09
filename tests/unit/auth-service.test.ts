import { randomUUID, scrypt } from "node:crypto";
import type * as NodeCrypto from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sha256Hex } from "../../src/lib/auth/crypto";
import { hashOtp } from "../../src/lib/auth/otp";
import { hashPassword } from "../../src/lib/auth/password";
import { createAuth, type Auth, type AuthConfig, type SessionTokens } from "../../src/lib/auth/service";
import { AuthUnavailableError, type AuthStore, type AuthStoreReply } from "../../src/lib/auth/store";
import { totpCodeAt, unsealTotpSecret } from "../../src/lib/auth/totp";

// Count the real scrypt work: a refused CAPTCHA must not cost any.
vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof NodeCrypto>();
  return { ...actual, scrypt: vi.fn(actual.scrypt) };
});

const JWT_SECRET = "j".repeat(40);
const AUTH_SECRET = "a".repeat(40);
const CAPTCHA_SECRET = "turnstile-secret";
const NOW_MS = 1_800_000_000_000;
const OPEN = "disabled" as const;

type Call = { fn: string; args: Record<string, unknown> };
type User = { id: string; email: string | null; anonymous: boolean; password: string; confirmed: boolean };
type Session = { id: string; userId: string; refresh: string; previous: string | null; aal: "aal1" | "aal2"; aal2At: string | null };
type Factor = { id: string; userId: string; sealed: string; lastStep: number | null };

// An in-memory stand-in for the auth_* RPCs: same observable statuses, none of the SQL. `script`
// replaces the answer of one function (any status or error) for edge cases the happy path cannot reach.
function createFakeStore() {
  const calls: Call[] = [];
  const users: User[] = [];
  const sessions: Session[] = [];
  const factors: Factor[] = [];
  const codes = new Map<string, string>();
  const script = new Map<string, AuthStoreReply | "throw">();

  const identity = (user: User, session: Session) => ({
    user_id: user.id,
    email: user.email,
    is_anonymous: user.anonymous,
    has_password: user.password !== "",
    session_id: session.id,
    aal: session.aal,
    aal2_at: session.aal2At,
    absolute_expires_at: "2026-11-05T00:00:00.000Z",
  });
  const open = (user: User, refresh: string): Session => {
    const session: Session = { id: randomUUID(), userId: user.id, refresh, previous: null, aal: "aal1", aal2At: null };
    sessions.push(session);
    return session;
  };
  const ok = (user: User, session: Session, extra: Record<string, unknown> = {}) => ({ status: "ok", ...identity(user, session), ...extra });
  const userById = (id: unknown) => users.find((u) => u.id === id);
  const sessionById = (id: unknown) => sessions.find((s) => s.id === id);

  const handlers: Record<string, (a: Record<string, unknown>) => unknown> = {
    auth_issue_otp: (a) => {
      codes.set(String(a.p_email), String(a.p_code_hash));
      return { status: "sent", email: a.p_email };
    },
    auth_verify_otp: (a) => {
      const email = String(a.p_email);
      if (!codes.has(email) || codes.get(email) !== a.p_code_hash) return { status: "invalid" };
      codes.delete(email);
      let user = users.find((u) => u.email === email);
      if (!user) users.push((user = { id: randomUUID(), email, anonymous: false, password: "", confirmed: true }));
      user.confirmed = true;
      return ok(user, open(user, String(a.p_refresh_hash)));
    },
    auth_password_credential: (a) => {
      const user = users.find((u) => u.email === a.p_email && u.confirmed && u.password !== "");
      return user ? { user_id: user.id, encrypted_password: user.password } : null;
    },
    auth_create_session: (a) => {
      const user = userById(a.p_user);
      return user ? ok(user, open(user, String(a.p_refresh_hash))) : { status: "invalid" };
    },
    auth_sign_in_anonymous: (a) => {
      const user: User = { id: randomUUID(), email: null, anonymous: true, password: "", confirmed: false };
      users.push(user);
      return ok(user, open(user, String(a.p_refresh_hash)));
    },
    auth_refresh_session: (a) => {
      const current = sessions.find((s) => s.refresh === a.p_refresh_hash);
      const previous = sessions.find((s) => s.previous === a.p_refresh_hash);
      const session = current ?? previous;
      const user = session && userById(session.userId);
      if (!session || !user) return { status: "invalid" };
      if (current) {
        session.previous = session.refresh;
        session.refresh = String(a.p_new_refresh_hash);
      }
      return { ...ok(user, session), status: current ? "ok" : "recent_reuse" };
    },
    auth_session_live: (a) => {
      const session = sessionById(a.p_session);
      const user = session && userById(session.userId);
      return session && user ? { live: true, ...identity(user, session) } : { live: false };
    },
    auth_revoke_session: (a) => {
      sessions.splice(0, sessions.length, ...sessions.filter((s) => s.id !== a.p_session));
      return null;
    },
    auth_revoke_user_sessions: (a) => {
      sessions.splice(0, sessions.length, ...sessions.filter((s) => s.userId !== a.p_user || s.id === a.p_except));
      return null;
    },
    auth_set_password: (a) => {
      const user = userById(a.p_user);
      if (!user) return { status: "invalid" };
      user.password = String(a.p_hash);
      sessions.splice(0, sessions.length, ...sessions.filter((s) => s.userId !== user.id || s.id === a.p_keep_session));
      return { status: "ok" };
    },
    auth_mfa_enroll: (a) => {
      const factor: Factor = { id: randomUUID(), userId: String(a.p_user), sealed: String(a.p_secret_sealed), lastStep: null };
      factors.splice(0, factors.length, ...factors.filter((f) => f.userId !== factor.userId), factor);
      return { status: "ok", factor_id: factor.id };
    },
    auth_mfa_factor: (a) => {
      const factor = factors.find((f) => f.userId === a.p_user);
      return factor ? { factor_id: factor.id, status: "unverified", secret_sealed: factor.sealed, last_used_step: factor.lastStep } : null;
    },
    auth_mfa_verify: (a) => {
      const factor = factors.find((f) => f.id === a.p_factor);
      const session = sessionById(a.p_session);
      const user = session && userById(session.userId);
      if (!factor || !session || !user) return { status: "invalid" };
      if (factor.lastStep !== null && factor.lastStep >= Number(a.p_step)) return { status: "replay" };
      factor.lastStep = Number(a.p_step);
      Object.assign(session, { aal: "aal2", aal2At: "2027-01-15T08:00:00.000Z", previous: null, refresh: String(a.p_new_refresh_hash) });
      return ok(user, session);
    },
  };

  const store: AuthStore = {
    async rpc(fn, args = {}) {
      calls.push({ fn, args: structuredClone(args) });
      const scripted = script.get(fn);
      if (scripted === "throw") throw new Error(`socket closed ${JSON.stringify(args)}`);
      if (scripted) return scripted;
      const handler = handlers[fn];
      if (!handler) return { data: null, error: { message: `unknown function ${fn}` } };
      return { data: handler(args), error: null };
    },
  };
  return { store, calls, users, sessions, factors, codes, script };
}

type Fake = ReturnType<typeof createFakeStore>;

function setup(over: Partial<Pick<AuthConfig, "captcha" | "now">> = {}) {
  const fake = createFakeStore();
  const auth = createAuth({ store: fake.store, jwtSecret: JWT_SECRET, authSecret: AUTH_SECRET, captcha: OPEN, now: () => NOW_MS, ...over });
  return { fake, auth };
}

const CAPTCHA_HOST = "app.geraiexpress.com";
// A siteverify double that answers for the action the widget was rendered with (the request carries none:
// Cloudflare reads it from the token, so the double is told which action its tokens were solved for).
const turnstile = (success: boolean, action?: string) =>
  vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ success, action, hostname: CAPTCHA_HOST }), { status: 200 }));
const captchaWith = (fetchImpl: typeof fetch) => ({ secret: CAPTCHA_SECRET, hostnames: [CAPTCHA_HOST], fetchImpl });
const scryptCalls = () => vi.mocked(scrypt).mock.calls.length;
const fn = (fake: Fake, name: string) => fake.calls.filter((c) => c.fn === name);
const leaves = (value: unknown): string[] =>
  typeof value === "string" ? [value] : value && typeof value === "object" ? Object.values(value).flatMap(leaves) : [];

async function signUpByCode(auth: Auth, email: string): Promise<SessionTokens> {
  const sent = await auth.requestEmailCode({ email, captchaToken: undefined });
  if (sent.status !== "sent") throw new Error("code not sent");
  const verified = await auth.verifyEmailCode({ email, code: sent.code, captchaToken: undefined });
  if (!verified.ok) throw new Error("code refused");
  return verified.session;
}

let PASSWORD_HASH: string;
beforeAll(async () => {
  PASSWORD_HASH = await hashPassword("correct horse battery");
});
beforeEach(() => {
  vi.mocked(scrypt).mockClear();
});

describe("createAuth configuration", () => {
  it("refuses short secrets without echoing them", () => {
    const { store } = createFakeStore();
    expect(() => createAuth({ store, jwtSecret: "short-jwt-secret", authSecret: AUTH_SECRET, captcha: OPEN })).toThrow(/AUTH_JWT_SECRET/);
    let message = "";
    try {
      createAuth({ store, jwtSecret: JWT_SECRET, authSecret: "short-auth-secret", captcha: OPEN });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/AUTH_SECRET/);
    expect(message).not.toContain("short-auth-secret");
  });

  it("refuses identical jwt and auth secrets", () => {
    const { store } = createFakeStore();
    expect(() => createAuth({ store, jwtSecret: JWT_SECRET, authSecret: JWT_SECRET, captcha: OPEN })).toThrow(/different/);
  });

  it("treats a missing captcha setting as a configuration error, never as disabled", () => {
    const { store } = createFakeStore();
    const base = { store, jwtSecret: JWT_SECRET, authSecret: AUTH_SECRET };
    expect(() => createAuth(base as never)).toThrow(/captcha/);
    expect(() => createAuth({ ...base, captcha: { secret: "", hostnames: [CAPTCHA_HOST] } })).toThrow(/captcha/);
    expect(() => createAuth({ ...base, captcha: "off" as never })).toThrow(/captcha/);
    expect(() => createAuth({ ...base, captcha: OPEN })).not.toThrow();
  });

  it("refuses a Turnstile secret without at least one allowed hostname", () => {
    const { store } = createFakeStore();
    const base = { store, jwtSecret: JWT_SECRET, authSecret: AUTH_SECRET };
    for (const hostnames of [[], [""], ["  "]]) {
      expect(() => createAuth({ ...base, captcha: { secret: CAPTCHA_SECRET, hostnames } }), JSON.stringify(hostnames)).toThrow(/hostnames/);
    }
    expect(() => createAuth({ ...base, captcha: { secret: CAPTCHA_SECRET } as never })).toThrow(/hostnames/);
    expect(() => createAuth({ ...base, captcha: { secret: CAPTCHA_SECRET, hostnames: [CAPTCHA_HOST] } })).not.toThrow();
  });
});

describe("CAPTCHA first", () => {
  const entryPoints = (auth: Auth, token: string | undefined) => ({
    requestEmailCode: () => auth.requestEmailCode({ email: "x@example.com", captchaToken: token }),
    verifyEmailCode: () => auth.verifyEmailCode({ email: "x@example.com", code: "123456", captchaToken: token }),
    signInWithPassword: () => auth.signInWithPassword({ email: "x@example.com", password: "correct horse battery", captchaToken: token }),
    signInAnonymous: () => auth.signInAnonymous({ captchaToken: token }),
  });

  it("a failed or missing Turnstile token touches no store call and no scrypt", async () => {
    for (const token of [undefined, "", "tok-bad"]) {
      const fetchImpl = turnstile(false);
      const { fake, auth } = setup({ captcha: captchaWith(fetchImpl) });
      for (const [name, run] of Object.entries(entryPoints(auth, token))) {
        expect(await run(), name).toEqual(name === "requestEmailCode" ? { status: "captcha_failed" } : { ok: false, reason: "captcha_failed" });
      }
      expect(fake.calls).toEqual([]);
      expect(scryptCalls()).toBe(0);
    }
  });

  it("fails closed when Cloudflare is unreachable or answers with an error status", async () => {
    for (const fetchImpl of [
      vi.fn<typeof fetch>(async () => {
        throw new Error("network down");
      }),
      vi.fn<typeof fetch>(async () => new Response("{}", { status: 500 })),
      vi.fn<typeof fetch>(async () => new Response("not json", { status: 200 })),
    ]) {
      const { fake, auth } = setup({ captcha: captchaWith(fetchImpl) });
      expect(await auth.signInAnonymous({ captchaToken: "tok" })).toEqual({ ok: false, reason: "captcha_failed" });
      expect(fake.calls).toEqual([]);
    }
  });

  it("an empty token never reaches Cloudflare; a good token proceeds, with the client address forwarded", async () => {
    const fetchImpl = turnstile(true, "demo");
    const { fake, auth } = setup({ captcha: captchaWith(fetchImpl) });
    expect(await auth.signInAnonymous({ captchaToken: "" })).toEqual({ ok: false, reason: "captcha_failed" });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect((await auth.signInAnonymous({ captchaToken: "tok-ok", remoteIp: "203.0.113.7" })).ok).toBe(true);
    const form = new URLSearchParams(String(fetchImpl.mock.calls[0][1]?.body));
    expect(form.get("secret")).toBe(CAPTCHA_SECRET);
    expect(form.get("remoteip")).toBe("203.0.113.7");
    expect(fn(fake, "auth_sign_in_anonymous")).toHaveLength(1);
  });

  it("refuses a solved token minted for another surface's action, touching no store call", async () => {
    // A token solved on the demo button cannot sign in with a password, and vice versa.
    const demoToken = setup({ captcha: captchaWith(turnstile(true, "demo")) });
    expect(await demoToken.auth.signInWithPassword({ email: "x@example.com", password: "correct horse battery", captchaToken: "tok" })).toEqual({ ok: false, reason: "captcha_failed" });
    expect(await demoToken.auth.requestEmailCode({ email: "x@example.com", captchaToken: "tok" })).toEqual({ status: "captcha_failed" });
    expect(await demoToken.auth.verifyEmailCode({ email: "x@example.com", code: "123456", captchaToken: "tok" })).toEqual({ ok: false, reason: "captcha_failed" });
    expect(demoToken.fake.calls).toEqual([]);
    expect(scryptCalls()).toBe(0);
    const signinToken = setup({ captcha: captchaWith(turnstile(true, "signin")) });
    expect(await signinToken.auth.signInAnonymous({ captchaToken: "tok" })).toEqual({ ok: false, reason: "captcha_failed" });
    expect(signinToken.fake.calls).toEqual([]);
  });

  it('"disabled" lets calls through without a token, and only when configured explicitly', async () => {
    const { fake, auth } = setup();
    expect((await auth.signInAnonymous({ captchaToken: undefined })).ok).toBe(true);
    expect(fn(fake, "auth_sign_in_anonymous")).toHaveLength(1);
  });
});

describe("only hashes and sealed text reach the store", () => {
  it("no recorded rpc argument holds a plaintext code, password, refresh token or TOTP secret", async () => {
    const { fake, auth } = setup();
    const email = "Owner@Example.com";
    const sent = await auth.requestEmailCode({ email, captchaToken: undefined, requesterId: randomUUID() });
    if (sent.status !== "sent") throw new Error("not sent");
    const first = await auth.verifyEmailCode({ email, code: sent.code, captchaToken: undefined, userAgent: "Mozilla/5.0 Test" });
    if (!first.ok) throw new Error("not verified");
    const { session } = first;

    const password = "a plaintext password 123";
    expect(await auth.setPassword({ userId: session.userId, sessionId: session.sessionId, password })).toEqual({ ok: true });
    const passwordLogin = await auth.signInWithPassword({ email, password, captchaToken: undefined });
    if (!passwordLogin.ok) throw new Error("password refused");
    const refreshed = await auth.refresh(passwordLogin.session.refreshToken!);
    if (!refreshed.ok) throw new Error("refresh refused");
    const enrolled = await auth.enrollTotp({ userId: session.userId, email });
    if (!enrolled.ok) throw new Error("enroll refused");
    const step = Math.floor(NOW_MS / 1000 / 30);
    const totpCode = totpCodeAt(enrolled.secret, step);
    const upgraded = await auth.verifyTotp({ userId: session.userId, sessionId: session.sessionId, code: totpCode });
    if (!upgraded.ok) throw new Error("totp refused");

    const sentTokens = [session, passwordLogin.session, refreshed.session, upgraded.session].map((s) => s.refreshToken!);
    const everything = fake.calls.flatMap((c) => leaves(c.args));
    for (const secret of [password, enrolled.secret, ...sentTokens]) {
      expect(everything.filter((value) => value.includes(secret))).toEqual([]);
    }
    // A six digit code is a substring of plenty of hex: compare whole values.
    expect(everything).not.toContain(sent.code);
    expect(everything).not.toContain(totpCode);
    expect(fn(fake, "auth_issue_otp")[0].args.p_code_hash).toBe(hashOtp(AUTH_SECRET, "owner@example.com", "login", sent.code));
    expect(fn(fake, "auth_verify_otp")[0].args).toMatchObject({
      p_refresh_hash: sha256Hex(session.refreshToken!),
      p_user_agent_hash: sha256Hex("Mozilla/5.0 Test"),
    });
    expect(fn(fake, "auth_set_password")[0].args.p_hash).toMatch(/^scrypt\$32768\$8\$1\$/);
    expect(fn(fake, "auth_mfa_verify")[0].args.p_new_refresh_hash).toBe(sha256Hex(upgraded.session.refreshToken!));
  });

  it("seals the TOTP secret with the user id as associated data", async () => {
    const { fake, auth } = setup();
    const session = await signUpByCode(auth, "seal@example.com");
    const enrolled = await auth.enrollTotp({ userId: session.userId, email: "seal@example.com" });
    if (!enrolled.ok) throw new Error("enroll refused");
    expect(enrolled.otpauthUri).toContain(`secret=${enrolled.secret}`);
    const sealed = String(fn(fake, "auth_mfa_enroll")[0].args.p_secret_sealed);
    expect(sealed).toMatch(/^v1\./);
    expect(sealed).not.toContain(enrolled.secret);
    await expect(unsealTotpSecret(AUTH_SECRET, session.userId, sealed)).resolves.toBe(enrolled.secret);
    await expect(unsealTotpSecret(AUTH_SECRET, randomUUID(), sealed)).rejects.toThrow();
  });
});

describe("requestEmailCode", () => {
  it("returns the plaintext code only to the caller, normalizing the email", async () => {
    const { fake, auth } = setup();
    const requester = randomUUID();
    const result = await auth.requestEmailCode({ email: "  Mixed.Case@Example.COM ", captchaToken: undefined, requesterId: requester });
    expect(result).toEqual({ status: "sent", email: "mixed.case@example.com", code: expect.stringMatching(/^\d{6}$/) });
    expect(fn(fake, "auth_issue_otp")[0].args).toEqual({
      p_email: "mixed.case@example.com",
      p_code_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
      p_requester: requester,
    });
  });

  it.each(["blocked", "throttled", "too_soon", "refused", "invalid"])("%s is withheld, indistinguishable from the others", async (status) => {
    const { fake, auth } = setup();
    fake.script.set("auth_issue_otp", { data: { status, message: "Pendaftaran ditutup" }, error: null });
    expect(await auth.requestEmailCode({ email: "x@example.com", captchaToken: undefined })).toEqual({ status: "withheld" });
  });

  it("an unreadable status is an outage, not a silent success", async () => {
    const { fake, auth } = setup();
    fake.script.set("auth_issue_otp", { data: { status: "surprise" }, error: null });
    await expect(auth.requestEmailCode({ email: "x@example.com", captchaToken: undefined })).rejects.toBeInstanceOf(AuthUnavailableError);
  });

  it("a malformed email or requester is withheld without a store call", async () => {
    const { fake, auth } = setup();
    expect(await auth.requestEmailCode({ email: "   ", captchaToken: undefined })).toEqual({ status: "withheld" });
    expect(await auth.requestEmailCode({ email: "x@example.com", captchaToken: undefined, requesterId: "nope" })).toEqual({ status: "withheld" });
    expect(fake.calls).toEqual([]);
  });
});

describe("verifyEmailCode", () => {
  it("rejects anything but six digits without a store call", async () => {
    const { fake, auth } = setup();
    for (const code of ["", "12345", "1234567", "12345a", " 123456", "١٢٣٤٥٦"]) {
      expect(await auth.verifyEmailCode({ email: "x@example.com", code, captchaToken: undefined })).toEqual({ ok: false, reason: "invalid" });
    }
    expect(fake.calls).toEqual([]);
  });

  it("a wrong code and an unknown email answer the same", async () => {
    const { fake, auth } = setup();
    const sent = await auth.requestEmailCode({ email: "known@example.com", captchaToken: undefined });
    if (sent.status !== "sent") throw new Error("not sent");
    const wrong = sent.code === "000000" ? "000001" : "000000";
    const known = await auth.verifyEmailCode({ email: "known@example.com", code: wrong, captchaToken: undefined });
    const unknown = await auth.verifyEmailCode({ email: "nobody@example.com", code: wrong, captchaToken: undefined });
    expect(known).toEqual({ ok: false, reason: "invalid" });
    expect(unknown).toEqual(known);
    expect(fake.users).toHaveLength(0);
  });

  it("asks SQL for 7 days by default and 12 hours for the platform audience", async () => {
    const { fake, auth } = setup();
    await signUpByCode(auth, "tenant@example.com");
    const sent = await auth.requestEmailCode({ email: "admin@example.com", captchaToken: undefined });
    if (sent.status !== "sent") throw new Error("not sent");
    await auth.verifyEmailCode({ email: "admin@example.com", code: sent.code, captchaToken: undefined, audience: "platform" });
    const [tenant, platform] = fn(fake, "auth_verify_otp");
    expect(tenant.args).toMatchObject({ p_absolute_seconds: 604800, p_idle_seconds: 604800 });
    expect(platform.args).toMatchObject({ p_absolute_seconds: 43200, p_idle_seconds: 43200 });
  });
});

describe("signInWithPassword", () => {
  const known = (fake: Fake, over: Partial<User> = {}) => {
    const user: User = { id: randomUUID(), email: "known@example.com", anonymous: false, password: PASSWORD_HASH, confirmed: true, ...over };
    fake.users.push(user);
    return user;
  };

  it("unknown email, wrong password and a password-less account are identical and each costs one scrypt", async () => {
    const { fake, auth } = setup();
    known(fake);
    known(fake, { email: "nopass@example.com", password: "" });
    const attempts = [
      { email: "ghost@example.com", password: "correct horse battery" },
      { email: "known@example.com", password: "wrong horse battery" },
      { email: "nopass@example.com", password: "correct horse battery" },
      { email: "KNOWN@example.com", password: "" },
    ];
    for (const attempt of attempts) {
      vi.mocked(scrypt).mockClear();
      expect(await auth.signInWithPassword({ ...attempt, captchaToken: undefined })).toEqual({ ok: false, reason: "invalid_credentials" });
      expect(scryptCalls(), attempt.email).toBe(1);
    }
    expect(fn(fake, "auth_create_session")).toEqual([]);
  });

  it("opens a session for the right password", async () => {
    const { fake, auth } = setup();
    const user = known(fake);
    const result = await auth.signInWithPassword({ email: " Known@Example.com", password: "correct horse battery", captchaToken: undefined, userAgent: "UA/1" });
    if (!result.ok) throw new Error("refused");
    expect(result.session).toMatchObject({ userId: user.id, email: "known@example.com", isAnonymous: false, hasPassword: true, aal: "aal1" });
    const [call] = fn(fake, "auth_create_session");
    expect(call.args).toMatchObject({ p_user: user.id, p_refresh_hash: sha256Hex(result.session.refreshToken!), p_user_agent_hash: sha256Hex("UA/1") });
  });

  it("applies the platform session lifetime when the sign-in is for the platform audience", async () => {
    const { fake, auth } = setup();
    known(fake);
    await auth.signInWithPassword({ email: "known@example.com", password: "correct horse battery", captchaToken: undefined, audience: "platform" });
    const [call] = fn(fake, "auth_create_session");
    expect(call.args).toMatchObject({ p_absolute_seconds: 43200, p_idle_seconds: 43200 });
  });

  it("a session refused by SQL after a correct password is still just invalid credentials", async () => {
    const { fake, auth } = setup();
    known(fake);
    fake.script.set("auth_create_session", { data: { status: "invalid" }, error: null });
    expect(await auth.signInWithPassword({ email: "known@example.com", password: "correct horse battery", captchaToken: undefined })).toEqual({
      ok: false,
      reason: "invalid_credentials",
    });
  });
});

describe("setPassword", () => {
  it("weak passwords stop before hashing or the store", async () => {
    const { fake, auth } = setup();
    expect(await auth.setPassword({ userId: randomUUID(), sessionId: randomUUID(), password: "short" })).toEqual({ ok: false, reason: "weak_password" });
    expect(await auth.setPassword({ userId: randomUUID(), sessionId: randomUUID(), password: "x".repeat(257) })).toEqual({ ok: false, reason: "weak_password" });
    expect(fake.calls).toEqual([]);
    expect(scryptCalls()).toBe(0);
  });

  it("keeps the calling session, ends the others and maps a refused identity to invalid", async () => {
    const { fake, auth } = setup();
    const a = await signUpByCode(auth, "pw@example.com");
    const b = await signUpByCode(auth, "pw@example.com");
    expect(await auth.setPassword({ userId: a.userId, sessionId: a.sessionId, password: "brand new password" })).toEqual({ ok: true });
    expect(fn(fake, "auth_set_password")[0].args.p_keep_session).toBe(a.sessionId);
    expect(await auth.sessionLive(a.sessionId)).toMatchObject({ live: true, hasPassword: true });
    expect(await auth.sessionLive(b.sessionId)).toEqual({ live: false });
    expect(await auth.setPassword({ userId: randomUUID(), sessionId: a.sessionId, password: "brand new password" })).toEqual({ ok: false, reason: "invalid" });
  });
});

describe("refresh", () => {
  it("rotates the token and the old one answers recent_reuse with no new token", async () => {
    const { auth } = setup();
    const session = await signUpByCode(auth, "rot@example.com");
    const first = await auth.refresh(session.refreshToken!);
    if (!first.ok) throw new Error("refused");
    expect(first.session.refreshToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(first.session.refreshToken).not.toBe(session.refreshToken);
    expect(first.session.sessionId).toBe(session.sessionId);
    const parallel = await auth.refresh(session.refreshToken!);
    if (!parallel.ok) throw new Error("refused");
    expect(parallel.session.refreshToken).toBeNull();
    expect(parallel.session.accessToken).toEqual(expect.any(String));
  });

  it("maps invalid and reuse_detected, and an unknown status is an outage", async () => {
    const { fake, auth } = setup();
    const token = "A".repeat(43);
    expect(await auth.refresh(token)).toEqual({ ok: false, reason: "invalid" });
    fake.script.set("auth_refresh_session", { data: { status: "reuse_detected" }, error: null });
    expect(await auth.refresh(token)).toEqual({ ok: false, reason: "reuse_detected" });
    fake.script.set("auth_refresh_session", { data: { status: "???" }, error: null });
    await expect(auth.refresh(token)).rejects.toBeInstanceOf(AuthUnavailableError);
  });

  it("a malformed token is invalid without a store call", async () => {
    const { fake, auth } = setup();
    for (const token of ["", "short", "A".repeat(42), "A".repeat(44), `${"A".repeat(42)}=`, `${"A".repeat(42)}+`, undefined as unknown as string]) {
      expect(await auth.refresh(token)).toEqual({ ok: false, reason: "invalid" });
    }
    expect(fake.calls).toEqual([]);
  });
});

describe("access token claims", () => {
  async function claimsOf(auth: Auth, session: SessionTokens) {
    const verified = await auth.verifyAccessToken(session.accessToken);
    if (!verified.ok) throw new Error(`token refused: ${verified.reason}`);
    return verified.claims;
  }

  it("code sign-in: authenticated role, otp method, ten minute lifetime", async () => {
    const { auth } = setup();
    const session = await signUpByCode(auth, "claims@example.com");
    expect(await claimsOf(auth, session)).toEqual({
      role: "authenticated",
      aud: "authenticated",
      sub: session.userId,
      session_id: session.sessionId,
      email: "claims@example.com",
      is_anonymous: false,
      aal: "aal1",
      amr: [{ method: "otp", timestamp: NOW_MS / 1000 }],
      iat: NOW_MS / 1000,
      exp: NOW_MS / 1000 + 600,
    });
    expect(session.accessExpiresAt).toBe(NOW_MS / 1000 + 600);
    expect(session.absoluteExpiresAt).toBe("2026-11-05T00:00:00.000Z");
  });

  it("anonymous sign-in has an empty email and the anonymous method", async () => {
    const { auth } = setup();
    const result = await auth.signInAnonymous({ captchaToken: undefined });
    if (!result.ok) throw new Error("refused");
    expect(result.session).toMatchObject({ email: null, isAnonymous: true, hasPassword: false, aal: "aal1" });
    expect(await claimsOf(auth, result.session)).toMatchObject({ email: "", is_anonymous: true, amr: [{ method: "anonymous" }] });
  });

  it("password sign-in uses the password method", async () => {
    const { fake, auth } = setup();
    fake.users.push({ id: randomUUID(), email: "pw@example.com", anonymous: false, password: PASSWORD_HASH, confirmed: true });
    const result = await auth.signInWithPassword({ email: "pw@example.com", password: "correct horse battery", captchaToken: undefined });
    if (!result.ok) throw new Error("refused");
    expect(await claimsOf(auth, result.session)).toMatchObject({ amr: [{ method: "password" }], aal: "aal1" });
  });

  it("TOTP verification upgrades to aal2 with a new refresh token, and refresh keeps mirroring it", async () => {
    const { auth } = setup();
    const session = await signUpByCode(auth, "mfa@example.com");
    const enrolled = await auth.enrollTotp({ userId: session.userId, email: "mfa@example.com" });
    if (!enrolled.ok) throw new Error("enroll refused");
    const code = totpCodeAt(enrolled.secret, Math.floor(NOW_MS / 30000));
    const result = await auth.verifyTotp({ userId: session.userId, sessionId: session.sessionId, code, factorId: enrolled.factorId });
    if (!result.ok) throw new Error("totp refused");
    expect(result.session).toMatchObject({ aal: "aal2", sessionId: session.sessionId });
    expect(result.session.refreshToken).not.toBe(session.refreshToken);
    expect(await claimsOf(auth, result.session)).toMatchObject({ aal: "aal2", amr: [{ method: "totp", timestamp: NOW_MS / 1000 }] });
    // The pre-upgrade refresh token died with the upgrade.
    expect(await auth.refresh(session.refreshToken!)).toEqual({ ok: false, reason: "invalid" });
    const refreshed = await auth.refresh(result.session.refreshToken!);
    if (!refreshed.ok) throw new Error("refresh refused");
    expect(await claimsOf(auth, refreshed.session)).toMatchObject({
      aal: "aal2",
      amr: [{ method: "totp", timestamp: Date.parse("2027-01-15T08:00:00.000Z") / 1000 }],
    });
  });
});

describe("verifyTotp", () => {
  async function enrolled(auth: Auth) {
    const session = await signUpByCode(auth, `totp-${randomUUID()}@example.com`);
    const factor = await auth.enrollTotp({ userId: session.userId, email: "x@example.com" });
    if (!factor.ok) throw new Error("enroll refused");
    return { session, secret: factor.secret };
  }

  it("a wrong code never calls auth_mfa_verify", async () => {
    const { fake, auth } = setup();
    const { session, secret } = await enrolled(auth);
    const step = Math.floor(NOW_MS / 30000);
    const outside = totpCodeAt(secret, step + 10);
    for (const code of [outside, "12345", "abcdef", ""]) {
      expect(await auth.verifyTotp({ userId: session.userId, sessionId: session.sessionId, code })).toEqual({ ok: false, reason: "invalid" });
    }
    expect(fn(fake, "auth_mfa_verify")).toEqual([]);
  });

  it("an accepted code cannot be used twice", async () => {
    const { auth } = setup();
    const { session, secret } = await enrolled(auth);
    const code = totpCodeAt(secret, Math.floor(NOW_MS / 30000));
    expect((await auth.verifyTotp({ userId: session.userId, sessionId: session.sessionId, code })).ok).toBe(true);
    expect(await auth.verifyTotp({ userId: session.userId, sessionId: session.sessionId, code })).toEqual({ ok: false, reason: "replay" });
  });

  it("a user without a factor gets no_factor, and an unreadable sealed secret is an outage", async () => {
    const { fake, auth } = setup();
    const session = await signUpByCode(auth, "nofactor@example.com");
    expect(await auth.verifyTotp({ userId: session.userId, sessionId: session.sessionId, code: "123456" })).toEqual({ ok: false, reason: "no_factor" });
    expect(await auth.verifyTotp({ userId: session.userId, sessionId: session.sessionId, code: "123456", factorId: "nope" })).toEqual({ ok: false, reason: "no_factor" });
    fake.script.set("auth_mfa_factor", { data: { factor_id: randomUUID(), status: "verified", secret_sealed: "v1.garbage.garbage", last_used_step: null }, error: null });
    await expect(auth.verifyTotp({ userId: session.userId, sessionId: session.sessionId, code: "123456" })).rejects.toBeInstanceOf(AuthUnavailableError);
  });

  it("enrollment maps already_verified and invalid", async () => {
    const { fake, auth } = setup();
    const user = randomUUID();
    fake.script.set("auth_mfa_enroll", { data: { status: "already_verified" }, error: null });
    expect(await auth.enrollTotp({ userId: user, email: "x@example.com" })).toEqual({ ok: false, reason: "already_verified" });
    fake.script.set("auth_mfa_enroll", { data: { status: "invalid" }, error: null });
    expect(await auth.enrollTotp({ userId: user, email: "x@example.com" })).toEqual({ ok: false, reason: "invalid" });
    expect(await auth.enrollTotp({ userId: "not-a-uuid", email: "x@example.com" })).toEqual({ ok: false, reason: "invalid" });
  });
});

describe("sessions", () => {
  it("sessionLive reports identity for a live session and nothing else for the rest", async () => {
    const { auth } = setup();
    const session = await signUpByCode(auth, "live@example.com");
    expect(await auth.sessionLive(session.sessionId)).toEqual({
      live: true,
      userId: session.userId,
      email: "live@example.com",
      isAnonymous: false,
      hasPassword: false,
      sessionId: session.sessionId,
      aal: "aal1",
      aal2At: null,
      absoluteExpiresAt: "2026-11-05T00:00:00.000Z",
    });
    expect(await auth.sessionLive(randomUUID())).toEqual({ live: false });
    expect(await auth.sessionLive("not-a-uuid")).toEqual({ live: false });
  });

  it("revokeSession and revokeUserSessions end sessions", async () => {
    const { auth } = setup();
    const a = await signUpByCode(auth, "rev@example.com");
    const b = await signUpByCode(auth, "rev@example.com");
    const c = await signUpByCode(auth, "rev@example.com");
    await auth.revokeSession(a.sessionId);
    expect(await auth.sessionLive(a.sessionId)).toEqual({ live: false });
    await auth.revokeUserSessions(b.userId, c.sessionId);
    expect(await auth.sessionLive(b.sessionId)).toEqual({ live: false });
    expect(await auth.sessionLive(c.sessionId)).toMatchObject({ live: true });
    await auth.revokeUserSessions(c.userId);
    expect(await auth.sessionLive(c.sessionId)).toEqual({ live: false });
  });
});

describe("store failures", () => {
  const calls: [string, (auth: Auth) => Promise<unknown>][] = [
    ["auth_issue_otp", (auth) => auth.requestEmailCode({ email: "victim@example.com", captchaToken: undefined })],
    ["auth_verify_otp", (auth) => auth.verifyEmailCode({ email: "victim@example.com", code: "123456", captchaToken: undefined })],
    ["auth_sign_in_anonymous", (auth) => auth.signInAnonymous({ captchaToken: undefined })],
    ["auth_refresh_session", (auth) => auth.refresh("B".repeat(43))],
    ["auth_session_live", (auth) => auth.sessionLive(randomUUID())],
    ["auth_revoke_session", (auth) => auth.revokeSession(randomUUID())],
  ];

  it.each(calls)("%s: an rpc error becomes AuthUnavailableError without arguments or store text", async (name, run) => {
    const { fake, auth } = setup();
    fake.script.set(name, { data: null, error: { message: 'invalid input for "victim@example.com" hash deadbeef', code: "22P02" } });
    const error = await run(auth).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AuthUnavailableError);
    const message = (error as Error).message;
    expect(message).toContain(name);
    for (const leaked of ["victim", "deadbeef", "123456", "22P02", "invalid input"]) expect(message).not.toContain(leaked);
  });

  it.each(calls)("%s: a thrown transport failure is wrapped the same way", async (name, run) => {
    const { fake, auth } = setup();
    fake.script.set(name, "throw");
    const error = await run(auth).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AuthUnavailableError);
    expect((error as Error).message).not.toContain("socket");
    expect((error as Error).message).not.toContain("victim");
  });

  it("malformed data is an outage too", async () => {
    const { fake, auth } = setup();
    fake.script.set("auth_sign_in_anonymous", { data: { status: "ok", user_id: "nope" }, error: null });
    await expect(auth.signInAnonymous({ captchaToken: undefined })).rejects.toBeInstanceOf(AuthUnavailableError);
    fake.script.set("auth_sign_in_anonymous", { data: "ok", error: null });
    await expect(auth.signInAnonymous({ captchaToken: undefined })).rejects.toBeInstanceOf(AuthUnavailableError);
    fake.script.set("auth_session_live", { data: { live: true }, error: null });
    await expect(auth.sessionLive(randomUUID())).rejects.toBeInstanceOf(AuthUnavailableError);
  });
});

describe("tokens", () => {
  it("verifies its own access tokens, honoring allowExpired, and rejects foreign ones", async () => {
    let now = NOW_MS;
    const { auth } = setup({ now: () => now });
    const session = await signUpByCode(auth, "exp@example.com");
    expect((await auth.verifyAccessToken(session.accessToken)).ok).toBe(true);
    now += 700_000;
    expect(await auth.verifyAccessToken(session.accessToken)).toEqual({ ok: false, reason: "expired" });
    expect((await auth.verifyAccessToken(session.accessToken, { allowExpired: true })).ok).toBe(true);
    const other = createAuth({ store: createFakeStore().store, jwtSecret: "k".repeat(40), authSecret: AUTH_SECRET, captcha: OPEN, now: () => NOW_MS });
    expect(await other.verifyAccessToken(session.accessToken, { allowExpired: true })).toEqual({ ok: false, reason: "signature" });
  });

  it("mints the static anon and service_role keys", async () => {
    const { auth } = setup();
    const keys = await auth.staticKeys();
    const anon = await auth.verifyAccessToken(keys.anon);
    const service = await auth.verifyAccessToken(keys.service);
    expect(anon).toMatchObject({ ok: true, claims: { role: "anon", aud: "authenticated" } });
    expect(service).toMatchObject({ ok: true, claims: { role: "service_role" } });
    if (anon.ok) expect(anon.claims.sub).toBeUndefined();
  });
});
