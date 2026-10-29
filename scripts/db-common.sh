#!/usr/bin/env bash
# Shared by the PostgreSQL development scripts (db-up, db-down, db-migrate, db-verify).
GX_ROOT="$(dirname "$(dirname "$(realpath "${BASH_SOURCE[0]}")")")"
if [[ -z "${DATABASE_URL:-}" ]]; then
  # Parse dotenv as data, never shell code. Explicit process values win, allowing isolated
  # test stacks without reading or overwriting another stack's credentials.
  GX_DB_ENV_FILE="${GX_DB_ENV_FILE:-$GX_ROOT/infra/dev/.env}"
  if [[ -f "$GX_DB_ENV_FILE" ]]; then
    assignments="$(node --input-type=module - "$GX_DB_ENV_FILE" <<'JS'
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
for (const [key, value] of Object.entries(parseEnv(readFileSync(process.argv[2], 'utf8')))) {
  if (!/^[A-Z_][A-Z0-9_]*$/.test(key) || /[\r\n\0]/.test(value)) process.exit(1);
  console.log(`${key}=${value}`);
}
JS
    )" || { echo 'Invalid local database environment; refusing database operation' >&2; exit 1; }
    while IFS= read -r assignment; do
      [[ -n "$assignment" ]] || continue
      name="${assignment%%=*}"
      [[ -v "$name" ]] || export "$assignment"
    done <<< "$assignments"
  fi
fi
GX_DB_NAME="${GX_DB_NAME:-gxdb}"
GX_DB_CONTAINER="${GX_DB_CONTAINER:-gxdb-postgres-1}"
[[ "$GX_DB_CONTAINER" == gxdb-* ]] || { echo 'Refusing a container outside project gxdb' >&2; exit 1; }

if [[ -n "${DATABASE_URL:-}" ]]; then
  # psql on PATH reads the target from libpq variables, so the password never appears in argv.
  # An unknown URI parameter or a non-PostgreSQL scheme is refused rather than silently ignored.
  assignments="$(node --input-type=module -e '
    const u = new URL(process.env.DATABASE_URL);
    if (!["postgres:", "postgresql:"].includes(u.protocol)) throw new Error("DATABASE_URL must be a PostgreSQL URI");
    const out = { PGHOST: u.hostname.replace(/^\[|\]$/g, ""), PGPORT: u.port || "5432", PGDATABASE: decodeURIComponent(u.pathname.slice(1)) };
    if (u.username) out.PGUSER = decodeURIComponent(u.username);
    if (u.password) out.PGPASSWORD = decodeURIComponent(u.password);
    const names = { sslmode: "PGSSLMODE", connect_timeout: "PGCONNECT_TIMEOUT", application_name: "PGAPPNAME" };
    for (const [key, value] of u.searchParams) {
      if (!names[key]) throw new Error(`Unsupported DATABASE_URL parameter: ${key}`);
      out[names[key]] = value;
    }
    for (const [key, value] of Object.entries(out)) {
      if (/[\r\n]/.test(value)) throw new Error("Invalid DATABASE_URL");
      console.log(`${key}=${value}`);
    }
  ' 2>/dev/null)" || { echo 'Invalid or unsupported DATABASE_URL (scheme, parameters and port are checked; details are withheld because the URI carries the password); refusing database operation' >&2; exit 1; }
  while IFS= read -r assignment; do export "$assignment"; done <<< "$assignments"
  GX_DB_NAME="$PGDATABASE"
fi

gx_compose() {
  docker compose --project-name gxdb -f "$GX_ROOT/compose.db.yaml" "$@"
}

gx_psql() {
  # GX_PSQL_DB selects another database of the same server (reset connects to `postgres` to drop gxdb).
  if [[ -n "${DATABASE_URL:-}" ]]; then
    PGDATABASE="${GX_PSQL_DB:-$GX_DB_NAME}" psql -X -v ON_ERROR_STOP=1 "$@"
  else
    docker exec -i "$GX_DB_CONTAINER" psql -X -U postgres -d "${GX_PSQL_DB:-$GX_DB_NAME}" -v ON_ERROR_STOP=1 "$@"
  fi
}

gx_seed() {
  gx_psql -q -1 -f - < "$GX_ROOT/db/seed.sql"
  # The fixture TOTP secrets are sealed with this stack's AUTH_SECRET, which exists only at run time.
  node "$GX_ROOT/scripts/db-seed-totp.mjs" | gx_psql -q -1 -f -
}

# Poll the real service three times in a row: a reset database answers 503 until the schema cache reloads.
gx_wait_api() {
  gx_psql -q -c "notify pgrst, 'reload schema';"
  node --input-type=module -e '
    let consecutive = 0;
    for (let attempt = 0; attempt < 120; attempt++) {
      try {
        const response = await fetch(`${process.env.POSTGREST_URL}/rpc/registration_open`, {
          method: "POST", headers: { Authorization: `Bearer ${process.env.ANON_JWT}`, "Content-Type": "application/json" },
          body: "{}", signal: AbortSignal.timeout(2000),
        });
        const body = await response.text();
        consecutive = response.ok && (body === "true" || body === "false") ? consecutive + 1 : 0;
        if (consecutive === 3) { console.log("PostgREST: registration_open ready (3 consecutive responses)"); process.exit(0); }
      } catch { consecutive = 0; }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error("PostgREST did not become ready");
  '
}
