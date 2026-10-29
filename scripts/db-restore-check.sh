#!/usr/bin/env bash
# Quiesce source writers while taking the archive and comparing counts.
set -euo pipefail
source "$(dirname "$(realpath "${BASH_SOURCE[0]}")")/db-common.sh"
[[ $# -ge 1 && $# -le 2 && -f "$1" ]] || { echo 'Usage: db-restore-check.sh archive.dump [gxrestore_name]' >&2; exit 1; }
archive="$1"
scratch="${2:-gxrestore$(date -u +%Y%m%d%H%M%S)_$$}"
[[ "$scratch" =~ ^gxrestore[a-z0-9_]*$ && ${#scratch} -le 63 && "$scratch" != "$GX_DB_NAME" ]] || { echo 'Scratch database must match ^gxrestore[a-z0-9_]*$, max 63 characters, and differ from source' >&2; exit 1; }
work="$(mktemp -d)"
created=0
cleanup() {
  status=$?
  trap - EXIT
  if [[ "$created" == 1 ]]; then
    if ! GX_PSQL_DB=postgres gx_psql -q -c "DROP DATABASE \"$scratch\";"; then status=1; fi
  fi
  rm -rf -- "$work"
  exit "$status"
}
trap cleanup EXIT
started=$SECONDS
# CREATE fails if already present; never adopt or drop somebody else's database.
GX_PSQL_DB=postgres gx_psql -q -c "CREATE DATABASE \"$scratch\" TEMPLATE template0;"
created=1
if [[ -n "${DATABASE_URL:-}" ]]; then
  # pg_restore connects only with -d (PGDATABASE alone is ignored); host/user/password stay in the libpq environment.
  pg_restore -d "$scratch" --exit-on-error --single-transaction < "$archive"
else
  docker exec -i "$GX_DB_CONTAINER" pg_restore -U postgres -d "$scratch" --exit-on-error --single-transaction < "$archive"
fi
printf 'Restore seconds: %s\n' "$((SECONDS-started))"
# Include partition roots, ordinary tables and foreign tables, sorted by qualified name.
cat > "$work/counts.sql" <<'SQL'
SELECT format('SELECT %L AS table_name, count(*) AS rows FROM %I.%I;', n.nspname || '.' || c.relname, n.nspname, c.relname)
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname IN ('public','private','auth') AND c.relkind IN ('r','p','f')
ORDER BY n.nspname, c.relname
\gexec
SQL
gx_psql -At -f - < "$work/counts.sql" > "$work/source"
GX_PSQL_DB="$scratch" gx_psql -At -f - < "$work/counts.sql" > "$work/restored"
diff -u "$work/source" "$work/restored"
cat "$work/restored"
printf 'Row counts: MATCH (%s tables)\n' "$(wc -l < "$work/source")"
ledger='SELECT version, sha256 FROM private.schema_migrations ORDER BY version;'
gx_psql -At -c "$ledger" > "$work/source-ledger"
GX_PSQL_DB="$scratch" gx_psql -At -c "$ledger" > "$work/restored-ledger"
diff -u "$work/source-ledger" "$work/restored-ledger"
printf 'Migration checksums: MATCH (%s migrations)\n' "$(wc -l < "$work/source-ledger")"
GX_PSQL_DB="$scratch" gx_psql -c 'select count(*) from auth.users;'
printf 'Restore/check seconds: %s\nScratch database: %s (dropped on exit)\n' "$((SECONDS-started))" "$scratch"
