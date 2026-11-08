import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { changeEmailAction, requestCodeAction, reviewApplicationAction, setRegistrationAction, setPasswordAction, verifyCodeAction, withdrawApplicationAction } from "../../src/lib/registration-actions";
import { AuthUnavailableError } from "../../src/lib/auth/store";

// The code flow on the auth service (PR-29 / DEC-007): generic replies that never reveal whether an
// address has an account, mail from the one renderer, and the session cookie only after a verified code.
const SESSION = { sessionId: "11111111-1111-4111-8111-111111111111", accessToken: "a", refreshToken: "r" };
const USER_ID = "22222222-2222-4222-8222-222222222222";
const auth = { requestEmailCode: vi.fn(), verifyEmailCode: vi.fn(), revokeSession: vi.fn(), setPassword: vi.fn() };
const rpc = vi.fn();
const deliver = vi.fn();
const writeSessionCookies = vi.fn();
const currentUser = vi.fn();
const jar = new Map<string, string>();
const cookieSet = vi.fn((name: string, value: string) => { if (value) jar.set(name, value); else jar.delete(name); });
const mailTransportReady = vi.fn(() => true);
const requestScope = vi.fn();
const limits = { otpVisitor: true, signInVisitor: true, pair: true, account: true };
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "user-agent": "UA/1" }), cookies: async () => ({ get: (name: string) => jar.has(name) ? { value: jar.get(name) } : undefined, set: cookieSet }) }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`); } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth-errors", () => vi.importActual("../../src/lib/auth-errors"));
vi.mock("@/lib/auth/store", () => vi.importActual("../../src/lib/auth/store"));
vi.mock("@/lib/auth-mail", () => vi.importActual("../../src/lib/auth-mail"));
vi.mock("@/lib/errors", () => vi.importActual("../../src/lib/errors"));
vi.mock("@/lib/client-address", () => vi.importActual("../../src/lib/client-address"));
vi.mock("@/lib/request-context", () => vi.importActual("../../src/lib/request-context"));
vi.mock("@/lib/auth", () => ({ MIN_PASSWORD_LENGTH: 10, MAX_PASSWORD_LENGTH: 256 }));
vi.mock("@/lib/auth/crypto", () => vi.importActual("../../src/lib/auth/crypto"));
vi.mock("@/lib/config", () => ({ config: () => "test-secret-at-least-thirty-two-bytes-long" }));
vi.mock("@/lib/hosts", () => ({ requestScope: () => requestScope() }));
vi.mock("@/lib/auth/instance", () => ({ getAuth: () => auth }));
vi.mock("@/lib/mail-transport", () => ({ deliver: (mail: unknown) => deliver(mail), mailTransportReady: () => mailTransportReady() }));
vi.mock("@/lib/db/server", () => ({ currentUser: () => currentUser(), dbServer: async () => ({ rpc }) }));
vi.mock("@/lib/db/session", () => ({ writeSessionCookies: (session: unknown) => writeSessionCookies(session), sessionAudience: async () => "tenant" }));
vi.mock("@/lib/rate-limit", () => ({
  withinLimit: async (action: string) => (action === "OTP_LIMITER" ? limits.otpVisitor : limits.signInVisitor),
  withinAccountVisitorLimit: async () => limits.pair,
  withinAccountLimit: async () => limits.account,
}));

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

const email = "new.user@example.test";
const NOTICE = `Jika alamat ${email} bisa dipakai, kode 6 digit sudah dikirim ke sana.`;

beforeEach(() => {
  for (const fn of [...Object.values(auth), rpc, deliver, writeSessionCookies, currentUser]) fn.mockReset();
  Object.assign(limits, { otpVisitor: true, signInVisitor: true, pair: true, account: true });
  jar.clear();
  cookieSet.mockClear();
  mailTransportReady.mockReturnValue(true);
  requestScope.mockResolvedValue("shared");
  deliver.mockResolvedValue(undefined);
  currentUser.mockResolvedValue(null);
  rpc.mockResolvedValue({ data: true, error: null });
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("requestCodeAction", () => {
  it("rejects an address that is not one before any work", async () => {
    expect(await requestCodeAction({}, form({ email: "nope" }))).toMatchObject({ step: "email", error: "Masukkan alamat email yang valid." });
    expect(auth.requestEmailCode).not.toHaveBeenCalled();
  });

  it("renders the code mail once for a sent code and answers the generic notice", async () => {
    auth.requestEmailCode.mockResolvedValue({ status: "sent", email, code: "424242" });
    expect(await requestCodeAction({}, form({ email: ` ${email.toUpperCase()} `, "cf-turnstile-response": "tok" }))).toEqual({ step: "code", email, notice: NOTICE });
    expect(auth.requestEmailCode).toHaveBeenCalledExactlyOnceWith({ email, captchaToken: "tok", remoteIp: undefined, userAgent: "UA/1", requesterId: undefined });
    expect(deliver).toHaveBeenCalledExactlyOnceWith([expect.objectContaining({ to: email, subject: "Kode masuk GeraiExpress", text: expect.stringContaining("424242") })]);
    expect(cookieSet).toHaveBeenCalledWith("gx_verify_state", expect.any(String), expect.objectContaining({ httpOnly: true, sameSite: "lax", path: "/daftar", maxAge: 600 }));
    expect(cookieSet.mock.calls[0]).not.toHaveProperty("2.domain");
  });

  it("answers the very same notice when the service withheld the code, and sends no mail", async () => {
    auth.requestEmailCode.mockResolvedValue({ status: "withheld" });
    expect(await requestCodeAction({}, form({ email }))).toEqual({ step: "code", email, notice: NOTICE });
    expect(deliver).not.toHaveBeenCalled();
    expect(jar.has("gx_verify_state")).toBe(true);
  });

  it("passes the signed-in identity as the requester so SQL can refuse a demo session", async () => {
    currentUser.mockResolvedValue({ id: USER_ID });
    auth.requestEmailCode.mockResolvedValue({ status: "withheld" });
    await requestCodeAction({}, form({ email }));
    expect(auth.requestEmailCode).toHaveBeenCalledWith(expect.objectContaining({ requesterId: USER_ID }));
  });

  it("is truthful about a failed CAPTCHA", async () => {
    auth.requestEmailCode.mockResolvedValue({ status: "captcha_failed" });
    expect(await requestCodeAction({}, form({ email }))).toMatchObject({ step: "email", error: expect.stringMatching(/^Verifikasi keamanan gagal/) });
    expect(deliver).not.toHaveBeenCalled();
    expect(cookieSet).not.toHaveBeenCalled();
  });

  it.each([true, false])("never waits for delivery or reveals its failure (registration open: %s)", async (open) => {
    rpc.mockResolvedValue({ data: open, error: null });
    auth.requestEmailCode.mockResolvedValue({ status: "sent", email, code: "424242" });
    const { promise, reject: fail } = Promise.withResolvers<void>();
    deliver.mockReturnValue(promise);
    expect(await requestCodeAction({}, form({ email }))).toEqual({ step: "code", email, notice: NOTICE });
    fail(new Error("private provider detail"));
    await Promise.resolve();
    expect(console.error).toHaveBeenCalledWith(JSON.stringify({ event: "auth_mail_failed" }));
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toMatch(/424242|new\.user|private provider/);
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each(["sent", "withheld"])("fails before issuing for every address without transport (%s)", async (status) => {
    mailTransportReady.mockReturnValue(false);
    auth.requestEmailCode.mockResolvedValue({ status, email, code: "424242" });
    expect((await requestCodeAction({}, form({ email }))).error).toMatch(/^Pengiriman kode sedang bermasalah/);
    expect(auth.requestEmailCode).not.toHaveBeenCalled();
    expect(deliver).not.toHaveBeenCalled();
  });

  it("keeps store refusals generic and sets the same binding", async () => {
    auth.requestEmailCode.mockRejectedValue(new AuthUnavailableError("auth_issue_otp"));
    expect(await requestCodeAction({}, form({ email }))).toEqual({ step: "code", email, notice: NOTICE });
    currentUser.mockRejectedValueOnce(new AuthUnavailableError("auth_session_live"));
    expect(await requestCodeAction({}, form({ email }))).toEqual({ step: "code", email, notice: NOTICE });
  });

  it("refuses a throttled visitor before the auth service is asked", async () => {
    limits.otpVisitor = false;
    expect(await requestCodeAction({}, form({ email }))).toEqual({ step: "code", email, notice: NOTICE });
    limits.otpVisitor = true;
    limits.pair = false;
    expect(await requestCodeAction({}, form({ email }))).toEqual({ step: "code", email, notice: NOTICE });
    expect(cookieSet).toHaveBeenCalledTimes(2);
    expect(auth.requestEmailCode).not.toHaveBeenCalled();
    expect(deliver).not.toHaveBeenCalled();
  });
});

describe("withdrawApplicationAction", () => {
  const application = "33333333-3333-4333-8333-333333333333";
  const form = () => { const data = new FormData(); data.set("id", application); data.set("revision", "3"); return data; };
  it("forwards the application and the revision the applicant saw, then confirms", async () => {
    rpc.mockResolvedValueOnce({ error: null });
    expect(await withdrawApplicationAction({}, form())).toEqual({ ok: "Pengajuan dibatalkan." });
    expect(rpc).toHaveBeenCalledExactlyOnceWith("withdraw_application", { p_id: application, p_expected_revision: 3 });
  });
  it("returns the mapped refusal instead of a success", async () => {
    rpc.mockResolvedValueOnce({ error: { message: "stale_revision" } });
    expect(await withdrawApplicationAction({}, form())).toEqual({ error: expect.any(String) });
  });
});

describe("registration platform host boundary (TEN-6)", () => {
  for (const action of [reviewApplicationAction, setRegistrationAction]) {
    it.each(["tenant", "marketing", "hooks", null])(`${action.name} refuses %s`, async (scope) => {
      requestScope.mockResolvedValue(scope);
      expect(await action({}, new FormData())).toEqual({ error: "Tidak ditemukan." });
      expect(rpc).not.toHaveBeenCalled();
    });
    it.each(["platform", "shared"])(`${action.name} reaches database authorization on %s`, async (scope) => {
      requestScope.mockResolvedValue(scope);
      rpc.mockResolvedValue({ error: { message: "forbidden" } });
      await action({}, new FormData());
      expect(rpc).toHaveBeenCalledOnce();
    });
  }
});

describe("verifyCodeAction", () => {
  const prev = { step: "code" as const, email, notice: "old" };
  beforeEach(async () => {
    auth.requestEmailCode.mockResolvedValue({ status: "withheld" });
    await requestCodeAction({}, form({ email }));
    cookieSet.mockClear();
  });

  it("uses only signed cookie email, ignoring posted and previous addresses", async () => {
    auth.verifyEmailCode.mockResolvedValue({ ok: false, reason: "invalid" });
    await verifyCodeAction({ email: "victim@example.test" }, form({ email: "victim@example.test", code: "123456" }));
    expect(auth.verifyEmailCode).toHaveBeenCalledWith(expect.objectContaining({ email }));
  });

  it.each(["missing", "tampered", "expired", "changed"])("fails closed for %s state without spending verification attempts", async (kind) => {
    if (kind === "missing") jar.clear();
    if (kind === "tampered") jar.set("gx_verify_state", jar.get("gx_verify_state")!.replace(/^./, "!"));
    if (kind === "expired") vi.spyOn(Date, "now").mockReturnValue(Date.now() + 600_000);
    if (kind === "changed") expect(await changeEmailAction()).toEqual({ step: "email" });
    expect(await verifyCodeAction(prev, form({ code: "123456" }))).toEqual({ step: "code", error: "Kode tidak cocok atau sudah kedaluwarsa. Minta kode baru bila perlu." });
    expect(auth.verifyEmailCode).not.toHaveBeenCalled();
    expect(writeSessionCookies).not.toHaveBeenCalled();
  });

  it("sets the session cookies for a verified code and goes to the dashboard", async () => {
    auth.verifyEmailCode.mockResolvedValue({ ok: true, session: SESSION });
    await expect(verifyCodeAction(prev, form({ code: "12 34 56", "cf-turnstile-response": "tok" }))).rejects.toThrow("redirect:/");
    expect(auth.verifyEmailCode).toHaveBeenCalledExactlyOnceWith({
      email, code: "123456", captchaToken: "tok", remoteIp: undefined, userAgent: "UA/1", audience: "tenant",
    });
    expect(writeSessionCookies).toHaveBeenCalledExactlyOnceWith(SESSION);
  });

  it("keeps wrong, expired and used codes in one message and a failed CAPTCHA in another", async () => {
    auth.verifyEmailCode.mockResolvedValue({ ok: false, reason: "invalid" });
    expect(await verifyCodeAction(prev, form({ code: "000000" }))).toMatchObject({ error: expect.stringMatching(/^Kode tidak cocok/) });
    auth.verifyEmailCode.mockResolvedValue({ ok: false, reason: "captcha_failed" });
    expect((await verifyCodeAction(prev, form({ code: "000000" }))).error).toMatch(/^Verifikasi keamanan gagal/);
    expect(writeSessionCookies).not.toHaveBeenCalled();
  });

  it("answers busy on a store outage and checks the code shape first", async () => {
    auth.verifyEmailCode.mockRejectedValue(new AuthUnavailableError("auth_verify_otp"));
    expect((await verifyCodeAction(prev, form({ code: "123456" }))).error).toMatch(/^Layanan masuk sedang sibuk/);
    expect((await verifyCodeAction(prev, form({ code: "12ab" }))).error).toBe("Masukkan 6 digit kode dari email.");
  });

  it("refuses a throttled visitor before the auth service is asked", async () => {
    limits.signInVisitor = false;
    expect(await verifyCodeAction(prev, form({ code: "123456" }))).toMatchObject({ notice: undefined, error: expect.stringMatching(/^Terlalu banyak percobaan/) });
    limits.signInVisitor = true;
    limits.pair = false;
    expect(await verifyCodeAction(prev, form({ code: "123456" }))).toMatchObject({ notice: undefined, error: expect.stringMatching(/^Terlalu banyak percobaan/) });
    expect(auth.verifyEmailCode).not.toHaveBeenCalled();
    expect(writeSessionCookies).not.toHaveBeenCalled();
  });

  it("revokes a verified session once the account budget is exhausted, setting no cookie, even if revoke fails", async () => {
    limits.account = false;
    auth.verifyEmailCode.mockResolvedValue({ ok: true, session: SESSION });
    expect(await verifyCodeAction(prev, form({ code: "123456" }))).toMatchObject({ notice: undefined, error: expect.stringMatching(/^Terlalu banyak percobaan/) });
    expect(auth.revokeSession).toHaveBeenCalledExactlyOnceWith(SESSION.sessionId);
    expect(writeSessionCookies).not.toHaveBeenCalled();

    auth.revokeSession.mockRejectedValueOnce(new AuthUnavailableError("auth_revoke_session"));
    expect(await verifyCodeAction(prev, form({ code: "123456" }))).toMatchObject({ notice: undefined, error: expect.stringMatching(/^Terlalu banyak percobaan/) });
    expect(writeSessionCookies).not.toHaveBeenCalled();
  });
});

describe("setPasswordAction", () => {
  const account = (hasPassword: boolean, open = true) => ({ data: [{ has_password: hasPassword, registration_open: open }], error: null });
  const identity = { id: USER_ID, sessionId: SESSION.sessionId };

  beforeEach(() => {
    currentUser.mockResolvedValue(identity);
    rpc.mockImplementation(async (name: string) => (name === "my_account_state" ? account(false) : { data: [], error: null }));
  });

  it("checks length and confirmation before touching the service", async () => {
    expect(await setPasswordAction({}, form({ password: "pendek", confirm: "pendek" }))).toEqual({ fieldErrors: { password: "Minimal 10 karakter." } });
    expect(await setPasswordAction({}, form({ password: "x".repeat(257), confirm: "x".repeat(257) }))).toEqual({ fieldErrors: { password: "Maksimal 256 karakter." } });
    expect(await setPasswordAction({}, form({ password: "sandi-panjang-1", confirm: "lain-sama-sekali" }))).toEqual({ fieldErrors: { confirm: "Kata sandi tidak sama." } });
    expect(auth.setPassword).not.toHaveBeenCalled();
  });

  it("sends a visitor without a session to the sign-in page", async () => {
    currentUser.mockResolvedValue(null);
    await expect(setPasswordAction({}, form({ password: "sandi-panjang-1", confirm: "sandi-panjang-1" }))).rejects.toThrow("redirect:/masuk");
  });

  it("sets a password only for a password-less identity", async () => {
    rpc.mockImplementation(async () => account(true));
    await expect(setPasswordAction({}, form({ password: "sandi-panjang-1", confirm: "sandi-panjang-1" }))).rejects.toThrow("redirect:/");
    expect(auth.setPassword).not.toHaveBeenCalled();
  });

  it("keeps the verified user and session, then continues to the application (or the invitation)", async () => {
    auth.setPassword.mockResolvedValue({ ok: true });
    await expect(setPasswordAction({}, form({ password: "sandi-panjang-1", confirm: "sandi-panjang-1" }))).rejects.toThrow("redirect:/daftar/gerai");
    expect(auth.setPassword).toHaveBeenCalledExactlyOnceWith({ userId: USER_ID, sessionId: SESSION.sessionId, password: "sandi-panjang-1", initialOnly: true });
    rpc.mockImplementation(async (name: string) => (name === "my_account_state" ? account(false) : { data: [{ id: "inv" }], error: null }));
    await expect(setPasswordAction({}, form({ password: "sandi-panjang-1", confirm: "sandi-panjang-1" }))).rejects.toThrow("redirect:/undangan");
  });

  it("explains a weak password and a save that failed", async () => {
    auth.setPassword.mockResolvedValue({ ok: false, reason: "weak_password" });
    expect((await setPasswordAction({}, form({ password: "sandi-panjang-1", confirm: "sandi-panjang-1" }))).error).toMatch(/^Kata sandi terlalu lemah/);
    auth.setPassword.mockResolvedValue({ ok: false, reason: "invalid" });
    expect((await setPasswordAction({}, form({ password: "sandi-panjang-1", confirm: "sandi-panjang-1" }))).error).toMatch(/^Kata sandi belum bisa disimpan/);
    auth.setPassword.mockRejectedValue(new AuthUnavailableError("auth_set_password"));
    expect((await setPasswordAction({}, form({ password: "sandi-panjang-1", confirm: "sandi-panjang-1" }))).error).toMatch(/^Kata sandi belum bisa disimpan/);
    currentUser.mockRejectedValueOnce(new AuthUnavailableError("auth_session_live"));
    expect((await setPasswordAction({}, form({ password: "sandi-panjang-1", confirm: "sandi-panjang-1" }))).error).toMatch(/^Kata sandi belum bisa disimpan/);
  });
});
