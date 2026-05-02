#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

CLI_DIST="./packages/cli/dist/cli.js"

needs_cli_rebuild() {
  if [ ! -f "$CLI_DIST" ]; then
    return 0
  fi

  local rebuild_inputs=(
    "./package.json"
    "./yarn.lock"
    "./.yarnrc.yml"
    "./turbo.json"
    "./tsconfig.json"
    "./tsconfig.base.json"
    "./tsconfig.packages.json"
    "./tradejs.config.ts"
    "./proto"
  )

  local input_path
  for input_path in "${rebuild_inputs[@]}"; do
    if find "$input_path" -type f -newer "$CLI_DIST" -print -quit 2>/dev/null | grep -q .; then
      return 0
    fi
  done

  # Test-only files should not force a CLI rebuild before runtime commands.
  if find ./packages \
    \( -path '*/__tests__/*' -o -name '*.test.*' -o -name '*.spec.*' -o -name '*.snap' \) -prune -o \
    \( -type f -a -newer "$CLI_DIST" -a \( -path '*/src/*' -o -name 'package.json' -o -name 'tsconfig*.json' -o -name 'tsup.config.ts' \) -print -quit \) \
    2>/dev/null | grep -q .; then
    return 0
  fi

  return 1
}

if needs_cli_rebuild; then
  yarn turbo run build --filter=@tradejs/cli...
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

exec node -r dotenv/config ./packages/cli/dist/cli.js "${ARGS[@]}"
