#!/usr/bin/env bash

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT_DIR="${QUICKSTART_E2E_PROJECT_DIR:-$(cd "$REPO_ROOT/.." && pwd)/tradejs-quickstart-e2e}"
PORT="${QUICKSTART_E2E_PORT:-3100}"
CREATE_SPEC="${QUICKSTART_CREATE_SPEC:-create-tradejs}"
CREATE_BIN="${QUICKSTART_CREATE_BIN:-}"
FRAMEWORK_VERSION=""
if [[ "$CREATE_SPEC" =~ ^create-tradejs@([0-9]+\.[0-9]+\.[0-9]+(-beta\.[0-9]+)?)$ ]]; then
  FRAMEWORK_VERSION="${BASH_REMATCH[1]}"
fi
APP_URL="http://localhost:${PORT}"
APP_LOG="${QUICKSTART_E2E_LOG:-$REPO_ROOT/output/quickstart-e2e.log}"
CREATE_PID=""
NPM_EXEC_DIR=""
PROJECT_CREATED="false"

terminate_process_tree() {
  local parent_pid="$1"
  local child_pid
  local attempt

  while IFS= read -r child_pid; do
    if [ -n "$child_pid" ]; then
      terminate_process_tree "$child_pid"
    fi
  done < <(pgrep -P "$parent_pid" 2>/dev/null || true)

  kill "$parent_pid" 2>/dev/null || true
  for attempt in $(seq 1 50); do
    if ! kill -0 "$parent_pid" 2>/dev/null; then
      return 0
    fi
    sleep 0.1
  done
  kill -KILL "$parent_pid" 2>/dev/null || true
}

remove_tree() {
  local target="$1"
  local attempt

  for attempt in $(seq 1 10); do
    rm -rf "$target" 2>/dev/null || true
    if [ ! -e "$target" ]; then
      return 0
    fi
    sleep 0.2
  done

  echo "Failed to remove quickstart temporary directory: $target" >&2
  return 1
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
    remove_tree "$PROJECT_DIR"
  fi

  if [ -n "$NPM_EXEC_DIR" ]; then
    remove_tree "$NPM_EXEC_DIR"
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
if [ -z "$CREATE_BIN" ]; then
  NPM_EXEC_DIR="$(mktemp -d)"
fi
(
  if [ -n "$FRAMEWORK_VERSION" ]; then
    export CREATE_TRADEJS_FRAMEWORK_VERSION="$FRAMEWORK_VERSION"
    if [[ "$FRAMEWORK_VERSION" == *-beta.* ]]; then
      # Published strategies declare stable peer ranges, which exclude prereleases.
      export npm_config_force=true
    fi
  fi

  if [ -n "$CREATE_BIN" ]; then
    exec "$CREATE_BIN" "$PROJECT_DIR" --port "$PORT" --no-open
  else
    cd "$NPM_EXEC_DIR"
    exec npm exec --yes --package="$CREATE_SPEC" -- create-tradejs "$PROJECT_DIR" --port "$PORT" --no-open
  fi
) >"$APP_LOG" 2>&1 &
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

if [ -n "$FRAMEWORK_VERSION" ]; then
  node - "$PROJECT_DIR" "$FRAMEWORK_VERSION" <<'NODE'
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const [project, version] = process.argv.slice(2);
const framework = new Set([
  'app', 'cli', 'connectors', 'core', 'indicators', 'infra', 'node', 'types',
].map((name) => `@tradejs/${name}`));
const lock = JSON.parse(readFileSync(join(project, 'package-lock.json'), 'utf8'));
const installed = new Set();

for (const [location, entry] of Object.entries(lock.packages)) {
  const name = location.split('node_modules/').at(-1);
  if (!framework.has(name)) continue;

  if (entry.version !== version) {
    throw new Error(`Expected ${location}@${version}, installed ${entry.version}`);
  }
  installed.add(name);
}

for (const name of framework) {
  if (!installed.has(name)) throw new Error(`Missing ${name}@${version}`);
}
console.log(`Quickstart installed TradeJS ${version}`);
NODE
fi

if ! QUICKSTART_E2E_URL="$APP_URL" yarn playwright test e2e/quickstart.spec.ts; then
  echo "Quickstart browser failed; retained application log tail:" >&2
  tail -n 120 "$APP_LOG" >&2
  exit 1
fi
echo "Quickstart e2e passed: install -> dashboard -> backtest -> results"
