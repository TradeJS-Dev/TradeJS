#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [ ! -f "./packages/cli/dist/cli.js" ]; then
  yarn workspace @tradejs/cli build
fi

export PROJECT_CWD="${PROJECT_CWD:-$ROOT_DIR}"
export DOTENV_CONFIG_PATH="${DOTENV_CONFIG_PATH:-$ROOT_DIR/.env}"

yarn workspace @tradejs/cli run:dist "$@"
