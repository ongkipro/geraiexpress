import "server-only";
import { getAuth, postgrestUrl } from "@/lib/auth/instance";
import { trackingTokenSecret } from "@/lib/config";

// T-105: the server configuration every request path needs, checked with the validators those paths use
// (no second copy of the rules). Each problem is the validator's message, which names the variable and
// never its value. Empty = usable. Used at startup (src/instrumentation.ts) and by /healthz readiness.
export function runtimeConfigProblems(): string[] {
  const problems: string[] = [];
  for (const check of [postgrestUrl, getAuth, trackingTokenSecret]) {
    try {
      check();
    } catch (error) {
      problems.push(error instanceof Error ? error.message : "invalid server configuration");
    }
  }
  return problems;
}
