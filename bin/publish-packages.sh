#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

MODE="publish"
RUN_CHECKS=1

print_usage() {
  cat <<'EOF'
Usage: ./bin/publish-packages.sh [--dry-run] [--skip-checks]

Options:
  --dry-run      Run `yarn npm:publish:all:dry` instead of real publish
  --skip-checks  Skip typecheck/lint/unit/build before publishing
  -h, --help     Show this help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)
      MODE="dry-run"
      shift
      ;;
    --skip-checks)
      RUN_CHECKS=0
      shift
      ;;
    -h|--help)
      print_usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      print_usage
      exit 1
      ;;
  esac
done

if [[ -z "${YARN_NPM_AUTH_TOKEN:-}" ]]; then
  export YARN_NPM_AUTH_TOKEN="${NPM_TOKEN:-}"
fi

if [[ -z "${YARN_NPM_AUTH_TOKEN:-}" ]]; then
  echo "Missing npm auth token. Set NPM_TOKEN in .env or export YARN_NPM_AUTH_TOKEN." >&2
  exit 1
fi

echo "[publish] Repository root: $ROOT_DIR"
echo "[publish] Verifying npm authentication..."
yarn npm whoami

if [[ "$RUN_CHECKS" -eq 1 ]]; then
  echo "[publish] Running checks..."
  yarn typecheck
  yarn lint
  yarn unit
  yarn build
fi

if [[ "$MODE" == "dry-run" ]]; then
  echo "[publish] Running dry-run publish..."
  yarn npm:publish:all:dry
else
  echo "[publish] Publishing all packages..."
  yarn npm:publish:all
fi
