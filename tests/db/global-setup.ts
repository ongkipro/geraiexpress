import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";

// Loads the local plain-PostgreSQL stack's settings from the gitignored infra/dev/.env (written by
// `pnpm db:up`). Shell values win. A missing file is not an error here: unit tests never need
// the stack, and the DB helpers fail with a clear message when they first need it.
export default function setup() {
  const file = process.env.GX_TEST_ENV_FILE ?? resolve(import.meta.dirname, "../../infra/dev/.env");
  if (!existsSync(file)) return;
  for (const [name, value] of Object.entries(parseEnv(readFileSync(file, "utf8")))) {
    if (process.env[name] === undefined && value !== undefined) process.env[name] = value;
  }
}
