import "server-only";
import { getAuth, postgrestUrl } from "@/lib/auth/instance";
import { trackingTokenSecret } from "@/lib/config";
import { mailConfigProblems } from "@/lib/mail-transport";

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
  // A selected but incomplete mail transport is a configuration error (names only). An unset MAIL_TRANSPORT
  // stays a valid deployment: mail fails closed and sign-up says delivery is unavailable.
  const mail = mailConfigProblems();
  if (mail.length) problems.push(`mail transport incomplete: ${mail.join(", ")}`);
  return problems;
}
