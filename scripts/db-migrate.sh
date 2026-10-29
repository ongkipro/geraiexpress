#!/usr/bin/env bash
# One transaction per file; migration body and ledger entry commit or roll back together.
set -euo pipefail
source "$(dirname "$(realpath "${BASH_SOURCE[0]}")")/db-common.sh"
reset=false
case "${1:-}" in
  '') ;;
  --reset) reset=true ;;
  *) echo 'Usage: scripts/db-migrate.sh [--reset]' >&2; exit 2 ;;
esac
[[ $# -le 1 ]] || { echo 'Too many arguments' >&2; exit 2; }

if $reset; then
  # Only the disposable local database may be dropped: gx-prefixed name AND loopback host or the compose container.
  [[ "$GX_DB_NAME" =~ ^gx[a-zA-Z0-9_]*$ ]] || { echo '--reset requires a gx-prefixed database name' >&2; exit 1; }
  if [[ -n "${DATABASE_URL:-}" ]]; then
    case "${PGHOST:-}" in
      localhost|127.0.0.1|::1) ;;
      *) echo '--reset requires a loopback host' >&2; exit 1 ;;
    esac
  fi
  GX_PSQL_DB=postgres gx_psql -q -v target="$GX_DB_NAME" -f - <<'SQL'
select format('drop database if exists %I with (force)', :'target')
\gexec
select format('create database %I', :'target')
\gexec
SQL
fi

# Overrides support isolated migration-runner regression probes without changing real migration SQL.
foundation="${DB_FOUNDATION_DIR:-$GX_ROOT/db/foundation}"
migrations="${DB_MIGRATIONS_DIR:-$GX_ROOT/db/migrations}"
shopt -s nullglob
export LC_ALL=C
files=("$foundation"/*.sql "$migrations"/*.sql)
[[ ${#files[@]} -gt 0 ]] || { echo 'No migration SQL found' >&2; exit 1; }
declare -A seen=()
declare -A checksums=()
# Preflight every checksum before applying any new migration.
for file in "${files[@]}"; do
  name="${file##*/}"
  [[ "$name" =~ ^([0-9]{14})_[A-Za-z0-9_]+\.sql$ ]] || { echo "Invalid migration filename: $name" >&2; exit 1; }
  version="${BASH_REMATCH[1]}"
  [[ -z "${seen[$version]:-}" ]] || { echo "Duplicate migration version: $version" >&2; exit 1; }
  seen[$version]=1
  sum="$(sha256sum "$file")"
  checksums[$version]="${sum%% *}"
done

# One session owns the advisory lock from bootstrap through the last migration.
# Other deploy hosts wait, then re-read the ledger; no host-local flock can provide this.
{
  cat <<'SQL'
set lock_timeout = '60s';
select pg_advisory_lock(18482, 6817);
set lock_timeout = '5s';
set statement_timeout = '120s';
do $$ begin
  if current_user <> 'postgres' then raise exception 'Migrations require the postgres owner role'; end if;
end $$;
set client_min_messages = warning;
create schema if not exists private;
revoke all on schema private from public;
create table if not exists private.schema_migrations (
  version text primary key check (version ~ '^[0-9]{14}$'),
  filename text not null,
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  applied_at timestamptz not null default now()
);
revoke all on private.schema_migrations from public;
create temporary table migration_manifest (version text primary key, filename text, sha256 text);
SQL
  for file in "${files[@]}"; do
    name="${file##*/}"; version="${name%%_*}"
    # All values are constrained by the filename/checksum preflight above.
    printf "insert into migration_manifest values ('%s', '%s', '%s');\n" "$version" "$name" "${checksums[$version]}"
  done
  cat <<'SQL'
do $$ begin
  if exists (select from private.schema_migrations a left join migration_manifest m using (version)
      where m.version is null) then
    raise exception 'Applied migration missing from checkout; refusing to continue';
  end if;
  if exists (select from private.schema_migrations a join migration_manifest m using (version)
      where a.sha256 <> m.sha256 or a.filename <> m.filename) then
    raise exception 'Checksum or filename mismatch in applied migration; refusing to continue';
  end if;
end $$;
select count(*) as pending from migration_manifest m
where not exists (select from private.schema_migrations a where a.version = m.version)
\gset
SQL
  for file in "${files[@]}"; do
    name="${file##*/}"; version="${name%%_*}"
    printf "select not exists (select from private.schema_migrations where version = '%s') as apply_migration\n\\gset\n" "$version"
    printf '\\if :apply_migration\nbegin;\n'
    cat "$file"
    printf "\ninsert into private.schema_migrations(version, filename, sha256) select version, filename, sha256 from migration_manifest where version = '%s';\ncommit;\n" "$version"
    printf '\\echo Applied %s\n\\endif\n' "$name"
  done
  printf '\\echo Migrations: :pending applied\n'
} | gx_psql -q -f -

# Only the disposable Compose path provisions its local authenticator password. DATABASE_URL callers
# manage credentials outside the runner; never overwrite a remote role's password.
if [[ -z "${DATABASE_URL:-}" ]]; then
  [[ "${AUTHENTICATOR_PASSWORD:-}" =~ ^[a-f0-9]{64}$ ]] || { echo 'Run scripts/dev-env.sh first' >&2; exit 1; }
  # Roles are cluster-wide: serialize local provisioning on the maintenance database too.
  printf "begin;\nset local lock_timeout = '60s';\nselect pg_advisory_xact_lock(18482, 6818);\nselect format('alter role authenticator password %%L', '%s')\n\\gexec\ncommit;\n" "$AUTHENTICATOR_PASSWORD" | GX_PSQL_DB=postgres gx_psql -q -f -
fi
