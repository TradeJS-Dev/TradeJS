#!/usr/bin/env bash

set -Eeuo pipefail

readonly SIGNALS_LOG_PATH="${SIGNALS_LOG_PATH:-/var/log/cron.signals.15.log}"
declare -a managed_pids=()

shutdown() {
  local exit_status="${1:-0}"

  trap - INT TERM
  for pid in "${managed_pids[@]}"; do
    kill -TERM "$pid" 2>/dev/null || true
  done
  for pid in "${managed_pids[@]}"; do
    wait "$pid" 2>/dev/null || true
  done

  exit "$exit_status"
}

trap 'shutdown 0' INT TERM

touch "$SIGNALS_LOG_PATH"

crond -f -P &
cron_pid=$!
managed_pids+=("$cron_pid")

(
  set -o pipefail
  PROJECT_CWD=/app \
    DOTENV_CONFIG_PATH=/app/.env \
    NODE_OPTIONS="--max-old-space-size=${SIGNALS_DAEMON_HEAP_MB:-4096}" \
    bash ./bin/run-cli-runtime.sh \
      signals-daemon \
      --timeframe 15 \
      --chunk 1/1 \
      --notify \
      --makeOrders \
      --showSkipStats 2>&1 | tee -a "$SIGNALS_LOG_PATH"
) &
signals_pid=$!
managed_pids+=("$signals_pid")

(
  PROJECT_CWD=/app \
    DOTENV_CONFIG_PATH=/app/.env \
    NODE_OPTIONS="--max-old-space-size=${MARKET_WS_HEAP_MB:-256}" \
    bash ./bin/run-cli-runtime.sh market-ws
) &
market_ws_pid=$!
managed_pids+=("$market_ws_pid")

node ./apps/app/bin/tradejs-app.mjs start &
app_pid=$!
managed_pids+=("$app_pid")

set +e
wait -n -p exited_pid "${managed_pids[@]}"
exit_status=$?
set -e

case "$exited_pid" in
  "$cron_pid") process_name='crond' ;;
  "$signals_pid") process_name='signals-daemon' ;;
  "$market_ws_pid") process_name='market-ws' ;;
  "$app_pid") process_name='app' ;;
  *) process_name="pid $exited_pid" ;;
esac

printf 'Managed process exited: %s (status=%s)\n' "$process_name" "$exit_status" >&2
if ((exit_status == 0)); then
  exit_status=1
fi
shutdown "$exit_status"
