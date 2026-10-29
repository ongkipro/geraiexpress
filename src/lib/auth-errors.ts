import "server-only";
import { AuthUnavailableError } from "@/lib/auth/store";

export const TOO_MANY_AUTH_ATTEMPTS = "Terlalu banyak percobaan dari jaringan ini. Tunggu satu menit lalu coba lagi.";
export const AUTH_BUSY = "Layanan masuk sedang sibuk. Coba lagi sebentar lagi.";
type AuthRoute = "/masuk" | "/daftar" | "/verifikasi-2fa" | "/refresh";

// SEC-5 / RATE-2: bounded labels only. Never serialize anything the caller submitted.
export function authThrottleMessage(route: AuthRoute, status = 429): string {
  console.warn(JSON.stringify({ event: "auth_rate_limited", route, status }));
  return TOO_MANY_AUTH_ATTEMPTS;
}

// The auth store failed or answered something unreadable. True (after logging the operation name only)
// when `error` is that failure, so a caller answers "busy" and rethrows anything else. The error text
// never carries arguments (src/lib/auth/store.ts).
export function authUnavailable(error: unknown, route: AuthRoute): error is AuthUnavailableError {
  if (!(error instanceof AuthUnavailableError)) return false;
  console.error(JSON.stringify({ event: "auth_unavailable", route, operation: error.operation }));
  return true;
}
