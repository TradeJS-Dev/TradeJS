#!/usr/bin/env bash

set -euo pipefail

QUICKSTART_USER="${QUICKSTART_SMOKE_USER:-quickstart-ci}"
QUICKSTART_PASSWORD="${QUICKSTART_SMOKE_PASSWORD:-QuickstartCi123!}"
QUICKSTART_URL="${QUICKSTART_SMOKE_URL:-http://127.0.0.1:3000/routes/signin}"
APP_LOG="$(mktemp -t tradejs-quickstart-app.XXXXXX)"
APP_PID=""

cleanup() {
  if [ -n "$APP_PID" ] && kill -0 "$APP_PID" 2>/dev/null; then
    kill "$APP_PID" 2>/dev/null || true
    wait "$APP_PID" 2>/dev/null || true
  fi

  rm -f "$APP_LOG"
}

trap cleanup EXIT

doctor_ready=false
for attempt in $(seq 1 12); do
  if yarn doctor -- --skip-ml; then
    doctor_ready=true
    break
  fi

  if [ "$attempt" -lt 12 ]; then
    echo "Quickstart infrastructure is not ready; retrying in 5 seconds"
    sleep 5
  fi
done

if [ "$doctor_ready" != "true" ]; then
  echo "Quickstart infrastructure did not become ready" >&2
  exit 1
fi

yarn user-add -u "$QUICKSTART_USER" -p "$QUICKSTART_PASSWORD"

yarn start >"$APP_LOG" 2>&1 &
APP_PID=$!

for attempt in $(seq 1 30); do
  if curl --fail --silent "$QUICKSTART_URL" >/dev/null; then
    echo "Quickstart smoke passed: $QUICKSTART_URL"
    exit 0
  fi

  if ! kill -0 "$APP_PID" 2>/dev/null; then
    echo "Quickstart app exited before becoming ready" >&2
    tail -n 200 "$APP_LOG" >&2
    exit 1
  fi

  if [ "$attempt" -lt 30 ]; then
    sleep 2
  fi
done

echo "Quickstart app did not become ready: $QUICKSTART_URL" >&2
tail -n 200 "$APP_LOG" >&2
exit 1
