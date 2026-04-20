#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [ ! -f "./packages/cli/dist/cli.js" ]; then
  yarn workspace @tradejs/cli build
fi

export PROJECT_CWD="${PROJECT_CWD:-$ROOT_DIR}"
export DOTENV_CONFIG_PATH="${DOTENV_CONFIG_PATH:-$ROOT_DIR/.env}"

ARGS=("$@")

# Yarn passes a literal `--` separator to scripts when forwarding extra args.
# Drop only the separator right after the command name so `yarn signals -- --help`
# becomes `cli.js signals --help`.
if [ "${#ARGS[@]}" -ge 2 ] && [ "${ARGS[1]}" = "--" ]; then
  ARGS=("${ARGS[0]}" "${ARGS[@]:2}")
fi

exec node ./packages/cli/dist/cli.js "${ARGS[@]}"
