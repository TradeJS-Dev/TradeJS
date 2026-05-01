#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

CLI_DIST="./packages/cli/dist/cli.js"

if [ ! -f "$CLI_DIST" ]; then
  echo "TradeJS CLI dist is missing: $CLI_DIST" >&2
  echo "Build the CLI first, for example: yarn turbo run build --filter=@tradejs/cli..." >&2
  exit 1
fi

export PROJECT_CWD="${PROJECT_CWD:-$ROOT_DIR}"
export DOTENV_CONFIG_PATH="${DOTENV_CONFIG_PATH:-$ROOT_DIR/.env}"

ARGS=("$@")

if [ "${#ARGS[@]}" -ge 2 ] && [ "${ARGS[1]}" = "--" ]; then
  ARGS=("${ARGS[0]}" "${ARGS[@]:2}")
fi

exec node -r dotenv/config "$CLI_DIST" "${ARGS[@]}"
