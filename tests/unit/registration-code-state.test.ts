import { describe, expect, it } from "vitest";
import { codeStepError } from "../../src/app/daftar/code-state";

describe("code step error follows the address it was produced for", () => {
  const wrong = { step: "code" as const, email: "old@example.test", error: "Kode tidak cocok atau sudah kedaluwarsa." };

  it("shows the error for the same address", () => {
    expect(codeStepError(wrong, { step: "code", email: "old@example.test" })).toBe(wrong.error);
  });

  it("hides it after 'Ganti email' produced a request for a different address", () => {
    expect(codeStepError(wrong, { step: "code", email: "new@example.test" })).toBeUndefined();
  });

  it("has no error before any verification", () => {
    expect(codeStepError({}, { step: "code", email: "new@example.test" })).toBeUndefined();
  });
});
