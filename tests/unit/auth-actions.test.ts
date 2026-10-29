import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chooseTenantAction, resetDemoAction, signInAction, signOutAction, startDemoAction } from "../../src/lib/auth-actions";
import { AuthUnavailableError } from "../../src/lib/auth/store";

// The Server Actions on the application-owned auth service (T-066). The service, the cookie jar, the
// data client and the rate-limit budgets are fakes; the action's own decisions are what is under test.
const SESSION = { sessionId: "11111111-1111-4111-8111-111111111111", accessToken: "minted-access", refreshToken: "minted-refresh" };
const auth = {
  signInWithPassword: vi.fn(), signInAnonymous: vi.fn(), revokeSession: vi.fn(), verifyAccessToken: vi.fn(),
};
const jar = new Map<string, string>();
const store = {
  get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
  set: vi.fn((name: string, value: string) => { jar.set(name, value); }),
  delete: vi.fn((name: string) => { jar.delete(name); }),
};
const rpc = vi.fn();
const from = vi.fn();
const dataClient = vi.fn((_url: string, _bearer: string) => ({ rpc }));
const writeSessionCookies = vi.fn();
const clearSessionCookies = vi.fn();
const currentUser = vi.fn();
const limits = { visitor: true, pair: true, account: true, demo: true };

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-real-ip": "203.0.113.9", "user-agent": "UA/1" }), cookies: async () => store }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`); } }));
vi.mock("@/lib/auth-errors", () => vi.importActual("../../src/lib/auth-errors"));
vi.mock("@/lib/auth/store", () => vi.importActual("../../src/lib/auth/store"));
vi.mock("@/lib/errors", () => vi.importActual("../../src/lib/errors"));
vi.mock("@/lib/db/cookies", () => vi.importActual("../../src/lib/db/cookies"));
vi.mock("@/lib/client-address", () => vi.importActual("../../src/lib/client-address"));
vi.mock("@/lib/request-context", () => vi.importActual("../../src/lib/request-context"));
vi.mock("@/lib/workspace", () => ({ TENANT_COOKIE: "ge_tenant" }));
vi.mock("@/lib/auth/instance", () => ({ getAuth: () => auth, postgrestUrl: () => "http://postgrest.test" }));
vi.mock("@/lib/db/client", () => ({ dataClient: (url: string, bearer: string) => dataClient(url, bearer) }));
vi.mock("@/lib/db/server", () => ({
  currentUser: () => currentUser(),
  dbServer: async () => ({ rpc, from }),
}));
vi.mock("@/lib/db/session", () => ({
  writeSessionCookies: (session: unknown) => writeSessionCookies(session),
  clearSessionCookies: () => clearSessionCookies(),
  sessionAudience: async () => "platform",
}));
vi.mock("@/lib/rate-limit", () => ({
  withinLimit: async (action: string) => (action === "DEMO_LIMITER" ? limits.demo : limits.visitor),
  withinAccountVisitorLimit: async () => limits.pair,
  withinAccountLimit: async () => limits.account,
}));

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

beforeEach(() => {
  jar.clear();
  for (const fn of [...Object.values(auth), store.set, store.delete, rpc, from, dataClient, writeSessionCookies, clearSessionCookies, currentUser]) fn.mockReset();
  Object.assign(limits, { visitor: true, pair: true, account: true, demo: true });
  currentUser.mockResolvedValue(null);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("signInAction", () => {
  const credentials = { email: "owner@example.test", password: "right-password", "cf-turnstile-response": "captcha-token" };

  it("asks for both fields before anything else", async () => {
    expect(await signInAction({}, form({ email: "owner@example.test" }))).toEqual({ error: "Isi email dan kata sandi.", email: "owner@example.test" });
    expect(auth.signInWithPassword).not.toHaveBeenCalled();
  });

  it("sets the session cookies, forgets the previous gerai selector and goes to the dashboard", async () => {
    auth.signInWithPassword.mockResolvedValue({ ok: true, session: SESSION });
    await expect(signInAction({}, form(credentials))).rejects.toThrow("redirect:/");
    expect(writeSessionCookies).toHaveBeenCalledExactlyOnceWith(SESSION);
    expect(store.delete).toHaveBeenCalledWith("ge_tenant");
    // The session lifetime follows the audience of the page being served.
    expect(auth.signInWithPassword).toHaveBeenCalledWith(expect.objectContaining({ audience: "platform", captchaToken: "captcha-token", remoteIp: undefined, userAgent: "UA/1" }));
  });

  it("answers one generic message for wrong credentials and a separate one for a failed CAPTCHA", async () => {
    auth.signInWithPassword.mockResolvedValue({ ok: false, reason: "invalid_credentials" });
    expect((await signInAction({}, form(credentials))).error).toBe("Email atau kata sandi tidak cocok.");
    auth.signInWithPassword.mockResolvedValue({ ok: false, reason: "captcha_failed" });
    expect((await signInAction({}, form(credentials))).error).toMatch(/^Verifikasi keamanan gagal/);
    expect(writeSessionCookies).not.toHaveBeenCalled();
  });

  it("refuses a throttled visitor before the service is asked", async () => {
    limits.visitor = false;
    expect((await signInAction({}, form(credentials))).error).toMatch(/^Terlalu banyak percobaan/);
    limits.visitor = true;
    limits.pair = false;
    expect((await signInAction({}, form(credentials))).error).toMatch(/^Terlalu banyak percobaan/);
    expect(auth.signInWithPassword).not.toHaveBeenCalled();
  });

  it("revokes a correct sign-in once the account-wide budget is spent, setting no cookie", async () => {
    limits.account = false;
    auth.signInWithPassword.mockResolvedValue({ ok: true, session: SESSION });
    expect((await signInAction({}, form(credentials))).error).toMatch(/^Terlalu banyak percobaan/);
    expect(auth.revokeSession).toHaveBeenCalledExactlyOnceWith(SESSION.sessionId);
    expect(writeSessionCookies).not.toHaveBeenCalled();
    expect(store.delete).not.toHaveBeenCalled();
  });

  it("over-budget right and wrong passwords have identical bodies and no cookie writes", async () => {
    limits.account = false;
    auth.signInWithPassword.mockResolvedValueOnce({ ok: true, session: SESSION });
    const right = await signInAction({}, form(credentials));
    auth.signInWithPassword.mockResolvedValueOnce({ ok: false, reason: "invalid_credentials" });
    const wrong = await signInAction({}, form({ ...credentials, password: "wrong-password" }));
    expect(right).toEqual(wrong);
    expect(auth.revokeSession).toHaveBeenCalledExactlyOnceWith(SESSION.sessionId);
    expect(writeSessionCookies).not.toHaveBeenCalled();
    expect(store.set).not.toHaveBeenCalled();
    expect(store.delete).not.toHaveBeenCalled();
  });

  it("answers the throttle even when revoking the unused session fails", async () => {
    limits.account = false;
    auth.signInWithPassword.mockResolvedValue({ ok: true, session: SESSION });
    auth.revokeSession.mockRejectedValue(new AuthUnavailableError("auth_revoke_session"));
    expect((await signInAction({}, form(credentials))).error).toMatch(/^Terlalu banyak percobaan/);
    expect(writeSessionCookies).not.toHaveBeenCalled();
  });

  it("says the service is busy when the store is down, without spending the account budget", async () => {
    auth.signInWithPassword.mockRejectedValue(new AuthUnavailableError("auth_password_credential"));
    limits.account = false;
    expect((await signInAction({}, form(credentials))).error).toMatch(/^Layanan masuk sedang sibuk/);
  });

  it("does not swallow an unexpected failure", async () => {
    auth.signInWithPassword.mockRejectedValue(new Error("boom"));
    await expect(signInAction({}, form(credentials))).rejects.toThrow("boom");
  });
});

describe("startDemoAction", () => {
  it("never ends a real account's session", async () => {
    currentUser.mockResolvedValue({ id: "u", email: "real@example.test", isAnonymous: false });
    expect((await startDemoAction({}, new FormData())).error).toMatch(/^Anda sedang masuk dengan akun gerai/);
    expect(auth.signInAnonymous).not.toHaveBeenCalled();
    expect(writeSessionCookies).not.toHaveBeenCalled();
  });

  it("starts the demo with the fresh session's own access token, because its cookie is not readable yet", async () => {
    auth.signInAnonymous.mockResolvedValue({ ok: true, session: SESSION });
    rpc.mockResolvedValue({ data: "tenant-1", error: null });
    // UX-16: the demo lands on the Dashboard at "/".
    await expect(startDemoAction({}, form({ "cf-turnstile-response": "captcha-token" }))).rejects.toThrow(/^redirect:\/$/);
    expect(auth.signInAnonymous).toHaveBeenCalledWith(expect.objectContaining({ captchaToken: "captcha-token", userAgent: "UA/1" }));
    expect(writeSessionCookies).toHaveBeenCalledExactlyOnceWith(SESSION);
    expect(dataClient).toHaveBeenCalledExactlyOnceWith("http://postgrest.test", "minted-access");
    expect(rpc).toHaveBeenCalledWith("start_demo");
    expect(jar.get("ge_tenant")).toBe("tenant-1");
  });

  it("reuses an existing demo session instead of minting another", async () => {
    currentUser.mockResolvedValue({ id: "u", email: null, isAnonymous: true });
    rpc.mockResolvedValue({ data: "tenant-2", error: null });
    await expect(startDemoAction({}, new FormData())).rejects.toThrow(/^redirect:\/$/);
    expect(auth.signInAnonymous).not.toHaveBeenCalled();
    expect(dataClient).not.toHaveBeenCalled();
  });

  it("keeps the CAPTCHA, throttle and outage answers apart", async () => {
    auth.signInAnonymous.mockResolvedValue({ ok: false, reason: "captcha_failed" });
    expect((await startDemoAction({}, new FormData())).error).toMatch(/^Verifikasi keamanan gagal/);
    auth.signInAnonymous.mockResolvedValue({ ok: false, reason: "invalid_credentials" });
    expect((await startDemoAction({}, new FormData())).error).toMatch(/^Demo belum bisa dibuka/);
    auth.signInAnonymous.mockRejectedValue(new AuthUnavailableError("auth_sign_in_anonymous"));
    expect((await startDemoAction({}, new FormData())).error).toMatch(/^Layanan masuk sedang sibuk/);
    currentUser.mockRejectedValue(new AuthUnavailableError("auth_session_live"));
    expect((await startDemoAction({}, new FormData())).error).toMatch(/^Layanan masuk sedang sibuk/);
    limits.demo = false;
    expect((await startDemoAction({}, new FormData())).error).toMatch(/^Terlalu banyak percobaan/);
    expect(writeSessionCookies).not.toHaveBeenCalled();
  });

  it("reports a database refusal in friendly words and sets no gerai selector", async () => {
    auth.signInAnonymous.mockResolvedValue({ ok: true, session: SESSION });
    rpc.mockResolvedValue({ data: null, error: { message: "boom", code: "P0001" } });
    expect((await startDemoAction({}, new FormData())).error).toEqual(expect.any(String));
    expect(jar.has("ge_tenant")).toBe(false);
  });
});

describe("signOutAction", () => {
  const live = { ok: true, claims: { role: "authenticated", sub: "u", session_id: SESSION.sessionId } };

  it("verifies the access cookie even when it is expired, revokes that session and clears everything", async () => {
    jar.set("gx_at", "stale.token.value");
    auth.verifyAccessToken.mockResolvedValue(live);
    await expect(signOutAction()).rejects.toThrow("redirect:/masuk");
    expect(auth.verifyAccessToken).toHaveBeenCalledExactlyOnceWith("stale.token.value", { allowExpired: true });
    expect(auth.revokeSession).toHaveBeenCalledExactlyOnceWith(SESSION.sessionId);
    expect(clearSessionCookies).toHaveBeenCalledOnce();
    expect(store.delete).toHaveBeenCalledWith("ge_tenant");
  });

  it("revokes nothing for a forged token or an anon/service token, but still clears the cookies", async () => {
    jar.set("gx_at", "forged");
    auth.verifyAccessToken.mockResolvedValue({ ok: false, reason: "signature" });
    await expect(signOutAction()).rejects.toThrow("redirect:/masuk");
    auth.verifyAccessToken.mockResolvedValue({ ok: true, claims: { role: "service_role" } });
    await expect(signOutAction()).rejects.toThrow("redirect:/masuk");
    expect(auth.revokeSession).not.toHaveBeenCalled();
    expect(clearSessionCookies).toHaveBeenCalledTimes(2);
  });

  it("works without any cookie", async () => {
    await expect(signOutAction()).rejects.toThrow("redirect:/masuk");
    expect(auth.verifyAccessToken).not.toHaveBeenCalled();
    expect(clearSessionCookies).toHaveBeenCalledOnce();
  });

  it("clears the cookies even when the store cannot revoke", async () => {
    jar.set("gx_at", "token");
    auth.verifyAccessToken.mockResolvedValue(live);
    auth.revokeSession.mockRejectedValue(new AuthUnavailableError("auth_revoke_session"));
    await expect(signOutAction()).rejects.toThrow("redirect:/masuk");
    expect(clearSessionCookies).toHaveBeenCalledOnce();
  });
});

describe("chooseTenantAction", () => {
  function memberships(rows: { tenant_id: string }[]) {
    const query: Record<string, unknown> = {};
    const eq = vi.fn(() => query);
    Object.assign(query, { eq, then: (resolve: (value: unknown) => void) => resolve({ data: rows }) });
    from.mockReturnValue({ select: () => query });
    return eq;
  }

  it("stores the selector only for the caller's own active membership", async () => {
    currentUser.mockResolvedValue({ id: "user-1" });
    const eq = memberships([{ tenant_id: "t-1" }]);
    // UX-16: switching gerai lands on the Dashboard at "/".
    await expect(chooseTenantAction(form({ tenant: "t-1" }))).rejects.toThrow(/^redirect:\/$/);
    expect(eq).toHaveBeenCalledWith("user_id", "user-1");
    expect(jar.get("ge_tenant")).toBe("t-1");
  });

  it("rejects a gerai without a membership or when the auth store is unavailable", async () => {
    currentUser.mockResolvedValue({ id: "user-1" });
    memberships([]);
    await expect(chooseTenantAction(form({ tenant: "t-9" }))).rejects.toThrow("redirect:/pilih-gerai?galat=1");
    expect(jar.has("ge_tenant")).toBe(false);

    currentUser.mockRejectedValueOnce(new AuthUnavailableError("auth_session_live"));
    await expect(chooseTenantAction(form({ tenant: "t-1" }))).rejects.toThrow("redirect:/pilih-gerai?galat=1");
    expect(jar.has("ge_tenant")).toBe(false);
  });
});

describe("resetDemoAction", () => {
  it("resets through the request-scoped client and returns to the list", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await expect(resetDemoAction()).rejects.toThrow("redirect:/pengiriman?reset=1");
    expect(rpc).toHaveBeenCalledWith("reset_demo");
  });
});
