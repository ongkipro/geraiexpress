// Application-owned authentication service (ADR-0002 section 3.2). Hashing, token signing, TOTP
// arithmetic, Turnstile and code generation happen here; SQL only ever receives hashes and sealed text.
// Nothing in this file logs, and no thrown error carries a password, code, token, secret or JWT.
import { randomToken, sha256Hex, assertSecret } from "./crypto";
import { ACCESS_TTL_SECONDS, mintStaticJwt, signJwt, verifyJwt, type AccessClaims, type VerifyResult } from "./jwt";
import { generateOtpCode, hashOtp } from "./otp";
import { hashPassword, passwordProblem, verifyDummyPassword, verifyPassword } from "./password";
import { AuthUnavailableError, type AuthStore, type AuthStoreReply } from "./store";
import { generateTotpSecret, otpauthUri, sealTotpSecret, unsealTotpSecret, verifyTotp as checkTotp } from "./totp";
import { TURNSTILE_ACTIONS, type TurnstileAction } from "../turnstile-actions";
import { verifyTurnstile } from "./turnstile";

export type AuthConfig = {
  store: AuthStore;
  /** HS256 key shared with PostgREST (AUTH_JWT_SECRET). */
  jwtSecret: string;
  /** Root of the OTP and TOTP-sealing keys (AUTH_SECRET); must differ from `jwtSecret`. */
  authSecret: string;
  /**
   * Turnstile verification, or the explicit opt-out for local stacks. A configured captcha fails closed and
   * accepts a token only for the surface's action and one of `hostnames` (the public hosts serving the widget).
   */
  captcha: { secret: string; hostnames: string[]; fetchImpl?: typeof fetch } | "disabled";
  /** Epoch milliseconds; defaults to Date.now. */
  now?: () => number;
};

export type Audience = "tenant" | "platform";

export type SessionTokens = {
  accessToken: string;
  /** null on `recent_reuse`: the caller must leave its refresh cookie alone. */
  refreshToken: string | null;
  sessionId: string;
  userId: string;
  email: string | null;
  isAnonymous: boolean;
  hasPassword: boolean;
  aal: "aal1" | "aal2";
  /** Epoch seconds. */
  accessExpiresAt: number;
  absoluteExpiresAt: string;
};

export type RequestCodeResult = { status: "sent"; email: string; code: string } | { status: "captcha_failed" } | { status: "withheld" };
export type CodeSignInResult = { ok: true; session: SessionTokens } | { ok: false; reason: "captcha_failed" | "invalid" };
export type SignInResult = { ok: true; session: SessionTokens } | { ok: false; reason: "captcha_failed" | "invalid_credentials" };
export type SetPasswordResult = { ok: true } | { ok: false; reason: "weak_password" | "invalid" };
export type RefreshResult = { ok: true; session: SessionTokens } | { ok: false; reason: "invalid" | "reuse_detected" };
export type SessionLiveResult =
  | { live: false }
  | {
      live: true;
      userId: string;
      email: string | null;
      isAnonymous: boolean;
      hasPassword: boolean;
      sessionId: string;
      aal: "aal1" | "aal2";
      aal2At: string | null;
      absoluteExpiresAt: string;
    };
export type EnrollTotpResult =
  | { ok: true; factorId: string; secret: string; otpauthUri: string }
  | { ok: false; reason: "already_verified" | "invalid" };
export type VerifyTotpResult = { ok: true; session: SessionTokens } | { ok: false; reason: "invalid" | "replay" | "no_factor" };

export type RequestCodeInput = { email: string; captchaToken: string | undefined; remoteIp?: string; requesterId?: string };
export type VerifyCodeInput = {
  email: string;
  code: string;
  captchaToken: string | undefined;
  remoteIp?: string;
  userAgent?: string;
  audience?: Audience;
};
export type PasswordSignInInput = { email: string; password: string; captchaToken: string | undefined; remoteIp?: string; userAgent?: string; audience?: Audience };
export type AnonymousSignInInput = { captchaToken: string | undefined; remoteIp?: string; userAgent?: string };
export type SetPasswordInput = { userId: string; sessionId: string; password: string; initialOnly?: boolean };
export type EnrollTotpInput = { userId: string; email: string };
export type VerifyTotpInput = { userId: string; sessionId: string; code: string; factorId?: string };

export interface Auth {
  /** Every failure that is not a CAPTCHA refusal is `withheld`: the caller must answer all of them alike. */
  requestEmailCode(input: RequestCodeInput): Promise<RequestCodeResult>;
  verifyEmailCode(input: VerifyCodeInput): Promise<CodeSignInResult>;
  signInWithPassword(input: PasswordSignInInput): Promise<SignInResult>;
  signInAnonymous(input: AnonymousSignInInput): Promise<SignInResult>;
  /** Sets the password and ends every other session. Whether a password may be set is the caller's policy. */
  setPassword(input: SetPasswordInput): Promise<SetPasswordResult>;
  refresh(refreshToken: string): Promise<RefreshResult>;
  sessionLive(sessionId: string): Promise<SessionLiveResult>;
  revokeSession(sessionId: string): Promise<void>;
  revokeUserSessions(userId: string, exceptSessionId?: string): Promise<void>;
  /** The base32 secret is returned once, for display; only its AES-GCM seal reaches the store. */
  enrollTotp(input: EnrollTotpInput): Promise<EnrollTotpResult>;
  /** A correct code moves the session to aal2 and rotates its refresh token; a wrong code never reaches the store. */
  verifyTotp(input: VerifyTotpInput): Promise<VerifyTotpResult>;
  verifyAccessToken(token: string, opts?: { allowExpired?: boolean }): Promise<VerifyResult>;
  /** The long-lived anon and service_role JWTs PostgREST accepts; the service one stays server-side. */
  staticKeys(): Promise<{ anon: string; service: string }>;
}

type Row = Record<string, unknown>;
type Amr = { method: string; timestamp: number }[];
type Identity = {
  userId: string;
  email: string | null;
  isAnonymous: boolean;
  hasPassword: boolean;
  sessionId: string;
  aal: "aal1" | "aal2";
  aal2At: string | null;
  absoluteExpiresAt: string;
};

const TENANT_SESSION_SECONDS = 7 * 24 * 3600;
const PLATFORM_SESSION_SECONDS = 12 * 3600;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REFRESH_TOKEN = /^[A-Za-z0-9_-]{43}$/;
const OTP_CODE = /^\d{6}$/;

const isRow = (value: unknown): value is Row => typeof value === "object" && value !== null && !Array.isArray(value);
const isUuid = (value: unknown): value is string => typeof value === "string" && UUID.test(value);
const normalizeEmail = (email: unknown): string => (typeof email === "string" ? email.trim().toLowerCase() : "");

function lifetime(audience: Audience | undefined) {
  const seconds = audience === "platform" ? PLATFORM_SESSION_SECONDS : TENANT_SESSION_SECONDS;
  return { p_absolute_seconds: seconds, p_idle_seconds: seconds };
}

const userAgentHash = (userAgent: string | undefined): string | null => (userAgent ? sha256Hex(userAgent) : null);

// The same rule as scripts/check-environments.mjs: what Cloudflare siteverify returns as `hostname`.
const BARE_HOSTNAME = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/;

export function createAuth(config: AuthConfig): Auth {
  const { store, captcha } = config;
  const jwtSecret = assertSecret("AUTH_JWT_SECRET", config.jwtSecret);
  const authSecret = assertSecret("AUTH_SECRET", config.authSecret);
  if (jwtSecret === authSecret) throw new Error("AUTH_JWT_SECRET and AUTH_SECRET must be different values");
  if (captcha !== "disabled" && !(isRow(captcha) && typeof captcha.secret === "string" && captcha.secret.length > 0)) {
    throw new Error('captcha must be { secret, hostnames } or the explicit "disabled"');
  }
  const captchaHostnames = new Set(
    captcha === "disabled" || !Array.isArray(captcha.hostnames)
      ? []
      : captcha.hostnames.filter((h): h is string => typeof h === "string").map((h) => h.trim().toLowerCase()).filter(Boolean),
  );
  if (captcha !== "disabled" && captchaHostnames.size === 0) {
    throw new Error("captcha hostnames must name at least one host serving the Turnstile widget");
  }
  // siteverify returns a bare hostname; a scheme, port or path would make every token fail. Never echo the value.
  if ([...captchaHostnames].some((h) => !BARE_HOSTNAME.test(h))) {
    throw new Error("TURNSTILE_HOSTNAMES must list bare hostnames only (no scheme, port or path)");
  }
  const clock = config.now ?? Date.now;
  const nowSeconds = () => Math.floor(clock() / 1000);

  async function invoke(fn: string, args: Record<string, unknown>): Promise<unknown> {
    let reply: AuthStoreReply;
    try {
      reply = await store.rpc(fn, args);
    } catch {
      throw new AuthUnavailableError(fn);
    }
    if (!isRow(reply) || reply.error) throw new AuthUnavailableError(fn);
    return reply.data;
  }

  async function rpcRow(fn: string, args: Record<string, unknown>): Promise<Row> {
    const data = await invoke(fn, args);
    if (!isRow(data)) throw new AuthUnavailableError(fn);
    return data;
  }

  async function rpcOptionalRow(fn: string, args: Record<string, unknown>): Promise<Row | null> {
    const data = await invoke(fn, args);
    if (data === null || data === undefined) return null;
    if (!isRow(data)) throw new AuthUnavailableError(fn);
    return data;
  }

  async function rpcVoid(fn: string, args: Record<string, unknown>): Promise<void> {
    await invoke(fn, args);
  }

  function statusOf(row: Row, fn: string): string {
    if (typeof row.status !== "string") throw new AuthUnavailableError(fn);
    return row.status;
  }

  function parseIdentity(row: Row, fn: string): Identity {
    const { user_id, email, is_anonymous, has_password, session_id, aal, aal2_at, absolute_expires_at } = row;
    if (
      !isUuid(user_id) || !isUuid(session_id) ||
      (email !== null && typeof email !== "string") ||
      typeof is_anonymous !== "boolean" || typeof has_password !== "boolean" ||
      (aal !== "aal1" && aal !== "aal2") ||
      (aal2_at !== null && aal2_at !== undefined && typeof aal2_at !== "string") ||
      typeof absolute_expires_at !== "string"
    ) {
      throw new AuthUnavailableError(fn);
    }
    return {
      userId: user_id,
      email,
      isAnonymous: is_anonymous,
      hasPassword: has_password,
      sessionId: session_id,
      aal,
      aal2At: typeof aal2_at === "string" ? aal2_at : null,
      absoluteExpiresAt: absolute_expires_at,
    };
  }

  async function sessionFrom(identity: Identity, refreshToken: string | null, amr: Amr): Promise<SessionTokens> {
    const iat = nowSeconds();
    const claims: Omit<AccessClaims, "aud" | "iat" | "exp"> = {
      role: "authenticated",
      sub: identity.userId,
      session_id: identity.sessionId,
      email: identity.email ?? "",
      is_anonymous: identity.isAnonymous,
      aal: identity.aal,
      amr,
    };
    const accessToken = await signJwt(jwtSecret, claims, { now: iat, ttlSeconds: ACCESS_TTL_SECONDS });
    return {
      accessToken,
      refreshToken,
      sessionId: identity.sessionId,
      userId: identity.userId,
      email: identity.email,
      isAnonymous: identity.isAnonymous,
      hasPassword: identity.hasPassword,
      aal: identity.aal,
      accessExpiresAt: iat + ACCESS_TTL_SECONDS,
      absoluteExpiresAt: identity.absoluteExpiresAt,
    };
  }

  const amrFor = (method: string): Amr => [{ method, timestamp: nowSeconds() }];

  async function captchaPasses(token: string | undefined, remoteIp: string | undefined, action: TurnstileAction): Promise<boolean> {
    if (captcha === "disabled") return true;
    return verifyTurnstile({
      secret: captcha.secret,
      token,
      expectedAction: action,
      allowedHostnames: captchaHostnames,
      remoteIp,
      fetchImpl: captcha.fetchImpl,
    });
  }

  return {
    async requestEmailCode(input: RequestCodeInput): Promise<RequestCodeResult> {
      if (!(await captchaPasses(input.captchaToken, input.remoteIp, TURNSTILE_ACTIONS.codeRequest))) return { status: "captcha_failed" };
      const email = normalizeEmail(input.email);
      if (email === "" || (input.requesterId !== undefined && !isUuid(input.requesterId))) return { status: "withheld" };
      const code = generateOtpCode();
      const row = await rpcRow("auth_issue_otp", {
        p_email: email,
        p_code_hash: hashOtp(authSecret, email, "login", code),
        p_requester: input.requesterId ?? null,
      });
      const status = statusOf(row, "auth_issue_otp");
      if (status === "sent") return { status: "sent", email, code };
      // Blocked, throttled, too soon, refused and invalid are one outcome for the caller: no account enumeration.
      if (["blocked", "throttled", "too_soon", "refused", "invalid"].includes(status)) return { status: "withheld" };
      throw new AuthUnavailableError("auth_issue_otp");
    },

    async verifyEmailCode(input: VerifyCodeInput): Promise<CodeSignInResult> {
      if (!(await captchaPasses(input.captchaToken, input.remoteIp, TURNSTILE_ACTIONS.codeVerify))) return { ok: false, reason: "captcha_failed" };
      const email = normalizeEmail(input.email);
      if (email === "" || typeof input.code !== "string" || !OTP_CODE.test(input.code)) return { ok: false, reason: "invalid" };
      const refreshToken = randomToken(32);
      const fn = "auth_verify_otp";
      const row = await rpcRow(fn, {
        p_email: email,
        p_code_hash: hashOtp(authSecret, email, "login", input.code),
        p_refresh_hash: sha256Hex(refreshToken),
        p_user_agent_hash: userAgentHash(input.userAgent),
        ...lifetime(input.audience),
      });
      const status = statusOf(row, fn);
      if (status === "invalid") return { ok: false, reason: "invalid" };
      if (status !== "ok") throw new AuthUnavailableError(fn);
      return { ok: true, session: await sessionFrom(parseIdentity(row, fn), refreshToken, amrFor("otp")) };
    },

    async signInWithPassword(input: PasswordSignInInput): Promise<SignInResult> {
      if (!(await captchaPasses(input.captchaToken, input.remoteIp, TURNSTILE_ACTIONS.signin))) return { ok: false, reason: "captcha_failed" };
      const email = normalizeEmail(input.email);
      const password = typeof input.password === "string" ? input.password : "";
      const credential = email === "" ? null : await rpcOptionalRow("auth_password_credential", { p_email: email });
      const stored = credential && isUuid(credential.user_id) && typeof credential.encrypted_password === "string" ? credential : null;
      // Unknown, ineligible and password-less accounts pay the same scrypt cost as a wrong password.
      const matches = stored ? await verifyPassword(password, stored.encrypted_password as string) : await verifyDummyPassword(password);
      if (!stored || !matches) return { ok: false, reason: "invalid_credentials" };
      const refreshToken = randomToken(32);
      const fn = "auth_create_session";
      const row = await rpcRow(fn, {
        p_user: stored.user_id,
        p_refresh_hash: sha256Hex(refreshToken),
        p_user_agent_hash: userAgentHash(input.userAgent),
        ...lifetime(input.audience),
      });
      const status = statusOf(row, fn);
      if (status === "invalid") return { ok: false, reason: "invalid_credentials" };
      if (status !== "ok") throw new AuthUnavailableError(fn);
      return { ok: true, session: await sessionFrom(parseIdentity(row, fn), refreshToken, amrFor("password")) };
    },

    async signInAnonymous(input: AnonymousSignInInput): Promise<SignInResult> {
      if (!(await captchaPasses(input.captchaToken, input.remoteIp, TURNSTILE_ACTIONS.demo))) return { ok: false, reason: "captcha_failed" };
      const refreshToken = randomToken(32);
      const fn = "auth_sign_in_anonymous";
      const row = await rpcRow(fn, {
        p_refresh_hash: sha256Hex(refreshToken),
        p_user_agent_hash: userAgentHash(input.userAgent),
        ...lifetime("tenant"),
      });
      if (statusOf(row, fn) !== "ok") throw new AuthUnavailableError(fn);
      return { ok: true, session: await sessionFrom(parseIdentity(row, fn), refreshToken, amrFor("anonymous")) };
    },

    async setPassword(input: SetPasswordInput): Promise<SetPasswordResult> {
      if (typeof input.password !== "string" || passwordProblem(input.password) !== null) return { ok: false, reason: "weak_password" };
      if (!isUuid(input.userId) || !isUuid(input.sessionId)) return { ok: false, reason: "invalid" };
      const fn = input.initialOnly ? "auth_initialize_password" : "auth_set_password";
      const row = await rpcRow(fn, {
        p_user: input.userId,
        p_hash: await hashPassword(input.password),
        p_keep_session: input.sessionId,
      });
      const status = statusOf(row, fn);
      if (status === "ok") return { ok: true };
      if (status === "invalid") return { ok: false, reason: "invalid" };
      throw new AuthUnavailableError(fn);
    },

    async refresh(refreshToken: string): Promise<RefreshResult> {
      if (typeof refreshToken !== "string" || !REFRESH_TOKEN.test(refreshToken)) return { ok: false, reason: "invalid" };
      const next = randomToken(32);
      const fn = "auth_refresh_session";
      const row = await rpcRow(fn, { p_refresh_hash: sha256Hex(refreshToken), p_new_refresh_hash: sha256Hex(next) });
      const status = statusOf(row, fn);
      if (status === "invalid" || status === "reuse_detected") return { ok: false, reason: status };
      if (status !== "ok" && status !== "recent_reuse") throw new AuthUnavailableError(fn);
      const identity = parseIdentity(row, fn);
      // The access token mirrors the SQL identity: aal2 carries the moment the second factor was proven.
      const proven = identity.aal2At === null ? NaN : Math.floor(Date.parse(identity.aal2At) / 1000);
      // An unreadable proof time fails closed (no totp claim) instead of minting a fresh one (T-054 review L4).
      const amr: Amr = identity.aal === "aal2" && Number.isFinite(proven) ? [{ method: "totp", timestamp: proven }] : [];
      return { ok: true, session: await sessionFrom(identity, status === "ok" ? next : null, amr) };
    },

    async sessionLive(sessionId: string): Promise<SessionLiveResult> {
      if (!isUuid(sessionId)) return { live: false };
      const fn = "auth_session_live";
      const row = await rpcRow(fn, { p_session: sessionId });
      if (row.live === false) return { live: false };
      if (row.live !== true) throw new AuthUnavailableError(fn);
      const { userId, email, isAnonymous, hasPassword, sessionId: id, aal, aal2At, absoluteExpiresAt } = parseIdentity(row, fn);
      return { live: true, userId, email, isAnonymous, hasPassword, sessionId: id, aal, aal2At, absoluteExpiresAt };
    },

    async revokeSession(sessionId: string): Promise<void> {
      if (!isUuid(sessionId)) return;
      await rpcVoid("auth_revoke_session", { p_session: sessionId });
    },

    async revokeUserSessions(userId: string, exceptSessionId?: string): Promise<void> {
      if (!isUuid(userId)) return;
      await rpcVoid("auth_revoke_user_sessions", { p_user: userId, p_except: isUuid(exceptSessionId) ? exceptSessionId : null });
    },

    async enrollTotp(input: EnrollTotpInput): Promise<EnrollTotpResult> {
      if (!isUuid(input.userId) || typeof input.email !== "string") return { ok: false, reason: "invalid" };
      const secret = generateTotpSecret();
      const fn = "auth_mfa_enroll";
      const row = await rpcRow(fn, { p_user: input.userId, p_secret_sealed: await sealTotpSecret(authSecret, input.userId, secret) });
      const status = statusOf(row, fn);
      if (status === "already_verified" || status === "invalid") return { ok: false, reason: status };
      if (status !== "ok" || !isUuid(row.factor_id)) throw new AuthUnavailableError(fn);
      return { ok: true, factorId: row.factor_id, secret, otpauthUri: otpauthUri(secret, input.email) };
    },

    async verifyTotp(input: VerifyTotpInput): Promise<VerifyTotpResult> {
      if (!isUuid(input.userId) || !isUuid(input.sessionId)) return { ok: false, reason: "invalid" };
      if (input.factorId !== undefined && !isUuid(input.factorId)) return { ok: false, reason: "no_factor" };
      const factor = await rpcOptionalRow("auth_mfa_factor", { p_user: input.userId, p_factor: input.factorId ?? null });
      if (!factor) return { ok: false, reason: "no_factor" };
      if (!isUuid(factor.factor_id) || typeof factor.secret_sealed !== "string") throw new AuthUnavailableError("auth_mfa_factor");
      let secret: string;
      try {
        secret = await unsealTotpSecret(authSecret, input.userId, factor.secret_sealed);
      } catch {
        throw new AuthUnavailableError("auth_mfa_factor");
      }
      const checked = checkTotp(secret, input.code, clock());
      if (!checked.ok) return { ok: false, reason: "invalid" };
      const refreshToken = randomToken(32);
      const fn = "auth_mfa_verify";
      const row = await rpcRow(fn, {
        p_user: input.userId,
        p_factor: factor.factor_id,
        p_session: input.sessionId,
        p_step: checked.step,
        p_new_refresh_hash: sha256Hex(refreshToken),
      });
      const status = statusOf(row, fn);
      if (status === "replay" || status === "invalid") return { ok: false, reason: status };
      if (status !== "ok") throw new AuthUnavailableError(fn);
      return { ok: true, session: await sessionFrom(parseIdentity(row, fn), refreshToken, amrFor("totp")) };
    },

    verifyAccessToken(token, opts = {}) {
      return verifyJwt(jwtSecret, token, { now: nowSeconds(), allowExpired: opts.allowExpired });
    },

    async staticKeys() {
      const [anon, service] = await Promise.all([
        mintStaticJwt(jwtSecret, "anon", undefined, nowSeconds()),
        mintStaticJwt(jwtSecret, "service_role", undefined, nowSeconds()),
      ]);
      return { anon, service };
    },
  };
}
