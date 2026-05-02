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
TARGET_PACKAGE=""

print_usage() {
  cat <<'EOF'
Usage: ./bin/publish-packages.sh [--dry-run] [--skip-checks] [--package <workspace-name>]

Options:
  --dry-run      Run `yarn npm:publish:all:dry` instead of real publish
  --skip-checks  Skip typecheck/lint/unit/build before publishing
  --package      Publish only one workspace package, for example `@tradejs/cli`
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
    --package)
      if [[ $# -lt 2 ]]; then
        echo "Missing value for --package" >&2
        print_usage
        exit 1
      fi
      TARGET_PACKAGE="$2"
      shift 2
      ;;
    --package=*)
      TARGET_PACKAGE="${1#--package=}"
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

if [[ -n "$TARGET_PACKAGE" ]]; then
  TARGET_PACKAGE="$(printf '%s' "$TARGET_PACKAGE" | xargs)"
  if [[ -z "$TARGET_PACKAGE" ]]; then
    echo "Package name for --package cannot be empty" >&2
    exit 1
  fi
fi

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
  yarn checks
fi

if [[ -n "$TARGET_PACKAGE" ]]; then
  if [[ "$MODE" == "dry-run" ]]; then
    echo "[publish] Running dry-run publish for $TARGET_PACKAGE..."
    yarn workspace "$TARGET_PACKAGE" npm publish --access public --dry-run
  else
    echo "[publish] Publishing package $TARGET_PACKAGE..."
    yarn workspace "$TARGET_PACKAGE" npm publish --access public
  fi
else
  if [[ "$MODE" == "dry-run" ]]; then
    echo "[publish] Running dry-run publish..."
    yarn npm:publish:all:dry
  else
    echo "[publish] Publishing all packages..."
    yarn npm:publish:all
  fi
fi
