import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type * as LimiterModule from "../../src/lib/limiter";
import type { LimiterName } from "../../src/lib/limiter";
import { signInAction } from "../../src/lib/auth-actions";
import { AuthUnavailableError } from "../../src/lib/auth/store";
import { requestCodeAction, verifyCodeAction } from "../../src/lib/registration-actions";

// Security review M1: the account budget must not be burnable by a stranger without a solved
// CAPTCHA, while one account is still bounded when guessed from many visitors. Real rate-limit
// module and real keys; only the limiter budgets (the real limits would make "ten attempts from one
// visitor" untestable for OTP_LIMITER, 3/min), request headers and the auth service are fakes.
let requestHeaders = new Headers();
const bindings: Record<string, unknown> = {};
const session = { sessionId: "11111111-1111-4111-8111-111111111111", accessToken: "access", refreshToken: "refresh" };
const auth = { signInWithPassword: vi.fn(), requestEmailCode: vi.fn(), verifyEmailCode: vi.fn(), revokeSession: vi.fn(async () => {}) };
const writeSessionCookies = vi.fn(async () => {});
const deliver = vi.fn(async () => {});
const jars = new Map<string, Map<string, string>>();
const cookieJar = () => {
  const key = requestHeaders.get("x-real-ip") ?? "";
  if (!jars.has(key)) jars.set(key, new Map());
  return jars.get(key)!;
};
vi.mock("server-only", () => ({}));
vi.mock("@/lib/limiter", async () => {
  const actual = await vi.importActual<typeof LimiterModule>("../../src/lib/limiter");
  return { ...actual, limiterFor: (name: LimiterName) => bindings[name] ?? actual.limiterFor(name) };
});
vi.mock("next/headers", () => ({ headers: async () => requestHeaders, cookies: async () => ({ delete: vi.fn(), set: (name: string, value: string) => { cookieJar().set(name, value); }, get: (name: string) => ({ value: cookieJar().get(name) }), getAll: () => [] }) }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`); } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/visitor-key", () => vi.importActual("../../src/lib/visitor-key"));
vi.mock("@/lib/auth-errors", () => vi.importActual("../../src/lib/auth-errors"));
vi.mock("@/lib/auth/store", () => vi.importActual("../../src/lib/auth/store"));
vi.mock("@/lib/auth-mail", () => vi.importActual("../../src/lib/auth-mail"));
vi.mock("@/lib/errors", () => vi.importActual("../../src/lib/errors"));
vi.mock("@/lib/db/cookies", () => vi.importActual("../../src/lib/db/cookies"));
vi.mock("@/lib/db/client", () => vi.importActual("../../src/lib/db/client"));
vi.mock("@/lib/client-address", () => vi.importActual("../../src/lib/client-address"));
vi.mock("@/lib/request-context", () => vi.importActual("../../src/lib/request-context"));
vi.mock("@/lib/workspace", () => ({ TENANT_COOKIE: "ge_tenant" }));
vi.mock("@/lib/auth", () => ({ MIN_PASSWORD_LENGTH: 10, MAX_PASSWORD_LENGTH: 256 }));
vi.mock("@/lib/auth/crypto", () => vi.importActual("../../src/lib/auth/crypto"));
vi.mock("@/lib/config", () => ({ config: () => "test-secret-at-least-thirty-two-bytes-long" }));
vi.mock("@/lib/hosts", () => ({ requestScope: async () => "shared" }));
vi.mock("@/lib/auth/instance", () => ({ getAuth: () => auth, postgrestUrl: () => "http://postgrest.test" }));
vi.mock("@/lib/db/server", () => ({
  currentUser: async () => null,
  dbServer: async () => ({ rpc: vi.fn(async () => ({ data: true, error: null })) }),
}));
vi.mock("@/lib/db/session", () => ({
  writeSessionCookies: (...args: unknown[]) => (writeSessionCookies as (...a: unknown[]) => Promise<void>)(...args),
  clearSessionCookies: vi.fn(),
  sessionAudience: async () => "tenant",
}));
vi.mock("@/lib/mail-transport", () => ({ deliver: (...args: unknown[]) => (deliver as (...a: unknown[]) => Promise<void>)(...args), mailTransportReady: () => true }));
vi.mock("@/lib/rate-limit", () => vi.importActual("../../src/lib/rate-limit"));

type Budget = { limit: Mock<(options: { key: string }) => Promise<{ success: boolean }>> };

function budget(limit: number): Budget {
  const counts = new Map<string, number>();
  return {
    limit: vi.fn(async ({ key }: { key: string }) => {
      const count = (counts.get(key) ?? 0) + 1;
      counts.set(key, count);
      return { success: count <= limit };
    }),
  };
}

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

const email = "victim@example.test";
const visitor = (n: number) => { requestHeaders.set("x-real-ip", `203.0.113.${n}`); };
const signIn = (token: string, password = "right-password") =>
  signInAction({}, form({ email, password, "cf-turnstile-response": token }));

beforeEach(() => {
  for (const key of Object.keys(bindings)) delete bindings[key];
  jars.clear();
  requestHeaders = new Headers({ host: "app.geraiexpress.com" });
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("TRUSTED_PROXY", "1");
  vi.spyOn(console, "warn").mockImplementation(() => {});
  Object.assign(bindings, {
    SIGN_IN_LIMITER: budget(100), SIGN_IN_ACCOUNT_LIMITER: budget(10),
    OTP_LIMITER: budget(100), OTP_ACCOUNT_LIMITER: budget(10),
    SIGN_IN_ACCOUNT_VISITOR_LIMITER: budget(5), OTP_ACCOUNT_VISITOR_LIMITER: budget(5),
  });
  for (const fn of [auth.signInWithPassword, auth.requestEmailCode, auth.verifyEmailCode, auth.revokeSession, writeSessionCookies, deliver]) fn.mockReset();
  // The service checks the CAPTCHA first, then the credentials.
  auth.signInWithPassword.mockImplementation(async ({ password, captchaToken }: { password: string; captchaToken: string }) => {
    if (captchaToken !== "valid") return { ok: false, reason: "captcha_failed" };
    return password === "right-password" ? { ok: true, session } : { ok: false, reason: "invalid_credentials" };
  });
  auth.requestEmailCode.mockImplementation(async ({ email: to, captchaToken }: { email: string; captchaToken: string }) =>
    captchaToken === "valid" ? { status: "sent", email: to, code: "424242" } : { status: "captcha_failed" });
  auth.verifyEmailCode.mockImplementation(async ({ code, captchaToken }: { code: string; captchaToken: string }) => {
    if (captchaToken !== "valid") return { ok: false, reason: "captcha_failed" };
    return code === "123456" ? { ok: true, session } : { ok: false, reason: "invalid" };
  });
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("password sign-in budget (M1)", () => {
  it("ten CAPTCHA-less attempts for an email from one visitor do not stop the owner signing in from another", async () => {
    visitor(1);
    for (let i = 0; i < 10; i++) {
      expect((await signIn("invalid")).error).toMatch(i < 5 ? /^Verifikasi keamanan gagal/ : /^Terlalu banyak percobaan/);
    }
    visitor(2);
    await expect(signIn("valid")).rejects.toThrow("redirect:/");
    expect(auth.revokeSession).not.toHaveBeenCalled();
    expect(writeSessionCookies).toHaveBeenCalledExactlyOnceWith(session);
  });

  it("a single account hammered from one visitor is still limited before the service is asked", async () => {
    visitor(1);
    for (let i = 0; i < 5; i++) expect((await signIn("valid", "wrong")).error).toBe("Email atau kata sandi tidak cocok.");
    expect((await signIn("valid", "wrong")).error).toMatch(/^Terlalu banyak percobaan/);
    expect(auth.signInWithPassword).toHaveBeenCalledTimes(5);
    visitor(2);
    await expect(signIn("valid")).rejects.toThrow("redirect:/");
  });

  it("a guesser spread over many visitors is bounded: past the budget even the right password is revoked and gets no cookie", async () => {
    for (let i = 1; i <= 10; i++) {
      visitor(i);
      expect((await signIn("valid", "wrong")).error).toBe("Email atau kata sandi tidak cocok.");
    }
    visitor(11);
    const reply = await signIn("valid");
    expect(reply.error).toMatch(/^Terlalu banyak percobaan/);
    expect(auth.revokeSession).toHaveBeenCalledExactlyOnceWith(session.sessionId);
    expect(writeSessionCookies).not.toHaveBeenCalled();
  });

  it("does not spend the account-wide budget on CAPTCHA failures or a store outage", async () => {
    const account = bindings.SIGN_IN_ACCOUNT_LIMITER as Budget;
    visitor(1);
    await signIn("invalid");
    vi.spyOn(console, "error").mockImplementation(() => {});
    auth.signInWithPassword.mockRejectedValueOnce(new AuthUnavailableError("auth_password_credential"));
    expect((await signIn("valid")).error).toMatch(/^Layanan masuk sedang sibuk/);
    const keys = account.limit.mock.calls.map(([arg]) => arg.key);
    expect(keys).toHaveLength(0);
  });

  it("passes the CAPTCHA token, the trusted proxy address and the user agent to the service, never a submitted address", async () => {
    visitor(5);
    requestHeaders.set("user-agent", "UA/1");
    requestHeaders.set("x-forwarded-for", "192.0.2.9");
    await expect(signInAction({}, form({ email, password: "right-password", "cf-turnstile-response": "valid", remote_ip: "192.0.2.77" }))).rejects.toThrow("redirect:/");
    expect(auth.signInWithPassword).toHaveBeenCalledExactlyOnceWith({
      email, password: "right-password", captchaToken: "valid", remoteIp: "203.0.113.5", userAgent: "UA/1", audience: "tenant",
    });
  });
});

describe("email code budgets (M1)", () => {
  beforeEach(async () => {
    // Each browser must request its own address binding before it can spend verification attempts.
    for (let i = 1; i <= 11; i++) {
      visitor(i);
      await requestCodeAction({}, form({ email, "cf-turnstile-response": "valid" }));
    }
    deliver.mockClear();
    bindings.OTP_ACCOUNT_VISITOR_LIMITER = budget(5);
  });
  it("ten CAPTCHA-less code requests from one visitor do not stop another visitor's request", async () => {
    visitor(1);
    for (let i = 0; i < 10; i++) {
      const reply = await requestCodeAction({}, form({ email, "cf-turnstile-response": "invalid" }));
      if (i < 5) expect(reply.error).toMatch(/^Verifikasi keamanan gagal/);
      else expect(reply).toMatchObject({ step: "code", email });
    }
    visitor(2);
    expect(await requestCodeAction({}, form({ email, "cf-turnstile-response": "valid" }))).toMatchObject({ step: "code", email });
    expect(deliver).toHaveBeenCalledOnce();
  });

  it("wrong code guesses from one visitor do not stop another visitor's correct code until the account-wide budget is spent", async () => {
    visitor(1);
    for (let i = 0; i < 5; i++) {
      expect((await verifyCodeAction({ step: "code", email }, form({ code: "000000", "cf-turnstile-response": "valid" }))).error).toMatch(/^Kode tidak cocok/);
    }
    visitor(2);
    await expect(verifyCodeAction({ step: "code", email }, form({ code: "123456", "cf-turnstile-response": "valid" }))).rejects.toThrow("redirect:/");
    expect(writeSessionCookies).toHaveBeenCalledExactlyOnceWith(session);
  });

  it("bounds code guessing spread over many visitors and revokes a correct code past the budget", async () => {
    for (let i = 1; i <= 10; i++) {
      visitor(i);
      await verifyCodeAction({ step: "code", email }, form({ code: "000000", "cf-turnstile-response": "valid" }));
    }
    visitor(11);
    const reply = await verifyCodeAction({ step: "code", email }, form({ code: "123456", "cf-turnstile-response": "valid" }));
    expect(reply.error).toMatch(/^Terlalu banyak percobaan/);
    expect(auth.revokeSession).toHaveBeenCalledExactlyOnceWith(session.sessionId);
    expect(writeSessionCookies).not.toHaveBeenCalled();
  });

  it("does not spend the address-wide budget on a failed CAPTCHA", async () => {
    visitor(1);
    for (let i = 0; i < 20; i++) {
      const reply = await verifyCodeAction({ step: "code", email }, form({ code: "000000", "cf-turnstile-response": "" }));
      // Only this visitor's pair budget (5) can refuse, never the account-wide one.
      expect(reply.error).toMatch(i < 5 ? /^Verifikasi keamanan gagal/ : /^Terlalu banyak percobaan/);
    }
    visitor(2);
    await expect(verifyCodeAction({ step: "code", email }, form({ code: "123456", "cf-turnstile-response": "valid" }))).rejects.toThrow("redirect:/");
  });

  it("refuses a browser with no requested-address binding", async () => {
    visitor(99);
    const reply = await verifyCodeAction({ step: "code", email }, form({ code: "123456" }));
    expect(reply.error).toMatch(/^Kode tidak cocok/);
    expect(auth.verifyEmailCode).not.toHaveBeenCalled();
  });
});
