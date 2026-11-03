import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { revokeGrantAction, setGrantAction, setTenantLifecycleAction, startTotpEnrollAction, verifyTotpAction } from "../../src/lib/platform-actions";
import { qrSvgDataUri } from "../../src/lib/qr";
import { AuthUnavailableError } from "../../src/lib/auth/store";

// IAM-7: enrolment shows a server-drawn QR and the secret once; a verified code moves the session to
// aal2 and the NEW refresh token replaces the cookies.
const USER_ID = "22222222-2222-4222-8222-222222222222";
const SESSION_ID = "11111111-1111-4111-8111-111111111111";
const FACTOR_ID = "33333333-3333-4333-8333-333333333333";
const AAL2 = { sessionId: SESSION_ID, accessToken: "aal2-access", refreshToken: "aal2-refresh", aal: "aal2" };
const auth = { enrollTotp: vi.fn(), verifyTotp: vi.fn() };
const writeSessionCookies = vi.fn();
const loadPlatform = vi.fn();
const currentUser = vi.fn();
const limits = { visitor: true, account: true };
const accountBudget = vi.fn();
const requestScope = vi.fn();
const rpc = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`); } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth-errors", () => vi.importActual("../../src/lib/auth-errors"));
vi.mock("@/lib/auth/store", () => vi.importActual("../../src/lib/auth/store"));
vi.mock("@/lib/errors", () => vi.importActual("../../src/lib/errors"));
vi.mock("@/lib/qr", () => vi.importActual("../../src/lib/qr"));
// T-091: the WIB effective-time parser is a pure helper of platform-actions.
vi.mock("@/lib/wib", () => vi.importActual("../../src/lib/wib"));
vi.mock("@/lib/hosts", () => ({ requestScope: () => requestScope() }));
vi.mock("@/lib/auth/instance", () => ({ getAuth: () => auth }));
vi.mock("@/lib/platform", () => ({ loadPlatform: () => loadPlatform() }));
vi.mock("@/lib/db/server", () => ({ currentUser: () => currentUser(), dbServer: async () => ({ rpc }) }));
vi.mock("@/lib/db/session", () => ({ writeSessionCookies: (session: unknown) => writeSessionCookies(session) }));
vi.mock("@/lib/rate-limit", () => ({
  withinLimit: async () => limits.visitor,
  withinAccountLimit: async (action: string, target: string) => { accountBudget(action, target); return limits.account; },
}));

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

beforeEach(() => {
  for (const fn of [...Object.values(auth), writeSessionCookies, loadPlatform, currentUser, accountBudget]) fn.mockReset();
  Object.assign(limits, { visitor: true, account: true });
  requestScope.mockResolvedValue("shared");
  rpc.mockReset().mockResolvedValue({ error: null });
  loadPlatform.mockResolvedValue({ userId: USER_ID, email: "admin@geraiexpress.test", hasTotp: false });
  currentUser.mockResolvedValue({ id: USER_ID, sessionId: SESSION_ID });
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("platform mutations host boundary (TEN-6)", () => {
  for (const action of [setTenantLifecycleAction, setGrantAction, revokeGrantAction]) {
    it.each(["tenant", "marketing", "hooks", null])(`${action.name} refuses %s before database access`, async (scope) => {
      requestScope.mockResolvedValue(scope);
      expect(await action({}, new FormData())).toEqual({ error: "Tidak ditemukan." });
      expect(rpc).not.toHaveBeenCalled();
    });
    it.each(["platform", "shared"])(`${action.name} allows %s to reach database authorization`, async (scope) => {
      requestScope.mockResolvedValue(scope);
      const data = form({ capabilities: "access_governance" });
      await action({}, data);
      expect(rpc).toHaveBeenCalledOnce();
    });
  }
});

describe("startTotpEnrollAction", () => {
  const uri = "otpauth://totp/GeraiExpress:admin%40geraiexpress.test?secret=JBSWY3DPEHPK3PXP&issuer=GeraiExpress";

  it("returns the factor, the secret for manual entry and the QR drawn on the server", async () => {
    auth.enrollTotp.mockResolvedValue({ ok: true, factorId: FACTOR_ID, secret: "JBSWY3DPEHPK3PXP", otpauthUri: uri });
    const state = await startTotpEnrollAction();
    expect(auth.enrollTotp).toHaveBeenCalledExactlyOnceWith({ userId: USER_ID, email: "admin@geraiexpress.test" });
    expect(state).toEqual({ factorId: FACTOR_ID, secret: "JBSWY3DPEHPK3PXP", qr: qrSvgDataUri(uri) });
    expect(state.qr).toMatch(/^data:image\/svg\+xml;base64,/);
  });

  it("refuses a caller without a platform grant, and sends one who already has a factor to the challenge", async () => {
    loadPlatform.mockResolvedValue(null);
    expect(await startTotpEnrollAction()).toEqual({ error: "Akun ini tidak memiliki akses Super Admin." });
    loadPlatform.mockResolvedValue({ userId: USER_ID, email: "admin@geraiexpress.test", hasTotp: true });
    await expect(startTotpEnrollAction()).rejects.toThrow("redirect:/verifikasi-2fa");
    auth.enrollTotp.mockResolvedValue({ ok: false, reason: "already_verified" });
    loadPlatform.mockResolvedValue({ userId: USER_ID, email: "admin@geraiexpress.test", hasTotp: false });
    await expect(startTotpEnrollAction()).rejects.toThrow("redirect:/verifikasi-2fa");
  });

  it("explains a failed enrolment and a store outage", async () => {
    auth.enrollTotp.mockResolvedValue({ ok: false, reason: "invalid" });
    expect((await startTotpEnrollAction()).error).toMatch(/^Pendaftaran autentikator belum bisa dimulai/);
    auth.enrollTotp.mockRejectedValue(new AuthUnavailableError("auth_mfa_enroll"));
    expect((await startTotpEnrollAction()).error).toMatch(/^Layanan masuk sedang sibuk/);
    loadPlatform.mockRejectedValue(new AuthUnavailableError("auth_session_live"));
    expect((await startTotpEnrollAction()).error).toMatch(/^Layanan masuk sedang sibuk/);
  });
});

describe("verifyTotpAction", () => {
  it("checks the code shape before any budget", async () => {
    expect(await verifyTotpAction({ factorId: FACTOR_ID }, form({ code: "12" }))).toEqual({ factorId: FACTOR_ID, error: "Masukkan 6 digit kode dari aplikasi autentikator." });
    expect(auth.verifyTotp).not.toHaveBeenCalled();
  });

  it("verifies for the server-verified user and session (never a submitted one), then replaces both cookies", async () => {
    auth.verifyTotp.mockResolvedValue({ ok: true, session: AAL2 });
    await expect(verifyTotpAction({ factorId: FACTOR_ID }, form({ code: "123 456", user_id: "forged", session_id: "forged" }))).rejects.toThrow("redirect:/admin");
    expect(auth.verifyTotp).toHaveBeenCalledExactlyOnceWith({ userId: USER_ID, sessionId: SESSION_ID, code: "123456", factorId: FACTOR_ID });
    expect(writeSessionCookies).toHaveBeenCalledExactlyOnceWith(AAL2);
    expect(accountBudget).toHaveBeenCalledWith("MFA_ACCOUNT_LIMITER", USER_ID);
  });

  it("answers one message for a wrong code and a replayed one, and keeps the enrolment state", async () => {
    for (const reason of ["invalid", "replay"]) {
      auth.verifyTotp.mockResolvedValue({ ok: false, reason });
      expect(await verifyTotpAction({ factorId: FACTOR_ID, secret: "S" }, form({ code: "123456" })))
        .toEqual({ factorId: FACTOR_ID, secret: "S", error: "Kode tidak cocok atau sudah kedaluwarsa. Coba kode terbaru." });
    }
    expect(writeSessionCookies).not.toHaveBeenCalled();
  });

  it("asks to restart a lost enrolment", async () => {
    auth.verifyTotp.mockResolvedValue({ ok: false, reason: "no_factor" });
    expect(await verifyTotpAction({ factorId: FACTOR_ID }, form({ code: "123456" }))).toEqual({ error: "Mulai ulang pendaftaran autentikator." });
  });

  it("is throttled per visitor and per verified account before the service is asked", async () => {
    limits.visitor = false;
    expect((await verifyTotpAction({}, form({ code: "123456" }))).error).toMatch(/^Terlalu banyak percobaan/);
    limits.visitor = true;
    limits.account = false;
    expect((await verifyTotpAction({}, form({ code: "123456" }))).error).toMatch(/^Terlalu banyak percobaan/);
    expect(auth.verifyTotp).not.toHaveBeenCalled();
  });

  it("refuses a caller without a platform grant or session, and answers busy on a store outage", async () => {
    loadPlatform.mockResolvedValue(null);
    expect(await verifyTotpAction({}, form({ code: "123456" }))).toEqual({ error: "Akun ini tidak memiliki akses Super Admin." });
    loadPlatform.mockResolvedValue({ userId: USER_ID, hasTotp: true });
    currentUser.mockResolvedValue(null);
    expect(await verifyTotpAction({}, form({ code: "123456" }))).toEqual({ error: "Akun ini tidak memiliki akses Super Admin." });
    loadPlatform.mockRejectedValueOnce(new AuthUnavailableError("auth_session_live"));
    expect((await verifyTotpAction({}, form({ code: "123456" }))).error).toMatch(/^Layanan masuk sedang sibuk/);
    currentUser.mockRejectedValueOnce(new AuthUnavailableError("auth_session_live"));
    expect((await verifyTotpAction({}, form({ code: "123456" }))).error).toMatch(/^Layanan masuk sedang sibuk/);
    currentUser.mockResolvedValue({ id: USER_ID, sessionId: SESSION_ID });
    auth.verifyTotp.mockRejectedValue(new AuthUnavailableError("auth_mfa_verify"));
    expect((await verifyTotpAction({}, form({ code: "123456" }))).error).toMatch(/^Layanan masuk sedang sibuk/);
  });
});
