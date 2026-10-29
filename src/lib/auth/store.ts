// The auth service reaches PostgreSQL only through the machine-only `auth_*` RPCs (ADR-0002 section 3.2).
// A postgrest-js client built with the service_role JWT satisfies this shape as is.
export type AuthStoreReply = { data: unknown; error: { message: string; code?: string } | null };

export type AuthStore = {
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<AuthStoreReply>;
};

/**
 * The store failed or answered with something the service cannot interpret. The message names the
 * operation only: arguments (hashes, tokens, emails) and the store's own error text never appear in it.
 */
export class AuthUnavailableError extends Error {
  constructor(readonly operation: string) {
    super(`auth store unavailable: ${operation}`);
    this.name = "AuthUnavailableError";
  }
}
