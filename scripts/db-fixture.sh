#!/usr/bin/env bash
# T-108: local review data. Applies db/review-fixture.sql (the review gerai) and then db/local-fixture.sql
# (contacts, shipments, labels, payments, cash periods, cases) to the local Compose gxdb only. Both files
# refuse any database that is not gx-prefixed with app.gx_local=on and repeat safely (skip when present).
set -euo pipefail
source "$(dirname "$(realpath "${BASH_SOURCE[0]}")")/db-common.sh"
[[ -z "${DATABASE_URL:-}" ]] || { echo 'db-fixture applies only to the local gxdb Compose database; unset DATABASE_URL' >&2; exit 1; }
[[ "$GX_DB_NAME" =~ ^gx[a-zA-Z0-9_]*$ ]] || { echo 'db-fixture requires a gx-prefixed database name' >&2; exit 1; }
# review-fixture.sql has no transaction statements: -1 makes it one transaction.
gx_psql -q -1 -f - < "$GX_ROOT/db/review-fixture.sql"
# local-fixture.sql runs its own BEGIN/COMMIT (temporary tables and helpers live in that transaction).
gx_psql -q -f - < "$GX_ROOT/db/local-fixture.sql"
echo 'Local fixture applied (Gerai Demo Review (contoh))'
