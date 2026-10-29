import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

it("reads dotenv as inert data, preserves explicit targets, and refuses multiline values", () => {
  const dir = mkdtempSync(join(tmpdir(), "gx-env-test-"));
  const file = join(dir, "fixture.env"), marker = join(dir, "executed");
  const env = { ...process.env, DATABASE_URL: "", GX_DB_ENV_FILE: file, GX_DB_NAME: "gx_explicit" };
  try {
    writeFileSync(file, `GX_DB_NAME=gx_wrong\nPROBE='$(touch ${marker})'\n`);
    const output = execFileSync("bash", ["-c", 'source scripts/db-common.sh; printf "%s" "$GX_DB_NAME|$PROBE"'], { env, encoding: "utf8" });
    expect(output).toBe(`gx_explicit|$(touch ${marker})`);
    expect(existsSync(marker)).toBe(false);
    writeFileSync(file, 'PROBE="line1\nline2"\n');
    const refused = spawnSync("bash", ["-c", "source scripts/db-common.sh"], { env, encoding: "utf8" });
    expect(refused.status).not.toBe(0);
    expect(refused.stderr).toContain("Invalid local database environment");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
