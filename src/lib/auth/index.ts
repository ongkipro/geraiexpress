// Public surface of the application-owned auth module (ADR-0002 section 3.2). Callers import from
// "@/lib/auth"; the Edge middleware may import "./jwt" directly to stay free of node: modules.
export { createAuth } from "./service";
export type {
  Audience,
  Auth,
  AuthConfig,
  AnonymousSignInInput,
  CodeSignInResult,
  EnrollTotpInput,
  EnrollTotpResult,
  PasswordSignInInput,
  RefreshResult,
  RequestCodeInput,
  RequestCodeResult,
  SessionLiveResult,
  SessionTokens,
  SetPasswordInput,
  SetPasswordResult,
  SignInResult,
  VerifyCodeInput,
  VerifyTotpInput,
  VerifyTotpResult,
} from "./service";
export { AuthUnavailableError } from "./store";
export type { AuthStore, AuthStoreReply } from "./store";
export { ACCESS_TTL_SECONDS, CLOCK_SKEW_SECONDS, signJwt, verifyJwt } from "./jwt";
export type { AccessClaims, VerifyFailure, VerifyResult } from "./jwt";
export { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH, passwordProblem } from "./password";
