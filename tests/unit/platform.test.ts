import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthUnavailableError } from "../../src/lib/auth/store";
import { loadPlatform } from "../../src/lib/platform";

const USER_ID = "22222222-2222-4222-8222-222222222222";
const SESSION_ID = "11111111-1111-4111-8111-111111111111";

const requestScope = vi.fn();
const currentUser = vi.fn();
const maybeSingle = vi.fn();
const machineRpc = vi.fn();
const machineClient = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("react", () => ({ cache: <T>(fn: T) => fn }));
vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("notFound"); },
  redirect: (path: string) => { throw new Error(`redirect:${path}`); },
}));
vi.mock("@/lib/hosts", () => ({ requestScope: () => requestScope() }));
vi.mock("@/lib/auth/store", () => vi.importActual("../../src/lib/auth/store"));
vi.mock("@/lib/db/server", () => ({
  currentUser: () => currentUser(),
  dbServer: async () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          is: () => ({ maybeSingle }),
        }),
      }),
    }),
  }),
  machineClient: () => machineClient(),
}));

beforeEach(() => {
  for (const fn of [requestScope, currentUser, maybeSingle, machineRpc, machineClient]) fn.mockReset();
  requestScope.mockResolvedValue("platform");
  currentUser.mockResolvedValue({
    id: USER_ID,
    email: "admin@geraiexpress.test",
    isAnonymous: false,
    hasPassword: true,
    aal: "aal1",
    sessionId: SESSION_ID,
  });
  maybeSingle.mockResolvedValue({ data: { capabilities: ["tenant_governance"] }, error: null });
  machineClient.mockResolvedValue({ rpc: machineRpc });
  machineRpc.mockResolvedValue({ data: { status: "verified" }, error: null });
});

describe("loadPlatform hasTotp", () => {
  it("treats an aal2 session as already having a verified TOTP factor without querying auth_mfa_factor", async () => {
    currentUser.mockResolvedValue({
      id: USER_ID,
      email: "admin@geraiexpress.test",
      isAnonymous: false,
      hasPassword: true,
      aal: "aal2",
      sessionId: SESSION_ID,
    });
    const session = await loadPlatform();
    expect(session).toEqual({
      userId: USER_ID,
      email: "admin@geraiexpress.test",
      capabilities: ["tenant_governance"],
      aal2: true,
      hasTotp: true,
    });
    expect(machineClient).not.toHaveBeenCalled();
    expect(machineRpc).not.toHaveBeenCalled();
  });

  it("queries auth_mfa_factor for an aal1 session and reflects whether the factor is verified", async () => {
    expect(await loadPlatform()).toMatchObject({ aal2: false, hasTotp: true });
    expect(machineRpc).toHaveBeenCalledExactlyOnceWith("auth_mfa_factor", { p_user: USER_ID });

    machineRpc.mockResolvedValueOnce({ data: null, error: null });
    expect(await loadPlatform()).toMatchObject({ aal2: false, hasTotp: false });
  });

  it("fails closed with AuthUnavailableError when the machine client is missing or auth_mfa_factor errors", async () => {
    machineClient.mockResolvedValueOnce(null);
    await expect(loadPlatform()).rejects.toThrow(AuthUnavailableError);

    machineRpc.mockResolvedValueOnce({ data: null, error: { message: "connection refused" } });
    await expect(loadPlatform()).rejects.toMatchObject({
      name: "AuthUnavailableError",
      operation: "auth_mfa_factor",
    });
  });
});
