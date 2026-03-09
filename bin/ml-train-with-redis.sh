#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [ "$#" -eq 0 ]; then
  echo "Usage: $0 <train command> [args...]"
  exit 1
fi

REDIS_STOP_TIMEOUT_SEC="${ML_TRAIN_REDIS_STOP_TIMEOUT_SEC:-5}"
REDIS_START_TIMEOUT_SEC="${ML_TRAIN_REDIS_START_TIMEOUT_SEC:-5}"
DOCKER_WAIT_SEC="${ML_TRAIN_DOCKER_WAIT_SEC:-30}"
SHOULD_RESTORE_REDIS=0

run_with_timeout() {
  local timeout_sec="$1"
  local label="$2"
  shift 2

  "$@" &
  local pid=$!
  local elapsed=0

  while kill -0 "$pid" >/dev/null 2>&1; do
    if [ "$elapsed" -ge "$timeout_sec" ]; then
      echo "[ml-train] ${label} timed out after ${timeout_sec}s, terminating..."
      kill -TERM "$pid" >/dev/null 2>&1 || true
      sleep 1
      kill -KILL "$pid" >/dev/null 2>&1 || true
      wait "$pid" >/dev/null 2>&1 || true
      return 124
    fi
    if [ "$elapsed" -gt 0 ] && [ $((elapsed % 5)) -eq 0 ]; then
      echo "[ml-train] ${label} still running... ${elapsed}s"
    fi
    sleep 1
    elapsed=$((elapsed + 1))
  done

  wait "$pid"
}

wait_for_docker_daemon() {
  local timeout_sec="$1"
  local elapsed=0

  while [ "$elapsed" -lt "$timeout_sec" ]; do
    if docker info >/dev/null 2>&1; then
      return 0
    fi
    if [ "$elapsed" -eq 0 ]; then
      echo "[ml-train] Docker daemon is unavailable, trying to start Docker Desktop..."
      docker desktop start >/dev/null 2>&1 || true
    fi
    if [ "$elapsed" -gt 0 ] && [ $((elapsed % 5)) -eq 0 ]; then
      echo "[ml-train] waiting for Docker daemon... ${elapsed}s"
    fi
    sleep 1
    elapsed=$((elapsed + 1))
  done

  return 1
}

ensure_docker_daemon() {
  if wait_for_docker_daemon "$DOCKER_WAIT_SEC"; then
    return 0
  fi
  echo "[ml-train] ERROR: Docker daemon is still unavailable after ${DOCKER_WAIT_SEC}s."
  echo "[ml-train] Please restart Docker Desktop and retry."
  exit 1
}

restore_redis() {
  if [ "$SHOULD_RESTORE_REDIS" -ne 1 ]; then
    return 0
  fi
  ensure_docker_daemon
  echo "[ml-train] Starting redis..."
  run_with_timeout \
    "$REDIS_START_TIMEOUT_SEC" \
    "redis start" \
    docker compose -f docker-compose.dev.yml up -d redis || true
}

trap restore_redis EXIT INT TERM

ensure_docker_daemon
echo "[ml-train] Stopping redis..."
run_with_timeout \
  "$REDIS_STOP_TIMEOUT_SEC" \
  "redis stop" \
  docker compose -f docker-compose.dev.yml stop redis || true

SHOULD_RESTORE_REDIS=1
echo "[ml-train] Running: $*"
"$@"
