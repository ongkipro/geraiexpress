#!/usr/bin/env bash
# T-062: thin wrappers around `docker build` and `docker compose` for the local container.
#   scripts/docker.sh build   build the image (APP_ORIGIN is REQUIRED: the gerai application's absolute origin,
#                             baked into the static marketing pages; locally http://127.0.0.1:8080)
#   scripts/docker.sh up      start app + the local plain-HTTP proxy (compose.local.yaml); GX_SCHEDULER=1 adds the scheduler
#   scripts/docker.sh down    stop and remove them
# Environment: GX_IMAGE (default geraiexpress:local), GX_ENV_FILE (default .env.container, written by
# `pnpm dev:env`), GX_LOCAL_PORT (default 8080), COMPOSE_PROJECT_NAME (default geraiexpress).
# Production does not use this script: see RELEASE.md (`docker compose --env-file <0600 file> --profile prod`).
set -euo pipefail
cd "$(dirname "$0")/.."
image="${GX_IMAGE:-geraiexpress:local}"
export GX_IMAGE="$image"
export GX_ENV_FILE="${GX_ENV_FILE:-.env.container}"
compose() {
  local profiles=(--profile local)
  [ "${GX_SCHEDULER:-0}" = "1" ] && profiles+=(--profile scheduler)
  docker compose -p "${COMPOSE_PROJECT_NAME:-geraiexpress}" --env-file "$GX_ENV_FILE" -f compose.yaml -f compose.local.yaml "${profiles[@]}" "$@"
}
case "${1:-}" in
  build)
    if [ -z "${APP_ORIGIN:-}" ]; then
      echo "docker:build: export APP_ORIGIN, the https origin of the gerai application (locally http://127.0.0.1:${GX_LOCAL_PORT:-8080}), before building" >&2
      exit 1
    fi
    docker build --build-arg "APP_ORIGIN=$APP_ORIGIN" -t "$image" .
    ;;
  up)
    [ -f "$GX_ENV_FILE" ] || { echo "docker:up: $GX_ENV_FILE not found; run pnpm dev:env first" >&2; exit 1; }
    docker network inspect gxdb_default >/dev/null 2>&1 || { echo "docker:up: the local database stack is not running (network gxdb_default); run pnpm db:up first" >&2; exit 1; }
    compose up -d --wait
    echo "docker:up: proxy on http://127.0.0.1:${GX_LOCAL_PORT:-8080}"
    ;;
  down)
    compose down
    ;;
  *)
    echo "usage: scripts/docker.sh build|up|down" >&2
    exit 2
    ;;
esac
