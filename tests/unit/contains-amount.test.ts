import { describe, expect, it } from "vitest";
import { containsAmount } from "../contains-amount";

describe("containsAmount (DB sentinel leak check)", () => {
  it.each([
    [{ net: 13579 }, "a JSON number"],
    [{ net: "13579" }, "a numeric string"],
    [{ net: "13579.00" }, "a numeric string with decimals"],
    [{ note: "Rp13579" }, "a currency prefix without space"],
    [{ note: "Rp 13.579 / 13579 IDR" }, "a word-bounded amount"],
    [{ raw: '{"net":13579}' }, "stringified JSON inside text"],
    [[1, { deep: [13579] }], "a nested array value"],
  ] as [unknown, string][])("detects %j (%s)", (value) => {
    expect(containsAmount(value, 13579)).toBe(true);
  });

  it.each([
    [{ created_at: "2026-11-05T07:42:46.135797+00:00" }, "timestamp microseconds"],
    [{ created_at: "2026-11-05T07:42:46.13579+00:00" }, "trimmed microseconds"],
    [{ id: "a1357900-0000-4000-8000-000000013579" }, "a UUID"],
    [{ n: 135790 }, "a longer number"],
    [{ s: "135790" }, "a longer digit run"],
  ] as [unknown, string][])("ignores %j (%s)", (value) => {
    expect(containsAmount(value, 13579)).toBe(false);
  });
});
