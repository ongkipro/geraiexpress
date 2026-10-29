#!/usr/bin/env bash
# Database archive only. Cluster roles/passwords are re-provisioned, never dumped.
set -euo pipefail
source "$(dirname "$(realpath "${BASH_SOURCE[0]}")")/db-common.sh"
[[ $# -le 1 ]] || { echo 'Usage: db-backup.sh [output.dump] (or set BACKUP_DIR)' >&2; exit 1; }
umask 077
output="${1:-${BACKUP_DIR:?Pass output.dump or set BACKUP_DIR}/${GX_DB_NAME}-$(date -u +%Y%m%dT%H%M%S%N).dump}"
# noclobber atomically refuses an existing file, including a symlink.
# Written under .partial and renamed only after pg_dump succeeds, so a killed run never leaves a
# truncated archive under a final name (T-067 re-review).
set -o noclobber
[[ ! -e "$output" && ! -L "$output" ]] || { echo "Refusing to overwrite $output" >&2; exit 1; }
exec 3> "$output.partial"
trap 'rm -f -- "$output.partial"' ERR INT TERM
started=$SECONDS
if [[ -n "${DATABASE_URL:-}" ]]; then
  pg_dump -Fc >&3
else
  docker exec "$GX_DB_CONTAINER" pg_dump -U postgres -d "$GX_DB_NAME" -Fc >&3
fi
exec 3>&-
mv -n -- "$output.partial" "$output"
[[ ! -e "$output.partial" ]] || { echo "Refusing to overwrite $output" >&2; rm -f -- "$output.partial"; exit 1; }
printf 'Backup: %s\nBytes: %s\nDump seconds: %s\n' "$output" "$(wc -c < "$output")" "$((SECONDS-started))"
