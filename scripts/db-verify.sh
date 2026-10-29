#!/usr/bin/env bash
# Same machine-wide lock as the former /tmp/gx-db-verify.sh; never reset two stacks concurrently.
set -euo pipefail
exec 9>/tmp/gx-db.lock
flock 9
source "$(dirname "$(realpath "${BASH_SOURCE[0]}")")/db-common.sh"
[[ -z "${DATABASE_URL:-}" ]] || { echo 'db-verify manages only the gxdb Compose database; unset DATABASE_URL' >&2; exit 1; }
"$GX_ROOT/scripts/db-migrate.sh" --reset
gx_seed
gx_compose restart postgrest
gx_wait_api
cd "$GX_ROOT"
if [[ $# -eq 0 ]]; then set -- tests/db; fi
pnpm exec vitest run "$@"
