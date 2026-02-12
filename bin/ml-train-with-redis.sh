#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [ "$#" -eq 0 ]; then
  echo "Usage: $0 <train command> [args...]"
  exit 1
fi

restore_redis() {
  echo "[ml-train] Starting redis..."
  docker compose -f docker-compose.db.yml up -d redis >/dev/null 2>&1 || true
}

trap restore_redis EXIT INT TERM

echo "[ml-train] Stopping redis..."
docker compose -f docker-compose.db.yml stop redis >/dev/null 2>&1 || true

echo "[ml-train] Running: $*"
"$@"
