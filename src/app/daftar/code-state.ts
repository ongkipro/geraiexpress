import type { CodeState } from "@/lib/registration-actions";

// The verify step keeps its own action state, so after "Ganti email" an old "Kode tidak cocok"
// would be shown for the new address. An error counts only for the address it was produced for.
export function codeStepError(verified: CodeState, requested: CodeState): string | undefined {
  return !verified.email || verified.email === requested.email ? verified.error : undefined;
}
