import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

// The reset path must refuse before any database or container call unless the caller names the
// database to drop. GX_DB_CONTAINER points at a container name that does not exist, so a missing
// guard would surface as a docker error instead of the refusal message.
const run = (env: Record<string, string>) =>
  spawnSync("bash", ["scripts/db-migrate.sh", "--reset"], {
    encoding: "utf8",
    env: { NODE_ENV: "test", PATH: process.env.PATH ?? "", GX_DB_ENV_FILE: "/dev/null", GX_DB_NAME: "gxguardprobe", GX_DB_CONTAINER: "gxdb-guard-probe-absent", ...env },
  });

describe("db-migrate --reset guard", () => {
  it("refuses without GX_CONFIRM_RESET", () => {
    const r = run({});
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("--reset drops database gxguardprobe");
    expect(r.stderr).toContain("GX_CONFIRM_RESET=gxguardprobe");
  });

  it("refuses a confirmation that names a different database", () => {
    const r = run({ GX_CONFIRM_RESET: "gxdb" });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("GX_CONFIRM_RESET=gxguardprobe");
  });

  it("passes the guard when the confirmation names the database", () => {
    const r = run({ GX_CONFIRM_RESET: "gxguardprobe" });
    // Past the guard it reaches docker against an absent container and fails there instead.
    expect(r.stderr).not.toContain("--reset drops database");
    expect(r.status).not.toBe(0);
  });
});
