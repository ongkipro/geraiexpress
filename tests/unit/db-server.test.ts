import { beforeEach, describe, expect, it, vi } from "vitest";
import { currentUser, dbServer, machineClient } from "../../src/lib/db/server";

const USER_ID = "22222222-2222-4222-8222-222222222222";
const SESSION_ID = "11111111-1111-4111-8111-111111111111";

const jar = new Map<string, string>();
const cookieStore = {
  get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
};
const env: Record<string, string | undefined> = {};
const auth = {
  verifyAccessToken: vi.fn(),
  sessionLive: vi.fn(),
};
const anonDb = { kind: "anon" };
const serviceDb = { kind: "service" };
const dataClient = vi.fn((url: string, token?: string) => ({ kind: "user", url, token }));
const anonClient = vi.fn(() => anonDb);
const serviceClient = vi.fn(() => serviceDb);

vi.mock("server-only", () => ({}));
vi.mock("react", () => ({ cache: <T>(fn: T) => fn }));
vi.mock("next/headers", () => ({ cookies: async () => cookieStore }));
vi.mock("@/lib/config", () => ({ config: (key: string) => env[key] }));
vi.mock("@/lib/auth/instance", () => ({
  getAuth: () => auth,
  postgrestUrl: () => "http://postgrest.test",
  anonClient: () => anonClient(),
  serviceClient: () => serviceClient(),
}));
vi.mock("../../src/lib/db/client", () => ({ dataClient: (url: string, token?: string) => dataClient(url, token) }));
vi.mock("../../src/lib/db/cookies", () => vi.importActual("../../src/lib/db/cookies"));

beforeEach(() => {
  jar.clear();
  for (const key of Object.keys(env)) delete env[key];
  Object.assign(env, {
    AUTH_JWT_SECRET: "a".repeat(32),
    AUTH_SECRET: "b".repeat(32),
    POSTGREST_URL: "http://postgrest.test",
  });
  for (const fn of [auth.verifyAccessToken, auth.sessionLive, dataClient, anonClient, serviceClient]) fn.mockClear();
  auth.verifyAccessToken.mockResolvedValue({
    ok: true,
    claims: { role: "authenticated", sub: USER_ID, session_id: SESSION_ID },
  });
  auth.sessionLive.mockResolvedValue({
    live: true,
    userId: USER_ID,
    sessionId: SESSION_ID,
    email: "owner@example.test",
    isAnonymous: false,
    hasPassword: true,
    aal: "aal1",
  });
});

describe("dbServer", () => {
  it("returns the user client only when the access token verifies and the session is live", async () => {
    jar.set("gx_at", "valid.jwt.token");
    const db = await dbServer();
    expect(db).toEqual({ kind: "user", url: "http://postgrest.test", token: "valid.jwt.token" });
    expect(dataClient).toHaveBeenCalledExactlyOnceWith("http://postgrest.test", "valid.jwt.token");
    expect(anonClient).not.toHaveBeenCalled();
  });

  it("falls back to the anonymous client when the cookie is missing, forged, anon-role, or the session is revoked", async () => {
    // Missing cookie
    expect(await dbServer()).toBe(anonDb);
    expect(auth.verifyAccessToken).not.toHaveBeenCalled();

    // Forged / invalid token
    jar.set("gx_at", "forged.jwt.token");
    auth.verifyAccessToken.mockResolvedValueOnce({ ok: false, reason: "signature" });
    expect(await dbServer()).toBe(anonDb);
    expect(auth.sessionLive).not.toHaveBeenCalled();

    // Anon-role token
    auth.verifyAccessToken.mockResolvedValueOnce({ ok: true, claims: { role: "anon", sub: USER_ID, session_id: SESSION_ID } });
    expect(await dbServer()).toBe(anonDb);

    // Token without session_id
    auth.verifyAccessToken.mockResolvedValueOnce({ ok: true, claims: { role: "authenticated", sub: USER_ID } });
    expect(await dbServer()).toBe(anonDb);

    // Revoked / expired session in database
    auth.sessionLive.mockResolvedValueOnce({ live: false });
    expect(await dbServer()).toBe(anonDb);
    expect(dataClient).not.toHaveBeenCalled();
  });
});

describe("currentUser", () => {
  it("returns null when the live session belongs to a different user than the token's sub", async () => {
    jar.set("gx_at", "valid.jwt.token");
    auth.sessionLive.mockResolvedValueOnce({
      live: true,
      userId: "99999999-9999-4999-8999-999999999999",
      sessionId: SESSION_ID,
      email: "other@example.test",
      isAnonymous: false,
      hasPassword: true,
      aal: "aal1",
    });
    expect(await currentUser()).toBeNull();

    auth.sessionLive.mockResolvedValueOnce({
      live: true,
      userId: "99999999-9999-4999-8999-999999999999",
      sessionId: SESSION_ID,
      email: "other@example.test",
      isAnonymous: false,
      hasPassword: true,
      aal: "aal1",
    });
    expect(await dbServer()).toBe(anonDb);
    expect(dataClient).not.toHaveBeenCalled();
  });
});

describe("machineClient", () => {
  it("returns the service client only when AUTH_JWT_SECRET, AUTH_SECRET and POSTGREST_URL are all present", async () => {
    expect(await machineClient()).toBe(serviceDb);
    expect(serviceClient).toHaveBeenCalledOnce();

    for (const key of ["AUTH_JWT_SECRET", "AUTH_SECRET", "POSTGREST_URL"]) {
      const saved = env[key];
      env[key] = "";
      expect(await machineClient(), key).toBeNull();
      env[key] = saved;
    }
    expect(serviceClient).toHaveBeenCalledOnce();
  });
});
