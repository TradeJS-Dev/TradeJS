#!/usr/bin/env bash

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT_DIR="${QUICKSTART_E2E_PROJECT_DIR:-$(cd "$REPO_ROOT/.." && pwd)/tradejs-quickstart-e2e}"
PORT="${QUICKSTART_E2E_PORT:-3100}"
CREATE_SPEC="${QUICKSTART_CREATE_SPEC:-create-tradejs}"
CREATE_BIN="${QUICKSTART_CREATE_BIN:-}"
APP_URL="http://localhost:${PORT}"
APP_LOG="${QUICKSTART_E2E_LOG:-$REPO_ROOT/output/quickstart-e2e.log}"
CREATE_PID=""
NPM_EXEC_DIR=""
PROJECT_CREATED="false"

terminate_process_tree() {
  local parent_pid="$1"
  local child_pid

  while IFS= read -r child_pid; do
    if [ -n "$child_pid" ]; then
      terminate_process_tree "$child_pid"
    fi
  done < <(pgrep -P "$parent_pid" 2>/dev/null || true)

  kill "$parent_pid" 2>/dev/null || true
}

cleanup() {
  if [ -n "$CREATE_PID" ] && kill -0 "$CREATE_PID" 2>/dev/null; then
    terminate_process_tree "$CREATE_PID"
    wait "$CREATE_PID" 2>/dev/null || true
  fi

  if [ -f "$PROJECT_DIR/docker-compose.dev.yml" ]; then
    (
      cd "$PROJECT_DIR"
      docker compose -f docker-compose.dev.yml down --volumes
    ) >/dev/null 2>&1 || true
  fi

  if [ "$PROJECT_CREATED" = "true" ]; then
    rm -rf "$PROJECT_DIR"
  fi

  if [ -n "$NPM_EXEC_DIR" ]; then
    rm -rf "$NPM_EXEC_DIR"
  fi
}

trap cleanup EXIT

case "$PROJECT_DIR" in
  "$REPO_ROOT"|"/"|"")
    echo "Refusing to use unsafe quickstart project directory: $PROJECT_DIR" >&2
    exit 1
    ;;
esac

if [ -e "$PROJECT_DIR" ]; then
  echo "Quickstart e2e project directory already exists: $PROJECT_DIR" >&2
  exit 1
fi

PROJECT_CREATED="true"
mkdir -p "$(dirname "$APP_LOG")"

echo "Starting one-command quickstart with $CREATE_SPEC"
if [ -n "$CREATE_BIN" ]; then
  "$CREATE_BIN" "$PROJECT_DIR" --port "$PORT" --no-open >"$APP_LOG" 2>&1 &
else
  NPM_EXEC_DIR="$(mktemp -d)"
  (
    cd "$NPM_EXEC_DIR"
    npm exec --yes --package="$CREATE_SPEC" -- create-tradejs "$PROJECT_DIR" --port "$PORT" --no-open
  ) >"$APP_LOG" 2>&1 &
fi
CREATE_PID=$!

ready=false
for attempt in $(seq 1 180); do
  if curl --fail --silent "$APP_URL/routes/install" >/dev/null; then
    ready=true
    break
  fi

  if ! kill -0 "$CREATE_PID" 2>/dev/null; then
    echo "create-tradejs exited before the install page became ready" >&2
    tail -n 200 "$APP_LOG" >&2
    exit 1
  fi

  if [ "$attempt" -lt 180 ]; then
    sleep 2
  fi
done

if [ "$ready" != "true" ]; then
  echo "Install page did not become ready: $APP_URL/routes/install" >&2
  tail -n 200 "$APP_LOG" >&2
  exit 1
fi

QUICKSTART_E2E_URL="$APP_URL" yarn playwright test e2e/quickstart.spec.ts
echo "Quickstart e2e passed: install -> dashboard -> backtest -> results"
