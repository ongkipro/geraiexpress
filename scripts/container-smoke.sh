#!/usr/bin/env bash
# T-062 / ARCH-1 local runtime smoke: build the image, run it with the local gxdb environment behind the
# local proxy profile, and probe it. Needs the local database stack running (`pnpm db:up`) and Docker.
#   APP_ORIGIN defaults to the local proxy origin; GX_LOCAL_PORT (8080), COMPOSE_PROJECT_NAME and GX_IMAGE as
#   in scripts/docker.sh. KEEP=1 leaves the containers running for e2e (E2E_BASE_URL below).
set -euo pipefail
cd "$(dirname "$0")/.."
port="${GX_LOCAL_PORT:-8080}"
export GX_LOCAL_PORT="$port" GX_ENV_FILE="${GX_ENV_FILE:-.env.container}"
export APP_ORIGIN="${APP_ORIGIN:-http://127.0.0.1:$port}"
base="http://127.0.0.1:$port"
if curl -s -o /dev/null --max-time 1 "$base/"; then
  echo "container-smoke: FAIL port $port already in use; stop the other server first" >&2
  exit 1
fi
[ -f "$GX_ENV_FILE" ] || bash scripts/dev-env.sh
bash scripts/docker.sh build
cleanup() { [ "${KEEP:-0}" = "1" ] || bash scripts/docker.sh down >/dev/null 2>&1 || true; }
trap cleanup EXIT
bash scripts/docker.sh up
# `up --wait` returns when the containers are running; the proxy has no health check, so wait for it to answer.
for _ in $(seq 1 30); do curl -s -o /dev/null --max-time 2 "$base/healthz" && break; sleep 1; done

fail=0
check() { # name expected actual
  if [ "$2" = "$3" ]; then echo "ok   $1 -> $3"; else echo "FAIL $1 -> $3 (expected $2)"; fail=1; fi
}
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
check "/healthz via proxy" 200 "$(code "$base/healthz")"
check "/masuk via proxy" 200 "$(code "$base/masuk")"
check "wrong host" 404 "$(code -H 'Host: evil.example' "$base/masuk")"
check "internal host not routed from the proxy" 404 "$(code -H 'Host: internal.geraiexpress.local' "$base/healthz")"
check "cron path denied at the proxy" 404 "$(code -X POST "$base/api/internal/cron/cleanup")"

# The cron route, from inside the compose network exactly as the scheduler calls it.
compose_exec() { docker compose -p "${COMPOSE_PROJECT_NAME:-geraiexpress}" --env-file "$GX_ENV_FILE" -f compose.yaml -f compose.local.yaml --profile local exec -T "$@"; }
cron() { # host authorization-header-or-empty task
  compose_exec app node -e '
    const [host, auth, task] = process.argv.slice(1);
    const headers = { host, ...(auth ? { authorization: auth === "SECRET" ? "Bearer " + process.env.CRON_SECRET : auth } : {}) };
    require("node:http").request({ host: "127.0.0.1", port: 3000, path: "/api/internal/cron/" + task, method: "POST", headers },
      (r) => { r.resume(); r.on("end", () => process.stdout.write(String(r.statusCode))); }).end();' "$@"
}
check "cron without secret" 401 "$(cron internal.geraiexpress.local '' cleanup)"
check "cron with a wrong secret" 401 "$(cron internal.geraiexpress.local 'Bearer wrong' cleanup)"
check "cron from a public host" 404 "$(cron app.geraiexpress.com SECRET cleanup)"
check "cron with the secret" 200 "$(cron internal.geraiexpress.local SECRET cleanup)"
[ $fail -eq 0 ] || { echo "container-smoke: FAIL"; exit 1; }
echo "container-smoke: PASS"
