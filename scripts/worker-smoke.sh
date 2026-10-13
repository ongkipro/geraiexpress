#!/usr/bin/env bash
# ARCH-1 local runtime smoke: serve the built OpenNext Worker with workerd and probe it.
# Requires a current `pnpm cf:build`. Fails if another server already owns the port.
set -euo pipefail
port="${SMOKE_PORT:-8788}"
if curl -s -o /dev/null --max-time 1 "http://127.0.0.1:$port/"; then
  echo "worker-smoke: FAIL port $port already in use; stop the other server first" >&2
  exit 1
fi
[[ -f .open-next/worker.js ]] || { echo "worker-smoke: FAIL no .open-next/worker.js; run pnpm cf:build" >&2; exit 1; }
log="$(mktemp)"
setsid ./node_modules/.bin/wrangler dev --port "$port" --ip 127.0.0.1 >"$log" 2>&1 &
pid=$!
trap 'kill -- -$pid 2>/dev/null || true; rm -f "$log"' EXIT
for _ in $(seq 1 60); do curl -fs -o /dev/null "http://127.0.0.1:$port/healthz" && break; sleep 1; done
fail=0
for path in ${SMOKE_PATHS:-/healthz /masuk}; do
  code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$port$path")
  echo "$path -> $code"
  [[ "$code" == "${SMOKE_EXPECT:-200}" ]] || fail=1
done
[[ $fail -eq 0 ]] || { tail -40 "$log"; exit 1; }
echo "worker-smoke: PASS"
