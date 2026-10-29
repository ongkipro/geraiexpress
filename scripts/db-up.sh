#!/usr/bin/env bash
set -euo pipefail
root="$(dirname "$(dirname "$(realpath "${BASH_SOURCE[0]}")")")"
"$root/scripts/dev-env.sh"
source "$root/scripts/db-common.sh"
[[ -z "${DATABASE_URL:-}" ]] || { echo 'db-up manages only the gxdb Compose database; unset DATABASE_URL' >&2; exit 1; }
gx_compose up -d --wait postgres mailpit
"$root/scripts/db-migrate.sh"
if [[ "$(gx_psql -qtA -c "select count(*) from auth.users where id = '00000000-0000-4000-a000-0000000000a1'")" == 0 ]]; then
  gx_seed
  echo 'Local seed loaded'
fi
gx_compose up -d postgrest
gx_wait_api
